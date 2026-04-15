import { MESSAGE_TYPES } from "../shared/constants.js";

const pauseToggle = document.getElementById("pause-toggle");
const clearBtn = document.getElementById("clear-data");
const retentionInput = document.getElementById("retention-days");
const saveRetentionBtn = document.getElementById("save-retention");
const nudgeEnabledInput = document.getElementById("nudge-enabled");
const quietStartInput = document.getElementById("quiet-start");
const quietEndInput = document.getElementById("quiet-end");
const dailyCapInput = document.getElementById("daily-cap");
const minInactiveHoursInput = document.getElementById("min-inactive-hours");
const saveRemindersBtn = document.getElementById("save-reminders");
const nudgeSummaryEl = document.getElementById("nudge-summary");
const syncEnabledInput = document.getElementById("sync-enabled");
const syncBackendUrlInput = document.getElementById("sync-backend-url");
const syncApiTokenInput = document.getElementById("sync-api-token");
const syncDeviceLabelInput = document.getElementById("sync-device-label");
const syncDeviceIdInput = document.getElementById("sync-device-id");
const iosReminderEnabledInput = document.getElementById("ios-reminder-enabled");
const iosReminderHourInput = document.getElementById("ios-reminder-hour");
const iosReminderMinuteInput = document.getElementById("ios-reminder-minute");
const syncSummaryEl = document.getElementById("sync-summary");
const saveSyncBtn = document.getElementById("save-sync");
const registerDeviceBtn = document.getElementById("register-device");
const syncNowBtn = document.getElementById("sync-now");
const statusEl = document.getElementById("status");

function setStatus(text, ok = true) {
  statusEl.textContent = text;
  statusEl.className = ok ? "ok" : "";
}

function updateNudgeSummary(settings, dailyCount = 0) {
  nudgeSummaryEl.textContent = `Today sent: ${dailyCount} / ${settings.dailyCap}`;
}

function formatTime(ts) {
  const value = Number(ts);
  if (!value) {
    return "Never";
  }
  return new Date(value).toLocaleString();
}

function updateSyncSummary(syncSettings) {
  const enabled = syncSettings.enabled ? "enabled" : "disabled";
  const status = syncSettings.lastError
    ? `error: ${syncSettings.lastError}`
    : `last success: ${formatTime(syncSettings.lastSuccessTs)}`;
  const iosSchedule = syncSettings.iosReminderEnabled
    ? `iPhone reminders: ${String(syncSettings.iosReminderHour).padStart(2, "0")}:${String(syncSettings.iosReminderMinute).padStart(2, "0")}`
    : "iPhone reminders: off";
  syncSummaryEl.textContent = `Sync ${enabled} • ${status} • ${iosSchedule}`;
}

function readBoundedInt(input, min, max, fallback) {
  const value = Number(input.value);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

async function loadSettings() {
  const response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.GET_SETTINGS });
  if (!response?.ok) {
    throw new Error(response?.error || "Unable to load settings");
  }

  pauseToggle.checked = response.settings.trackingPaused;
  retentionInput.value = String(response.settings.retentionDays || 30);
  const nudgeSettings = response.settings.nudgeSettings || {};
  const syncSettings = response.settings.syncSettings || {};
  nudgeEnabledInput.checked = Boolean(nudgeSettings.enabled);
  quietStartInput.value = String(nudgeSettings.quietHoursStart ?? 22);
  quietEndInput.value = String(nudgeSettings.quietHoursEnd ?? 8);
  dailyCapInput.value = String(nudgeSettings.dailyCap ?? 3);
  minInactiveHoursInput.value = String(nudgeSettings.minInactiveHours ?? 18);
  updateNudgeSummary(nudgeSettings, response.settings.nudgeDailyCount || 0);
  syncEnabledInput.checked = Boolean(syncSettings.enabled);
  syncBackendUrlInput.value = String(syncSettings.backendUrl || "");
  syncApiTokenInput.value = String(syncSettings.apiToken || "");
  syncDeviceLabelInput.value = String(syncSettings.deviceLabel || "Context Restore Chrome");
  syncDeviceIdInput.value = String(syncSettings.deviceId || "");
  iosReminderEnabledInput.checked = Boolean(syncSettings.iosReminderEnabled);
  iosReminderHourInput.value = String(syncSettings.iosReminderHour ?? 20);
  iosReminderMinuteInput.value = String(syncSettings.iosReminderMinute ?? 0);
  updateSyncSummary(syncSettings);
}

pauseToggle.addEventListener("change", async () => {
  const paused = pauseToggle.checked;
  const response = await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.SET_TRACKING_PAUSED,
    paused
  });

  if (!response?.ok) {
    setStatus(response?.error || "Failed to update tracking state", false);
    pauseToggle.checked = !paused;
    return;
  }

  setStatus(paused ? "Tracking paused" : "Tracking resumed", true);
});

