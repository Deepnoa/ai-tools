# Task-Noa Openclaw Plugin

Optional Openclaw plugin that bridges to Task-Noa's internal AI API.

## Tools

- `get_monthly_sales`
- `get_unpaid_invoices`
- `get_cash_balance`
- `get_recent_journals`

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
            "get_recent_journals"
          ]
        }
      }
    ]
  }
}
```

## Install for dev

From the Openclaw checkout:

```bash
openclaw plugins install -l /home/deepnoa/ai-tools/task-noa-openclaw-plugin
openclaw plugins enable task-noa-tools
```
