import { textContent, toTrimmedText } from "../ai-native.js";

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

export function extractVisibleTables() {
  return Array.from(document.querySelectorAll("table"))
    .filter((table) => isVisible(table))
    .map((table, index) => {
      const headers = extractHeaders(table);
      const rows = extractRows(table);
      return {
        table_id: table.id || `table-${index + 1}`,
        caption: toTrimmedText(table.querySelector("caption")?.textContent ?? ""),
        headers,
        rows,
      };
    })
    .filter((table) => table.headers.length > 0 || table.rows.length > 0);
}

export function buildTableRecords(table) {
  const headers = table.headers.length > 0 ? table.headers : table.rows[0]?.map((_, index) => `column_${index + 1}`) ?? [];
  return table.rows.map((row) =>
    Object.fromEntries(headers.map((header, index) => [header || `column_${index + 1}`, row[index] ?? ""])),
  );
}

export function defaultPageMetadata() {
  return {
    url: window.location.href,
    title: document.title || "Untitled",
    path: window.location.pathname,
    label: document.querySelector("h1")?.textContent?.trim() || "",
  };
}

export function visibleRawText() {
  const main = document.querySelector("main");
  return textContent(main || document.body);
}
