import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import type { ToastProps } from '../types/supplierTypes';

export const Toast: React.FC<ToastProps> = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const bgColor = type === 'error' ? 'bg-red-500' : 'bg-green-500';

  return (
    <div className={`fixed top-4 right-4 ${bgColor} text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-3 z-50`}>
      <span>{message}</span>
      <button type="button" onClick={onClose} className="hover:bg-white/20 rounded p-1" aria-label="Close toast">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};
