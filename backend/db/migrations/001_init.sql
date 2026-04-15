CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('chrome_extension', 'ios')),
  device_label text NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, device_label)
);

CREATE TABLE IF NOT EXISTS task_snapshots (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id text NOT NULL,
  title text NOT NULL,
  category text NOT NULL,
  topic text NOT NULL DEFAULT '',
  confidence double precision NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('active', 'done', 'paused', 'stale')),
  domain text NOT NULL,
  domains_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  briefing text NOT NULL DEFAULT '',
  next_action text NOT NULL DEFAULT '',
  stats_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  open_loop_score double precision,
  nudge_phase text,
  last_activity_ts bigint NOT NULL,
  snapshot_ts bigint NOT NULL,
  source_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_task_snapshots_user_status ON task_snapshots(user_id, status);
CREATE INDEX IF NOT EXISTS idx_task_snapshots_user_last_activity ON task_snapshots(user_id, last_activity_ts DESC);
CREATE INDEX IF NOT EXISTS idx_task_snapshots_user_snapshot_ts ON task_snapshots(user_id, snapshot_ts DESC);

CREATE TABLE IF NOT EXISTS task_page_snapshots (
  user_id uuid NOT NULL,
  task_id text NOT NULL,
  url text NOT NULL,
  domain text NOT NULL,
  title text NOT NULL,
  state text NOT NULL CHECK (state IN ('read', 'skimmed', 'unopened', 'bounced')),
  interest_score double precision NOT NULL DEFAULT 0,
  completion_score double precision NOT NULL DEFAULT 0,
  max_scroll_pct double precision NOT NULL DEFAULT 0,
  active_ms bigint NOT NULL DEFAULT 0,
  visit_count integer NOT NULL DEFAULT 0,
  revisit_count integer NOT NULL DEFAULT 0,
  last_ts bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, task_id, url),
  FOREIGN KEY (user_id, task_id)
    REFERENCES task_snapshots(user_id, task_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_pages_user_task ON task_page_snapshots(user_id, task_id);

CREATE TABLE IF NOT EXISTS task_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id text NOT NULL,
  action_type text NOT NULL CHECK (action_type IN ('rename', 'set_done', 'set_active', 'delete_task_context', 'add_note')),
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_task_actions_user_created ON task_actions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS action_receipts (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_id uuid NOT NULL REFERENCES task_actions(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  acked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, action_id, device_id)
);

CREATE TABLE IF NOT EXISTS sync_checkpoints (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  last_upload_ts bigint NOT NULL DEFAULT 0,
  last_download_action_ts timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device_id)
);

CREATE TABLE IF NOT EXISTS nudge_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id text NOT NULL,
  phase text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_nudge_logs_user_sent ON nudge_logs(user_id, sent_at DESC);
