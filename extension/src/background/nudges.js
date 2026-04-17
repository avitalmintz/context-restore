function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toNum(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function dateKey(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function normalizeNudgeSettings(input, defaults) {
  const base = defaults || {};
  return {
    enabled: Boolean(input?.enabled ?? base.enabled ?? true),
    quietHoursStart: clamp(Math.floor(toNum(input?.quietHoursStart, base.quietHoursStart ?? 22)), 0, 23),
    quietHoursEnd: clamp(Math.floor(toNum(input?.quietHoursEnd, base.quietHoursEnd ?? 8)), 0, 23),
    dailyCap: clamp(Math.floor(toNum(input?.dailyCap, base.dailyCap ?? 3)), 1, 10),
    minInactiveHours: clamp(toNum(input?.minInactiveHours, base.minInactiveHours ?? 18), 1, 168),
    maxInactiveDays: clamp(toNum(input?.maxInactiveDays, base.maxInactiveDays ?? 7), 1, 30)
  };
}

export function isInQuietHours(nowTs, quietHoursStart, quietHoursEnd) {
  const hour = new Date(nowTs).getHours();

  if (quietHoursStart === quietHoursEnd) {
    return false;
  }

  if (quietHoursStart < quietHoursEnd) {
    return hour >= quietHoursStart && hour < quietHoursEnd;
  }

  return hour >= quietHoursStart || hour < quietHoursEnd;
}

export function computeOpenLoopScore(task, nowTs, settings) {
  const stats = task.stats || {};
  const pageCount = Math.max(1, toNum(stats.pageCount, 1));
  const readRatio = clamp(toNum(stats.readCount, 0) / pageCount, 0, 1);
  const skimRatio = clamp(toNum(stats.skimmedCount, 0) / pageCount, 0, 1);
  const unopenedRatio = clamp(toNum(stats.unopenedCount, 0) / pageCount, 0, 1);
  const revisitRatio = clamp(toNum(stats.revisitCount, 0) / 5, 0, 1);
  const activeRatio = clamp(toNum(stats.activeMs, 0) / (10 * 60 * 1000), 0, 1);

  const inactiveHours = Math.max(0, (nowTs - toNum(task.lastActivityTs, nowTs)) / (60 * 60 * 1000));
  const minHours = toNum(settings.minInactiveHours, 18);
  const maxHours = toNum(settings.maxInactiveDays, 7) * 24;
  const ageSignal = clamp((inactiveHours - minHours) / Math.max(maxHours - minHours, 1), 0, 1);

  const interest = clamp(0.35 * activeRatio + 0.25 * revisitRatio + 0.2 * skimRatio + 0.2 * unreadWeight(task), 0, 1);
  const completion = clamp(0.8 * readRatio + 0.2 * skimRatio, 0, 1);

  const raw = 0.55 * interest + 0.2 * unopenedRatio + 0.25 * ageSignal - 0.45 * completion;
  const scaled = clamp(raw * 1.4, 0, 1);
  return Number(scaled.toFixed(3));
}

function unreadWeight(task) {
  const pages = Array.isArray(task.pages) ? task.pages : [];
  if (!pages.length) {
    return 0;
  }

  let total = 0;
  for (const page of pages) {
    const interest = clamp(toNum(page.interestScore, 0) / 100, 0, 1);
    const completion = clamp(toNum(page.completionScore, 0) / 100, 0, 1);
    total += interest * (1 - completion);
  }

  return clamp(total / pages.length, 0, 1);
}

export function deriveNudgePhase(task, nowTs) {
  const inactiveHours = Math.max(0, (nowTs - toNum(task.lastActivityTs, nowTs)) / (60 * 60 * 1000));

  if (inactiveHours >= 72) {
    return "day3";
  }

  if (inactiveHours >= 24) {
    return "day1";
  }

  return null;
}

function shouldResetDailyCounter(state, nowTs) {
  const key = dateKey(nowTs);
  return (state?.daily?.date || "") !== key;
}

function withDailyState(state, nowTs) {
  if (shouldResetDailyCounter(state, nowTs)) {
    return {
      ...state,
      daily: {
        date: dateKey(nowTs),
        count: 0
      }
    };
  }

  return state;
}

function getTaskPhaseState(state, taskId) {
  const byTask = state.taskPhaseSent || {};
  return byTask[taskId] || {};
}

function wasPhaseSent(state, taskId, phase) {
  const phaseState = getTaskPhaseState(state, taskId);
  return Boolean(phaseState[phase]);
}

function lastSentTs(state, taskId) {
  const value = state.taskLastSent?.[taskId];
  return Number.isFinite(value) ? value : 0;
}

export function selectNudgeCandidates(tasks, stateInput, settingsInput, nowTs) {
  const settings = normalizeNudgeSettings(settingsInput, settingsInput);
  let state = withDailyState(
    stateInput || {
      daily: { date: dateKey(nowTs), count: 0 },
      taskLastSent: {},
      taskPhaseSent: {},
      log: []
    },
    nowTs
  );

  if (!settings.enabled) {
    return { selected: [], state };
  }

  if (isInQuietHours(nowTs, settings.quietHoursStart, settings.quietHoursEnd)) {
    return { selected: [], state };
  }

  const dailyCount = toNum(state.daily?.count, 0);
  const remaining = Math.max(0, settings.dailyCap - dailyCount);
  if (remaining <= 0) {
    return { selected: [], state };
  }

  const minHours = settings.minInactiveHours;
  const maxHours = settings.maxInactiveDays * 24;

  const candidates = [];
  for (const task of tasks) {
    if (task.status !== "active") {
      continue;
    }

    const inactiveHours = Math.max(0, (nowTs - toNum(task.lastActivityTs, nowTs)) / (60 * 60 * 1000));
    if (inactiveHours < minHours || inactiveHours > maxHours) {
      continue;
    }

    const phase = deriveNudgePhase(task, nowTs);
    if (!phase) {
      continue;
    }

    if (wasPhaseSent(state, task.taskId, phase)) {
      continue;
    }

    const previousSent = lastSentTs(state, task.taskId);
    if (nowTs - previousSent < 24 * 60 * 60 * 1000) {
      continue;
    }

    const openLoopScore = computeOpenLoopScore(task, nowTs, settings);
    if (openLoopScore < 0.6) {
      continue;
    }

    candidates.push({
      task,
      taskId: task.taskId,
      phase,
      openLoopScore,
      inactiveHours
    });
  }

  candidates.sort((a, b) => {
    if (b.openLoopScore !== a.openLoopScore) {
      return b.openLoopScore - a.openLoopScore;
    }
    return b.inactiveHours - a.inactiveHours;
  });

  const selected = candidates.slice(0, remaining);
  return { selected, state };
}

export function applyNudgeSends(stateInput, sentItems, nowTs) {
  let state = withDailyState(
    stateInput || {
      daily: { date: dateKey(nowTs), count: 0 },
      taskLastSent: {},
      taskPhaseSent: {},
      log: []
    },
    nowTs
  );

  const taskLastSent = { ...(state.taskLastSent || {}) };
  const taskPhaseSent = { ...(state.taskPhaseSent || {}) };
  const log = [...(state.log || [])];
  let count = toNum(state.daily?.count, 0);

  for (const item of sentItems) {
    count += 1;
    taskLastSent[item.taskId] = nowTs;
    taskPhaseSent[item.taskId] = {
      ...(taskPhaseSent[item.taskId] || {}),
      [item.phase]: nowTs
    };

    log.unshift({
      taskId: item.taskId,
      phase: item.phase,
      sentAt: nowTs,
      score: item.openLoopScore,
      title: item.task?.title || ""
    });
  }

  return {
    ...state,
    daily: {
      date: dateKey(nowTs),
      count
    },
    taskLastSent,
    taskPhaseSent,
    log: log.slice(0, 200)
  };
}

export function buildNudgeNotification(item) {
  const phasePrefix = item.phase === "day3" ? "Still open" : "Unfinished";
  const baseTitle = item.task?.title || "Browsing task";

  let message = "You left this task unfinished.";
  if (item.task?.category === "shopping") {
    message = "You were comparing items and have not closed the decision yet.";
  } else if (item.task?.category === "research") {
    message = "You started reading this topic but did not finish it.";
  } else if (item.task?.category === "travel") {
    message = "You started planning but have pending pages to review.";
  }

  return {
    title: `${phasePrefix}: ${baseTitle}`,
    message,
    contextMessage: `Open-loop score ${Math.round(item.openLoopScore * 100)}%`
  };
}
