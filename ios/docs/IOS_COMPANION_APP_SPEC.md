# Context Restore iOS Companion - Technical Specification (v1.0)

## 1. Document Metadata
- Product: Context Restore iOS Companion
- Date: April 13, 2026
- Owner: Personal prototype (single user)
- Status: Build-ready implementation spec
- Related docs:
  - `/Users/avitalmintz/Desktop/new project/extension/TECH_SPEC.md`
  - `/Users/avitalmintz/Desktop/new project/extension/docs/SPRINT_03.md`

## 2. Goal
Connect existing Chrome extension data to an iPhone app so you can:
- See daily context briefings from desktop browsing
- Resume/close tasks from phone
- Review AI-style detailed briefs and gap analysis
- Control retention and deletion from mobile

This spec keeps current extension behavior intact and adds sync + mobile surfaces.

## 3. Scope

### 3.1 In scope (v1)
- One-way automatic data sync from extension to backend
- Two-way task state controls (done/reopen, rename, delete context)
- iOS read/write views for tasks, detailed briefs, and gap analysis
- Personal-only auth model (single account)
- Deletion and retention controls that apply across extension + app

### 3.2 Out of scope (v1)
- Running Chrome extension logic on iOS Chrome
- Capturing browsing events from mobile Chrome
- Multi-user org features, sharing, collaboration
- Full raw-page-content scraping/archiving

## 4. Product Constraints and Assumptions
- Single user only.
- Existing extension inference remains local and primary.
- Synced payloads use inferred task/page metrics, not full webpage HTML.
- iOS app is companion UI, not task inference engine.
- If sync is offline, extension continues local-first and retries later.

## 5. System Architecture

## 5.1 Components
1. Chrome Extension (existing + sync adapter)
- Existing ingestion and task inference unchanged.
- New sync adapter serializes task feed snapshots and uploads deltas.

2. Sync API Service
- Auth, ingestion, idempotency, conflict resolution, task-action writes.

3. Cloud Database (Postgres)
- Stores normalized task/page snapshots, action log, and device sync state.

4. iOS App (SwiftUI)
- Reads synced task feed.
- Executes task actions.
- Displays AI Briefing, Detailed Briefs, Gap Analysis tabs.

5. Notification Worker (optional in v1.1)
- Push open-loop reminders to iOS when enabled.

## 5.2 High-level Data Flow
1. Extension computes task feed (already implemented locally).
2. Sync adapter sends changed task snapshots to API.
3. API upserts task/page records and records sync watermark.
4. iOS app fetches tasks and renders mobile tabs.
5. User action in iOS (mark done, rename, delete) writes to API.
6. Extension pulls remote actions and applies local overrides/deletions.

## 6. Identity and Pairing (Single-user Mode)

## 6.1 Auth model
- Use one personal account via email magic link (Supabase Auth recommended).
- Extension stores session token in `chrome.storage.local`.
- iOS stores session in Keychain.

## 6.2 First-run pairing
1. Sign in on iOS app.
2. Open extension Settings > Sync.
3. Sign in with same email link flow.
4. Verify account ID match.
5. Start initial backfill sync.

No multi-user organization concept in v1.

## 7. Data Contracts

## 7.1 Synced task object (from extension)
```json
{
  "taskId": "task-h4k9m3",
  "title": "Compare jacket usd options",
  "domain": "revolve.com",
  "domains": ["revolve.com", "princesspolly.com"],
  "category": "shopping",
  "topic": "jacket usd",
  "confidence": 0.93,
  "status": "active",
  "lastActivityTs": 1776138051000,
  "briefing": "You were comparing ...",
  "nextAction": "Double-check reviews and return policy before deciding.",
  "stats": {
    "pageCount": 7,
    "eventCount": 142,
    "activeMs": 481000,
    "revisitCount": 9,
    "deepScrollCount": 6,
    "readCount": 1,
    "skimmedCount": 3,
    "bouncedCount": 2,
    "unopenedCount": 1
  },
  "pages": [
    {
      "url": "https://...",
      "domain": "revolve.com",
      "title": "Rag & Bone Lara Corduroy Jacket ...",
      "state": "skimmed",
      "interestScore": 78.2,
      "completionScore": 42.1,
      "maxScrollPct": 61.0,
      "activeMs": 89000,
      "visitCount": 2,
      "revisitCount": 1,
      "lastTs": 1776138051000
    }
  ],
  "openLoopScore": 0.74,
  "nudgePhase": "day1",
  "snapshotTs": 1776138072000,
  "schemaVersion": 1
}
```

## 7.2 Server-side canonical entities
- `task_snapshot`: one current row per task.
- `task_page_snapshot`: one current row per task/page.
- `task_action`: user-originated mutations (done/rename/delete/note).
- `sync_checkpoint`: per-device upload/download watermarks.
- `nudge_log`: push and in-app reminder history.

## 8. Database Schema (Postgres)

## 8.1 Tables
1. `users`
- `id` UUID PK
- `email` text unique
- `created_at` timestamptz

