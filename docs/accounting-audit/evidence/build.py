import json,collections
rows=[l.rstrip('\n').split('|') for l in open('evidence/matrix.txt') if l.strip() and l[0]!='#']
for r in rows: assert len(r)==12,(len(r),r)
S={'F':'Fully implemented and tested','P':'Implemented but partially functional','I':'Implemented but financially incorrect','N':'Implemented but not tested','M':'Missing','D':'Duplicated','X':'Not applicable','U':'Unable to verify'}
W={'F':1,'P':.5,'I':.25,'N':.4,'D':.5,'M':0}
# an incorrect non-financial feature is worded differently
def stat(r):
    return 'Implemented but not functioning correctly' if r[4]=='I' and r[0] in('Security','User experience','Reliability') else S[r[4]]
def score(rs):
    rs=[r for r in rs if r[4] in W]
    return round(100*sum(W[r[4]] for r in rs)/len(rs)),len(rs)
by=collections.OrderedDict()
for r in rows: by.setdefault(r[0],[]).append(r)
out=['# QuickBooks comparison matrix\n','Baseline: commit 6438570, 24 November 2026.\n','**(A)** = stated on Intuit\'s US pricing page, read 24 November 2026: https://quickbooks.intuit.com/pricing/. **(A2)** = Intuit help: Multicurrency is not in Simple Start: https://quickbooks.intuit.com/learn-support/en-us/help-article/multicurrency/learn-multicurrency-quickbooks-online/L5krkKQi8_US_en_US. **Std** = generally available in QuickBooks Online from the auditor\'s knowledge, not confirmed on an official page in this audit. "Not verified" and "plan not verified" mean exactly that. Limits on the page: Simple Start 1 user, Essentials 3, Plus 5, Advanced 25. The non-US editions were not checked.\n','IDs such as S08 or E17 are in FUNCTIONAL_TEST_RESULTS.md. "suite" = existing automated tests, all passing. Paths are under `Backend/src/modules` or `Frontend/src`.\n']
for m,rs in by.items():
    out.append(f'\n## {m}\n\n| Feature | QuickBooks Online | Existing system | Status | Test | Accuracy | Gap | Evidence | Business impact | Recommendation | Priority |\n|'+'---|'*11)
    for r in rs: out.append('| '+' | '.join([r[1],r[2],r[3],stat(r)]+r[5:])+' |')
