import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import plugin, {
  findRunById,
  formatRunId,
  formatHealthSummary,
  formatRunDetail,
  handleRunsCommand,
  listRuns,
  loadRunsForDate,
  summarizeRunsHealth,
  writeRunRecord,
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

test("formatRunId returns canonical run_id format", () => {
  const runId = formatRunId(new Date("2026-04-15T03:04:05Z"));
  assert.match(runId, /^run_20260415_030405_[a-f0-9]{3}$/);
});

test("writeRunRecord stores a retry record under the date derived from run_id", async () => {
  await withTempRunsDir(async (runsDir) => {
    const record = makeRecord({
      run_id: "run_20260415_030405_abc",
      queued_at: "2026-04-15T03:04:05Z",
      status: "queued",
      result: null,
    });

    const filePath = await writeRunRecord(runsDir, record);
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);

    assert.match(filePath, /2026-04-15\/run_20260415_030405_abc\.json$/);
    assert.deepEqual(parsed, record);
  });
});

test("handleRunsCommand creates a queued retry record for failed runs", async () => {
  await withTempRunsDir(async (runsDir) => {
    const original = makeRecord({
      run_id: "run_20260415_105041_ece",
      queued_at: "2026-04-15T10:50:41.274510Z",
      started_at: "2026-04-15T10:50:43.274510Z",
      done_at: "2026-04-15T10:50:50.274510Z",
      status: "failed",
      result: null,
      error: {
        message: "Sense worker 接続タイムアウト",
        detail: "request failed: timed out",
      },
      retry_of: null,
      retry_count: 0,
    });
    await writeRun(runsDir, original);

    const result = await handleRunsCommand(makeContext(runsDir, "retry run_20260415_105041_ece"));

    assert.match(result.text, /retry を受付しました/);
    assert.match(result.text, /元 run: `run_20260415_105041_ece`/);

    const runs = await listRuns(runsDir, 10);
    const retried = runs.find((run) => run.retry_of === original.run_id);
    assert.ok(retried);
    assert.equal(retried.status, "queued");
    assert.equal(retried.retry_count, 1);
    assert.equal(retried.retry_of, original.run_id);
    assert.equal(retried.raw_text, original.raw_text);
    assert.equal(retried.kind, original.kind);
    assert.equal(retried.result, null);
    assert.equal(retried.error, null);
    assert.equal(retried.started_at, null);
    assert.equal(retried.done_at, null);
  });
});

