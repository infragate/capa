import type { Capabilities } from '../../types/capabilities';
import { localApiHeaders } from './local-api';

export async function postProjectConfigure(opts: {
  serverUrl: string;
  projectId: string;
  capabilities: Capabilities;
  configureProviders: string[];
}): Promise<Record<string, unknown>> {
  const response = await fetch(
    `${opts.serverUrl}/api/projects/${encodeURIComponent(opts.projectId)}/configure`,
    {
      method: 'POST',
      headers: localApiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        ...opts.capabilities,
        providers: opts.configureProviders,
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to configure project: ${errorText}`);
  }

  return response.json();
}
