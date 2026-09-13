import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { CliTransport, ModelInputMessage } from "@/lib/model-transport";
import { cliEnvironment, streamCliModel } from "./cli";

let directory: string;
let binary: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "wiki-cli-test-"));
  binary = join(directory, "mock-cli");
  const code = await readFile(
    new URL("../../../tests/fixtures/model-cli.mjs", import.meta.url),
    "utf8",
  );
  await writeFile(binary, `#!${process.execPath}\n${code}`, { mode: 0o700 });
  await chmod(binary, 0o700);
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

function run(
  transport: CliTransport,
  model: string,
  options: {
    signal?: AbortSignal;
    onToken?: (text: string) => Promise<void>;
    messages?: ModelInputMessage[];
    executable?: string;
  } = {},
) {
  return streamCliModel({
    transport,
    binary: options.executable ?? binary,
    model,
    messages: options.messages ?? [{ role: "user", content: "연결 점검" }],
    signal: options.signal ?? AbortSignal.timeout(5000),
    onToken: options.onToken ?? (async () => {}),
    maxConcurrent: 1,
  });
}

describe("실제 자식 프로세스 연결 (모의 CLI, 외부 호출 없음)", () => {
  it.each<CliTransport>([
    "claude-code",
    "codex-cli",
  ])("%s의 분할 UTF-8 출력과 종료를 처리한다", async (transport) => {
    const chunks: string[] = [];
    const result = await run(transport, "split-utf8", {
      onToken: async (text) => {
        chunks.push(text);
      },
    });
    expect(result).toEqual({
      text: "한글 응답",
      inputTokens: 10,
      outputTokens: 2,
    });
    expect(chunks.join("")).toBe(result.text);
  });

  it("모델명·질문은 셸로 해석하지 않고 임시 작업 디렉터리를 삭제한다", async () => {
    vi.stubEnv("DATABASE_URL", "private-db-value");
    vi.stubEnv("AI_API_KEY", "private-app-key");
    vi.stubEnv("NODE_OPTIONS", "--no-warnings");
    const response = await run("claude-code", "inspect", {
      messages: [{ role: "user", content: "$(echo DO_NOT_RUN); `pwd`" }],
    });
    const result = JSON.parse(response.text);
    expect(result.input).toContain("$(echo DO_NOT_RUN)");
    expect(result.applicationSecretInherited).toBe(false);
    expect(result.nodeOptionsInherited).toBe(false);
    expect(result.args).toContain("--safe-mode");
    expect(result.args[result.args.indexOf("--tools") + 1]).toBe("");
    expect(result.cwd).not.toBe(process.cwd());
    await expect(stat(result.cwd)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      run("codex-cli", "name; $(echo DO_NOT_RUN)"),
    ).resolves.toMatchObject({ text: "연결 확인" });
  });

  it("Codex 이미지를 임시 파일로 전달하고 도구·사용자 설정을 제한한다", async () => {
    const response = await run("codex-cli", "inspect", {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "이미지" },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${Buffer.from("image").toString("base64")}`,
              },
            },
          ],
        },
      ],
    });
    const result = JSON.parse(response.text);
    expect(result.imageSizes).toEqual([5]);
    expect(result.args).toContain("--ignore-user-config");
    expect(result.args).toContain("features.shell_tool=false");
    expect(result.args).toContain('web_search="disabled"');
    const image = result.args[result.args.indexOf("--image") + 1];
    await expect(stat(image)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("누락된 실행 파일을 사용자에게 안전한 설치 오류로 알려준다", async () => {
    await expect(
      run("codex-cli", "success", { executable: join(directory, "missing") }),
    ).rejects.toThrow("실행 파일");
  });

  it("인증 실패의 원문 stderr를 사용자에게 노출하지 않는다", async () => {
    const error = await run("claude-code", "auth-error").catch(
      (error: Error) => error,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("인증");
    expect((error as Error).message).not.toContain("private-credential");
  });

  it.each([
    "no-result",
    "exit-failure",
    "oversize",
  ])("%s를 완성된 답변으로 저장하지 않는다", async (mode) => {
    await expect(run("claude-code", mode)).rejects.toThrow();
  });

  it("중지하면 SIGTERM을 무시하는 CLI와 자식 프로세스도 종료한다", async () => {
    const abort = new AbortController();
    let pids: { pid: number; descendant: number } | undefined;
    const reason = new Error("이용자 중지");
    await expect(
      run("claude-code", "hang", {
        signal: abort.signal,
        onToken: async (text) => {
          pids = JSON.parse(text);
          abort.abort(reason);
        },
      }),
    ).rejects.toBe(reason);
    if (!pids) throw new Error("모의 프로세스가 시작되지 않았습니다.");
    const stopped = pids;
    expect(() => process.kill(stopped.pid, 0)).toThrow();
    // A killed child can briefly remain a zombie until its new parent reaps it.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(() => process.kill(stopped.descendant, 0)).toThrow();
  });

  it("대기 중 취소와 콜백 오류 이후에도 다음 요청의 실행 슬롯을 반환한다", async () => {
    const abort = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const first = run("claude-code", "hang", {
      signal: abort.signal,
      onToken: async () => {
        started();
      },
    });
    first.catch(() => {});
    await ready;
    await expect(
      run("codex-cli", "success", { signal: AbortSignal.timeout(30) }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
    abort.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      run("codex-cli", "success", {
        onToken: async () => {
          throw new Error("권한 취소");
        },
      }),
    ).rejects.toThrow("권한 취소");
    await expect(run("claude-code", "success")).resolves.toMatchObject({
      text: "연결 확인",
    });
  });
});

it("선택한 CLI 인증 정보만 전달하고 다른 제공사 키·애플리케이션 비밀을 제외한다", () => {
  const source = {
    PATH: "/bin",
    ANTHROPIC_API_KEY: "test-anthropic",
    OPENAI_API_KEY: "test-openai",
    CODEX_API_KEY: "test-codex-explicit",
    AI_API_KEY: "test-app",
    DATABASE_URL: "test-db",
    NODE_OPTIONS: "--inspect",
  };
  expect(cliEnvironment("claude-code", source)).toEqual({
    NODE_ENV: "production",
    NO_COLOR: "1",
    PATH: "/bin",
    ANTHROPIC_API_KEY: "test-anthropic",
  });
  expect(cliEnvironment("codex-cli", source)).toEqual({
    NODE_ENV: "production",
    NO_COLOR: "1",
    PATH: "/bin",
    CODEX_API_KEY: "test-codex-explicit",
  });
});