test("handleRunsCommand refuses retry for non-retryable status", async () => {
  await withTempRunsDir(async (runsDir) => {
    const original = makeRecord({
      run_id: "run_20260415_020112_a1b",
      queued_at: "2026-04-15T02:01:12Z",
      status: "done",
    });
    await writeRun(runsDir, original);

    const result = await handleRunsCommand(makeContext(runsDir, "retry run_20260415_020112_a1b"));

    assert.match(result.text, /再実行できません: `run_20260415_020112_a1b` は status=`done` です/);
    assert.match(result.text, /failed` または `cancelled`/);
  });
});

test("handleRunsCommand returns not-found for missing retry target", async () => {
  await withTempRunsDir(async (runsDir) => {
    const result = await handleRunsCommand(makeContext(runsDir, "retry run_20260415_999999_zzz"));

    assert.match(result.text, /run が見つかりません: `run_20260415_999999_zzz`/);
  });
});

test("loadRunsForDate returns newest runs for a specific date only", async () => {
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

    const runs = await loadRunsForDate(runsDir, "2026-04-15");
    assert.equal(runs.length, 2);
    assert.equal(runs[0].run_id, "run_20260415_020112_aab");
    assert.equal(runs[1].run_id, "run_20260415_020111_aaa");
  });
});

test("summarizeRunsHealth aggregates counts and latest failed run", () => {
  const runs = [
    makeRecord({
      run_id: "run_20260415_120003_ccc",
      queued_at: "2026-04-15T12:00:03Z",
      status: "failed",
      result: null,
      error: { message: "Sense worker 接続タイムアウト" },
    }),
    makeRecord({
      run_id: "run_20260415_120002_bbb",
      queued_at: "2026-04-15T12:00:02Z",
      status: "running",
      done_at: null,
    }),
    makeRecord({
      run_id: "run_20260415_120001_aaa",
      queued_at: "2026-04-15T12:00:01Z",
      status: "done",
    }),
  ];

  const summary = summarizeRunsHealth(runs, "2026-04-15");
  assert.equal(summary.total, 3);
  assert.equal(summary.counts.failed, 1);
  assert.equal(summary.counts.running, 1);
  assert.equal(summary.counts.done, 1);
  assert.equal(summary.overallStatus, "degraded");
  assert.equal(summary.latestFailed.run_id, "run_20260415_120003_ccc");
});

test("handleRunsCommand health does not undercount when a day has more than 200 runs", async () => {
  await withTempRunsDir(async (runsDir) => {
    const today = new Date().toISOString().slice(0, 10);
    const datePrefix = today.replaceAll("-", "");

    for (let i = 0; i < 205; i += 1) {
      const minutes = String(Math.floor(i / 60)).padStart(2, "0");
      const seconds = String(i % 60).padStart(2, "0");
      await writeRun(
        runsDir,
        makeRecord({
          run_id: `run_${datePrefix}_12${minutes}${seconds}_${String(i).padStart(3, "0")}`,
          queued_at: `${today}T12:${minutes}:${seconds}Z`,
          status: i < 3 ? "failed" : "done",
          result: i < 3 ? null : undefined,
          error: i < 3 ? { message: `failed-${i}` } : null,
        }),
      );
    }

    const result = await handleRunsCommand(makeContext(runsDir, "health"));

    assert.match(result.text, /done: 202/);
    assert.match(result.text, /failed: 3/);
    assert.match(result.text, /total: 205/);
  });
});

test("summarizeRunsHealth selects latest failed by timestamp instead of input order", () => {
  const runs = [
    makeRecord({
      run_id: "run_20260415_120003_ccc",
      queued_at: "2026-04-15T12:00:03Z",
      status: "done",
    }),
    makeRecord({
      run_id: "run_20260415_120001_aaa",
      queued_at: "2026-04-15T12:00:01Z",
      status: "failed",
      result: null,
      error: { message: "older failed" },
    }),
    makeRecord({
      run_id: "run_20260415_120002_bbb",
      queued_at: "2026-04-15T12:00:02Z",
      status: "failed",
      result: null,
      error: { message: "newer failed" },
    }),
  ];

  const summary = summarizeRunsHealth(runs, "2026-04-15");

  assert.equal(summary.counts.failed, 2);
  assert.equal(summary.latestFailed.run_id, "run_20260415_120002_bbb");
});

test("formatHealthSummary renders counts and latest failed run", () => {
  const summary = summarizeRunsHealth([
    makeRecord({
      run_id: "run_20260415_120003_ccc",
      queued_at: "2026-04-15T12:00:03Z",
      kind: "digest",
      status: "failed",
      result: null,
      error: { message: "Sense worker 接続タイムアウト" },
    }),
    makeRecord({
      run_id: "run_20260415_120001_aaa",
      queued_at: "2026-04-15T12:00:01Z",
      status: "done",
    }),
  ], "2026-04-15");

  const text = formatHealthSummary(summary);
  assert.match(text, /\*run health \(2026-04-15\)\*/);
  assert.match(text, /queued: 0 \| running: 0 \| done: 1 \| failed: 1 \| cancelled: 0/);
  assert.match(text, /\*最新 failed:\* `run_20260415_120003_ccc` \(digest\)/);
  assert.match(text, /エラー: Sense worker 接続タイムアウト/);
});

test("handleRunsCommand returns today's health summary", async () => {
  await withTempRunsDir(async (runsDir) => {
    const today = new Date().toISOString().slice(0, 10);
    await writeRun(
      runsDir,
      makeRecord({
        run_id: `run_${today.replaceAll("-", "")}_120003_ccc`,
        queued_at: `${today}T12:00:03Z`,
        kind: "digest",
        status: "failed",
        result: null,
        error: { message: "Sense worker 接続タイムアウト" },
      }),
    );
    await writeRun(
      runsDir,
      makeRecord({
        run_id: `run_${today.replaceAll("-", "")}_120001_aaa`,
        queued_at: `${today}T12:00:01Z`,
        status: "done",
      }),
    );

    const result = await handleRunsCommand(makeContext(runsDir, "health"));

    assert.match(result.text, /\*run health \(/);
    assert.match(result.text, /failed: 1/);
    assert.match(result.text, /run_.*120003_ccc/);
  });
});
