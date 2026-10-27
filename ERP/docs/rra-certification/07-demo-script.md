# RRA Technical Session — Demo Script

Flow order matches the reply email so the demo covers exactly what was promised.

## Setup (before the call)

- Backend running: `cd Backend && npm run dev` (port 4500)
- Sandbox WAR running on `localhost:8085` (forwarding to `https://sdcsandbox.rra.gov.rw`)
- Demo login ready: `demo.admin@exceledge.test` / `TestDemo#123`
- RRA EBMVerify app installed on phone for the QR verification step
- Confirm a few B2B customers exist (TIN `1000000xx`) and the purchase-code pool has free codes

## Walk-through (~15-20 min)

### 1. Sale
1. Open the POS screen, select a customer (retail or B2B).
2. Add items, complete checkout.
3. Show the receipt modal: SDC ID `SDC012000250`, receipt number `xx/xx`, receipt signature, QR code.
4. Show the backend log line:
   `row N: SUCCEEDED — rcptNo=xx, sdcId=SDC012000250`
   and the raw response `resultCd 000`.

### 2. Refund
1. Refund the sale just made.
2. Show the refund receipt appears immediately (label `NR`, its own receipt number).
3. Backend log: `row N: SUCCEEDED` for the `REFUND` operation.
4. Emphasise: refund is a fresh fiscal document (`salesSttsCd=05`, reason code `06`) with its own purchase code.

### 3. Void / Cancel
1. Cancel a sale.
2. Show the void receipt (`salesSttsCd=04`).
3. Backend log: `row N: SUCCEEDED` for the `VOID` operation.

### 4. B2B purchase code
1. Make a sale to a business customer (TIN `1000000xx`).
2. Explain single-use purchase codes: one is drawn per receipt, validated by checksum, marked consumed.

### 5. Verification (EBMVerify)
1. Scan the QR code from a fiscal receipt with the RRA EBMVerify app.
2. Show it verifies successfully.

## Tips

- Run the app locally with the sandbox WAR — do not depend on production for the demo.
- Keep notes of questions RRA asks; they likely map to certification checklist items.
- Do the flows in the same order as the email.