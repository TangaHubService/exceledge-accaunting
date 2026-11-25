# Codex review, round 1, 25 November 2026

Codex 0.172.0, gpt-6-luna, read-only, on 680bb3c against main. It ran no tests. Every finding was reproduced with a failing test before the fix (`Backend/tests/codex-review.test.ts`), except the un-apply race, whose test was added with its fix.

| Finding | From | Rated | Outcome |
|---|---|---|---|
| Reversing a receipt while it is being refunded posts cash out twice | Codex P0 | P0 | Fixed: the receipt is locked, then read |
| Saved answers replayed after access is revoked | Codex P0 | P1: only the sender's own earlier answer | Fixed: 403 when access changed |
| Ageing before a reversal uses the wrong bucket (totals were right) | Codex P1 | P1 | Fixed for receipts, write-offs and supplier payments |
| New API keys and webhook secrets kept in plain text in saved answers | Claude, while checking | P0 | Fixed: those answers are never saved, and existing ones are deleted by the migration |
| Applying a payment while it is being reversed leaves the invoice or bill paid | Claude | P0 | Fixed on both sides |
| Un-applying while reversing could reduce the invoice twice | Claude | P0 | Fixed on both sides; tested for receipts |
