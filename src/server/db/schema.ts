import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { emptyPurposeGuide, type PurposeGuide } from "@/lib/domain-purpose";
import type { GraphProof } from "@/lib/knowledge-graph";
import type { SourceWatchConfig } from "@/lib/reference/source-watch-types";
import type { FolderMediaSnapshot } from "@/lib/source-import-files";
import { emptyWikiMetadata, type WikiMetadata } from "@/lib/wiki-metadata";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date());

export const sourceImport = pgTable(
  "source_import",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    domainId: uuid("domain_id")
      .notNull()
      .references(() => domain.id),
    projectId: uuid("project_id").references(() => project.id),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    label: text("label").notNull(),
    category: text("category").notNull(),
    mode: text("mode").$type<"upload" | "watch">().notNull(),
    rootKey: text("root_key"),
    config: jsonb("config").$type<SourceWatchConfig>().notNull(),
    enabled: boolean("enabled").default(false).notNull(),
    intervalMinutes: integer("interval_minutes").default(5).notNull(),
    nextScanAt: timestamp("next_scan_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastScanAt: timestamp("last_scan_at", { withTimezone: true }),
    state: text("state")
      .$type<"idle" | "scanning" | "failed">()
      .default("idle")
      .notNull(),
    leaseId: uuid("lease_id"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    errorMessage: text("error_message"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.workspaceId, t.domainId],
      foreignColumns: [domain.workspaceId, domain.id],
    }),
    foreignKey({
      columns: [t.workspaceId, t.domainId, t.projectId],
      foreignColumns: [project.workspaceId, project.domainId, project.id],
    }),
    index("source_import_due_idx").on(t.enabled, t.nextScanAt),
  ],
);
export const sourceImportFile = pgTable(
  "source_import_file",
  {
    importId: uuid("import_id")
      .notNull()
      .references(() => sourceImport.id, { onDelete: "cascade" }),
    relativePath: text("relative_path").notNull(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => source.id, { onDelete: "cascade" }),
    versionId: uuid("version_id")
      .notNull()
      .references(() => sourceVersion.id, { onDelete: "cascade" }),
    sha256: text("sha256").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    missing: boolean("missing").default(false).notNull(),
  },
  (t) => [primaryKey({ columns: [t.importId, t.relativePath] })],
);

export const user = pgTable("app_user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
export const session = pgTable(
  "auth_session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_idx").on(table.userId)],
);
export const account = pgTable(
  "auth_account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("account_provider_unique").on(table.providerId, table.accountId),
    index("account_user_idx").on(table.userId),
  ],
);
export const verification = pgTable(
  "auth_verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const workspace = pgTable("workspace", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});
export const memberRole = pgEnum("member_role", [
  "reader",
  "writer",
  "reviewer",
]);
export const membership = pgTable(
  "membership",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull().default("reader"),
    isAdmin: boolean("is_admin").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    index("membership_user_idx").on(table.userId),
  ],
);
export type Term = { term: string; definition: string; aliases?: string[] };
export type DomainGuide = {
  steps: { title: string; description: string; wikiId: string | null }[];
  readingIds: string[];
};
export const domain = pgTable(
  "domain",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    purpose: text("purpose").notNull(),
    purposeMarkdown: text("purpose_markdown").notNull().default(""),
    schemaMarkdown: text("schema_markdown").notNull().default(""),
    overviewMarkdown: text("overview_markdown").notNull().default(""),
    autoIngest: boolean("auto_ingest").notNull().default(false),
    purposeGuide: jsonb("purpose_guide")
      .$type<PurposeGuide>()
      .notNull()
      .default(emptyPurposeGuide),
    terms: jsonb("terms").$type<Term[]>().notNull().default([]),
    guide: jsonb("guide")
      .$type<DomainGuide>()
      .notNull()
      .default({ steps: [], readingIds: [] }),
    recordTemplate: text("record_template")
      .notNull()
      .default("상황\n판단과 이유\n결과\n추가 확인할 내용"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("domain_workspace_id_unique").on(table.workspaceId, table.id),
    unique("domain_name_unique").on(table.workspaceId, table.name),
  ],
);
export const project = pgTable(
  "project",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    domainId: uuid("domain_id").notNull(),
    name: text("name").notNull(),
    clientName: text("client_name").notNull(),
    description: text("description").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.domainId],
      foreignColumns: [domain.workspaceId, domain.id],
    }),
    unique("project_name_unique").on(table.domainId, table.name),
    unique("project_scope_unique").on(
      table.workspaceId,
      table.domainId,
      table.id,
    ),
  ],
);

// Native project files are opaque data; archive paths are never filesystem destinations.
export const archiveFile = pgTable(
  "archive_file",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    domainId: uuid("domain_id").notNull(),
    path: text("path").notNull(),
    directory: boolean("directory").notNull().default(false),
    storageKey: text("storage_key").notNull().unique(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    sourceId: uuid("source_id"),
    pageId: uuid("page_id"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.workspaceId, t.domainId],
      foreignColumns: [domain.workspaceId, domain.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.workspaceId, t.sourceId],
      foreignColumns: [source.workspaceId, source.id],
    }),
    foreignKey({
      columns: [t.workspaceId, t.pageId],
      foreignColumns: [wikiPage.workspaceId, wikiPage.id],
    }),
    unique("archive_file_path_unique").on(t.domainId, t.path),
  ],
);

