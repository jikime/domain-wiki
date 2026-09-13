import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { AccessError } from "../errors";

export type SiteBoundary = {
  origin: string;
  pathPrefix: string;
  active: boolean;
};
export function officialUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AccessError(400, "올바른 HTTPS 주소를 입력하세요.");
  }
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    raw.length > 2000 ||
    isIP(url.hostname.replace(/[[\]]/g, "")) ||
    !url.hostname.includes(".")
  )
    throw new AccessError(
      400,
      "공식 사이트의 HTTPS 도메인 주소가 필요합니다. IP·인증 정보·별도 포트는 사용할 수 없습니다.",
    );
  url.hostname = url.hostname.replace(/\.$/, "").toLowerCase();
  url.hash = "";
  try {
    const path = decodeURIComponent(url.pathname);
    if (
      path.includes("\\") ||
      /\p{Cc}/u.test(path) ||
      /%(?:2f|5c)/i.test(url.pathname)
    )
      throw new Error("path");
  } catch {
    throw new AccessError(400, "경로의 인코딩을 확인하세요.");
  }
  return url;
}
export function withinSite(url: URL, site: SiteBoundary) {
  const path = decodeURIComponent(url.pathname);
  const prefix = decodeURIComponent(site.pathPrefix).replace(/\/$/, "");
  return (
    site.active &&
    url.origin === site.origin &&
    (!prefix || path === prefix || path.startsWith(`${prefix}/`))
  );
}
export function publicAddress(address: string) {
  try {
    return ipaddr.parse(address).range() === "unicast";
  } catch {
    return false;
  }
}
export type FetchResult = {
  bytes: Buffer;
  url: string;
  contentType: string;
  filename: string;
};
type Transport = (
  url: URL,
  address: string,
  signal: AbortSignal,
) => Promise<{
  status: number;
  location?: string;
  contentType: string;
  bytes: Buffer;
}>;
const transport: Transport = (url, address, signal) =>
  new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        hostname: address,
        port: 443,
        servername: url.hostname,
        method: "GET",
        path: url.pathname + url.search,
        agent: false,
        signal,
        headers: {
          Host: url.host,
          "User-Agent": "DomainWikiCollector/1.0",
          Accept:
            "text/html,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation",
          "Accept-Encoding": "identity",
        },
      },
      (res) => {
        const contentType = (res.headers["content-type"] ?? "")
          .split(";")[0]
          .trim()
          .toLowerCase();
        if (
          res.headers["content-encoding"] &&
          res.headers["content-encoding"] !== "identity"
        ) {
          res.destroy();
          reject(
            new AccessError(
              415,
              "압축 전송 응답은 지원하지 않습니다. 원본 파일을 직접 등록해 주세요.",
            ),
          );
          return;
        }
        const maximum =
          contentType === "text/html" ? 2 * 1024 * 1024 : 10 * 1024 * 1024;
        if (Number(res.headers["content-length"]) > maximum) {
          res.destroy();
          reject(
            new AccessError(
              413,
              "웹 본문은 2MiB, 첨부 파일은 10MiB 이하만 수집합니다.",
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (data) => {
          size += data.length;
          if (size > maximum) {
            res.destroy(
              new AccessError(413, "자료 수집 크기 제한을 초과했습니다."),
            );
            return;
          }
          chunks.push(data);
        });
        res.on("error", reject);
        res.on("aborted", () =>
          reject(new AccessError(502, "수집 중 원격 연결이 종료되었습니다.")),
        );
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            location: res.headers.location,
            contentType,
            bytes: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
export async function fetchOfficial(
  raw: string,
  sites: SiteBoundary[],
  signal: AbortSignal,
  dependencies?: { lookup: typeof lookup; transport: Transport },
): Promise<FetchResult> {
  let url = officialUrl(raw);
  const deps = dependencies ?? { lookup, transport };
  const extensions: Record<string, string> = {
    "text/html": "html",
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      "docx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      "pptx",
  };
  for (let hop = 0; hop <= 3; hop++) {
    signal.throwIfAborted();
    if (!sites.some((s) => withinSite(url, s)))
      throw new AccessError(
        403,
        "관리자가 허용한 사이트·경로 밖의 주소입니다. 이동 주소와 첨부도 같은 검사를 적용합니다.",
      );
    const records = await Promise.race([
      deps.lookup(url.hostname, { all: true }),
      new Promise<never>((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      }),
    ]);
    if (
      !records.length ||
      records.some((record) => !publicAddress(record.address))
    )
      throw new AccessError(
        403,
        "내부망·예약 주소로 연결되는 사이트는 수집할 수 없습니다.",
      );
    const response = await deps.transport(url, records[0].address, signal);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.location || hop === 3)
        throw new AccessError(
          502,
          "사이트 이동이 반복되거나 이동 주소가 없습니다.",
        );
      url = officialUrl(new URL(response.location, url).href);
      continue;
    }
    if (response.status !== 200)
      throw new AccessError(
        502,
        `공식 사이트에서 정상 원문을 받지 못했습니다. HTTP ${response.status}`,
      );
    const extension = extensions[response.contentType];
    if (!extension)
      throw new AccessError(
        415,
        "HTML·PDF·DOCX·PPTX 응답만 등록할 수 있습니다. 로그인 화면이나 파일 형식을 확인하세요.",
      );
    if (!response.bytes.length)
      throw new AccessError(502, "빈 원문 응답입니다.");
    return {
      bytes: response.bytes,
      url: url.href,
      contentType: response.contentType,
      filename: `수집원문.${extension}`,
    };
  }
  throw new AccessError(502, "원문 수집을 완료하지 못했습니다.");
}
