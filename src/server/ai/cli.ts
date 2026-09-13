import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import {
  type CliTransport,
  type ModelInputMessage,
  modelTransportLabels,
} from "@/lib/model-transport";
import { AccessError } from "@/server/errors";
import {
  buildCliConversation,
  CliResponseParser,
  claudeArgs,
  claudeInput,
  cliFailure,
  codexArgs,
} from "./cli-protocol";

const MAX_STDOUT_BYTES = 4 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const MAX_LINE_BYTES = 1024 * 1024;
let active = 0;
const waiting: (() => void)[] = [];

async function acquire(limit: number, signal: AbortSignal) {
  signal.throwIfAborted();
  while (active >= limit) {
    await new Promise<void>((resolveWait, rejectWait) => {
      const cleanup = () => {
        signal.removeEventListener("abort", abort);
        const index = waiting.indexOf(wake);
        if (index >= 0) waiting.splice(index, 1);
      };
      const wake = () => {
        cleanup();
        resolveWait();
      };
      const abort = () => {
        cleanup();
        rejectWait(signal.reason);
      };
      waiting.push(wake);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
    signal.throwIfAborted();
  }
  active++;
  return () => {
    active--;
    // Each waiter rechecks the current capacity before claiming a slot.
    for (const wake of [...waiting]) wake();
  };
}

export function cliEnvironment(
  transport: CliTransport,
  source: Record<string, string | undefined> = process.env,
) {
  const keys = [
    "PATH",
    "HOME",
    "USERPROFILE",
    "SYSTEMROOT",
    "WINDIR",
    "USER",
    "LOGNAME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
    "NODE_EXTRA_CA_CERTS",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    ...(transport === "claude-code"
      ? [
          "CLAUDE_CONFIG_DIR",
          "CLAUDE_CODE_OAUTH_TOKEN",
          "ANTHROPIC_API_KEY",
          "ANTHROPIC_AUTH_TOKEN",
          "ANTHROPIC_BASE_URL",
        ]
      : ["CODEX_HOME", "CODEX_API_KEY"]),
  ];
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    NO_COLOR: "1",
  };
  for (const key of keys) if (source[key]) environment[key] = source[key];
  // Never inherit database/application secrets, NODE_OPTIONS or the parent
  // agent's session state. The application's OPENAI_* settings must not change
  // Codex's saved login; CODEX_API_KEY explicitly opts into CLI API-key auth.
  return environment;
}

export async function streamCliModel(input: {
  transport: CliTransport;
  binary: string;
  model: string;
  messages: ModelInputMessage[];
  onToken: (token: string) => Promise<void>;
  signal: AbortSignal;
  maxConcurrent: number;
}) {
  const release = await acquire(input.maxConcurrent, input.signal);
  let directory: string | undefined;
  try {
    input.signal.throwIfAborted();
    directory = await mkdtemp(join(tmpdir(), "wiki-model-"));
    let stdin: string;
    let args: string[];
    if (input.transport === "claude-code") {
      stdin = claudeInput(input.messages);
      args = claudeArgs(input.model);
    } else {
      const { prompt, images } = buildCliConversation(input.messages);
      const paths: string[] = [];
      for (const [index, image] of images.entries()) {
        input.signal.throwIfAborted();
        const path = join(
          directory,
          `image-${index + 1}.${image.mediaType.split("/")[1]}`,
        );
        await writeFile(path, Buffer.from(image.data, "base64"), {
          mode: 0o600,
        });
        paths.push(path);
      }
      stdin = prompt;
      args = codexArgs(input.model, paths);
    }
    input.signal.throwIfAborted();
    // Resolve configured relative paths before switching to the empty workdir.
    const binary =
      !isAbsolute(input.binary) && /[\\/]/.test(input.binary)
        ? resolve(input.binary)
        : input.binary;
    return await runProcess({ ...input, binary, directory, args, stdin });
  } finally {
    try {
      if (directory) await rm(directory, { recursive: true, force: true });
    } finally {
      release();
    }
  }
}

async function runProcess(input: {
  transport: CliTransport;
  binary: string;
  directory: string;
  args: string[];
  stdin: string;
  signal: AbortSignal;
  onToken: (token: string) => Promise<void>;
}) {
  const child = spawn(input.binary, input.args, {
    cwd: input.directory,
    env: cliEnvironment(input.transport),
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  let closed = false;
  let stderr = "";
  let stderrBytes = 0;
  let processError: Error | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const completion = new Promise<number | null>((done) => {
    child.on("error", (error) => {
      processError = error;
    });
    child.on("close", (code) => {
      closed = true;
      done(code);
    });
  });
  const kill = (signal: NodeJS.Signals) => {
    if (!child.pid) return;
    try {
      if (process.platform === "win32") child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch {
      /* Process group has already exited. */
    }
  };
  const terminate = () => {
    kill("SIGTERM");
    if (!killTimer) {
      killTimer = setTimeout(() => kill("SIGKILL"), 1000);
      killTimer.unref();
    }
  };
  input.signal.addEventListener("abort", terminate, { once: true });
  const decoder = new StringDecoder("utf8");
  child.stderr.on("data", (chunk: Buffer) => {
    stderrBytes += chunk.length;
    if (stderrBytes <= MAX_STDERR_BYTES) stderr += chunk.toString("utf8");
    else {
      processError = new Error("CLI stderr size limit");
      terminate();
    }
  });
  child.stdin.on("error", (error: NodeJS.ErrnoException) => {
    // An early CLI exit may close stdin before it accepts the whole prompt.
    if (error.code !== "EPIPE") {
      processError = error;
      terminate();
    }
  });
  let buffer = "";
  let stdoutBytes = 0;
  const parser = new CliResponseParser(input.transport);
  const consume = async (line: string) => {
    input.signal.throwIfAborted();
    if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES)
      throw new AccessError(502, "CLI 응답 행 크기 제한을 넘었습니다.");
    const text = parser.consume(line);
    if (text) await input.onToken(text);
  };
  try {
    input.signal.throwIfAborted();
    child.stdin.end(input.stdin, "utf8");
    for await (const chunk of child.stdout) {
      input.signal.throwIfAborted();
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_STDOUT_BYTES)
        throw new AccessError(502, "CLI 응답 크기 제한을 넘었습니다.");
      buffer += decoder.write(chunk);
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      if (Buffer.byteLength(buffer, "utf8") > MAX_LINE_BYTES)
        throw new AccessError(502, "CLI 응답 행 크기 제한을 넘었습니다.");
      for (const line of lines) if (line.trim()) await consume(line);
    }
    buffer += decoder.end();
    if (buffer.trim()) await consume(buffer);
    const code = await completion;
    input.signal.throwIfAborted();
    if (processError) {
      if ((processError as NodeJS.ErrnoException).code === "ENOENT")
        throw new AccessError(
          503,
          `${modelTransportLabels[input.transport]} 실행 파일을 찾을 수 없습니다. 서버 설치 경로를 확인하세요.`,
        );
      if ((processError as NodeJS.ErrnoException).code === "EACCES")
        throw new AccessError(
          503,
          `${modelTransportLabels[input.transport]} 실행 권한을 확인하세요.`,
        );
      throw cliFailure(input.transport, stderr);
    }
    if (code !== 0) throw cliFailure(input.transport, stderr);
    return parser.finish();
  } finally {
    input.signal.removeEventListener("abort", terminate);
    if (!closed) {
      terminate();
      await completion;
    }
    // Also reap any descendants that outlived the CLI's main process.
    kill("SIGKILL");
    if (killTimer) clearTimeout(killTimer);
  }
}
