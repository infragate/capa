import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { TopBar } from '../components/layout/TopBar';
import { Page } from '../components/layout/Page';
import { Alert } from '../components/common/Alert';
import { Spinner } from '../components/common/Spinner';
import { GitHubCard } from '../features/integrations/components/GitHubCard';
import { GitLabCard } from '../features/integrations/components/GitLabCard';
import { GitHubEnterpriseCard } from '../features/integrations/components/GitHubEnterpriseCard';
import { GitLabSelfManagedCard } from '../features/integrations/components/GitLabSelfManagedCard';
import { useIntegrations, useDisconnectIntegration } from '../features/integrations/hooks';

export function IntegrationsPage() {
  const { t } = useTranslation('integrations');
  const [searchParams] = useSearchParams();
  const qc = useQueryClient();
  const { data: integrations, isLoading, refetch } = useIntegrations();
  const disconnectMutation = useDisconnectIntegration();

  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    const success = searchParams.get('success');
    const error = searchParams.get('error');
    if (success) {
      setMessage({ text: t('messages.connectedTo', { name: success }), type: 'success' });
      window.history.replaceState({}, document.title, '/ui/integrations');
      setTimeout(() => refetch(), 500);
    } else if (error) {
      setMessage({ text: t('messages.oauthError', { error: decodeURIComponent(error) }), type: 'error' });
      window.history.replaceState({}, document.title, '/ui/integrations');
    }
  }, [searchParams, t, refetch]);

  const handleMessage = useCallback((text: string, type: 'success' | 'error') => {
    setMessage({ text, type });
  }, []);

  const handleDisconnect = useCallback(
    async (platform: string) => {
      try {
        await disconnectMutation.mutateAsync({ platform });
        setMessage({ text: `Disconnected from ${platform}`, type: 'success' });
      } catch {
        setMessage({ text: 'Failed to disconnect', type: 'error' });
      }
    },
    [disconnectMutation],
  );

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const findIntegration = (platform: string) =>
    integrations?.find((i) => i.platform === platform);

  return (
    <>
      <TopBar title={t('title')} showBack />
      <Page title={t('title')} subtitle={t('subtitle')}>
        {message && (
          <Alert
            type={message.type}
            autoDismissMs={message.type === 'success' ? 3000 : undefined}
            onDismiss={() => setMessage(null)}
          >
            {message.text}
          </Alert>
        )}

        {isLoading ? (
          <Spinner />
        ) : (
          <>
            <div className="mb-6 rounded-lg border border-border-primary bg-bg-secondary p-6">
              <div className="mb-4 border-b border-border-secondary pb-4">
                <h2 className="text-base font-medium text-text-primary">{t('cloud.title')}</h2>
              </div>
              <p className="mb-6 text-[13px] leading-relaxed text-text-secondary">
                {t('cloud.description')}
              </p>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
                <GitHubCard
                  integration={findIntegration('github')}
                  onMessage={handleMessage}
                  onDisconnect={handleDisconnect}
                />
                <GitLabCard
                  integration={findIntegration('gitlab')}
                  onMessage={handleMessage}
                  onDisconnect={handleDisconnect}
                />
              </div>
            </div>

            <div className="mb-6 rounded-lg border border-border-primary bg-bg-secondary p-6">
              <div className="mb-4 border-b border-border-secondary pb-4">
                <h2 className="text-base font-medium text-text-primary">{t('selfManaged.title')}</h2>
              </div>
              <p className="mb-6 text-[13px] leading-relaxed text-text-secondary">
                {t('selfManaged.description')}
              </p>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
                <GitHubEnterpriseCard
                  integration={findIntegration('github-enterprise')}
                  onMessage={handleMessage}
                  onDisconnect={handleDisconnect}
                  onRefresh={handleRefresh}
                />
                <GitLabSelfManagedCard
                  integration={findIntegration('gitlab-self-managed')}
                  onMessage={handleMessage}
                  onDisconnect={handleDisconnect}
                  onRefresh={handleRefresh}
                />
              </div>
            </div>
          </>
        )}
      </Page>
    </>
  );
}
