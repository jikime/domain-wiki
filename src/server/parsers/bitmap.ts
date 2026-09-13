import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
export async function decodeBitmap(bytes: Uint8Array): Promise<Uint8Array> {
  const isBmp = bytes[0] === 0x42 && bytes[1] === 0x4d;
  const isIco =
    bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0;
  if (!isBmp && !isIco) return bytes;
  const directory = await mkdtemp(join(tmpdir(), "wiki-bitmap-"));
  try {
    const path = join(directory, isBmp ? "image.bmp" : "image.ico");
    await writeFile(path, bytes, { mode: 0o600 });
    const { stdout } = await execute(
      process.env.DOCUMENT_EXTRACTOR_BIN ||
        resolve("native/document-extract/target/release/wiki-document-extract"),
      [path],
      {
        encoding: "buffer",
        timeout: 40_000,
        maxBuffer: 100 * 1024 * 1024,
      },
    );
    return stdout;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
