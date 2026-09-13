import { AsyncLocalStorage } from "node:async_hooks";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { publicAddress } from "../official/fetch";
export const mineruFiles = new AsyncLocalStorage<{
  files: Map<string, Uint8Array>;
  endpoint?: string;
}>();
const state = () => {
  const s = mineruFiles.getStore();
  if (!s) throw new Error("MinerU 작업 범위가 없습니다.");
  return s;
};
export async function createDirectory(_path: string) {}
export async function getFileSize(path: string) {
  return state().files.get(path)?.length ?? 0;
}
export async function readFileAsBase64(path: string) {
  const bytes = state().files.get(path);
  if (!bytes) throw new Error("작업 원문이 없습니다.");
  return { base64: Buffer.from(bytes).toString("base64") };
}
export async function writeFileBase64(path: string, base64: string) {
  if (
    !path.startsWith("/job/wiki/media/") ||
    path.split("/").some((p) => p === "..")
  )
    throw new Error("이미지 저장 경로를 확인해 주세요.");
  const files = state().files,
    bytes = Buffer.from(base64, "base64");
  if (
    files.size > 500 ||
    [...files.values()].reduce((sum, b) => sum + b.length, bytes.length) >
      200 * 1024 * 1024
  )
    throw new Error("MinerU 결과 크기를 확인해 주세요.");
  files.set(path, bytes);
}
// Signed upload/download URLs supplied by the cloud must resolve to public HTTPS
// addresses. Pin the socket to the checked address and never follow redirects.
async function publicTransfer(
  raw: string,
  init: RequestInit,
): Promise<Response> {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.port || url.username || url.password)
    throw new Error("MinerU 결과 주소를 확인해 주세요.");
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new Error("MinerU 결과 주소를 확인해 주세요.");
  const address = addresses.find((a) => a.family === 4) ?? addresses[0];
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        hostname: address.address,
        servername: url.hostname,
        path: url.pathname + url.search,
        method: init.method ?? "GET",
        agent: false,
        headers: { Host: url.host, "Accept-Encoding": "identity" },
        signal: init.signal ?? undefined,
      },
      (res) => {
        const parts: Buffer[] = [];
        let size = 0;
        if (
          res.headers["content-encoding"] &&
          res.headers["content-encoding"] !== "identity"
        ) {
          res.destroy();
          reject(new Error("압축 전송 결과를 확인해 주세요."));
          return;
        }
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 200 * 1024 * 1024)
            res.destroy(new Error("MinerU 결과가 너무 큽니다."));
          else parts.push(chunk);
        });
        res.on("error", reject);
        res.on("aborted", () =>
          reject(new Error("MinerU 결과 전송이 중단되었습니다.")),
        );
        res.on("end", () =>
          resolve(
            new Response(
              res.statusCode === 204
                ? null
                : new Uint8Array(Buffer.concat(parts)),
              {
                status: res.statusCode ?? 502,
                headers: {
                  "Content-Type": String(
                    res.headers["content-type"] ?? "application/octet-stream",
                  ),
                },
              },
            ),
          ),
        );
      },
    );
    req.on("error", reject);
    if (init.body instanceof ArrayBuffer) req.write(Buffer.from(init.body));
    else if (ArrayBuffer.isView(init.body))
      req.write(
        Buffer.from(
          init.body.buffer,
          init.body.byteOffset,
          init.body.byteLength,
        ),
      );
    else if (init.body) {
      req.destroy();
      reject(new Error("지원하지 않는 MinerU 업로드 형식입니다."));
      return;
    }
    req.end();
  });
}
export async function getHttpFetch() {
  return async (
    raw: string | URL | Request,
    init: RequestInit = {},
  ): Promise<Response> => {
    const url = new URL(
      typeof raw === "string" ? raw : raw instanceof URL ? raw.href : raw.url,
    );
    const endpoint = state().endpoint
      ? new URL(state().endpoint as string)
      : null;
    const configured =
      endpoint &&
      url.origin === endpoint.origin &&
      (url.pathname === endpoint.pathname.replace(/\/$/, "") ||
        url.pathname.startsWith(`${endpoint.pathname.replace(/\/$/, "")}/`));
    const cloud =
      url.origin === "https://mineru.net" &&
      url.pathname.startsWith("/api/v4/");
    if (configured || cloud)
      return fetch(url, {
        ...init,
        redirect: "manual",
        signal: AbortSignal.any([
          ...(init.signal ? [init.signal] : []),
          AbortSignal.timeout(60_000),
        ]),
      });
    if (new Headers(init.headers).has("authorization"))
      throw new Error("MinerU 인증 정보의 대상 주소를 확인해 주세요.");
    return publicTransfer(url.href, {
      ...init,
      signal: AbortSignal.any([
        ...(init.signal ? [init.signal] : []),
        AbortSignal.timeout(60_000),
      ]),
    });
  };
}
