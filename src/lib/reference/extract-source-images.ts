// Ported from llm_wiki, Git 8bcf9b5.
// Copyright (C) 2024-2026 YongSu. SPDX-License-Identifier: GPL-3.0-only
import { getFileName, normalizePath } from "./path-utils";

const MARKDOWN_IMAGE_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "tif",
  "tiff",
  "svg",
]);

function isRemoteOrDataImageRef(raw: string): boolean {
  return /^(https?:|data:|blob:|file:|tauri:)/i.test(raw);
}

function cleanMarkdownImageRef(raw: string): string {
  const stripped = raw.trim().replace(/^<(.+)>$/, "$1");
  try {
    return decodeURIComponent(stripped);
  } catch {
    return stripped;
  }
}

export function findLocalMarkdownImageRefs(markdown: string): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();

  const add = (raw: string) => {
    const ref = cleanMarkdownImageRef(raw.split("#")[0].split("|")[0]);
    if (!ref || isRemoteOrDataImageRef(ref)) return;
    const ext = getFileName(ref).split(".").pop()?.toLowerCase() ?? "";
    if (!MARKDOWN_IMAGE_EXTS.has(ext)) return;
    const key = normalizePath(ref);
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  };

  for (const match of markdown.matchAll(/!\[\[([^\]]+)\]\]/g)) {
    add(match[1] ?? "");
  }

  for (const match of markdown.matchAll(
    /!\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g,
  )) {
    add(match[1] ?? "");
  }

  return refs;
}
