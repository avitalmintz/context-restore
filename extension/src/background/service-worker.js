import {
  addEvent,
  clearAllEvents,
  deleteEventsByUrls,
  getRecentEvents,
  pruneEventsBefore
} from "./storage.js";
import { buildTaskFeedFromEvents, canonicalizeUrl, safeDomain } from "./inference.js";
import {
  applyNudgeSends,
  buildNudgeNotification,
  computeOpenLoopScore,
  deriveNudgePhase,
  normalizeNudgeSettings,
  selectNudgeCandidates
} from "./nudges.js";
import { DEFAULTS, MESSAGE_TYPES, STORAGE_KEYS } from "../shared/constants.js";

const ALARM_RETENTION_CLEANUP = "retention-cleanup";
const ALARM_NUDGE_EVALUATION = "nudge-evaluation";
const ALARM_SYNC_EVALUATION = "sync-evaluation";
const NUDGE_NOTIFICATION_PREFIX = "context-nudge";
const REALTIME_SYNC_COOLDOWN_MS = 20 * 1000;

let lastRealtimeSyncTs = 0;

function nowMs() {
  return Date.now();
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

function notificationId(taskId, phase, ts = nowMs()) {
  return `${NUDGE_NOTIFICATION_PREFIX}:${phase}:${taskId}:${ts}`;
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

function parseNotificationId(id) {
  if (!id || !id.startsWith(`${NUDGE_NOTIFICATION_PREFIX}:`)) {
    return null;
  }
  const parts = id.split(":");
  if (parts.length < 4) {
    return null;
  }
  return {
    phase: parts[1],
    taskId: parts.slice(2, parts.length - 1).join(":"),
    sentAt: Number(parts[parts.length - 1])
  };
}

async function getTaskOverrides() {
  const values = await chrome.storage.local.get([STORAGE_KEYS.TASK_OVERRIDES]);
  return values[STORAGE_KEYS.TASK_OVERRIDES] || {};
}

async function setTaskOverrides(overrides) {
  await chrome.storage.local.set({ [STORAGE_KEYS.TASK_OVERRIDES]: overrides });
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

  if (!next.title && !next.done) {
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
    STORAGE_KEYS.NUDGE_SETTINGS,
    STORAGE_KEYS.NUDGE_STATE,
    STORAGE_KEYS.SYNC_SETTINGS
  ]);

  const nudgeSettings = normalizeNudgeSettings(
    values[STORAGE_KEYS.NUDGE_SETTINGS] || {},
    DEFAULTS.nudgeSettings
  );

  const nudgeState = values[STORAGE_KEYS.NUDGE_STATE] || defaultNudgeState();

  return {
    trackingPaused: values[STORAGE_KEYS.TRACKING_PAUSED] ?? DEFAULTS.trackingPaused,
    retentionDays: values[STORAGE_KEYS.RETENTION_DAYS] ?? DEFAULTS.retentionDays,
    taskOverrideCount: Object.keys(values[STORAGE_KEYS.TASK_OVERRIDES] || {}).length,
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
  const events = await withRetry(() => getRecentEvents(5000, nowMs() - lookbackMs));
  const taskOverrides = await getTaskOverrides();
  const tasks = buildTaskFeedFromEvents(events, {
    limit,
    includeDone,
    taskOverrides
  });

  const nudgeSettings = opts.nudgeSettings || (await getNudgeSettings());
  const currentTs = opts.nowTs || nowMs();

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
    await updateTaskOverride(taskId, { done: Boolean(payload.done) });
    return;
  }

  if (actionType === "set_active") {
    await updateTaskOverride(taskId, { done: false });
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
  const tasks = await buildTaskFeed(200, true);
  const snapshotTs = nowMs();

  const response = await fetchSyncJson(syncSettings, "/v1/sync/upload", {
    method: "POST",
    body: {
      deviceId: syncSettings.deviceId,
      snapshotTs,
      schemaVersion: 1,
      tasks
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

async function resumeTask(urls) {
  if (!Array.isArray(urls) || urls.length === 0) {
    return;
  }

  await chrome.tabs.create({ url: urls[0], active: true });
  for (const url of urls.slice(1)) {
    await chrome.tabs.create({ url, active: false });
  }
}

async function cleanupOldEvents() {
  const settings = await getSettings();
  const retentionDays = Math.max(1, settings.retentionDays);
  const cutoffTs = nowMs() - retentionDays * 24 * 60 * 60 * 1000;
  await withRetry(() => pruneEventsBefore(cutoffTs));
}

async function evaluateAndSendNudges() {
  const ts = nowMs();
  const nudgeSettings = await getNudgeSettings();
  const tasks = await buildTaskFeed(200, false, { nudgeSettings, nowTs: ts });
  const currentState = await getNudgeState();

  const { selected, state: normalizedState } = selectNudgeCandidates(
    tasks,
    currentState,
    nudgeSettings,
    ts
  );

  if (!selected.length) {
    if (normalizedState !== currentState) {
      await setNudgeState(normalizedState);
    }
    return;
  }

  const sent = [];

  for (const item of selected) {
    const content = buildNudgeNotification(item);
    const id = notificationId(item.taskId, item.phase, ts);

    try {
      await chrome.notifications.create(id, {
        type: "basic",
        title: content.title,
        message: content.message,
        contextMessage: content.contextMessage,
        iconUrl: chrome.runtime.getURL("src/shared/icon-128.png"),
        priority: 1
      });
      sent.push(item);
    } catch {
      // Ignore notification send failures and continue evaluating others.
    }
  }

  const nextState = applyNudgeSends(normalizedState, sent, ts);
  await setNudgeState(nextState);
}

async function ensureAlarms() {
  await chrome.alarms.create(ALARM_RETENTION_CLEANUP, { periodInMinutes: 60 });
  await chrome.alarms.create(ALARM_NUDGE_EVALUATION, { periodInMinutes: 60 });
  await chrome.alarms.create(ALARM_SYNC_EVALUATION, { periodInMinutes: 15 });
}

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get([
    STORAGE_KEYS.TRACKING_PAUSED,
    STORAGE_KEYS.RETENTION_DAYS,
    STORAGE_KEYS.TASK_OVERRIDES,
    STORAGE_KEYS.NUDGE_SETTINGS,
    STORAGE_KEYS.NUDGE_STATE,
    STORAGE_KEYS.SYNC_SETTINGS
  ]);

  await chrome.storage.local.set({
    [STORAGE_KEYS.TRACKING_PAUSED]:
      existing[STORAGE_KEYS.TRACKING_PAUSED] ?? DEFAULTS.trackingPaused,
    [STORAGE_KEYS.RETENTION_DAYS]: existing[STORAGE_KEYS.RETENTION_DAYS] ?? DEFAULTS.retentionDays,
    [STORAGE_KEYS.TASK_OVERRIDES]: existing[STORAGE_KEYS.TASK_OVERRIDES] ?? {},
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

  if (alarm.name === ALARM_NUDGE_EVALUATION) {
    await evaluateAndSendNudges();
    return;
  }

  if (alarm.name === ALARM_SYNC_EVALUATION) {
    await performSyncNow("alarm").catch(() => {
      // Keep alarm loop resilient; sync errors are recorded in settings.
    });
  }
});

chrome.notifications.onClicked.addListener(async (id) => {
  const parsed = parseNotificationId(id);
  if (!parsed) {
    return;
  }

  await chrome.notifications.clear(id);
  await openBriefingPage(parsed.taskId);
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
      const urls = (message.urls || [])
        .map((url) => canonicalizeUrl(String(url || "")))
        .filter((url) => isTrackableWebUrl(url));
      if (!taskId) {
        sendResponse({ ok: false, error: "Missing taskId" });
        return;
      }

      const deletedEvents = await withRetry(() => deleteEventsByUrls(urls));
      await removeTaskOverride(taskId);
      triggerBackgroundSync("local-delete-task");
      sendResponse({ ok: true, deletedEvents });
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
      await updateTaskOverride(taskId, { done });
      triggerBackgroundSync("local-set-done");
      sendResponse({ ok: true, done });
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
