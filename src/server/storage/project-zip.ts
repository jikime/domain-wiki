import "server-only";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { crc32 } from "node:zlib";
import { openPromise } from "yauzl";
import { ZipFile } from "yazl";
import {
  archivePath,
  MAX_ARCHIVE_BYTES,
  MAX_ARCHIVE_ENTRIES,
} from "@/lib/project-archive";
import { AccessError } from "@/server/access";
import { originals } from "./originals";

export type UnpackedFile = {
  path: string;
  temporary: string;
  byteSize: number;
  sha256: string;
  directory: boolean;
};
export async function receiveProjectZip(request: Request) {
  if (
    request.headers.get("content-type")?.split(";")[0] !== "application/zip" ||
    !request.body
  )
    throw new AccessError(415, "프로젝트 ZIP 파일을 선택해 주세요.");
  const root = await mkdtemp(join(tmpdir(), "domain-wiki-archive-"));
  const cleanup = () => rm(root, { recursive: true, force: true });
  try {
    let uploaded = 0;
    const incoming = new Transform({
      transform(chunk, _encoding, callback) {
        uploaded += chunk.length;
        // Allow central-directory overhead as well as the original 4 GiB data limit.
        callback(
          uploaded > MAX_ARCHIVE_BYTES + 128 * 1024 * 1024
            ? new AccessError(
                413,
                "ZIP 업로드 크기가 4 GiB와 메타데이터 허용량을 넘었습니다.",
              )
            : null,
          chunk,
        );
      },
    });
    await pipeline(
      Readable.fromWeb(
        request.body as import("node:stream/web").ReadableStream,
      ),
      incoming,
      createWriteStream(join(root, "project.zip"), {
        flags: "wx",
        mode: 0o600,
      }),
      { signal: request.signal },
    );
    const zip = await openPromise(join(root, "project.zip"), {
      lazyEntries: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
    const files: UnpackedFile[] = [],
      names = new Set<string>();
    let expanded = 0,
      actual = 0;
    try {
      if (zip.entryCount > MAX_ARCHIVE_ENTRIES)
        throw new AccessError(
          413,
          "ZIP 항목 수가 원본의 100,000개 제한을 넘었습니다.",
        );
      for await (const entry of zip.eachEntry()) {
        const isDirectory = entry.fileName.endsWith("/");
        const path = archivePath(
          isDirectory ? entry.fileName.slice(0, -1) : entry.fileName,
        );
        const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (
          !path ||
          names.has(path) ||
          ![0, 0o100000, 0o040000].includes(mode) ||
          (mode === 0o040000 && !isDirectory) ||
          entry.isEncrypted()
        )
          throw new AccessError(
            400,
            "ZIP에 안전하지 않은 경로·중복 경로·링크·암호화 항목이 있습니다.",
          );
        names.add(path);
        expanded += entry.uncompressedSize;
        if (expanded > MAX_ARCHIVE_BYTES)
          throw new AccessError(
            413,
            "ZIP을 푼 전체 크기가 원본의 4 GiB 제한을 넘었습니다.",
          );
        if (isDirectory) {
          if (entry.uncompressedSize !== 0)
            throw new AccessError(
              400,
              "ZIP 폴더에 파일 데이터가 들어 있습니다.",
            );
          const temporary = join(root, `entry-${files.length}`);
          await writeFile(temporary, "", { flag: "wx", mode: 0o600 });
          files.push({
            path,
            temporary,
            byteSize: 0,
            sha256: createHash("sha256").digest("hex"),
            directory: true,
          });
          continue;
        }
        const temporary = join(root, `entry-${files.length}`),
          hash = createHash("sha256");
        let byteSize = 0,
          crc = 0;
        const bounded = new Transform({
          transform(chunk, _encoding, callback) {
            actual += chunk.length;
            byteSize += chunk.length;
            hash.update(chunk);
            crc = crc32(chunk, crc);
            callback(
              actual > MAX_ARCHIVE_BYTES
                ? new AccessError(
                    413,
                    "ZIP을 푼 전체 크기가 4 GiB를 넘었습니다.",
                  )
                : null,
              chunk,
            );
          },
        });
        await pipeline(
          await zip.openReadStreamPromise(entry),
          bounded,
          createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
          { signal: request.signal },
        );
        if (crc !== entry.crc32)
          throw new AccessError(400, "ZIP 파일의 CRC 검증에 실패했습니다.");
        files.push({
          path,
          temporary,
          byteSize,
          sha256: hash.digest("hex"),
          directory: false,
        });
      }
    } finally {
      zip.close();
    }
    // Reject file/directory conflicts even though user paths are never extracted to disk.
    const fileNames = new Set(
      files.filter((f) => !f.directory).map((f) => f.path),
    );
    for (const name of names) {
      const segments = name.split("/");
      while (segments.length > 1) {
        segments.pop();
        if (fileNames.has(segments.join("/")))
          throw new AccessError(400, "ZIP 파일·폴더 경로가 겹칩니다.");
      }
    }
    if (!fileNames.has("wiki/index.md"))
      throw new AccessError(
        400,
        "LLM Wiki 프로젝트가 아닙니다. wiki/index.md가 필요합니다.",
      );
    return { files, cleanup };
  } catch (error) {
    await cleanup();
    if (error instanceof AccessError) throw error;
    if (request.signal.aborted)
      throw new AccessError(400, "ZIP 업로드가 취소되었습니다.");
    if ((error as NodeJS.ErrnoException).code === "ENOSPC")
      throw new AccessError(507, "서버 저장 공간이 부족합니다.");
    throw new AccessError(
      400,
      "ZIP 파일이 손상되었거나 지원하지 않는 압축 형식입니다.",
    );
  }
}

export type ExportFile =
  | { path: string; directory: true }
  | { path: string; storageKey: string; byteSize: number }
  | { path: string; loadText: () => Promise<string>; byteSize: number }
  | { path: string; text: string };
export function projectZipResponse(files: ExportFile[], name: string) {
  const names = new Set<string>();
  let expanded = 0;
  for (const file of files) {
    if (!archivePath(file.path) || names.has(file.path))
      throw new AccessError(409, "내보낼 파일 경로가 겹칩니다.");
    names.add(file.path);
    expanded +=
      "text" in file
        ? Buffer.byteLength(file.text)
        : "directory" in file
          ? 0
          : file.byteSize;
  }
  if (files.length > MAX_ARCHIVE_ENTRIES || expanded > MAX_ARCHIVE_BYTES)
    throw new AccessError(
      413,
      "원본 ZIP의 100,000개 항목·4 GiB 제한을 넘었습니다.",
    );
  const zip = new ZipFile();
  const output = zip.outputStream as Readable;
  zip.on("error", (error: Error) => output.destroy(error));
  for (const file of files) {
    if ("directory" in file) zip.addEmptyDirectory(file.path);
    else if ("text" in file) zip.addBuffer(Buffer.from(file.text), file.path);
    else if ("loadText" in file)
      zip.addReadStreamLazy(file.path, { size: file.byteSize }, (callback) => {
        file.loadText().then(
          (text) => callback(null, Readable.from([Buffer.from(text)])),
          (error) => {
            output.destroy(
              error instanceof Error ? error : new Error("위키 파일 읽기 실패"),
            );
          },
        );
      });
    else
      zip.addReadStreamLazy(file.path, { size: file.byteSize }, (callback) =>
        callback(null, originals.stream(file.storageKey)),
      );
  }
  zip.end();
  return new Response(Readable.toWeb(output) as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": "application/zip",
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="wiki-project.zip"; filename*=UTF-8''${encodeURIComponent(`${name}.zip`)}`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const unpackedStream = (file: UnpackedFile) =>
  createReadStream(file.temporary);
