import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { TopBar } from '../components/layout/TopBar';
import { Page } from '../components/layout/Page';
import { Alert } from '../components/common/Alert';
import { Spinner } from '../components/common/Spinner';
import { EmptyState } from '../components/common/EmptyState';
import { PluginsSection } from '../features/projects/components/PluginsSection';
import { CapabilitiesSection } from '../features/projects/components/CapabilitiesSection';
import { ProvidersSection } from '../features/projects/components/ProvidersSection';
import { OptionsSection } from '../features/projects/components/OptionsSection';
import { VariablesForm } from '../features/projects/components/VariablesForm';
import { OAuth2Section } from '../features/projects/components/OAuth2Section';
import { useProject, useVariables, useOAuth2Servers } from '../features/projects/hooks';
import { projectDisplayName, safeDecode } from '../lib/utils';

export function ProjectDetailPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('id') || searchParams.get('project');
  const returnUrl = searchParams.get('return');
  const oauthSuccess = searchParams.get('oauth_success');
  const oauthError = searchParams.get('oauth_error');
  const connectedServer = searchParams.get('server');

  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const { data: project, isLoading, error } = useProject(projectId);
  const { data: variables } = useVariables(projectId);
  const { data: oauth2Servers } = useOAuth2Servers(projectId);

  useEffect(() => {
    if (!projectId) return;
    if (oauthSuccess) {
      setMessage({
        text: t('projects:oauth.connectedTo', { name: connectedServer || 'server' }),
        type: 'success',
      });
      window.history.replaceState({}, document.title, `/ui/project?id=${encodeURIComponent(projectId)}`);
    } else if (oauthError) {
      setMessage({ text: `OAuth error: ${safeDecode(oauthError)}`, type: 'error' });
      window.history.replaceState({}, document.title, `/ui/project?id=${encodeURIComponent(projectId)}`);
    }
  }, [oauthSuccess, oauthError, connectedServer, projectId, t]);

  const displayName = project ? projectDisplayName(project.path, projectId || undefined) : projectId || '';
  const caps = project?.capabilities;
  const hasCapabilities =
    caps &&
    (caps.skills.length > 0 ||
      caps.tools.length > 0 ||
      caps.servers.length > 0 ||
      (caps.subagents?.length ?? 0) > 0 ||
      (caps.rules?.length ?? 0) > 0);
  const hasVariables = (variables?.required?.length ?? 0) > 0;
  const hasOAuth = (oauth2Servers?.length ?? 0) > 0;
  const hasProviders = (caps?.providers?.length ?? 0) > 0;
  const hasOptions = caps?.options != null;
  const showNoConfig = !isLoading && !hasCapabilities && !hasProviders && !hasOptions && !hasVariables && !hasOAuth && !error;

  if (!projectId) {
    return (
      <>
        <TopBar title="" showBack />
        <Page title={t('projects:detail.title')} subtitle={t('projects:detail.subtitle')}>
          <Alert type="error">{t('projects:detail.noProjectId')}</Alert>
        </Page>
      </>
    );
  }

  return (
    <>
      <TopBar title={displayName} showBack />
      <Page title={t('projects:detail.title')} subtitle={t('projects:detail.subtitle')}>
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
          <Spinner label={t('status.loading')} />
        ) : error ? (
          <Alert type="error">{(error as Error).message}</Alert>
        ) : (
          <>
            {caps?.resolvedPlugins && caps.resolvedPlugins.length > 0 && (
              <PluginsSection
                plugins={caps.resolvedPlugins}
                skills={caps.skills}
                tools={caps.tools}
                servers={caps.servers}
              />
            )}

            {caps?.providers && caps.providers.length > 0 && (
              <ProvidersSection providers={caps.providers} />
            )}

            {hasCapabilities && (
              <CapabilitiesSection
                skills={caps!.skills}
                tools={caps!.tools}
                servers={caps!.servers}
                subagents={caps!.subagents ?? []}
                rules={caps!.rules ?? []}
                projectId={projectId}
              />
            )}

            {caps?.options && <OptionsSection options={caps.options} />}

            <VariablesForm projectId={projectId} returnUrl={returnUrl} />

            <OAuth2Section
              projectId={projectId}
              onMessage={(text, type) => setMessage({ text, type })}
            />

            {showNoConfig && (
              <div className="rounded-lg border border-border-primary bg-bg-secondary p-6">
                <EmptyState
                  title={t('projects:noConfig.title')}
                  description={t('projects:noConfig.description')}
                  className="py-8"
                />
              </div>
            )}
          </>
        )}
      </Page>
    </>
  );
}
