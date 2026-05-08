import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, Wrench, Server } from 'lucide-react';
import type { ResolvedPlugin, Skill, Tool, Server as ServerType } from '../../../types/api';
import { SourceBadge } from '../../../components/common/ServerBadge';

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

function GitLabIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M23.955 13.587l-1.342-4.135-2.664-8.189a.455.455 0 00-.867 0L16.418 9.45H7.582L4.919 1.263C4.783.84 4.261 0 3.7 0a.455.455 0 00-.432.263L.955 13.587a.924.924 0 00.331 1.023L12 21.054l10.715-6.444a.92.92 0 00.33-1.023" />
    </svg>
  );
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
    for (const p of plugins) {
      map[p.name] = { skills: 0, tools: 0, servers: 0 };
    }
    for (const s of skills) {
      if (s.sourcePlugin?.name && map[s.sourcePlugin.name]) map[s.sourcePlugin.name].skills++;
    }
    for (const t of tools) {
      if (t.sourcePlugin?.name && map[t.sourcePlugin.name]) map[t.sourcePlugin.name].tools++;
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
          const isGitHub = (plugin.repository || '').includes('github.com');
          const providerLabel =
            plugin.provider === 'cursor'
              ? 'Cursor'
              : plugin.provider === 'claude'
                ? 'Claude Code'
                : plugin.provider || '';
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
                      <GitHubIcon className="h-5 w-5" />
                    ) : (
                      <GitLabIcon className="h-5 w-5" />
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
