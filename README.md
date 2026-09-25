# Excel Edge Accounting Microservice

Standalone Accounting service (API + DB + UI). Uses **ERP JWT** for AuthN — no local users.

## Quick start

```bash
# From exceledge-accaunting/
cp .env.example .env   # set JWT_SECRET to match ERP
docker compose up -d
npm install
cd apps/api && npx prisma migrate dev --name phase1_foundation
cd ../..
npm run test
npm run dev:api    # :4600
npm run dev:web    # :5174
```

## Phase status

| Phase | Status |
|-------|--------|
| 0 Discovery | **100% COMPLETE** |
| 1 Company Setup | **100% COMPLETE** |
| 2 Chart of Accounts | **100% COMPLETE** |
| 3 Integration Engine & GL | **100% COMPLETE** |
| 4 Customers & AR | Not started |

## Docs

- [Phase 0](./docs/PHASE_0_DISCOVERY_AND_ARCHITECTURE.md)
- [Segments 1–45](./docs/SEGMENTS_1_45_OVERVIEW.md)
- [Phase 1 requirements](./docs/PHASE_1_REQUIREMENTS.md)
