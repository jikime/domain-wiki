// Format families follow llm_wiki src-tauri/src/commands/fs.rs.
export const SOURCE_FORMATS: Record<string, string> = {
  doc: "application/msword",
  xls: "application/vnd.ms-excel",
  xlsb: "application/vnd.ms-excel.sheet.binary.macroenabled.12",
  ppt: "application/vnd.ms-powerpoint",
  pps: "application/vnd.ms-powerpoint",
  pot: "application/vnd.ms-powerpoint",
  mobi: "application/x-mobipocket-ebook",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  org: "text/x-org",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  jsonl: "application/x-ndjson",
  xml: "application/xml",
  yaml: "text/yaml",
  yml: "text/yaml",
  ipynb: "application/x-ipynb+json",
  html: "text/html",
  htm: "text/html",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  docm: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pptm: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppsx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppsm: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  rtf: "application/rtf",
  epub: "application/epub+zip",
  bmp: "image/bmp",
  ico: "image/x-icon",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  tif: "image/tiff",
  tiff: "image/tiff",
  svg: "image/svg+xml",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
};
export const SOURCE_ACCEPT = Object.keys(SOURCE_FORMATS)
  .map((ext) => `.${ext}`)
  .join(",");
export const officeFormat: Record<
  string,
  "docx" | "pptx" | "xlsx" | "odt" | "ods" | "odp" | "rtf" | "epub" | "csv"
> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.oasis.opendocument.text": "odt",
  "application/vnd.oasis.opendocument.spreadsheet": "ods",
  "application/vnd.oasis.opendocument.presentation": "odp",
  "application/rtf": "rtf",
  "application/epub+zip": "epub",
  "text/csv": "csv",
};
export const isZipOffice = (ext: string) =>
  [
    "docx",
    "docm",
    "pptx",
    "pptm",
    "ppsx",
    "ppsm",
    "xlsx",
    "xlsm",
    "odt",
    "ods",
    "odp",
    "epub",
  ].includes(ext);
export function safeRelativePath(raw: string) {
  const path = raw.normalize("NFC").replace(/\\/g, "/").replace(/^\.\//, "");
  if (
    !path ||
    path.length > 500 ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    /[\p{Cc}]/u.test(path) ||
    path.split("/").some((s) => !s || s === "." || s === "..")
  )
    return null;
  return path;
}

export const nativeFormat: Record<string, string> = {
  "application/msword": "doc",
  "application/vnd.ms-excel": "xls",
  "application/vnd.ms-excel.sheet.binary.macroenabled.12": "xlsb",
  "application/vnd.ms-powerpoint": "ppt",
  "application/x-mobipocket-ebook": "mobi",
};
