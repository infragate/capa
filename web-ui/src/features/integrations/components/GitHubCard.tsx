import { FaGithub } from 'react-icons/fa';
import type { Integration } from '../../../types/api';
import { integrationsApi } from '../api';
import { OAuthIntegrationCard } from './OAuthIntegrationCard';

function formatExpiry(expiresAt: string | null): string {
  if (!expiresAt) return '';
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return '';
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days > 0) return `expires in ${days} day${days > 1 ? 's' : ''}`;
  return '';
}

interface GitHubCardProps {
  integration?: Integration;
  onMessage: (text: string, type: 'success' | 'error') => void;
  onDisconnect: (platform: string) => void;
}

export function GitHubCard({ integration, onMessage, onDisconnect }: GitHubCardProps) {
  const connected = integration?.isConnected ?? false;
  const expiryText = connected ? formatExpiry(integration?.expiresAt ?? null) : '';
  const connectedLabel = expiryText ? `Connected (${expiryText})` : 'Connected';

  return (
    <OAuthIntegrationCard
      integration={integration}
      onMessage={onMessage}
      onDisconnect={onDisconnect}
      platform="github"
      i18nKey="github"
      icon={<FaGithub className="h-8 w-8" />}
      connectFn={integrationsApi.startGitHubOAuth}
      connectedLabel={connectedLabel}
    />
  );
}
