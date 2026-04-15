# Context Restore

Context Restore is a personal productivity system that preserves browsing context across sessions.

It includes:
- `extension/`: Chrome extension that tracks browsing signals, infers task groups, and generates task briefings.
- `backend/`: Node + Postgres sync API used by the extension and iOS app.
- `ios/`: SwiftUI companion app for reviewing tasks, briefings, and reminders on iPhone.

## Repository Structure
- `extension/README.md`: Extension features and local usage.
- `backend/README.md`: Backend local setup and cloud deployment.
- `ios/README.md`: iOS app setup and run instructions.
- `extension/TECH_SPEC.md`: Detailed extension technical spec.
- `ios/docs/IOS_COMPANION_APP_SPEC.md`: iOS architecture and product spec.

## Quick Start
1. Start backend:
```bash
cd backend
docker compose up -d
cp .env.example .env
npm install
npm run migrate
npm run dev
```
2. Load extension:
   - Open `chrome://extensions`
   - Enable Developer mode
   - Click **Load unpacked**
   - Select the `extension/` folder
3. Open the iOS app:
   - Open `ios/ContextRestoreiOS.xcodeproj` in Xcode
   - Run on simulator/device
   - Set backend URL + API token in app Settings
