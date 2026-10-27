import { useState, useEffect, useRef } from "react";
import {
  Menu,
  User,
  LogOut,
  ChevronDown,
  ArrowLeft,
  Search,
} from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { BranchSelector } from "./BranchSelector";

import { apiClient } from "../lib/api-client";
import { Link, useNavigate } from "react-router-dom";
import NotificationBell from "./NotificationBell";
import { OrganizationSwitcher } from "./OrganizationSwitcher";
import { useAuth } from "../context/AuthContext";
import { useOrganization } from "../context/OrganizationContext";
import { useTranslation } from 'react-i18next';
import { cn } from "../lib/utils";
import { VsdcPresenceIndicator } from "./VsdcPresenceIndicator";

/* ─── Types ─────────────────────────────────────────── */

type Profile = {
  id: string;
  name: string;
  email: string;
  role: string;
  profileImage?: string;
};

interface HeaderProps {
  onMenuClick: () => void;
  onOpenSearch?: () => void;
}

/* ─── Component ─────────────────────────────────────── */

export function Header({ onMenuClick, onOpenSearch }: HeaderProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isSystemOwner } = useAuth();
  const { organization } = useOrganization();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const handleLogout = () => {
    apiClient.logout();
    window.location.href = '/';
  };

  useEffect(() => {
    apiClient.profile()
      .then(data => setProfile(data as Profile))
      .catch(() => { /* silent — user can still navigate */ });
  }, []);

  /* Close user menu on outside click */
  useEffect(() => {
    if (!userMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [userMenuOpen]);

  return (
    <header className="dashboard-chrome sticky top-0 z-30 flex h-14 shrink-0 items-center border-b px-4 lg:px-6">
      {/* Mobile menu trigger */}
      <button
        type="button"
        className="lg:hidden rounded-lg p-2 text-white transition-colors hover:bg-white/10"
        onClick={onMenuClick}
        aria-label="Open navigation menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Back button */}
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="group ml-2 flex items-center gap-2 rounded-lg p-2 text-white transition-colors hover:bg-white/10 lg:ml-0"
        title={t('common.back')}
      >
        <ArrowLeft className="h-5 w-5 transition-transform group-hover:-translate-x-0.5" />
        <span className="hidden text-sm font-medium sm:inline">{t('common.back')}</span>
      </button>

      {/* Search Bar matching mockup */}
      <div className="hidden md:flex items-center flex-1 max-w-md mx-4">
        <button
          type="button"
          onClick={onOpenSearch}
          className="w-full flex items-center justify-between px-3.5 py-1.5 bg-white/10 hover:bg-white/15 text-slate-200 text-xs rounded-xl border border-white/10 transition-colors shadow-inner"
        >
          <div className="flex items-center gap-2">
            <Search className="h-3.5 w-3.5 text-slate-300" />
            <span>Search anything...</span>
          </div>
          <kbd className="px-1.5 py-0.5 text-[10px] font-semibold text-slate-300 bg-white/15 rounded border border-white/20">
            Ctrl + K
          </kbd>
        </button>
      </div>

      {/* Right side controls */}
      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        {!isSystemOwner() && (
          <BranchSelector toolbar />
        )}

        {isSystemOwner() && organization && (
          <OrganizationSwitcher toolbar />
        )}

        <div className="hidden items-center gap-2 sm:flex">
          <VsdcPresenceIndicator />
          <ThemeToggle className="text-white hover:bg-white/10 hover:text-white" />
          <LanguageSwitcher toolbar />
          <NotificationBell toolbar />
        </div>

        {/* User profile dropdown */}
        <div ref={userMenuRef} className="relative ml-1 sm:ml-2">
          <button
            type="button"
            onClick={() => setUserMenuOpen(prev => !prev)}
            className="flex items-center gap-2 rounded-lg p-1.5 text-white transition-colors hover:bg-white/10"
            aria-expanded={userMenuOpen}
            aria-haspopup="true"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20 text-sm font-medium text-white ring-2 ring-white/30">
              {profile?.profileImage ? (
                <img
                  src={profile.profileImage}
                  alt={profile.name}
                  className="h-8 w-8 rounded-full object-cover"
                />
              ) : (
                profile?.name?.charAt(0)?.toUpperCase() || 'U'
              )}
            </div>
            <span className="hidden text-sm font-medium text-white sm:inline">
              {profile?.name || t('common.user')}
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 text-slate-300 transition-transform duration-200",
                userMenuOpen && "rotate-180",
              )}
            />
          </button>

          {userMenuOpen && (
            <div
              className={cn(
                "absolute right-0 mt-2 w-56 overflow-hidden rounded-lg border border-gray-200/50 bg-white/95 shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-200 dark:border-gray-700/50 dark:bg-gray-800/95",
              )}
            >
              <div className="border-b border-gray-200/50 bg-gradient-to-br from-gray-50/50 to-transparent px-4 py-3 dark:border-gray-700/50 dark:from-gray-700/30 dark:to-transparent">
                <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                  {profile?.name || t('common.user')}
                </p>
                <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                  {profile?.role || ''}
                </p>
              </div>

              <Link
                to="/dashboard/profile"
                onClick={() => setUserMenuOpen(false)}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                <User className="h-4 w-4" />
                {t('nav.profile')}
              </Link>

              <div className="border-t border-gray-200/50 dark:border-gray-700/50" />

              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                <LogOut className="h-4 w-4" />
                {t('nav.logout')}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
