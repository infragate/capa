import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowDown, Trash2 } from 'lucide-react';
import { TopBar } from '../components/layout/TopBar';
import { Page } from '../components/layout/Page';
import { Alert } from '../components/common/Alert';
import { Spinner } from '../components/common/Spinner';
import { EmptyState } from '../components/common/EmptyState';
import { CapabilitiesSection } from '../features/projects/components/CapabilitiesSection';
import { ProvidersSection } from '../features/projects/components/ProvidersSection';
import { OptionsSection } from '../features/projects/components/OptionsSection';
import { VariablesForm } from '../features/projects/components/VariablesForm';
import {
  useProject,
  useProjectCapabilitiesLiveSync,
  useVariables,
  useOAuth2Servers,
  useDeleteProject,
} from '../features/projects/hooks';
import { projectDisplayName, safeDecode } from '../lib/utils';

export function ProjectDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
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
  const deleteProject = useDeleteProject();
  useProjectCapabilitiesLiveSync(projectId);

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
  const hasProviders = (caps?.providers?.length ?? 0) > 0;
  const showNoConfig = !isLoading && !caps && !error;

  const handleDeleteProject = () => {
    if (!projectId) return;
    if (!confirm(t('projects:actions.confirmDeleteProject', { name: displayName }))) return;
    deleteProject.mutate(projectId, {
      onSuccess: () => navigate('/'),
      onError: (err) => {
        setMessage({
          text: err instanceof Error ? err.message : String(err),
          type: 'error',
        });
      },
    });
  };

  const missingVarCount = variables?.required
    ? variables.required.filter((v) => !variables.values?.[v]).length
    : 0;
  const pendingOAuthCount = oauth2Servers
    ? oauth2Servers.filter((s) => !s.isConnected).length
    : 0;

  const scrollTo = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

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

        {(missingVarCount > 0 || pendingOAuthCount > 0) && !isLoading && !error && (
          <div className="mb-6 space-y-2">
            {missingVarCount > 0 && (
              <div className="flex items-center justify-between gap-4 rounded-lg border border-[hsl(40_80%_50%/0.3)] bg-[hsl(40_80%_50%/0.08)] px-4 py-3">
                <div className="flex items-center gap-2.5 text-sm text-[hsl(40_80%_45%)]">
                  <AlertTriangle size={16} className="shrink-0" />
                  <span>{t('projects:banner.missingVariables', { count: missingVarCount })}</span>
                </div>
                <button
                  onClick={() => scrollTo('variables-section')}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-[hsl(40_80%_50%/0.3)] bg-[hsl(40_80%_50%/0.12)] px-3 py-1.5 text-xs font-medium text-[hsl(40_80%_45%)] transition-colors hover:bg-[hsl(40_80%_50%/0.2)] cursor-pointer"
                >
                  {t('projects:banner.configure')}
                  <ArrowDown size={12} />
                </button>
              </div>
            )}
            {pendingOAuthCount > 0 && (
              <div className="flex items-center justify-between gap-4 rounded-lg border border-[hsl(40_80%_50%/0.3)] bg-[hsl(40_80%_50%/0.08)] px-4 py-3">
                <div className="flex items-center gap-2.5 text-sm text-[hsl(40_80%_45%)]">
                  <AlertTriangle size={16} className="shrink-0" />
                  <span>{t('projects:banner.pendingOAuth', { count: pendingOAuthCount })}</span>
                </div>
                <button
                  onClick={() => scrollTo('capabilities-section')}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-[hsl(40_80%_50%/0.3)] bg-[hsl(40_80%_50%/0.12)] px-3 py-1.5 text-xs font-medium text-[hsl(40_80%_45%)] transition-colors hover:bg-[hsl(40_80%_50%/0.2)] cursor-pointer"
                >
                  {t('projects:banner.connect')}
                  <ArrowDown size={12} />
                </button>
              </div>
            )}
          </div>
        )}

        {isLoading ? (
          <Spinner label={t('status.loading')} />
        ) : error ? (
          <Alert type="error">{(error as Error).message}</Alert>
        ) : (
          <>
            <div className="mb-6 flex justify-end">
              <button
                type="button"
                onClick={handleDeleteProject}
                disabled={deleteProject.isPending}
                className="inline-flex items-center gap-1.5 rounded-sm border border-border-primary bg-bg-secondary px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-error-bg hover:text-error-text hover:border-transparent cursor-pointer disabled:opacity-50"
              >
                <Trash2 size={14} />
                {t('projects:actions.deleteProject')}
              </button>
            </div>

            {hasProviders && <ProvidersSection providers={caps!.providers} />}

            <div id="capabilities-section">
              <CapabilitiesSection
                skills={caps?.skills ?? []}
                tools={caps?.tools ?? []}
                servers={caps?.servers ?? []}
                subagents={caps?.subagents ?? []}
                rules={caps?.rules ?? []}
                hooks={caps?.hooks ?? []}
                agents={caps?.agents ?? null}
                plugins={caps?.plugins ?? []}
                resolvedPlugins={caps?.resolvedPlugins ?? []}
                projectId={projectId}
              />
            </div>

            <OptionsSection projectId={projectId} options={caps?.options ?? null} />

            <VariablesForm projectId={projectId} returnUrl={returnUrl} />

            {showNoConfig && !caps && (
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
