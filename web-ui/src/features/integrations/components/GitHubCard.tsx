import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { Integration } from '../../../types/api';
import { integrationsApi } from '../api';
import { StatusDot } from '../../../components/common/StatusDot';

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-8 w-8">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

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
          <GitHubIcon />
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
