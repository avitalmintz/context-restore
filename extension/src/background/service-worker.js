import {
  addEvent,
  clearAllEvents,
  deleteEventsByUrls,
  getRecentEvents,
  purgeDeletedEventsBefore,
  pruneEventsBefore
} from "./storage.js";
import {
  buildDailySemanticsFromEvents,
  buildTaskFeedFromEvents,
  canonicalizeUrl,
  safeDomain
} from "./inference.js";
import {
  computeOpenLoopScore,
  deriveNudgePhase,
  normalizeNudgeSettings
} from "./nudges.js";
import { DEFAULTS, MESSAGE_TYPES, STORAGE_KEYS } from "../shared/constants.js";

const ALARM_RETENTION_CLEANUP = "retention-cleanup";
const ALARM_SYNC_EVALUATION = "sync-evaluation";
const REALTIME_SYNC_COOLDOWN_MS = 20 * 1000;
const RESUME_SCROLL_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const RESUME_SCROLL_MAX_ATTEMPTS = 8;
const DELETED_EVENT_GRACE_MS = 24 * 60 * 60 * 1000;

let lastRealtimeSyncTs = 0;
const pendingScrollRestoreByTabId = new Map();

function nowMs() {
  return Date.now();
}

function toNum(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn, retries = 2) {
  let lastError;
  for (let i = 0; i <= retries; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < retries) {
        await sleep(50 * (i + 1));
      }
    }
  }
  throw lastError;
}

