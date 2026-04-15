# Repository Structure

## Root
- `manifest.json`: MV3 config, permissions, background worker, content scripts, and UI entry points.
- `package.json`: local test runner configuration (`node --test`).
- `README.md`: setup and current prototype status.
- `TECH_SPEC.md`: product and technical spec.

## Docs
- `docs/IMPLEMENTATION_BACKLOG.md`: ticket-level backlog with priorities, dependencies, and acceptance criteria.
- `docs/SPRINT_01.md`: first sprint scope and execution checklist.
- `docs/SPRINT_02.md`: inference and task-controls sprint status.
- `docs/SPRINT_03.md`: nudges and open-loop sprint status.
- `docs/REPO_STRUCTURE.md`: this file.

## Source
- `src/shared/constants.js`: message types and shared storage keys.
- `src/shared/icon-128.png`: extension and notification icon.
- `src/background/storage.js`: IndexedDB wrapper for events and derived task snapshots.
- `src/background/inference.js`: pure inference engine (clustering, scoring, state classification).
- `src/background/nudges.js`: open-loop scoring and reminder selection/suppression logic.
- `src/background/service-worker.js`: event ingestion, orchestration, message handlers, reminders skeleton.
- `src/content/engagement.js`: scroll/visibility/focus engagement snapshots.
- `src/popup/*`: quick task snapshot UI.
- `src/briefing/*`: full task briefing UI and resume actions.
- `src/settings/*`: settings controls and data deletion.
- `tests/inference.test.js`: unit tests for canonicalization, clustering, and override behavior.
- `tests/nudges.test.js`: unit tests for open-loop and notification suppression logic.

## Sprint boundaries
- Sprint 1 focuses on instrumentation and basic task feed correctness.
- Sprint 2 moves to graph clustering, scoring calibration, and task confidence upgrades.
- Sprint 3 focuses on briefing quality and resume UX polish.
