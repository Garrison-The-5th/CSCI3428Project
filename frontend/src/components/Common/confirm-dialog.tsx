/**
 * File: confirm-dialog.tsx
 * Description: Confirmation dialog for destructive actions, so a stray click cannot delete a.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * Confirmation dialog for destructive actions, so a stray click cannot delete a
 * module or quiz. Clicking the backdrop or Cancel dismisses it.
 */
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmDialog = ({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      role="presentation"
      onClick={onCancel}
    >
      <Card
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full
                bg-danger/10 text-danger"
            >
              <ExclamationTriangleIcon className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-dark-gray">{title}</h2>
              <div className="mt-2 text-dark-gray">{message}</div>
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <Button
              type="button"
              onClick={onCancel}
              variant="outline"
              className="bg-white text-dark-gray hover:bg-light-gray"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={onConfirm}
              variant="destructive"
              className="bg-danger text-white hover:bg-danger-hover"
            >
              {confirmLabel}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ConfirmDialog;
