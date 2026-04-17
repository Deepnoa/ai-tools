# Run Viewer Plugin

OpenClaw plugin that exposes run record visibility through the `/runs` command.

## Commands

- `/runs` - list recent run records
- `/runs <run_id>` - show detail for a single run record
- `/runs retry <run_id>` - queue a retry for a failed or cancelled run
- `/runs health` - show today's run health summary
- `/runs health 7d` - show a relative health summary that includes today and the previous 6 days
- `/runs health YYYY-MM-DD` - show a health summary for one explicit calendar date
- `/runs health YYYY-MM-DD..YYYY-MM-DD` - show a health summary for an explicit date range

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

### `healthTimeZone`

- Optional IANA timezone name such as `UTC`, `Asia/Tokyo`, or `America/Los_Angeles`
- Used only by `/runs health` to decide what counts as "today" and how date ranges are interpreted
- If omitted, `/runs health` uses `UTC`
- If invalid, the plugin falls back in this order: config value, `RUN_VIEWER_HEALTH_TIME_ZONE`, then `UTC`

## Environment Variable

You can also set the timezone for `/runs health` with `RUN_VIEWER_HEALTH_TIME_ZONE`:

```bash
export RUN_VIEWER_HEALTH_TIME_ZONE=Asia/Tokyo
```

- This is used when `healthTimeZone` is not set, or when `healthTimeZone` is invalid
- If both the config value and the environment variable are invalid, `/runs health` falls back to `UTC`

## `/runs health` Date Basis

- `/runs health` supports these forms:
- `/runs health`
- `/runs health 7d`
- `/runs health YYYY-MM-DD`
- `/runs health YYYY-MM-DD..YYYY-MM-DD`
- The date or date range is always resolved in the configured timezone
- Single-date and explicit-range inputs must use real calendar dates
- Invalid inputs fall back to the command usage message instead of being normalized silently
- The default date basis is `UTC`
- The health summary output includes the active timezone so the "today" or range basis is visible at runtime

## Install for dev

From the `ai-tools` repo root:

```bash
openclaw plugins install -l ./run-viewer-plugin
openclaw plugins enable run-viewer
```
