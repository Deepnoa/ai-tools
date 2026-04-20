# Run Viewer Plugin

OpenClaw plugin that exposes run record visibility through the `/runs` command.

## Commands

- `/runs` — list recent run records (newest first)
- `/runs <run_id>` — show full detail for a single run
- `/runs retry <run_id>` — re-queue a `failed` or `cancelled` run
- `/runs health` — run health summary for today
- `/runs health 7d` — health summary for today and the previous 6 days
- `/runs health YYYY-MM-DD` — health summary for a specific date
- `/runs health YYYY-MM-DD..YYYY-MM-DD` — health summary for an inclusive date range
- `/runs search <text...>` — search recent runs by text (multiple keywords are AND-matched)
- `/runs search <text...> [<status>] [kind=<value>] [last=<n>] [offset=<n>]` — search with optional filters
- `/runs <status>` — filter list by status (failed / done / running / queued / cancelled)
- `/runs kind=<value>` — filter list by kind (e.g. `kind=health`, `kind=digest`)
- `/runs <status> kind=<value>` — compound filter: status AND kind (e.g. `failed kind=digest`)
- `/runs last=<n>` — limit list to n most recent records
- `/runs offset=<n>` — skip the first n results (0-based paging)
- `/runs offset=<n> last=<m>` — skip n results, then show m

Unknown or malformed arguments return a usage hint.

## `/runs health` — date resolution

All dates are resolved in the configured timezone.

| Form | Example | Meaning |
|------|---------|---------|
| _(none)_ | `/runs health` | Today in the resolved timezone |
| `Nd` | `/runs health 7d` | Today + the previous N−1 days |
| `YYYY-MM-DD` | `/runs health 2026-04-15` | One specific calendar date |
| `YYYY-MM-DD..YYYY-MM-DD` | `/runs health 2026-04-01..2026-04-15` | Inclusive date range |

Non-calendar dates, malformed ranges, and reversed ranges are rejected — a usage message is returned instead of silent normalization. The active timezone is shown in every health summary output.

### Timezone resolution

First valid value wins:

1. `healthTimeZone` in plugin config
2. `RUN_VIEWER_HEALTH_TIME_ZONE` environment variable
3. `UTC` (built-in default)

## `/runs` — filters and search

Single or compound filters on the run list, plus a text search command that accepts the same filter modifiers.

| Command | Filters by |
|---------|-----------|
| `/runs failed` | `status = failed` |
| `/runs done` | `status = done` |
| `/runs running` | `status = running` |
| `/runs queued` | `status = queued` |
| `/runs cancelled` | `status = cancelled` |
| `/runs kind=health` | `kind = health` |
| `/runs kind=<value>` | any `kind` value |
| `/runs <status> kind=<value>` | `status` AND `kind` (e.g. `failed kind=digest`) |
| `/runs last=<n>` | newest n records (overrides `listLimit`) |
| `/runs last=<n> <status>` | filter by `status`, then return the first `n` matches |
| `/runs last=<n> kind=<value>` | filter by `kind`, then return the first `n` matches |
| `/runs last=<n> <status> kind=<value>` | filter by `status` AND `kind`, then return the first `n` matches |
| `/runs offset=<n>` | skip the first n filtered results (0-based) |
| `/runs offset=<n> last=<m>` | skip n results, then return m |
| `/runs <status> offset=<n>` | filter by `status`, skip first n matches |
| `/runs search <text...>` | case-insensitive partial match on `normalized_task` and `raw_text`; multiple keywords are AND-matched |
| `/runs search <text...> [<status>] [kind=<value>] [last=<n>] [offset=<n>]` | search, then apply status/kind/last/offset |

Status, kind, `last=<n>`, and `offset=<n>` can be combined in any order. For example, `/runs last=5 failed` and `/runs failed last=5` are equivalent, and `/runs offset=10 last=5 failed` skips the first 10 failed runs and returns the next 5.

Duplicate status, kind, `last=`, or `offset=` conditions still return a usage hint.

### `/runs search` — text search with optional filters

`/runs search <text...>` searches `normalized_task` and `raw_text` with case-insensitive partial matching. Provide multiple space-separated keywords to AND-match: every keyword must appear somewhere in the run's task text or raw text for the run to be included. All filter modifiers (`<status>`, `kind=<value>`, `last=<n>`, `offset=<n>`) are optional and can be combined in any order.

**Evaluation order:**

