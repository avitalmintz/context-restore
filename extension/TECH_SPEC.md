# Context Restore - Detailed Technical Specification (v0.1)

## 1. Document Metadata
- Product name: Context Restore
- Platform: Chrome Extension (Manifest V3)
- Date: April 13, 2026
- Authoring intent: MVP-ready build specification
- Target release: Personal prototype (single-user)

### 1.1 Prototype mode
- This spec is optimized for a single-user build (you as the only user).
- Multi-user onboarding, trust UX, and app-store distribution hardening are deferred until public launch planning.

## 2. Problem Statement
Users can restore closed tabs, but they cannot restore the mental context behind those tabs. Existing browser features store links, not intent, progress, or unfinished decisions.

## 3. Product Goal
Turn browsing behavior into structured, resumable task context.

### 3.1 Primary user outcomes
- User can reopen work as tasks, not as a raw tab pile.
- User can immediately see what they already read, skimmed, or ignored.
- User receives reminders for unfinished high-interest tasks.

### 3.2 Non-goals (MVP)
- Perfect intent inference
- Guaranteed purchase detection
- Cross-device sync
- Team collaboration
- Multi-user account/system design

## 4. MVP Scope

### 4.1 In-scope
- Passive browsing signal collection
- Automatic tab clustering into tasks
- Per-task briefing generation
- Resume workflow with ordered tab list
- Reminder nudges for unfinished tasks
- Local-first data model with deletion controls

### 4.2 Out-of-scope
- Mobile browsers
- Safari/Firefox parity
- Real-time cloud model orchestration
- Financial transaction verification

## 5. Functional Requirements

### 5.1 Tracking and signal capture
- FR-1: Detect tab lifecycle events (`created`, `updated`, `activated`, `removed`).
- FR-2: Track visibility/focus windows to estimate active dwell time.
- FR-3: Capture engagement signals from page context: scroll depth, scroll velocity bands, idle intervals, and return visits.
- FR-4: Store canonical page metadata: URL, title, domain, timestamp.

### 5.2 Task inference
- FR-5: Group related pages into inferred tasks.
- FR-6: Assign task category labels with confidence (`shopping`, `news`, `research`, `travel`, `social`, `other`).
- FR-7: Score each page within task (`interest`, `completion`, `priority`).

### 5.3 Briefing and resume
- FR-8: Generate concise briefing text per task.
- FR-9: Display explicit progress states per page (`read`, `skimmed`, `unopened`, `bounced`).
- FR-10: Provide next-best-action suggestions.
- FR-11: Restore tabs in suggested order, not original chronological order.
- FR-11a: Allow manual task rename in task detail view.

### 5.4 Nudges
- FR-12: Detect open loops (high-interest but incomplete tasks).
- FR-13: Trigger reminders at configured intervals (default 24h and 72h).
- FR-14: Respect quiet hours and per-domain notification controls.

### 5.5 Privacy and user controls
- FR-15: Support pause/resume tracking.
- FR-16: Support domain blacklist and private-site exclusion.
- FR-17: Support hard delete for all collected data.
- FR-18: Support configurable retention window (default 30 days).

## 6. Non-Functional Requirements
- NFR-1: Background event handling must not materially degrade browsing performance.
- NFR-2: Extension UI must render task feed under 200 ms for up to 500 pages in retention window.
- NFR-3: Event loss rate under 1% in normal operation.
- NFR-4: All sensitive data stored locally by default.
- NFR-5: Architecture must tolerate MV3 service worker suspension/restart.

## 7. Chrome Platform and Permissions

### 7.1 Manifest version
- Manifest V3 only.

### 7.2 Required permissions (MVP)
- `tabs`: tab lifecycle and metadata access.
- `webNavigation`: richer navigation transitions.
- `storage`: settings and compact indexed state.
- `alarms`: scheduled reminder checks.
- `notifications`: user nudges.
- `idle` (optional but recommended): avoid false activity during user-away windows.

### 7.3 Host permissions
- Request `<all_urls>` at install time for complete behavior capture from day one.
- Incognito remains opt-in via Chrome extension settings.

