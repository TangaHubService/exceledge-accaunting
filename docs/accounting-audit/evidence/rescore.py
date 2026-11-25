"""Re-scores evidence/matrix.txt for feat/quickbooks-gaps. Only statuses that changed are listed, with the reason."""
import collections
NEW={
'Opening balances':('F','ageing and equity tests'),'Trial balance':('F','110 ms at 100,000 rows'),'Cash and accrual reporting':('P','cash-basis profit and loss only'),
'Reversals and adjustments':('F','S20b, E14'),'Multi-currency and FX':('P','foreign documents tested; foreign customer refunds still refused'),
'Sales receipts':('F','one transaction; browser'),'Advances (deposits)':('F','dated; tests'),'Credit notes':('F','VAT; browser'),'Refund receipts':('F','browser'),
'AR ageing':('F','A09, E26, E27'),'Bad debt write-off':('F','browser'),'Supplier bills':('F','held until approved; tests'),'Sales invoices':('F','edit in browser'),'Late fees, scheduled reminders':('F','tests'),'Low-stock alerts':('F','test'),'Purchase orders':('F','stock lines in the form; suite'),'Sales and purchase reports':('F','14 reports, tests and browser'),'Settings switches':('P','unused ones say not available'),'Screens that fake success':('F','feedback saved; company details from profile'),'Direct expenses, cheques':('F','E23b'),'AP ageing':('F','A10'),
'Expenses, categories, approval':('F','E23c'),'Cash flow statement':('P','disposals right; credit asset purchases still investing'),'Budget vs actual':('P','editor opens; save not clicked'),
'Home dashboard':('F','browser'),'Tax inclusive prices':('F','sales and supplier forms, tests and browser'),'Time zone of ERP postings':('F','E08'),'Notifications':('F','browser'),
'Workflow automation':('P','notify and email rules; no task or approval actions'),'Audit trail':('F','A14'),'Ledger immutability':('F','E16'),'Error messages':('F','E30'),'Rate limiting':('F','test'),
'Duplicate user submissions':('F','E01, E01b'),'Backup and restore':('F','restore proven by test and npm run backup; live restore is an operator step'),'Large volume':('F','E22'),'Screens that fake success':('P','a feedback message still claims to be sent'),'Receipt capture / inbox':('P','upload to draft expense; nothing is read from the image'),'Prepaid and accrued expenses':('F','tests, browser'),'Custom fields, form styles':('P','fields tested; invoice wording only, no layouts or logo'),'QuickBooks migration':('P','lists and open invoices and bills; no history or direct connection'),'Text defects':('F','browser'),
}
W={'F':1,'P':.5,'I':.25,'N':.4,'D':.5,'M':0}
rows=[l.rstrip('\n').split('|') for l in open('evidence/matrix.txt') if l.strip() and l[0]!='#']
assert not set(NEW)-{r[1] for r in rows}, set(NEW)-{r[1] for r in rows}
def sc(rs,new):
    v=[(NEW.get(r[1],(r[4],))[0] if new else r[4]) for r in rs]; v=[x for x in v if x in W]
    return round(100*sum(W[x] for x in v)/len(v)), sum(x=='F' for x in v), len(v), sum(x=='M' for x in v)
qbo=lambda r: not r[2].startswith(('n/a','Vendor','Not in QBO','Not standard'))
by=collections.OrderedDict()
for r in rows: by.setdefault(r[0],[]).append(r)
out=[]
for m,rs in by.items():
    a,b=sc(rs,0),sc(rs,1); out.append(f'| {m} | {a[0]}% | **{b[0]}%** | {b[1]} of {b[2]} | {b[3]} |')
q=[r for r in rows if qbo(r)]; a,b=sc(q,0),sc(q,1)
out.append(f'| **QuickBooks-type features** | {a[0]}% | **{b[0]}%** | {b[1]} of {b[2]} | {b[3]} |')
core=[r for r in q if r[0] in('Core accounting','Sales and receivables','Purchases and payables','Banking','Inventory','Expenses and income','Reporting')]
a,b=sc(core,0),sc(core,1); out.append(f'| **Daily accounting only** | {a[0]}% | **{b[0]}%** | {b[1]} of {b[2]} | {b[3]} |')
print('\n'.join(out))
left=[(r[0],r[1],NEW.get(r[1],(r[4],))[0]) for r in rows if NEW.get(r[1],(r[4],))[0] in 'PMNDI' ]
print(*left,sep='\n')
open('QUICKBOOKS_COMPARISON_MAIN.md','w').write('# QuickBooks comparison on feat/quickbooks-gaps, 25 November 2026\n\nSame features and weights as the audit: tested 100, partial or duplicated 50, untested 40, missing 0, incorrect 25. The weights are a judgement and every feature counts equally. Rerun `python3 evidence/rescore.py` from this folder.\n\n| Area | Audit (6438570) | Main now | Tested | Missing |\n|---|---|---|---|---|\n'+'\n'.join(out)+'\n\n## Not yet complete\n| Area | Feature | Status |\n|---|---|---|\n'+'\n'.join(f'| {x} | {y} | { {"P":"Partial","M":"Missing","N":"Not tested","D":"Duplicated","I":"Incorrect"}[z]} |' for x,y,z in left)+'\n')
