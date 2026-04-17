/**
 * run-viewer-plugin
 *
 * OpenClaw plugin that exposes run record visibility via slash commands.
 *
 * Commands registered:
 *   /runs              — list recent run records (newest first)
 *   /runs <run_id>     — show full detail for a single run record
 *
 * Run records are read from the OpenClaw state directory:
 *   $OPENCLAW_STATE_DIR/runs/  (default: ~/.openclaw/runs/)
 *
 * Each record is a JSON file at runs/YYYY-MM-DD/run_<id>.json.
 * The run_id encodes its date (run_YYYYMMDD_HHMMSS_xxx), so we probe the
 * matching date directory first and fall back to a full scan if needed.
 */

import fs from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_LIST_LIMIT = 10;
const MAX_LIST_LIMIT = 50;
const RUN_ID_RE = /^run_[A-Za-z0-9_]+$/;
const STATUS_VALUES = new Set(["queued", "running", "done", "failed", "cancelled"]);
const DEFAULT_HEALTH_TIME_ZONE = "UTC";
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// ── Path resolution ────────────────────────────────────────────────────────────

/**
 * Resolve the OpenClaw state directory.
 * Mirrors the logic in src/config/paths.ts → resolveStateDir().
 */
function resolveStateDir() {
  const override =
    process.env.OPENCLAW_STATE_DIR?.trim() || process.env.CLAWDBOT_STATE_DIR?.trim();
  if (override) return override;
  return path.join(os.homedir(), ".openclaw");
}

/**
 * Resolve the runs root directory from plugin config or env.
 * Config `runsDir` takes precedence, then env, then default.
 */
function resolveRunsDir(cfg) {
  const cfgDir = typeof cfg?.runsDir === "string" ? cfg.runsDir.trim() : "";
  if (cfgDir) {
    return cfgDir.startsWith("~")
      ? path.join(os.homedir(), cfgDir.slice(1))
      : cfgDir;
  }
  return path.join(resolveStateDir(), "runs");
}

/**
 * Resolve the timezone used to decide what "today" means for /runs health.
 * Config `healthTimeZone` takes precedence, then env, then UTC.
 */
function resolveHealthTimeZone(cfg) {
  const configuredTimeZone = typeof cfg?.healthTimeZone === "string"
    ? cfg.healthTimeZone.trim()
    : "";
  const envTimeZone = process.env.RUN_VIEWER_HEALTH_TIME_ZONE?.trim() ?? "";
  const candidates = [configuredTimeZone, envTimeZone, DEFAULT_HEALTH_TIME_ZONE];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: candidate }).format(new Date());
      return candidate;
    } catch {
      continue;
    }
  }

  return DEFAULT_HEALTH_TIME_ZONE;
}

/**
 * Convert a timestamp into YYYY-MM-DD using the configured /runs health timezone.
 */
function getHealthDate(now = new Date(), cfg) {
  const timeZone = resolveHealthTimeZone(cfg);
  return {
    date: formatDateInTimeZone(now, timeZone),
    timeZone,
  };
}

function formatDateInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const getPart = (type) => parts.find((part) => part.type === type)?.value ?? "00";

  return `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
}

// ── Run store reader ───────────────────────────────────────────────────────────

/**
 * Read a single run record JSON file. Returns null on any error.
 */
async function readRunFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const record = JSON.parse(raw);
    if (typeof record?.run_id !== "string") return null;
    return record;
  } catch {
    return null;
  }
}

/**
 * Generate a run_id in the canonical format run_YYYYMMDD_HHMMSS_xxx.
 */
function formatRunId(now = new Date()) {
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const min = String(now.getUTCMinutes()).padStart(2, "0");
  const ss = String(now.getUTCSeconds()).padStart(2, "0");
  const suffix = crypto.randomBytes(2).toString("hex").slice(0, 3);
  return `run_${yyyy}${mm}${dd}_${hh}${min}${ss}_${suffix}`;
}

/**
 * Atomically write a run record into runs/YYYY-MM-DD/<run_id>.json.
 */
async function writeRunRecord(runsDir, record) {
  const dateMatch = record.run_id.match(/^run_(\d{4})(\d{2})(\d{2})_/);
  if (!dateMatch) {
    throw new Error(`invalid run_id: ${record.run_id}`);
  }

  const dateDir = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
  const dirPath = path.join(runsDir, dateDir);
  const filePath = path.join(dirPath, `${record.run_id}.json`);
  const tempPath = path.join(dirPath, `.${record.run_id}.${process.pid}.${Date.now()}.tmp`);

  await fs.mkdir(dirPath, { recursive: true });
  await fs.writeFile(tempPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);

  return filePath;
}

/**
 * Load runs for a specific YYYY-MM-DD date directory, newest first.
 */
async function loadRunsForDate(runsDir, dateStr, limit) {
  const dirPath = path.join(runsDir, dateStr);
  let files;
  try {
    files = await fs.readdir(dirPath);
  } catch {
    return [];
  }

  const records = [];
  const jsonFiles = files
    .filter((file) => file.endsWith(".json") && !file.endsWith(".tmp"))
    .sort()
    .reverse();

  for (const file of jsonFiles) {
    if (Number.isFinite(limit) && records.length >= limit) break;
    const record = await readRunFile(path.join(dirPath, file));
    if (record) records.push(record);
  }

  return records;
}

function shiftDate(dateStr, deltaDays) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

function enumerateDates(startDate, endDate) {
  const dates = [];
  for (let current = startDate; current <= endDate; current = shiftDate(current, 1)) {
    dates.push(current);
  }
  return dates;
}

function getRunHealthDate(run, timeZone) {
  const timestamp = run.queued_at ?? run.started_at ?? run.done_at ?? null;
  if (!timestamp) return null;

  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatDateInTimeZone(parsed, timeZone);
}

async function loadRunsForHealthRange(runsDir, startDate, endDate, timeZone) {
  const candidateDates = enumerateDates(shiftDate(startDate, -1), shiftDate(endDate, 1));
  const runs = [];

  for (const date of candidateDates) {
    const dateRuns = await loadRunsForDate(runsDir, date);
    for (const run of dateRuns) {
      const runDate = getRunHealthDate(run, timeZone);
      if (runDate && runDate >= startDate && runDate <= endDate) {
        runs.push(run);
      }
    }
  }

  runs.sort((left, right) => {
    const delta = getRunTimestampMs(right) - getRunTimestampMs(left);
    if (delta !== 0) return delta;
    return String(right.run_id ?? "").localeCompare(String(left.run_id ?? ""));
  });

  return runs;
}

function resolveHealthRange(spec, now = new Date(), cfg) {
  const { date: today, timeZone } = getHealthDate(now, cfg);
  const trimmed = spec?.trim() ?? "";
  if (!trimmed) {
    return {
      startDate: today,
      endDate: today,
      label: today,
      timeZone,
    };
  }

  const relativeMatch = trimmed.match(/^(\d+)d$/);
  if (relativeMatch) {
    const days = Number(relativeMatch[1]);
    if (Number.isInteger(days) && days > 0) {
      const startDate = shiftDate(today, 1 - days);
      return {
        startDate,
        endDate: today,
        label: `${startDate}..${today}`,
        timeZone,
      };
    }
  }

  if (ISO_DATE_RE.test(trimmed)) {
    if (!isValidIsoDate(trimmed)) return null;
    return {
      startDate: trimmed,
      endDate: trimmed,
      label: trimmed,
      timeZone,
    };
  }

  const rangeMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
  if (
    rangeMatch &&
    isValidIsoDate(rangeMatch[1]) &&
    isValidIsoDate(rangeMatch[2]) &&
    rangeMatch[1] <= rangeMatch[2]
  ) {
    return {
      startDate: rangeMatch[1],
      endDate: rangeMatch[2],
      label: `${rangeMatch[1]}..${rangeMatch[2]}`,
      timeZone,
    };
  }

  return null;
}

function isValidIsoDate(dateStr) {
  if (!ISO_DATE_RE.test(dateStr)) return false;
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    Number.isInteger(day) &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * List run records from the store, newest first.
 * Scans date directories in reverse chronological order.
 */
async function listRuns(runsDir, limit) {
  const cap = Math.min(Math.max(1, limit), MAX_LIST_LIMIT);

  let dateDirs;
  try {
    dateDirs = await fs.readdir(runsDir);
  } catch {
    return [];
  }

  // Sort date dirs newest first (ISO format: YYYY-MM-DD sorts lexicographically)
  dateDirs = dateDirs
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse();

  const runs = [];
  for (const dateDir of dateDirs) {
    if (runs.length >= cap) break;

    const dirPath = path.join(runsDir, dateDir);
    let files;
    try {
      files = await fs.readdir(dirPath);
    } catch {
      continue;
    }

    // Sort files newest first (run_YYYYMMDD_HHMMSS_xxx.json)
    const jsonFiles = files.filter((f) => f.endsWith(".json")).sort().reverse();

    for (const file of jsonFiles) {
      if (runs.length >= cap) break;
      const record = await readRunFile(path.join(dirPath, file));
      if (record) runs.push(record);
    }
  }

  return runs;
}

/**
 * Find a single run record by run_id.
 * The run_id encodes its creation date (run_YYYYMMDD_HHMMSS_xxx), so we can
 * derive the date directory to probe first for an O(1) lookup in the common
 * case. If that fails (renamed file, custom store layout), we do a full scan.
 */
async function findRunById(runsDir, runId) {
  // Fast path: derive date dir from run_id (format: run_YYYYMMDD_HHMMSS_xxx)
  const dateMatch = runId.match(/^run_(\d{4})(\d{2})(\d{2})_/);
  if (dateMatch) {
    const dateDir = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
    const fastPath = path.join(runsDir, dateDir, `${runId}.json`);
    const record = await readRunFile(fastPath);
    if (record) return record;
  }

  // Slow path: scan all date dirs (handles edge cases / custom layouts)
  let dateDirs;
  try {
    dateDirs = await fs.readdir(runsDir);
  } catch {
    return null;
  }

  const sortedDirs = dateDirs
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse();

  for (const dateDir of sortedDirs) {
    const filePath = path.join(runsDir, dateDir, `${runId}.json`);
    const record = await readRunFile(filePath);
    if (record) return record;
  }

  return null;
}

// ── Formatters ─────────────────────────────────────────────────────────────────

const STATUS_EMOJI = {
  queued: "⏳",
  running: "🔄",
  done: "✅",
  failed: "❌",
  cancelled: "⛔",
};

/**
 * Format a short ISO timestamp for display (HH:MM:SS on the run date).
 */
function fmtTime(iso) {
  if (!iso) return "—";
  try {
    return iso.slice(11, 19);
  } catch {
    return "—";
  }
}

/**
 * Format elapsed duration in ms as human-readable.
 */
function fmtElapsed(queuedAt, doneAt) {
  if (!queuedAt || !doneAt) return "";
  const ms = new Date(doneAt).getTime() - new Date(queuedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return ` (${ms}ms)`;
  return ` (${(ms / 1000).toFixed(1)}s)`;
}

/**
 * Format the list of runs as Slack-friendly text.
 * @param {Array} runs
 * @param {string|null} filterLabel - shown in the header when a filter is active (e.g. "status=failed")
 */
function formatRunList(runs, filterLabel = null) {
  if (runs.length === 0) {
    return filterLabel
      ? `実行記録が見つかりません (${filterLabel})。`
      : "実行記録が見つかりません。";
  }

  const header = filterLabel
    ? `*run 記録 (${runs.length}件 / ${filterLabel})*`
    : `*直近の run 記録 (${runs.length}件)*`;
  const lines = [header];
  for (const run of runs) {
    const emoji = STATUS_EMOJI[run.status] ?? "❓";
    const date = run.queued_at ? run.queued_at.slice(0, 10) : "?";
    const time = fmtTime(run.queued_at);
    const elapsed = fmtElapsed(run.queued_at, run.done_at);
    const summary = run.result?.summary
      ? ` — ${run.result.summary}`
      : run.error?.message
        ? ` — ⚠️ ${run.error.message}`
        : "";
    const retryTag = run.retry_of ? ` ↩` : "";
    lines.push(
      `${emoji} \`${run.run_id}\` \`${run.kind}\` ${date} ${time}${elapsed}${retryTag}${summary}`,
    );
  }

  lines.push("");
  lines.push(`_詳細: \`/runs <run_id>\`_`);

  return lines.join("\n");
}

