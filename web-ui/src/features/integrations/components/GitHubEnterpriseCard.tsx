import { useState, useCallback } from 'react';
import { Eye, EyeOff } from 'lucide-react';
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

interface GitHubEnterpriseCardProps {
  integration?: Integration;
  onMessage: (text: string, type: 'success' | 'error') => void;
  onDisconnect: (platform: string) => void;
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
          <GitHubIcon />
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
            if (confirm(t('githubEnterprise.confirmDisconnect'))) onDisconnect('github-enterprise');
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
