import "server-only";
import { recordInput } from "@/lib/proposals";
import { requireWorkspace } from "@/server/access";
import { getDb } from "@/server/db";
import { requireWriter } from "./content-access";
import { uploadSource } from "./sources";
import { checkEvidence } from "./wiki";

export async function saveRecord(
  request: Request,
  w: string,
  input: unknown,
  sourceId?: string,
) {
  requireWriter(await requireWorkspace(request.headers, w));
  const { title, domainId, projectId, ...testimony } = recordInput.parse(input);
  await checkEvidence(getDb(), w, domainId, projectId, testimony.chunkIds);
  const text = `# ${title}\n\n자료 유형: 작성자 진술 (공식 규정과 구분)\n\n## 작성 당시 메모\n${testimony.rawNote || "별도 메모 없음"}\n\n## 상황\n${testimony.situation}\n\n## 판단과 이유\n${testimony.reasoning}\n\n## 결과\n${testimony.result}\n\n## 추가 확인할 내용\n${testimony.followUp || "없음"}\n\n## 연결한 원문 문단\n${testimony.chunkIds.join("\n") || "별도 문서 없음"}\n`;
  const form = new FormData();
  form.set("title", title);
  form.set("domainId", domainId);
  form.set("projectId", projectId ?? "");
  form.set("category", "testimony");
  form.set("file", new File([text], "실무기록.md", { type: "text/markdown" }));
  const headers = new Headers(request.headers);
  headers.delete("content-type");
  headers.delete("content-length");
  return uploadSource(
    new Request(request.url, { method: "POST", headers, body: form }),
    w,
    sourceId,
    testimony,
  );
}