### 7.4 Known platform constraints
- No injection on restricted pages (`chrome://`, Chrome Web Store pages, etc.).
- Service worker can suspend; pipeline must persist checkpoints.
- Some tabs may be discarded/frozen by Chrome, affecting dwell interpretation.

## 8. System Architecture

### 8.1 Components
1. Service worker (background)
- Owns event ingestion, sessionization, clustering, scoring, nudge scheduler.

2. Content script (page context)
- Emits engagement signals: scroll, visibility, coarse interaction pulses.

3. UI surfaces
- Extension popup: quick task snapshot.
- Dedicated tab page (`chrome-extension://.../briefing.html`): full task feed, resume workflow, controls.

4. Local data layer
- IndexedDB: high-volume event log and derived entities.
- `chrome.storage.local`: lightweight settings and feature flags.

5. Optional cloud summarizer (post-MVP)
- Receives minimized structured summaries only after explicit user opt-in.

### 8.2 Data flow
1. Browser event occurs.
2. Service worker receives and normalizes event.
3. Content script periodically emits page engagement snapshots.
4. Worker persists raw events.
5. Worker runs incremental aggregation and updates per-page signals.
6. Worker runs clustering and task-state updates.
7. UI fetches task entities and renders briefing cards.
8. Alarms trigger open-loop evaluation and notifications.

## 9. Data Model

### 9.1 Storage strategy
- Raw event retention: 30 days (configurable 7 to 90).
- Derived task entities recomputed incrementally.
- Nightly compaction job removes stale raw records and preserves aggregate counters.

### 9.2 Core entities

#### `Page`
- `page_id` (string, hash of canonical URL + first seen date bucket)
- `canonical_url` (string)
- `domain` (string)
- `title_latest` (string)
- `category_hint` (string enum)
- `first_seen_at` (epoch ms)
- `last_seen_at` (epoch ms)
- `visit_count` (int)

#### `PageEngagement`
- `page_id` (string)
- `total_active_ms` (int)
- `max_scroll_pct` (float 0-100)
- `median_scroll_velocity` (float)
- `focus_sessions` (int)
- `rapid_bounce_count` (int)
- `return_after_1h_count` (int)
- `return_after_24h_count` (int)
- `last_engaged_at` (epoch ms)

#### `Task`
- `task_id` (string UUID)
- `label` (string)
- `label_confidence` (float 0-1)
- `status` (`active`, `paused`, `done`, `stale`)
- `created_at` (epoch ms)
- `updated_at` (epoch ms)
- `last_user_seen_at` (epoch ms nullable)
- `open_loop_score` (float 0-1)

#### `TaskPage`
- `task_id` (string)
- `page_id` (string)
- `membership_score` (float 0-1)
- `interest_score` (float 0-100)
- `completion_score` (float 0-100)
- `state` (`read`, `skimmed`, `unopened`, `bounced`)
- `rank_in_task` (int)

#### `Nudge`
- `nudge_id` (string UUID)
- `task_id` (string)
- `scheduled_for` (epoch ms)
- `sent_at` (epoch ms nullable)
- `nudge_type` (`unfinished_task`, `likely_decision_pending`, `research_unfinished`)
- `outcome` (`clicked`, `dismissed`, `ignored`, `expired`)

### 9.3 Raw event schema
```json
{
  "event_id": "uuid",
  "event_type": "tab_activated | tab_closed | nav_committed | engagement_snapshot",
  "tab_id": 123,
  "window_id": 44,
  "url": "https://example.com/post",
  "title": "Example Post",
  "domain": "example.com",
  "ts": 1776111000000,
  "payload": {
    "scroll_pct": 62.3,
    "visible": true,
    "transition_type": "link"
  }
}
```

## 10. Inference Pipeline

### 10.1 Sessionization
Define a focus session when:
- Tab is active and document visible.
- No user idle signal over threshold (default 60s).
- Session ends on tab switch, tab close, navigation change, or idle timeout.

### 10.2 Canonicalization
- Normalize URL by stripping tracking params (`utm_*`, `fbclid`, etc.).
- Preserve meaningful query params for commerce/search contexts.
- Map URLs with same product/article identity to one canonical key using site-specific rules when available.

