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
  getHealthDate,
  handleRunsCommand,
  listRuns,
  loadRunsForHealthRange,
  loadRunsForDate,
  parseListFilter,
  resolveHealthRange,
  resolveHealthTimeZone,
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

function makeContext(runsDir, args = "", listLimit = 10, overrides = {}) {
  return {
    args,
    ...overrides,
    config: {
      plugins: {
        entries: {
          "run-viewer": {
            config: {
              runsDir,
              listLimit,
              ...overrides.config?.plugins?.entries?.["run-viewer"]?.config,
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

  const summary = summarizeRunsHealth(runs, "2026-04-15", {
    timeZone: "UTC",
    startDate: "2026-04-15",
    endDate: "2026-04-15",
  });
  assert.equal(summary.total, 3);
  assert.equal(summary.counts.failed, 1);
  assert.equal(summary.counts.running, 1);
  assert.equal(summary.counts.done, 1);
  assert.equal(summary.failedCount, 1);
  assert.equal(summary.overallStatus, "degraded");
  assert.equal(summary.latestFailed.run_id, "run_20260415_120003_ccc");
  assert.deepEqual(summary.dailyCounts, [
    {
      date: "2026-04-15",
      counts: {
        queued: 0,
        running: 1,
        done: 1,
        failed: 1,
        cancelled: 0,
      },
    },
  ]);
});

test("resolveHealthTimeZone defaults to UTC and falls back on invalid values", () => {
  assert.equal(resolveHealthTimeZone({}), "UTC");
  assert.equal(resolveHealthTimeZone({ healthTimeZone: "Asia/Tokyo" }), "Asia/Tokyo");
  assert.equal(resolveHealthTimeZone({ healthTimeZone: "Invalid/Timezone" }), "UTC");
});

test("resolveHealthTimeZone falls back from invalid config to valid env", () => {
  const original = process.env.RUN_VIEWER_HEALTH_TIME_ZONE;
  process.env.RUN_VIEWER_HEALTH_TIME_ZONE = "Asia/Tokyo";

  try {
    assert.equal(
      resolveHealthTimeZone({ healthTimeZone: "Invalid/Timezone" }),
      "Asia/Tokyo",
    );
  } finally {
    if (original == null) {
      delete process.env.RUN_VIEWER_HEALTH_TIME_ZONE;
    } else {
      process.env.RUN_VIEWER_HEALTH_TIME_ZONE = original;
    }
  }
});

test("getHealthDate uses configured timezone to decide today's date", () => {
  const now = new Date("2026-04-15T23:30:00Z");

  assert.deepEqual(getHealthDate(now, {}), {
    date: "2026-04-15",
    timeZone: "UTC",
  });
  assert.deepEqual(getHealthDate(now, { healthTimeZone: "Asia/Tokyo" }), {
    date: "2026-04-16",
    timeZone: "Asia/Tokyo",
  });
});

test("resolveHealthRange supports relative and explicit ranges", () => {
  const now = new Date("2026-04-15T23:30:00Z");

  assert.deepEqual(resolveHealthRange("", now, {}), {
    startDate: "2026-04-15",
    endDate: "2026-04-15",
    label: "2026-04-15",
    timeZone: "UTC",
  });
  assert.deepEqual(resolveHealthRange("3d", now, {}), {
    startDate: "2026-04-13",
    endDate: "2026-04-15",
    label: "2026-04-13..2026-04-15",
    timeZone: "UTC",
  });
  assert.deepEqual(resolveHealthRange("2026-04-10..2026-04-12", now, {}), {
    startDate: "2026-04-10",
    endDate: "2026-04-12",
    label: "2026-04-10..2026-04-12",
    timeZone: "UTC",
  });
});

test("loadRunsForHealthRange filters by health timezone date instead of directory name alone", async () => {
  await withTempRunsDir(async (runsDir) => {
    await writeRun(
      runsDir,
      makeRecord({
        run_id: "run_20260415_160000_tokyo",
        queued_at: "2026-04-15T16:00:00Z",
        status: "done",
      }),
    );
    await writeRun(
      runsDir,
      makeRecord({
        run_id: "run_20260416_150000_tokyo",
        queued_at: "2026-04-16T15:00:00Z",
        status: "done",
      }),
    );

    const runs = await loadRunsForHealthRange(
      runsDir,
      "2026-04-16",
      "2026-04-16",
      "Asia/Tokyo",
    );

    assert.equal(runs.length, 1);
    assert.equal(runs[0].run_id, "run_20260415_160000_tokyo");
  });
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
  const summary = {
    ...summarizeRunsHealth([
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
  ], "2026-04-15", {
    timeZone: "Asia/Tokyo",
    startDate: "2026-04-15",
    endDate: "2026-04-15",
  }),
  };

  const text = formatHealthSummary(summary);
  assert.match(text, /\*run health \(2026-04-15\)\*/);
  assert.match(text, /timezone: Asia\/Tokyo/);
  assert.match(text, /status: degraded \(failed=1 in 2026-04-15\)/);
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
    assert.match(result.text, /timezone: UTC/);
    assert.match(result.text, /status: degraded \(failed=1 in /);
    assert.match(result.text, /failed: 1/);
    assert.match(result.text, /run_.*120003_ccc/);
  });
});

test("handleRunsCommand health uses configured timezone at date boundaries", async () => {
  await withTempRunsDir(async (runsDir) => {
    await writeRun(
      runsDir,
      makeRecord({
        run_id: "run_20260416_080000_tokyo",
        queued_at: "2026-04-16T08:00:00Z",
        status: "done",
      }),
    );

    const result = await handleRunsCommand(
      makeContext(runsDir, "health", 10, {
        now: new Date("2026-04-15T23:30:00Z"),
        config: {
          plugins: {
            entries: {
              "run-viewer": {
                config: {
                  healthTimeZone: "Asia/Tokyo",
                },
              },
            },
          },
        },
      }),
    );

    assert.match(result.text, /\*run health \(2026-04-16\)\*/);
    assert.match(result.text, /timezone: Asia\/Tokyo/);
    assert.match(result.text, /status: ok \(failed=0\)/);
    assert.match(result.text, /done: 1/);
    assert.match(result.text, /total: 1/);
  });
});

test("handleRunsCommand health supports relative day ranges", async () => {
  await withTempRunsDir(async (runsDir) => {
    await writeRun(
      runsDir,
      makeRecord({
        run_id: "run_20260413_120001_old",
        queued_at: "2026-04-13T12:00:01Z",
        status: "done",
      }),
    );
    await writeRun(
      runsDir,
      makeRecord({
        run_id: "run_20260414_120002_mid",
        queued_at: "2026-04-14T12:00:02Z",
        status: "running",
        done_at: null,
      }),
    );
    await writeRun(
      runsDir,
      makeRecord({
        run_id: "run_20260415_120003_new",
        queued_at: "2026-04-15T12:00:03Z",
        status: "failed",
        result: null,
        error: { message: "latest failure" },
      }),
    );

    const result = await handleRunsCommand(
      makeContext(runsDir, "health 3d", 10, {
        now: new Date("2026-04-15T23:30:00Z"),
      }),
    );

    assert.match(result.text, /\*run health \(2026-04-13\.\.2026-04-15\)\*/);
    assert.match(result.text, /status: degraded \(failed=1 in 2026-04-13\.\.2026-04-15\)/);
    assert.match(result.text, /done: 1/);
    assert.match(result.text, /running: 1/);
    assert.match(result.text, /failed: 1/);
    assert.match(result.text, /\*daily summary:\*/);
    assert.match(result.text, /2026-04-15: done=0 \| failed=1/);
    assert.match(result.text, /2026-04-14: done=0 \| failed=0 \| running=1/);
    assert.match(result.text, /2026-04-13: done=1 \| failed=0/);
    assert.match(result.text, /run_20260415_120003_new/);
  });
});

test("handleRunsCommand health supports explicit date ranges", async () => {
  await withTempRunsDir(async (runsDir) => {
    await writeRun(
      runsDir,
      makeRecord({
        run_id: "run_20260410_120001_a",
        queued_at: "2026-04-10T12:00:01Z",
        status: "failed",
        result: null,
        error: { message: "older failure" },
      }),
    );
    await writeRun(
      runsDir,
      makeRecord({
        run_id: "run_20260412_120003_c",
        queued_at: "2026-04-12T12:00:03Z",
        status: "failed",
        result: null,
        error: { message: "newer failure" },
      }),
    );
    await writeRun(
      runsDir,
      makeRecord({
        run_id: "run_20260413_120004_d",
        queued_at: "2026-04-13T12:00:04Z",
        status: "done",
      }),
    );

    const result = await handleRunsCommand(
      makeContext(runsDir, "health 2026-04-10..2026-04-12"),
    );

    assert.match(result.text, /\*run health \(2026-04-10\.\.2026-04-12\)\*/);
    assert.match(result.text, /status: degraded \(failed=2 in 2026-04-10\.\.2026-04-12\)/);
    assert.match(result.text, /failed: 2/);
    assert.match(result.text, /total: 2/);
    assert.match(result.text, /2026-04-12: done=0 \| failed=1/);
    assert.match(result.text, /2026-04-11: done=0 \| failed=0/);
    assert.match(result.text, /2026-04-10: done=0 \| failed=1/);
    assert.match(result.text, /run_20260412_120003_c/);
    assert.doesNotMatch(result.text, /run_20260413_120004_d/);
  });
});

test("handleRunsCommand health returns usage for invalid range input", async () => {
  await withTempRunsDir(async (runsDir) => {
    const result = await handleRunsCommand(makeContext(runsDir, "health 2026-04-12..2026-04-10"));

    assert.match(result.text, /health の期間指定が不正です/);
    assert.match(result.text, /\/runs health 7d/);
  });
});

test("handleRunsCommand health returns usage for invalid single calendar date", async () => {
  await withTempRunsDir(async (runsDir) => {
    const result = await handleRunsCommand(makeContext(runsDir, "health 2026-02-31"));

    assert.match(result.text, /health の期間指定が不正です/);
    assert.match(result.text, /\/runs health 2026-04-15/);
  });
});

test("handleRunsCommand health returns usage when explicit range contains invalid calendar date", async () => {
  await withTempRunsDir(async (runsDir) => {
    const result = await handleRunsCommand(makeContext(runsDir, "health 2026-02-28..2026-02-31"));

    assert.match(result.text, /health の期間指定が不正です/);
    assert.match(result.text, /\/runs health 2026-04-15..2026-04-17/);
  });
});

// ── Filter tests ───────────────────────────────────────────────────────────────

test("parseListFilter recognizes all status values as compound filter", () => {
  for (const status of ["queued", "running", "done", "failed", "cancelled"]) {
    assert.deepEqual(parseListFilter(status), { type: "compound", status, kind: null, last: null });
  }
});

test("parseListFilter recognizes kind= filter as compound filter", () => {
  assert.deepEqual(parseListFilter("kind=health"), { type: "compound", status: null, kind: "health", last: null });
  assert.deepEqual(parseListFilter("kind=digest"), { type: "compound", status: null, kind: "digest", last: null });
  assert.deepEqual(parseListFilter("kind=free-form_task"), { type: "compound", status: null, kind: "free-form_task", last: null });
});

test("parseListFilter recognizes last= filter", () => {
  assert.deepEqual(parseListFilter("last=5"), { type: "compound", status: null, kind: null, last: 5 });
  assert.deepEqual(parseListFilter("last=20"), { type: "compound", status: null, kind: null, last: 20 });
});

test("parseListFilter recognizes compound status + kind filter (order-independent)", () => {
  assert.deepEqual(
    parseListFilter("failed kind=digest"),
    { type: "compound", status: "failed", kind: "digest", last: null },
  );
  assert.deepEqual(
    parseListFilter("kind=health done"),
    { type: "compound", status: "done", kind: "health", last: null },
  );
});

test("parseListFilter recognizes last= combined with status or kind", () => {
  assert.deepEqual(
    parseListFilter("last=5 failed"),
    { type: "compound", status: "failed", kind: null, last: 5 },
  );
  assert.deepEqual(
    parseListFilter("kind=health last=2"),
    { type: "compound", status: null, kind: "health", last: 2 },
  );
  assert.deepEqual(
    parseListFilter("failed kind=digest last=3"),
    { type: "compound", status: "failed", kind: "digest", last: 3 },
  );
});

test("parseListFilter rejects duplicate status tokens", () => {
  assert.equal(parseListFilter("failed done"), null);
  assert.equal(parseListFilter("running queued"), null);
});

test("parseListFilter rejects duplicate kind tokens", () => {
  assert.equal(parseListFilter("kind=health kind=digest"), null);
});

test("parseListFilter rejects duplicate last tokens", () => {
  assert.equal(parseListFilter("last=5 last=10"), null);
});

test("parseListFilter returns null for unrecognized or invalid input", () => {
  assert.equal(parseListFilter("unknown"), null);
  assert.equal(parseListFilter("kind="), null);       // empty kind value
  assert.equal(parseListFilter("last=0"), null);      // zero is not valid
  assert.equal(parseListFilter("last=abc"), null);    // non-numeric
  assert.equal(parseListFilter(""), null);            // empty (handled by list branch)
});

test("handleRunsCommand filters by status: shows only matching runs", async () => {
  await withTempRunsDir(async (runsDir) => {
    await writeRun(runsDir, makeRecord({
      run_id: "run_20260415_010001_aaa",
      queued_at: "2026-04-15T01:00:01Z",
      status: "done",
    }));
    await writeRun(runsDir, makeRecord({
      run_id: "run_20260415_010002_bbb",
      queued_at: "2026-04-15T01:00:02Z",
      status: "failed",
      result: null,
      error: { message: "oops" },
    }));
    await writeRun(runsDir, makeRecord({
      run_id: "run_20260415_010003_ccc",
      queued_at: "2026-04-15T01:00:03Z",
      status: "done",
    }));

    const result = await handleRunsCommand(makeContext(runsDir, "failed"));

    assert.match(result.text, /run_20260415_010002_bbb/);
    assert.doesNotMatch(result.text, /run_20260415_010001_aaa/);
    assert.doesNotMatch(result.text, /run_20260415_010003_ccc/);
    assert.match(result.text, /status=failed/);
  });
});

test("handleRunsCommand filter by status returns empty-list message when no match", async () => {
  await withTempRunsDir(async (runsDir) => {
    await writeRun(runsDir, makeRecord({
      run_id: "run_20260415_010001_aaa",
      queued_at: "2026-04-15T01:00:01Z",
      status: "done",
    }));

    const result = await handleRunsCommand(makeContext(runsDir, "failed"));

    assert.match(result.text, /実行記録が見つかりません/);
    assert.match(result.text, /status=failed/);
  });
});

test("handleRunsCommand filters by kind: shows only matching runs", async () => {
  await withTempRunsDir(async (runsDir) => {
    await writeRun(runsDir, makeRecord({
      run_id: "run_20260415_010001_aaa",
      queued_at: "2026-04-15T01:00:01Z",
      kind: "health",
      normalized_task: "health",
    }));
    await writeRun(runsDir, makeRecord({
      run_id: "run_20260415_010002_bbb",
      queued_at: "2026-04-15T01:00:02Z",
      kind: "digest",
      normalized_task: "digest",
    }));
    await writeRun(runsDir, makeRecord({
      run_id: "run_20260415_010003_ccc",
      queued_at: "2026-04-15T01:00:03Z",
      kind: "health",
      normalized_task: "health",
    }));

    const result = await handleRunsCommand(makeContext(runsDir, "kind=health"));

    assert.match(result.text, /run_20260415_010001_aaa/);
    assert.match(result.text, /run_20260415_010003_ccc/);
    assert.doesNotMatch(result.text, /run_20260415_010002_bbb/);
    assert.match(result.text, /kind=health/);
  });
});

test("handleRunsCommand last=N limits result count", async () => {
  await withTempRunsDir(async (runsDir) => {
    for (let i = 1; i <= 10; i++) {
      const sec = String(i).padStart(2, "0");
      await writeRun(runsDir, makeRecord({
        run_id: `run_20260415_0100${sec}_${String(i).padStart(3, "0")}`,
        queued_at: `2026-04-15T01:00:${sec}Z`,
      }));
    }

    const result = await handleRunsCommand(makeContext(runsDir, "last=3"));
    const runLines = result.text.split("\n").filter((line) => line.includes("`run_"));

    assert.equal(runLines.length, 3);
    // newest first
    assert.match(runLines[0], /run_20260415_010010/);
    assert.match(result.text, /last=3/);
  });
});

test("handleRunsCommand returns usage hint for unrecognized args", async () => {
  await withTempRunsDir(async (runsDir) => {
    const result = await handleRunsCommand(makeContext(runsDir, "unknown-arg"));

    assert.match(result.text, /コマンド使い方/);
    assert.match(result.text, /kind=<value>/);
    assert.match(result.text, /last=<n>/);
  });
});

test("handleRunsCommand compound filter: status + kind shows only exact matches", async () => {
  await withTempRunsDir(async (runsDir) => {
    // should match: failed + digest
    await writeRun(runsDir, makeRecord({
      run_id: "run_20260415_010001_aaa",
      queued_at: "2026-04-15T01:00:01Z",
      status: "failed",
      kind: "digest",
      normalized_task: "digest",
      result: null,
      error: { message: "digest failed" },
    }));
    // status matches, kind doesn't
    await writeRun(runsDir, makeRecord({
      run_id: "run_20260415_010002_bbb",
      queued_at: "2026-04-15T01:00:02Z",
      status: "failed",
      kind: "health",
      normalized_task: "health",
      result: null,
      error: { message: "health failed" },
    }));
    // kind matches, status doesn't
    await writeRun(runsDir, makeRecord({
      run_id: "run_20260415_010003_ccc",
      queued_at: "2026-04-15T01:00:03Z",
      status: "done",
      kind: "digest",
      normalized_task: "digest",
    }));
    // neither matches
    await writeRun(runsDir, makeRecord({
      run_id: "run_20260415_010004_ddd",
      queued_at: "2026-04-15T01:00:04Z",
      status: "done",
      kind: "health",
      normalized_task: "health",
    }));

    const result = await handleRunsCommand(makeContext(runsDir, "failed kind=digest"));

    assert.match(result.text, /run_20260415_010001_aaa/);
    assert.doesNotMatch(result.text, /run_20260415_010002_bbb/);
    assert.doesNotMatch(result.text, /run_20260415_010003_ccc/);
    assert.doesNotMatch(result.text, /run_20260415_010004_ddd/);
    assert.match(result.text, /status=failed/);
    assert.match(result.text, /kind=digest/);
  });
});

test("handleRunsCommand compound filter: kind first, status second (order-independent)", async () => {
  await withTempRunsDir(async (runsDir) => {
    await writeRun(runsDir, makeRecord({
      run_id: "run_20260415_010001_aaa",
      queued_at: "2026-04-15T01:00:01Z",
      status: "done",
      kind: "health",
      normalized_task: "health",
    }));
    await writeRun(runsDir, makeRecord({
      run_id: "run_20260415_010002_bbb",
      queued_at: "2026-04-15T01:00:02Z",
      status: "failed",
      kind: "health",
      normalized_task: "health",
      result: null,
      error: { message: "oops" },
    }));

    const result = await handleRunsCommand(makeContext(runsDir, "kind=health done"));

    assert.match(result.text, /run_20260415_010001_aaa/);
    assert.doesNotMatch(result.text, /run_20260415_010002_bbb/);
    assert.match(result.text, /status=done/);
    assert.match(result.text, /kind=health/);
  });
});

test("handleRunsCommand compound filter: empty result shows compound label", async () => {
  await withTempRunsDir(async (runsDir) => {
    await writeRun(runsDir, makeRecord({
      run_id: "run_20260415_010001_aaa",
      queued_at: "2026-04-15T01:00:01Z",
      status: "done",
      kind: "health",
      normalized_task: "health",
    }));

    const result = await handleRunsCommand(makeContext(runsDir, "failed kind=health"));

    assert.match(result.text, /実行記録が見つかりません/);
    assert.match(result.text, /status=failed/);
    assert.match(result.text, /kind=health/);
  });
});

test("handleRunsCommand last + status returns filtered runs capped after filtering", async () => {
  await withTempRunsDir(async (runsDir) => {
    for (let i = 1; i <= 6; i++) {
      const sec = String(i).padStart(2, "0");
      await writeRun(runsDir, makeRecord({
        run_id: `run_20260415_0100${sec}_${String(i).padStart(3, "0")}`,
        queued_at: `2026-04-15T01:00:${sec}Z`,
        status: i % 2 === 0 ? "failed" : "done",
        result: i % 2 === 0 ? null : { ok: true },
        error: i % 2 === 0 ? { message: `failed ${i}` } : null,
      }));
    }

    const result = await handleRunsCommand(makeContext(runsDir, "last=3 failed"));
    const runLines = result.text.split("\n").filter((line) => line.includes("`run_"));

    assert.equal(runLines.length, 3);
    assert.match(result.text, /status=failed/);
    assert.match(result.text, /last=3/);
    assert.match(result.text, /run_20260415_010006_006/);
    assert.match(result.text, /run_20260415_010004_004/);
    assert.match(result.text, /run_20260415_010002_002/);
    assert.doesNotMatch(result.text, /run_20260415_010005_005/);
  });
});

test("handleRunsCommand last + kind returns filtered runs capped after filtering", async () => {
  await withTempRunsDir(async (runsDir) => {
    for (let i = 1; i <= 5; i++) {
      const sec = String(i).padStart(2, "0");
      await writeRun(runsDir, makeRecord({
        run_id: `run_20260415_0200${sec}_${String(i).padStart(3, "0")}`,
        queued_at: `2026-04-15T02:00:${sec}Z`,
        kind: i <= 3 ? "health" : "digest",
        normalized_task: i <= 3 ? "health" : "digest",
      }));
    }

    const result = await handleRunsCommand(makeContext(runsDir, "last=2 kind=health"));
    const runLines = result.text.split("\n").filter((line) => line.includes("`run_"));

    assert.equal(runLines.length, 2);
    assert.match(result.text, /kind=health/);
    assert.match(result.text, /last=2/);
    assert.match(result.text, /run_20260415_020003_003/);
    assert.match(result.text, /run_20260415_020002_002/);
    assert.doesNotMatch(result.text, /run_20260415_020001_001/);
    assert.doesNotMatch(result.text, /run_20260415_020005_005/);
  });
});

test("handleRunsCommand last + status + kind applies AND conditions before cap", async () => {
  await withTempRunsDir(async (runsDir) => {
    await writeRun(runsDir, makeRecord({
      run_id: "run_20260415_030001_001",
      queued_at: "2026-04-15T03:00:01Z",
      status: "failed",
      kind: "digest",
      normalized_task: "digest",
      result: null,
      error: { message: "digest failed 1" },
    }));
    await writeRun(runsDir, makeRecord({
      run_id: "run_20260415_030002_002",
      queued_at: "2026-04-15T03:00:02Z",
      status: "failed",
      kind: "health",
      normalized_task: "health",
      result: null,
      error: { message: "health failed" },
    }));
    await writeRun(runsDir, makeRecord({
      run_id: "run_20260415_030003_003",
      queued_at: "2026-04-15T03:00:03Z",
      status: "done",
      kind: "digest",
      normalized_task: "digest",
    }));
    await writeRun(runsDir, makeRecord({
      run_id: "run_20260415_030004_004",
      queued_at: "2026-04-15T03:00:04Z",
      status: "failed",
      kind: "digest",
      normalized_task: "digest",
      result: null,
      error: { message: "digest failed 2" },
    }));

    const result = await handleRunsCommand(makeContext(runsDir, "last=2 failed kind=digest"));
    const runLines = result.text.split("\n").filter((line) => line.includes("`run_"));

    assert.equal(runLines.length, 2);
    assert.match(result.text, /status=failed/);
    assert.match(result.text, /kind=digest/);
    assert.match(result.text, /last=2/);
    assert.match(result.text, /run_20260415_030004_004/);
    assert.match(result.text, /run_20260415_030001_001/);
    assert.doesNotMatch(result.text, /run_20260415_030002_002/);
    assert.doesNotMatch(result.text, /run_20260415_030003_003/);
  });
});

test("handleRunsCommand last + filter is order-independent", async () => {
  await withTempRunsDir(async (runsDir) => {
    for (let i = 1; i <= 4; i++) {
      const sec = String(i).padStart(2, "0");
      await writeRun(runsDir, makeRecord({
        run_id: `run_20260415_0400${sec}_${String(i).padStart(3, "0")}`,
        queued_at: `2026-04-15T04:00:${sec}Z`,
        status: i <= 3 ? "failed" : "done",
        kind: i <= 3 ? "digest" : "health",
        normalized_task: i <= 3 ? "digest" : "health",
        result: i <= 3 ? null : { ok: true },
        error: i <= 3 ? { message: `digest failed ${i}` } : null,
      }));
    }

    const byStatus = await handleRunsCommand(makeContext(runsDir, "failed last=2"));
    const byKind = await handleRunsCommand(makeContext(runsDir, "kind=digest last=2"));

    assert.match(byStatus.text, /status=failed/);
    assert.match(byStatus.text, /last=2/);
    assert.match(byStatus.text, /run_20260415_040003_003/);
    assert.match(byStatus.text, /run_20260415_040002_002/);
    assert.doesNotMatch(byStatus.text, /run_20260415_040001_001/);

    assert.match(byKind.text, /kind=digest/);
    assert.match(byKind.text, /last=2/);
    assert.match(byKind.text, /run_20260415_040003_003/);
    assert.match(byKind.text, /run_20260415_040002_002/);
    assert.doesNotMatch(byKind.text, /run_20260415_040001_001/);
  });
});

// ── Compound rejection E2E tests ──────────────────────────────────────────────

test("handleRunsCommand returns usage for duplicate status (failed done)", async () => {
  await withTempRunsDir(async (runsDir) => {
    const result = await handleRunsCommand(makeContext(runsDir, "failed done"));

    assert.match(result.text, /コマンド使い方/);
    assert.match(result.text, /複合フィルタ/);
  });
});

test("handleRunsCommand returns usage for duplicate kind tokens", async () => {
  await withTempRunsDir(async (runsDir) => {
    const result = await handleRunsCommand(makeContext(runsDir, "kind=health kind=digest"));

    assert.match(result.text, /コマンド使い方/);
  });
});

test("handleRunsCommand returns usage for duplicate last tokens", async () => {
  await withTempRunsDir(async (runsDir) => {
    const result = await handleRunsCommand(makeContext(runsDir, "last=5 last=10"));

    assert.match(result.text, /コマンド使い方/);
  });
});

test("handleRunsCommand existing /runs list behavior is unchanged by filter addition", async () => {
  await withTempRunsDir(async (runsDir) => {
    await writeRun(runsDir, makeRecord({
      run_id: "run_20260415_010001_aaa",
      queued_at: "2026-04-15T01:00:01Z",
      status: "done",
    }));
    await writeRun(runsDir, makeRecord({
      run_id: "run_20260415_010002_bbb",
      queued_at: "2026-04-15T01:00:02Z",
      status: "failed",
      result: null,
      error: { message: "oops" },
    }));

    const result = await handleRunsCommand(makeContext(runsDir, ""));

    assert.match(result.text, /直近の run 記録/);
    assert.match(result.text, /run_20260415_010001_aaa/);
    assert.match(result.text, /run_20260415_010002_bbb/);
  });
});
