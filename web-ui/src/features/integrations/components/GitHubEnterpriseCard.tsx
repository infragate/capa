import { useState, useCallback } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Integration } from '../../../types/api';
import { integrationsApi } from '../api';
import { StatusDot } from '../../../components/common/StatusDot';
import { FaGithub } from 'react-icons/fa';

interface GitHubEnterpriseCardProps {
  integration?: Integration;
  onMessage: (text: string, type: 'success' | 'error') => void;
  onDisconnect: (platform: string, host?: string) => void;
  onRefresh: () => void;
}

export function GitHubEnterpriseCard({ integration, onMessage, onDisconnect, onRefresh }: GitHubEnterpriseCardProps) {
  const { t } = useTranslation('integrations');
  const connected = integration?.isConnected ?? false;
  const [host, setHost] = useState('');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);

  const handleConnect = useCallback(async () => {
    if (!host.trim() || !token.trim()) {
      onMessage(t('githubEnterprise.hostAndTokenRequired'), 'error');
      return;
    }
    try {
      const data = await integrationsApi.connectGitHubEnterprise(host.trim(), token.trim());
      if (data.success) {
        onMessage(t('githubEnterprise.connected'), 'success');
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
        <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border-tertiary bg-bg-secondary">
          <FaGithub className="h-8 w-8" />
        </div>
        <div className="text-base font-medium text-text-primary">{t('githubEnterprise.name')}</div>
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
            if (confirm(t('githubEnterprise.confirmDisconnect'))) onDisconnect('github-enterprise', integration?.host);
          }}
          className="w-full rounded-sm bg-error-btn px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-error-btn-hover"
        >
          {t('common:actions.disconnect')}
        </button>
      ) : (
        <div className="space-y-4 border-t border-border-tertiary pt-4">
          <div>
            <label className="mb-2 block text-[13px] font-medium text-text-primary">
              {t('githubEnterprise.hostLabel')}
            </label>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder={t('githubEnterprise.hostPlaceholder')}
              className="w-full rounded-sm border border-border-primary bg-input-bg px-3 py-2.5 font-mono text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none focus:shadow-[var(--shadow-sm)]"
            />
          </div>
          <div>
            <label className="mb-2 block text-[13px] font-medium text-text-primary">
              {t('githubEnterprise.tokenLabel')}
            </label>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={t('githubEnterprise.tokenPlaceholder')}
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
