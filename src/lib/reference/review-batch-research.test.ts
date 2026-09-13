// Ported from llm_wiki, Git 8bcf9b5.
// Copyright (C) 2024-2026 YongSu. SPDX-License-Identifier: GPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  reviewResearchTopic,
  selectedResearchReviews,
} from "./review-batch-research";
import type { ReviewItem } from "./review-batch-types";

function review(
  id: string,
  type: ReviewItem["type"],
  resolved = false,
): ReviewItem {
  return {
    id,
    type,
    title: `Topic ${id}`,
    description: "Description",
    options: [],
    resolved,
    createdAt: 1,
  };
}

describe("selectedResearchReviews", () => {
  it("keeps selected researchable pending reviews and skips active tasks", () => {
    const items = [
      review("a", "suggestion"),
      review("b", "missing-page"),
      review("c", "confirm"),
      review("d", "suggestion", true),
    ];

    expect(
      selectedResearchReviews(items, new Set(["a", "b", "c", "d"]), [
        { sourceReviewId: "b", status: "searching" },
      ]).map((item) => item.id),
    ).toEqual(["a"]);
  });

  it("uses the description only when the title is empty", () => {
    expect(
      reviewResearchTopic({
        ...review("a", "suggestion"),
        title: " ",
        description: "First line\nSecond line",
      }),
    ).toBe("First line");
  });
});