2. `devices`
- `id` UUID PK
- `user_id` UUID FK
- `platform` enum(`chrome_extension`, `ios`)
- `device_label` text
- `last_seen_at` timestamptz
- `created_at` timestamptz

3. `task_snapshots`
- `user_id` UUID
- `task_id` text
- `title` text
- `category` text
- `topic` text
- `confidence` double precision
- `status` text
- `domain` text
- `domains_json` jsonb
- `briefing` text
- `next_action` text
- `stats_json` jsonb
- `open_loop_score` double precision
- `nudge_phase` text null
- `last_activity_ts` bigint
- `snapshot_ts` bigint
- `source_version` bigint default 1
- PK (`user_id`, `task_id`)
- Indexes: (`user_id`, `status`), (`user_id`, `last_activity_ts desc`)

4. `task_page_snapshots`
- `user_id` UUID
- `task_id` text
- `url` text
- `domain` text
- `title` text
- `state` text
- `interest_score` double precision
- `completion_score` double precision
- `max_scroll_pct` double precision
- `active_ms` bigint
- `visit_count` int
- `revisit_count` int
- `last_ts` bigint
- PK (`user_id`, `task_id`, `url`)
- Index: (`user_id`, `task_id`)

5. `task_actions`
- `id` UUID PK
- `user_id` UUID
- `task_id` text
- `action_type` enum(`rename`, `set_done`, `set_active`, `delete_task_context`, `add_note`)
- `payload_json` jsonb
- `source_device_id` UUID
- `created_at` timestamptz
- `applied_at` timestamptz null
- Index: (`user_id`, `created_at desc`)

6. `sync_checkpoints`
- `user_id` UUID
- `device_id` UUID
- `last_upload_ts` bigint
- `last_download_action_ts` timestamptz
- PK (`user_id`, `device_id`)

7. `task_notes` (optional v1.1)
- `id` UUID PK
- `user_id` UUID
- `task_id` text
- `body` text
- `created_at` timestamptz

## 9. API Specification

Base path: `/v1`
Auth: `Authorization: Bearer <JWT>`
Content-Type: `application/json`

## 9.1 Device registration
`POST /devices/register`
- Request:
```json
{
  "platform": "chrome_extension",
  "deviceLabel": "Avital Mac Chrome"
}
```
- Response:
```json
{
  "deviceId": "uuid",
  "serverTime": 1776138200000
}
```

## 9.2 Upload task snapshot batch
`POST /sync/upload`
- Request:
```json
{
  "deviceId": "uuid",
  "snapshotTs": 1776138200000,
  "schemaVersion": 1,
  "tasks": [/* synced task objects */]
}
```
- Behavior:
- Upsert `task_snapshots`.
- Replace each task’s `task_page_snapshots` with payload set (transactional per task).
- Ignore stale snapshots where `snapshotTs < existing.snapshot_ts`.

- Response:
```json
{
  "ok": true,
  "acceptedTasks": 12,
  "rejectedTasks": 0
}
```

## 9.3 Fetch task feed (iOS and extension)
`GET /tasks?includeDone=false&limit=100&updatedAfterTs=1776000000000`
- Response:
```json
{
  "tasks": [/* canonical task list */],
  "serverTs": 1776138300000
}
```

## 9.4 Submit task action
`POST /tasks/{taskId}/actions`
- Request examples:
```json
{ "actionType": "set_done", "payload": { "done": true } }
```
```json
{ "actionType": "rename", "payload": { "title": "Compare black jackets under $180" } }
```
```json
{ "actionType": "delete_task_context", "payload": {} }
```
- Response:
```json
{ "ok": true, "actionId": "uuid" }
```

## 9.5 Pull pending actions (extension)
`GET /sync/actions?deviceId=uuid&since=2026-04-13T20:00:00Z`
- Returns actions not created by same device and not yet acknowledged.

## 9.6 Ack actions (extension/iOS)
`POST /sync/actions/ack`
- Request:
```json
{
  "deviceId": "uuid",
  "actionIds": ["uuid1", "uuid2"]
}
```

## 10. Sync Protocol

## 10.1 Extension upload schedule
- Trigger upload when:
  - user opens briefing page
  - hourly alarm tick (can reuse nudge evaluation alarm cadence)
  - user presses "Refresh" (debounced)
- Minimum upload interval: 60 seconds.
- If payload hash unchanged since last upload, skip.

## 10.2 Initial backfill
- On first connect, upload current feed (up to 200 tasks, include done=false by default).
- Optional setting "include completed in mobile sync" off by default.

## 10.3 Conflict resolution
- Task snapshot fields are source-of-truth from extension inference.
- User actions override snapshot fields:
  - `rename` overrides `title`
  - `set_done` overrides `status`
  - `delete_task_context` hard-deletes task + pages + related actions/notes
- If extension later emits deleted task again from new browsing events, it appears as a new lifecycle occurrence (same or new `task_id` depending on URL cluster).

