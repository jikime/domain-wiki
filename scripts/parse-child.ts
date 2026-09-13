import { ParseFailure, parseDocument } from "../src/server/parsers/document";
import {
  attachFolderImages,
  type FolderImageInput,
} from "../src/server/parsers/folder-markdown";

// Large JSON results can still be buffered when send returns. Keep IPC open until flushed.
function send(message: unknown) {
  return new Promise<void>((resolve) => {
    if (!process.send) return resolve();
    process.send(message, () => resolve());
  });
}
process.once(
  "message",
  async (message: {
    bytes: string;
    mimeType: string;
    folderImages?: FolderImageInput[];
  }) => {
    try {
      const result = await parseDocument(
        Buffer.from(message.bytes, "base64"),
        message.mimeType,
      );
      if (message.mimeType === "text/markdown" && message.folderImages?.length)
        await attachFolderImages(
          result,
          Buffer.from(message.bytes, "base64"),
          message.folderImages,
        );
      await send({ result });
    } catch (error) {
      await send({
        error:
          error instanceof ParseFailure
            ? error.message
            : "문서 처리 중 오류가 발생했습니다.",
      });
    } finally {
      if (process.connected) process.disconnect();
    }
  },
);
