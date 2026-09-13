// Adapted from llm_wiki src/lib/context-budget.ts, Git 8bcf9b5.
// Copyright (C) 2024-2026 YongSu. SPDX-License-Identifier: GPL-3.0-only
// See licenses/llm-wiki-GPL-3.0.txt and licenses/NOTICE.md.
// These are operator-configured character budgets, not a model token window.
export function computeContextBudget(maxContextSize: number | undefined) {
  const maxCtx =
    Number.isFinite(maxContextSize) && (maxContextSize ?? 0) > 0
      ? Math.floor(maxContextSize as number)
      : 204800;
  const responseReserve = Math.floor(maxCtx * 0.15);
  const indexBudget = Math.floor(maxCtx * 0.05);
  const pageBudget = Math.floor(maxCtx * 0.5);
  const maxPageSize = Math.min(
    pageBudget,
    Math.max(5000, Math.floor(pageBudget * 0.3)),
  );
  return { maxCtx, responseReserve, indexBudget, pageBudget, maxPageSize };
}
