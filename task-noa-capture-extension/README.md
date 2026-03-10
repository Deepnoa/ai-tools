# Task-Noa Capture Extension PoC

Chrome extension PoC that captures visible Task-Noa page data from an already logged-in browser session and posts it to a local backend.

## Scope

- No login automation
- No credential storage
- Reads only the currently visible DOM
- First site adapter: `task-noa`

## AI Native JSON

The extension normalizes captures into a shared envelope:

```json
{
  "schema_version": "2026-03-10",
  "source": "chrome-extension",
  "source_type": "business_web_app",
  "entity_type": "journal_entries",
  "entity_id": "59c27ca6-e8c4-443b-b6a2-69ca5eba3543",
  "captured_at": "2026-03-10T03:00:00.000Z",
  "url": "http://127.0.0.1:3000/journal",
  "title": "仕訳一覧",
  "summary": "仕訳一覧",
  "items": [],
  "raw_text": "visible page text",
  "metadata": {
    "site_id": "task-noa",
    "adapter_id": "task-noa-visible-table",
    "adapter_version": "0.1.0",
    "page_path": "/journal",
    "page_label": "仕訳一覧",
    "visible_tables": []
  }
}
```

## Install

1. Open `chrome://extensions`
2. Enable Developer Mode
3. Load unpacked
4. Select `/Volumes/deepnoa/ai-tools/task-noa-capture-extension`

## Configure

- Backend URL: `http://127.0.0.1:3000/api/ai/capture`
- API Token: use the same bearer token configured for `Task-Noa` AI API

## Adapter design

Adapters live under `src/adapters/`.
Each adapter provides:

- `matches()`
- `capture()`

Future site-specific adapters can be added without changing the popup or background flow.
