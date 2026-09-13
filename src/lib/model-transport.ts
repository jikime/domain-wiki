export const modelTransports = ["api", "claude-code", "codex-cli"] as const;
export type ModelTransport = (typeof modelTransports)[number];
export type CliTransport = Exclude<ModelTransport, "api">;
export const modelTransportLabels: Record<ModelTransport, string> = {
  api: "API",
  "claude-code": "Claude Code CLI",
  "codex-cli": "Codex CLI",
};

export type ModelMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};
export type ModelInputMessage =
  | ModelMessage
  | {
      role: "user";
      content: (
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      )[];
    };
