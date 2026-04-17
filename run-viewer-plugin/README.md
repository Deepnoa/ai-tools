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

## `/runs` — filters

Single or compound filters on the run list.

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

Compound filters accept status and kind in any order (`failed kind=digest` = `kind=digest failed`). Duplicate conditions and `last=` combined with other filters return a usage hint instead.

**Scope:** status and kind filters scan the 50 most recent records. Records outside that window are not searched.

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
