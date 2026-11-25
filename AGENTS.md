# Rules for every agent working here

Accounting app for Rwandan businesses, linked to the Excel Edge ERP. `Backend`: Express, Prisma, PostgreSQL. `Frontend`: React, Vite, TypeScript, plain CSS.

## Accounting rules
- Every posting goes through `createAndPostJournal` (`Backend/src/modules/journals/journal.service.ts`). Never write `gl_entries` directly.
- Posted entries are never edited or deleted; reverse them. Database triggers enforce this.
- Nothing posts to receivables, payables or inventory control accounts except the module that owns the subledger.
- A document, its journal and its subledger commit together (`inTransaction`).
- The ERP owns stock. App invoices never move stock or cost of sales.
- Ageing must equal the control account on any date, in the functional currency.
- VAT comes from tax codes on lines. Confirm tax rules with RRA before coding them.
- Every query filters by `companyId`.

## Product rules
- Screens follow the app shell and save through real endpoints. No invented data; never report success before the server confirms it.
- A feature that doesn't work yet says "Not available yet".

## Ways of working
- Branches are `feat/<name>` or `chore/<name>`. One roadmap item per pull request.
- One writer per branch; the other agent reviews and does not edit. Two writers use separate worktrees and different files.
- Commit, push or open a pull request only when the user asks.
- Never read or print `.env` files. Test only on throwaway databases.
- Migrations are additive; never edit one that has been pushed.

## Checks before saying done
- Backend (needs a throwaway `DATABASE_URL`): `npx tsc --noEmit`, `npx prisma migrate deploy`, `npx vitest run`
- Domain: `npx vitest run` in `Backend/packages/domain`
- Frontend: `npm run build`

## Reviews
- Report only defects with a concrete input and wrong result, ranked: money wrong, data lost or leaked, then the rest. Give file and line.
- Each finding ends fixed with a test that failed before, or rejected with a reason. At most two rounds, then the user decides.

