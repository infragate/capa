import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { Integration } from '../../../types/api';
import { integrationsApi } from '../api';
import { StatusDot } from '../../../components/common/StatusDot';
import { FaGithub } from 'react-icons/fa';

function formatExpiry(expiresAt: string | null): string {
  if (!expiresAt) return '';
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return '';
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days > 0) return `expires in ${days} day${days > 1 ? 's' : ''}`;
  return '';
}

interface GitHubCardProps {
  integration?: Integration;
  onMessage: (text: string, type: 'success' | 'error') => void;
  onDisconnect: (platform: string) => void;
}

export function GitHubCard({ integration, onMessage, onDisconnect }: GitHubCardProps) {
  const { t } = useTranslation('integrations');
  const connected = integration?.isConnected ?? false;
  const expiryText = connected ? formatExpiry(integration?.expiresAt ?? null) : '';

  const handleConnect = useCallback(async () => {
    try {
      const data = await integrationsApi.startGitHubOAuth();
      if (data.authorizationUrl) {
        window.location.href = data.authorizationUrl;
      } else {
        onMessage(data.error || t('common:errors.oauthFailed'), 'error');
      }
    } catch (err) {
      onMessage(`${t('common:errors.oauthFailed')}: ${(err as Error).message}`, 'error');
    }
  }, [onMessage, t]);

  return (
    <div className="rounded-sm border border-border-secondary bg-bg-tertiary p-5 transition-shadow hover:shadow-[var(--shadow-sm)]">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border-tertiary bg-bg-secondary">
          <FaGithub className="h-8 w-8" />
        </div>
        <div className="text-base font-medium text-text-primary">{t('github.name')}</div>
      </div>
      <div className="mb-4">
        <StatusDot
          connected={connected}
          label={
            connected
              ? expiryText
                ? `Connected (${expiryText})`
                : 'Connected'
              : 'Not connected'
          }
        />
      </div>
      {connected ? (
        <button
          onClick={() => {
            if (confirm(t('github.confirmDisconnect'))) onDisconnect('github');
          }}
          className="w-full rounded-sm bg-error-btn px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-error-btn-hover"
        >
          {t('common:actions.disconnect')}
        </button>
      ) : (
        <button
          onClick={handleConnect}
          className="w-full rounded-sm bg-success-btn px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-success-btn-hover"
        >
          {t('github.connectButton')}
        </button>
      )}
    </div>
  );
}
