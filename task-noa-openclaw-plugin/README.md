# Task-Noa Openclaw Plugin

Optional Openclaw plugin that bridges to Task-Noa's internal AI API.

## Tools

- `get_monthly_sales`
- `get_unpaid_invoices`
- `get_cash_balance`
- `get_recent_journals`
- `list_recent_captures`
- `get_capture_by_id`
- `get_latest_capture_by_entity_type`

## Config

Set under `plugins.entries.task-noa-tools.config`:

```json
{
  "plugins": {
    "entries": {
      "task-noa-tools": {
        "enabled": true,
        "config": {
          "baseUrl": "http://127.0.0.1:3000",
          "apiToken": "replace-with-task-noa-ai-token",
          "timeoutMs": 5000,
          "defaultCurrency": "JPY"
        }
      }
    }
  }
}
```

Agent allowlist example:

```json
{
  "agents": {
    "list": [
      {
        "id": "main",
        "tools": {
          "allow": [
            "task-noa-tools",
            "get_monthly_sales",
            "get_unpaid_invoices",
            "get_cash_balance",
            "get_recent_journals",
            "list_recent_captures",
            "get_capture_by_id",
            "get_latest_capture_by_entity_type"
          ]
        }
      }
    ]
  }
}
```

## Capture API expectations

The capture-reading tools expect these internal Task-Noa routes:

- `POST /api/ai/capture`
- `GET /api/ai/captures`
- `GET /api/ai/captures/:id`

`list_recent_captures` and `get_latest_capture_by_entity_type` read from `GET /api/ai/captures`.
`get_capture_by_id` reads from `GET /api/ai/captures/:id`.

## Install for dev

From the Openclaw checkout:

```bash
openclaw plugins install -l /home/deepnoa/ai-tools/task-noa-openclaw-plugin
openclaw plugins enable task-noa-tools
```
