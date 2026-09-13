// Conservative UTF-8 byte bounds for the configured byte-token embedding API.
// Every character is retained. Search excerpts are selected separately.
export const EMBEDDING_INPUT_VERSION = "utf8-6000-mean-v1";
export const EMBEDDING_PART_BYTES = 6000;
export const EMBEDDING_BATCH_PARTS = 32;

export function embeddingParts(text: string) {
  if (!text.length) throw new Error("임베딩 입력이 비어 있습니다.");
  const parts: { text: string; bytes: number }[] = [];
  let start = 0,
    offset = 0,
    bytes = 0;
  for (const char of text) {
    const point = char.codePointAt(0) ?? 0;
    const size = point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
    if (bytes + size > EMBEDDING_PART_BYTES) {
      parts.push({ text: text.slice(start, offset), bytes });
      start = offset;
      bytes = 0;
    }
    bytes += size;
    offset += char.length;
  }
  if (offset > start) parts.push({ text: text.slice(start), bytes });
  return parts;
}

export async function embedBoundedTexts(
  texts: string[],
  embedBatch: (texts: string[]) => Promise<number[][]>,
  signal?: AbortSignal,
) {
  const parts = texts.flatMap((text, document) =>
    embeddingParts(text).map((part) => ({ ...part, document })),
  );
  const totals = texts.map(() => ({
    vector: [] as number[],
    weight: 0,
    parts: 0,
    single: [] as number[],
  }));
  let dimensions = 0;
  for (let start = 0; start < parts.length; start += EMBEDDING_BATCH_PARTS) {
    signal?.throwIfAborted();
    const batch = parts.slice(start, start + EMBEDDING_BATCH_PARTS);
    const vectors = await embedBatch(batch.map((part) => part.text));
    signal?.throwIfAborted();
    if (vectors.length !== batch.length)
      throw new Error("임베딩 응답 개수가 다릅니다.");
    for (const [index, part] of batch.entries()) {
      const vector = vectors[index];
      dimensions ||= vector.length;
      if (
        !dimensions ||
        vector.length !== dimensions ||
        vector.some((v) => !Number.isFinite(v))
      )
        throw new Error("임베딩 응답 차원이 바뀌었거나 유효하지 않습니다.");
      const total = totals[part.document];
      if (!total.parts) {
        total.vector = Array(dimensions).fill(0);
        total.single = vector;
      }
      total.parts++;
      total.weight += part.bytes;
      for (let i = 0; i < dimensions; i++)
        total.vector[i] += vector[i] * part.bytes;
    }
  }
  return totals.map((total) => {
    if (total.parts === 1) return total.single;
    const mean = total.vector.map((v) => v / total.weight);
    const norm = Math.sqrt(mean.reduce((sum, v) => sum + v * v, 0));
    if (!Number.isFinite(norm) || norm === 0)
      throw new Error("합친 임베딩 벡터가 유효하지 않습니다.");
    return mean.map((v) => v / norm);
  });
}