export const publicationState = pgEnum("publication_state", [
  "pending",
  "published",
  "rejected",
  "withdrawn",
  "superseded",
]);
export const processingState = pgEnum("processing_state", [
  "queued",
  "processing",
  "completed",
  "failed",
  "canceled",
]);
export const source = pgTable(
  "source",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    domainId: uuid("domain_id").notNull(),
    projectId: uuid("project_id"),
    title: text("title").notNull(),
    category: text("category").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    latestVersionId: uuid("latest_version_id"),
    publishedVersionId: uuid("published_version_id"),
    versionCount: integer("version_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("source_scope_unique").on(t.workspaceId, t.id),
    foreignKey({
      columns: [t.workspaceId, t.domainId],
      foreignColumns: [domain.workspaceId, domain.id],
    }),
    foreignKey({
      columns: [t.workspaceId, t.domainId, t.projectId],
      foreignColumns: [project.workspaceId, project.domainId, project.id],
    }),
    index("source_domain_idx").on(t.workspaceId, t.domainId),
  ],
);
export type Testimony = {
  rawNote: string;
  situation: string;
  reasoning: string;
  result: string;
  followUp: string;
  chunkIds: string[];
};
export const sourceVersion = pgTable(
  "source_version",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    sourceId: uuid("source_id").notNull(),
    number: integer("number").notNull(),
    filename: text("filename").notNull(),
    relativePath: text("relative_path"),
    originUrl: text("origin_url"),
    folderMedia: jsonb("folder_media")
      .$type<FolderMediaSnapshot[]>()
      .notNull()
      .default([]),
    mimeType: text("mime_type").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    sha256: text("sha256").notNull(),
    byteSize: integer("byte_size").notNull(),
    uploadedBy: text("uploaded_by")
      .notNull()
      .references(() => user.id),
    publication: publicationState("publication").notNull().default("pending"),
    processing: processingState("processing").notNull().default("queued"),
    activeJobId: uuid("active_job_id"),
    parserVersion: text("parser_version"),
    testimony: jsonb("testimony").$type<Testimony>(),
    errorMessage: text("error_message"),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.workspaceId, t.sourceId],
      foreignColumns: [source.workspaceId, source.id],
    }).onDelete("cascade"),
    unique("source_version_number_unique").on(t.sourceId, t.number),
    unique("source_version_scope_unique").on(t.workspaceId, t.id),
    index("source_version_hash_idx").on(t.workspaceId, t.sha256),
  ],
);
export type SourceLocator =
  | { kind: "spreadsheet"; sheet: string; row: number; table?: number }
  | {
      kind: "document";
      format: string;
      block: string;
      section?: string;
      table?: number;
      row?: number;
    }
  | {
      kind: "image";
      image: number;
      page?: number;
      table?: number;
      row?: number;
    }
  | { kind: "lines"; startLine: number; endLine: number; heading: string }
  | { kind: "pdf"; page: number; table?: number; row?: number }
  | {
      kind: "html";
      block: number;
      heading: string;
      table?: number;
      row?: number;
    }
  | {
      kind: "docx";
      block: string;
      section: string;
      table?: number;
      row?: number;
    }
  | {
      kind: "pptx";
      slide: number;
      section: "body" | "notes";
      shapeId?: string;
      paragraph?: number;
      table?: number;
      row?: number;
      x?: number;
      y?: number;
    };
