import "server-only";
import { ZodError } from "zod";
import { AccessError } from "./access";
import { getServerEnv } from "./env";

export function requireSameOrigin(request: Request) {
  if (
    request.headers.get("origin") !==
    new URL(getServerEnv().BETTER_AUTH_URL).origin
  )
    throw new AccessError(403, "요청 출처를 확인할 수 없습니다.");
}
export async function readBody(request: Request, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new AccessError(400, "입력 내용을 확인하세요.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new AccessError(413, "입력 내용이 너무 큽니다.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
export async function readJson(request: Request, limit = 64 * 1024) {
  requireSameOrigin(request);
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
    throw new AccessError(415, "JSON 요청이 필요합니다.");
  const body = await readBody(request, limit);
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new AccessError(400, "올바른 JSON이 아닙니다.");
  }
}
export async function apiResult(action: () => Promise<unknown>, status = 200) {
  try {
    const result = await action();
    if (result instanceof Response) return result;
    return Response.json(result, {
      status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    let code = 500;
    let message = "요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.";
    if (error instanceof AccessError) {
      code = error.status;
      message = error.message;
    } else if (error instanceof ZodError) {
      code = 400;
      message = "입력 형식이나 길이를 확인하세요.";
    } else if (error && typeof error === "object") {
      const cause = "cause" in error ? error.cause : error;
      if (
        cause &&
        typeof cause === "object" &&
        "code" in cause &&
        cause.code === "23505"
      ) {
        code = 409;
        message = "같은 이름 또는 이메일이 이미 등록되어 있습니다.";
      }
    }
    if (code === 500) console.error("업무 API 처리 오류가 발생했습니다.");
    return Response.json(
      { error: message },
      { status: code, headers: { "Cache-Control": "no-store" } },
    );
  }
}
