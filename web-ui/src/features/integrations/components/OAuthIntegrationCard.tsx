import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Integration, OAuthStartResponse } from '../../../types/api';
import { StatusDot } from '../../../components/common/StatusDot';

interface OAuthIntegrationCardProps {
  integration?: Integration;
  onMessage: (text: string, type: 'success' | 'error') => void;
  onDisconnect: (platform: string) => void;
  platform: string;
  /** i18n key prefix under `integrations` (e.g. `github`) */
  i18nKey: string;
  icon: ReactNode;
  connectFn: () => Promise<OAuthStartResponse>;
  /** Override connected status label (e.g. expiry text). Defaults to "Connected". */
  connectedLabel?: string;
}

export function OAuthIntegrationCard({
  integration,
  onMessage,
  onDisconnect,
  platform,
  i18nKey,
  icon,
  connectFn,
  connectedLabel = 'Connected',
}: OAuthIntegrationCardProps) {
  const { t } = useTranslation('integrations');
  const connected = integration?.isConnected ?? false;

  async function handleConnect() {
    try {
      const data = await connectFn();
      if (data.authorizationUrl) {
        window.location.href = data.authorizationUrl;
      } else {
        onMessage(data.error || t('common:errors.oauthFailed'), 'error');
      }
    } catch (err) {
      onMessage(`${t('common:errors.oauthFailed')}: ${(err as Error).message}`, 'error');
    }
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
        <StatusDot connected={connected} label={connected ? connectedLabel : 'Not connected'} />
      </div>
      {connected ? (
        <button
          onClick={() => {
            if (confirm(t(`${i18nKey}.confirmDisconnect`))) onDisconnect(platform);
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
          {t(`${i18nKey}.connectButton`)}
        </button>
      )}
    </div>
  );
}
