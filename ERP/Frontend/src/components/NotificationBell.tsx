import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { apiClient } from '../lib/api-client';
import { toast } from 'react-toastify';
import { useNotificationSocket } from '../hooks/useNotificationSocket';
import { useTranslation } from 'react-i18next';

type Notification = {
  id: string;
  title: string;
  message: string;
  type?: string;
  data?: Record<string, any>;
  isRead: boolean;
  createdAt: string;
};

export default function NotificationBell({ toolbar = false }: { toolbar?: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const mounted = useRef(true);

  const getNotificationLink = (n: Notification): string | null => {
    if (n.type === 'WARNING' || n.type === 'ALERT') return '/dashboard/low-stock';
    if (n.type === 'SALE') return '/dashboard/sales';
    if (n.type === 'PURCHASE_ORDER') return '/dashboard/purchases';
    if (n.data?.productId) return '/dashboard/inventory-all';
    if (n.data?.userId) return '/dashboard/users';
    return null;
  };

  // Get organization ID from localStorage
  const organizationId = localStorage.getItem('current_organization_id');

  // Use WebSocket hook for real-time notifications
  const { newNotification, clearNotification } = useNotificationSocket(organizationId);

  // Fetch initial notifications on mount
  const fetchUnread = async () => {
    if (!organizationId) return; // Skip if no organization selected
    try {
      const res = await apiClient.fetchNotifications({ unread: true, page: 1, pageSize: 10 });
      const items = res?.data || [];
      if (!mounted.current) return;
      setNotifications(items);
      setUnreadCount(items.length || 0);
    } catch (error) {
      console.error('Failed to fetch notifications', error);
    }
  };

  useEffect(() => {
    mounted.current = true;
    fetchUnread(); // Initial fetch
    return () => {
      mounted.current = false;
    };
  }, []);

  // Handle new notifications from WebSocket
  useEffect(() => {
    if (newNotification) {
      // Add to notifications list
      setNotifications(prev => [newNotification, ...prev]);
      setUnreadCount(count => count + 1);

      // Show toast notification
      toast.info(`${newNotification.title}: ${newNotification.message}`, { autoClose: 6000 });

      // Clear the notification from hook state
      clearNotification();
    }
  }, [newNotification, clearNotification]);

  useEffect(() => {
    const closeOnOutside = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!target.closest || !(target.closest('#notification-bell') || target.closest('#notification-dropdown'))) {
        setOpen(false);
      }
    };
    document.addEventListener('click', closeOnOutside);
    return () => document.removeEventListener('click', closeOnOutside);
  }, []);

  const openDropdown = async () => {
    setOpen((v) => !v);
    if (!open && organizationId) { // only fetch when opening and if we have org
      // when opening, fetch the latest notifications (including read)
      try {
        const res = await apiClient.fetchNotifications({ page: 1, pageSize: 20 });
        setNotifications(res?.data || []);
        setUnreadCount((res?.data || []).filter((n: any) => !n.isRead).length);
      } catch (error) {
        console.error('Failed to fetch notifications', error);
      }
    }
  };

  const markAsRead = async (id: string) => {
    try {
      await apiClient.markNotificationRead(id);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch (error) {
      console.error('Failed to mark notification read', error);
      toast.error(t('messages.failedToMarkRead'));
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        id="notification-bell"
        onClick={openDropdown}
        className={`relative rounded-lg border p-2 transition-colors ${
          toolbar
            ? 'border-white/25 bg-white/10 hover:bg-white/15'
            : 'border-gray-200 bg-white shadow-sm hover:shadow-md dark:border-gray-600 dark:bg-gray-800'
        }`}
      >
        <Bell className={`h-4 w-4 ${toolbar ? 'text-slate-300' : 'text-blue-600 dark:text-blue-400'}`} />
        {unreadCount > 0 && (
          <span
            className={`absolute -right-1 -top-1 flex h-4 w-4 animate-pulse items-center justify-center rounded-full bg-red-600 text-[10px] font-medium text-white shadow-sm ring-2 ${
              toolbar ? 'ring-[#0a1628]' : 'ring-white dark:ring-gray-800'
            }`}
          >
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          id="notification-dropdown"
          className="absolute right-0 mt-2 w-80 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-50 animate-in fade-in slide-in-from-top-2 duration-200"
        >
          <div className="p-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <strong>{t('common.notifications') || 'Notifications'}</strong>
            <small className="text-sm text-muted-foreground">{unreadCount} {t('common.unread') || 'unread'}</small>
          </div>
          <div className="max-h-72 overflow-auto">
            {notifications.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">{t('common.noNotifications') || 'No notifications'}</div>
            ) : (
              notifications.map((n) => {
                const link = getNotificationLink(n);
                return (
                  <div
                    key={n.id}
                    className={`p-3 cursor-pointer border-b border-gray-100 dark:border-gray-800 last:border-0 ${
                      n.isRead
                        ? 'hover:bg-gray-50 dark:hover:bg-gray-800'
                        : 'bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                    onClick={() => {
                      if (link) navigate(link);
                      if (!n.isRead) markAsRead(n.id);
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className={`text-sm ${n.isRead ? 'font-normal text-gray-500 dark:text-gray-400' : 'font-semibold text-gray-900 dark:text-white'}`}>{n.title}</div>
                      <div className={`text-xs shrink-0 ${n.isRead ? 'text-gray-400 dark:text-gray-500' : 'text-gray-500 dark:text-gray-400'}`}>{new Date(n.createdAt).toLocaleString()}</div>
                    </div>
                    <div className={`text-sm mt-1 ${n.isRead ? 'text-gray-400 dark:text-gray-500' : 'text-gray-600 dark:text-gray-300'}`}>{n.message}</div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
