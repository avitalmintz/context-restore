import { query, withTransaction } from "./db.js";

const VALID_ACTION_TYPES = new Set([
  "rename",
  "set_done",
  "set_active",
  "delete_task_context",
  "add_note"
]);

function normalizeTaskStatus(status) {
  const candidate = String(status || "active").toLowerCase();
  if (["active", "done", "paused", "stale"].includes(candidate)) {
    return candidate;
  }
  return "active";
}

function toNum(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export async function ensureUser({ userId, email }) {
  const sql = `
    INSERT INTO users (id, email)
    VALUES ($1::uuid, $2::text)
    ON CONFLICT (id)
    DO UPDATE SET email = EXCLUDED.email
    RETURNING id, email
  `;

  const { rows } = await query(sql, [userId, email]);
  return rows[0];
}

export async function registerDevice({ userId, platform, deviceLabel }) {
  const sql = `
    INSERT INTO devices (user_id, platform, device_label, last_seen_at)
    VALUES ($1::uuid, $2::text, $3::text, now())
    ON CONFLICT (user_id, platform, device_label)
    DO UPDATE SET last_seen_at = now()
    RETURNING id, platform, device_label, last_seen_at
  `;

  const { rows } = await query(sql, [userId, platform, deviceLabel]);
  return rows[0];
}

async function upsertTaskSnapshotTx(client, userId, task, snapshotTs, schemaVersion) {
  const taskId = String(task.taskId || "").trim();
  if (!taskId) {
    return { accepted: false, reason: "missing_task_id" };
  }

  const status = normalizeTaskStatus(task.status);
  const lastActivityTs = toNum(task.lastActivityTs, snapshotTs);

  const upsertSql = `
    INSERT INTO task_snapshots (
      user_id,
      task_id,
      title,
      category,
      topic,
      confidence,
      status,
      domain,
      domains_json,
      briefing,
      next_action,
      stats_json,
      open_loop_score,
      nudge_phase,
      last_activity_ts,
      snapshot_ts,
      source_version,
      updated_at
    ) VALUES (
      $1::uuid,
      $2::text,
      $3::text,
      $4::text,
      $5::text,
      $6::double precision,
      $7::text,
      $8::text,
      $9::jsonb,
      $10::text,
      $11::text,
      $12::jsonb,
      $13::double precision,
      $14::text,
      $15::bigint,
      $16::bigint,
      $17::bigint,
      now()
    )
    ON CONFLICT (user_id, task_id)
    DO UPDATE SET
      title = EXCLUDED.title,
      category = EXCLUDED.category,
      topic = EXCLUDED.topic,
      confidence = EXCLUDED.confidence,
      status = EXCLUDED.status,
      domain = EXCLUDED.domain,
      domains_json = EXCLUDED.domains_json,
      briefing = EXCLUDED.briefing,
      next_action = EXCLUDED.next_action,
      stats_json = EXCLUDED.stats_json,
      open_loop_score = EXCLUDED.open_loop_score,
      nudge_phase = EXCLUDED.nudge_phase,
      last_activity_ts = EXCLUDED.last_activity_ts,
      snapshot_ts = EXCLUDED.snapshot_ts,
      source_version = EXCLUDED.source_version,
      updated_at = now()
    WHERE task_snapshots.snapshot_ts <= EXCLUDED.snapshot_ts
    RETURNING task_id
  `;

  const upsertParams = [
    userId,
    taskId,
    String(task.title || "Untitled task"),
    String(task.category || "other"),
    String(task.topic || ""),
    toNum(task.confidence, 0),
    status,
    String(task.domain || "unknown"),
    JSON.stringify(Array.isArray(task.domains) ? task.domains : []),
    String(task.briefing || ""),
    String(task.nextAction || ""),
    JSON.stringify(task.stats || {}),
    task.openLoopScore === undefined ? null : toNum(task.openLoopScore, null),
    task.nudgePhase ? String(task.nudgePhase) : null,
    lastActivityTs,
    toNum(snapshotTs, Date.now()),
    toNum(schemaVersion || task.schemaVersion, 1)
  ];

  const upsert = await client.query(upsertSql, upsertParams);
  if (!upsert.rowCount) {
    return { accepted: false, reason: "stale_snapshot" };
  }

  await client.query(
    `DELETE FROM task_page_snapshots WHERE user_id = $1::uuid AND task_id = $2::text`,
    [userId, taskId]
  );

  const pages = Array.isArray(task.pages) ? task.pages : [];
  const insertPageSql = `
    INSERT INTO task_page_snapshots (
      user_id,
      task_id,
      url,
      domain,
      title,
      state,
      interest_score,
      completion_score,
      max_scroll_pct,
      active_ms,
      visit_count,
      revisit_count,
      last_ts
    ) VALUES (
      $1::uuid,
      $2::text,
      $3::text,
      $4::text,
      $5::text,
      $6::text,
      $7::double precision,
      $8::double precision,
      $9::double precision,
      $10::bigint,
      $11::integer,
      $12::integer,
      $13::bigint
    )
    ON CONFLICT (user_id, task_id, url)
    DO UPDATE SET
      domain = EXCLUDED.domain,
      title = EXCLUDED.title,
      state = EXCLUDED.state,
      interest_score = EXCLUDED.interest_score,
      completion_score = EXCLUDED.completion_score,
      max_scroll_pct = EXCLUDED.max_scroll_pct,
      active_ms = EXCLUDED.active_ms,
      visit_count = EXCLUDED.visit_count,
      revisit_count = EXCLUDED.revisit_count,
      last_ts = EXCLUDED.last_ts
  `;

  for (const page of pages) {
    const url = String(page.url || "").trim();
    if (!url) {
      continue;
    }

    await client.query(insertPageSql, [
      userId,
      taskId,
      url,
      String(page.domain || "unknown"),
      String(page.title || url),
      String(page.state || "skimmed"),
      toNum(page.interestScore, 0),
      toNum(page.completionScore, 0),
      toNum(page.maxScrollPct, 0),
      toNum(page.activeMs, 0),
      toNum(page.visitCount, 0),
      toNum(page.revisitCount, 0),
      toNum(page.lastTs, snapshotTs)
    ]);
  }

  return { accepted: true, reason: "ok" };
}

export async function upsertTaskBatch({ userId, tasks, snapshotTs, schemaVersion }) {
  return withTransaction(async (client) => {
    let accepted = 0;
    let rejected = 0;
    const reasons = {};

    for (const task of tasks) {
      const result = await upsertTaskSnapshotTx(client, userId, task, snapshotTs, schemaVersion);
      if (result.accepted) {
        accepted += 1;
      } else {
        rejected += 1;
        reasons[result.reason] = (reasons[result.reason] || 0) + 1;
      }
    }

    return { accepted, rejected, reasons };
  });
}

export async function updateSyncCheckpoint({ userId, deviceId, lastUploadTs, lastDownloadActionTs }) {
  const safeLastUploadTs =
    lastUploadTs === undefined || lastUploadTs === null ? 0 : toNum(lastUploadTs, 0);

  const sql = `
    INSERT INTO sync_checkpoints (
      user_id,
      device_id,
      last_upload_ts,
      last_download_action_ts,
      updated_at
    ) VALUES (
      $1::uuid,
      $2::uuid,
      $3::bigint,
      $4::timestamptz,
      now()
    )
    ON CONFLICT (user_id, device_id)
    DO UPDATE SET
      last_upload_ts = COALESCE(EXCLUDED.last_upload_ts, sync_checkpoints.last_upload_ts),
      last_download_action_ts = COALESCE(EXCLUDED.last_download_action_ts, sync_checkpoints.last_download_action_ts),
      updated_at = now()
  `;

  await query(sql, [
    userId,
    deviceId,
    safeLastUploadTs,
    lastDownloadActionTs || null
  ]);
}

export async function listTasks({ userId, includeDone = false, limit = 100, updatedAfterTs = null }) {
  const taskSql = `
    SELECT
      user_id,
      task_id,
      title,
      category,
      topic,
      confidence,
      status,
      domain,
      domains_json,
      briefing,
      next_action,
      stats_json,
      open_loop_score,
      nudge_phase,
      last_activity_ts,
      snapshot_ts,
      source_version
    FROM task_snapshots
    WHERE user_id = $1::uuid
      AND ($2::boolean = true OR status <> 'done')
      AND ($3::bigint IS NULL OR snapshot_ts > $3::bigint)
    ORDER BY last_activity_ts DESC
    LIMIT $4::integer
  `;

  const taskRows = (await query(taskSql, [userId, includeDone, updatedAfterTs, limit])).rows;
  if (!taskRows.length) {
    return [];
  }

  const taskIds = taskRows.map((row) => row.task_id);
  const pageSql = `
    SELECT
      task_id,
      url,
      domain,
      title,
      state,
      interest_score,
      completion_score,
      max_scroll_pct,
      active_ms,
      visit_count,
      revisit_count,
      last_ts
    FROM task_page_snapshots
    WHERE user_id = $1::uuid
      AND task_id = ANY($2::text[])
    ORDER BY task_id ASC, interest_score DESC, last_ts DESC
  `;

  const pageRows = (await query(pageSql, [userId, taskIds])).rows;
  const pagesByTask = new Map();

  for (const row of pageRows) {
    if (!pagesByTask.has(row.task_id)) {
      pagesByTask.set(row.task_id, []);
    }
    pagesByTask.get(row.task_id).push({
      url: row.url,
      domain: row.domain,
      title: row.title,
      state: row.state,
      interestScore: toNum(row.interest_score, 0),
      completionScore: toNum(row.completion_score, 0),
      maxScrollPct: toNum(row.max_scroll_pct, 0),
      activeMs: toNum(row.active_ms, 0),
      visitCount: toNum(row.visit_count, 0),
      revisitCount: toNum(row.revisit_count, 0),
      lastTs: toNum(row.last_ts, 0)
    });
  }

  return taskRows.map((row) => ({
    taskId: row.task_id,
    title: row.title,
    domain: row.domain,
    domains: Array.isArray(row.domains_json) ? row.domains_json : [],
    category: row.category,
    topic: row.topic,
    confidence: toNum(row.confidence, 0),
    status: row.status,
    lastActivityTs: toNum(row.last_activity_ts, 0),
    briefing: row.briefing,
    nextAction: row.next_action,
    stats: row.stats_json && typeof row.stats_json === "object" ? row.stats_json : {},
    pages: pagesByTask.get(row.task_id) || [],
    openLoopScore: row.open_loop_score === null ? null : toNum(row.open_loop_score, 0),
    nudgePhase: row.nudge_phase,
    snapshotTs: toNum(row.snapshot_ts, 0),
    schemaVersion: toNum(row.source_version, 1)
  }));
}

async function applyActionTx(client, { userId, taskId, actionType, payload }) {
  if (actionType === "rename") {
    const title = String(payload?.title || "").trim();
    if (title) {
      await client.query(
        `UPDATE task_snapshots SET title = $3::text, updated_at = now() WHERE user_id = $1::uuid AND task_id = $2::text`,
        [userId, taskId, title.slice(0, 160)]
      );
    }
    return;
  }

  if (actionType === "set_done") {
    const done = Boolean(payload?.done);
    await client.query(
      `UPDATE task_snapshots SET status = $3::text, updated_at = now() WHERE user_id = $1::uuid AND task_id = $2::text`,
      [userId, taskId, done ? "done" : "active"]
    );
    return;
  }

  if (actionType === "set_active") {
    await client.query(
      `UPDATE task_snapshots SET status = 'active', updated_at = now() WHERE user_id = $1::uuid AND task_id = $2::text`,
      [userId, taskId]
    );
    return;
  }

  if (actionType === "delete_task_context") {
    await client.query(
      `DELETE FROM task_snapshots WHERE user_id = $1::uuid AND task_id = $2::text`,
      [userId, taskId]
    );
    return;
  }
}

export async function createTaskAction({ userId, taskId, actionType, payload, sourceDeviceId = null }) {
  if (!VALID_ACTION_TYPES.has(actionType)) {
    throw new Error(`Unsupported action type: ${actionType}`);
  }

  return withTransaction(async (client) => {
    const insertSql = `
      INSERT INTO task_actions (
        user_id,
        task_id,
        action_type,
        payload_json,
        source_device_id,
        created_at
      ) VALUES (
        $1::uuid,
        $2::text,
        $3::text,
        $4::jsonb,
        $5::uuid,
        now()
      )
      RETURNING id, created_at
    `;

    const inserted = await client.query(insertSql, [
      userId,
      taskId,
      actionType,
      JSON.stringify(payload || {}),
      sourceDeviceId
    ]);

    const action = inserted.rows[0];

    await applyActionTx(client, { userId, taskId, actionType, payload });

    await client.query(
      `UPDATE task_actions SET applied_at = now() WHERE id = $1::uuid`,
      [action.id]
    );

    return {
      actionId: action.id,
      createdAt: action.created_at
    };
  });
}

export async function listPendingActions({ userId, deviceId, since }) {
  const sql = `
    SELECT
      a.id,
      a.task_id,
      a.action_type,
      a.payload_json,
      a.source_device_id,
      a.created_at,
      a.applied_at
    FROM task_actions a
    LEFT JOIN action_receipts r
      ON r.user_id = a.user_id
      AND r.action_id = a.id
      AND r.device_id = $2::uuid
    WHERE a.user_id = $1::uuid
      AND ($3::timestamptz IS NULL OR a.created_at > $3::timestamptz)
      AND (a.source_device_id IS NULL OR a.source_device_id <> $2::uuid)
      AND r.action_id IS NULL
    ORDER BY a.created_at ASC
    LIMIT 1000
  `;

  const rows = (await query(sql, [userId, deviceId, since || null])).rows;

  return rows.map((row) => ({
    id: row.id,
    taskId: row.task_id,
    actionType: row.action_type,
    payload: row.payload_json,
    sourceDeviceId: row.source_device_id,
    createdAt: row.created_at,
    appliedAt: row.applied_at
  }));
}

export async function ackActions({ userId, deviceId, actionIds }) {
  if (!Array.isArray(actionIds) || actionIds.length === 0) {
    return 0;
  }

  const sql = `
    INSERT INTO action_receipts (user_id, action_id, device_id, acked_at)
    SELECT
      $1::uuid,
      x.action_id::uuid,
      $2::uuid,
      now()
    FROM unnest($3::text[]) AS x(action_id)
    ON CONFLICT (user_id, action_id, device_id)
    DO NOTHING
  `;

  const result = await query(sql, [userId, deviceId, actionIds]);
  return result.rowCount || 0;
}

export async function resetUserContextData({ userId }) {
  return withTransaction(async (client) => {
    const deletedPages = await client.query(
      `DELETE FROM task_page_snapshots WHERE user_id = $1::uuid`,
      [userId]
    );
    const deletedTasks = await client.query(
      `DELETE FROM task_snapshots WHERE user_id = $1::uuid`,
      [userId]
    );
    const deletedReceipts = await client.query(
      `DELETE FROM action_receipts WHERE user_id = $1::uuid`,
      [userId]
    );
    const deletedActions = await client.query(
      `DELETE FROM task_actions WHERE user_id = $1::uuid`,
      [userId]
    );
    const deletedCheckpoints = await client.query(
      `DELETE FROM sync_checkpoints WHERE user_id = $1::uuid`,
      [userId]
    );

    return {
      deletedPages: deletedPages.rowCount || 0,
      deletedTasks: deletedTasks.rowCount || 0,
      deletedActions: deletedActions.rowCount || 0,
      deletedReceipts: deletedReceipts.rowCount || 0,
      deletedCheckpoints: deletedCheckpoints.rowCount || 0
    };
  });
}
