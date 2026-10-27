import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Clock, Loader2, Smartphone, Wallet, CheckCircle2, Lock } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../../components/ui/card';
import { apiClient } from '../../../lib/api-client';
import { useBranch } from '../../../context/BranchContext';
import { useAuth } from '../../../context/AuthContext';

interface Shift {
  id: number;
  organizationId: number;
  branchId: number;
  userId: number;
  deviceId?: number | null;
  openingFloat: number;
  openingMobileMoney?: number | null;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt?: string | null;
  expectedCash?: number | null;
  actualCash?: number | null;
  difference?: number | null;
  closingNotes?: string | null;
}

interface ShiftSummary {
  openingFloat: number;
  openingMobileMoney: number;
  grossSales: number;
  cashSales: number;
  mobileMoneySales: number;
  cardSales: number;
  creditSales: number;
  returns: number;
  discounts: number;
  expectedCash: number;
  expectedMobileMoney: number;
}

function money(value: number | null | undefined) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value ?? 0));
}

function formatDigits(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits ? Number(digits).toLocaleString('en-US') : '';
}

export function OpenShiftPage() {
  const { user } = useAuth();
  const { userBranches, loading: branchesLoading, selectedBranchId, setSelectedBranch } = useBranch();

  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [summary, setSummary] = useState<ShiftSummary | null>(null);

  const [branchId, setBranchId] = useState<number | null>(selectedBranchId);
  const [openingCash, setOpeningCash] = useState('100,000');
  const [openingMobileMoney, setOpeningMobileMoney] = useState('0');
  const [actualCash, setActualCash] = useState('');

  const loadShift = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let shift: Shift | null = null;
      try {
        shift = await apiClient.getActiveShift();
      } catch (requestError: any) {
        if (requestError?.response?.status !== 404) throw requestError;
      }
      setActiveShift(shift);
      if (shift) {
        const result = await apiClient.getShiftSummary(shift.id);
        setSummary(result.summary ?? null);
      } else {
        setSummary(null);
      }
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error ?? requestError?.message ?? 'Failed to load shift status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadShift();
  }, [loadShift]);

  useEffect(() => {
    if (selectedBranchId) setBranchId(selectedBranchId);
  }, [selectedBranchId]);

  const cashValue = Number(openingCash.replace(/,/g, '')) || 0;
  const mobileValue = Number(openingMobileMoney.replace(/,/g, '')) || 0;

  const handleOpen = async () => {
    if (!branchId) {
      setError('Select the branch where you are working.');
      return;
    }
    setOpening(true);
    setError(null);
    try {
      const shift = await apiClient.openShift({
        openingFloat: Math.max(0, cashValue),
        openingMobileMoney: Math.max(0, mobileValue),
        branchId,
      });
      setActiveShift(shift);
      setSelectedBranch(shift.branchId);
      toast.success(`Shift #${shift.id} opened`);
      const result = await apiClient.getShiftSummary(shift.id);
      setSummary(result.summary ?? null);
    } catch (requestError: any) {
      const message = requestError?.response?.data?.error ?? requestError?.message ?? 'Failed to open shift.';
      setError(message);
      toast.error(message);
    } finally {
      setOpening(false);
    }
  };

  const handleClose = async () => {
    if (!activeShift) return;
    const actual = Number(actualCash) || 0;
    if (actualCash.trim() === '' || actual < 0) {
      setError('Count the till and enter the actual cash amount.');
      return;
    }
    setClosing(true);
    setError(null);
    try {
      await apiClient.closeShift(activeShift.id, { actualCash: actual });
      toast.success(`Shift #${activeShift.id} closed`);
      setActiveShift(null);
      setSummary(null);
      setActualCash('');
    } catch (requestError: any) {
      const message = requestError?.response?.data?.error ?? requestError?.message ?? 'Failed to close shift.';
      setError(message);
      toast.error(message);
    } finally {
      setClosing(false);
    }
  };

  const activeBranch = userBranches.find((b) => b.id === (activeShift?.branchId ?? branchId));

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Page header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 p-6 text-white shadow-lg">
        <div className="pointer-events-none absolute inset-0 bg-black/10" />
        <div className="relative z-10 flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
            <Clock className="h-7 w-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Open Shift</h1>
            <p className="mt-0.5 text-sm text-white/70">
              Open or close a shift to start tracking sales for the day.
            </p>
          </div>
        </div>
        <div className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -right-4 -bottom-12 h-56 w-56 rounded-full bg-white/5" />
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {activeShift ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <CardTitle>Shift is open</CardTitle>
            </div>
            <CardDescription>
              Shift #{activeShift.id} · {activeBranch?.name ?? `Branch #${activeShift.branchId}`} · Opened{' '}
              {new Date(activeShift.openedAt).toLocaleString()}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {summary && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg bg-gray-50 p-3">
                  <p className="text-xs font-medium text-gray-500">Opening Cash</p>
                  <p className="mt-1 text-lg font-bold text-gray-900">{money(summary.openingFloat)} RWF</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-3">
                  <p className="text-xs font-medium text-gray-500">Opening Mobile Money</p>
                  <p className="mt-1 text-lg font-bold text-gray-900">{money(summary.openingMobileMoney)} RWF</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-3">
                  <p className="text-xs font-medium text-gray-500">Cash Sales</p>
                  <p className="mt-1 text-lg font-bold text-gray-900">{money(summary.cashSales)} RWF</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-3">
                  <p className="text-xs font-medium text-gray-500">Mobile Money Sales</p>
                  <p className="mt-1 text-lg font-bold text-gray-900">{money(summary.mobileMoneySales)} RWF</p>
                </div>
                <div className="rounded-lg bg-emerald-50 p-3">
                  <p className="text-xs font-medium text-emerald-600">Expected Cash</p>
                  <p className="mt-1 text-lg font-bold text-emerald-700">{money(summary.expectedCash)} RWF</p>
                </div>
                <div className="rounded-lg bg-emerald-50 p-3">
                  <p className="text-xs font-medium text-emerald-600">Expected Mobile Money</p>
                  <p className="mt-1 text-lg font-bold text-emerald-700">{money(summary.expectedMobileMoney)} RWF</p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 rounded-lg border border-gray-200 p-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="actual-cash">Actual Cash (RWF)</Label>
                <Input
                  id="actual-cash"
                  value={actualCash}
                  onChange={(e) => setActualCash(e.target.value.replace(/[^\d.]/g, ''))}
                  placeholder="Enter actual cash count"
                  inputMode="decimal"
                />
              </div>
              <div className="flex items-end">
                <Button onClick={handleClose} disabled={closing || actualCash.trim() === ''} className="w-full bg-emerald-600 hover:bg-emerald-700">
                  {closing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                  {closing ? 'Closing…' : 'Close Shift'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Start your shift</CardTitle>
            <CardDescription>Enter the opening balances for the till before you start selling.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Branch</Label>
                <Select
                  value={branchId ? String(branchId) : undefined}
                  onValueChange={(v) => setBranchId(Number(v))}
                  disabled={branchesLoading}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={branchesLoading ? 'Loading branches…' : 'Select branch'} />
                  </SelectTrigger>
                  <SelectContent>
                    {userBranches.map((branch) => (
                      <SelectItem key={branch.id} value={String(branch.id)}>
                        {branch.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Cashier</Label>
                <Input value={user?.name ?? ''} readOnly className="bg-gray-50" />
              </div>

              <div className="space-y-2">
                <Label>POS / Terminal</Label>
                <Input value="Web POS" readOnly className="bg-gray-50" />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 rounded-lg border border-gray-200 bg-gray-50/50 p-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-emerald-600" />
                  Opening Cash (RWF)
                </Label>
                <Input
                  value={openingCash}
                  onChange={(e) => setOpeningCash(formatDigits(e.target.value))}
                  placeholder="0"
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Smartphone className="h-4 w-4 text-emerald-600" />
                  Opening Mobile Money (RWF)
                </Label>
                <Input
                  value={openingMobileMoney}
                  onChange={(e) => setOpeningMobileMoney(formatDigits(e.target.value))}
                  placeholder="0"
                  inputMode="numeric"
                />
              </div>
            </div>

            <Button
              onClick={handleOpen}
              disabled={!branchId || opening}
              className="w-full bg-emerald-600 hover:bg-emerald-700 sm:w-auto"
              size="lg"
            >
              {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {opening ? 'Opening…' : 'Open Shift'}
            </Button>
            {!branchId && (
              <p className="text-sm text-gray-500">
                {userBranches.length === 0 ? 'No branch is assigned to your account yet.' : 'Select the branch where you are working.'}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default OpenShiftPage;