clearBtn.addEventListener("click", async () => {
  const confirmed = window.confirm(
    "Delete all Context Restore data? If cloud sync is enabled, cloud snapshots will also be removed."
  );
  if (!confirmed) {
    return;
  }

  const response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.CLEAR_ALL_DATA });
  if (!response?.ok) {
    setStatus(response?.error || "Failed to clear local data", false);
    return;
  }

  if (response.cloudReset?.ok) {
    const deletedTasks = Number(response.cloudReset.summary?.deletedTasks || 0);
    setStatus(`All local data deleted. Cloud reset complete (${deletedTasks} tasks removed).`, true);
    return;
  }

  setStatus("All local data deleted", true);
});

saveRetentionBtn.addEventListener("click", async () => {
  const retentionDays = Number(retentionInput.value);
  if (!Number.isFinite(retentionDays) || retentionDays < 1 || retentionDays > 90) {
    setStatus("Retention days must be between 1 and 90", false);
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.SET_RETENTION_DAYS,
    retentionDays
  });

  if (!response?.ok) {
    setStatus(response?.error || "Failed to save retention days", false);
    return;
  }

  retentionInput.value = String(response.retentionDays);
  setStatus(`Retention updated to ${response.retentionDays} days`, true);
});

saveRemindersBtn.addEventListener("click", async () => {
  const settings = {
    enabled: nudgeEnabledInput.checked,
    quietHoursStart: readBoundedInt(quietStartInput, 0, 23, 22),
    quietHoursEnd: readBoundedInt(quietEndInput, 0, 23, 8),
    dailyCap: readBoundedInt(dailyCapInput, 1, 10, 3),
    minInactiveHours: readBoundedInt(minInactiveHoursInput, 1, 168, 18)
  };

  const response = await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.SET_NUDGE_SETTINGS,
    settings
  });

  if (!response?.ok) {
    setStatus(response?.error || "Failed to save reminder settings", false);
    return;
  }

  const next = response.nudgeSettings;
  nudgeEnabledInput.checked = Boolean(next.enabled);
  quietStartInput.value = String(next.quietHoursStart);
  quietEndInput.value = String(next.quietHoursEnd);
  dailyCapInput.value = String(next.dailyCap);
  minInactiveHoursInput.value = String(next.minInactiveHours);
  updateNudgeSummary(next);
  setStatus("Reminder settings saved", true);
});

saveSyncBtn.addEventListener("click", async () => {
  const settings = {
    enabled: syncEnabledInput.checked,
    backendUrl: syncBackendUrlInput.value.trim(),
    apiToken: syncApiTokenInput.value.trim(),
    deviceLabel: syncDeviceLabelInput.value.trim(),
    iosReminderEnabled: iosReminderEnabledInput.checked,
    iosReminderHour: readBoundedInt(iosReminderHourInput, 0, 23, 20),
    iosReminderMinute: readBoundedInt(iosReminderMinuteInput, 0, 59, 0)
  };

  const response = await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.SET_SYNC_SETTINGS,
    settings
  });

  if (!response?.ok) {
    setStatus(response?.error || "Failed to save sync settings", false);
    return;
  }

  const next = response.syncSettings || {};
  syncEnabledInput.checked = Boolean(next.enabled);
  syncBackendUrlInput.value = String(next.backendUrl || "");
  syncApiTokenInput.value = String(next.apiToken || "");
  syncDeviceLabelInput.value = String(next.deviceLabel || "Context Restore Chrome");
  syncDeviceIdInput.value = String(next.deviceId || "");
  iosReminderEnabledInput.checked = Boolean(next.iosReminderEnabled);
  iosReminderHourInput.value = String(next.iosReminderHour ?? 20);
  iosReminderMinuteInput.value = String(next.iosReminderMinute ?? 0);
  updateSyncSummary(next);
  setStatus("Sync settings saved", true);
});

registerDeviceBtn.addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.REGISTER_SYNC_DEVICE
  });

  if (!response?.ok) {
    setStatus(response?.error || "Failed to register sync device", false);
    return;
  }

  syncDeviceIdInput.value = String(response.deviceId || "");
  if (response.syncSettings) {
    updateSyncSummary(response.syncSettings);
  }
  setStatus("Sync device registered", true);
});

syncNowBtn.addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.RUN_SYNC_NOW
  });

  if (!response?.ok) {
    setStatus(response?.error || "Sync failed", false);
    return;
  }

  if (response.syncSettings) {
    syncDeviceIdInput.value = String(response.syncSettings.deviceId || "");
    updateSyncSummary(response.syncSettings);
  }

  if (response.result?.skipped) {
    setStatus(`Sync skipped: ${response.result.reason}`, true);
    return;
  }

  const pulled = Number(response.result?.pull?.pulled || 0);
  const uploaded = Number(response.result?.upload?.uploadedTaskCount || 0);
  setStatus(`Sync complete (pulled ${pulled}, uploaded ${uploaded})`, true);
});

loadSettings().catch((error) => {
  setStatus(error.message, false);
});
