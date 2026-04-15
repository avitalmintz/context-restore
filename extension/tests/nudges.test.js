import test from "node:test";
import assert from "node:assert/strict";

import {
  applyNudgeSends,
  computeOpenLoopScore,
  isInQuietHours,
  normalizeNudgeSettings,
  selectNudgeCandidates
} from "../src/background/nudges.js";

function task(overrides = {}) {
  const baseTs = 1_700_000_000_000;
  return {
    taskId: overrides.taskId || "task-1",
    title: overrides.title || "Research on example.com",
    status: overrides.status || "active",
    category: overrides.category || "research",
    lastActivityTs: overrides.lastActivityTs ?? baseTs,
    stats: {
      pageCount: 3,
      readCount: 0,
      skimmedCount: 2,
      unopenedCount: 1,
      bouncedCount: 0,
      revisitCount: 3,
      activeMs: 7 * 60 * 1000,
      ...(overrides.stats || {})
    },
    pages: overrides.pages || [
      { interestScore: 88, completionScore: 30 },
      { interestScore: 75, completionScore: 25 },
      { interestScore: 70, completionScore: 10 }
    ]
  };
}

test("isInQuietHours handles overnight ranges", () => {
  const jan1_23 = new Date("2026-01-01T23:00:00").getTime();
  const jan1_09 = new Date("2026-01-01T09:00:00").getTime();
  assert.equal(isInQuietHours(jan1_23, 22, 8), true);
  assert.equal(isInQuietHours(jan1_09, 22, 8), false);
});

test("computeOpenLoopScore increases for high-interest low-completion tasks", () => {
  const settings = normalizeNudgeSettings({}, {
    enabled: true,
    quietHoursStart: 22,
    quietHoursEnd: 8,
    dailyCap: 3,
    minInactiveHours: 18,
    maxInactiveDays: 7
  });

  const nowTs = new Date("2026-01-05T12:00:00").getTime();
  const high = task({ lastActivityTs: new Date("2026-01-03T06:00:00").getTime() });
  const low = task({
    taskId: "task-low",
    stats: {
      readCount: 3,
      skimmedCount: 0,
      unopenedCount: 0,
      revisitCount: 0,
      activeMs: 2 * 60 * 1000
    },
    pages: [
      { interestScore: 40, completionScore: 90 },
      { interestScore: 30, completionScore: 95 },
      { interestScore: 20, completionScore: 98 }
    ]
  });

  const highScore = computeOpenLoopScore(high, nowTs, settings);
  const lowScore = computeOpenLoopScore(low, nowTs, settings);
  assert.ok(highScore > lowScore);
  assert.ok(highScore >= 0.45);
});

test("selectNudgeCandidates respects daily cap and per-task cooldown", () => {
  const settings = normalizeNudgeSettings(
    {
      dailyCap: 1,
      quietHoursStart: 0,
      quietHoursEnd: 0,
      minInactiveHours: 18,
      maxInactiveDays: 7
    },
    {
      enabled: true,
      quietHoursStart: 22,
      quietHoursEnd: 8,
      dailyCap: 3,
      minInactiveHours: 18,
      maxInactiveDays: 7
    }
  );

  const nowTs = new Date("2026-01-05T12:00:00").getTime();
  const tasks = [
    task({ taskId: "task-a", lastActivityTs: new Date("2026-01-03T08:00:00").getTime() }),
    task({ taskId: "task-b", lastActivityTs: new Date("2026-01-02T08:00:00").getTime() })
  ];

  const state = {
    daily: { date: "2026-01-05", count: 0 },
    taskLastSent: {},
    taskPhaseSent: {},
    log: []
  };

  const first = selectNudgeCandidates(tasks, state, settings, nowTs);
  assert.equal(first.selected.length, 1);

  const nextState = applyNudgeSends(first.state, first.selected, nowTs);
  const second = selectNudgeCandidates(tasks, nextState, settings, nowTs + 60 * 60 * 1000);
  assert.equal(second.selected.length, 0);
});
