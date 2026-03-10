import { buildCaptureEnvelope } from "../ai-native.js";
import {
  buildTableRecords,
  defaultPageMetadata,
  extractVisibleTables,
  textContent,
  visibleRawText,
} from "./base.js";

const ADAPTER_VERSION = "0.1.0";
const SITE_ID = "task-noa";

function pathname() {
  return window.location.pathname.toLowerCase();
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

export const taskNoaAdapter = {
  id: "task-noa-visible-table",
  siteId: SITE_ID,
  matches() {
    return /task-noa|192\.168\.11\.14:3000|127\.0\.0\.1:3000|localhost:3000/i.test(window.location.href);
  },
  capture() {
    const tables = extractVisibleTables();
    const page = defaultPageMetadata();
    const entityType = inferEntityType(pathname(), tables);
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
        adapter_id: this.id,
        adapter_version: ADAPTER_VERSION,
        page_path: page.path,
        page_label: page.label,
        hostname: window.location.hostname,
        visible_tables: tables,
        table_count: tables.length,
      },
    });
  },
};
