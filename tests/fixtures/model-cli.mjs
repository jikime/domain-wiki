import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
const mode = args[args.indexOf("--model") + 1];
const claude = args.includes("--output-format");
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = Buffer.concat(chunks).toString("utf8");
const event = (data) => process.stdout.write(`${JSON.stringify(data)}\n`);
const answer = (text) =>
  claude
    ? event({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text },
        },
      })
    : event({
        type: "item.completed",
        item: { id: "answer", type: "agent_message", text },
      });
const done = (text) =>
  claude
    ? event({
        type: "result",
        subtype: "success",
        result: text,
        usage: { input_tokens: 10, output_tokens: 2 },
      })
    : event({
        type: "turn.completed",
        usage: { input_tokens: 10, output_tokens: 2 },
      });

if (mode === "auth-error") {
  process.stderr.write(
    "Unauthenticated 401: private-credential-never-return-this",
  );
  process.exit(1);
}
if (mode === "oversize") {
  process.stdout.write("x".repeat(5 * 1024 * 1024));
} else if (mode === "hang") {
  process.on("SIGTERM", () => {});
  const descendant = spawn(
    process.execPath,
    ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
    { stdio: "inherit" },
  );
  answer(JSON.stringify({ pid: process.pid, descendant: descendant.pid }));
  setInterval(() => {}, 1000);
} else if (mode === "inspect") {
  const imagePaths = args.flatMap((arg, i) =>
    arg === "--image" ? [args[i + 1]] : [],
  );
  const text = JSON.stringify({
    input,
    args,
    cwd: process.cwd(),
    imageSizes: await Promise.all(
      imagePaths.map(async (path) => (await readFile(path)).length),
    ),
    applicationSecretInherited:
      !!process.env.DATABASE_URL ||
      !!process.env.BETTER_AUTH_SECRET ||
      !!process.env.AI_API_KEY,
    nodeOptionsInherited: !!process.env.NODE_OPTIONS,
  });
  answer(text);
  done(text);
} else if (mode === "split-utf8") {
  const text = "한글 응답";
  const packet = Buffer.from(
    `${JSON.stringify(
      claude
        ? {
            type: "stream_event",
            event: {
              type: "content_block_delta",
              delta: { type: "text_delta", text },
            },
          }
        : {
            type: "item.completed",
            item: { id: "answer", type: "agent_message", text },
          },
    )}\n`,
  );
  const split = packet.indexOf(Buffer.from("한")) + 1;
  process.stdout.write(packet.subarray(0, split));
  await new Promise((resolve) => setTimeout(resolve, 20));
  process.stdout.write(packet.subarray(split));
  done(text);
} else {
  answer("연결 확인");
  if (mode !== "no-result") done("연결 확인");
  if (mode === "exit-failure") process.exitCode = 3;
}
