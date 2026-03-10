const AI_NATIVE_SCHEMA_VERSION = "2026-03-10";
const ADAPTER_VERSION = "0.1.0";
const SITE_ID = "task-noa";

function toTrimmedText(value) {
  if (value == null) {
    return "";
  }
  return String(value).replace(/\s+/g, " ").trim();
}

function textContent(node) {
  return toTrimmedText(node?.textContent ?? "");
}

function isoNow() {
  return new Date().toISOString();
}

function buildCaptureEnvelope({
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

function isVisible(element) {
  if (!element || !(element instanceof HTMLElement)) {
    return false;
  }
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function extractHeaders(table) {
  const headerCells = table.querySelectorAll("thead th");
  if (headerCells.length > 0) {
    return Array.from(headerCells).map((cell) => textContent(cell));
  }
  const firstRow = table.querySelector("tr");
  return firstRow
    ? Array.from(firstRow.querySelectorAll("th,td")).map((cell) => textContent(cell))
    : [];
}

function extractRows(table) {
  const bodyRows = table.querySelectorAll("tbody tr");
  const rows = bodyRows.length > 0 ? bodyRows : table.querySelectorAll("tr");
  return Array.from(rows)
    .filter((row, index) => !(bodyRows.length === 0 && index === 0))
    .map((row) => Array.from(row.querySelectorAll("td,th")).map((cell) => textContent(cell)))
    .filter((row) => row.some(Boolean));
}

function extractVisibleTables() {
  return Array.from(document.querySelectorAll("table"))
    .filter((table) => isVisible(table))
    .map((table, index) => ({
      table_id: table.id || `table-${index + 1}`,
      caption: toTrimmedText(table.querySelector("caption")?.textContent ?? ""),
      headers: extractHeaders(table),
      rows: extractRows(table),
    }))
    .filter((table) => table.headers.length > 0 || table.rows.length > 0);
}

function buildTableRecords(table) {
  const headers =
    table.headers.length > 0
      ? table.headers
      : table.rows[0]?.map((_, index) => `column_${index + 1}`) ?? [];
  return table.rows.map((row) =>
    Object.fromEntries(headers.map((header, index) => [header || `column_${index + 1}`, row[index] ?? ""])),
  );
}

function defaultPageMetadata() {
  return {
    url: window.location.href,
    title: document.title || "Untitled",
    path: window.location.pathname,
    label: document.querySelector("h1")?.textContent?.trim() || "",
  };
}

function visibleRawText() {
  const main = document.querySelector("main");
  return textContent(main || document.body);
}

function inferEntityType(path, tables) {
  if (path.includes("/journal")) {
    return "journal_entries";
  }
  if (path.includes("/invoice") || path.includes("/billing")) {
    return "invoices";
  }
  if (path.includes("/sales") || path.includes("/dashboard")) {
    return "sales_summary";
  }
  const joinedHeaders = tables.flatMap((table) => table.headers).join(" ").toLowerCase();
  if (joinedHeaders.includes("借方") || joinedHeaders.includes("貸方") || joinedHeaders.includes("仕訳")) {
    return "journal_entries";
  }
  if (joinedHeaders.includes("請求") || joinedHeaders.includes("invoice")) {
    return "invoices";
  }
  return "sales_summary";
}

function recordsForEntity(entityType, tables) {
  const primaryTable = tables[0];
  if (!primaryTable) {
    return [];
  }
  const tableRecords = buildTableRecords(primaryTable);
  if (entityType === "sales_summary") {
    return tableRecords.length > 0
      ? tableRecords
      : [
          {
            title: textContent(document.querySelector("h1")),
            summary: textContent(document.querySelector("main")),
          },
        ];
  }
  return tableRecords;
}

function deriveEntityId(entityType, records) {
  if (entityType === "sales_summary") {
    return new Date().toISOString().slice(0, 7);
  }
  const first = records[0];
  if (!first) {
    return "";
  }
  return (
    first.id ||
    first.ID ||
    first["請求番号"] ||
    first["仕訳ID"] ||
    first["Invoice ID"] ||
    ""
  );
}

function taskNoaAdapterMatches() {
  return /task-noa|192\.168\.11\.14:3000|127\.0\.0\.1:3000|localhost:3000/i.test(window.location.href);
}

function captureTaskNoaPage() {
  const tables = extractVisibleTables();
  const page = defaultPageMetadata();
  const entityType = inferEntityType(page.path.toLowerCase(), tables);
  const items = recordsForEntity(entityType, tables);
  const rawText = visibleRawText();
  const summary = page.label || textContent(document.querySelector("h2")) || page.title;
  return buildCaptureEnvelope({
    entityType,
    entityId: deriveEntityId(entityType, items),
    url: page.url,
    title: page.title,
    summary,
    items,
    rawText,
    metadata: {
      site_id: SITE_ID,
      adapter_id: "task-noa-visible-table",
      adapter_version: ADAPTER_VERSION,
      page_path: page.path,
      page_label: page.label,
      hostname: window.location.hostname,
      visible_tables: tables,
      table_count: tables.length,
    },
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "TASK_NOA_CAPTURE_PAGE") {
    return false;
  }

  if (!taskNoaAdapterMatches()) {
    sendResponse({
      ok: false,
      error: "No adapter matched the current page.",
    });
    return false;
  }

  try {
    const payload = captureTaskNoaPage();
    sendResponse({ ok: true, payload });
  } catch (error) {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : "Capture failed",
    });
  }
  return false;
});
