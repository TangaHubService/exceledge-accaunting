async function main() {
  const spplrTin = process.argv[2] || '100000000';
  const invc = 8000 + Math.floor(Math.random()*500);
  const dt = '20260814214500';
  const body = {
    tin: '999945560', bhfId: '00', dvcSrlNo: 'excelwartest',
    invcNo: invc,
    spplrTin, spplrBhfId: '00', spplrInvcNo: String(invc + 1000),
    spplrNm: 'Supplier Test', spplrSdcId: 'SDC000000000',
    pchsTyCd: 'N', rcptTyCd: 'P', pmtTyCd: '01', regTyCd: 'A',
    modrId: '100000000', modrNm: 'Tester', regrId: '100000000', regrNm: 'Tester',
    orgInvcNo: String(invc), pchsSttsCd: '02', pchsDt: '20260814',
    salesDt: dt, cfmDt: dt,
    totItemCnt: 1, totTaxblAmt: 1000, totTaxAmt: 180, totAmt: 1180,
    taxRtA: 0, taxRtB: 18, taxRtC: 0, taxRtD: 0,
    taxblAmtA: 0, taxblAmtB: 1000, taxblAmtC: 0, taxblAmtD: 0,
    taxAmtA: 0, taxAmtB: 180, taxAmtC: 0, taxAmtD: 0,
    itemList: [{ itemSeq: 1, itemCd: 'IT001', itemClsCd: 'CL01', itemNm: 'Test Item', bcd: '', pkg: 1, pkgUnitCd: 'OU', qty: 1, qtyUnitCd: 'U', prc: 1000, splyAmt: 1000, dcRt: 0, dcAmt: 0, taxTyCd: 'B', taxblAmt: 1000, taxAmt: 180, totAmt: 1180 }]
  };
  const res = await fetch('http://localhost:8085/trnsPurchase/savePurchases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const t = await res.text();
  console.log(`savePurchases spplrTin=${spplrTin} invc=${invc}:`, t.slice(0, 500));
}
main();
