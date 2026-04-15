import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import plugin from "./index.js";

async function withTempRunsDir(fn) {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "run-viewer-list-"));
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

function makeRecord({ runId, queuedAt, doneAt = queuedAt, status = "done" }) {
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
    started_at: queuedAt,
    done_at: doneAt,
    result: {
      summary: `summary for ${runId}`,
      key_points: [],
      suggested_next_action: null,
      exit_code: 0,
      raw_output: "",
    },
    error: null,
    retry_of: null,
    retry_count: 0,
    slack_ts: null,
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

function makeContext(runsDir, listLimit) {
  return {
    args: "",
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
        runId: "run_20260414_235959_aaa",
        queuedAt: "2026-04-14T23:59:59Z",
      }),
    );
    await writeRun(
      runsDir,
      makeRecord({
        runId: "run_20260415_020111_aaa",
        queuedAt: "2026-04-15T02:01:11Z",
      }),
    );
    await writeRun(
      runsDir,
      makeRecord({
        runId: "run_20260415_020112_aab",
        queuedAt: "2026-04-15T02:01:12Z",
      }),
    );

    const result = await getRunsHandler()(makeContext(runsDir, 10));
    const lines = result.text.split("\n");

    const firstRunLine = lines.find((line) => line.includes("run_20260415_020112_aab"));
    const secondRunLine = lines.find((line) => line.includes("run_20260415_020111_aaa"));
    const thirdRunLine = lines.find((line) => line.includes("run_20260414_235959_aaa"));

    assert.ok(firstRunLine);
    assert.ok(secondRunLine);
    assert.ok(thirdRunLine);
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
          runId: `run_20260415_1200${seconds}_${String(i).padStart(3, "0")}`,
          queuedAt: `${date}T12:00:${seconds}Z`,
        }),
      );
    }

    const result = await getRunsHandler()(makeContext(runsDir, 999));
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
        runId: "run_20260415_020112_a1b",
        queuedAt: "2026-04-15T02:01:12Z",
      }),
    );
    const dirPath = path.join(runsDir, "2026-04-15");
    await fs.writeFile(path.join(dirPath, "run_20260415_020113_bad.json"), "{not-json", "utf8");

    const result = await getRunsHandler()(makeContext(runsDir, 10));
    const runLines = result.text.split("\n").filter((line) => line.includes("`run_"));

    assert.equal(runLines.length, 1);
    assert.match(result.text, /run_20260415_020112_a1b/);
    assert.doesNotMatch(result.text, /run_20260415_020113_bad/);
  });
});
