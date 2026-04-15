/**
 * run-viewer-plugin
 *
 * OpenClaw plugin that exposes run record visibility via slash commands.
 *
 * Commands registered:
 *   /runs              — list recent run records (newest first)
 *
 * Run records are read from the OpenClaw state directory:
 *   $OPENCLAW_STATE_DIR/runs/  (default: ~/.openclaw/runs/)
 *
 * Each record is a JSON file at runs/YYYY-MM-DD/run_<id>.json.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_LIST_LIMIT = 10;
const MAX_LIST_LIMIT = 50;
const RUN_ID_RE = /^run_[A-Za-z0-9_]+$/;

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
 */
function formatRunList(runs) {
  if (runs.length === 0) {
    return "実行記録が見つかりません。";
  }

  const lines = [`*直近の run 記録 (${runs.length}件)*`];
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

// ── Command handler ────────────────────────────────────────────────────────────

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
 * Main /runs command handler.
 * With no args → list. Otherwise → usage hint (detail added in next PR).
 */
async function handleRunsCommand(ctx) {
  const args = ctx.args?.trim() ?? "";

  if (!args) {
    return handleRunsList(ctx);
  }

  // Unknown sub-command — show help
  return {
    text: [
      "*`/runs` コマンド使い方:*",
      "• `/runs` — 直近の run 一覧",
      "• `/runs <run_id>` — run 詳細 _(近日対応)_",
      "• `/runs retry <run_id>` — run をリトライ _(近日対応)_",
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

export default plugin;
