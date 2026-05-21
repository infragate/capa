import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, AlertTriangle, ArrowLeft } from 'lucide-react';
import { TopBar } from '../../../components/layout/TopBar';
import { Page } from '../../../components/layout/Page';
import { Spinner } from '../../../components/common/Spinner';
import { EmptyState } from '../../../components/common/EmptyState';
import {
  useRegistriesAdmin,
  useRemoveRegistry,
  useRefreshRegistry,
  useSetRegistryEnabled,
} from '../hooks';
import { RegistriesTable } from './RegistriesTable';
import { AddRegistryDialog } from './AddRegistryDialog';
import { ApiError } from '../../../lib/api';

type Feedback = { type: 'success' | 'error'; message: string };

function errMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err && typeof (err as any).message === 'string') return (err as any).message;
  return fallback;
}

export function RegistrySettingsPage() {
  const { t } = useTranslation('registries');
  const { data: registries, isLoading } = useRegistriesAdmin();
  const removeMut = useRemoveRegistry();
  const refreshMut = useRefreshRegistry();
  const setEnabledMut = useSetRegistryEnabled();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);

  const handleAdded = useCallback(
    (slug: string) => {
      setFeedback({ type: 'success', message: t('settings.feedback.added', { slug }) });
    },
    [t],
  );

  const handleRefresh = useCallback(
    async (slug: string) => {
      setBusySlug(slug);
      setFeedback(null);
      try {
        await refreshMut.mutateAsync(slug);
        setFeedback({ type: 'success', message: t('settings.feedback.refreshed', { slug }) });
      } catch (err) {
        setFeedback({ type: 'error', message: errMessage(err, 'Refresh failed') });
      } finally {
        setBusySlug(null);
      }
    },
    [refreshMut, t],
  );

  const handleDelete = useCallback(
    async (slug: string) => {
      if (!confirm(t('settings.actions.deleteConfirm', { slug }))) return;
      setBusySlug(slug);
      setFeedback(null);
      try {
        await removeMut.mutateAsync(slug);
        setFeedback({ type: 'success', message: t('settings.feedback.removed', { slug }) });
      } catch (err) {
        setFeedback({ type: 'error', message: errMessage(err, 'Delete failed') });
      } finally {
        setBusySlug(null);
      }
    },
    [removeMut, t],
  );

  const handleSetEnabled = useCallback(
    async (slug: string, enabled: boolean) => {
      setBusySlug(slug);
      setFeedback(null);
      try {
        await setEnabledMut.mutateAsync({ slug, enabled });
        setFeedback({
          type: 'success',
          message: t(enabled ? 'settings.feedback.enabled' : 'settings.feedback.disabled', { slug }),
        });
      } catch (err) {
        setFeedback({ type: 'error', message: errMessage(err, 'Update failed') });
      } finally {
        setBusySlug(null);
      }
    },
    [setEnabledMut, t],
  );

  return (
    <>
      <TopBar title={t('settings.title')} showBack />
      <Page title={t('settings.title')} subtitle={t('settings.subtitle')}>
        <div className="mb-5 flex items-center justify-between gap-3">
          <Link
            to="/ui/registries"
            className="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs text-text-secondary no-underline transition-colors hover:bg-hover-bg"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>{t('settings.browseLink')}</span>
          </Link>
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="inline-flex items-center gap-2 rounded-sm border border-accent-primary bg-accent-primary px-3 py-1.5 text-sm font-medium text-bg-secondary transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            <span>{t('settings.addButton')}</span>
          </button>
        </div>

        <div className="mb-5 flex items-start gap-3 rounded-sm border border-info-border bg-info-bg px-4 py-3 text-xs text-info-text">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            <div className="font-medium">{t('settings.warningTitle')}</div>
            <div className="mt-0.5 opacity-90">{t('settings.warningBody')}</div>
          </div>
        </div>

        {feedback && (
          <div
            className={
              feedback.type === 'success'
                ? 'mb-5 rounded-sm border border-success-border bg-success-bg px-4 py-2 text-sm text-success-text'
                : 'mb-5 rounded-sm border border-error-border bg-error-bg px-4 py-2 text-sm text-error-text'
            }
          >
            {feedback.message}
          </div>
        )}

        {isLoading ? (
          <Spinner />
        ) : !registries || registries.length === 0 ? (
          <EmptyState
            title={t('settings.noneTitle')}
            description={t('settings.noneDescription')}
          />
        ) : (
          <RegistriesTable
            registries={registries}
            onRefresh={handleRefresh}
            onDelete={handleDelete}
            onSetEnabled={handleSetEnabled}
            busySlug={busySlug}
          />
        )}
      </Page>

      <AddRegistryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onAdded={handleAdded}
      />
    </>
  );
}
