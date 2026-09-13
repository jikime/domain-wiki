"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  type ModelTransport,
  modelTransportLabels,
} from "@/lib/model-transport";
export function ModelConnection({
  workspaceId,
  model,
  embeddingModel,
  knowledgeModel,
  chatTransport,
  knowledgeTransport,
  chatContextChars,
  knowledgeContextChars,
}: {
  workspaceId: string;
  model: string | null;
  embeddingModel: string | null;
  knowledgeModel: string | null;
  chatTransport: ModelTransport;
  knowledgeTransport: ModelTransport;
  chatContextChars: number;
  knowledgeContextChars: number;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  return (
    <>
      <dl className="model-summary">
        <dt>대화 연결</dt>
        <dd>{modelTransportLabels[chatTransport]}</dd>
        <dt>대화 모델</dt>
        <dd>{model ?? "설정 없음"}</dd>
        <dt>대화 입력 상한</dt>
        <dd>{chatContextChars.toLocaleString("ko-KR")}자</dd>
        <dt>지식 생성 연결</dt>
        <dd>{modelTransportLabels[knowledgeTransport]}</dd>
        <dt>지식 생성 모델</dt>
        <dd>{knowledgeModel ?? "설정 없음"}</dd>
        <dt>지식 생성 입력 상한</dt>
        <dd>{knowledgeContextChars.toLocaleString("ko-KR")}자</dd>
        <dt>임베딩 모델</dt>
        <dd>{embeddingModel ?? "설정 없음 · 키워드 검색 사용"}</dd>
      </dl>
      <p className="field-help">
        공통 모델 설정은 용도별 설정의 기본값입니다. 대화는 AI_CHAT_*, 지식
        생성은 AI_KNOWLEDGE_*, 임베딩은 AI_EMBEDDING_*으로 구분할 수 있습니다.
        입력 상한은 서버가 허용하는 문자 수이며 모델의 토큰 한도와는 다릅니다.
        설정을 바꾸면 웹 서버와 작업자를 함께 재시작하세요. 연결 방식은
        AI_TRANSPORT 또는 용도별 AI_CHAT_TRANSPORT·AI_KNOWLEDGE_TRANSPORT로
        API·Claude Code CLI·Codex CLI를 선택합니다.
      </p>
      {(chatTransport !== "api" || knowledgeTransport !== "api") && (
        <p className="field-help">
          CLI는 웹 서버·작업자의 운영 계정에서 실행됩니다. 아래 연결 확인은 실제
          모델 응답으로 설치·인증 상태를 점검하며 사용량이 발생할 수 있습니다.
        </p>
      )}
      <Button
        variant="outline"
        disabled={busy || !(model || knowledgeModel || embeddingModel)}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const response = await fetch(
              `/api/workspaces/${workspaceId}/model`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "test" }),
              },
            );
            const data = await response.json();
            if (!response.ok) throw new Error(data.error);
            setResult(
              `대화: ${data.chat} / 지식 생성: ${data.knowledge} / 임베딩: ${data.embedding}. ${data.notice}`,
            );
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "연결을 확인하지 못했습니다.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "연결 확인 중…" : "모델 연결 확인"}
      </Button>
      {result && <output className="notice-box">{result}</output>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </>
  );
}
