# Context Restore Backend

Sync API for the Chrome extension and iOS companion app.

## Implemented
- Postgres schema + migration runner
- Auth middleware (single-user dev token mode)
- API endpoints:
  - `POST /v1/devices/register`
  - `POST /v1/sync/upload`
  - `GET /v1/tasks`
  - `POST /v1/tasks/:taskId/actions`
  - `GET /v1/sync/actions`
  - `POST /v1/sync/actions/ack`
  - `POST /v1/data/reset`

## Local Setup
1. Start Postgres:
```bash
docker compose up -d
```
2. Create env file:
```bash
cp .env.example .env
```
3. Install dependencies:
```bash
npm install
```
4. Run migrations:
```bash
npm run migrate
```
5. Start backend:
```bash
npm run dev
```

Server defaults to `http://127.0.0.1:8787`.

## Cloud Deployment (Render, Docker)
This repo includes:
- `Dockerfile`
- `render.yaml`

Steps:
1. Push this project to GitHub.
2. In Render, create a new Blueprint from the repo root.
3. Render will create:
   - `context-restore-db` (Postgres)
   - `context-restore-api` (Docker web service)
4. In Render service env vars:
   - Set `DEV_USER_EMAIL` to your email.
   - Keep `DEV_USER_ID` fixed unless you want to rotate user identity.
   - Copy `DEV_API_TOKEN` from Render and use it in extension + iPhone app.
   - If your DB URL requires TLS, set `DATABASE_SSL=true`.
5. Deploy.
6. Verify health:
```bash
curl https://<your-render-service>.onrender.com/health
```

## Point Clients To Cloud
- Chrome extension settings:
  - Backend URL: `https://<your-render-service>.onrender.com`
  - API token: `<DEV_API_TOKEN>`
- iPhone app settings:
  - Backend URL: same cloud URL
  - API token: same token

After switching both clients to the same cloud URL, your computer no longer needs to be running for sync.

## Auth (prototype)
All `/v1/*` routes require:
```http
Authorization: Bearer <DEV_API_TOKEN>
```

Dev user identity is taken from:
- `DEV_USER_ID`
- `DEV_USER_EMAIL`

## Example register device
```bash
curl -X POST http://127.0.0.1:8787/v1/devices/register \
  -H "Authorization: Bearer $DEV_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"platform":"chrome_extension","deviceLabel":"Avital Mac Chrome"}'
```

## Notes
- This is still single-user prototype auth, not multi-user production auth.
- Migrations run automatically in Docker startup via `npm run start:prod`.