1. Scan the `scanLimit` most recent records (default: 100)
2. Apply text search — all keywords must match (`normalized_task` / `raw_text`, case-insensitive AND)
3. Apply `status` and `kind` filters (AND)
4. Apply `offset=<n>` to skip the first n results (default: 0)
5. Apply `last=<n>` to cap the final result count

**Examples:**

| Command | What it returns |
|---------|----------------|
| `/runs search health` | runs whose task or text contains "health" |
| `/runs search health check` | runs containing **both** "health" **and** "check" |
| `/runs search health check failed` | AND-matching runs with `status = failed` |
| `/runs search health failed` | matching runs with `status = failed` |
| `/runs search health kind=digest` | matching runs with `kind = digest` |
| `/runs search health last=5` | up to 5 most recent matching runs |
| `/runs search health failed kind=digest last=3` | up to 3 most recent runs matching all three conditions |
| `/runs failed search health` | same as above — modifiers are order-independent |
| `/runs search health offset=10` | matching runs starting from the 11th result |
| `/runs search health offset=10 last=5` | matching runs 11–15 |

**Scope:** all `/runs` filters and `/runs search <text...>` scan at most `scanLimit` recent records (default: 100, configurable up to 1000). `offset=<n>` controls the starting position within filtered results; `last=<n>` and `listLimit` control the number of displayed results. Neither `offset=<n>` nor `last=<n>` expands the scan window — only `scanLimit` does.

**Note:** `/runs kind=health` and `/runs health` are distinct. `/runs health` shows a health summary dashboard; `/runs kind=health` filters the run list to records where `kind = health`.

## Config

Set under `plugins.entries.run-viewer.config`:

```json
{
  "plugins": {
    "entries": {
      "run-viewer": {
        "enabled": true,
        "config": {
          "runsDir": "~/.openclaw/runs",
          "listLimit": 10,
          "scanLimit": 100,
          "healthTimeZone": "Asia/Tokyo"
        }
      }
    }
  }
}
```

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `runsDir` | string | `~/.openclaw/runs` | Run store root directory |
| `listLimit` | number | `10` | Max records returned by `/runs` (hard cap: 50) |
| `scanLimit` | number | `100` | Number of recent runs to scan for filter and search operations (hard cap: 1000) |
| `healthTimeZone` | string | — | IANA timezone for `/runs health` (e.g. `Asia/Tokyo`, `America/Los_Angeles`) |

### Scan window vs. display limit

`scanLimit`, `offset=<n>`, and `listLimit` / `last=<n>` each serve a distinct purpose:

- **`scanLimit`** — how many records are read from disk when running a filter or search. A larger value lets you find older matching records at the cost of more disk reads. Applies to all filter/search commands (`/runs failed`, `/runs kind=<value>`, `/runs search <text...>`, and combinations). Automatically expanded when `offset + last` would exceed it (up to the hard cap of 1000).
- **`offset=<n>`** — starting position within the filtered results (0-based). Skips the first n matches. Does not expand the scan window on its own; the auto-expansion above handles it.
- **`listLimit` / `last=<n>`** — how many results are shown after filtering and offsetting. These do not expand the scan window.

Plain `/runs` (no arguments) reads only `listLimit` records and is not affected by `scanLimit` or `offset=<n>`.

### Display limit rules

| Situation | Display limit |
|-----------|--------------|
| `/runs` (no args) | `listLimit` (hard cap: 50) |
| `/runs <filter>` — no `last=` | `listLimit` (hard cap: 50) |
| `/runs search <text>` — no `last=` | `listLimit` (hard cap: 50) |
| Any command with `last=<n>` | `n` (ceiling: scan window, hard cap: 1000) |

`last=<n>` is the explicit override: it bypasses the 50-record cap and lets you request up to the scan window size (hard cap: 1000). Without `last=`, all commands — plain list, filter, and search — honour the same `listLimit` cap (≤ 50).

## Environment Variables

`RUN_VIEWER_HEALTH_TIME_ZONE` — fallback timezone for `/runs health` when `healthTimeZone` is not configured or is invalid.

```bash
export RUN_VIEWER_HEALTH_TIME_ZONE=Asia/Tokyo
```

`RUN_VIEWER_SCAN_LIMIT` — fallback scan limit for filter and search operations when `scanLimit` is not set in config. The value in config takes precedence; this environment variable is used only when `scanLimit` is absent from the plugin config.

```bash
export RUN_VIEWER_SCAN_LIMIT=500
```

## Install for dev

From the `ai-tools` repo root:

```bash
openclaw plugins install -l ./run-viewer-plugin
openclaw plugins enable run-viewer
```
