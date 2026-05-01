# Context Restore

> Personal productivity system that preserves browsing context across sessions.

Context Restore watches how you actually work in the browser, groups related pages into tasks, and helps you pick up where you left off — with a quick briefing and reminders for the open loops you'd otherwise forget.

It's a three-part personal prototype:

- **Chrome extension** — captures lightweight browsing signals, clusters them into tasks, and shows briefings.
- **Backend (Node + Postgres)** — sync API shared between the extension and the iOS app.
- **iOS companion app (SwiftUI)** — review tasks, briefings, and reminders from your phone.

## How it works

1. The extension watches your browsing (tabs, navigation, engagement) and groups pages into inferred tasks.
2. Each task gets a state, interest, and completion score plus a template-based briefing.
3. A reminder engine surfaces "open loops" — tasks you started but didn't close — with quiet hours, a daily cap, and per-task cooldowns.
4. Snapshots and task actions sync through the backend so your iPhone and laptop stay in sync.

## Repository layout

| Folder | What's inside |
|---|---|
| [`extension/`](extension/) | Chrome MV3 extension: event ingestion, task clustering, briefings, reminder UI |
| [`backend/`](backend/) | Node + Postgres sync API with Docker + Render deploy config |
| [`ios/`](ios/) | SwiftUI iOS companion app (`ContextRestoreiOS.xcodeproj`) |

Each subfolder has its own README with details:

- [`extension/README.md`](extension/README.md) — extension features and local install
- [`backend/README.md`](backend/README.md) — local setup, API endpoints, cloud deploy
- [`ios/README.md`](ios/README.md) — iOS build instructions

Specs live in [`extension/TECH_SPEC.md`](extension/TECH_SPEC.md) and [`ios/docs/IOS_COMPANION_APP_SPEC.md`](ios/docs/IOS_COMPANION_APP_SPEC.md).

## Quick start

**1. Run the backend**

```bash
cd backend
docker compose up -d
cp .env.example .env
npm install
npm run migrate
npm run dev
```

The server listens on `http://127.0.0.1:8787`.

**2. Load the Chrome extension**

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `extension/` folder

**3. Run the iOS app**

1. Open `ios/ContextRestoreiOS.xcodeproj` in Xcode
2. Run on a simulator or device
3. In Settings, set the backend URL and API token

## Status

This is a personal prototype, not production software:

- Single-user dev-token auth, not multi-user production auth
- Task clustering is heuristic graph clustering and still being calibrated on real traces
- Briefings are template-based (no LLM summarization yet)
- Sprint 1–3 MVP backlog is implemented; backend sync is wired up

## License

MIT — see [LICENSE](LICENSE).