export const sourceChunk = pgTable(
  "source_chunk",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    versionId: uuid("version_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    text: text("text").notNull(),
    locator: jsonb("locator").$type<SourceLocator>().notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.workspaceId, t.versionId],
      foreignColumns: [sourceVersion.workspaceId, sourceVersion.id],
    }).onDelete("cascade"),
    unique("chunk_ordinal_unique").on(t.versionId, t.ordinal),
    unique("chunk_scope_unique").on(t.workspaceId, t.id),
  ],
);
export const sourceAsset = pgTable(
  "source_asset",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    versionId: uuid("version_id").notNull(),
    name: text("name").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    mimeType: text("mime_type").notNull(),
    sha256: text("sha256").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    locator: jsonb("locator").$type<SourceLocator>().notNull(),
    caption: text("caption").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.workspaceId, t.versionId],
      foreignColumns: [sourceVersion.workspaceId, sourceVersion.id],
    }).onDelete("cascade"),
    unique("source_asset_name_unique").on(t.versionId, t.name),
  ],
);
export const imageCaptionCache = pgTable(
  "image_caption_cache",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    cacheKey: text("cache_key").notNull(),
    caption: text("caption").notNull(),
    model: text("model").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.cacheKey] })],
);
export const wikiState = pgEnum("wiki_state", [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "withdrawn",
  "superseded",
]);
export const wikiPage = pgTable(
  "wiki_page",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    domainId: uuid("domain_id").notNull(),
    projectId: uuid("project_id"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    latestVersionId: uuid("latest_version_id"),
    publishedVersionId: uuid("published_version_id"),
    versionCount: integer("version_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("wiki_page_scope_unique").on(t.workspaceId, t.id),
    foreignKey({
      columns: [t.workspaceId, t.domainId],
      foreignColumns: [domain.workspaceId, domain.id],
    }),
    foreignKey({
      columns: [t.workspaceId, t.domainId, t.projectId],
      foreignColumns: [project.workspaceId, project.domainId, project.id],
    }),
    index("wiki_domain_idx").on(t.workspaceId, t.domainId),
  ],
);
export const wikiVersion = pgTable(
  "wiki_version",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    pageId: uuid("page_id").notNull(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    metadata: jsonb("metadata")
      .$type<WikiMetadata>()
      .notNull()
      .default(emptyWikiMetadata),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    basePublishedVersionId: uuid("base_published_version_id"),
    state: wikiState("state").notNull().default("draft"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.workspaceId, t.pageId],
      foreignColumns: [wikiPage.workspaceId, wikiPage.id],
    }).onDelete("cascade"),
    unique("wiki_version_number_unique").on(t.pageId, t.number),
    unique("wiki_version_scope_unique").on(t.workspaceId, t.id),
  ],
);
export const wikiEvidence = pgTable(
  "wiki_evidence",
  {
    workspaceId: uuid("workspace_id").notNull(),
    versionId: uuid("version_id").notNull(),
    chunkId: uuid("chunk_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.versionId, t.chunkId] }),
    foreignKey({
      columns: [t.workspaceId, t.versionId],
      foreignColumns: [wikiVersion.workspaceId, wikiVersion.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.workspaceId, t.chunkId],
      foreignColumns: [sourceChunk.workspaceId, sourceChunk.id],
    }),
  ],
);
export const reviewDecision = pgTable("review_decision", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  sourceVersionId: uuid("source_version_id").references(
    () => sourceVersion.id,
    { onDelete: "cascade" },
  ),
  wikiVersionId: uuid("wiki_version_id").references(() => wikiVersion.id, {
    onDelete: "cascade",
  }),
  actorId: text("actor_id")
    .notNull()
    .references(() => user.id),
  action: text("action").notNull(),
  note: text("note").notNull().default(""),
  createdAt: createdAt(),
});

export type ChatScope = {
  domainId: string | null;
  projectId: string | null;
  sourceId: string | null;
  wikiId: string | null;
  sourceOnly?: boolean;
  agentMode?: "fast" | "standard" | "deep";
  webProvider?: import("@/lib/chat-web").ChatWebProvider;
};
export const conversation = pgTable(
  "conversation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id),
    title: text("title").notNull(),
    scope: jsonb("scope").$type<ChatScope>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("conversation_scope_unique").on(t.workspaceId, t.id),
    index("conversation_owner_idx").on(t.workspaceId, t.ownerId),
  ],
);
export const chatRun = pgTable(
  "chat_run",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    requestId: uuid("request_id").notNull(),
    prompt: text("prompt").notNull(),
    scope: jsonb("scope").$type<ChatScope>().notNull(),
    state: text("state").notNull().default("running"),
    model: text("model"),
    retrievalMode: text("retrieval_mode"),
    webReferences: jsonb("web_references")
      .$type<import("@/lib/chat-web").ChatWebReference[]>()
      .notNull()
      .default([]),
    toolEvents: jsonb("tool_events")
      .$type<import("@/lib/chat-agent").AgentToolEvent[]>()
      .notNull()
      .default([]),
    errorMessage: text("error_message"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.workspaceId, t.conversationId],
      foreignColumns: [conversation.workspaceId, conversation.id],
    }).onDelete("cascade"),
    unique("run_request_unique").on(t.conversationId, t.requestId),
    unique("run_scope_unique").on(t.workspaceId, t.id),
  ],
);
export const chatMessage = pgTable(
  "chat_message",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    runId: uuid("run_id").notNull(),
    role: text("role").notNull(),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.workspaceId, t.runId],
      foreignColumns: [chatRun.workspaceId, chatRun.id],
    }).onDelete("cascade"),
    unique("message_run_role_unique").on(t.runId, t.role),
  ],
);
const imageBytes = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});
export const chatImage = pgTable(
  "chat_image",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    runId: uuid("run_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    name: text("name").notNull(),
    mediaType: text("media_type").notNull(),
    sha256: text("sha256").notNull(),
    data: imageBytes("data").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.workspaceId, t.runId],
      foreignColumns: [chatRun.workspaceId, chatRun.id],
    }).onDelete("cascade"),
    unique("chat_image_run_ordinal_unique").on(t.runId, t.ordinal),
  ],
);
export type CitationSnapshot = {
  key: string;
  kind: "source" | "wiki";
  id: string;
  versionId: string;
  chunkId?: string;
  title: string;
  text: string;
  category: string;
  href: string;
  locator?: SourceLocator;
  domainId?: string;
  excerpt?: { start: number; end: number; total: number };
  graph?: GraphProof;
  linkedPages?: { id: string; versionId: string }[];
  omittedLinks?: boolean;
};
export const chatCitation = pgTable(
  "chat_citation",
  {
    workspaceId: uuid("workspace_id").notNull(),
    runId: uuid("run_id").notNull(),
    key: text("key").notNull(),
    snapshot: jsonb("snapshot").$type<CitationSnapshot>().notNull(),
    used: boolean("used").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.key] }),
    foreignKey({
      columns: [t.workspaceId, t.runId],
      foreignColumns: [chatRun.workspaceId, chatRun.id],
    }).onDelete("cascade"),
  ],
);
export const chatFeedback = pgTable(
  "chat_feedback",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    runId: uuid("run_id").notNull(),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    rating: text("rating").notNull(),
    note: text("note").notNull().default(""),
    state: text("state").notNull().default("open"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.workspaceId, t.runId],
      foreignColumns: [chatRun.workspaceId, chatRun.id],
    }).onDelete("cascade"),
    unique("feedback_author_run_unique").on(t.authorId, t.runId),
  ],
);
const embeddingVector = customType<{ data: number[]; driverData: string }>({
  dataType: () => "vector",
  toDriver: (v) => JSON.stringify(v),
  fromDriver: (v) => JSON.parse(v),
});
export const contentEmbedding = pgTable(
  "content_embedding",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    targetId: uuid("target_id").notNull(),
    model: text("model").notNull(),
    dimensions: integer("dimensions").notNull(),
    vector: embeddingVector("vector").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.kind, t.targetId, t.model] }),
    index("embedding_workspace_idx").on(t.workspaceId, t.model),
  ],
);