### 10.3 Feature extraction
Per page:
- temporal features: active ms, revisit latency, repeat count
- engagement features: max scroll, deep scroll duration, pause intervals
- source features: domain category and path keywords
- transition features: nav type and referrer proximity

### 10.4 Task clustering algorithm (MVP)
Use weighted graph clustering:
- Node: `Page`
- Edge between two pages if combined score >= `0.55`
- Edge score:
  - semantic title/path similarity: 0.35
  - same domain/subdomain pattern: 0.20
  - temporal adjacency within 45 minutes: 0.20
  - query token overlap: 0.15
  - revisit co-occurrence: 0.10

Connected components become candidate tasks, then post-process:
- Merge tiny components into nearest larger task if similarity >= 0.70.
- Split components if internal modularity indicates two distinct intents.

### 10.5 Task labeling
Rule-first labeler (MVP):
- shopping: multiple product pages + merchant domains + compare behavior
- research/news: multiple article-like pages with related topic tokens
- travel: maps/flights/hotels + destination token overlap
- fallback: `other`

### 10.6 Page state classification
- `bounced`: active < 20s and max scroll < 15%
- `unopened`: tab created but never active
- `skimmed`: active >= 20s and (scroll 15%-65% or fast velocity)
- `read`: active >= 90s and scroll >= 65% with stable pacing

### 10.7 Interest score formula
`interest = 0.40*normalized_active_time + 0.25*revisit_score + 0.20*deep_scroll_score + 0.15*interaction_pause_score`

### 10.8 Completion score formula
`completion = 0.45*scroll_completion + 0.25*read_pacing + 0.20*return_and_finish + 0.10*time_depth`

### 10.9 Shopping preference inference
Within `shopping` tasks:
- rank candidate products by `interest_score`
- apply confidence margin rule:
  - if top - second >= 12 points, output "leaning toward X"
  - otherwise output "no clear preference yet"

### 10.10 Open-loop detection
A task is an open loop when all are true:
- `open_loop_score >= 0.6`
- last activity between 18h and 7 days
- no explicit completion signal

Completion signals (heuristic):
- visited thank-you/order confirmation URL patterns
- manually marked complete by user
- no revisit and low residual priority after 7 days

## 11. Briefing Generation

### 11.1 MVP briefing engine
Template + rules engine (no LLM required):
- sentence 1: intent guess and scope
- sentence 2: strongest evidence of preference/progress
- sentence 3: explicit missing step

Example template output:
- "You were comparing 3 jackets across Reformation, Gap, and American Eagle."
- "Most attention went to the Reformation page with repeated revisits and deep image browsing."
- "You have not checked review sections on any of the products."

### 11.2 Optional LLM mode (post-MVP)
- Input only structured features and sanitized snippets.
- Never send full browsing history without explicit opt-in.
- Attach confidence and uncertainty language.

### 11.3 Confidence wording policy (MVP)
- Use assertive phrasing only when confidence >= 0.80.
- Use hedged phrasing for confidence < 0.80.
- Never present inferred intent as fact when confidence is below threshold.

## 12. UI/UX Specification

### 12.1 Surfaces
1. Popup (fast glance)
- top 3 active tasks
- one-tap resume

2. Full Briefing page
- default primary experience
- task cards sorted by priority
- each card shows:
  - task title and confidence
  - concise briefing
  - page checklist with states
  - suggested next action

3. Settings page
- pause tracking
- retention period
- domain blacklist
- notifications and quiet hours
- delete all data

### 12.2 Task card fields
- `Task title`
- `Why this matters now` line
- `What you already did`
- `What is unfinished`
- `Resume` CTA
- `Mark done` CTA

### 12.3 Resume mode behavior
- opens tabs in ranked order
- highlights first recommended page
- optional "focus mode" opens next page only after previous marked done

## 13. Message Contracts (Extension Internal)

### 13.1 Content script to worker
```json
{
  "type": "ENGAGEMENT_SNAPSHOT",
  "tabId": 123,
  "url": "https://example.com/article",
  "ts": 1776111000000,
  "metrics": {
    "scrollPct": 72.1,
    "visible": true,
    "activeMsSinceLast": 5000,
    "isIdle": false
  }
}
```

