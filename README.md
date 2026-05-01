# Context Restore

Context Restore is a personal tool that watches what you do in Chrome, groups related pages into tasks, and reminds you about tasks you started but did not finish.

It has three parts:

1. A Chrome extension that records browsing signals and clusters them into tasks.
2. A Node and Postgres backend that stores tasks and syncs them between clients.
3. A SwiftUI iOS companion app that shows your tasks, briefings, and reminders on the phone.

## What it does

1. The Chrome extension records lightweight browsing signals: which tabs are open, which pages you navigate to, and engagement signals from each page (how long you stay, how you scroll).
2. It clusters those pages into tasks using a graph clustering heuristic, and assigns each task a state, interest, and completion score.
3. It generates a short, template based briefing for each task summarizing the pages and recent activity.
4. The reminder engine flags tasks that look open (started but not closed) and surfaces them as reminders. The engine respects quiet hours, a daily cap, and a per task cooldown so it does not spam you.
5. Snapshots and task actions sync through the backend, so the Chrome extension and the iOS app see the same tasks.
6. From either client you can resume a task, rename it, mark it done, or reopen it. You can also pause tracking, set retention days, change reminder settings, or delete local data from the extension settings.

## Repository layout

| Folder | Contents |
|---|---|
| extension/ | Chrome MV3 extension: event ingestion, task clustering, briefings, reminder UI |
| backend/   | Node and Postgres sync API with Docker and Render deploy config |
| ios/       | SwiftUI iOS companion app (ContextRestoreiOS.xcodeproj) |

Each subfolder has its own README:

- extension/README.md: extension features and local install
- backend/README.md: local setup, API endpoints, cloud deploy
- ios/README.md: iOS build instructions

Specs live in extension/TECH_SPEC.md and ios/docs/IOS_COMPANION_APP_SPEC.md.

## Quick start

1. Run the backend:

```bash
cd backend
docker compose up -d
cp .env.example .env
npm install
npm run migrate
npm run dev
```

The server listens on http://127.0.0.1:8787.

2. Load the Chrome extension:

   - Open chrome://extensions
   - Enable Developer mode
   - Click Load unpacked and select the extension/ folder

3. Run the iOS app:

   - Open ios/ContextRestoreiOS.xcodeproj in Xcode
   - Run on a simulator or device
   - In Settings, set the backend URL and API token

## Status

This is a personal prototype, not production software:

- Auth is single user dev token, not multi user production auth.
- Task clustering is a graph clustering heuristic and is still being calibrated on real browsing traces.
- Briefings are template based. There is no LLM summarization yet.
- Sprint 1 through Sprint 3 MVP backlog is implemented, and backend sync is wired up.

## License

MIT. See LICENSE.
