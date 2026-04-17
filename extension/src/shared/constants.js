export const MESSAGE_TYPES = {
  ENGAGEMENT_SNAPSHOT: "ENGAGEMENT_SNAPSHOT",
  GET_TASK_FEED: "GET_TASK_FEED",
  GET_TASK_RELATIONS: "GET_TASK_RELATIONS",
  GET_DAILY_SUMMARY: "GET_DAILY_SUMMARY",
  GET_REMOTE_TASK_FEED: "GET_REMOTE_TASK_FEED",
  TASK_FEED_RESPONSE: "TASK_FEED_RESPONSE",
  OPEN_BRIEFING_PAGE: "OPEN_BRIEFING_PAGE",
  RESUME_TASK: "RESUME_TASK",
  DELETE_TASK: "DELETE_TASK",
  RENAME_TASK: "RENAME_TASK",
  SET_TASK_DONE: "SET_TASK_DONE",
  SET_TASK_LIFECYCLE: "SET_TASK_LIFECYCLE",
  SNOOZE_TASK: "SNOOZE_TASK",
  REMIND_TASK_AT: "REMIND_TASK_AT",
  REMIND_TASK_FRIDAY: "REMIND_TASK_FRIDAY",
  MERGE_TASKS: "MERGE_TASKS",
  KEEP_TASKS_SEPARATE: "KEEP_TASKS_SEPARATE",
  UNMERGE_TASKS: "UNMERGE_TASKS",
  SET_TRACKING_PAUSED: "SET_TRACKING_PAUSED",
  SET_RETENTION_DAYS: "SET_RETENTION_DAYS",
  SET_NUDGE_SETTINGS: "SET_NUDGE_SETTINGS",
  SET_SYNC_SETTINGS: "SET_SYNC_SETTINGS",
  REGISTER_SYNC_DEVICE: "REGISTER_SYNC_DEVICE",
  RUN_SYNC_NOW: "RUN_SYNC_NOW",
  GET_SETTINGS: "GET_SETTINGS",
  CLEAR_ALL_DATA: "CLEAR_ALL_DATA"
};

export const STORAGE_KEYS = {
  TRACKING_PAUSED: "trackingPaused",
  RETENTION_DAYS: "retentionDays",
  TASK_OVERRIDES: "taskOverrides",
  NUDGE_SETTINGS: "nudgeSettings",
  NUDGE_STATE: "nudgeState",
  TASK_RELATIONS: "taskRelations",
  SYNC_SETTINGS: "syncSettings",
  LAST_TASK_SNAPSHOT_TS: "lastTaskSnapshotTs"
};

export const DEFAULTS = {
  trackingPaused: false,
  retentionDays: 30,
  feedLimit: 50,
  nudgeSettings: {
    enabled: true,
    quietHoursStart: 22,
    quietHoursEnd: 8,
    dailyCap: 3,
    minInactiveHours: 18,
    maxInactiveDays: 7
  },
  syncSettings: {
    enabled: false,
    backendUrl: "http://127.0.0.1:8787",
    apiToken: "",
    deviceId: "",
    deviceLabel: "Context Restore Chrome",
    iosReminderEnabled: false,
    iosReminderHour: 20,
    iosReminderMinute: 0,
    lastUploadTs: 0,
    lastPullAt: "",
    lastSuccessTs: 0,
    lastError: ""
  }
};
