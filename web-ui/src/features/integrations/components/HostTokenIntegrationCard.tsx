import { useState, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ActionResponse, Integration } from '../../../types/api';
import { StatusDot } from '../../../components/common/StatusDot';

interface HostTokenIntegrationCardProps {
  integration?: Integration;
  onMessage: (text: string, type: 'success' | 'error') => void;
  onDisconnect: (platform: string, host?: string) => void;
  onRefresh: () => void;
  platform: string;
  /** i18n key prefix under `integrations` (e.g. `githubEnterprise`) */
  i18nKey: string;
  icon: ReactNode;
  connectFn: (host: string, token: string) => Promise<ActionResponse>;
}

export function HostTokenIntegrationCard({
  integration,
  onMessage,
  onDisconnect,
  onRefresh,
  platform,
  i18nKey,
  icon,
  connectFn,
}: HostTokenIntegrationCardProps) {
  const { t } = useTranslation('integrations');
  const connected = integration?.isConnected ?? false;
  const staleHost = !connected && integration?.host ? integration.host : '';
  const [host, setHost] = useState('');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);

  async function handleConnect() {
    if (!host.trim() || !token.trim()) {
      onMessage(t(`${i18nKey}.hostAndTokenRequired`), 'error');
      return;
    }
    try {
      const data = await connectFn(host.trim(), token.trim());
      if (data.success) {
        onMessage(t(`${i18nKey}.connected`), 'success');
        setHost('');
        setToken('');
        setTimeout(onRefresh, 500);
      } else {
        onMessage(data.error || 'Failed to connect', 'error');
      }
    } catch (err) {
      onMessage(`Failed to connect: ${(err as Error).message}`, 'error');
    }
  }

  function confirmDisconnect(hostArg?: string) {
    if (confirm(t(`${i18nKey}.confirmDisconnect`))) onDisconnect(platform, hostArg);
  }

  return (
    <div className="rounded-sm border border-border-secondary bg-bg-tertiary p-5 transition-shadow hover:shadow-[var(--shadow-sm)]">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-md border border-border-tertiary bg-bg-secondary">
          {icon}
        </div>
        <div className="text-base font-medium text-text-primary">{t(`${i18nKey}.name`)}</div>
      </div>
      <div className="mb-4">
        <StatusDot
          connected={connected}
          label={connected ? `Connected${integration?.host ? ` - ${integration.host}` : ''}` : 'Not connected'}
        />
      </div>
      {connected ? (
        <button
          onClick={() => confirmDisconnect(integration?.host)}
          className="w-full rounded-sm bg-error-btn px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-error-btn-hover"
        >
          {t('common:actions.disconnect')}
        </button>
      ) : (
        <div className="space-y-4 border-t border-border-tertiary pt-4">
          {staleHost && (
            <div className="flex items-center justify-between gap-2 rounded-sm border border-border-tertiary bg-bg-secondary px-3 py-2 text-xs text-text-secondary">
              <span>Saved credentials for {staleHost} are no longer valid.</span>
              <button
                type="button"
                onClick={() => confirmDisconnect(staleHost)}
                className="shrink-0 cursor-pointer text-error-text hover:underline"
              >
                Remove
              </button>
            </div>
          )}
          <div>
            <label className="mb-2 block text-[13px] font-medium text-text-primary">
              {t(`${i18nKey}.hostLabel`)}
            </label>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder={t(`${i18nKey}.hostPlaceholder`)}
              className="w-full rounded-sm border border-border-primary bg-input-bg px-3 py-2.5 font-mono text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none focus:shadow-[var(--shadow-sm)]"
            />
          </div>
          <div>
            <label className="mb-2 block text-[13px] font-medium text-text-primary">
              {t(`${i18nKey}.tokenLabel`)}
            </label>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={t(`${i18nKey}.tokenPlaceholder`)}
                className="w-full rounded-sm border border-border-primary bg-input-bg px-3 py-2.5 pr-10 font-mono text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none focus:shadow-[var(--shadow-sm)]"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent text-text-secondary transition-colors hover:bg-border-primary hover:text-text-primary"
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
