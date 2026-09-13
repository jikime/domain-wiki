import { expect, test } from "@playwright/test";
import { embedBoundedTexts, embeddingParts } from "../src/lib/embedding-inputs";

export function registerEmbeddingInputTests() {
  test.describe("13단계 검색 입력", () => {
    test("긴 한글·이모지·표의 마지막 조건까지 보존하고 API 입력 한도 안에서 벡터를 만든다", async () => {
      const text = `# 갱신 기준\n${"한글🙂e\u0301|30초|아니요\n".repeat(8000)}마지막 조건: 통신 단절 시 자동 갱신하지 않습니다.`;
      const seen: string[] = [];
      let calls = 0;
      const vectors = await embedBoundedTexts(
        [text, "짧은 입력"],
        async (batch) => {
          calls++;
          expect(batch.length).toBeLessThanOrEqual(32);
          expect(
            batch.every((value) => Buffer.byteLength(value, "utf8") <= 6000),
          ).toBe(true);
          seen.push(...batch);
          return batch.map((value) =>
            value.includes("마지막 조건") ? [0, 1] : [1, 0],
          );
        },
      );
      expect(calls).toBeGreaterThan(1);
      expect(seen.slice(0, -1).join("")).toBe(text);
      expect(seen.at(-1)).toBe("짧은 입력");
      expect(vectors).toHaveLength(2);
      expect(vectors[0][1]).toBeGreaterThan(0);
      expect(Math.hypot(...vectors[0])).toBeCloseTo(1, 10);
      expect(vectors[1]).toEqual([1, 0]);
      expect(
        embeddingParts("🙂".repeat(1501))
          .map((p) => p.text)
          .join(""),
      ).toBe("🙂".repeat(1501));
    });
    test("중간 배치 실패·응답 차원 변경·취소를 완성된 색인으로 바꾸지 않는다", async () => {
      const large = "a".repeat(6000 * 33);
      let calls = 0;
      await expect(
        embedBoundedTexts([large], async (batch) => {
          if (++calls === 2) throw new Error("중간 장애");
          return batch.map(() => [1, 0]);
        }),
      ).rejects.toThrow("중간 장애");
      calls = 0;
      await expect(
        embedBoundedTexts([large], async (batch) => {
          const value = ++calls === 1 ? [1, 0] : [1, 0, 0];
          return batch.map(() => value);
        }),
      ).rejects.toThrow("차원");
      const controller = new AbortController();
      calls = 0;
      await expect(
        embedBoundedTexts(
          [large],
          async (batch) => {
            calls++;
            controller.abort();
            return batch.map(() => [1, 0]);
          },
          controller.signal,
        ),
      ).rejects.toThrow();
      expect(calls).toBe(1);
    });
  });
}