## 10.4 Offline handling
- Extension and iOS both maintain local outgoing action queue.
- Retry with exponential backoff (2s, 5s, 15s, 60s, 5m).
- Idempotency key format: `<deviceId>:<epochMs>:<random4>`.

## 11. iOS App Functional Specification

## 11.1 Navigation
Tab bar with 4 tabs:
1. `Overview`
2. `AI Briefing`
3. `Detailed Briefs`
4. `Gap Analysis`

## 11.2 Overview Tab
- Mirrors extension overview cards:
  - title, confidence, status, last activity
  - read/skimmed/unopened/closed quickly counts
  - actions: Mark Done/Reopen, Rename, Delete Task Context
- Pull to refresh.

## 11.3 AI Briefing Tab
- Narrative per task:
  - inferred intent
  - strongest-interest page
  - likely missed step (top gap)
- Uses server-side derived text from synced metrics (same heuristics as extension v1).

## 11.4 Detailed Briefs Tab
- Per-task expanded panel:
  - key findings lines
  - page-level diagnostics (state, interest, completion, detected signals)
  - recommended next checks

## 11.5 Gap Analysis Tab
- Global list of gap items:
  - shopping (reviews/returns/source diversity)
  - research (source diversity/depth)
  - travel (flights vs stays completeness)
  - generic unfinished pages

## 11.6 Task Detail Screen
- Full page list (sorted by interest then recency)
- Quick actions:
  - mark done/reopen
  - rename
  - delete context
  - add note (v1.1)

## 11.7 Settings Screen
- Sync status and last sync time
- Retention days (7/14/30/60/90)
- Include completed tasks toggle
- Reminder preferences (enable, quiet hours)
- Clear all synced cloud data

## 12. AI / Heuristic Logic for Mobile Views

v1 uses deterministic heuristics from metrics and metadata:
- No full page content ingestion.
- No screenshot OCR.
- No keystroke or form capture.

Derived outputs:
- `ai_brief_text`
- `detailed_findings[]`
- `gap_items[]`

Server can compute these at read time or materialize them into `task_snapshots.ai_json`.

## 13. Privacy, Retention, Deletion

## 13.1 Data minimization
- Store URL/title/domain + engagement metrics only.
- Never store typed text, passwords, form inputs, or full page HTML.

## 13.2 Retention policy
- Default: 30 days.
- Configurable: 7 to 90 days.
- Nightly backend cleanup job removes expired task/page snapshots and action logs beyond retention.

## 13.3 Deletion controls
- Delete task context:
  - removes task snapshot, page snapshots, notes, pending nudges for task.
- Clear all data:
  - deletes all rows for user across task tables and checkpoints.

## 14. Security Requirements
- TLS for all network requests.
- JWT auth for API calls.
- Row-level security by `user_id`.
- iOS tokens in Keychain.
- Extension tokens in `chrome.storage.local` with explicit sign-out.
- API rate limits per device and IP.

## 15. Observability and Reliability
- Structured logs with request ID, user ID hash, device ID, endpoint, latency.
- Metrics:
  - upload success rate
  - median sync latency
  - action propagation latency extension <-> iOS
  - stale task ratio
- Alerts:
  - sync error rate > 5% for 15 min
  - ingestion queue lag > 10 min

## 16. Implementation Plan (Build Order)

## Phase 1: Backend Foundation
1. Auth + `users/devices` tables
2. `/devices/register`
3. `/sync/upload`
4. `/tasks` read endpoint
5. Basic RLS and retention cron

## Phase 2: Extension Sync Adapter
1. Add sync settings section (connect/disconnect)
2. Upload task feed snapshots
3. Pull and apply remote task actions
4. Persist sync checkpoint in `chrome.storage.local`

## Phase 3: iOS App Core
1. Auth flow
2. Tabbed UI (Overview, AI Briefing, Detailed Briefs, Gap Analysis)
3. Task actions (rename/done/delete)
4. Settings and sync status

## Phase 4: Hardening
1. Retry/backoff queues
2. Conflict edge-case tests
3. Retention/deletion verification
4. Analytics and crash instrumentation

## 17. Acceptance Criteria
- AC-1: New extension task appears in iOS within 60 seconds after sync trigger.
- AC-2: Marking task done on iOS updates extension state within 60 seconds.
- AC-3: Deleting task context on either side removes it on both sides.
- AC-4: AI Briefing, Detailed Briefs, Gap Analysis render without breaking existing Overview.
- AC-5: Retention cleanup removes expired data from server and app views.
- AC-6: If network is unavailable, changes queue and sync when online.

## 18. Testing Strategy
- Unit tests:
  - sync payload validation
  - conflict resolution precedence
  - gap detection rules
- Integration tests:
  - extension upload -> API -> iOS read
  - iOS action -> API -> extension apply
  - delete/retention propagation
- Manual QA scenarios:
  - shopping comparison flow
  - mixed-task switching flow
  - offline/online recovery

## 19. Future Extensions (Post-v1)
- True LLM page-content summarization (opt-in)
- Push nudges from backend to iOS
- Safari extension companion for mobile browsing capture
- Multi-user architecture and account sharing
