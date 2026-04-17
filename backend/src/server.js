import express from "express";
import { authMiddleware } from "./lib/auth.js";
import { closePool } from "./lib/db.js";
import {
  ackActions,
  createTaskAction,
  listPendingActions,
  listTasks,
  registerDevice,
  resetUserContextData,
  updateSyncCheckpoint,
  upsertTaskBatch
} from "./lib/repository.js";
import { config } from "./lib/config.js";

const app = express();
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});
app.use(express.json({ limit: "2mb" }));

const VALID_PLATFORMS = new Set(["chrome_extension", "ios"]);
const VALID_ACTIONS = new Set([
  "rename",
  "set_done",
  "set_active",
  "delete_task_context",
  "add_note"
]);

function toNum(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toBool(value, fallback = false) {
  if (value === true || value === "true" || value === 1 || value === "1") {
    return true;
  }
  if (value === false || value === "false" || value === 0 || value === "0") {
    return false;
  }
  return fallback;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "context-restore-backend", now: Date.now() });
});

app.use("/v1", authMiddleware);

app.post("/v1/devices/register", async (req, res, next) => {
  try {
    const { platform, deviceLabel } = req.body || {};

    if (!VALID_PLATFORMS.has(String(platform || ""))) {
      res.status(400).json({ ok: false, error: "Invalid platform" });
      return;
    }

    const label = String(deviceLabel || "").trim().slice(0, 120);
    if (!label) {
      res.status(400).json({ ok: false, error: "deviceLabel is required" });
      return;
    }

    const device = await registerDevice({
      userId: req.auth.userId,
      platform,
      deviceLabel: label
    });

    res.json({
      ok: true,
      deviceId: device.id,
      serverTime: Date.now()
    });
  } catch (error) {
    next(error);
  }
});

app.post("/v1/sync/upload", async (req, res, next) => {
  try {
    const { deviceId, snapshotTs, schemaVersion, tasks, replaceMissing } = req.body || {};

    if (!deviceId) {
      res.status(400).json({ ok: false, error: "deviceId is required" });
      return;
    }

    if (!Array.isArray(tasks)) {
      res.status(400).json({ ok: false, error: "tasks must be an array" });
      return;
    }

    if (tasks.length > 2000) {
      res.status(400).json({ ok: false, error: "Batch too large" });
      return;
    }

    const result = await upsertTaskBatch({
      userId: req.auth.userId,
      tasks,
      snapshotTs: toNum(snapshotTs, Date.now()),
      schemaVersion: toNum(schemaVersion, 1),
      replaceMissing: Boolean(replaceMissing)
    });

    await updateSyncCheckpoint({
      userId: req.auth.userId,
      deviceId,
      lastUploadTs: toNum(snapshotTs, Date.now())
    });

    res.json({
      ok: true,
      acceptedTasks: result.accepted,
      rejectedTasks: result.rejected,
      rejectedReasons: result.reasons
    });
  } catch (error) {
    next(error);
  }
});

app.get("/v1/tasks", async (req, res, next) => {
  try {
    const includeDone = toBool(req.query.includeDone, false);
    const limit = Math.min(500, Math.max(1, toNum(req.query.limit, 100)));
    const updatedAfterTs = req.query.updatedAfterTs ? toNum(req.query.updatedAfterTs, null) : null;

    const tasks = await listTasks({
      userId: req.auth.userId,
      includeDone,
      limit,
      updatedAfterTs
    });

    res.json({
      ok: true,
      tasks,
      serverTs: Date.now()
    });
  } catch (error) {
    next(error);
  }
});

app.post("/v1/tasks/:taskId/actions", async (req, res, next) => {
  try {
    const taskId = String(req.params.taskId || "").trim();
    const { actionType, payload, deviceId } = req.body || {};

    if (!taskId) {
      res.status(400).json({ ok: false, error: "taskId is required" });
      return;
    }

    if (!VALID_ACTIONS.has(String(actionType || ""))) {
      res.status(400).json({ ok: false, error: "Invalid actionType" });
      return;
    }

    const result = await createTaskAction({
      userId: req.auth.userId,
      taskId,
      actionType,
      payload: payload && typeof payload === "object" ? payload : {},
      sourceDeviceId: deviceId || null
    });

    res.json({
      ok: true,
      actionId: result.actionId,
      createdAt: result.createdAt
    });
  } catch (error) {
    next(error);
  }
});

app.get("/v1/sync/actions", async (req, res, next) => {
  try {
    const deviceId = String(req.query.deviceId || "").trim();
    const since = req.query.since ? String(req.query.since) : null;

    if (!deviceId) {
      res.status(400).json({ ok: false, error: "deviceId is required" });
      return;
    }

    const actions = await listPendingActions({
      userId: req.auth.userId,
      deviceId,
      since
    });

    await updateSyncCheckpoint({
      userId: req.auth.userId,
      deviceId,
      lastUploadTs: 0,
      lastDownloadActionTs: new Date().toISOString()
    });

    res.json({ ok: true, actions });
  } catch (error) {
    next(error);
  }
});

app.post("/v1/sync/actions/ack", async (req, res, next) => {
  try {
    const { deviceId, actionIds } = req.body || {};

    if (!deviceId) {
      res.status(400).json({ ok: false, error: "deviceId is required" });
      return;
    }

    const acked = await ackActions({
      userId: req.auth.userId,
      deviceId: String(deviceId),
      actionIds: Array.isArray(actionIds) ? actionIds.map(String) : []
    });

    res.json({ ok: true, acked });
  } catch (error) {
    next(error);
  }
});

app.post("/v1/data/reset", async (req, res, next) => {
  try {
    const summary = await resetUserContextData({
      userId: req.auth.userId
    });

    res.json({
      ok: true,
      summary
    });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const message = error?.message || "Unknown error";
  console.error(error);
  res.status(500).json({ ok: false, error: message });
});

const server = app.listen(config.port, () => {
  console.log(`Context Restore backend listening on :${config.port}`);
});

async function shutdown(signal) {
  console.log(`Received ${signal}. Shutting down...`);
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
