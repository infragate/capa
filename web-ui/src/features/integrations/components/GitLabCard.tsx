import { FaGitlab } from 'react-icons/fa';
import type { Integration } from '../../../types/api';
import { integrationsApi } from '../api';
import { OAuthIntegrationCard } from './OAuthIntegrationCard';

interface GitLabCardProps {
  integration?: Integration;
  onMessage: (text: string, type: 'success' | 'error') => void;
  onDisconnect: (platform: string) => void;
}

export function GitLabCard(props: GitLabCardProps) {
  return (
    <OAuthIntegrationCard
      {...props}
      platform="gitlab"
      i18nKey="gitlab"
      icon={<FaGitlab className="h-8 w-8 text-[#fc6d26]" />}
      connectFn={integrationsApi.startGitLabOAuth}
    />
  );
}
