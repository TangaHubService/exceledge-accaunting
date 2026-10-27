# Bruno collections

Native [Bruno](https://www.usebruno.com/) collections for Excledge APIs.

| Folder | Requests | Purpose |
|--------|----------|---------|
| **`EBM-VSDC-Test-Suite/`** | **~88** | Hands-on EBM/RRA CIS test kit (folders `00`–`11`) |

There is also a legacy Bruno collection under `Backend/Business Management System API/`.

## Open the EBM suite

1. Install [Bruno](https://www.usebruno.com/downloads)
2. **Open Collection** → select `Bruno/EBM-VSDC-Test-Suite`
3. Select environment **Excledge EBM/VSDC Environment**
4. Set `loginEmail` / `loginPassword`, plus `productId`, `branchId`, `itemCd`, `itemClsCd`
5. Run **`00 — Auth → POST Login`**, then walk folders `01`–`10`

CLI (optional):

```bash
cd Bruno/EBM-VSDC-Test-Suite
bru run --env "Excledge EBM/VSDC Environment"
```

## Regenerate from Postman

The Bruno suite is converted from `Postman/EBM-Test-Collection.json`:

```bash
cd Postman/scripts
npm install
node postman-to-bruno.mjs ../EBM-Test-Collection.json ../../Bruno/EBM-VSDC-Test-Suite ../EBM-Environment.json
```

Postman remains supported under `Postman/` — Bruno is an alternate client for the same suite.
