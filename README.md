# Excel Edge Accounting

Separate **backend** and **frontend** apps. Each folder is its own project root for Dokploy.

```
backend/     → Accounting API (Dokploy Root Directory = backend)
frontend/    → Accounting SPA  (Dokploy Root Directory = frontend)
```

Shared domain rules live in `backend/packages/domain` and are copied to `frontend/packages/domain` (`npm run sync:domain`).

## Quick start

```bash
cp backend/.env.example backend/.env   # or root .env.example → set JWT_SECRET
docker compose up -d
cd backend && npm install && npx prisma migrate dev
cd ../frontend && npm install
cd ..
npm run dev:api    # :4600
npm run dev:web    # :5174
```

## Dokploy

### Backend (API)

| Setting | Value |
|--------|--------|
| Build Type | **Nixpacks** |
| Root Directory | **`backend`** |
| Install/Build/Start | leave empty (uses `backend/nixpacks.toml`) |
| Port | **4600** |

### Frontend (WEB)

| Setting | Value |
|--------|--------|
| Build Type | **Nixpacks** |
| Root Directory | **`frontend`** |
| Publish Directory | **`dist`** |
| Port | **80** |

Frontend env (build-time):

```env
VITE_ERP_URL=https://erp.exceledgecpa.com
VITE_ERP_API_URL=https://erpapi.exceledgecpa.com/api
VITE_ACCOUNTING_API_URL=https://<your-backend-domain>
```

### Access

| App | URL |
|-----|-----|
| Web UI | domain on the **frontend** Dokploy app |
| API | domain on the **backend** Dokploy app |

Open the frontend domain in the browser. Point `VITE_ACCOUNTING_API_URL` at the backend domain, then redeploy frontend.

## Docs

See [docs/](./docs/) for phase notes.
