# Excel Edge Accounting

`backend/` and `frontend/` are **separate projects**. Each has its own `package.json` and packages — nothing is shared at the repo root for deploy.

```
exceledge-accaunting/
  backend/     # API — Dokploy Root Directory = backend
  frontend/    # SPA — Dokploy Root Directory = frontend
```

## Dokploy

### Backend
- Build Type: **Nixpacks**
- Root Directory: **`backend`**
- Port: **4600**

### Frontend
- Build Type: **Nixpacks**
- Root Directory: **`frontend`**
- Publish Directory: **`dist`**
- Port: **80**
- **Build-time env** (Vite inlines these — redeploy after changing):

```env
VITE_ERP_URL=https://erp.exceledgecpa.com
VITE_ERP_API_URL=https://erpapi.exceledgecpa.com/api
VITE_ACCOUNTING_API_URL=https://<your-accounting-api-domain>
```

On the **ERP API** (`erpapi`), set `ACCOUNTING_WEB_URL=https://accounting.exceledgecpa.com` (or rely on the hardcoded allowlist) so browser login from Accounting is allowed by CORS.

Open the **frontend** domain in the browser.

## Local

```bash
cd backend && npm install && npx prisma migrate dev
cd ../frontend && npm install
cd ..
npm run dev:api
npm run dev:web
```
