# exceledge-accaunting

Accounting and ERP web application. It lets users manage company setup, chart of accounts, parties (suppliers/customers), banking transactions, approvals, budgets, and reporting. The interface is built with React and served by Vite; the backend is an Express service backed by Prisma and PostgreSQL.

The repository is split into two independent deploy targets:
- `frontend/` — the web UI (`React` + `Vite`)
- `backend/` — the API service (`Express` + `Prisma`)

Each folder carries its own domain package (`packages/domain/`) so neither depends on the other. Both are deployable separately through Dokploy using nixpacks.

This repo contains two independently deployable pieces: a backend API service
(`backend/`) and a frontend web app (`frontend/`). Each folder depends on its own
domain package so neither shares dependencies with the other. Both deploy via
Dokploy using nixpacks.

## What the app does

- **Setup**: company profile, business info, currency, fiscal periods, posting policies, opening balances, inventory settings, approval controls
- **Chart of accounts**: create and organize system accounts; taxonomies, reporting groups, and navigation paths
- **Parties**: supplier and customer records with categories and default accounts
- **Banking**: transfers and transactions between accounts, with type mapping
- **Documents / approvals**: posting controls, review status flows, approval posting
- **Reporting / insights**: budgets and basic analytics

The frontend uses session management (`src/lib/session.tsx`), role-based capabilities (`capabilitiesForRole`), and shared category/transfer-type constants from its domain package.

## Repository layout

```
backend/       Express + Prisma API
  src/         application code (controllers, services, routes)
  packages/    domain package — @exceledge/accounting-domain
    src/       shared domain types, interfaces, constants (accounts, parties, transactions, ...)
    dist/      compiled output
    package.json
    tsconfig.json
frontend/      React SPA served by Vite
  src/         application code (components, pages, lib)
  packages/    domain package — @exceledge/accounting-domain-web
    src/       shared domain definitions for the web layer
    dist/      compiled output
    package.json
    tsconfig.json
  vite.config.ts
  scripts/
  nixpacks.toml
backend/scripts/
frontend/scripts/
```

## Why two domain packages?

Each deploy target was originally one repo. After splitting they needed to remain
independent without sharing dependencies. The table below shows which package each
folder references:

| location | domain package name | type | imports |
|---|---|---|---|
| `backend/packages/domain` | `@exceledge/accounting-domain` | backend only | nothing from frontend |
| `frontend/packages/domain` | `@exceledge/accounting-domain-web` | frontend only | nothing from backend |

Every source file in both apps imports only the domain package it's built against.
For example:

```ts
// backend/src/controllers/auth.controller.ts
import { capabilitiesForRole } from "@exceledge/accounting-domain";

// frontend/src/components/ApForms.tsx
import { SUPPLIER_CATEGORIES } from "@exceledge/accounting-domain-web";
```

Each domain package has its own `dist/`, so a build step is required before the
app can run, even though TypeScript source is available everywhere for
HMR during development.

## Deployment with Dokploy (nixpacks)

Two Dokploy apps are required, one per folder. Configure each with:

### Frontend (`exceledge-accountingweb`)

- **Build Type**: `Nixpacks`
- **Root Directory / source_dir**: `frontend/`
- **Node Version**: use 20 (the nixpacks nixpkgs pin on Dokploy ships nodejs_18).
  Our `frontend/nixpacks.toml` already pins `nodejs_20`.
- The config starts from `frontend/` and runs `npm ci && npm run build`.

That builds the web app, which depends on
`@exceledge/accounting-domain-web` resolved through `file:./packages/domain` and the
Vite alias in `frontend/vite.config.ts`:

```ts
resolve: {
  alias: {
    "@exceledge/accounting-domain-web": path.resolve(root, "packages/domain/src/index.ts"),
  },
},
optimizeDeps: { exclude: ["@exceledge/accounting-domain-web"] },
```

We also added a prebuild script (`frontend/scripts/ensure-domain-built.cjs`) that
rebuilds the domain package if `dist/` isn't present, so the user does not have to
commit compiled output separately.

### Backend (`exceledge-accounting-api` or similar)

Same approach but rooted at `backend/`, with Node 20:

```toml
[phases.setup]
nixPkgs = ["nodejs_20", "npm-10_x", "openssl"]

[phases.install]
cmds = ["npm ci"]

[phases.build]
cmds = ["npm run build"]

[start]
cmd = "npm run prisma:deploy && npm run start"
```

The backend package references `@exceledge/accounting-domain` via
`file:./packages/domain`, and the domain dist is rebuilt on build by
`backend/scripts/ensure-domain-built.js`.

## Local development

Both folders each install independently:

```bash
cd backend && npm install && npm run dev

cd frontend && npm install && npm run dev
```

Before running the frontend you may need to rebuild the domain package since its
source lives under `packages/domain/`:

```bash
cd packages/domain && npm run build
```

If you edit domain files while a Vite watch is running, restart it so the
alias picks up the changes.
