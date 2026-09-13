// Port of llm_wiki wiki-schema.ts. Only Tauri file loading removed; Markdown parsing and routing are unchanged.
// Copyright (C) 2024-2026 YongSu. SPDX-License-Identifier: GPL-3.0-only
import { parseFrontmatter } from "./frontmatter";

export interface WikiSchemaRouting {
  typeDirs: Record<string, string>;
}

export interface WikiSchemaRoutingIssue {
  message: string;
}

export function parseWikiSchemaRouting(markdown: string): WikiSchemaRouting {
  const typeDirs: Record<string, string> = {};
  for (const line of pageTypesSectionLines(markdown)) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 2) continue;

    const [type, dir] = cells;
    if (!/^[a-z][a-z0-9_-]*$/i.test(type)) continue;
    if (dir !== "wiki" && !dir.startsWith("wiki/")) continue;

    typeDirs[type] = stripTrailingSlash(dir);
  }

  return { typeDirs };
}

function pageTypesSectionLines(markdown: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => {
    const match = line.trim().match(/^(#{1,6})\s+(.+?)\s*#*$/);
    return !!match && /^page\s+types$/i.test(match[2].trim());
  });

  if (start < 0) return [];

  const headingLevel = lines[start].trim().match(/^(#{1,6})/)?.[1].length ?? 6;
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const heading = line.trim().match(/^(#{1,6})\s+/);
    if (heading && heading[1].length <= headingLevel) break;
    out.push(line);
  }
  return out;
}

export function validateWikiPageRouting(
  relativePath: string,
  content: string,
  routing: WikiSchemaRouting,
): WikiSchemaRoutingIssue | null {
  const parsed = parseFrontmatter(content);
  const type = parsed.frontmatter?.type;
  if (typeof type !== "string" || !type.trim()) return null;

  const normalizedPath = normalizeRelativePath(relativePath);
  const actualDir = dirname(normalizedPath);
  const expectedDir = routing.typeDirs[type];
  if (expectedDir && actualDir !== expectedDir) {
    return {
      message: `Page type "${type}" must be under "${expectedDir}/". Current directory: "${actualDir}".`,
    };
  }

  const typeFromPath = inferTypeFromSchemaPath(normalizedPath, routing);
  if (typeFromPath && typeFromPath !== type) {
    return {
      message: `Pages under "${actualDir}/" must use type "${typeFromPath}", but found "${type}".`,
    };
  }

  return null;
}

function inferTypeFromSchemaPath(
  relativePath: string,
  routing: WikiSchemaRouting,
): string | null {
  const actualDir = dirname(relativePath);
  for (const [type, dir] of Object.entries(routing.typeDirs)) {
    if (actualDir === dir) return type;
  }
  return null;
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

function dirname(relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath);
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : ".";
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
