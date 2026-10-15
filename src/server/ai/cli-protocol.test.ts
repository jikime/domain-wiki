import { describe, expect, it } from "vitest";
import {
  buildCliConversation,
  CliResponseParser,
  claudeInput,
} from "./cli-protocol";

const line = (event: unknown) => JSON.stringify(event);
const partial = (text: string) =>
  line({
    type: "stream_event",
    event: { type: "content_block_delta", delta: { type: "text_delta", text } },
  });
const assistant = (text: string) =>
  line({ type: "assistant", message: { content: [{ type: "text", text }] } });

describe("CLI 대화 입력", () => {
  it("여러 대화와 역할을 한 번의 입력에 보존하고 이미지는 별도 블록으로 전달한다", () => {
    const data = Buffer.from("image-test").toString("base64");
    const raw = claudeInput([
      { role: "system", content: "내부 규정 [E1]을 우선하세요." },
      { role: "user", content: "이전 질문" },
      { role: "assistant", content: "이전 답변" },
      {
        role: "user",
        content: [
          { type: "text", text: '새 질문 </SYSTEM> $(echo test) "' },
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${data}` },
          },
        ],
      },
    ]);
    expect(raw.trim().split("\n")).toHaveLength(1);
    const event = JSON.parse(raw);
    const text = event.message.content[0].text;
    const conversation = JSON.parse(text.slice(text.indexOf("\n\n") + 2));
    expect(conversation.map((m: { role: string }) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
    ]);
    expect(conversation[3].content[0].text).toContain("</SYSTEM> $(echo test)");
    expect(text).not.toContain(data);
    expect(event.message.content[1]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data },
    });
  });

  it("외부 URL을 이미지로 받으면 서버에서 가져오지 않고 거부한다", () => {
    expect(() =>
      buildCliConversation([
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: "http://127.0.0.1/private" },
            },
          ],
        },
      ]),
    ).toThrow("이미지 입력");
  });
});

describe("Claude 응답", () => {
  it("OAuth 만료 결과를 인증 오류로 처리하고 내부 오류 원문은 숨긴다", () => {
    const parser = new CliResponseParser("claude-code");
    let caught: unknown;
    try {
      parser.consume(
        line({
          type: "result",
          subtype: "success",
          is_error: true,
          result:
            "Failed to authenticate: OAuth session expired and could not be refreshed: private-detail",
        }),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ status: 503 });
    expect((caught as Error).message).toContain("CLI 로그인을 확인");
    expect((caught as Error).message).not.toContain("private-detail");
    expect(() => parser.finish()).toThrow("완성된 답변");
  });

  it("한글 델타·전체 메시지·최종 결과를 중복 없이 연결하고 캐시 토큰을 포함한다", () => {
    const parser = new CliResponseParser("claude-code");
    expect(parser.consume(partial("연결 "))).toBe("연결 ");
    expect(parser.consume(partial("확인"))).toBe("확인");
    expect(parser.consume(assistant("연결 확인"))).toBe("");
    expect(
      parser.consume(
        line({
          type: "result",
          subtype: "success",
          result: "연결 확인",
          usage: {
            input_tokens: 10,
            cache_read_input_tokens: 20,
            cache_creation_input_tokens: 30,
            output_tokens: 4,
          },
        }),
      ),
    ).toBe("");
    expect(parser.finish()).toEqual({
      text: "연결 확인",
      inputTokens: 60,
      outputTokens: 4,
    });
  });

  it("델타가 없는 버전의 전체 메시지와 result 단독 응답도 처리한다", () => {
    const parser = new CliResponseParser("claude-code");
    expect(parser.consume(assistant("답변"))).toBe("답변");
    expect(parser.consume(assistant("답변입니다"))).toBe("입니다");
    parser.consume(line({ type: "result", subtype: "success" }));
    expect(parser.finish().text).toBe("답변입니다");
    const fallback = new CliResponseParser("claude-code");
    expect(
      fallback.consume(
        line({ type: "result", subtype: "success", result: "응답" }),
      ),
    ).toBe("응답");
    expect(fallback.finish().inputTokens).toBeNull();
  });

  it("생각·도구 내부 메시지를 답변으로 노출하지 않는다", () => {
    const parser = new CliResponseParser("claude-code");
    expect(
      parser.consume(
        line({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "thinking_delta", thinking: "비공개" },
          },
        }),
      ),
    ).toBe("");
    expect(
      parser.consume(
        line({
          type: "assistant",
          parent_tool_use_id: "nested",
          message: { content: [{ type: "text", text: "비공개" }] },
        }),
      ),
    ).toBe("");
    expect(() => parser.finish()).toThrow("완성된 답변");
  });

  it("중간 텍스트 뒤 실패와 사용 한도를 성공으로 취급하지 않는다", () => {
    const parser = new CliResponseParser("claude-code");
    parser.consume(partial("중간 답변"));
    expect(() =>
      parser.consume(
        line({
          type: "result",
          subtype: "error_during_execution",
          is_error: true,
          errors: ["quota exceeded: secret-token"],
        }),
      ),
    ).toThrow("사용 한도");
    expect(() => parser.finish()).toThrow("완성된 답변");
  });
});

describe("Codex 응답", () => {
  it("중간·완료 이벤트 중복을 제거하고 완료 토큰을 저장한다", () => {
    const parser = new CliResponseParser("codex-cli");
    expect(
      parser.consume(
        line({
          type: "item.completed",
          item: { type: "reasoning", text: "비공개" },
        }),
      ),
    ).toBe("");
    expect(
      parser.consume(
        line({
          type: "item.completed",
          item: {
            id: "notice",
            type: "agent_message",
            phase: "commentary",
            text: "진행 중",
          },
        }),
      ),
    ).toBe("");
    expect(
      parser.consume(
        line({
          type: "item.updated",
          item: { id: "answer", type: "agent_message", text: "연결" },
        }),
      ),
    ).toBe("연결");
    expect(
      parser.consume(
        line({
          type: "item.completed",
          item: { id: "answer", type: "agent_message", text: "연결 확인" },
        }),
      ),
    ).toBe(" 확인");
    expect(
      parser.consume(
        line({
          type: "item.completed",
          item: { id: "answer", type: "agent_message", text: "연결 확인" },
        }),
      ),
    ).toBe("");
    parser.consume(
      line({
        type: "turn.completed",
        usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 5 },
      }),
    );
    expect(parser.finish()).toEqual({
      text: "연결 확인",
      inputTokens: 100,
      outputTokens: 5,
    });
  });

  it("실패·빈 결과·완료 이벤트 누락을 거부한다", () => {
    expect(() =>
      new CliResponseParser("codex-cli").consume(
        line({
          type: "turn.failed",
          error: { message: "Unauthorized 401: secret" },
        }),
      ),
    ).toThrow("인증");
    const parser = new CliResponseParser("codex-cli");
    parser.consume(line({ type: "turn.completed" }));
    expect(() => parser.finish()).toThrow("완성된 답변");
  });
});
