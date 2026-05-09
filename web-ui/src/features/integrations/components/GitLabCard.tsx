import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { Integration } from '../../../types/api';
import { integrationsApi } from '../api';
import { StatusDot } from '../../../components/common/StatusDot';
import { FaGitlab } from 'react-icons/fa';

interface GitLabCardProps {
  integration?: Integration;
  onMessage: (text: string, type: 'success' | 'error') => void;
  onDisconnect: (platform: string) => void;
}

export function GitLabCard({ integration, onMessage, onDisconnect }: GitLabCardProps) {
  const { t } = useTranslation('integrations');
  const connected = integration?.isConnected ?? false;

  const handleConnect = useCallback(async () => {
    try {
      const data = await integrationsApi.startGitLabOAuth();
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
        <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border-tertiary bg-bg-secondary overflow-hidden">
          <FaGitlab className="h-8 w-8 text-[#fc6d26]" />
        </div>
        <div className="text-base font-medium text-text-primary">{t('gitlab.name')}</div>
      </div>
      <div className="mb-4">
        <StatusDot connected={connected} label={connected ? 'Connected' : 'Not connected'} />
      </div>
      {connected ? (
        <button
          onClick={() => {
            if (confirm(t('gitlab.confirmDisconnect'))) onDisconnect('gitlab');
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
          {t('gitlab.connectButton')}
        </button>
      )}
    </div>
  );
}
