import "server-only";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { MAX_FILE_BYTES } from "@/lib/content";
import { SOURCE_FORMATS } from "@/lib/source-formats";
import { AccessError } from "@/server/access";
import { publicAddress } from "@/server/official/fetch";

export function publicDocumentUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AccessError(400, "올바른 웹 주소를 입력해 주세요.");
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.port ||
    url.username ||
    url.password ||
    raw.length > 2000 ||
    /\p{Cc}/u.test(raw) ||
    isIP(url.hostname.replace(/[[\]]/g, "")) ||
    !url.hostname.includes(".")
  )
    throw new AccessError(
      400,
      "공개 웹 사이트의 HTTP·HTTPS 주소를 입력해 주세요.",
    );
  url.hostname = url.hostname.replace(/\.$/, "").toLowerCase();
  url.hash = "";
  return url;
}
export type WebDocument = {
  url: string;
  bytes: Buffer;
  filename: string;
  contentType: string;
};
export async function fetchPublicDocument(
  raw: string,
  suppliedSignal?: AbortSignal,
): Promise<WebDocument> {
  const signal = AbortSignal.any([
    AbortSignal.timeout(30_000),
    ...(suppliedSignal ? [suppliedSignal] : []),
  ]);
  let url = publicDocumentUrl(raw);
  for (let hop = 0; hop < 4; hop++) {
    signal.throwIfAborted();
    const addresses = await Promise.race([
      lookup(url.hostname, { all: true }),
      new Promise<never>((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      ),
    ]);
    if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
      throw new AccessError(
        403,
        "내부망·예약 주소에서 자료를 수집할 수 없습니다.",
      );
    const address = addresses.find((a) => a.family === 4) ?? addresses[0];
    const result = await new Promise<{
      status: number;
      location?: string;
      contentType: string;
      bytes: Buffer;
    }>((resolve, reject) => {
      const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
        {
          hostname: address.address,
          servername: url.hostname,
          port: url.protocol === "https:" ? 443 : 80,
          path: url.pathname + url.search,
          agent: false,
          signal,
          headers: {
            Host: url.host,
            "User-Agent": "DomainWikiCollector/1.0",
            Accept: "text/html,application/pdf,text/plain,*/*;q=0.5",
            "Accept-Encoding": "identity",
          },
        },
        (response) => {
          const type = String(response.headers["content-type"] ?? "")
            .split(";")[0]
            .trim()
            .toLowerCase();
          const limit =
            type === "text/html" ? 10 * 1024 * 1024 : MAX_FILE_BYTES;
          if (
            Number(response.headers["content-length"]) > limit ||
            (response.headers["content-encoding"] &&
              response.headers["content-encoding"] !== "identity")
          ) {
            response.destroy();
            reject(
              new AccessError(
                413,
                "원격 응답의 크기·전송 형식을 확인해 주세요. 파일을 내려받아 직접 등록할 수도 있습니다.",
              ),
            );
            return;
          }
          const chunks: Buffer[] = [];
          let length = 0;
          response.on("data", (chunk: Buffer) => {
            length += chunk.length;
            if (length > limit)
              response.destroy(
                new AccessError(413, "원문 크기 제한을 초과했습니다."),
              );
            else chunks.push(chunk);
          });
          response.on("error", reject);
          response.on("aborted", () =>
            reject(new AccessError(502, "원문 전송이 중단되었습니다.")),
          );
          response.on("end", () =>
            resolve({
              status: response.statusCode ?? 0,
              location: response.headers.location,
              contentType: type,
              bytes: Buffer.concat(chunks),
            }),
          );
        },
      );
      request.on("error", reject);
      request.end();
    });
    if ([301, 302, 303, 307, 308].includes(result.status)) {
      if (!result.location || hop === 3)
        throw new AccessError(502, "웹 주소 이동이 반복됩니다.");
      url = publicDocumentUrl(new URL(result.location, url).href);
      continue;
    }
    if (result.status !== 200)
      throw new AccessError(
        502,
        `원문을 받지 못했습니다. HTTP ${result.status}`,
      );
    const fallback = Object.entries(SOURCE_FORMATS).find(
      ([, mime]) => mime === result.contentType,
    )?.[0];
    let basename: string;
    try {
      basename = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
    } catch {
      basename = "";
    }
    const extension = basename.split(".").at(-1)?.toLowerCase() ?? "";
    const supported =
      !!SOURCE_FORMATS[extension] &&
      (result.contentType === "application/octet-stream" ||
        SOURCE_FORMATS[extension] === result.contentType ||
        (result.contentType === "text/plain" &&
          ["md", "markdown", "txt", "org"].includes(extension)));
    if (!fallback && !supported)
      throw new AccessError(415, "지원하는 문서 형식의 웹 응답이 아닙니다.");
    if (!result.bytes.length) throw new AccessError(502, "빈 원문입니다.");
    return {
      ...result,
      url: url.href,
      filename: supported ? basename : `수집원문.${fallback}`,
    };
  }
  throw new AccessError(502, "자료 수집을 완료하지 못했습니다.");
}