### 13.2 UI to worker
```json
{
  "type": "GET_TASK_FEED",
  "filters": {
    "status": ["active", "paused"],
    "limit": 50
  }
}
```

### 13.3 Worker to UI
```json
{
  "type": "TASK_FEED_RESPONSE",
  "tasks": [
    {
      "taskId": "uuid",
      "title": "Compare spring jackets",
      "confidence": 0.82,
      "briefing": "...",
      "nextAction": "Check reviews on top two options",
      "pages": []
    }
  ]
}
```

## 14. Privacy, Security, and Compliance
- Local-first storage by default.
- Explicit consent screen before tracking starts (kept for future public-readiness).
- Transparent disclosure of collected signals and purpose.
- No keystroke capture, no form-field capture, no page content scraping in MVP.
- Encryption at rest if cloud sync is later introduced.
- Chrome Web Store user-data and limited-use compliance is a future launch gate, not a current single-user blocker.

## 15. Performance and Reliability Design
- Event buffering with flush interval (2s or 20 events).
- Debounced scroll snapshots (every 2 to 5 seconds while active).
- Incremental recompute, not full re-cluster on every event.
- Fallback recovery on worker restart from IndexedDB checkpoints.

## 16. Failure Modes and Mitigations
- Missed events due to worker sleep:
  - mitigation: persist heartbeat snapshots from content script and reconcile gaps.

- False intent grouping:
  - mitigation: allow manual split/merge and thumbs feedback.

- Notification fatigue:
  - mitigation: cap 1 nudge per task per 24h and global daily cap.

- Sensitive domains:
  - mitigation: no default skip list in this prototype; user-managed blacklist only.

## 17. Implementation Plan

### Phase 1: Instrumentation foundation (Week 1)
- MV3 scaffolding, permissions, worker wiring
- tab/nav events + content script telemetry
- IndexedDB schema and migrations

### Phase 2: Inference engine (Week 2)
- sessionization and feature extraction
- clustering and task/entity persistence
- page-state classifier and scores

### Phase 3: Briefing and resume UX (Week 3)
- popup and full briefing page
- task cards and resume flow
- mark done and manual correction controls

### Phase 4: Nudge system and polish (Week 4)
- open-loop detector
- alarm scheduler and notification UX
- privacy controls and deletion UX

## 18. Testing Strategy

### 18.1 Unit tests
- URL canonicalization
- score formulas
- classification thresholds
- clustering merge/split behavior

### 18.2 Integration tests
- worker + content script event pipeline
- IndexedDB read/write and migration tests
- UI rendering with seeded fixtures

### 18.3 End-to-end tests
- simulated browsing sessions (shopping/news/travel)
- task quality assertions against expected labels/states
- reminder timing and suppression rules

### 18.4 Quality gates
- task clustering precision target >= 0.75 on labeled internal dataset
- briefing factual consistency >= 0.95 against structured source signals
- crash-free sessions >= 99.5%

## 19. Observability and Product Metrics
- `task_created_count`
- `task_resume_click_rate`
- `task_completion_rate_48h`
- `nudge_click_rate`
- `nudge_dismiss_rate`
- `manual_correction_rate`
- `data_delete_invocations`

## 20. Build-Lock Decisions (Resolved)
- UI default: Full Briefing page is primary; popup remains quick view.
- Permission strategy: request `<all_urls>` up front.
- Sensitive-domain behavior: no default skip list; user config only.
- Manual task naming: included in MVP.
- Assertive language threshold: only when confidence >= 0.80.

## 21. Acceptance Criteria (MVP)
1. Extension reliably groups mixed browsing sessions into coherent task cards.
2. User can resume a task with less than 10 seconds to context.
3. Briefing accurately reflects observed behavior and does not invent facts.
4. Nudges only fire for high-confidence open loops and obey suppression limits.
5. User can pause tracking, blacklist domains, and delete all data at any time.

## 22. Suggested Post-MVP Enhancements
- Cross-device encrypted sync
- Calendar-aware reminder timing
- LLM personalization with explicit opt-in
- Shopping-specific decision assistant (price history, review extraction)
- Session replay timeline for deeper context reconstruction
