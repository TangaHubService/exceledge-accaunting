import { useEffect, useState, useCallback } from 'react';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { RefreshCw, AlertTriangle, CheckCircle, Clock, XCircle, ExternalLink, Loader2, Save, ShieldCheck, RotateCcw } from 'lucide-react';
import { OUTBOX_STATUS_CONFIG, type EbmOutboxEntry, type EbmOutboxStatus } from '../../../types/ebm';
import { apiClient } from '../../../lib/api-client';
import type { Branch } from '../../../context/BranchContext';
import ConfirmDialog from '../../../components/common/ConfirmDialog';
import { toast } from 'react-toastify';

type GroupedCounts = Record<EbmOutboxStatus, number>;

interface EbmCredForm {
  bhfId?: string | null;
  ebmDeviceId?: string | null;
  ebmSerialNo?: string | null;
  mrcNo?: string | null;
  vsdcUrl?: string | null;
}

const CRED_PAGE_SIZES = [5, 8, 10, 25];

function EbmCredentialsCard() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<number | ''>('');
  const [orgTin, setOrgTin] = useState('');
  const [form, setForm] = useState<EbmCredForm>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [credPage, setCredPage] = useState(1);
  const [credPageSize, setCredPageSize] = useState(8);
  const [initializing, setInitializing] = useState(false);
  const [initInfo, setInitInfo] = useState<any>(null);

  const applyBranch = (branch: Branch) => {
    setForm({
      bhfId: branch.bhfId ?? '',
      ebmDeviceId: branch.ebmDeviceId ?? '',
      ebmSerialNo: branch.ebmSerialNo ?? '',
      mrcNo: branch.mrcNo ?? '',
      vsdcUrl: branch.vsdcUrl ?? '',
    });
  };

  const load = useCallback(async () => {
    setLoading(true);
    const orgId = localStorage.getItem('current_organization_id');
    try {
      const res = await apiClient.getBranches(true);
      const list = Array.isArray(res) ? res : res?.data || [];
      setBranches(list);
      if (list.length > 0) {
        setBranchId(list[0].id);
        applyBranch(list[0]);
      }
    } catch (e) {
      console.error('Failed to load branches for EBM config', e);
    }
    if (orgId) {
      try {
        const res = await apiClient.getOrganization(orgId);
        const org = res?.organization ?? res?.data?.organization ?? res?.data ?? res;
        setOrgTin(org?.TIN ?? org?.tin ?? '');
      } catch (e) {
        console.error('Failed to load organization for EBM config', e);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const set = (key: keyof EbmCredForm, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    setSavedMsg(null);
    setErrorMsg(null);
    const mrc = (form.mrcNo ?? '').trim();
    if (mrc && !/^[A-Za-z0-9]{11}$/.test(mrc)) {
      setErrorMsg(`MRC must be exactly 11 letters or digits (you entered ${mrc.length}).`);
      return;
    }
    setSaving(true);
    try {
      if (orgTin.trim()) await apiClient.updateOrganization({ TIN: orgTin.trim() });
      if (branchId !== '') {
        await apiClient.updateBranch(branchId, {
          bhfId: (form.bhfId ?? '').trim(),
          ebmDeviceId: (form.ebmDeviceId ?? '').trim(),
          ebmSerialNo: (form.ebmSerialNo ?? '').trim(),
          mrcNo: (form.mrcNo ?? '').trim().toUpperCase(),
          vsdcUrl: (form.vsdcUrl ?? '').trim(),
        });
      }
      setSavedMsg('EBM / VSDC credentials saved.');
    } catch (e: any) {
      setErrorMsg(
        (e?.response?.data?.code === 'INVALID_MRC_FORMAT'
          ? 'Invalid MRC. It must be 11 characters: BBBCCNNNNNN (3 developer + 2 certificate characters, then a 6-digit serial).'
          : null) ||
        e?.message ||
          e?.response?.data?.error ||
          e?.response?.data?.message ||
          'Failed to save EBM credentials.',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleInitialize = async () => {
    setInitializing(true);
    setInitInfo(null);
    setErrorMsg(null);
    try {
      const res = await apiClient.initializeEbmDevice(
        branchId !== '' ? { branchId: Number(branchId) } : {},
      );
      const info = (res as any)?.data ?? res;
      setInitInfo(info);
      setSavedMsg(`Device verified with RRA — SDC ${info?.sdcId ?? '?'} / MRC ${info?.mrcNo ?? '?'}.`);
      if (info?.mrcWarning) setErrorMsg(info.mrcWarning);
      await load();
    } catch (e: any) {
      setErrorMsg(e?.message || e?.response?.data?.error || 'Device initialization failed.');
    } finally {
      setInitializing(false);
    }
  };

  const credPageCount = Math.max(1, Math.ceil(branches.length / credPageSize));
  const credPageSafe = Math.min(credPage, credPageCount);
  const credPageRows = branches.slice(
    (credPageSafe - 1) * credPageSize,
    credPageSafe * credPageSize,
  );

  const changeCredPageSize = (value: string) => {
    setCredPageSize(Number(value));
    setCredPage(1);
  };

  const editBranchCredentials = (branch: Branch) => {
    setBranchId(branch.id);
    applyBranch(branch);
  };

  return (
    <Card>
      <CardHeader className="p-5 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-blue-600" />
          EBM / VSDC Credentials
        </CardTitle>
        <CardDescription className="text-sm">
          Organization TIN and per-branch device credentials sent to the RRA VSDC gateway.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-5 pt-2 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Organization TIN</Label>
            <Input
              value={orgTin}
              onChange={(e) => setOrgTin(e.target.value)}
              placeholder="e.g. 999945560"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Branch</Label>
            <Select
              value={branchId === '' ? undefined : String(branchId)}
              onValueChange={(v) => {
                const id = Number(v);
                setBranchId(id);
                const b = branches.find((x) => x.id === id);
                if (b) applyBranch(b);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a branch" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={String(b.id)}>
                    {b.name} ({b.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>bhfId (branch code)</Label>
            <Input
              value={form.bhfId ?? ''}
              onChange={(e) => set('bhfId', e.target.value)}
              placeholder="e.g. 00"
            />
          </div>

          <div className="space-y-1.5">
            <Label>dvcSrlNo (device serial)</Label>
            <Input
              value={form.ebmSerialNo ?? ''}
              onChange={(e) => set('ebmSerialNo', e.target.value)}
              placeholder="e.g. excelwartest"
            />
          </div>

          <div className="space-y-1.5">
            <Label>MRC (Machine Registration Code)</Label>
            <Input
              value={form.mrcNo ?? ''}
              onChange={(e) => set('mrcNo', e.target.value.toUpperCase())}
              placeholder="e.g. WIS01029467"
              minLength={11}
              maxLength={11}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Exactly 11 characters ({(form.mrcNo ?? '').trim().length}/11): BBBCCNNNNNN — 3 developer + 2 certificate characters, then a 6-digit serial. Printed on every receipt of this device.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>sdcId (device ID)</Label>
            <Input
              value={form.ebmDeviceId ?? ''}
              onChange={(e) => set('ebmDeviceId', e.target.value)}
              placeholder="VSDC device ID from RRA, if provided"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Per-branch VSDC URL (optional)</Label>
            <Input
              value={form.vsdcUrl ?? ''}
              onChange={(e) => set('vsdcUrl', e.target.value)}
              placeholder="Defaults to EBM_API_URL"
            />
          </div>
        </div>

        {branches.length > 0 && (
          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Per-branch device credentials</p>
              <p className="text-xs text-muted-foreground">
                {branches.length} branch{branches.length === 1 ? '' : 'es'}
              </p>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Branch</TableHead>
                    <TableHead>bhfId</TableHead>
                    <TableHead>dvcSrlNo</TableHead>
                    <TableHead>MRC</TableHead>
                    <TableHead>sdcId</TableHead>
                    <TableHead>VSDC URL</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {credPageRows.map((branch) => (
                    <TableRow key={branch.id}>
                      <TableCell className="font-medium">
                        {branch.name}
                        <span className="ml-1 text-xs text-muted-foreground">({branch.code})</span>
                      </TableCell>
                      <TableCell>{branch.bhfId || '—'}</TableCell>
                      <TableCell>{branch.ebmSerialNo || '—'}</TableCell>
                      <TableCell className="font-mono">{branch.mrcNo || '—'}</TableCell>
                      <TableCell>{branch.ebmDeviceId || '—'}</TableCell>
                      <TableCell className="max-w-[180px] truncate">{branch.vsdcUrl || '—'}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => editBranchCredentials(branch)}
                        >
                          Edit
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground whitespace-nowrap">Rows per page</span>
                <Select value={String(credPageSize)} onValueChange={changeCredPageSize}>
                  <SelectTrigger className="h-8 w-[76px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CRED_PAGE_SIZES.map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                Page {credPageSafe} of {credPageCount} · {branches.length} branches
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={credPageSafe <= 1}
                  onClick={() => setCredPage(credPageSafe - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={credPageSafe >= credPageCount}
                  onClick={() => setCredPage(credPageSafe + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        )}

        {loading && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading credentials…
          </p>
        )}

        {errorMsg && (
          <p className="text-xs text-red-600 font-medium">{errorMsg}</p>
        )}
        {savedMsg && (
          <p className="text-xs text-green-600 font-medium flex items-center gap-1">
            <CheckCircle className="h-3 w-3" /> {savedMsg}
          </p>
        )}

        {initInfo && (
          <div className="rounded-lg border bg-muted/40 p-3 text-xs space-y-0.5">
            <p className="font-medium text-foreground">RRA device initialization</p>
            {initInfo.taxpayer && <p>Taxpayer: {initInfo.taxpayer}{initInfo.branch ? ` · ${initInfo.branch}` : ''}</p>}
            <p>SDC ID: <span className="font-mono">{initInfo.sdcId ?? '—'}</span> · MRC: <span className="font-mono">{initInfo.mrcNo ?? '—'}</span>{initInfo.dvcId ? <> · Device: <span className="font-mono">{initInfo.dvcId}</span></> : null}</p>
            <p>RRA last invoice #: {initInfo.lastInvoiceNo ?? 0} · last receipt #: {initInfo.lastReceiptNo ?? 0}{initInfo.seededCounterTo ? ` · local counter seeded to ${initInfo.seededCounterTo}` : ''}</p>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={handleInitialize} disabled={initializing || loading || branchId === ''}>
            {initializing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
            Initialize with RRA
          </Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save Credentials
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function EbmOutboxDashboard() {
  const [entries, setEntries] = useState<EbmOutboxEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingId, setCheckingId] = useState<number | null>(null);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [reversalEntry, setReversalEntry] = useState<EbmOutboxEntry | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const fetchOutbox = useCallback(async () => {
    setLoading(true);
    try {
      const orgId = apiClient.getOrganizationId();
      const res = await apiClient.request(`/organizations/${orgId}/ebm-outbox`);
      setEntries(Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : []);
    } catch {
      console.error('Failed to fetch EBM outbox');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchOutbox(); }, [fetchOutbox]);

  const counts: GroupedCounts = {
    PENDING: entries.filter((e) => e.status === 'PENDING').length,
    PROCESSING: entries.filter((e) => e.status === 'PROCESSING').length,
    SUCCEEDED: entries.filter((e) => e.status === 'SUCCEEDED').length,
    FAILED: entries.filter((e) => e.status === 'FAILED').length,
    DEAD_LETTER: entries.filter((e) => e.status === 'DEAD_LETTER').length,
  };

  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
  const pageSafe = Math.min(page, pageCount);
  const pageRows = entries.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);

  const changePageSize = (value: string) => {
    const size = Number(value);
    setPageSize(size);
    setPage(1);
  };

  const handleStatusCheck = async (entry: EbmOutboxEntry) => {
    setCheckingId(entry.id);
    try {
      const orgId = apiClient.getOrganizationId();
      await apiClient.request(`/organizations/${orgId}/ebm-outbox/${entry.id}/check-status`, {
        method: 'POST',
        body: JSON.stringify({ idempotencyKey: entry.idempotencyKey }),
      });
      await fetchOutbox();
    } catch {
      console.error('Status check failed');
    } finally {
      setCheckingId(null);
    }
  };

  const handleRetry = async (entry: EbmOutboxEntry) => {
    setRetryingId(entry.id);
    try {
      const orgId = apiClient.getOrganizationId();
      await apiClient.request(`/organizations/${orgId}/ebm-outbox/${entry.id}/retry`, {
        method: 'POST',
      });
      toast.success('Re-queued for fiscalization');
      await fetchOutbox();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to retry fiscalization');
    } finally {
      setRetryingId(null);
    }
  };

  const getStatusBadge = (status: EbmOutboxStatus) => {
    const cfg = OUTBOX_STATUS_CONFIG[status];
    return (
      <Badge className={`${cfg.color} border text-xs px-2 py-0.5 rounded-full`} variant="outline">
        {cfg.label}
      </Badge>
    );
  };

  const getStatusIcon = (status: EbmOutboxStatus) => {
    switch (status) {
      case 'SUCCEEDED': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'FAILED': return <XCircle className="h-4 w-4 text-red-500" />;
      case 'DEAD_LETTER': return <AlertTriangle className="h-4 w-4 text-rose-500" />;
      case 'PROCESSING': return <Clock className="h-4 w-4 text-blue-500" />;
      default: return <Clock className="h-4 w-4 text-yellow-500" />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">EBM / VSDC Outbox Queue</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor fiscalisation status of all sales submitted to the RRA VSDC gateway
          </p>
        </div>
        <Button variant="outline" onClick={fetchOutbox} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* EBM Credentials Configuration */}
      <EbmCredentialsCard />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {Object.entries(counts).map(([status, count]) => {
          const cfg = OUTBOX_STATUS_CONFIG[status as EbmOutboxStatus];
          return (
            <Card key={status} className={cfg.color.split(' ').slice(-1)[0]}>
              <CardHeader className="p-4 pb-2">
                <CardTitle className={`text-sm font-medium ${cfg.color.split(' ')[0]}`}>
                  {cfg.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <p className={`text-3xl font-bold ${cfg.color.split(' ')[0]}`}>{count as number}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <CheckCircle className="h-10 w-10 mb-2 text-green-400" />
              <p>No outbox entries. All sales are fiscalised.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sale #</TableHead>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Retries</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Error / Note</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="font-mono text-xs">
                        {entry.sale?.saleNumber ?? `#${entry.saleId}`}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {entry.sale?.invoiceNumber ?? '—'}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {entry.sale ? `${Number(entry.sale.totalAmount).toLocaleString()} RWF` : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {getStatusIcon(entry.status)}
                          {getStatusBadge(entry.status)}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        {entry.retryCount}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : '—'}
                      </TableCell>
                      <TableCell className="text-xs max-w-[240px]" title={entry.lastError ?? ''}>
                        {entry.status === 'DEAD_LETTER' ? (
                          <div className="space-y-0.5">
                            <span className="text-rose-600 font-semibold flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3 shrink-0" />
                              UN-FISCALIZED
                            </span>
                            {entry.lastError && (
                              <p className="text-muted-foreground truncate">{entry.lastError}</p>
                            )}
                          </div>
                        ) : entry.status === 'FAILED' || entry.status === 'PROCESSING' ? (
                          <span className="truncate block">{entry.lastError ?? '—'}</span>
                        ) : entry.sdcDateTime ? (
                          <span className="text-green-600">SDC: {new Date(entry.sdcDateTime).toLocaleString()}</span>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          {(entry.status === 'PENDING' || entry.status === 'PROCESSING' || entry.status === 'FAILED') && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleStatusCheck(entry)}
                              disabled={checkingId === entry.id || retryingId === entry.id}
                            >
                              {checkingId === entry.id ? (
                                <Loader2 className="h-3 w-3 animate-spin mr-1" />
                              ) : (
                                <ExternalLink className="h-3 w-3 mr-1" />
                              )}
                              Check VSDC
                            </Button>
                          )}
                          {(entry.status === 'FAILED' || entry.status === 'DEAD_LETTER') && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleRetry(entry)}
                              disabled={retryingId === entry.id || checkingId === entry.id}
                            >
                              {retryingId === entry.id ? (
                                <Loader2 className="h-3 w-3 animate-spin mr-1" />
                              ) : (
                                <RotateCcw className="h-3 w-3 mr-1" />
                              )}
                              Retry
                            </Button>
                          )}
                          {entry.status === 'DEAD_LETTER' && (
                            <Button
                              variant="destructive"
                              size="sm"
                              className="bg-rose-600 hover:bg-rose-700 text-white"
                              onClick={() => setReversalEntry(entry)}
                            >
                              Request Reversal
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {entries.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground whitespace-nowrap">Rows per page</span>
                <Select value={String(pageSize)} onValueChange={changePageSize}>
                  <SelectTrigger className="h-8 w-[76px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 25, 50, 100].map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                Page {pageSafe} of {pageCount} · {entries.length} entries
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pageSafe <= 1}
                  onClick={() => setPage(pageSafe - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pageSafe >= pageCount}
                  onClick={() => setPage(pageSafe + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={reversalEntry !== null}
        onClose={() => setReversalEntry(null)}
        onConfirm={() => {
          if (reversalEntry) {
            toast.info(`Compensation flow requested for sale #${reversalEntry.saleId}: reverse inventory & customer balance`);
          }
          setReversalEntry(null);
        }}
        title="Request Reversal"
        message={reversalEntry
          ? `This will reverse inventory and customer balance for sale #${reversalEntry.saleId}. Continue?`
          : ''}
        confirmText="Confirm Reversal"
        variant="destructive"
      />
    </div>
  );
}
