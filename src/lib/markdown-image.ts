export function safeMarkdownImageSrc(src: string) {
  const value = src.trim();
  if (
    !value ||
    [...value].some(
      (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || c === "\\",
    )
  )
    return "";
  if (
    /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(value) &&
    value.length < 2_000_000
  )
    return value;
  if (value.startsWith("//")) return "";
  try {
    const url = new URL(value, "https://wiki.invalid/");
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? value
      : "";
  } catch {
    return "";
  }
}
