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
- `/runs search <text>` — search recent runs by text
- `/runs search <text> [<status>] [kind=<value>] [last=<n>]` — search with optional filters
- `/runs <status>` — filter list by status (failed / done / running / queued / cancelled)
- `/runs kind=<value>` — filter list by kind (e.g. `kind=health`, `kind=digest`)
- `/runs <status> kind=<value>` — compound filter: status AND kind (e.g. `failed kind=digest`)
- `/runs last=<n>` — limit list to n most recent records

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
| `/runs search <text>` | case-insensitive partial match on `normalized_task` and `raw_text` |
| `/runs search <text> [<status>] [kind=<value>] [last=<n>]` | search, then apply status/kind/last |

Status, kind, and `last=<n>` can be combined in any order. For example, `/runs last=5 failed` and `/runs failed last=5` are equivalent, and `/runs last=5 failed kind=digest` returns the first 5 runs that match both filters.

Duplicate status, kind, or `last=` conditions still return a usage hint.

### `/runs search` — text search with optional filters

`/runs search <text>` searches `normalized_task` and `raw_text` with case-insensitive partial matching. All filter modifiers (`<status>`, `kind=<value>`, `last=<n>`) are optional and can be combined in any order.

**Evaluation order:**

1. Scan the 50 most recent records
2. Apply text search (`normalized_task` / `raw_text`, case-insensitive partial match)
3. Apply `status` and `kind` filters (AND)
4. Apply `last=<n>` to cap the final result count

**Examples:**

| Command | What it returns |
|---------|----------------|
| `/runs search health` | runs whose task or text contains "health" |
| `/runs search health failed` | matching runs with `status = failed` |
| `/runs search health kind=digest` | matching runs with `kind = digest` |
| `/runs search health last=5` | up to 5 most recent matching runs |
| `/runs search health failed kind=digest last=3` | up to 3 most recent runs matching all three conditions |
| `/runs failed search health` | same as above — modifiers are order-independent |

**Note:** status keywords (`failed`, `done`, `running`, `queued`, `cancelled`) are reserved and cannot be used as the search query itself. `/runs search failed` returns a usage hint.

**Scope:** all `/runs` filters and `/runs search <text>` scan at most the 50 most recent records. `last=<n>` limits the displayed results after filtering; it does not expand the scan window beyond 50.

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
| `healthTimeZone` | string | — | IANA timezone for `/runs health` (e.g. `Asia/Tokyo`, `America/Los_Angeles`) |

## Environment Variable

`RUN_VIEWER_HEALTH_TIME_ZONE` — fallback timezone for `/runs health` when `healthTimeZone` is not configured or is invalid.

```bash
export RUN_VIEWER_HEALTH_TIME_ZONE=Asia/Tokyo
```

## Install for dev

From the `ai-tools` repo root:

```bash
openclaw plugins install -l ./run-viewer-plugin
openclaw plugins enable run-viewer
```