export type ProposalItem = {
  kind: "new" | "update" | "merge" | "conflict";
  pageId: string | null;
  parentVersionId: string | null;
  basePublishedVersionId: string | null;
  title: string;
  body: string;
  chunkIds: string[];
  reason: string;
  plannedPageId?: string;
  metadata?: WikiMetadata;
  claimIds?: string[];
  questions?: string[];
  requiresResolution?: boolean;
  mergedPages: {
    pageId: string;
    publishedVersionId: string;
    latestVersionId: string;
  }[];
};
export const changeBatch = pgTable(
  "change_batch",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    domainId: uuid("domain_id").notNull(),
    projectId: uuid("project_id"),
    title: text("title").notNull(),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    state: text("state")
      .$type<"draft" | "submitted" | "approved" | "rejected">()
      .notNull()
      .default("draft"),
    origin: text("origin")
      .$type<"manual" | "source" | "answer" | "analysis">()
      .notNull(),
    predecessorId: uuid("predecessor_id"),
    taskId: uuid("task_id"),
    groupOrdinal: integer("group_ordinal"),
    groupRevision: integer("group_revision").notNull().default(1),
    dependencies: jsonb("dependencies").$type<number[]>().notNull().default([]),
    items: jsonb("items").$type<ProposalItem[]>().notNull(),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    results: jsonb("results")
      .$type<{ pageId: string; versionId: string }[]>()
      .notNull()
      .default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.workspaceId, t.domainId],
      foreignColumns: [domain.workspaceId, domain.id],
    }),
    foreignKey({
      columns: [t.workspaceId, t.domainId, t.projectId],
      foreignColumns: [project.workspaceId, project.domainId, project.id],
    }),
    index("batch_queue_idx").on(t.workspaceId, t.state, t.createdAt),
    unique("batch_task_group_revision_unique").on(
      t.taskId,
      t.groupOrdinal,
      t.groupRevision,
    ),
    foreignKey({
      columns: [t.workspaceId, t.taskId],
      foreignColumns: [aiTask.workspaceId, aiTask.id],
    }),
  ],
);
export const batchDecision = pgTable("batch_decision", {
  id: uuid("id").defaultRandom().primaryKey(),
  batchId: uuid("batch_id")
    .notNull()
    .references(() => changeBatch.id, { onDelete: "cascade" }),
  actorId: text("actor_id")
    .notNull()
    .references(() => user.id),
  action: text("action").notNull(),
  note: text("note").notNull(),
  createdAt: createdAt(),
});
export type AiTaskState =
  | "waiting"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "canceled";
