import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  findRunById,
  formatRunDetail,
  handleRunsCommand,
  listRuns,
} from "./index.js";

async function withTempRunsDir(fn) {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "run-viewer-plugin-"));
  const runsDir = path.join(tmpRoot, "runs");
  await fs.mkdir(runsDir, { recursive: true });
  try {
    await fn(runsDir);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
}

async function writeRun(runsDir, record) {
  const dateDir = record.queued_at.slice(0, 10);
  const dir = path.join(runsDir, dateDir);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${record.run_id}.json`);
  await fs.writeFile(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

function makeRecord(overrides = {}) {
  return {
    run_id: "run_20260415_020112_a1b",
    requested_by: "U123",
    requested_by_name: "taro",
    channel_id: "C0123456789",
    channel_name: "ops-general",
    raw_text: "health",
    kind: "health",
    normalized_task: "health",
    params: {},
    status: "done",
    sense_job_id: "df5bd58f-3ed5-4d15-b4ab-038bc8c01bfb",
    queued_at: "2026-04-15T02:01:12Z",
    started_at: "2026-04-15T02:01:13Z",
    done_at: "2026-04-15T02:02:14Z",
    result: {
      summary:
        "The NemoClaw execution node reports a healthy state: all critical metrics are within normal thresholds, no error conditions detected.",
      key_points: [
        "CPU utilization 15% (threshold 80%)",
        "Memory usage 40% of 16GB (threshold 75%)",
      ],
      suggested_next_action: "Continue regular health monitoring.",
      exit_code: 0,
      raw_output: '{"summary":"ok"}',
    },
    error: null,
    retry_of: null,
    retry_count: 0,
    slack_ts: null,
    ...overrides,
  };
}

function makeContext(runsDir, args = "") {
  return {
    args,
    config: {
      plugins: {
        entries: {
          "run-viewer": {
            config: {
              runsDir,
              listLimit: 10,
            },
          },
        },
      },
    },
  };
}

test("listRuns returns newest records first", async () => {
  await withTempRunsDir(async (runsDir) => {
    await writeRun(runsDir, makeRecord({ run_id: "run_20260414_235959_aaa", queued_at: "2026-04-14T23:59:59Z" }));
    await writeRun(runsDir, makeRecord({ run_id: "run_20260415_020112_a1b", queued_at: "2026-04-15T02:01:12Z" }));

    const runs = await listRuns(runsDir, 10);

    assert.equal(runs.length, 2);
    assert.equal(runs[0].run_id, "run_20260415_020112_a1b");
    assert.equal(runs[1].run_id, "run_20260414_235959_aaa");
  });
});

test("findRunById resolves a real run record by run_id", async () => {
  await withTempRunsDir(async (runsDir) => {
    const record = makeRecord();
    await writeRun(runsDir, record);

    const found = await findRunById(runsDir, record.run_id);

    assert.deepEqual(found, record);
  });
});

test("formatRunDetail includes schema-backed result fields", () => {
  const text = formatRunDetail(makeRecord());

  assert.match(text, /run 詳細: `run_20260415_020112_a1b`/);
  assert.match(text, /種別: `health`　状態: `done`/);
  assert.match(text, /結果:\* The NemoClaw execution node reports a healthy state/);
  assert.match(text, /CPU utilization 15% \(threshold 80%\)/);
  assert.match(text, /次のアクション:\* Continue regular health monitoring\./);
  assert.match(text, /一覧: `\/runs`/);
});

test("handleRunsCommand returns detail when given a run_id", async () => {
  await withTempRunsDir(async (runsDir) => {
    const record = makeRecord();
    await writeRun(runsDir, record);

    const result = await handleRunsCommand(makeContext(runsDir, record.run_id));

    assert.match(result.text, /run 詳細: `run_20260415_020112_a1b`/);
    assert.match(result.text, /All critical metrics are within normal thresholds/i);
  });
});

test("handleRunsCommand returns not-found message for missing run_id", async () => {
  await withTempRunsDir(async (runsDir) => {
    const result = await handleRunsCommand(makeContext(runsDir, "run_20260415_999999_zzz"));

    assert.match(result.text, /run が見つかりません: `run_20260415_999999_zzz`/);
    assert.match(result.text, /一覧: `\/runs`/);
  });
});
