import { z } from "zod";

const optionalId = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.uuid().optional(),
);
export const pageInput = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(30),
  q: z.string().trim().max(100).default(""),
  domainId: optionalId,
  projectId: optionalId,
});
export type PageResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};
export function pageResult<T>(
  items: T[],
  total: number,
  filter: { page: number; pageSize: number },
): PageResult<T> {
  return {
    items,
    total,
    ...filter,
    totalPages: Math.max(1, Math.ceil(total / filter.pageSize)),
  };
}
export function searchPattern(value: string) {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}
