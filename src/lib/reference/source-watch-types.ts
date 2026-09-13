export type SourceWatchConfig = {
  enabled: boolean;
  autoIngest: boolean;
  persistExtractedMarkdown: boolean;
  parsingConcurrency: number;
  ingestConcurrency: number;
  includeExtensions: string[];
  excludeExtensions: string[];
  excludeDirs: string[];
  excludeGlobs: string[];
  maxFileSizeMb: number;
};
