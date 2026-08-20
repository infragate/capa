import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

interface RegistryDialogFooterProps {
  left: ReactNode;
  onSubmit: () => void;
  submitDisabled: boolean;
  submitPending: boolean;
  submitLabel: string;
}

/** Shared cancel + primary submit row for add/edit registry dialogs. */
export function RegistryDialogFooter({
  left,
  onSubmit,
  submitDisabled,
  submitPending,
  submitLabel,
}: RegistryDialogFooterProps) {
  const { t } = useTranslation('registries');

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-secondary px-6 py-4">
      {left}
      <div className="flex items-center gap-2">
        <Dialog.Close
          type="button"
          className="rounded-sm border border-border-secondary bg-bg-tertiary px-3 py-1.5 text-sm text-text-secondary transition-colors hover:bg-hover-bg"
        >
          {t('addDialog.cancel')}
        </Dialog.Close>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitDisabled}
          className="inline-flex items-center gap-2 rounded-sm border border-accent-primary bg-accent-primary px-3 py-1.5 text-sm font-medium text-bg-secondary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitPending && <Loader2 className="h-4 w-4 animate-spin" />}
          <span>{submitLabel}</span>
        </button>
      </div>
    </div>
  );
}
