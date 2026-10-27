import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useBranch } from '../context/BranchContext';
import { useAuth } from '../context/AuthContext';
import {
  ChevronDown,
  Layers,
  Building,
  Search,
  X,
  Lock,
  Check,
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Skeleton } from './ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';

/* ─── Types ─────────────────────────────────────────── */

interface Branch {
  id: number;
  name: string;
  code: string;
  location?: string;
  isPrimary?: boolean;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
}

interface BranchSelectorProps {
  /** Render in the header chrome (light text on dark bg) vs. inside page content */
  toolbar?: boolean;
}

/* ─── Status helpers ────────────────────────────────── */

const STATUS_DOT: Record<string, string> = {
  ACTIVE: 'bg-emerald-500',
  INACTIVE: 'bg-slate-400',
  SUSPENDED: 'bg-red-500',
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  SUSPENDED: 'Suspended',
};

/* ─── Component ─────────────────────────────────────── */

export const BranchSelector: React.FC<BranchSelectorProps> = ({ toolbar = false }) => {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState('');
  const [open, setOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const {
    userBranches,
    selectedBranchId,
    setSelectedBranch,
    loading,
    canAccessAllBranches,
  } = useBranch();
  const { user } = useAuth();

  // Sellers/Cashiers must always see only their assigned branch — never an
  // interactive switcher, even in the unusual case they have more than one
  // branch assigned (that's reserved for Store Managers/Admins).
  const isSingleBranchRole = user?.role === 'SELLER' || user?.role === 'ACCOUNTANT';

  /* Auto-focus search when dropdown opens */
  useEffect(() => {
    if (open) {
      /* small RAF to let the DOM paint the dropdown first */
      requestAnimationFrame(() => searchRef.current?.focus());
    } else {
      /* reset search on close */
      const timer = setTimeout(() => setSearchTerm(''), 150);
      return () => clearTimeout(timer);
    }
  }, [open]);

  /* ── Derived state ──────────────────────────────────── */

  const isRestricted =
    !loading &&
    userBranches.length > 0 &&
    !canAccessAllBranches &&
    (userBranches.length <= 1 || isSingleBranchRole);

  const selectedBranch: Branch | undefined = selectedBranchId !== null
    ? userBranches.find(b => b.id === selectedBranchId)
    : undefined;

  const isAllBranchesMode = selectedBranchId === null;

  const filteredBranches = userBranches.filter(b =>
    b.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    b.code.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const triggerLabel = isAllBranchesMode
    ? (t('common.all_branches') || 'All Branches') + (userBranches.length > 0 ? ` (${userBranches.length})` : '')
    : selectedBranch?.name ?? 'Select Branch';

  /* ── Handlers ────────────────────────────────────────── */

  const handleBranchChange = useCallback(
    (value: string) => {
      if (value === 'all') {
        setSelectedBranch(null);
      } else {
        setSelectedBranch(Number(value));
      }
      setOpen(false);
    },
    [setSelectedBranch],
  );

  /* ── Loading skeleton ────────────────────────────────── */

  if (loading) {
    return (
      <div className={cn('flex items-center gap-2', toolbar ? 'h-9' : 'h-11')}>
        <Skeleton className={cn('h-full rounded-md', toolbar ? 'w-[140px]' : 'w-[180px]')} />
      </div>
    );
  }

  /* ── Empty state ─────────────────────────────────────── */

  if (userBranches.length === 0) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled
            className={cn(
              'pointer-events-none opacity-50',
              toolbar
                ? 'h-9 border-white/25 bg-white/10 text-white'
                : 'h-11 border-gray-200 bg-white text-gray-400',
            )}
          >
            <X className="mr-1.5 h-3.5 w-3.5 shrink-0" />
            <span className="text-sm">No branches</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>No branches assigned to your account</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  /* ── Restricted / locked state ────────────────────────── */

  if (isRestricted && selectedBranch) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              'pointer-events-none cursor-default',
              toolbar
                ? 'h-9 border-white/20 bg-white/5 text-white/80'
                : 'h-11 border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
            )}
          >
            <Lock className="mr-1.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
            <span className="max-w-[120px] truncate text-sm font-medium">
              {selectedBranch.name}
            </span>
            {selectedBranch.isPrimary && (
              <span className="ml-1.5 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
                PRIMARY
              </span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="flex items-start gap-2">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
            <div>
              <p className="font-medium">Branch access locked</p>
              <p className="text-muted-foreground mt-0.5">
                Your access is restricted to <strong>{selectedBranch.name}</strong>.
                Contact your administrator to change branch permissions.
              </p>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  /* ── Normal (interactive) state ───────────────────────── */

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'group h-11 min-w-0 px-3 font-medium transition-all',
            toolbar
              ? 'border-white/25 bg-white/10 text-white shadow-none hover:bg-white/15'
              : 'border-gray-200 bg-white text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700',
          )}
        >
          {/* Selection indicator dot */}
          <span
            className={cn(
              'h-2 w-2 shrink-0 rounded-full',
              isAllBranchesMode
                ? 'bg-violet-500'
                : STATUS_DOT[selectedBranch?.status ?? 'ACTIVE'],
            )}
            aria-hidden="true"
          />

          <span className="mx-1.5 truncate text-sm font-semibold">
            {triggerLabel}
          </span>

          {/* Badge pill */}
          {isAllBranchesMode && (
            <span className="mr-1 rounded-full bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-bold text-violet-200">
              ALL
            </span>
          )}
          {!isAllBranchesMode && selectedBranch?.isPrimary && (
            <span className="mr-1 rounded-full bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-bold text-blue-200">
              PRIMARY
            </span>
          )}

          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 transition-transform duration-200',
              open && 'rotate-180',
              toolbar
                ? 'text-slate-400 group-hover:text-white'
                : 'text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-200',
            )}
          />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="w-[300px] overflow-hidden p-0"
        sideOffset={6}
      >
        {/* ── Search input ─────────────────────────────── */}
        <div className="border-b border-gray-100 p-2 dark:border-gray-800">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              ref={searchRef}
              placeholder="Search by name or code..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="h-11 pl-9 text-sm"
              onClick={e => e.stopPropagation()}
              onKeyDown={e => e.stopPropagation()}
            />
            {searchTerm && (
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  setSearchTerm('');
                  searchRef.current?.focus();
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* ── Branch list ──────────────────────────────── */}
        <div className="max-h-[320px] overflow-y-auto p-1">
          <DropdownMenuLabel className="sticky top-0 z-10 bg-white px-2 py-2 text-[10px] font-black uppercase tracking-widest text-gray-400 dark:bg-gray-950">
            {t('common.select_branch') || 'Select Branch'}
          </DropdownMenuLabel>

          {filteredBranches.length === 0 && (
            <div className="flex flex-col items-center px-4 py-10 text-center">
              <Building className="mb-2 h-8 w-8 text-gray-200 dark:text-gray-800" />
              <p className="text-body-sm text-gray-500">
                No branches matching{' '}
                <span className="font-medium">&ldquo;{searchTerm}&rdquo;</span>
              </p>
            </div>
          )}

          <DropdownMenuRadioGroup
            value={selectedBranchId?.toString() || 'all'}
            onValueChange={handleBranchChange}
          >
            {/* "All Branches" — only for users with cross-branch access */}
            {canAccessAllBranches && (
              <DropdownMenuRadioItem
                value="all"
                className="flex items-center gap-3 py-3 pl-3 pr-2 focus:bg-violet-50 dark:focus:bg-violet-900/20"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400">
                  <Layers className="h-4 w-4" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                      All Branches
                    </span>
                    <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                      ALL
                    </span>
                  </div>
                  <span className="text-caption text-gray-500">
                    Aggregate data across {userBranches.length} branches
                  </span>
                </div>
                {isAllBranchesMode && (
                  <Check className="h-4 w-4 shrink-0 text-violet-600" />
                )}
              </DropdownMenuRadioItem>
            )}

            {/* Individual branches */}
            {filteredBranches.map(branch => {
              const isSelected = selectedBranchId === branch.id;
              return (
                <DropdownMenuRadioItem
                  key={branch.id}
                  value={branch.id.toString()}
                  className={cn(
                    'flex items-center gap-3 py-3 pl-3 pr-2',
                    isSelected
                      ? 'bg-blue-50 focus:bg-blue-50 dark:bg-blue-900/10 dark:focus:bg-blue-900/10'
                      : 'focus:bg-gray-50 dark:focus:bg-gray-800',
                  )}
                >
                  {/* Status dot + icon area */}
                  <div
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                      branch.status === 'ACTIVE'
                        ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'
                        : branch.status === 'SUSPENDED'
                          ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                          : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
                    )}
                  >
                    <Building className="h-4 w-4" />
                  </div>

                  {/* Branch info */}
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                        {branch.name}
                      </span>
                      {branch.isPrimary && (
                        <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                          PRIMARY
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-caption text-gray-500">
                      <span>Code: {branch.code}</span>
                      {branch.location && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{branch.location}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Status indicator */}
                  <span
                    className={cn(
                      'h-2 w-2 shrink-0 rounded-full',
                      STATUS_DOT[branch.status],
                    )}
                    title={STATUS_LABEL[branch.status]}
                    aria-label={`Status: ${STATUS_LABEL[branch.status]}`}
                  />

                  {isSelected && (
                    <Check className="h-4 w-4 shrink-0 text-blue-600" />
                  )}
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default BranchSelector;
