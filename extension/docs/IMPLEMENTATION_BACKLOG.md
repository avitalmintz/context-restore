# Implementation Backlog

## Prioritization scale
- `P0`: required for usable prototype
- `P1`: strong quality or product lift
- `P2`: can defer

## Epic E1 - Instrumentation Foundation

| ID | Priority | Title | Estimate | Depends On | Acceptance Criteria |
| --- | --- | --- | --- | --- | --- |
| CR-001 | P0 | MV3 scaffold and permissions | 0.5d | - | Manifest loads in Chrome, worker starts, no runtime permission errors. |
| CR-002 | P0 | Tab and navigation event ingestion | 1d | CR-001 | `tab_*` and `nav_committed` events are persisted with canonical URL and timestamp. |
| CR-003 | P0 | Content engagement snapshots | 1d | CR-001 | Scroll + visibility + active ms snapshots arrive from content scripts on active pages. |
| CR-004 | P0 | IndexedDB event store | 1d | CR-001 | Event store supports append/read recent/clear with migration-safe schema versioning. |
| CR-005 | P1 | Tracking pause and retention settings | 0.5d | CR-004 | Toggle pause state and retention days persist and affect ingestion behavior. |

## Epic E2 - Task Inference Engine

| ID | Priority | Title | Estimate | Depends On | Acceptance Criteria |
| --- | --- | --- | --- | --- | --- |
| CR-006 | P0 | URL canonicalization utility | 0.5d | CR-002 | Tracking params removed, stable page keys generated, test fixtures pass. |
| CR-007 | P0 | Sessionization logic | 1d | CR-002, CR-003 | Active sessions split on idle/tab switch/navigation according to spec thresholds. |
| CR-008 | P0 | Domain-seeded task feed (interim) | 1d | CR-004, CR-007 | Worker returns grouped task cards from recent events with stable ordering. |
| CR-009 | P1 | Graph clustering v1 | 2d | CR-006, CR-007 | Weighted edges create coherent task groups on labeled sample sessions. |
| CR-010 | P1 | Page state classifier | 1d | CR-007 | Pages classified as bounced/skimmed/read/unopened per thresholds. |
| CR-011 | P1 | Interest and completion scoring | 1d | CR-010 | Numeric scores generated and visible in task payload debug output. |

## Epic E3 - Briefing and Resume UX

| ID | Priority | Title | Estimate | Depends On | Acceptance Criteria |
| --- | --- | --- | --- | --- | --- |
| CR-012 | P0 | Popup quick-view UI | 0.5d | CR-008 | Popup shows top tasks and opens full briefing page. |
| CR-013 | P0 | Full briefing page | 1d | CR-008 | Cards show title, confidence, briefing text, page counts, resume action. |
| CR-014 | P0 | Resume action flow | 0.5d | CR-013 | Resume opens suggested URLs in ordered tabs and logs user action. |
| CR-015 | P1 | Manual task rename | 0.5d | CR-013 | User can rename task title and update persists locally. |
| CR-016 | P1 | Mark done and suppression | 0.5d | CR-013 | Completed tasks are suppressed from default active feed. |

## Epic E4 - Nudges and Controls

| ID | Priority | Title | Estimate | Depends On | Acceptance Criteria |
| --- | --- | --- | --- | --- | --- |
| CR-017 | P1 | Open-loop detector v1 | 1d | CR-011 | Tasks with high interest and low completion become open-loop candidates. |
| CR-018 | P1 | Alarm scheduler and notification copy | 1d | CR-017 | Notifications fire on schedule and respect pause state. |
| CR-019 | P1 | Quiet hours and daily cap | 1d | CR-018 | Nudge limits enforced; no more than configured max/day. |
| CR-020 | P0 | Delete-all local data | 0.5d | CR-004 | User action clears events, snapshots, and local settings state as defined. |

## Sprint allocation
- Sprint 1: CR-001, CR-002, CR-003, CR-004, CR-008, CR-012, CR-013, CR-014, CR-020
- Sprint 2: CR-005, CR-006, CR-007, CR-009, CR-010, CR-011, CR-015, CR-016
- Sprint 3: CR-017, CR-018, CR-019 + scoring calibration and polish

## Execution status snapshot
- Completed: CR-001, CR-002, CR-003, CR-004, CR-005, CR-006, CR-007 (heuristic v1), CR-008, CR-009 (v1), CR-010, CR-011, CR-012, CR-013, CR-014, CR-015, CR-016, CR-017, CR-018, CR-019, CR-020
- Pending: none in current MVP backlog
- Manual validation still required in-browser for all completed tickets.
