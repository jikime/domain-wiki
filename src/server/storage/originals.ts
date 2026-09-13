import "server-only";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getServerEnv } from "@/server/env";

export interface OriginalStorage {
  put(key: string, data: Uint8Array): Promise<void>;
  read(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  putStream(key: string, data: Readable): Promise<void>;
  stream(key: string): Readable;
}
function storagePath(key: string) {
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(key))
    throw new Error("잘못된 저장 키");
  const root = resolve(getServerEnv().ORIGINALS_DIR);
  const publicDir = resolve("public");
  const relation = relative(publicDir, root);
  if (!relation || (!relation.startsWith("..") && !isAbsolute(relation)))
    throw new Error("원본 저장소는 public 밖에 있어야 합니다.");
  return resolve(root, key);
}
export const originals: OriginalStorage = {
  async putStream(key, data) {
    const path = storagePath(key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    try {
      await pipeline(
        data,
        createWriteStream(path, { flags: "wx", mode: 0o600 }),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST")
        await unlink(path).catch(() => {});
      throw error;
    }
  },
  stream(key) {
    return createReadStream(storagePath(key));
  },
  async put(key, data) {
    const path = storagePath(key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, data, { flag: "wx", mode: 0o600 });
  },
  async read(key) {
    return readFile(storagePath(key));
  },
  async remove(key) {
    await unlink(storagePath(key)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  },
};
