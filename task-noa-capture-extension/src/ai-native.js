export const AI_NATIVE_SCHEMA_VERSION = "2026-03-10";

export function isoNow() {
  return new Date().toISOString();
}

export function toTrimmedText(value) {
  if (value == null) {
    return "";
  }
  return String(value).replace(/\s+/g, " ").trim();
}

export function textContent(node) {
  return toTrimmedText(node?.textContent ?? "");
}

export function buildCaptureEnvelope({
  entityType,
  entityId,
  url,
  title,
  summary,
  items,
  rawText,
  metadata,
}) {
  return {
    schema_version: AI_NATIVE_SCHEMA_VERSION,
    source: "chrome-extension",
    source_type: "business_web_app",
    entity_type: entityType,
    entity_id: entityId ?? "",
    captured_at: isoNow(),
    url,
    title,
    summary,
    items,
    raw_text: rawText,
    metadata,
  };
}
