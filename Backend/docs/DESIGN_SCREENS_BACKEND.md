# Backend for the design screens

What was added so the mockup screens save to the server instead of the browser, following the mockups and `accounting-module-documentation`.

## Endpoints

| Area | Endpoints | Permission |
|------|-----------|------------|
| Estimates, proposals, sales orders, delayed charges/credits | `GET,POST /api/v1/commercial/:kind`; `GET,PUT,DELETE /commercial/documents/:id`; `POST .../status`; `POST .../convert` | `ar:view`, `ar:manage` |
| Purchase orders | same, with `:kind = purchase-order` | `ap:view`, `ap:manage` |
| Item receipts | `GET,POST /inventory/item-receipts`; `POST /commercial/item-receipts/:id/bill` | `inventory:manage`, `ap:manage` |
| Inventory adjustments | `GET,POST /inventory/adjustments`, `GET /inventory/adjustments/:id` | `inventory:manage` |
| All items, stocked or not | `GET /inventory/items` | `inventory:view` |
| Projects | `GET /projects`, `GET,PUT,DELETE /projects/:id`, `GET /projects/:id/financials`, `POST /projects/:id/links`, `DELETE /projects/:id/links/:kind/:sourceId` | `project:view`, `project:manage` |
| Tasks | `GET /tasks`, `PUT,DELETE /tasks/:id` | `project:view`, `project:manage` |
| Employees | `GET /team/employees`, `GET,PUT,DELETE /team/employees/:id` | `team:view`, `team:manage` |
| Time | `GET,POST /team/time`, `POST /team/time/weekly`, `DELETE /team/time/:id` | `team:view`, `team:manage` (delete) |
| Combined transaction list | `GET /workspace/transactions` | `report:view` |
| Screen state, sign-in load | `GET /workspace/bootstrap`, `GET /workspace/records/:collection`, `PUT,DELETE /workspace/records/:collection/:id` | per collection |

## Accounting rules

- **Documents don't post until converted.** Estimates, orders and delayed items touch the GL only on conversion to an invoice, credit note or bill. Conversion locks the document, so two at once give one invoice.
- **The server computes all money.** Totals, tax and discounts are recomputed from the lines.
- **Goods received, then bill.** An item receipt debits Inventory and credits Goods Received Not Invoiced (GRNI). Billing it debits GRNI, not expenses, so stock isn't expensed twice. A bill that cleared goods can't be voided on its own; a rejected or reversed bill frees its receipts to be billed again.
- **Adjustments (spec 11.9).** A reason is required. When the approval workflow is on and setup requires approval, nothing moves until approved. They go through the stock ledger, respect the negative-stock policy, and post one journal to the chosen account. Value-only adjustments rescale FIFO cost layers.
- **Purchase orders** wait for approval if `PurchaseOrder` is in setup's `approvalRequiredFor`.
- **Project profit comes from the GL (spec 18).** A project is also a PROJECT dimension. Tagging an invoice, bill, expense or journal sets the project on its income and expense lines; `/financials` reads posted lines.
- **Pay data is restricted.** Salary, bank, national ID, TIN and RSSB fields reach only `team:manage`, and are never written to the audit trail.

## Known limits

- Item receipts and adjustments move stock in Accounting only. If the ERP also records the same stock, Inventory reconciliation will show a difference.
- Purchase orders with stock lines can't be raised from the current form, which only has account lines. The API supports them.
- Foreign-currency orders can't be received at cost; bill them directly.
- `recurring` templates are stored but don't generate documents.
- Settings pages still show sample values. The `settings` collection is ready for them.
- Users and roles belong to the ERP (JWT), so Manage users still shows sample data.
- Employee pay and bank fields are access-controlled but not encrypted at rest.

## Running locally

`Backend/.env` needs `DATABASE_URL` and `JWT_SECRET`. Then run `npx prisma migrate deploy` and `npm run dev`. Tests need a real database: `DATABASE_URL=... npx vitest run`.
In production the API refuses to start with a weak `JWT_SECRET`, a default `INTEGRATION_API_KEY`, or `CORS_ORIGIN=*`. `GET /ready` checks the database.