export type AiProfileSnapshot = {
  model: string;
  identity: string;
  contextChars: number;
};
export const aiTask = pgTable(
  "ai_task",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    sourceVersionId: uuid("source_version_id").notNull(),
    analysisTaskId: uuid("analysis_task_id"),
    ingestRunId: uuid("ingest_run_id"),
    domainId: uuid("domain_id").notNull(),
    projectId: uuid("project_id"),
    kind: text("kind").notNull(),
    requestId: uuid("request_id").notNull(),
    inputHash: text("input_hash").notNull(),
    rulesHash: text("rules_hash").notNull(),
    promptVersion: text("prompt_version").notNull(),
    profile: jsonb("profile").$type<AiProfileSnapshot>(),
    state: text("state").$type<AiTaskState>().notNull().default("waiting"),
    activeJobId: uuid("active_job_id"),
    leaseToken: uuid("lease_token"),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    recoveries: integer("recoveries").notNull().default(0),
    result: jsonb("result").$type<Record<string, unknown>>(),
    errorMessage: text("error_message"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("ai_task_request_unique").on(t.workspaceId, t.authorId, t.requestId),
    unique("ai_task_scope_unique").on(t.workspaceId, t.id),
    foreignKey({
      columns: [t.workspaceId, t.analysisTaskId],
      foreignColumns: [t.workspaceId, t.id],
    }),
    foreignKey({
      columns: [t.workspaceId, t.sourceVersionId],
      foreignColumns: [sourceVersion.workspaceId, sourceVersion.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.workspaceId, t.domainId],
      foreignColumns: [domain.workspaceId, domain.id],
    }),
    foreignKey({
      columns: [t.workspaceId, t.domainId, t.projectId],
      foreignColumns: [project.workspaceId, project.domainId, project.id],
    }),
    index("ai_task_pending_idx").on(t.state, t.updatedAt),
    index("ai_task_source_idx").on(
      t.workspaceId,
      t.sourceVersionId,
      t.createdAt,
    ),
  ],
);
export const aiStep = pgTable(
  "ai_step",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => aiTask.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    kind: text("kind").notNull(),
    state: text("state")
      .$type<"pending" | "running" | "completed" | "failed">()
      .notNull()
      .default("pending"),
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    attempts: integer("attempts").notNull().default(0),
    cacheKey: text("cache_key"),
    cacheOriginStepId: uuid("cache_origin_step_id"),
    errorMessage: text("error_message"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("ai_step_ordinal_unique").on(t.taskId, t.ordinal),
    index("ai_step_cache_idx").on(t.cacheKey, t.state),
  ],
);
export type IngestState =
  | "waiting"
  | "analysis"
  | "generation"
  | "review"
  | "completed"
  | "failed"
  | "canceled"
  | "outdated";
export type IngestKnowledgeStamp = {
  wikis: {
    id: string;
    publishedVersionId: string | null;
    latestVersionId: string | null;
  }[];
  sources: { id: string; versionId: string }[];
};
export const ingestRun = pgTable(
  "ingest_run",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").notNull(),
    sourceVersionId: uuid("source_version_id").notNull(),
    domainId: uuid("domain_id").notNull(),
    projectId: uuid("project_id"),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    origin: text("origin").$type<"manual" | "automatic">().notNull(),
    basisHash: text("basis_hash").notNull(),
    rulesHash: text("rules_hash").notNull(),
    profile: jsonb("profile").$type<AiProfileSnapshot>(),
    knowledgeStamp: jsonb("knowledge_stamp")
      .$type<IngestKnowledgeStamp>()
      .notNull(),
    state: text("state").$type<IngestState>().notNull().default("waiting"),
    analysisTaskId: uuid("analysis_task_id"),
    generationTaskId: uuid("generation_task_id"),
    reusedAnalysis: boolean("reused_analysis").notNull().default(false),
    errorMessage: text("error_message"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("ingest_run_scope_unique").on(t.workspaceId, t.id),
    foreignKey({
      columns: [t.workspaceId, t.sourceId],
      foreignColumns: [source.workspaceId, source.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.workspaceId, t.sourceVersionId],
      foreignColumns: [sourceVersion.workspaceId, sourceVersion.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.workspaceId, t.domainId],
      foreignColumns: [domain.workspaceId, domain.id],
    }),
    foreignKey({
      columns: [t.workspaceId, t.domainId, t.projectId],
      foreignColumns: [project.workspaceId, project.domainId, project.id],
    }),
    foreignKey({
      columns: [t.workspaceId, t.analysisTaskId],
      foreignColumns: [aiTask.workspaceId, aiTask.id],
    }),
    foreignKey({
      columns: [t.workspaceId, t.generationTaskId],
      foreignColumns: [aiTask.workspaceId, aiTask.id],
    }),
    index("ingest_run_source_idx").on(t.workspaceId, t.sourceId, t.createdAt),
    index("ingest_run_pending_idx").on(t.state, t.updatedAt),
    uniqueIndex("ingest_run_active_source_unique")
      .on(t.workspaceId, t.sourceId)
      .where(sql`${t.state} IN ('waiting','analysis','generation','review')`),
  ],
);
export const generation = pgTable(
  "generation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    requestId: uuid("request_id").notNull(),
    inputHash: text("input_hash").notNull(),
    kind: text("kind").notNull(),
    taskId: uuid("task_id").references(() => aiTask.id, {
      onDelete: "cascade",
    }),
    stepId: uuid("step_id").references(() => aiStep.id, {
      onDelete: "cascade",
    }),
    state: text("state").$type<"running" | "completed" | "failed">().notNull(),
    model: text("model"),
    batchId: uuid("batch_id").references(() => changeBatch.id),
    result: jsonb("result").$type<Record<string, unknown>>(),
    errorMessage: text("error_message"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("generation_request_unique").on(
      t.workspaceId,
      t.authorId,
      t.requestId,
    ),
    index("generation_active_idx").on(t.workspaceId, t.state),
  ],
);

