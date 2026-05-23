import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, Wrench, Server } from 'lucide-react';
import type { ResolvedPlugin, Skill, Tool, Server as ServerType } from '../../../types/api';
import { SourceBadge } from '../../../components/common/ServerBadge';
import { getProviderDisplayName } from '../../../lib/providers';

import { FaGithub, FaGitlab } from 'react-icons/fa';

// Parse the URL and compare the host against an allowlist instead of a
// substring match, so an attacker-controlled `https://github.com.evil.tld/x`
// or `https://evil.tld/github.com/x` can't masquerade as a github.com repo.
function isGitHubRepoUrl(raw: string | undefined | null): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.hostname === 'github.com' || url.hostname.endsWith('.github.com');
  } catch {
    return false;
  }
}

interface PluginStats {
  skills: number;
  tools: number;
  servers: number;
}

interface PluginsSectionProps {
  plugins: ResolvedPlugin[];
  skills?: Skill[];
  tools?: Tool[];
  servers?: ServerType[];
}

export function PluginsSection({ plugins, skills = [], tools = [], servers = [] }: PluginsSectionProps) {
  const { t } = useTranslation('projects');

  const statsMap = useMemo(() => {
    const map: Record<string, PluginStats> = {};
    // Capa server id → plugin name (for counting user-declared tools that
    // reference plugin servers, since plugin tools are now user-declared).
    const serverIdToPluginName: Record<string, string> = {};
    for (const p of plugins) {
      map[p.name] = { skills: 0, tools: 0, servers: 0 };
      for (const id of p.serverIds ?? []) {
        serverIdToPluginName[id] = p.name;
      }
    }
    for (const s of skills) {
      if (s.sourcePlugin?.name && map[s.sourcePlugin.name]) map[s.sourcePlugin.name].skills++;
    }
    for (const t of tools) {
      // Prefer explicit attribution; fall back to server reference for user-declared MCP tools.
      if (t.sourcePlugin?.name && map[t.sourcePlugin.name]) {
        map[t.sourcePlugin.name].tools++;
      } else if (t.type === 'mcp' && t.mcpServer) {
        const serverId = t.mcpServer.replace(/^@/, '');
        const pluginName = serverIdToPluginName[serverId];
        if (pluginName && map[pluginName]) map[pluginName].tools++;
      }
    }
    for (const s of servers) {
      if (s.sourcePlugin?.name && map[s.sourcePlugin.name]) map[s.sourcePlugin.name].servers++;
    }
    return map;
  }, [plugins, skills, tools, servers]);

  if (!plugins.length) return null;

  return (
    <div className="mb-6 rounded-lg border border-border-primary bg-bg-secondary p-6">
      <div className="mb-4 border-b border-border-secondary pb-4">
        <h2 className="text-base font-medium text-text-primary">{t('detail.plugins')}</h2>
      </div>
      <p className="mb-6 text-[13px] leading-relaxed text-text-secondary">
        {t('detail.pluginsDescription')}
      </p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
        {plugins.map((plugin) => {
          const isGitHub = isGitHubRepoUrl(plugin.repository);
          const providerLabel = getProviderDisplayName(plugin.provider);
          const stats = statsMap[plugin.name];

          return (
            <div
              key={plugin.name}
              className="rounded-sm border border-border-secondary bg-bg-tertiary p-4"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="mb-1.5">
                    <SourceBadge name={plugin.name} kind="plugin" />
                  </div>
                  <div className="flex items-center gap-2 text-xs text-text-secondary">
                    {providerLabel && (
                      <span className="rounded-sm bg-bg-secondary px-1.5 py-0.5 text-[11px] font-medium uppercase">
                        {providerLabel}
                      </span>
                    )}
                    {plugin.version && <span>{plugin.version}</span>}
                  </div>
                </div>
                {plugin.repository && (
                  <a
                    href={plugin.repository}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-text-secondary transition-colors hover:text-text-primary"
                    title={isGitHub ? t('openOnGitHub') : t('openOnGitLab')}
                  >
                    {isGitHub ? (
                      <FaGithub className="h-5 w-5" />
                    ) : (
                      <FaGitlab className="h-5 w-5" />
                    )}
                  </a>
                )}
              </div>
              {stats && (stats.skills > 0 || stats.tools > 0 || stats.servers > 0) && (
                <div className="mt-3 flex items-center gap-3 border-t border-border-tertiary pt-3 text-[11px] text-text-tertiary">
                  {stats.skills > 0 && (
                    <span className="flex items-center gap-1">
                      <BookOpen size={12} />
                      {stats.skills} {stats.skills === 1 ? t('stat.skill') : t('stat.skills')}
                    </span>
                  )}
                  {stats.tools > 0 && (
                    <span className="flex items-center gap-1">
                      <Wrench size={12} />
                      {stats.tools} {stats.tools === 1 ? t('stat.tool') : t('stat.tools')}
                    </span>
                  )}
                  {stats.servers > 0 && (
                    <span className="flex items-center gap-1">
                      <Server size={12} />
                      {stats.servers} {stats.servers === 1 ? t('stat.server') : t('stat.servers')}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
