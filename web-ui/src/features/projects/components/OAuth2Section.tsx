import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useOAuth2Servers, useDisconnectOAuth } from '../hooks';
import { projectsApi } from '../api';
import { StatusDot } from '../../../components/common/StatusDot';
import { Spinner } from '../../../components/common/Spinner';

interface OAuth2SectionProps {
  projectId: string;
  onMessage: (text: string, type: 'success' | 'error') => void;
}

function formatExpiry(expiresAt: string | null): string {
  if (!expiresAt) return '';
  const expires = new Date(expiresAt);
  const now = new Date();
  const diffMs = expires.getTime() - now.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  if (diffMs <= 0) return 'Expired';
  if (diffDays > 0) return `expires in ${diffDays} day${diffDays > 1 ? 's' : ''}`;
  if (diffHours > 0) return `expires in ${diffHours} hour${diffHours > 1 ? 's' : ''}`;
  const diffMin = Math.floor(diffMs / (1000 * 60));
  return `expires in ${diffMin} minute${diffMin > 1 ? 's' : ''}`;
}

export function OAuth2Section({ projectId, onMessage }: OAuth2SectionProps) {
  const { t } = useTranslation();
  const { data: servers, isLoading } = useOAuth2Servers(projectId);
  const disconnectMutation = useDisconnectOAuth(projectId);

  const handleConnect = useCallback(
    async (serverId: string) => {
      try {
        const data = await projectsApi.startOAuth(projectId, serverId);
        if (data.authorizationUrl) {
          window.location.href = data.authorizationUrl;
        } else {
          onMessage(t('errors.oauthFailed'), 'error');
        }
      } catch (err) {
        onMessage(`${t('errors.oauthFailed')}: ${(err as Error).message}`, 'error');
      }
    },
    [projectId, onMessage, t],
  );

  const handleDisconnect = useCallback(
    async (serverId: string, displayName: string) => {
      if (!confirm(t('projects:oauth.confirmDisconnect', { name: displayName }))) return;
      try {
        await disconnectMutation.mutateAsync(serverId);
        onMessage(t('projects:oauth.disconnectedFrom', { name: displayName }), 'success');
      } catch {
        onMessage(t('errors.disconnectFailed'), 'error');
      }
    },
    [disconnectMutation, onMessage, t],
  );

  if (isLoading) return <Spinner className="py-8" />;
  if (!servers?.length) return null;

  return (
    <div className="mb-6 rounded-lg border border-border-primary bg-bg-secondary p-6">
      <div className="mb-4 border-b border-border-secondary pb-4">
        <h2 className="text-base font-medium text-text-primary">{t('projects:oauth.title')}</h2>
      </div>
      <p className="mb-6 text-[13px] leading-relaxed text-text-secondary">
        {t('projects:oauth.description')}
      </p>
      <div className="space-y-3">
        {servers.map((server) => {
          const name = server.displayName || server.serverId;
          const expiryText = server.isConnected ? formatExpiry(server.expiresAt) : '';
          const statusLabel = server.isConnected
            ? expiryText
              ? `Connected (${expiryText})`
              : 'Connected'
            : 'Not connected';

          return (
            <div
              key={server.serverId}
              className="flex items-center justify-between rounded-sm border border-border-tertiary bg-bg-tertiary p-4 max-sm:flex-col max-sm:items-start max-sm:gap-3"
            >
              <div>
                <div className="mb-1 text-sm font-medium text-text-primary">{name}</div>
                <StatusDot connected={server.isConnected} label={statusLabel} />
              </div>
              <div>
                {server.isConnected ? (
                  <button
                    onClick={() => handleDisconnect(server.serverId, name)}
                    className="rounded-sm bg-error-btn px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-error-btn-hover"
                  >
                    {t('actions.disconnect')}
                  </button>
                ) : (
                  <button
                    onClick={() => handleConnect(server.serverId)}
                    className="rounded-sm bg-success-btn px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-success-btn-hover"
                  >
                    {t('actions.connect')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
