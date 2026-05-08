import { useState, useCallback } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Integration } from '../../../types/api';
import { integrationsApi } from '../api';
import { StatusDot } from '../../../components/common/StatusDot';

function GitLabIcon() {
  return (
    <svg viewBox="0 0 380 380" className="h-8 w-8">
      <path fill="#e24329" d="M265.26416,174.37243l-.2134-.55822-21.19899-55.30908c-.4236-1.08359-1.18542-1.99642-2.17699-2.62689-.98837-.63373-2.14749-.93253-3.32305-.87014-1.1689.06239-2.29195.48925-3.20809,1.21821-.90957.73554-1.56629,1.73047-1.87493,2.85346l-14.31327,43.80662h-57.90965l-14.31327-43.80662c-.30864-1.12299-.96536-2.11791-1.87493-2.85346-.91614-.72895-2.03911-1.15582-3.20809-1.21821-1.17548-.06239-2.33468.23641-3.32297.87014-.99166.63047-1.75348,1.5433-2.17707,2.62689l-21.19891,55.31237-.21348.55493c-6.28158,16.38521-.92929,34.90803,13.05891,45.48782.02621.01641.04922.03611.07552.05582l.18719.14119,32.29094,24.17392,15.97151,12.09024,9.71951,7.34871c2.34117,1.77316,5.57877,1.77316,7.92002,0l9.71943-7.34871,15.96822-12.09024,32.48142-24.31511c.02958-.02299.05588-.04269.08538-.06568,13.97834-10.57977,19.32735-29.09604,13.04905-45.47796Z" />
      <path fill="#fc6d26" d="M265.26416,174.37243l-.2134-.55822c-10.5174,2.16062-20.20405,6.6099-28.49844,12.81593-.1346.0985-25.20497,19.05805-46.55171,35.19699,15.84998,11.98517,29.6477,22.40405,29.6477,22.40405l32.48142-24.31511c.02958-.02299.05588-.04269.08538-.06568,13.97834-10.57977,19.32735-29.09604,13.04905-45.47796Z" />
      <path fill="#fca326" d="M160.34962,244.23117l15.97151,12.09024,9.71951,7.34871c2.34117,1.77316,5.57877,1.77316,7.92002,0l9.71943-7.34871,15.96822-12.09024s-13.79772-10.41888-29.6477-22.40405c-15.85327,11.98517-29.65099,22.40405-29.65099,22.40405Z" />
      <path fill="#fc6d26" d="M143.44561,186.63014c-8.29111-6.20274-17.97446-10.65531-28.49507-12.81264l-.21348.55493c-6.28158,16.38521-.92929,34.90803,13.05891,45.48782.02621.01641.04922.03611.07552.05582l.18719.14119,32.29094,24.17392s13.79772-10.41888,29.65099-22.40405c-21.34673-16.13894-46.42031-35.09848-46.55499-35.19699Z" />
    </svg>
  );
}

interface GitLabSelfManagedCardProps {
  integration?: Integration;
  onMessage: (text: string, type: 'success' | 'error') => void;
  onDisconnect: (platform: string) => void;
  onRefresh: () => void;
}

export function GitLabSelfManagedCard({ integration, onMessage, onDisconnect, onRefresh }: GitLabSelfManagedCardProps) {
  const { t } = useTranslation('integrations');
  const connected = integration?.isConnected ?? false;
  const [host, setHost] = useState('');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);

  const handleConnect = useCallback(async () => {
    if (!host.trim() || !token.trim()) {
      onMessage(t('gitlabSelfManaged.hostAndTokenRequired'), 'error');
      return;
    }
    try {
      const data = await integrationsApi.connectGitLabSelfManaged(host.trim(), token.trim());
      if (data.success) {
        onMessage(t('gitlabSelfManaged.connected'), 'success');
        setHost('');
        setToken('');
        setTimeout(onRefresh, 500);
      } else {
        onMessage(data.error || 'Failed to connect', 'error');
      }
    } catch (err) {
      onMessage(`Failed to connect: ${(err as Error).message}`, 'error');
    }
  }, [host, token, onMessage, onRefresh, t]);

  return (
    <div className="rounded-sm border border-border-secondary bg-bg-tertiary p-5 transition-shadow hover:shadow-[var(--shadow-sm)]">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border-tertiary bg-bg-secondary overflow-hidden">
          <GitLabIcon />
        </div>
        <div className="text-base font-medium text-text-primary">{t('gitlabSelfManaged.name')}</div>
      </div>
      <div className="mb-4">
        <StatusDot
          connected={connected}
          label={connected ? `Connected${integration?.host ? ` - ${integration.host}` : ''}` : 'Not connected'}
        />
      </div>
      {connected ? (
        <button
          onClick={() => {
            if (confirm(t('gitlabSelfManaged.confirmDisconnect'))) onDisconnect('gitlab-self-managed');
          }}
          className="w-full rounded-sm bg-error-btn px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-error-btn-hover"
        >
          {t('common:actions.disconnect')}
        </button>
      ) : (
        <div className="space-y-4 border-t border-border-tertiary pt-4">
          <div>
            <label className="mb-2 block text-[13px] font-medium text-text-primary">
              {t('gitlabSelfManaged.hostLabel')}
            </label>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder={t('gitlabSelfManaged.hostPlaceholder')}
              className="w-full rounded-sm border border-border-primary bg-input-bg px-3 py-2.5 font-mono text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none focus:shadow-[var(--shadow-sm)]"
            />
          </div>
          <div>
            <label className="mb-2 block text-[13px] font-medium text-text-primary">
              {t('gitlabSelfManaged.tokenLabel')}
            </label>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={t('gitlabSelfManaged.tokenPlaceholder')}
                className="w-full rounded-sm border border-border-primary bg-input-bg px-3 py-2.5 pr-10 font-mono text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none focus:shadow-[var(--shadow-sm)]"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-sm border-0 bg-transparent text-text-secondary transition-colors hover:bg-border-primary hover:text-text-primary cursor-pointer"
              >
                {showToken ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
              </button>
            </div>
          </div>
          <button
            onClick={handleConnect}
            className="w-full rounded-sm bg-success-btn px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-success-btn-hover"
          >
            {t('common:actions.connect')}
          </button>
        </div>
      )}
    </div>
  );
}
