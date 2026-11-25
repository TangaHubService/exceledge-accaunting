# Security and internal controls

| Control | Result | Evidence |
|---|---|---|
| Sign-in | HS256 ERP token; bad or missing token 401 | E11 |
| Permissions | Capability per route; unprivileged role 403 | E11 |
| Tenant isolation | 13 reads and 5 writes refused; not every route was tried | E12 |
| Separation of duties | Creator cannot post own journal when controls are on | E24 |
| Period lock | 8 of 8 attempts refused; row-locked against races | S20 |
| Reopen | Needs a reason; audited | E25 |
| Audit trail | Append-only in the database; some entities lack their own event (the journal event exists) | A13, A14, E16 |
| System vs user changes | System uses user 0 / role SYSTEM | scheduler.ts |
| CSV formula injection | Neutralised | E31 |
| Production start-up checks | Refuses default secrets and wildcard CORS | config/env.ts |

## Weaknesses
| Finding | Severity | Ref |
|---|---|---|
| One integration key posts to any business | High | E12b, F-18 |
| Ledger rows can be changed in SQL | High | E16, F-17 |
| No verified backup; page claims there is one | High | F-09 |
| 6 dependency advisories, 4 high | High | npm audit, F-25 |
| No rate limit on user or integration routes | Medium | F-26 |
| Errors reveal file paths | Medium | E30, F-19 |
| Token kept in browser storage, exposed if script is injected | Medium | lib/session.tsx |
| Pay and bank details in plain text in the database | Medium | F-27 |
| No branch-level data restriction found | Medium | F-27 |
| Audit page shows invented events when empty | Medium | F-01 |
| Bill approval after posting | Medium | F-21 |
| A valid ERP token for a new organisation creates a company | Low, by design | E13 |

Not done: penetration test, secret-history scan, infrastructure and network review.