cnt=collections.Counter(r[4] for r in rows)
out.insert(4,'Totals: '+', '.join(f'{v} {S[k].lower()}' for k,v in cnt.most_common())+f' ({len(rows)} rows).\n')
open('QUICKBOOKS_COMPARISON_MATRIX.md','w').write('\n'.join(out)+'\n')
mods=[('Core accounting',['Core accounting']),('Sales and receivables',['Sales and receivables']),('Purchases and payables',['Purchases and payables']),('Inventory management',['Inventory']),('Banking and reconciliation',['Banking']),('Financial reporting',['Reporting']),('Tax and regulatory compliance',['Tax and compliance']),('Security and internal controls',['Security']),('User experience',['User experience']),('System reliability',['Reliability'])]
sc=[(n,)+score([r for r in rows if r[0] in ms])+(sum(1 for r in rows if r[0] in ms and r[4]=='F'),) for n,ms in mods]
qbo=[r for r in rows if not r[2].startswith(('n/a','Vendor','Not in QBO','Not standard'))]
cov=score(qbo)
g=[('All P0 findings closed',0),('Statements balance and reconcile (A01–A05, A16)',1),('AR/AP/ageing reconcile in all tested cases',0),('No page shows invented data',0),('Duplicate submission safe',0),('Closed periods protected',1),('Tenant isolation tested',1),('Rollback and concurrency tested',1),('Verified backup and restore',0),('CI and frontend tests',0),('EBM compliance evidenced',0),('Volume target met',0)]
pr=round(100*sum(x for _,x in g)/len(g))
t='| Area | Score | Features scored | Fully tested |\n|---|---|---|---|\n'+'\n'.join(f'| {n} | **{s}** | {c} | {f} |' for n,s,c,f in sc)+f'\n| Production readiness | **{pr}** | {len(g)} gates | {sum(x for _,x in g)} met |\n| QuickBooks functional coverage | **{cov[0]}** | {cov[1]} | {sum(1 for r in qbo if r[4]=="F")} |\n'
meth='Score = average weight of the matrix rows in the area: fully tested 100, partial or duplicated 50, untested 40, incorrect 25, missing 0. Not-applicable and unverifiable rows are left out. The weights are an auditor\'s choice, the row statuses are the evidence; rerun `evidence/build.py` to recompute. Small areas move a lot per row, so read them as rough. Production readiness is the share of 12 pass/fail gates met.\n'
gates='| Gate | Met |\n|---|---|\n'+'\n'.join(f'| {n} | {"Yes" if x else "No"} |' for n,x in g)+'\n'
json.dump({'t':t,'meth':meth,'gates':gates},open('/tmp/audit_scores.json','w'))
res=json.load(open('evidence/results.json'))
c=collections.Counter(r['result'] for r in res)
d=['# Functional test results\n',f'**{len(res)} checks: {c["PASS"]} pass, {c["FAIL"]} fail, {c["PARTIAL"]} partial, {c["INFO"]} information only.** Run on a throwaway PostgreSQL database through the real API. Raw log `evidence/run.txt`; script `evidence/audit-scenarios.ts`; rerun with `sh ../docs/accounting-audit/evidence/run.sh` from `Backend`.\n','Existing tests: 321 of 321 backend tests pass on a separate clean database, 109 of 109 domain tests pass, both projects type-check, all migrations apply with no schema drift. There are no frontend tests.\n','## Reading the results\n- A01–A14 were taken after the normal scenarios; A15–A17 and E-rows include deliberate attempts to break the books.\n- Every row lists the journals it created. Audit events per entity are in A13. Balances for inventory, customers and suppliers are in A06–A10.\n- E04b, E08, E12b and E20–E22 are design or scale findings rather than crashes.\n- A10: the ERP payment in S04 carried no bill reference, so it is unallocated. The ageing should still show it as a credit.\n- E11 to E14 that pass mean the attack was refused.\n']
for title,pre in (('Business scenarios','S'),('Accuracy checks','A'),('Reliability, security and edge cases','E')):
    d.append(f'## {title}\n')
    for r in res:
        if r['id'][0]!=pre: continue
        a=' '.join(r['actual'].split())[:700].replace('|','/')
        d.append(f"### {r['id']} {r['name']}: {r['result']}\n- Expected: {r['expected']}\n- Actual: {a}")
        js=r.get('journals') or []
        for j in js[:8]: d.append(f'  - `{j}`')
        if len(js)>8: d.append(f'  - and {len(js)-8} more')
        d.append('')
d.append('''## Screens checked in the browser (audit database)
| Screen | Result |
|---|---|
| Home dashboard | FAIL: income 12,850,000, customers "Alpha Ltd", dated 2024; the books held 2,360,854 revenue. Only the activity table says "Sample data" |
| Backup and restore | FAIL: lists four "Success" backups; code creates none |
| Credit note | FAIL: no tax column, no invoice link |
| Receivables ageing | FAIL: USD 1,000 shown as RWF 1,000; "{cfg.detailLabel}" printed |
| Financial statements | PASS: agree with the API |
| Budgets landing | Loads; the new editor was read in code, not saved in the browser |

Other screens were reviewed in code, not clicked.

## Not tested
Killing the database or network mid-request (only refusals inside a transaction); live email, EBM, mobile money, object storage and ERP; restore of a real backup; sustained load; screen-reader and mobile use; year-end close in the new harness (covered by the existing suite); a full UI pass per role.
''')
open('FUNCTIONAL_TEST_RESULTS.md','w').write('\n'.join(d))
print(t); print(cnt)