export const researchRun = pgTable(
  "research_run",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    domainId: uuid("domain_id").notNull(),
    projectId: uuid("project_id"),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    requestId: uuid("request_id").notNull(),
    inputHash: text("input_hash").notNull(),
    input: jsonb("input")
      .$type<import("@/lib/research").ResearchInput>()
      .notNull(),
    contextHash: text("context_hash").notNull(),
    state: text("state").notNull().default("queued"),
    leaseToken: uuid("lease_token"),
    generationId: uuid("generation_id").references(() => generation.id),
    references: jsonb("references")
      .$type<import("@/lib/research").ResearchReference[]>()
      .notNull()
      .default([]),
    dependencies: jsonb("dependencies")
      .$type<CitationSnapshot[]>()
      .notNull()
      .default([]),
    synthesis: text("synthesis").notNull().default(""),
    sourceErrors: jsonb("source_errors")
      .$type<string[]>()
      .notNull()
      .default([]),
    errorMessage: text("error_message"),
    pageId: uuid("page_id"),
    versionId: uuid("version_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("research_request_unique").on(
      t.workspaceId,
      t.authorId,
      t.requestId,
    ),
    foreignKey({
      columns: [t.workspaceId, t.domainId],
      foreignColumns: [domain.workspaceId, domain.id],
    }),
    foreignKey({
      columns: [t.workspaceId, t.domainId, t.projectId],
      foreignColumns: [project.workspaceId, project.domainId, project.id],
    }),
    index("research_queue_idx").on(t.state, t.updatedAt),
    index("research_author_idx").on(t.workspaceId, t.authorId, t.createdAt),
  ],
);

