async function main() {
  const body = { tin: '999945560', bhfId: '00', dvcSrlNo: 'excelwartest', lastReqDt: '20000101000000' };
  const res = await fetch('http://localhost:8085/code/selectCodes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json();
  const cls = j?.data?.clsList ?? [];
  console.log('total classes:', cls.length);
  const all = cls.map((c: any) => c.cdCls).join(',');
  console.log('class ids:', all);
  for (const c of cls) {
    if (!['31','15','16','01','14','37','38'].includes(c.cdCls)) continue;
    const dts = c.dtlList ?? [];
    const names = dts.map((d: any) => `${d.cd}:${d.cdNm}`).join(',');
    console.log(`[${c.cdCls}] ${c.cdClsNm}: ${names}`);
  }
}
main();
