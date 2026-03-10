const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_CURRENCY = "JPY";

const pluginConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    enabled: { type: "boolean" },
    baseUrl: { type: "string" },
    apiToken: { type: "string" },
    timeoutMs: { type: "number" },
    defaultCurrency: { type: "string" }
  }
};

function toJsonResult(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ],
    details: payload
  };
}

function normalizeBaseUrl(value) {
  const fallback = process.env.TASK_NOA_BASE_URL;
  const resolved = typeof value === "string" && value.trim() ? value : fallback;
  if (typeof resolved !== "string" || !resolved.trim()) {
    throw new Error("task-noa plugin requires config.baseUrl");
  }
  return resolved.replace(/\/+$/, "");
}

function readTimeoutMs(value) {
  if (typeof value === "number" && value > 0) {
    return value;
  }
  const fallback = Number(process.env.TASK_NOA_TIMEOUT_MS);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : DEFAULT_TIMEOUT_MS;
}

function readApiToken(value) {
  const fallback = process.env.TASK_NOA_API_TOKEN;
  const resolved = typeof value === "string" && value.trim() ? value : fallback;
  if (typeof resolved !== "string" || !resolved.trim()) {
    throw new Error("task-noa plugin requires config.apiToken");
  }
  return resolved.trim();
}

function buildUrl(baseUrl, pathName, params) {
  const url = new URL(`${baseUrl}${pathName}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  return url;
}

async function fetchJson({ baseUrl, apiToken, pathName, params, timeoutMs }) {
  const url = buildUrl(baseUrl, pathName, params);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/json"
      },
      signal: controller.signal
    });

    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text };
    }

    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && typeof payload.error === "string"
          ? payload.error
          : `Task-Noa API request failed (${response.status})`;
      throw new Error(message);
    }

    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function createTaskNoaTool({ name, description, pathName, buildParams, resultLabel }) {
  return (api) => ({
    name,
    description,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: buildParams.schema,
      required: buildParams.required ?? []
    },
    async execute(_callId, params) {
      const cfg = api.pluginConfig ?? {};
      const baseUrl = normalizeBaseUrl(cfg.baseUrl);
      const apiToken = readApiToken(cfg.apiToken);
      const timeoutMs = readTimeoutMs(cfg.timeoutMs);
      const payload = await fetchJson({
        baseUrl,
        apiToken,
        pathName,
        params: buildParams.map(params),
        timeoutMs
      });

      const defaultCurrency =
        typeof cfg.defaultCurrency === "string" && cfg.defaultCurrency.trim()
          ? cfg.defaultCurrency.trim()
          : typeof process.env.TASK_NOA_DEFAULT_CURRENCY === "string" &&
              process.env.TASK_NOA_DEFAULT_CURRENCY.trim()
            ? process.env.TASK_NOA_DEFAULT_CURRENCY.trim()
          : DEFAULT_CURRENCY;

      if (payload && typeof payload === "object" && !Array.isArray(payload) && !payload.currency) {
        payload.currency = defaultCurrency;
      }

      return toJsonResult({
        tool: resultLabel,
        ok: true,
        data: payload
      });
    }
  });
}

const tools = [
  createTaskNoaTool({
    name: "get_monthly_sales",
    description: "Task-Noa から月次売上サマリを取得する。",
    pathName: "/api/ai/sales-summary",
    resultLabel: "monthly_sales",
    buildParams: {
      schema: {
        period: {
          type: "string",
          description: "対象月。YYYY-MM。省略時は当月。"
        }
      },
      map: (params) => ({
        period: typeof params.period === "string" ? params.period : undefined
      })
    }
  }),
  createTaskNoaTool({
    name: "get_unpaid_invoices",
    description: "Task-Noa から未回収請求サマリを取得する。",
    pathName: "/api/ai/unpaid-invoices",
    resultLabel: "unpaid_invoices",
    buildParams: {
      schema: {
        as_of: {
          type: "string",
          description: "基準日。YYYY-MM-DD。省略時は今日。"
        }
      },
      map: (params) => ({
        as_of: typeof params.as_of === "string" ? params.as_of : undefined
      })
    }
  }),
  createTaskNoaTool({
    name: "get_cash_balance",
    description: "Task-Noa から月次資金繰りサマリを取得する。",
    pathName: "/api/ai/cashflow",
    resultLabel: "cashflow",
    buildParams: {
      schema: {
        period: {
          type: "string",
          description: "対象月。YYYY-MM。省略時は当月。"
        }
      },
      map: (params) => ({
        period: typeof params.period === "string" ? params.period : undefined
      })
    }
  }),
  createTaskNoaTool({
    name: "get_recent_journals",
    description: "Task-Noa から最近の仕訳一覧を取得する。",
    pathName: "/api/ai/recent-journals",
    resultLabel: "recent_journals",
    buildParams: {
      schema: {
        limit: {
          type: "number",
          description: "件数。省略時は20。最大100。"
        }
      },
      map: (params) => ({
        limit: typeof params.limit === "number" ? params.limit : undefined
      })
    }
  }),
  createTaskNoaTool({
    name: "list_recent_captures",
    description: "Task-Noa に保存された最新 capture 一覧を取得する。",
    pathName: "/api/ai/captures",
    resultLabel: "recent_captures",
    buildParams: {
      schema: {
        entity_type: {
          type: "string",
          description: "対象 entity_type。journal_entries / invoices / sales_summary。省略時は全件。"
        },
        limit: {
          type: "number",
          description: "件数。省略時は20。最大100。"
        }
      },
      map: (params) => ({
        entity_type: typeof params.entity_type === "string" ? params.entity_type : undefined,
        limit: typeof params.limit === "number" ? params.limit : undefined
      })
    }
  }),
  createTaskNoaTool({
    name: "get_capture_by_id",
    description: "Task-Noa に保存された capture を ID 指定で取得する。",
    pathName: "/api/ai/captures",
    resultLabel: "capture_by_id",
    buildParams: {
      schema: {
        capture_id: {
          type: "string",
          description: "取得したい capture_id。"
        }
      },
      required: ["capture_id"],
      map: (params) => ({}),
    }
  }),
  createTaskNoaTool({
    name: "get_latest_capture_by_entity_type",
    description: "Task-Noa に保存された特定 entity_type の最新 capture を取得する。",
    pathName: "/api/ai/captures",
    resultLabel: "latest_capture_by_entity_type",
    buildParams: {
      schema: {
        entity_type: {
          type: "string",
          description: "対象 entity_type。journal_entries / invoices / sales_summary。"
        }
      },
      required: ["entity_type"],
      map: (params) => ({
        entity_type: typeof params.entity_type === "string" ? params.entity_type : undefined,
        limit: 1
      })
    }
  })
];

const specialExecutors = {
  async get_capture_by_id(api, params) {
    const cfg = api.pluginConfig ?? {};
    const baseUrl = normalizeBaseUrl(cfg.baseUrl);
    const apiToken = readApiToken(cfg.apiToken);
    const timeoutMs = readTimeoutMs(cfg.timeoutMs);
    const captureId = typeof params.capture_id === "string" ? params.capture_id.trim() : "";
    if (!captureId) {
      throw new Error("capture_id is required");
    }
    const payload = await fetchJson({
      baseUrl,
      apiToken,
      pathName: `/api/ai/captures/${encodeURIComponent(captureId)}`,
      params: {},
      timeoutMs
    });
    return toJsonResult({
      tool: "capture_by_id",
      ok: true,
      data: payload
    });
  },
  async get_latest_capture_by_entity_type(api, params) {
    const cfg = api.pluginConfig ?? {};
    const baseUrl = normalizeBaseUrl(cfg.baseUrl);
    const apiToken = readApiToken(cfg.apiToken);
    const timeoutMs = readTimeoutMs(cfg.timeoutMs);
    const entityType = typeof params.entity_type === "string" ? params.entity_type.trim() : "";
    if (!entityType) {
      throw new Error("entity_type is required");
    }
    const payload = await fetchJson({
      baseUrl,
      apiToken,
      pathName: "/api/ai/captures",
      params: {
        entity_type: entityType,
        limit: 1
      },
      timeoutMs
    });
    const latestCapture =
      payload && typeof payload === "object" && Array.isArray(payload.items) ? payload.items[0] ?? null : null;
    return toJsonResult({
      tool: "latest_capture_by_entity_type",
      ok: true,
      data: latestCapture,
      source_list: payload
    });
  }
};

const plugin = {
  id: "task-noa-tools",
  name: "Task-Noa Tools",
  description: "Task-Noa AI API bridge for Openclaw.",
  configSchema: pluginConfigSchema,
  register(api) {
    for (const build of tools) {
      const tool = build(api);
      if (specialExecutors[tool.name]) {
        const execute = specialExecutors[tool.name];
        api.registerTool(
          {
            ...tool,
            async execute(callId, params) {
              return execute(api, params, callId);
            }
          },
          { optional: true }
        );
        continue;
      }
      api.registerTool(tool, { optional: true });
    }
  }
};

export default plugin;
