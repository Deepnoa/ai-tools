import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import plugin, {
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
  const dirPath = path.join(runsDir, dateDir);
  await fs.mkdir(dirPath, { recursive: true });
  await fs.writeFile(
    path.join(dirPath, `${record.run_id}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8",
  );
}

function makeRecord(overrides = {}) {
  const runId = overrides.run_id ?? "run_20260415_020112_a1b";
  const queuedAt = overrides.queued_at ?? "2026-04-15T02:01:12Z";
  const doneAt = overrides.done_at ?? queuedAt;
  const status = overrides.status ?? "done";

  return {
    run_id: runId,
    requested_by: "U_TEST",
    requested_by_name: "tester",
    channel_id: null,
    channel_name: "ops-general",
    raw_text: "health",
    kind: "health",
    normalized_task: "health",
    params: {},
    status,
    sense_job_id: null,
    queued_at: queuedAt,
    started_at: overrides.started_at ?? queuedAt,
    done_at: doneAt,
    result: {
      summary:
        overrides.result?.summary ??
        "The NemoClaw execution node reports a healthy state: all critical metrics are within normal thresholds, no error conditions detected.",
      key_points: overrides.result?.key_points ?? [
        "CPU utilization 15% (threshold 80%)",
        "Memory usage 40% of 16GB (threshold 75%)",
      ],
      suggested_next_action:
        overrides.result?.suggested_next_action ?? "Continue regular health monitoring.",
      exit_code: overrides.result?.exit_code ?? 0,
      raw_output: overrides.result?.raw_output ?? '{"summary":"ok"}',
    },
    error: null,
    retry_of: null,
    retry_count: 0,
    slack_ts: null,
    ...overrides,
  };
}

function getRunsHandler() {
  const commands = [];
  plugin.register({
    registerCommand(command) {
      commands.push(command);
    },
  });
  const runs = commands.find((command) => command.name === "runs");
  assert.ok(runs, "runs command should be registered");
  return runs.handler;
}

function makeContext(runsDir, args = "", listLimit = 10) {
  return {
    args,
    config: {
      plugins: {
        entries: {
          "run-viewer": {
            config: {
              runsDir,
              listLimit,
            },
          },
        },
      },
    },
  };
}

test("lists newer dates and newer files first", async () => {
  await withTempRunsDir(async (runsDir) => {
    await writeRun(
      runsDir,
      makeRecord({
        run_id: "run_20260414_235959_aaa",
        queued_at: "2026-04-14T23:59:59Z",
      }),
    );
    await writeRun(
      runsDir,
      makeRecord({
        run_id: "run_20260415_020111_aaa",
        queued_at: "2026-04-15T02:01:11Z",
      }),
    );
    await writeRun(
      runsDir,
      makeRecord({
        run_id: "run_20260415_020112_aab",
        queued_at: "2026-04-15T02:01:12Z",
      }),
    );

    const result = await getRunsHandler()(makeContext(runsDir, "", 10));

    assert.ok(result.text.indexOf("run_20260415_020112_aab") < result.text.indexOf("run_20260415_020111_aaa"));
    assert.ok(result.text.indexOf("run_20260415_020111_aaa") < result.text.indexOf("run_20260414_235959_aaa"));
  });
});

test("applies listLimit and clamps oversized values", async () => {
  await withTempRunsDir(async (runsDir) => {
    const date = "2026-04-15";
    for (let i = 0; i < 55; i += 1) {
      const seconds = String(i).padStart(2, "0");
      await writeRun(
        runsDir,
        makeRecord({
          run_id: `run_20260415_1200${seconds}_${String(i).padStart(3, "0")}`,
          queued_at: `${date}T12:00:${seconds}Z`,
        }),
      );
    }

    const result = await getRunsHandler()(makeContext(runsDir, "", 999));
    const runLines = result.text.split("\n").filter((line) => line.includes("`run_"));

    assert.equal(runLines.length, 50);
    assert.match(result.text, /\*直近の run 記録 \(50件\)\*/);
  });
});

test("skips broken JSON files and still returns the remaining runs", async () => {
  await withTempRunsDir(async (runsDir) => {
    await writeRun(
      runsDir,
      makeRecord({
        run_id: "run_20260415_020112_a1b",
        queued_at: "2026-04-15T02:01:12Z",
      }),
    );
    const dirPath = path.join(runsDir, "2026-04-15");
    await fs.writeFile(path.join(dirPath, "run_20260415_020113_bad.json"), "{not-json", "utf8");

    const result = await getRunsHandler()(makeContext(runsDir, "", 10));
    const runLines = result.text.split("\n").filter((line) => line.includes("`run_"));

    assert.equal(runLines.length, 1);
    assert.match(result.text, /run_20260415_020112_a1b/);
    assert.doesNotMatch(result.text, /run_20260415_020113_bad/);
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
