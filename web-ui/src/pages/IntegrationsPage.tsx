import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { TopBar } from '../components/layout/TopBar';
import { Page } from '../components/layout/Page';
import { Alert } from '../components/common/Alert';
import { Spinner } from '../components/common/Spinner';
import { FaGithub, FaGitlab } from 'react-icons/fa';
import { GitHubCard } from '../features/integrations/components/GitHubCard';
import { GitLabCard } from '../features/integrations/components/GitLabCard';
import { HostTokenIntegrationCard } from '../features/integrations/components/HostTokenIntegrationCard';
import { integrationsApi } from '../features/integrations/api';
import { useIntegrations, useDisconnectIntegration } from '../features/integrations/hooks';
import { safeDecode } from '../lib/utils';

export function IntegrationsPage() {
  const { t } = useTranslation('integrations');
  const [searchParams] = useSearchParams();
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
      setMessage({ text: t('messages.oauthError', { error: safeDecode(error) }), type: 'error' });
      window.history.replaceState({}, document.title, '/ui/integrations');
    }
  }, [searchParams, t, refetch]);

  const handleMessage = useCallback((text: string, type: 'success' | 'error') => {
    setMessage({ text, type });
  }, []);

  const handleDisconnect = useCallback(
    async (platform: string, host?: string) => {
      try {
        await disconnectMutation.mutateAsync({ platform, host });
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
                <HostTokenIntegrationCard
                  integration={findIntegration('github-enterprise')}
                  onMessage={handleMessage}
                  onDisconnect={handleDisconnect}
                  onRefresh={handleRefresh}
                  platform="github-enterprise"
                  i18nKey="githubEnterprise"
                  icon={<FaGithub className="h-8 w-8" />}
                  connectFn={integrationsApi.connectGitHubEnterprise}
                />
                <HostTokenIntegrationCard
                  integration={findIntegration('gitlab-self-managed')}
                  onMessage={handleMessage}
                  onDisconnect={handleDisconnect}
                  onRefresh={handleRefresh}
                  platform="gitlab-self-managed"
                  i18nKey="gitlabSelfManaged"
                  icon={<FaGitlab className="h-8 w-8 text-[#fc6d26]" />}
                  connectFn={integrationsApi.connectGitLabSelfManaged}
                />
              </div>
            </div>
          </>
        )}
      </Page>
    </>
  );
}
