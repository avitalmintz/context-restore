# Context Restore (Prototype)

Chrome extension prototype that infers tasks from browsing behavior and generates quick context briefings.

## Current status
- Sprint 1 through Sprint 3 MVP backlog implemented
- Event ingestion wired (tabs, navigation, engagement snapshots)
- Graph-clustered task feed with per-page state/interest/completion scoring
- Task actions implemented: resume, rename, mark done/reopen
- Settings controls implemented: pause tracking, retention days, reminder settings, delete local data
- Reminder engine implemented: open-loop detection, hourly evaluation, quiet hours, daily cap, per-task cooldown
- Backend sync (Phase 2) implemented: register device, upload snapshots, pull/ack task actions
- Test harness added for inference and nudges (`npm test`)

## Load in Chrome
1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `extension/`.

## Files
- `manifest.json`: extension manifest and permissions
- `src/background`: event ingestion and task-feed generation
- `src/content`: page engagement signal capture
- `src/popup`: quick snapshot UI
- `src/briefing`: full task briefing UI
- `src/settings`: local controls (pause tracking, delete data)
- `src/background/nudges.js`: open-loop scoring and reminder gating logic
- `docs/`: extension backlog, sprint plan, and repo structure
- `../ios/docs/IOS_COMPANION_APP_SPEC.md`: iOS companion app + sync architecture spec

## Prototype caveats
- Task clustering is heuristic graph clustering and still needs calibration on real browsing traces.
- Briefings are template-based and conservative (no LLM summarization yet).
- Sync uses local dev token auth and is intended for personal prototype use.