export const contentIssue = pgTable("content_issue", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  authorId: text("author_id")
    .notNull()
    .references(() => user.id),
  kind: text("kind").notNull(),
  targetId: uuid("target_id").notNull(),
  title: text("title").notNull(),
  note: text("note").notNull(),
  state: text("state").notNull().default("open"),
  resolution: text("resolution").notNull().default(""),
  fixedWikiId: uuid("fixed_wiki_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
export const reviewAssignment = pgTable(
  "review_assignment",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    targetId: uuid("target_id").notNull(),
    assigneeId: text("assignee_id").references(() => user.id),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.kind, t.targetId] })],
);
export const reviewEvent = pgTable("review_event", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  targetId: uuid("target_id").notNull(),
  actorId: text("actor_id")
    .notNull()
    .references(() => user.id),
  action: text("action").notNull(),
  note: text("note").notNull(),
  createdAt: createdAt(),
});
export const activityRead = pgTable(
  "activity_read",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    notificationKey: text("notification_key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId, t.notificationKey] }),
  ],
);
export const operationsPolicy = pgTable("operations_policy", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspace.id, { onDelete: "cascade" }),
  concurrency: integer("concurrency").notNull().default(3),
  retentionDays: integer("retention_days").notNull().default(365),
  inputPrice: integer("input_price"),
  outputPrice: integer("output_price"),
  currency: text("currency").notNull().default("KRW"),
  updatedAt: updatedAt(),
});
export const operationsEvent = pgTable("operations_event", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  actorId: text("actor_id")
    .notNull()
    .references(() => user.id),
  action: text("action").notNull(),
  counts: jsonb("counts").$type<Record<string, number>>().notNull(),
  details: jsonb("details")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  createdAt: createdAt(),
});
export const passwordRecovery = pgTable(
  "password_recovery",
  {
    tokenHash: text("token_hash").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    issuedBy: text("issued_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index("password_recovery_user_idx").on(table.userId)],
);

export const embeddingUsage = pgTable(
  "embedding_usage",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    purpose: text("purpose").notNull(),
    inputTokens: integer("input_tokens"),
    state: text("state").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("embedding_usage_workspace_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
  ],
);
export const sourceRetirement = pgTable("source_retirement", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  actorId: text("actor_id")
    .notNull()
    .references(() => user.id),
  title: text("title").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull(),
  createdAt: createdAt(),
});
export const originalGc = pgTable("original_gc", {
  storageKey: text("storage_key").primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  attempts: integer("attempts").notNull().default(0),
  removedAt: timestamp("removed_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const officialSite = pgTable(
  "official_site",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    origin: text("origin").notNull(),
    pathPrefix: text("path_prefix").notNull(),
    active: boolean("active").notNull().default(true),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("official_site_scope_unique").on(t.workspaceId, t.id),
    unique("official_site_address_unique").on(
      t.workspaceId,
      t.origin,
      t.pathPrefix,
    ),
  ],
);
export type OfficialAttachment = {
  url: string;
  title: string;
  supported: boolean;
};
export const officialCandidate = pgTable(
  "official_candidate",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    siteId: uuid("site_id").notNull(),
    domainId: uuid("domain_id").notNull(),
    projectId: uuid("project_id"),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    requestId: uuid("request_id").notNull(),
    inputHash: text("input_hash").notNull(),
    url: text("url").notNull(),
    finalUrl: text("final_url"),
    title: text("title").notNull(),
    state: text("state")
      .$type<"fetching" | "captured" | "verified" | "rejected" | "failed">()
      .notNull()
      .default("fetching"),
    sourceVersionId: uuid("source_version_id"),
    sha256: text("sha256"),
    publishedHint: text("published_hint"),
    publishedDate: text("published_date"),
    effectiveDate: text("effective_date"),
    attachments: jsonb("attachments")
      .$type<OfficialAttachment[]>()
      .notNull()
      .default([]),
    reviewNote: text("review_note").notNull().default(""),
    errorMessage: text("error_message"),
    checkedBy: text("checked_by").references(() => user.id),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("official_candidate_scope_unique").on(t.workspaceId, t.id),
    unique("official_candidate_request_unique").on(
      t.workspaceId,
      t.authorId,
      t.requestId,
    ),
    foreignKey({
      columns: [t.workspaceId, t.siteId],
      foreignColumns: [officialSite.workspaceId, officialSite.id],
    }),
    foreignKey({
      columns: [t.workspaceId, t.domainId],
      foreignColumns: [domain.workspaceId, domain.id],
    }),
    foreignKey({
      columns: [t.workspaceId, t.domainId, t.projectId],
      foreignColumns: [project.workspaceId, project.domainId, project.id],
    }),
    foreignKey({
      columns: [t.workspaceId, t.sourceVersionId],
      foreignColumns: [sourceVersion.workspaceId, sourceVersion.id],
    }),
    index("official_candidate_queue_idx").on(
      t.workspaceId,
      t.state,
      t.createdAt,
    ),
  ],
);
export const officialDecision = pgTable("official_decision", {
  id: uuid("id").defaultRandom().primaryKey(),
  candidateId: uuid("candidate_id")
    .notNull()
    .references(() => officialCandidate.id, { onDelete: "cascade" }),
  actorId: text("actor_id")
    .notNull()
    .references(() => user.id),
  action: text("action").notNull(),
  note: text("note").notNull(),
  createdAt: createdAt(),
});
export type RfpSection = {
  kind: "requirement" | "standard" | "case" | "inference" | "unclear";
  title: string;
  meaning: string;
  quote: string;
  chunkIds: string[];
  questions: string[];
};
export const rfpReport = pgTable(
  "rfp_report",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    domainId: uuid("domain_id").notNull(),
    projectId: uuid("project_id"),
    sourceId: uuid("source_id").notNull(),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    latestVersionId: uuid("latest_version_id"),
    publishedVersionId: uuid("published_version_id"),
    versionCount: integer("version_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("rfp_report_scope_unique").on(t.workspaceId, t.id),
    foreignKey({
      columns: [t.workspaceId, t.domainId],
      foreignColumns: [domain.workspaceId, domain.id],
    }),
    foreignKey({
      columns: [t.workspaceId, t.domainId, t.projectId],
      foreignColumns: [project.workspaceId, project.domainId, project.id],
    }),
    foreignKey({
      columns: [t.workspaceId, t.sourceId],
      foreignColumns: [source.workspaceId, source.id],
    }),
  ],
);
export const rfpVersion = pgTable(
  "rfp_version",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    reportId: uuid("report_id").notNull(),
    number: integer("number").notNull(),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    title: text("title").notNull(),
    sections: jsonb("sections").$type<RfpSection[]>().notNull(),
    state: text("state")
      .$type<
        | "draft"
        | "submitted"
        | "approved"
        | "rejected"
        | "withdrawn"
        | "superseded"
      >()
      .notNull()
      .default("draft"),
    basePublishedVersionId: uuid("base_published_version_id"),
    origin: text("origin").notNull().default("manual"),
    model: text("model"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("rfp_version_scope_unique").on(t.workspaceId, t.id),
    unique("rfp_version_number_unique").on(t.reportId, t.number),
    foreignKey({
      columns: [t.workspaceId, t.reportId],
      foreignColumns: [rfpReport.workspaceId, rfpReport.id],
    }).onDelete("cascade"),
  ],
);
export const rfpEvidence = pgTable(
  "rfp_evidence",
  {
    workspaceId: uuid("workspace_id").notNull(),
    versionId: uuid("version_id").notNull(),
    chunkId: uuid("chunk_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.versionId, t.chunkId] }),
    foreignKey({
      columns: [t.workspaceId, t.versionId],
      foreignColumns: [rfpVersion.workspaceId, rfpVersion.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.workspaceId, t.chunkId],
      foreignColumns: [sourceChunk.workspaceId, sourceChunk.id],
    }),
  ],
);
export const rfpDecision = pgTable("rfp_decision", {
  id: uuid("id").defaultRandom().primaryKey(),
  versionId: uuid("version_id")
    .notNull()
    .references(() => rfpVersion.id, { onDelete: "cascade" }),
  actorId: text("actor_id")
    .notNull()
    .references(() => user.id),
  action: text("action").notNull(),
  note: text("note").notNull(),
  createdAt: createdAt(),
});

// Quality runs have their own scope: unlike source analysis they may inspect pages without evidence.
export const qualityRun = pgTable(
  "quality_run",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    domainId: uuid("domain_id").notNull(),
    projectId: uuid("project_id"),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    requestId: uuid("request_id").notNull(),
    mode: text("mode").notNull(),
    origin: text("origin").notNull(),
    basisHash: text("basis_hash").notNull(),
    snapshot: jsonb("snapshot")
      .$type<import("@/lib/quality").QualitySnapshot>()
      .notNull(),
    state: text("state").notNull().default("queued"),
    leaseToken: uuid("lease_token"),
    coverage: jsonb("coverage")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    completedSteps: integer("completed_steps").notNull().default(0),
    errorMessage: text("error_message"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("quality_run_scope_unique").on(t.workspaceId, t.id),
    unique("quality_run_request_unique").on(
      t.workspaceId,
      t.authorId,
      t.requestId,
    ),
    foreignKey({
      columns: [t.workspaceId, t.domainId],
      foreignColumns: [domain.workspaceId, domain.id],
    }),
    foreignKey({
      columns: [t.workspaceId, t.domainId, t.projectId],
      foreignColumns: [project.workspaceId, project.domainId, project.id],
    }),
    index("quality_run_pending_idx").on(t.state, t.updatedAt),
    uniqueIndex("quality_run_active_idx")
      .on(
        t.workspaceId,
        t.domainId,
        sql`COALESCE(${t.projectId},'00000000-0000-0000-0000-000000000000'::uuid)`,
        t.mode,
      )
      .where(sql`${t.state} IN ('queued','running')`),
  ],
);
export const qualityStep = pgTable(
  "quality_step",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    runId: uuid("run_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    input: jsonb("input")
      .$type<import("@/lib/quality").QualityStepInput>()
      .notNull(),
    result: jsonb("result").$type<import("@/lib/quality").QualityCandidate[]>(),
    generationId: uuid("generation_id").references(() => generation.id, {
      onDelete: "set null",
    }),
    state: text("state").notNull().default("pending"),
  },
  (t) => [
    unique("quality_step_ordinal_unique").on(t.runId, t.ordinal),
    foreignKey({
      columns: [t.workspaceId, t.runId],
      foreignColumns: [qualityRun.workspaceId, qualityRun.id],
    }).onDelete("cascade"),
  ],
);
export const qualityFinding = pgTable(
  "quality_finding",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    domainId: uuid("domain_id").notNull(),
    projectId: uuid("project_id"),
    scopeKey: text("scope_key").notNull(),
    findingKey: text("finding_key").notNull(),
    mode: text("mode").notNull(),
    kind: text("kind").notNull(),
    severity: text("severity").notNull(),
    title: text("title").notNull(),
    note: text("note").notNull(),
    pageIds: jsonb("page_ids").$type<string[]>().notNull(),
    quotes: jsonb("quotes")
      .$type<import("@/lib/quality").QualityQuote[]>()
      .notNull()
      .default([]),
    purposeQuestion: text("purpose_question"),
    suggestion: jsonb("suggestion")
      .$type<
        NonNullable<import("@/lib/quality").QualityCandidate["suggestion"]>
      >()
      .notNull()
      .default({}),
    targetId: uuid("target_id"),
    state: text("state").notNull().default("open"),
    present: boolean("present").notNull().default(true),
    resolution: text("resolution").notNull().default(""),
    fixedWikiId: uuid("fixed_wiki_id"),
    runId: uuid("run_id").notNull(),
    basisHash: text("basis_hash").notNull(),
    occurrences: integer("occurrences").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("quality_finding_key_unique").on(
      t.workspaceId,
      t.scopeKey,
      t.findingKey,
    ),
    foreignKey({
      columns: [t.workspaceId, t.runId],
      foreignColumns: [qualityRun.workspaceId, qualityRun.id],
    }),
    foreignKey({
      columns: [t.workspaceId, t.domainId],
      foreignColumns: [domain.workspaceId, domain.id],
    }),
    foreignKey({
      columns: [t.workspaceId, t.domainId, t.projectId],
      foreignColumns: [project.workspaceId, project.domainId, project.id],
    }),
    foreignKey({
      columns: [t.workspaceId, t.fixedWikiId],
      foreignColumns: [wikiPage.workspaceId, wikiPage.id],
    }),
  ],
);
export const qualityPolicy = pgTable(
  "quality_policy",
  {
    workspaceId: uuid("workspace_id").notNull(),
    domainId: uuid("domain_id").notNull(),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    mode: text("mode").notNull().default("structural"),
    intervalDays: integer("interval_days").notNull().default(0),
    afterRevision: boolean("after_revision").notNull().default(false),
    structuralConfig: jsonb("structural_config")
      .$type<import("@/lib/quality").StructuralConfig>()
      .notNull()
      .default({
        ignoreOrphan: false,
        ignoreNoOutlinks: false,
        ignorePages: [],
      }),
    lastBasisHash: text("last_basis_hash"),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.domainId] }),
    foreignKey({
      columns: [t.workspaceId, t.domainId],
      foreignColumns: [domain.workspaceId, domain.id],
    }).onDelete("cascade"),
  ],
);
