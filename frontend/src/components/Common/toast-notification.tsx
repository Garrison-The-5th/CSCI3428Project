/**
 * File: toast-notification.tsx
 * Description: ToastNotification Component.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * ToastNotification Component
 *
 * Reusable toast notification for success/error messages.
 * Auto-dismisses after specified duration.
 *
 * @example
 * ```tsx
 * <ToastNotification
 *   show={notification.show}
 *   message={notification.message}
 *   type={notification.type}
 *   onClose={() => setNotification({ ...notification, show: false })}
 * />
 * ```
 */
import { CheckCircleIcon, ExclamationCircleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useEffect } from 'react';

interface ToastNotificationProps {
  show: boolean;
  message: string;
  type: 'success' | 'error';
  onClose: () => void;
  duration?: number;
}

const ToastNotification = ({
  show,
  message,
  type,
  onClose,
  duration = 4000,
}: ToastNotificationProps) => {
  useEffect(() => {
    if (show && duration > 0) {
      const timer = setTimeout(onClose, duration);
      return () => clearTimeout(timer);
    }
  }, [show, duration, onClose]);

  if (!show) return null;

  const toastIcon = 'w-6 h-6 shrink-0';

  return (
    <div
      className={`fixed top-5 right-5 z-2000 min-w-75 max-w-125 px-6 py-4 rounded-lg
        shadow-[0_4px_12px_rgba(0,0,0,0.15)] animate-slideInRight max-sm:top-2.5 max-sm:right-2.5
        max-sm:left-2.5 max-sm:min-w-0
        ${type === 'success' ? 'bg-[#4caf50] text-white' : 'bg-[#f44336] text-white'}`}
    >
      <div className="flex items-center gap-3">
        {type === 'success' ? (
          <CheckCircleIcon className={toastIcon} />
        ) : (
          <ExclamationCircleIcon className={toastIcon} />
        )}
        <span className="text-base font-medium">{message}</span>
        <button
          onClick={onClose}
          aria-label="Close notification"
          className="flex items-center justify-center shrink-0 p-1 rounded cursor-pointer
            hover:bg-white/20 transition-colors duration-200"
        >
          <XMarkIcon className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};

export default ToastNotification;
