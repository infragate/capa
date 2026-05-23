import { useTranslation } from 'react-i18next';
import { RefreshCw, Trash2, Power, PowerOff, Pencil } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { RegistryAdminRecord } from '../api';

interface RegistriesTableProps {
  registries: RegistryAdminRecord[];
  onEdit: (record: RegistryAdminRecord) => void;
  onRefresh: (slug: string) => void;
  onDelete: (slug: string) => void;
  onSetEnabled: (slug: string, enabled: boolean) => void;
  busySlug?: string | null;
}

function statusTone(record: RegistryAdminRecord): { label: string; tone: string } {
  if (!record.enabled) {
    return { label: 'disabled', tone: 'bg-bg-tertiary text-text-secondary border-border-secondary' };
  }
  if (record.status === 'installed') {
    return { label: 'installed', tone: 'bg-success-bg text-success-text border-success-border' };
  }
  if (record.status === 'failed') {
    return { label: 'failed', tone: 'bg-error-bg text-error-text border-error-border' };
  }
  return { label: record.status, tone: 'bg-info-bg text-info-text border-info-border' };
}

export function RegistriesTable({
  registries,
  onEdit,
  onRefresh,
  onDelete,
  onSetEnabled,
  busySlug,
}: RegistriesTableProps) {
  const { t } = useTranslation('registries');

  return (
    <div className="overflow-hidden rounded-lg border border-border-primary">
      <table className="w-full text-sm">
        <thead className="bg-bg-tertiary text-left text-xs uppercase tracking-wide text-text-secondary">
          <tr>
            <th className="px-4 py-3 font-medium">{t('settings.table.name')}</th>
            <th className="px-4 py-3 font-medium">{t('settings.table.type')}</th>
            <th className="px-4 py-3 font-medium">{t('settings.table.source')}</th>
            <th className="px-4 py-3 font-medium">{t('settings.table.status')}</th>
            <th className="px-4 py-3 text-right font-medium">{t('settings.table.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {registries.map((r) => {
            const tone = statusTone(r);
            const busy = busySlug === r.slug;
            const displayName = r.manifest?.name ?? r.slug;
            const statusLabel =
              tone.label === 'disabled'
                ? t('settings.status.disabled')
                : tone.label === 'installed'
                  ? t('settings.status.installed')
                  : tone.label === 'failed'
                    ? t('settings.status.failed')
                    : t('settings.status.pending');
            return (
              <tr
                key={r.slug}
                className="border-t border-border-primary bg-bg-secondary align-top hover:bg-hover-bg"
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-text-primary">{displayName}</div>
                  <div className="text-xs text-text-secondary">{r.slug}</div>
                  {r.manifest?.description && (
                    <div className="mt-1 text-xs text-text-secondary">{r.manifest.description}</div>
                  )}
                </td>
                <td className="px-4 py-3 align-top">
                  <span className="rounded-sm border border-border-secondary bg-bg-tertiary px-2 py-0.5 text-xs uppercase tracking-wide text-text-secondary">
                    {r.type}
                  </span>
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="break-all font-mono text-xs text-text-primary">{r.source}</div>
                  {r.resolvedRef && (
                    <div className="mt-1 font-mono text-xs text-text-secondary">
                      {r.resolvedRef.slice(0, 7)}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 align-top">
                  <span
                    className={cn(
                      'inline-block rounded-sm border px-2 py-0.5 text-xs',
                      tone.tone,
                    )}
                  >
                    {statusLabel}
                  </span>
                  {r.lastError && (
                    <div className="mt-2 max-w-md break-words text-xs text-error-text">
                      {r.lastError}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onSetEnabled(r.slug, !r.enabled)}
                      className="inline-flex items-center gap-1 rounded-sm border border-border-secondary bg-bg-tertiary px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-hover-bg disabled:cursor-not-allowed disabled:opacity-50"
                      title={r.enabled ? t('settings.actions.disable') : t('settings.actions.enable')}
                    >
                      {r.enabled ? (
                        <PowerOff className="h-3.5 w-3.5" />
                      ) : (
                        <Power className="h-3.5 w-3.5" />
                      )}
                      <span>
                        {r.enabled ? t('settings.actions.disable') : t('settings.actions.enable')}
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onEdit(r)}
                      className="inline-flex items-center gap-1 rounded-sm border border-border-secondary bg-bg-tertiary px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-hover-bg disabled:cursor-not-allowed disabled:opacity-50"
                      title={t('settings.actions.edit')}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      <span>{t('settings.actions.edit')}</span>
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onRefresh(r.slug)}
                      className="inline-flex items-center gap-1 rounded-sm border border-border-secondary bg-bg-tertiary px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-hover-bg disabled:cursor-not-allowed disabled:opacity-50"
                      title={t('settings.actions.refresh')}
                    >
                      <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />
                      <span>{t('settings.actions.refresh')}</span>
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onDelete(r.slug)}
                      className="inline-flex items-center gap-1 rounded-sm border border-error-border bg-error-bg px-2 py-1 text-xs text-error-text transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                      title={t('settings.actions.delete')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>{t('settings.actions.delete')}</span>
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
