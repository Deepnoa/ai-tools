# Run Viewer Plugin

OpenClaw plugin that exposes run record visibility through the `/runs` command.

## Commands

- `/runs` - list recent run records
- `/runs <run_id>` - show detail for a single run record
- `/runs retry <run_id>` - queue a retry for a failed or cancelled run
- `/runs health` - show today's run health summary

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
- Used only by `/runs health` to decide what counts as "today"
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

- `/runs health` reads the run store directory for one calendar date
- The calendar date is resolved in the configured timezone
- The default date basis is `UTC`
- The health summary output includes the active timezone so the "today" basis is visible at runtime

## Install for dev

From the OpenClaw checkout:

```bash
openclaw plugins install -l /home/deepnoa/ai-tools/run-viewer-plugin
openclaw plugins enable run-viewer
```