/**
 * Format a full run record as Slack-friendly text.
 */
function formatRunDetail(run) {
  const emoji = STATUS_EMOJI[run.status] ?? "❓";
  const lines = [];

  lines.push(`${emoji} *run 詳細: \`${run.run_id}\`*`);
  lines.push(`種別: \`${run.kind}\`　状態: \`${run.status}\``);

  // Timing
  if (run.queued_at) {
    const queuedDate = run.queued_at.slice(0, 10);
    const queuedTime = fmtTime(run.queued_at);
    const elapsed = fmtElapsed(run.queued_at, run.done_at);
    lines.push(`受付: ${queuedDate} ${queuedTime}${elapsed}`);
  }
  if (run.started_at) {
    lines.push(`開始: ${fmtTime(run.started_at)}`);
  }
  if (run.done_at) {
    lines.push(`完了: ${fmtTime(run.done_at)}`);
  }

  // Request context
  if (run.raw_text && run.raw_text !== run.normalized_task) {
    lines.push(`入力: \`${run.raw_text}\``);
  }
  if (run.normalized_task) {
    lines.push(`タスク: \`${run.normalized_task}\``);
  }
  if (run.channel_id) {
    const channelLabel = run.channel_name ? `${run.channel_name} (${run.channel_id})` : run.channel_id;
    lines.push(`チャンネル: ${channelLabel}`);
  }

  // Retry chain
  if (run.retry_of) {
    lines.push(`↩ リトライ元: \`${run.retry_of}\` (${run.retry_count}回目)`);
  }

  // Result
  if (run.result) {
    lines.push("");
    if (run.result.summary) {
      lines.push(`*結果:* ${run.result.summary}`);
    }
    if (Array.isArray(run.result.key_points) && run.result.key_points.length > 0) {
      lines.push("*詳細:*");
      for (const point of run.result.key_points) {
        lines.push(`• ${point}`);
      }
    }
    if (run.result.suggested_next_action) {
      lines.push(`*次のアクション:* ${run.result.suggested_next_action}`);
    }
    if (run.result.exit_code != null && run.result.exit_code !== 0) {
      lines.push(`終了コード: \`${run.result.exit_code}\``);
    }
    if (run.result.raw_output) {
      const truncated =
        run.result.raw_output.length > 500
          ? run.result.raw_output.slice(0, 500) + "\n…(省略)"
          : run.result.raw_output;
      lines.push(`\`\`\`\n${truncated}\n\`\`\``);
    }
  }

  // Error
  if (run.error) {
    lines.push("");
    lines.push(`⚠️ *エラー:* ${run.error.message ?? String(run.error)}`);
    if (run.error.code) {
      lines.push(`コード: \`${run.error.code}\``);
    }
  }

  lines.push("");
  lines.push(`_一覧: \`/runs\`_`);

  return lines.join("\n");
}

