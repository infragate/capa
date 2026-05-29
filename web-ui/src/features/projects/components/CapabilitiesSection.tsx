import { useState, useMemo, useEffect } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Skill, Tool, Server, ToolSchema, EnrichedTool, SubAgent, Rule, Hook } from '../../../types/api';
import { SearchInput } from '../../../components/common/SearchInput';
import { SkillsList } from './SkillsList';
import { ToolsList } from './ToolsList';
import { ServersList } from './ServersList';
import { SubagentsList } from './SubagentsList';
import { RulesList } from './RulesList';
import { HooksList } from './HooksList';
import { TokenSavingsBar } from './TokenSavingsBar';
import { computeTokenSavings } from './tokenStats';
import { projectsApi } from '../api';

interface CapabilitiesSectionProps {
  skills: Skill[];
  tools: Tool[];
  servers: Server[];
  subagents: SubAgent[];
  rules: Rule[];
  hooks: Hook[];
  projectId: string;
}

export function CapabilitiesSection({ skills, tools, servers, subagents, rules, hooks, projectId }: CapabilitiesSectionProps) {
  const { t } = useTranslation('projects');
  const [search, setSearch] = useState('');

  const toolRequiredByMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const skill of skills) {
      for (const toolId of skill.requires || []) {
        if (!map[toolId]) map[toolId] = [];
        map[toolId].push(skill.id);
      }
    }
    return map;
  }, [skills]);

  const serverToolQueries = useQueries({
    queries: servers.map((server) => ({
      queryKey: ['server-tools', projectId, server.id] as const,
      queryFn: () => projectsApi.getServerTools(projectId, server.id),
      staleTime: 60_000,
      retry: false,
    })),
  });

  const serverToolSchemaCache = useMemo(() => {
    const cache: Record<string, Record<string, ToolSchema>> = {};
    servers.forEach((server, i) => {
      const query = serverToolQueries[i];
      if (query.data?.tools) {
        const map: Record<string, ToolSchema> = {};
        for (const tool of query.data.tools) {
          map[tool.name] = tool;
        }
        cache[server.id] = map;
      }
    });
    return cache;
  }, [servers, serverToolQueries]);

  const serverToolsMap = useMemo(() => {
    const map: Record<string, ToolSchema[]> = {};
    servers.forEach((server, i) => {
      const query = serverToolQueries[i];
      if (query.data?.tools) {
        map[server.id] = query.data.tools;
      }
    });
    return map;
  }, [servers, serverToolQueries]);

  const tokenSavings = useMemo(() => {
    if (servers.length === 0) return null;
    const allLoaded = serverToolQueries.every((q) => !q.isLoading);
    if (!allLoaded) return null;
    return computeTokenSavings(tools as EnrichedTool[], serverToolsMap, servers.length);
  }, [tools, servers, serverToolsMap, serverToolQueries]);

  if (
    skills.length === 0 &&
    tools.length === 0 &&
    servers.length === 0 &&
    subagents.length === 0 &&
    rules.length === 0 &&
    hooks.length === 0
  ) {
    return null;
  }

  return (
    <div className="mb-6 rounded-lg border border-border-primary bg-bg-secondary p-6">
      <div className="mb-4 flex items-center justify-between border-b border-border-secondary pb-4">
        <h2 className="text-base font-medium text-text-primary">{t('detail.capabilities')}</h2>
        <div className="w-64">
          <SearchInput
            placeholder={t('detail.searchPlaceholder')}
            value={search}
            onChange={setSearch}
          />
        </div>
      </div>

      {tokenSavings && <TokenSavingsBar stats={tokenSavings} />}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <SkillsList skills={skills} search={search} />
        <ToolsList
          tools={tools as EnrichedTool[]}
          search={search}
          toolRequiredByMap={toolRequiredByMap}
          serverToolSchemaCache={serverToolSchemaCache}
        />
        <ServersList servers={servers} search={search} projectId={projectId} serverToolsMap={serverToolsMap} />
        {subagents.length > 0 && <SubagentsList subagents={subagents} search={search} />}
        {rules.length > 0 && <RulesList rules={rules} search={search} />}
        {hooks.length > 0 && <HooksList hooks={hooks} search={search} />}
      </div>
    </div>
  );
}
