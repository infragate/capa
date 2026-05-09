import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { integrationsApi } from './api';

export function useIntegrations() {
  return useQuery({
    queryKey: ['integrations'],
    queryFn: () => integrationsApi.list(),
    select: (data) => data.integrations,
  });
}

export function useDisconnectIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ platform, host }: { platform: string; host?: string }) =>
      integrationsApi.disconnect(platform, host),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations'] });
    },
  });
}
