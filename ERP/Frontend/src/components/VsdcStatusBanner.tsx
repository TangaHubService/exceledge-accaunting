import { ShieldAlert, WifiOff, X } from 'lucide-react';
import { useState } from 'react';
import { useVsdcOnlineStatus } from '../hooks/useVsdcOnlineStatus';

export function VsdcStatusBanner() {
  const { status, message, hoursSinceSync } = useVsdcOnlineStatus();
  const [dismissed, setDismissed] = useState(false);

  if (status === 'healthy' || dismissed || !message) return null;

  const isBlocked = status === 'blocked';

  const bgColor = isBlocked
    ? 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-800'
    : 'bg-orange-50 dark:bg-orange-900/20 border-orange-300 dark:border-orange-800';

  const textColor = isBlocked
    ? 'text-red-900 dark:text-red-100'
    : 'text-orange-900 dark:text-orange-100';

  const iconColor = isBlocked
    ? 'text-red-600 dark:text-red-400'
    : 'text-orange-600 dark:text-orange-400';

  const Icon = isBlocked ? ShieldAlert : WifiOff;

  return (
    <div className={`${bgColor} border-l-4 p-4 mb-6 rounded-r-lg relative`}>
      <div className="flex items-start gap-3">
        <Icon className={`h-5 w-5 ${iconColor} flex-shrink-0 mt-0.5`} />
        <div className="flex-1 min-w-0">
          <span className={`text-sm font-semibold ${textColor}`}>
            {isBlocked ? 'VSDC Offline — Hard Block' : 'VSDC Connection Warning'}
          </span>
          <p className={`text-sm ${textColor} opacity-90 mt-1`}>{message}</p>
          {!isBlocked && (
            <p className={`text-xs ${textColor} opacity-70 mt-1`}>
              Last successful sync: {hoursSinceSync}h ago
            </p>
          )}
        </div>
        <button
          onClick={() => setDismissed(true)}
          className={`${iconColor} hover:opacity-70 transition-opacity flex-shrink-0`}
          aria-label="Dismiss"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