/**
 * Format a retry acceptance response.
 */
function formatRetryAccepted(originalRunId, retryRunId) {
  return [
    `⏳ *retry を受付しました*`,
    `元 run: \`${originalRunId}\``,
    `新しい run: \`${retryRunId}\``,
    "",
    `_詳細: \`/runs ${retryRunId}\`_`,
  ].join("\n");
}

function getRunTimestampMs(run) {
  const timestamp = run.queued_at ?? run.started_at ?? run.done_at ?? null;
  if (!timestamp) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/**
 * Build a minimal health summary from a run store slice.
 */
function summarizeRunsHealth(runs, periodLabel) {
  const counts = {
    queued: 0,
    running: 0,
    done: 0,
    failed: 0,
    cancelled: 0,
  };

  let latestFailed = null;
  for (const run of runs) {
    const status = run.status;
    if (status in counts) {
      counts[status] += 1;
    }
    if (status === "failed") {
      if (latestFailed == null) {
        latestFailed = run;
        continue;
      }

      const currentTs = getRunTimestampMs(run);
      const latestTs = getRunTimestampMs(latestFailed);
      if (
        currentTs > latestTs ||
        (currentTs === latestTs && String(run.run_id ?? "") > String(latestFailed.run_id ?? ""))
      ) {
        latestFailed = run;
      }
    }
  }

  const overallStatus =
    counts.failed > 0 ? "degraded"
    : counts.running > 0 || counts.queued > 0 ? "active"
    : "ok";

  return {
    date: periodLabel,
    timeZone: null,
    total: runs.length,
    counts,
    latestFailed,
    overallStatus,
  };
}

/**
 * Format a health summary as Slack-friendly text.
 */
function formatHealthSummary(summary) {
  const lines = [];
  const overallEmoji =
    summary.overallStatus === "degraded" ? "⚠️"
    : summary.overallStatus === "active" ? "🔄"
    : "✅";

  lines.push(`${overallEmoji} *run health (${summary.date})*`);
  if (summary.timeZone) {
    lines.push(`timezone: ${summary.timeZone}`);
  }
  lines.push(
    `queued: ${summary.counts.queued} | running: ${summary.counts.running} | done: ${summary.counts.done} | failed: ${summary.counts.failed} | cancelled: ${summary.counts.cancelled}`,
  );
  lines.push(`total: ${summary.total}`);

  if (summary.latestFailed) {
    lines.push("");
    lines.push(`*最新 failed:* \`${summary.latestFailed.run_id}\` (${summary.latestFailed.kind ?? "unknown"})`);
    lines.push(`時刻: ${summary.latestFailed.queued_at ?? "—"}`);
    const errorMessage = summary.latestFailed.error?.message ?? "詳細不明";
    lines.push(`エラー: ${errorMessage}`);
    lines.push(`_詳細: \`/runs ${summary.latestFailed.run_id}\`_`);
  }

  return lines.join("\n");
}

// ── Command handler ────────────────────────────────────────────────────────────

/**
 * Parse a compound list filter from /runs args.
 * Supports up to two conditions: one status keyword and/or one kind= value.
 * last=N is standalone and cannot be combined with other conditions.
 *
 * Returns one of:
 *   { type: "compound", status: string|null, kind: string|null }
 *   { type: "last",     value: number }
 *   null — not a recognized filter
 *
 * Examples:
 *   "failed"              → { type: "compound", status: "failed", kind: null }
 *   "kind=health"         → { type: "compound", status: null,     kind: "health" }
 *   "failed kind=digest"  → { type: "compound", status: "failed", kind: "digest" }
 *   "kind=digest failed"  → { type: "compound", status: "failed", kind: "digest" }
 *   "last=10"             → { type: "last", value: 10 }
 *   "failed done"         → null  (duplicate status)
 *   "kind=a kind=b"       → null  (duplicate kind)
 */
function parseListFilter(args) {
  const trimmed = (args ?? "").trim();

  // last= is always standalone — cannot be combined
  const lastMatch = trimmed.match(/^last=(\d+)$/);
  if (lastMatch) {
    const n = Number(lastMatch[1]);
    if (Number.isInteger(n) && n > 0) return { type: "last", value: n };
    return null;
  }

  // Parse space-separated tokens: at most one status keyword and one kind= value
  const tokens = trimmed.split(/\s+/);
  let status = null;
  let kind = null;

  for (const token of tokens) {
    if (STATUS_VALUES.has(token)) {
      if (status !== null) return null; // duplicate status
      status = token;
    } else {
      const kindMatch = token.match(/^kind=([A-Za-z0-9_-]+)$/);
      if (kindMatch) {
        if (kind !== null) return null; // duplicate kind
        kind = kindMatch[1];
      } else {
        return null; // unrecognized token
      }
    }
  }

  if (status === null && kind === null) return null;
  return { type: "compound", status, kind };
}

/**
 * Handle filtered list commands:
 *   /runs <status>               — single status filter
 *   /runs kind=<v>               — single kind filter
 *   /runs <status> kind=<v>      — compound status + kind filter
 *   /runs last=<n>               — count limit
 */
async function handleRunsFiltered(ctx, filter) {
  const cfg = ctx.config?.plugins?.entries?.["run-viewer"]?.config ?? {};
  const runsDir = resolveRunsDir(cfg);
  const configLimit =
    typeof cfg.listLimit === "number" && cfg.listLimit > 0
      ? cfg.listLimit
      : DEFAULT_LIST_LIMIT;

  if (filter.type === "last") {
    const runs = await listRuns(runsDir, filter.value);
    return { text: formatRunList(runs, `last=${filter.value}`) };
  }

  // compound: status and/or kind — scan MAX_LIST_LIMIT, filter in-memory, cap at configLimit
  const allRuns = await listRuns(runsDir, MAX_LIST_LIMIT);
  const filtered = allRuns.filter((run) => {
    if (filter.status !== null && run.status !== filter.status) return false;
    if (filter.kind !== null && run.kind !== filter.kind) return false;
    return true;
  });
  const capped = filtered.slice(0, configLimit);

  const parts = [];
  if (filter.status) parts.push(`status=${filter.status}`);
  if (filter.kind) parts.push(`kind=${filter.kind}`);
  return { text: formatRunList(capped, parts.join(" / ")) };
}

/**
 * Handle the /runs command with no arguments (list mode).
 */
async function handleRunsList(ctx) {
  const cfg = ctx.config?.plugins?.entries?.["run-viewer"]?.config ?? {};
  const runsDir = resolveRunsDir(cfg);
  const limit = typeof cfg.listLimit === "number" && cfg.listLimit > 0
    ? cfg.listLimit
    : DEFAULT_LIST_LIMIT;

  const runs = await listRuns(runsDir, limit);
  return { text: formatRunList(runs) };
}

/**
 * Handle /runs <run_id> detail lookup.
 */
async function handleRunsDetail(ctx, runId) {
  const cfg = ctx.config?.plugins?.entries?.["run-viewer"]?.config ?? {};
  const runsDir = resolveRunsDir(cfg);
  const run = await findRunById(runsDir, runId);

  if (!run) {
    return {
      text: [
        `run が見つかりません: \`${runId}\``,
        "",
        "_一覧: `/runs`_",
      ].join("\n"),
    };
  }

  return { text: formatRunDetail(run) };
}

/**
 * Handle /runs retry <run_id>.
 */
async function handleRunsRetry(ctx, runId) {
  const cfg = ctx.config?.plugins?.entries?.["run-viewer"]?.config ?? {};
  const runsDir = resolveRunsDir(cfg);
  const original = await findRunById(runsDir, runId);

  if (!original) {
    return {
      text: [
        `run が見つかりません: \`${runId}\``,
        "",
        "_一覧: `/runs`_",
      ].join("\n"),
    };
  }

  if (!["failed", "cancelled"].includes(original.status)) {
    return {
      text: [
        `再実行できません: \`${runId}\` は status=\`${original.status ?? "unknown"}\` です`,
        "retry できるのは `failed` または `cancelled` の run だけです。",
        "",
        `_詳細: \`/runs ${runId}\`_`,
      ].join("\n"),
    };
  }

  const now = new Date();
  const retryRunId = formatRunId(now);
  const retryCount = Number(original.retry_count || 0) + 1;
  const retryRecord = {
    run_id: retryRunId,
    requested_by: original.requested_by,
    requested_by_name: original.requested_by_name,
    channel_id: original.channel_id ?? null,
    channel_name: original.channel_name ?? null,
    raw_text: original.raw_text,
    kind: original.kind,
    normalized_task: original.normalized_task,
    params: original.params || {},
    status: "queued",
    sense_job_id: null,
    queued_at: now.toISOString(),
    started_at: null,
    done_at: null,
    result: null,
    error: null,
    retry_of: runId,
    retry_count: retryCount,
    slack_ts: original.slack_ts ?? null,
  };

  await writeRunRecord(runsDir, retryRecord);
  return { text: formatRetryAccepted(runId, retryRunId) };
}

/**
 * Handle /runs health with optional period arguments.
 */
async function handleRunsHealth(ctx, spec = "") {
  const cfg = ctx.config?.plugins?.entries?.["run-viewer"]?.config ?? {};
  const runsDir = resolveRunsDir(cfg);
  const range = resolveHealthRange(spec, ctx.now ?? new Date(), cfg);
  if (!range) {
    return {
      text: [
        "health の期間指定が不正です。",
        "使い方: `/runs health` | `/runs health 7d` | `/runs health 2026-04-15` | `/runs health 2026-04-15..2026-04-17`",
      ].join("\n"),
    };
  }

  const runs = await loadRunsForHealthRange(
    runsDir,
    range.startDate,
    range.endDate,
    range.timeZone,
  );
  const summary = {
    ...summarizeRunsHealth(runs, range.label),
    timeZone: range.timeZone,
  };
  return { text: formatHealthSummary(summary) };
}

/**
 * Main /runs command handler.
 * With no args → list. With run_id → detail.
 */
async function handleRunsCommand(ctx) {
  const args = ctx.args?.trim() ?? "";

  if (!args) {
    return handleRunsList(ctx);
  }

  const healthMatch = args.match(/^health(?:\s+(.+))?$/);
  if (healthMatch) {
    return handleRunsHealth(ctx, healthMatch[1] ?? "");
  }

  const retryMatch = args.match(/^retry\s+(run_[A-Za-z0-9_]+)$/);
  if (retryMatch) {
    return handleRunsRetry(ctx, retryMatch[1]);
  }

  if (RUN_ID_RE.test(args)) {
    return handleRunsDetail(ctx, args);
  }

  const filter = parseListFilter(args);
  if (filter) {
    return handleRunsFiltered(ctx, filter);
  }

  // Unknown sub-command — show help
  return {
    text: [
      "*`/runs` コマンド使い方:*",
      "• `/runs` — 直近の run 一覧",
      "• `/runs <run_id>` — run 詳細",
      "• `/runs retry <run_id>` — `failed` / `cancelled` の run を再実行",
      "• `/runs health [7d|YYYY-MM-DD|YYYY-MM-DD..YYYY-MM-DD]` — run health summary",
      "• `/runs <status>` — status でフィルタ (failed / done / running / queued / cancelled)",
      "• `/runs kind=<value>` — kind でフィルタ",
      "• `/runs <status> kind=<value>` — 複合フィルタ (例: failed kind=digest)",
      "• `/runs last=<n>` — 件数指定",
    ].join("\n"),
  };
}

// ── Plugin definition ──────────────────────────────────────────────────────────

const plugin = {
  id: "run-viewer",
  name: "Run Viewer",
  description: "OpenClaw run record visibility. /runs で直近の実行記録を確認できます。",

  register(api) {
    api.registerCommand({
      name: "runs",
      description: "直近の run 記録一覧を表示します。",
      acceptsArgs: true,
      handler: handleRunsCommand,
    });
  },
};

export {
  findRunById,
  formatRunId,
  formatHealthSummary,
  formatRunDetail,
  formatRunList,
  handleRunsCommand,
  loadRunsForHealthRange,
  loadRunsForDate,
  listRuns,
  getHealthDate,
  parseListFilter,
  resolveHealthRange,
  resolveHealthTimeZone,
  resolveRunsDir,
  summarizeRunsHealth,
  writeRunRecord,
};

export default plugin;