function defaultNudgeState(currentTs = nowMs()) {
  const d = new Date(currentTs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return {
    daily: { date: `${y}-${m}-${day}`, count: 0 },
    taskLastSent: {},
    taskPhaseSent: {},
    log: []
  };
}

function isTrackableWebUrl(url) {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeTaskLifecycleStatus(input) {
  const status = String(input || "").trim().toLowerCase();
  if (status === "done" || status === "dropped" || status === "snoozed") {
    return status;
  }
  return "active";
}

function upcomingFridayAt(hour = 9, minute = 0, fromTs = nowMs()) {
  const date = new Date(fromTs);
  const day = date.getDay(); // 0=Sun ... 5=Fri
  const target = 5;
  let delta = target - day;
  if (delta <= 0) {
    delta += 7;
  }
  const out = new Date(date);
  out.setDate(date.getDate() + delta);
  out.setHours(hour, minute, 0, 0);
  return out.getTime();
}

async function getTaskOverrides() {
  const values = await chrome.storage.local.get([STORAGE_KEYS.TASK_OVERRIDES]);
  return values[STORAGE_KEYS.TASK_OVERRIDES] || {};
}

async function setTaskOverrides(overrides) {
  await chrome.storage.local.set({ [STORAGE_KEYS.TASK_OVERRIDES]: overrides });
}

function defaultTaskRelations() {
  return {
    mergedIntoByTaskId: {},
    keepSeparatePairs: {},
    mergeRules: [],
    keepSeparateRules: []
  };
}

function relationTokens(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/https?:\/\//g, " ")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

function normalizeTaskRelationSnapshot(raw, fallbackTaskId = "") {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const snapshotTaskId = String(raw.taskId || fallbackTaskId || "").trim();
  const domain = String(raw.domain || "").trim().toLowerCase();
  const domains = [...new Set((Array.isArray(raw.domains) ? raw.domains : [])
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean))]
    .slice(0, 8);

  const urls = [...new Set((Array.isArray(raw.urls) ? raw.urls : [])
    .map((value) => canonicalizeUrl(String(value || "").trim()))
    .filter((url) => isTrackableWebUrl(url)))]
    .slice(0, 12);

  const tokenInput = Array.isArray(raw.tokens) ? raw.tokens : relationTokens([
    raw.title,
    raw.topic,
    ...urls
  ].join(" "));
  const tokens = [...new Set(tokenInput.map((token) => String(token || "").trim().toLowerCase()).filter(Boolean))]
    .slice(0, 14);

  if (!snapshotTaskId && !domain && !domains.length && !urls.length && !tokens.length) {
    return null;
  }

  return {
    taskId: snapshotTaskId,
    title: String(raw.title || "").trim().slice(0, 160),
    topic: String(raw.topic || "").trim().slice(0, 160),
    domain,
    domains,
    urls,
    tokens
  };
}

function normalizeTaskRelationRule(raw) {
  const safe = raw && typeof raw === "object" ? raw : {};
  const primaryTaskId = String(safe.primaryTaskId || "").trim();
  const secondaryTaskId = String(safe.secondaryTaskId || "").trim();
  const primarySnapshot = normalizeTaskRelationSnapshot(safe.primarySnapshot, primaryTaskId);
  const secondarySnapshot = normalizeTaskRelationSnapshot(safe.secondarySnapshot, secondaryTaskId);
  const createdAt = Math.max(0, toNum(safe.createdAt, 0));
  const ruleType = String(safe.ruleType || "").trim();

  if (!primaryTaskId && !secondaryTaskId && !primarySnapshot && !secondarySnapshot) {
    return null;
  }

  return {
    primaryTaskId,
    secondaryTaskId,
    primarySnapshot,
    secondarySnapshot,
    createdAt,
    ruleType
  };
}

function appendTaskRelationRule(rules, nextRule, maxItems = 300) {
  const normalizedRule = normalizeTaskRelationRule(nextRule);
  if (!normalizedRule) {
    return rules || [];
  }

  const existing = Array.isArray(rules) ? [...rules] : [];
  const dedupeKey = [
    normalizedRule.ruleType,
    normalizedRule.primaryTaskId || normalizedRule.primarySnapshot?.taskId || "",
    normalizedRule.secondaryTaskId || normalizedRule.secondarySnapshot?.taskId || "",
    (normalizedRule.primarySnapshot?.tokens || []).slice(0, 3).join(","),
    (normalizedRule.secondarySnapshot?.tokens || []).slice(0, 3).join(",")
  ].join("|");

  const seen = new Set();
  const output = [normalizedRule, ...existing]
    .map((rule) => normalizeTaskRelationRule(rule))
    .filter(Boolean)
    .filter((rule) => {
      const key = [
        String(rule.ruleType || "").trim(),
        String(rule.primaryTaskId || rule.primarySnapshot?.taskId || "").trim(),
        String(rule.secondaryTaskId || rule.secondarySnapshot?.taskId || "").trim(),
        (rule.primarySnapshot?.tokens || []).slice(0, 3).join(","),
        (rule.secondarySnapshot?.tokens || []).slice(0, 3).join(",")
      ].join("|");
      if (key === dedupeKey && seen.has(key)) {
        return false;
      }
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

  return output.slice(0, maxItems);
}

function normalizeTaskRelations(raw) {
  const safe = raw && typeof raw === "object" ? raw : {};
  const mergedIntoByTaskId = safe.mergedIntoByTaskId && typeof safe.mergedIntoByTaskId === "object"
    ? { ...safe.mergedIntoByTaskId }
    : {};
  const keepSeparatePairs = safe.keepSeparatePairs && typeof safe.keepSeparatePairs === "object"
    ? { ...safe.keepSeparatePairs }
    : {};
  const mergeRules = Array.isArray(safe.mergeRules)
    ? safe.mergeRules.map((rule) => normalizeTaskRelationRule(rule)).filter(Boolean)
    : [];
  const keepSeparateRules = Array.isArray(safe.keepSeparateRules)
    ? safe.keepSeparateRules.map((rule) => normalizeTaskRelationRule(rule)).filter(Boolean)
    : [];

  return {
    mergedIntoByTaskId,
    keepSeparatePairs,
    mergeRules,
    keepSeparateRules
  };
}

function taskPairKey(a, b) {
  return [String(a || "").trim(), String(b || "").trim()].sort().join("::");
}

function relationOverlapRatio(listA, listB) {
  if (!listA.length || !listB.length) {
    return 0;
  }
  const setA = new Set(listA);
  const setB = new Set(listB);
  let common = 0;
  for (const value of setA) {
    if (setB.has(value)) {
      common += 1;
    }
  }
  return common / Math.max(setA.size, setB.size);
}

function taskRelationSnapshotFromTask(task) {
  if (!task || typeof task !== "object") {
    return null;
  }

  const urls = [...new Set(
    [
      ...(Array.isArray(task.urls) ? task.urls : []),
      ...((task.pages || []).map((page) => page.url))
    ]
      .map((url) => canonicalizeUrl(String(url || "")))
      .filter((url) => isTrackableWebUrl(url))
  )].slice(0, 12);

  const tokens = [...new Set(
    relationTokens([
      task.title,
      task.topic,
      ...urls
    ].join(" "))
  )].slice(0, 14);

  return {
    taskId: String(task.taskId || "").trim(),
    title: String(task.title || ""),
    topic: String(task.topic || ""),
    domain: String(task.domain || "").trim().toLowerCase(),
    domains: [...new Set((task.domains || []).map((domain) => String(domain || "").trim().toLowerCase()).filter(Boolean))],
    urls,
    tokens
  };
}

function taskMatchScore(snapshot, task) {
  const safeSnapshot = normalizeTaskRelationSnapshot(snapshot);
  const taskSnapshot = taskRelationSnapshotFromTask(task);
  if (!safeSnapshot || !taskSnapshot) {
    return 0;
  }

  const domainA = new Set([safeSnapshot.domain, ...(safeSnapshot.domains || [])].filter(Boolean));
  const domainB = new Set([taskSnapshot.domain, ...(taskSnapshot.domains || [])].filter(Boolean));
  let sharedDomains = 0;
  for (const domain of domainA) {
    if (domainB.has(domain)) {
      sharedDomains += 1;
    }
  }

  const urlOverlap = relationOverlapRatio(safeSnapshot.urls || [], taskSnapshot.urls || []);
  const tokenOverlap = relationOverlapRatio(safeSnapshot.tokens || [], taskSnapshot.tokens || []);
  return urlOverlap + tokenOverlap + (sharedDomains > 0 ? 0.3 : 0);
}

function findTaskIdForSnapshot(snapshot, tasks, usedTaskIds = new Set()) {
  const safeSnapshot = normalizeTaskRelationSnapshot(snapshot);
  if (!safeSnapshot) {
    return "";
  }

  if (safeSnapshot.taskId) {
    const exact = tasks.find((task) => task.taskId === safeSnapshot.taskId && !usedTaskIds.has(task.taskId));
    if (exact) {
      return exact.taskId;
    }
  }

  let bestTaskId = "";
  let bestScore = 0;
  for (const task of tasks) {
    if (usedTaskIds.has(task.taskId)) {
      continue;
    }
    const score = taskMatchScore(safeSnapshot, task);
    if (score > bestScore) {
      bestScore = score;
      bestTaskId = task.taskId;
    }
  }

  return bestScore >= 0.4 ? bestTaskId : "";
}

function resolveRelationMapsForTasks(tasks, relations) {
  const normalized = normalizeTaskRelations(relations);
  const mergedIntoByTaskId = { ...(normalized.mergedIntoByTaskId || {}) };
  const keepSeparatePairs = { ...(normalized.keepSeparatePairs || {}) };

  for (const rule of normalized.mergeRules || []) {
    const used = new Set();
    const primaryTaskId =
      findTaskIdForSnapshot(rule.primarySnapshot || { taskId: rule.primaryTaskId }, tasks, used) ||
      String(rule.primaryTaskId || "").trim();
    if (primaryTaskId) {
      used.add(primaryTaskId);
    }
    const secondaryTaskId =
      findTaskIdForSnapshot(rule.secondarySnapshot || { taskId: rule.secondaryTaskId }, tasks, used) ||
      String(rule.secondaryTaskId || "").trim();
    if (!primaryTaskId || !secondaryTaskId || primaryTaskId === secondaryTaskId) {
      continue;
    }
    mergedIntoByTaskId[secondaryTaskId] = primaryTaskId;
    delete keepSeparatePairs[taskPairKey(primaryTaskId, secondaryTaskId)];
  }

  for (const rule of normalized.keepSeparateRules || []) {
    const used = new Set();
    const primaryTaskId =
      findTaskIdForSnapshot(rule.primarySnapshot || { taskId: rule.primaryTaskId }, tasks, used) ||
      String(rule.primaryTaskId || "").trim();
    if (primaryTaskId) {
      used.add(primaryTaskId);
    }
    const secondaryTaskId =
      findTaskIdForSnapshot(rule.secondarySnapshot || { taskId: rule.secondaryTaskId }, tasks, used) ||
      String(rule.secondaryTaskId || "").trim();
    if (!primaryTaskId || !secondaryTaskId || primaryTaskId === secondaryTaskId) {
      continue;
    }
    keepSeparatePairs[taskPairKey(primaryTaskId, secondaryTaskId)] = Number(rule.createdAt || nowMs());
  }

  return { mergedIntoByTaskId, keepSeparatePairs };
}

function dedupePagesForSync(pages) {
  const byUrl = new Map();
  for (const page of pages || []) {
    const url = String(page?.url || "").trim();
    if (!url) {
      continue;
    }
    const key = canonicalizeUrl(url) || url;
    const existing = byUrl.get(key);
    if (!existing) {
      byUrl.set(key, { ...page, url: key });
      continue;
    }
    const existingScore = toNum(existing.interestScore, 0) + toNum(existing.completionScore, 0);
    const nextScore = toNum(page.interestScore, 0) + toNum(page.completionScore, 0);
    if (nextScore >= existingScore) {
      byUrl.set(key, { ...page, url: key });
    }
  }
  return [...byUrl.values()];
}

function rebuildStatsFromPages(pages, baseStats = {}, extraEventCount = 0) {
  const counts = {
    readCount: 0,
    skimmedCount: 0,
    unopenedCount: 0,
    bouncedCount: 0
  };
  let activeMs = 0;
  let revisitCount = 0;
  let deepScrollCount = 0;

  for (const page of pages) {
    const state = String(page.state || "skimmed");
    if (state === "read") counts.readCount += 1;
    else if (state === "skimmed") counts.skimmedCount += 1;
    else if (state === "unopened") counts.unopenedCount += 1;
    else counts.bouncedCount += 1;
    activeMs += toNum(page.activeMs, 0);
    revisitCount += toNum(page.revisitCount, 0);
    if (toNum(page.maxScrollPct, 0) >= 80) {
      deepScrollCount += 1;
    }
  }

  return {
    ...baseStats,
    pageCount: pages.length,
    activeMs,
    readCount: counts.readCount,
    skimmedCount: counts.skimmedCount,
    unopenedCount: counts.unopenedCount,
    bouncedCount: counts.bouncedCount,
    revisitCount,
    deepScrollCount,
    eventCount: toNum(baseStats.eventCount, 0) + toNum(extraEventCount, 0)
  };
}

function mergeTaskRecordsForSync(primary, secondary) {
  const pages = dedupePagesForSync([...(primary.pages || []), ...(secondary.pages || [])]).sort((a, b) => {
    const interestDelta = toNum(b.interestScore, 0) - toNum(a.interestScore, 0);
    if (interestDelta !== 0) {
      return interestDelta;
    }
    return toNum(b.lastTs, 0) - toNum(a.lastTs, 0);
  });
  const domains = [...new Set([primary.domain, secondary.domain, ...(primary.domains || []), ...(secondary.domains || [])].filter(Boolean))];

  return {
    ...primary,
    domains,
    pages,
    urls: pages.map((page) => page.url).filter(Boolean),
    stats: rebuildStatsFromPages(pages, primary.stats || {}, toNum(secondary.stats?.eventCount, 0)),
    lastActivityTs: Math.max(toNum(primary.lastActivityTs, 0), toNum(secondary.lastActivityTs, 0)),
    confidence: Math.max(toNum(primary.confidence, 0), toNum(secondary.confidence, 0)),
    openLoopScore: Math.max(toNum(primary.openLoopScore, 0), toNum(secondary.openLoopScore, 0))
  };
}

function applyTaskRelationsForSync(tasks, relations) {
  const resolved = resolveRelationMapsForTasks(tasks || [], relations || defaultTaskRelations());
  const taskMap = new Map((tasks || []).map((task) => [task.taskId, { ...task }]));
  const suppressed = new Set();

  for (const [childTaskId, parentTaskId] of Object.entries(resolved.mergedIntoByTaskId || {})) {
    if (resolved.keepSeparatePairs?.[taskPairKey(childTaskId, parentTaskId)]) {
      continue;
    }
    const child = taskMap.get(childTaskId);
    const parentRootId = resolveMergeRoot(parentTaskId, resolved.mergedIntoByTaskId || {});
    const parent = taskMap.get(parentRootId);
    if (!child || !parent || child.taskId === parent.taskId) {
      continue;
    }
    const merged = mergeTaskRecordsForSync(parent, child);
    taskMap.set(parent.taskId, merged);
    suppressed.add(child.taskId);
  }

  return [...taskMap.values()]
    .filter((task) => !suppressed.has(task.taskId))
    .sort((a, b) => toNum(b.lastActivityTs, 0) - toNum(a.lastActivityTs, 0));
}

async function getTaskRelations() {
  const values = await chrome.storage.local.get([STORAGE_KEYS.TASK_RELATIONS]);
  return normalizeTaskRelations(values[STORAGE_KEYS.TASK_RELATIONS] || defaultTaskRelations());
}

async function setTaskRelations(relations) {
  const normalized = normalizeTaskRelations(relations);
  await chrome.storage.local.set({ [STORAGE_KEYS.TASK_RELATIONS]: normalized });
  return normalized;
}

function resolveMergeRoot(taskId, mergedIntoByTaskId) {
  let current = String(taskId || "").trim();
  const visited = new Set();
  while (current && mergedIntoByTaskId[current] && !visited.has(current)) {
    visited.add(current);
    const next = String(mergedIntoByTaskId[current] || "").trim();
    if (!next || next === current) {
      break;
    }
    current = next;
  }
  return current;
}

async function mergeTaskRelations(
  primaryTaskId,
  secondaryTaskId,
  primaryTaskSnapshot = null,
  secondaryTaskSnapshot = null
) {
  const primary = String(primaryTaskId || "").trim();
  const secondary = String(secondaryTaskId || "").trim();
  if (!primary || !secondary || primary === secondary) {
    throw new Error("Invalid merge task ids");
  }

  const relations = await getTaskRelations();
  const merged = { ...relations.mergedIntoByTaskId };
  const keepSeparate = { ...relations.keepSeparatePairs };
  const mergeRules = [...(relations.mergeRules || [])];

  const primaryRoot = resolveMergeRoot(primary, merged);
  const secondaryRoot = resolveMergeRoot(secondary, merged);
  if (primaryRoot && secondaryRoot && primaryRoot !== secondaryRoot) {
    merged[secondaryRoot] = primaryRoot;
    delete keepSeparate[taskPairKey(primaryRoot, secondaryRoot)];
  }
  const nextMergeRules = appendTaskRelationRule(mergeRules, {
    ruleType: "merge",
    primaryTaskId: primaryRoot || primary,
    secondaryTaskId: secondaryRoot || secondary,
    primarySnapshot: normalizeTaskRelationSnapshot(primaryTaskSnapshot, primaryRoot || primary),
    secondarySnapshot: normalizeTaskRelationSnapshot(secondaryTaskSnapshot, secondaryRoot || secondary),
    createdAt: nowMs()
  });

  return setTaskRelations({
    mergedIntoByTaskId: merged,
    keepSeparatePairs: keepSeparate,
    mergeRules: nextMergeRules,
    keepSeparateRules: relations.keepSeparateRules
  });
}

async function keepTasksSeparate(
  primaryTaskId,
  secondaryTaskId,
  primaryTaskSnapshot = null,
  secondaryTaskSnapshot = null
) {
  const primary = String(primaryTaskId || "").trim();
  const secondary = String(secondaryTaskId || "").trim();
  if (!primary || !secondary || primary === secondary) {
    throw new Error("Invalid task ids");
  }

  const relations = await getTaskRelations();
  const merged = { ...relations.mergedIntoByTaskId };
  const keepSeparate = { ...relations.keepSeparatePairs };
  const mergeRules = [...(relations.mergeRules || [])];
  const keepSeparateRules = [...(relations.keepSeparateRules || [])];

  const primaryRoot = resolveMergeRoot(primary, merged) || primary;
  const secondaryRoot = resolveMergeRoot(secondary, merged) || secondary;
  const key = taskPairKey(primaryRoot, secondaryRoot);
  keepSeparate[key] = nowMs();
  if (merged[primary] === secondaryRoot) {
    delete merged[primary];
  }
  if (merged[secondary] === primaryRoot) {
    delete merged[secondary];
  }
  if (merged[secondaryRoot] === primaryRoot) {
    delete merged[secondaryRoot];
  }
  if (merged[primaryRoot] === secondaryRoot) {
    delete merged[primaryRoot];
  }
  const filteredMergeRules = mergeRules.filter((rule) => {
    const ids = [
      String(rule.primaryTaskId || "").trim(),
      String(rule.secondaryTaskId || "").trim(),
      String(rule.primarySnapshot?.taskId || "").trim(),
      String(rule.secondarySnapshot?.taskId || "").trim()
    ];
    const hasPrimary = ids.includes(primaryRoot) || ids.includes(primary);
    const hasSecondary = ids.includes(secondaryRoot) || ids.includes(secondary);
    return !(hasPrimary && hasSecondary);
  });
  const nextKeepRules = appendTaskRelationRule(keepSeparateRules, {
    ruleType: "keep_separate",
    primaryTaskId: primaryRoot,
    secondaryTaskId: secondaryRoot,
    primarySnapshot: normalizeTaskRelationSnapshot(primaryTaskSnapshot, primaryRoot),
    secondarySnapshot: normalizeTaskRelationSnapshot(secondaryTaskSnapshot, secondaryRoot),
    createdAt: nowMs()
  });

  return setTaskRelations({
    mergedIntoByTaskId: merged,
    keepSeparatePairs: keepSeparate,
    mergeRules: filteredMergeRules,
    keepSeparateRules: nextKeepRules
  });
}

async function unmergeTasks(primaryTaskId, secondaryTaskId = "") {
  const primary = String(primaryTaskId || "").trim();
  const secondary = String(secondaryTaskId || "").trim();
  if (!primary) {
    throw new Error("Missing primaryTaskId");
  }

  const relations = await getTaskRelations();
  const merged = { ...relations.mergedIntoByTaskId };
  const mergeRules = [...(relations.mergeRules || [])];
  const keepSeparate = { ...(relations.keepSeparatePairs || {}) };
  let keepSeparateRules = [...(relations.keepSeparateRules || [])];

  if (secondary) {
    const secondaryRoot = resolveMergeRoot(secondary, merged);
    if (merged[secondaryRoot] === primary) {
      delete merged[secondaryRoot];
    }
  } else {
    for (const [taskId] of Object.entries(merged)) {
      const root = resolveMergeRoot(taskId, merged);
      if (root === primary || String(merged[taskId] || "") === primary) {
        delete merged[taskId];
      }
    }
  }

  const filteredMergeRules = mergeRules.filter((rule) => {
    const ruleIds = [
      String(rule.primaryTaskId || "").trim(),
      String(rule.secondaryTaskId || "").trim(),
      String(rule.primarySnapshot?.taskId || "").trim(),
      String(rule.secondarySnapshot?.taskId || "").trim()
    ];
    if (secondary) {
      const hasPrimary = ruleIds.includes(primary);
      const hasSecondary = ruleIds.includes(secondary);
      const remove = hasPrimary && hasSecondary;
      if (remove) {
        const primarySnapshot = normalizeTaskRelationSnapshot(
          rule.primarySnapshot,
          String(rule.primaryTaskId || "").trim()
        );
        const secondarySnapshot = normalizeTaskRelationSnapshot(
          rule.secondarySnapshot,
          String(rule.secondaryTaskId || "").trim()
        );
        keepSeparate[taskPairKey(primarySnapshot?.taskId || primary, secondarySnapshot?.taskId || secondary)] = nowMs();
        keepSeparateRules = appendTaskRelationRule(keepSeparateRules, {
          ruleType: "keep_separate",
          primaryTaskId: primarySnapshot?.taskId || primary,
          secondaryTaskId: secondarySnapshot?.taskId || secondary,
          primarySnapshot,
          secondarySnapshot,
          createdAt: nowMs()
        });
      }
      return !remove;
    }
    const remove = ruleIds.includes(primary);
    if (remove) {
      const primarySnapshot = normalizeTaskRelationSnapshot(
        rule.primarySnapshot,
        String(rule.primaryTaskId || "").trim()
      );
      const secondarySnapshot = normalizeTaskRelationSnapshot(
        rule.secondarySnapshot,
        String(rule.secondaryTaskId || "").trim()
      );
      const pId = primarySnapshot?.taskId || String(rule.primaryTaskId || "").trim() || primary;
      const sId = secondarySnapshot?.taskId || String(rule.secondaryTaskId || "").trim();
      if (sId && pId && sId !== pId) {
        keepSeparate[taskPairKey(pId, sId)] = nowMs();
        keepSeparateRules = appendTaskRelationRule(keepSeparateRules, {
          ruleType: "keep_separate",
          primaryTaskId: pId,
          secondaryTaskId: sId,
          primarySnapshot,
          secondarySnapshot,
          createdAt: nowMs()
        });
      }
    }
    return !remove;
  });

  return setTaskRelations({
    mergedIntoByTaskId: merged,
    keepSeparatePairs: keepSeparate,
    mergeRules: filteredMergeRules,
    keepSeparateRules
  });
}

async function removeTaskOverride(taskId) {
  if (!taskId) {
    return;
  }
  const overrides = await getTaskOverrides();
  if (overrides[taskId]) {
    delete overrides[taskId];
    await setTaskOverrides(overrides);
  }
}

async function updateTaskOverride(taskId, patch) {
  if (!taskId) {
    throw new Error("Missing taskId");
  }

  const overrides = await getTaskOverrides();
  const current = overrides[taskId] || {};
  const next = {
    ...current,
    ...patch,
    updatedAt: nowMs()
  };

  const status = String(next.status || "").trim();
  const hasLifecycle =
    Boolean(next.done) ||
    status === "done" ||
    status === "dropped" ||
    (status === "snoozed" && toNum(next.snoozedUntilTs, 0) > nowMs());
  const hasMeaningfulValue = Boolean(next.title) || hasLifecycle;

  if (!hasMeaningfulValue) {
    delete overrides[taskId];
  } else {
    overrides[taskId] = next;
  }

  await setTaskOverrides(overrides);
}

async function getNudgeSettings() {
  const values = await chrome.storage.local.get([STORAGE_KEYS.NUDGE_SETTINGS]);
  const raw = values[STORAGE_KEYS.NUDGE_SETTINGS] || {};
  return normalizeNudgeSettings(raw, DEFAULTS.nudgeSettings);
}

async function setNudgeSettings(nextSettings) {
  const normalized = normalizeNudgeSettings(nextSettings, DEFAULTS.nudgeSettings);
  await chrome.storage.local.set({ [STORAGE_KEYS.NUDGE_SETTINGS]: normalized });
  return normalized;
}

async function getNudgeState() {
  const values = await chrome.storage.local.get([STORAGE_KEYS.NUDGE_STATE]);
  return values[STORAGE_KEYS.NUDGE_STATE] || defaultNudgeState();
}

async function setNudgeState(state) {
  await chrome.storage.local.set({ [STORAGE_KEYS.NUDGE_STATE]: state });
}

function normalizeSyncSettings(raw, defaults = DEFAULTS.syncSettings) {
  const safeRaw = raw || {};
  const safeDefaults = defaults || {};
  const cleanUrl = String(safeRaw.backendUrl ?? safeDefaults.backendUrl ?? "").trim().replace(/\/+$/, "");
  const cleanToken = String(safeRaw.apiToken ?? safeDefaults.apiToken ?? "").trim();
  const cleanDeviceId = String(safeRaw.deviceId ?? safeDefaults.deviceId ?? "").trim();
  const cleanLabel = String(safeRaw.deviceLabel ?? safeDefaults.deviceLabel ?? "Context Restore Chrome")
    .trim()
    .slice(0, 120);
  const iosReminderHour = Math.max(
    0,
    Math.min(23, Number(safeRaw.iosReminderHour ?? safeDefaults.iosReminderHour ?? 20) || 20)
  );
  const iosReminderMinute = Math.max(
    0,
    Math.min(59, Number(safeRaw.iosReminderMinute ?? safeDefaults.iosReminderMinute ?? 0) || 0)
  );

  return {
    enabled: Boolean(safeRaw.enabled ?? safeDefaults.enabled ?? false),
    backendUrl: cleanUrl,
    apiToken: cleanToken,
    deviceId: cleanDeviceId,
    deviceLabel: cleanLabel || "Context Restore Chrome",
    iosReminderEnabled: Boolean(safeRaw.iosReminderEnabled ?? safeDefaults.iosReminderEnabled ?? false),
    iosReminderHour,
    iosReminderMinute,
    lastUploadTs: Math.max(0, Number(safeRaw.lastUploadTs ?? safeDefaults.lastUploadTs ?? 0) || 0),
    lastPullAt: String(safeRaw.lastPullAt ?? safeDefaults.lastPullAt ?? ""),
    lastSuccessTs: Math.max(0, Number(safeRaw.lastSuccessTs ?? safeDefaults.lastSuccessTs ?? 0) || 0),
    lastError: String(safeRaw.lastError ?? safeDefaults.lastError ?? "").slice(0, 400)
  };
}

async function getSyncSettings() {
  const values = await chrome.storage.local.get([STORAGE_KEYS.SYNC_SETTINGS]);
  return normalizeSyncSettings(values[STORAGE_KEYS.SYNC_SETTINGS], DEFAULTS.syncSettings);
}

async function setSyncSettings(patch = {}, { merge = true } = {}) {
  const current = await getSyncSettings();
  const next = normalizeSyncSettings(merge ? { ...current, ...patch } : patch, DEFAULTS.syncSettings);
  await chrome.storage.local.set({ [STORAGE_KEYS.SYNC_SETTINGS]: next });
  return next;
}

function isSyncConfigured(syncSettings) {
  return Boolean(syncSettings.backendUrl && syncSettings.apiToken);
}

async function fetchSyncJson(syncSettings, path, { method = "GET", body } = {}) {
  if (!isSyncConfigured(syncSettings)) {
    throw new Error("Sync backend URL and API token are required");
  }

  const response = await fetch(`${syncSettings.backendUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${syncSettings.apiToken}`,
      "Content-Type": "application/json"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = {};
    }
  }

  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `Sync request failed (${response.status})`);
  }

  return payload;
}

async function getSettings() {
  const values = await chrome.storage.local.get([
    STORAGE_KEYS.TRACKING_PAUSED,
    STORAGE_KEYS.RETENTION_DAYS,
    STORAGE_KEYS.TASK_OVERRIDES,
    STORAGE_KEYS.TASK_RELATIONS,
    STORAGE_KEYS.NUDGE_SETTINGS,
    STORAGE_KEYS.NUDGE_STATE,
    STORAGE_KEYS.SYNC_SETTINGS
  ]);

  const nudgeSettings = normalizeNudgeSettings(
    values[STORAGE_KEYS.NUDGE_SETTINGS] || {},
    DEFAULTS.nudgeSettings
  );

  const nudgeState = values[STORAGE_KEYS.NUDGE_STATE] || defaultNudgeState();
  const taskRelations = normalizeTaskRelations(values[STORAGE_KEYS.TASK_RELATIONS] || defaultTaskRelations());

  return {
    trackingPaused: values[STORAGE_KEYS.TRACKING_PAUSED] ?? DEFAULTS.trackingPaused,
    retentionDays: values[STORAGE_KEYS.RETENTION_DAYS] ?? DEFAULTS.retentionDays,
    taskOverrideCount: Object.keys(values[STORAGE_KEYS.TASK_OVERRIDES] || {}).length,
    taskMergeCount: Object.keys(taskRelations.mergedIntoByTaskId || {}).length,
    taskKeepSeparateCount: Object.keys(taskRelations.keepSeparatePairs || {}).length,
    taskMergeRuleCount: Array.isArray(taskRelations.mergeRules) ? taskRelations.mergeRules.length : 0,
    taskKeepSeparateRuleCount: Array.isArray(taskRelations.keepSeparateRules)
      ? taskRelations.keepSeparateRules.length
      : 0,
    nudgeSettings,
    nudgeDailyCount: Number(nudgeState?.daily?.count || 0),
    syncSettings: normalizeSyncSettings(values[STORAGE_KEYS.SYNC_SETTINGS], DEFAULTS.syncSettings)
  };
}

async function isTrackingPaused() {
  const settings = await getSettings();
  return settings.trackingPaused;
}

async function ingestEvent(eventType, details) {
  if (await isTrackingPaused()) {
    return;
  }

  const rawUrl = details?.url ?? "";
  if (rawUrl && !isTrackableWebUrl(rawUrl)) {
    return;
  }
  const normalizedUrl = canonicalizeUrl(rawUrl);

  const event = {
    event_id: crypto.randomUUID(),
    event_type: eventType,
    ts: nowMs(),
    tab_id: details?.tabId ?? null,
    window_id: details?.windowId ?? null,
    url: normalizedUrl,
    domain: safeDomain(normalizedUrl),
    title: details?.title ?? "",
    payload: details?.payload ?? {}
  };

  await withRetry(() => addEvent(event));
  // Keep backend snapshots fresh for iOS without syncing every single event.
  maybeTriggerRealtimeSync(`event-${eventType}`);
}

async function getTabById(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

async function buildTaskFeed(limit = DEFAULTS.feedLimit, includeDone = false, opts = {}) {
  const lookbackMs = 7 * 24 * 60 * 60 * 1000;
  const currentTs = opts.nowTs || nowMs();
  const events = await withRetry(() => getRecentEvents(5000, nowMs() - lookbackMs));
  const taskOverrides = await getTaskOverrides();
  const tasks = buildTaskFeedFromEvents(events, {
    limit,
    includeDone,
    taskOverrides,
    nowTs: currentTs
  });

  const nudgeSettings = opts.nudgeSettings || (await getNudgeSettings());

  for (const task of tasks) {
    task.openLoopScore = computeOpenLoopScore(task, currentTs, nudgeSettings);
    task.nudgePhase = deriveNudgePhase(task, currentTs);
  }

  return tasks;
}

async function taskUrlsForId(taskId) {
  const tasks = await buildTaskFeed(300, true);
  const task = tasks.find((item) => item.taskId === taskId);
  return task?.urls || [];
}

async function applyRemoteTaskAction(action) {
  const taskId = String(action?.taskId || "").trim();
  if (!taskId) {
    return;
  }

  const actionType = String(action?.actionType || "");
  const payload = action?.payload && typeof action.payload === "object" ? action.payload : {};

  if (actionType === "rename") {
    const title = String(payload.title || "").trim();
    if (!title) {
      await updateTaskOverride(taskId, { title: undefined });
    } else {
      await updateTaskOverride(taskId, { title: title.slice(0, 120) });
    }
    return;
  }

  if (actionType === "set_done") {
    await updateTaskOverride(taskId, {
      done: Boolean(payload.done),
      status: Boolean(payload.done) ? "done" : "active",
      snoozedUntilTs: 0
    });
    return;
  }

  if (actionType === "set_active") {
    await updateTaskOverride(taskId, { done: false, status: "active", snoozedUntilTs: 0 });
    return;
  }

  if (actionType === "set_status") {
    const status = normalizeTaskLifecycleStatus(payload.status);
    await updateTaskOverride(taskId, {
      done: status === "done",
      status,
      snoozedUntilTs: status === "snoozed" ? toNum(payload.snoozedUntilTs, 0) : 0
    });
    return;
  }

  if (actionType === "snooze_until") {
    await updateTaskOverride(taskId, {
      done: false,
      status: "snoozed",
      snoozedUntilTs: toNum(payload.snoozedUntilTs, 0)
    });
    return;
  }

  if (actionType === "delete_task_context") {
    const payloadUrls = (payload.urls || [])
      .map((url) => canonicalizeUrl(String(url || "")))
      .filter((url) => isTrackableWebUrl(url));
    const urls = payloadUrls.length ? payloadUrls : await taskUrlsForId(taskId);
    await withRetry(() => deleteEventsByUrls(urls));
    await removeTaskOverride(taskId);
  }
}

async function registerSyncDevice({ force = false } = {}) {
  const syncSettings = await getSyncSettings();
  if (!isSyncConfigured(syncSettings)) {
    throw new Error("Set backend URL and API token before registering device");
  }

  if (syncSettings.deviceId && !force) {
    return syncSettings;
  }

  const response = await fetchSyncJson(syncSettings, "/v1/devices/register", {
    method: "POST",
    body: {
      platform: "chrome_extension",
      deviceLabel: syncSettings.deviceLabel || "Context Restore Chrome"
    }
  });

  return setSyncSettings({
    deviceId: String(response.deviceId || "").trim(),
    lastError: ""
  });
}

async function pullRemoteActions(syncSettings) {
  const params = new URLSearchParams({ deviceId: syncSettings.deviceId });
  if (syncSettings.lastPullAt) {
    params.set("since", syncSettings.lastPullAt);
  }

  const response = await fetchSyncJson(syncSettings, `/v1/sync/actions?${params.toString()}`);
  const actions = Array.isArray(response.actions) ? response.actions : [];

  for (const action of actions) {
    await applyRemoteTaskAction(action);
  }

  const actionIds = actions.map((action) => action.id).filter(Boolean);
  if (actionIds.length) {
    await fetchSyncJson(syncSettings, "/v1/sync/actions/ack", {
      method: "POST",
      body: {
        deviceId: syncSettings.deviceId,
        actionIds
      }
    });
  }

  await setSyncSettings({
    lastPullAt: new Date().toISOString(),
    lastError: ""
  });

  return { pulled: actions.length, acked: actionIds.length };
}

async function uploadTaskFeedSnapshot(syncSettings) {
  const baseTasks = await buildTaskFeed(200, true);
  const taskRelations = await getTaskRelations();
  const tasks = applyTaskRelationsForSync(baseTasks, taskRelations);
  const snapshotTs = nowMs();

  const response = await fetchSyncJson(syncSettings, "/v1/sync/upload", {
    method: "POST",
    body: {
      deviceId: syncSettings.deviceId,
      snapshotTs,
      schemaVersion: 1,
      tasks,
      replaceMissing: true
    }
  });

  await setSyncSettings({
    lastUploadTs: snapshotTs,
    lastSuccessTs: nowMs(),
    lastError: ""
  });

  return {
    uploadedTaskCount: tasks.length,
    acceptedTasks: Number(response.acceptedTasks || 0),
    rejectedTasks: Number(response.rejectedTasks || 0)
  };
}

async function performSyncNow(reason = "manual", { forceRegister = false } = {}) {
  let syncSettings = await getSyncSettings();
  if (!syncSettings.enabled) {
    return { ok: true, skipped: true, reason: "Sync disabled" };
  }

  if (!isSyncConfigured(syncSettings)) {
    throw new Error("Sync backend URL and API token are required");
  }

  try {
    syncSettings = await registerSyncDevice({ force: forceRegister });
    const pull = await pullRemoteActions(syncSettings);
    syncSettings = await getSyncSettings();
    const upload = await uploadTaskFeedSnapshot(syncSettings);

    await setSyncSettings({
      lastSuccessTs: nowMs(),
      lastError: ""
    });

    return {
      ok: true,
      reason,
      pull,
      upload
    };
  } catch (error) {
    await setSyncSettings({
      lastError: String(error?.message || error || "Sync failed")
    });
    throw error;
  }
}

async function pushTaskActionToBackend(taskId, actionType, payload = {}) {
  const safeTaskId = String(taskId || "").trim();
  if (!safeTaskId) {
    throw new Error("Missing taskId");
  }

  let syncSettings = await getSyncSettings();
  if (!syncSettings.enabled || !isSyncConfigured(syncSettings)) {
    return { ok: false, skipped: true, reason: "sync_not_configured" };
  }

  if (!syncSettings.deviceId) {
    syncSettings = await registerSyncDevice({ force: false });
  }

  const encodedTaskId = encodeURIComponent(safeTaskId);
  const response = await fetchSyncJson(syncSettings, `/v1/tasks/${encodedTaskId}/actions`, {
    method: "POST",
    body: {
      actionType,
      payload,
      deviceId: syncSettings.deviceId || null
    }
  });

  await setSyncSettings({ lastError: "" });
  return response;
}

function triggerBackgroundSync(reason) {
  performSyncNow(reason).catch(() => {
    // Best-effort background sync; errors are persisted in sync settings.
  });
}

function maybeTriggerRealtimeSync(reason) {
  const ts = nowMs();
  if (ts - lastRealtimeSyncTs < REALTIME_SYNC_COOLDOWN_MS) {
    return;
  }
  lastRealtimeSyncTs = ts;
  triggerBackgroundSync(reason);
}

async function openBriefingPage(taskId = "") {
  const url = chrome.runtime.getURL("src/briefing/briefing.html");
  const finalUrl = taskId ? `${url}#task=${encodeURIComponent(taskId)}` : url;
  await chrome.tabs.create({ url: finalUrl });
}

async function latestScrollByUrl(urls) {
  const normalizedUrls = [...new Set((urls || []).map((url) => canonicalizeUrl(String(url || ""))).filter(Boolean))];
  if (!normalizedUrls.length) {
    return {};
  }

  const urlSet = new Set(normalizedUrls);
  const events = await withRetry(() => getRecentEvents(12_000, nowMs() - RESUME_SCROLL_LOOKBACK_MS));
  const output = {};

  for (const event of events) {
    if (event.event_type !== "engagement_snapshot") {
      continue;
    }
    const url = canonicalizeUrl(String(event.url || ""));
    if (!urlSet.has(url) || output[url]) {
      continue;
    }
    const scrollPct = clamp(toNum(event.payload?.scrollPct, -1), 0, 100);
    if (!Number.isFinite(scrollPct) || scrollPct < 3) {
      continue;
    }
    output[url] = {
      scrollPct: Number(scrollPct.toFixed(1)),
      ts: toNum(event.ts, 0)
    };
  }

  return output;
}

async function tryRestoreScrollInTab(tabId) {
  const pending = pendingScrollRestoreByTabId.get(tabId);
  if (!pending) {
    return;
  }

  if (pending.attempts >= RESUME_SCROLL_MAX_ATTEMPTS) {
    pendingScrollRestoreByTabId.delete(tabId);
    return;
  }

  pending.attempts += 1;
  pendingScrollRestoreByTabId.set(tabId, pending);

  try {
    const tab = await getTabById(tabId);
    if (!tab?.url) {
      throw new Error("Tab not ready");
    }
    const canonicalTabUrl = canonicalizeUrl(tab.url);
    if (pending.url && canonicalTabUrl && canonicalTabUrl !== pending.url) {
      pendingScrollRestoreByTabId.delete(tabId);
      return;
    }
    await chrome.tabs.sendMessage(tabId, {
      type: "RESTORE_SCROLL_POSITION",
      scrollPct: pending.scrollPct
    });
    pendingScrollRestoreByTabId.delete(tabId);
  } catch {
    setTimeout(() => {
      tryRestoreScrollInTab(tabId);
    }, 220 + pending.attempts * 140);
  }
}

async function resumeTask(urls) {
  if (!Array.isArray(urls) || urls.length === 0) {
    return;
  }

  const filtered = [...new Set(urls.map((url) => String(url || "").trim()).filter((url) => isTrackableWebUrl(url)))];
  if (!filtered.length) {
    return;
  }

  const scrollByUrl = await latestScrollByUrl(filtered);
  const openedTabs = [];

  for (let i = 0; i < filtered.length; i += 1) {
    const url = filtered[i];
    const tab = await chrome.tabs.create({ url, active: i === 0 });
    openedTabs.push(tab);

    const canonicalUrl = canonicalizeUrl(url);
    const snapshot = scrollByUrl[canonicalUrl];
    if (snapshot && tab?.id !== undefined) {
      pendingScrollRestoreByTabId.set(tab.id, {
        url: canonicalUrl,
        scrollPct: snapshot.scrollPct,
        attempts: 0
      });
      tryRestoreScrollInTab(tab.id);
    }
  }

  if (openedTabs.length) {
    await ingestEvent("guided_resume", {
      tabId: openedTabs[0]?.id ?? null,
      windowId: openedTabs[0]?.windowId ?? null,
      url: filtered[0],
      payload: {
        restoredCount: openedTabs.length,
        withScrollMemoryCount: Object.keys(scrollByUrl).length
      }
    });
  }
}

async function cleanupOldEvents() {
  const settings = await getSettings();
  const now = nowMs();
  const retentionDays = Math.max(1, settings.retentionDays);
  const cutoffTs = now - retentionDays * 24 * 60 * 60 * 1000;
  await withRetry(() => pruneEventsBefore(cutoffTs));
  await withRetry(() => purgeDeletedEventsBefore(now - DELETED_EVENT_GRACE_MS));
}

async function ensureAlarms() {
  await chrome.alarms.create(ALARM_RETENTION_CLEANUP, { periodInMinutes: 60 });
  await chrome.alarms.create(ALARM_SYNC_EVALUATION, { periodInMinutes: 15 });
}

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get([
    STORAGE_KEYS.TRACKING_PAUSED,
    STORAGE_KEYS.RETENTION_DAYS,
    STORAGE_KEYS.TASK_OVERRIDES,
    STORAGE_KEYS.TASK_RELATIONS,
    STORAGE_KEYS.NUDGE_SETTINGS,
    STORAGE_KEYS.NUDGE_STATE,
    STORAGE_KEYS.SYNC_SETTINGS
  ]);

  await chrome.storage.local.set({
    [STORAGE_KEYS.TRACKING_PAUSED]:
      existing[STORAGE_KEYS.TRACKING_PAUSED] ?? DEFAULTS.trackingPaused,
    [STORAGE_KEYS.RETENTION_DAYS]: existing[STORAGE_KEYS.RETENTION_DAYS] ?? DEFAULTS.retentionDays,
    [STORAGE_KEYS.TASK_OVERRIDES]: existing[STORAGE_KEYS.TASK_OVERRIDES] ?? {},
    [STORAGE_KEYS.TASK_RELATIONS]: normalizeTaskRelations(
      existing[STORAGE_KEYS.TASK_RELATIONS] || defaultTaskRelations()
    ),
    [STORAGE_KEYS.NUDGE_SETTINGS]: normalizeNudgeSettings(
      existing[STORAGE_KEYS.NUDGE_SETTINGS] || {},
      DEFAULTS.nudgeSettings
    ),
    [STORAGE_KEYS.NUDGE_STATE]: existing[STORAGE_KEYS.NUDGE_STATE] || defaultNudgeState(),
    [STORAGE_KEYS.SYNC_SETTINGS]: normalizeSyncSettings(
      existing[STORAGE_KEYS.SYNC_SETTINGS] || {},
      DEFAULTS.syncSettings
    )
  });

  await ensureAlarms();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarms();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_RETENTION_CLEANUP) {
    await cleanupOldEvents();
    return;
  }

  if (alarm.name === ALARM_SYNC_EVALUATION) {
    await performSyncNow("alarm").catch(() => {
      // Keep alarm loop resilient; sync errors are recorded in settings.
    });
  }
});

