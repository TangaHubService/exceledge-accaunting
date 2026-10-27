# Excledge Backend API Documentation

The backend is documented with **OpenAPI 3.0 (Swagger UI)** and **Postman** collections.

## Quick start

```bash
cd Backend
npm run docs:generate   # rebuild specs after route changes
npm run dev             # start API
```

Then open:

- [http://localhost:4500/api/docs](http://localhost:4500/api/docs) — landing page  
  (use your configured `PORT` if different)
- `/api/docs/full` — **entire** backend (~280 routes)
- `/api/docs/rra` — **RRA / EBM only** (fiscal product surface)

JSON specs:

- `/api/docs/openapi.json`
- `/api/docs/rra.json`

## Postman

See [`Postman/README.md`](../Postman/README.md).

| Collection | Use when |
|------------|----------|
| `Postman/Excledge-API-Collection.json` | Exploring or integrating the full ERP API |
| `Postman/Excledge-RRA-API-Collection.json` | Selling / partnering on RRA fiscal endpoints |
| `Postman/EBM-Test-Collection.json` | Sandbox certification against VSDC WAR |

## How docs are generated

`Backend/scripts/api-docs/` scans Express route files + Zod validators and emits:

- `Backend/src/docs/openapi.json`
- `Backend/src/docs/openapi-rra.json` (from curated `rra-openapi.ts`)
- `Backend/src/docs/route-catalog.json`
- Postman collections under `Postman/`

Curated RRA descriptions live in `Backend/src/docs/rra-openapi.ts` and are merged into the full spec for overlapping paths.

## RRA-focused integration guide

For VSDC mapping, jobs, and certification flows:

- [`docs/ebm-vsdc/INTEGRATION.md`](./ebm-vsdc/INTEGRATION.md)
- [`docs/ebm-vsdc/CERTIFICATION-CHECKLIST.md`](./ebm-vsdc/CERTIFICATION-CHECKLIST.md)