chrome.tabs.onCreated.addListener(async (tab) => {
  await ingestEvent("tab_created", {
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url,
    title: tab.title,
    payload: { openerTabId: tab.openerTabId ?? null }
  });
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await getTabById(activeInfo.tabId);
  await ingestEvent("tab_activated", {
    tabId: activeInfo.tabId,
    windowId: activeInfo.windowId,
    url: tab?.url,
    title: tab?.title
  });
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (pendingScrollRestoreByTabId.has(tabId) && changeInfo.status === "complete") {
    tryRestoreScrollInTab(tabId);
  }

  if (!changeInfo.url && !changeInfo.status) {
    return;
  }

  await ingestEvent("tab_updated", {
    tabId,
    windowId: tab.windowId,
    url: changeInfo.url || tab.url,
    title: tab.title,
    payload: { status: changeInfo.status ?? "unknown" }
  });
});

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  pendingScrollRestoreByTabId.delete(tabId);

  await ingestEvent("tab_removed", {
    tabId,
    windowId: removeInfo.windowId,
    payload: { isWindowClosing: removeInfo.isWindowClosing }
  });
});

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) {
    return;
  }

  await ingestEvent("nav_committed", {
    tabId: details.tabId,
    windowId: details.windowId,
    url: details.url,
    payload: {
      transitionType: details.transitionType,
      transitionQualifiers: details.transitionQualifiers
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (!message?.type) {
      sendResponse({ ok: false, error: "Missing message type" });
      return;
    }

    if (message.type === MESSAGE_TYPES.ENGAGEMENT_SNAPSHOT) {
      await ingestEvent("engagement_snapshot", {
        tabId: sender.tab?.id ?? message.tabId ?? null,
        windowId: sender.tab?.windowId ?? null,
        url: message.url,
        title: sender.tab?.title ?? "",
        payload: message.metrics
      });
      sendResponse({ ok: true });
      return;
    }

    if (message.type === MESSAGE_TYPES.GET_TASK_FEED) {
      const limit = Number(message?.filters?.limit || DEFAULTS.feedLimit);
      const includeDone = Boolean(message?.filters?.includeDone);
      const tasks = await buildTaskFeed(limit, includeDone);
      sendResponse({ ok: true, type: MESSAGE_TYPES.TASK_FEED_RESPONSE, tasks });
      return;
    }

    if (message.type === MESSAGE_TYPES.GET_TASK_RELATIONS) {
      const taskRelations = await getTaskRelations();
      sendResponse({ ok: true, taskRelations });
      return;
    }

    if (message.type === MESSAGE_TYPES.GET_REMOTE_TASK_FEED) {
      const includeDone = Boolean(message?.filters?.includeDone);
      const limit = Math.min(500, Math.max(1, Number(message?.filters?.limit || DEFAULTS.feedLimit)));
      const syncSettings = await getSyncSettings();

      if (!syncSettings.enabled || !isSyncConfigured(syncSettings)) {
        sendResponse({ ok: false, error: "Cloud sync is not configured" });
        return;
      }

      let syncResult = null;
      let syncError = "";
      if (Boolean(message?.syncFirst)) {
        try {
          syncResult = await performSyncNow("briefing-refresh");
        } catch (error) {
          syncError = String(error?.message || error || "Sync failed");
        }
      }

      const response = await fetchSyncJson(
        await getSyncSettings(),
        `/v1/tasks?includeDone=${includeDone ? "true" : "false"}&limit=${limit}`
      );

      sendResponse({
        ok: true,
        tasks: Array.isArray(response.tasks) ? response.tasks : [],
        serverTs: Number(response.serverTs || 0),
        syncResult,
        syncError
      });
      return;
    }

    if (message.type === MESSAGE_TYPES.GET_DAILY_SUMMARY) {
      const days = Math.max(1, Math.min(30, Number(message?.filters?.days || 7)));
      const lookbackMs = days * 24 * 60 * 60 * 1000;
      const events = await withRetry(() =>
        getRecentEvents(10000, nowMs() - lookbackMs, { includeSoftDeleted: true })
      );
      const summaries = buildDailySemanticsFromEvents(events, {
        days,
        nowTs: nowMs()
      });
      sendResponse({ ok: true, summaries });
      return;
    }

    if (message.type === MESSAGE_TYPES.OPEN_BRIEFING_PAGE) {
      await openBriefingPage(String(message?.taskId || ""));
      sendResponse({ ok: true });
      return;
    }

    if (message.type === MESSAGE_TYPES.RESUME_TASK) {
      await resumeTask(message.urls || []);
      sendResponse({ ok: true });
      return;
    }

    if (message.type === MESSAGE_TYPES.DELETE_TASK) {
      const taskId = String(message.taskId || "").trim();
      let urls = (message.urls || [])
        .map((url) => canonicalizeUrl(String(url || "")))
        .filter((url) => isTrackableWebUrl(url));
      if (!taskId) {
        sendResponse({ ok: false, error: "Missing taskId" });
        return;
      }

      if (!urls.length) {
        urls = await taskUrlsForId(taskId);
      }

      const deletedEvents = await withRetry(() => deleteEventsByUrls(urls));
      await removeTaskOverride(taskId);

      let cloudAction = null;
      try {
        cloudAction = await pushTaskActionToBackend(taskId, "delete_task_context", { urls });
      } catch (error) {
        await setSyncSettings({
          lastError: String(error?.message || error || "Could not sync task delete")
        });
      }

      triggerBackgroundSync("local-delete-task");
      sendResponse({ ok: true, deletedEvents, cloudAction });
      return;
    }

    if (message.type === MESSAGE_TYPES.RENAME_TASK) {
      const taskId = String(message.taskId || "").trim();
      const title = String(message.title || "").trim();
      if (!taskId) {
        sendResponse({ ok: false, error: "Missing taskId" });
        return;
      }
      if (!title) {
        await updateTaskOverride(taskId, { title: undefined });
      } else {
        await updateTaskOverride(taskId, { title: title.slice(0, 120) });
      }
      triggerBackgroundSync("local-rename-task");
      sendResponse({ ok: true });
      return;
    }

    if (message.type === MESSAGE_TYPES.SET_TASK_DONE) {
      const taskId = String(message.taskId || "").trim();
      const done = Boolean(message.done);
      if (!taskId) {
        sendResponse({ ok: false, error: "Missing taskId" });
        return;
      }
      await updateTaskOverride(taskId, {
        done,
        status: done ? "done" : "active",
        snoozedUntilTs: 0
      });

      let cloudAction = null;
      try {
        cloudAction = await pushTaskActionToBackend(
          taskId,
          done ? "set_done" : "set_active",
          done ? { done: true } : {}
        );
      } catch (error) {
        await setSyncSettings({
          lastError: String(error?.message || error || "Could not sync task done state")
        });
      }

      triggerBackgroundSync("local-set-done");
      sendResponse({ ok: true, done, cloudAction });
      return;
    }

    if (message.type === MESSAGE_TYPES.SET_TASK_LIFECYCLE) {
      const taskId = String(message.taskId || "").trim();
      const status = normalizeTaskLifecycleStatus(message.status);
      const snoozedUntilTs = toNum(message.snoozedUntilTs, 0);
      if (!taskId) {
        sendResponse({ ok: false, error: "Missing taskId" });
        return;
      }

      await updateTaskOverride(taskId, {
        done: status === "done",
        status,
        snoozedUntilTs: status === "snoozed" ? snoozedUntilTs : 0
      });

      let cloudAction = null;
      try {
        if (status === "done" || status === "dropped") {
          cloudAction = await pushTaskActionToBackend(taskId, "set_done", { done: true });
        } else if (status === "active") {
          cloudAction = await pushTaskActionToBackend(taskId, "set_active", {});
        }
      } catch (error) {
        await setSyncSettings({
          lastError: String(error?.message || error || "Could not sync task lifecycle")
        });
      }

      triggerBackgroundSync("local-set-lifecycle");
      sendResponse({
        ok: true,
        status,
        snoozedUntilTs: status === "snoozed" ? snoozedUntilTs : 0,
        cloudAction
      });
      return;
    }

    if (message.type === MESSAGE_TYPES.SNOOZE_TASK) {
      const taskId = String(message.taskId || "").trim();
      const snoozedUntilTs = Math.max(nowMs() + 60_000, toNum(message.snoozedUntilTs, 0));
      if (!taskId) {
        sendResponse({ ok: false, error: "Missing taskId" });
        return;
      }
      await updateTaskOverride(taskId, {
        done: false,
        status: "snoozed",
        snoozedUntilTs
      });
      triggerBackgroundSync("local-snooze-task");
      sendResponse({ ok: true, status: "snoozed", snoozedUntilTs });
      return;
    }

    if (message.type === MESSAGE_TYPES.REMIND_TASK_AT) {
      const taskId = String(message.taskId || "").trim();
      const remindAtTs = Math.max(nowMs() + 60_000, toNum(message.remindAtTs, 0));
      if (!taskId) {
        sendResponse({ ok: false, error: "Missing taskId" });
        return;
      }
      await updateTaskOverride(taskId, {
        done: false,
        status: "snoozed",
        snoozedUntilTs: remindAtTs
      });
      triggerBackgroundSync("local-remind-at");
      sendResponse({ ok: true, status: "snoozed", snoozedUntilTs: remindAtTs });
      return;
    }

    if (message.type === MESSAGE_TYPES.REMIND_TASK_FRIDAY) {
      const taskId = String(message.taskId || "").trim();
      if (!taskId) {
        sendResponse({ ok: false, error: "Missing taskId" });
        return;
      }
      const snoozedUntilTs = upcomingFridayAt(9, 0);
      await updateTaskOverride(taskId, {
        done: false,
        status: "snoozed",
        snoozedUntilTs
      });
      triggerBackgroundSync("local-remind-friday");
      sendResponse({ ok: true, status: "snoozed", snoozedUntilTs });
      return;
    }

    if (message.type === MESSAGE_TYPES.MERGE_TASKS) {
      const primaryTaskId = String(message.primaryTaskId || "").trim();
      const secondaryTaskId = String(message.secondaryTaskId || "").trim();
      const taskRelations = await mergeTaskRelations(
        primaryTaskId,
        secondaryTaskId,
        message.primaryTaskSnapshot || null,
        message.secondaryTaskSnapshot || null
      );
      triggerBackgroundSync("local-merge-tasks");
      sendResponse({ ok: true, taskRelations });
      return;
    }

    if (message.type === MESSAGE_TYPES.KEEP_TASKS_SEPARATE) {
      const primaryTaskId = String(message.primaryTaskId || "").trim();
      const secondaryTaskId = String(message.secondaryTaskId || "").trim();
      const taskRelations = await keepTasksSeparate(
        primaryTaskId,
        secondaryTaskId,
        message.primaryTaskSnapshot || null,
        message.secondaryTaskSnapshot || null
      );
      triggerBackgroundSync("local-keep-separate");
      sendResponse({ ok: true, taskRelations });
      return;
    }

    if (message.type === MESSAGE_TYPES.UNMERGE_TASKS) {
      const primaryTaskId = String(message.primaryTaskId || "").trim();
      const secondaryTaskId = String(message.secondaryTaskId || "").trim();
      const taskRelations = await unmergeTasks(primaryTaskId, secondaryTaskId);
      triggerBackgroundSync("local-unmerge-tasks");
      sendResponse({ ok: true, taskRelations });
      return;
    }

    if (message.type === MESSAGE_TYPES.SET_TRACKING_PAUSED) {
      const paused = Boolean(message.paused);
      await chrome.storage.local.set({ [STORAGE_KEYS.TRACKING_PAUSED]: paused });
      sendResponse({ ok: true, paused });
      return;
    }

    if (message.type === MESSAGE_TYPES.SET_RETENTION_DAYS) {
      const retentionDays = Math.max(1, Math.min(90, Number(message.retentionDays || 30)));
      await chrome.storage.local.set({ [STORAGE_KEYS.RETENTION_DAYS]: retentionDays });
      sendResponse({ ok: true, retentionDays });
      return;
    }

    if (message.type === MESSAGE_TYPES.SET_NUDGE_SETTINGS) {
      const settings = await getNudgeSettings();
      const next = await setNudgeSettings({
        ...settings,
        ...(message.settings || {})
      });
      sendResponse({ ok: true, nudgeSettings: next });
      return;
    }

    if (message.type === MESSAGE_TYPES.SET_SYNC_SETTINGS) {
      const incoming = message?.settings || {};
      const current = await getSyncSettings();
      const nextBackend = String(incoming.backendUrl ?? current.backendUrl ?? "")
        .trim()
        .replace(/\/+$/, "");
      const nextToken = String(incoming.apiToken ?? current.apiToken ?? "").trim();
      const credentialsChanged =
        nextBackend !== current.backendUrl || nextToken !== current.apiToken;

      const patch = {
        enabled:
          incoming.enabled === undefined ? current.enabled : Boolean(incoming.enabled),
        backendUrl: nextBackend,
        apiToken: nextToken,
        deviceLabel: String(incoming.deviceLabel ?? current.deviceLabel ?? "")
          .trim()
          .slice(0, 120),
        iosReminderEnabled:
          incoming.iosReminderEnabled === undefined
            ? current.iosReminderEnabled
            : Boolean(incoming.iosReminderEnabled),
        iosReminderHour: Math.max(
          0,
          Math.min(23, Number(incoming.iosReminderHour ?? current.iosReminderHour ?? 20) || 20)
        ),
        iosReminderMinute: Math.max(
          0,
          Math.min(59, Number(incoming.iosReminderMinute ?? current.iosReminderMinute ?? 0) || 0)
        )
      };

      if (credentialsChanged) {
        patch.deviceId = "";
        patch.lastUploadTs = 0;
        patch.lastPullAt = "";
        patch.lastSuccessTs = 0;
        patch.lastError = "";
      }

      const next = await setSyncSettings(patch);
      sendResponse({ ok: true, syncSettings: next });
      return;
    }

    if (message.type === MESSAGE_TYPES.REGISTER_SYNC_DEVICE) {
      const next = await registerSyncDevice({ force: Boolean(message?.force) });
      sendResponse({ ok: true, syncSettings: next, deviceId: next.deviceId });
      return;
    }

    if (message.type === MESSAGE_TYPES.RUN_SYNC_NOW) {
      const result = await performSyncNow("manual", {
        forceRegister: Boolean(message?.forceRegister)
      });
      const syncSettings = await getSyncSettings();
      sendResponse({ ok: true, result, syncSettings });
      return;
    }

    if (message.type === MESSAGE_TYPES.GET_SETTINGS) {
      const settings = await getSettings();
      sendResponse({ ok: true, settings });
      return;
    }

    if (message.type === MESSAGE_TYPES.CLEAR_ALL_DATA) {
      await withRetry(() => clearAllEvents());
      await chrome.storage.local.set({
        [STORAGE_KEYS.TASK_OVERRIDES]: {},
        [STORAGE_KEYS.TASK_RELATIONS]: defaultTaskRelations(),
        [STORAGE_KEYS.NUDGE_STATE]: defaultNudgeState()
      });
      const syncSettings = await getSyncSettings();
      let cloudReset = null;
      if (syncSettings.enabled && isSyncConfigured(syncSettings)) {
        try {
          cloudReset = await fetchSyncJson(syncSettings, "/v1/data/reset", {
            method: "POST",
            body: {}
          });
        } catch {
          // Keep local delete successful even if cloud reset fails.
        }
      }

      const nextSync = await setSyncSettings({
        lastUploadTs: 0,
        lastPullAt: "",
        lastSuccessTs: 0,
        lastError: ""
      });
      sendResponse({
        ok: true,
        cloudReset,
        syncSettings: nextSync
      });
      return;
    }

    sendResponse({ ok: false, error: `Unhandled message type: ${message.type}` });
  })().catch((error) => {
    sendResponse({ ok: false, error: String(error) });
  });

  return true;
});
