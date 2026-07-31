import { useState, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bot,
  FileText,
  Plus,
  Puzzle,
  ScrollText,
  Sparkles,
  Webhook,
  Wrench,
} from 'lucide-react';
import type {
  AgentFileConfig,
  AuthoredPlugin,
  Hook,
  ResolvedPlugin,
  Rule,
  Server,
  Skill,
  SubAgent,
  Tool,
} from '../../../types/api';
import { SearchInput } from '../../../components/common/SearchInput';
import { matchesSearch } from '../../../lib/utils';
import { CapabilityCollapsible } from './CapabilityCollapsible';
import { SkillsList } from './SkillsList';
import { ToolsSection } from './ToolsSection';
import { RulesList } from './RulesList';
import { HooksList } from './HooksList';
import { SubagentsList } from './SubagentsList';
import { AgentsEditor } from './AgentsEditor';
import { PluginsEditor } from './PluginsEditor';
import { RegistryBrowseDialog } from './RegistryBrowseDialog';

function ToolsAddMenu({
  onAddServer,
  onAddCommandTool,
}: {
  onAddServer: () => void;
  onAddCommandTool: () => void;
}) {
  const { t } = useTranslation('projects');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t('actions.add')}
        aria-label={t('actions.add')}
        aria-expanded={open}
        className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-text-secondary transition-colors hover:bg-hover-bg hover:text-text-primary cursor-pointer"
      >
        <Plus size={16} />
      </button>
      {open && (
        <div className="ui-dropdown absolute right-0 top-full z-30 mt-1 min-w-[180px] overflow-hidden rounded-sm border border-border-primary bg-bg-secondary py-1 shadow-lg">
          <button
            type="button"
            className="flex w-full px-3 py-2 text-left text-xs text-text-primary hover:bg-hover-bg cursor-pointer"
            onClick={() => {
              setOpen(false);
              onAddServer();
            }}
          >
            {t('actions.addServer')}
          </button>
          <button
            type="button"
            className="flex w-full px-3 py-2 text-left text-xs text-text-primary hover:bg-hover-bg cursor-pointer"
            onClick={() => {
              setOpen(false);
              onAddCommandTool();
            }}
          >
            {t('actions.addCommandTool')}
          </button>
        </div>
      )}
    </div>
  );
}

interface CapabilitiesSectionProps {
  skills: Skill[];
  tools: Tool[];
  servers: Server[];
  subagents: SubAgent[];
  rules: Rule[];
  hooks: Hook[];
  agents: AgentFileConfig | null;
  plugins: AuthoredPlugin[];
  resolvedPlugins: ResolvedPlugin[];
  projectId: string;
}

export function CapabilitiesSection({
  skills,
  tools,
  servers,
  subagents,
  rules,
  hooks,
  agents,
  plugins,
  resolvedPlugins,
  projectId,
}: CapabilitiesSectionProps) {
  const { t } = useTranslation('projects');
  const [search, setSearch] = useState('');
  const [addSkillOpen, setAddSkillOpen] = useState(false);
  const [addServerOpen, setAddServerOpen] = useState(false);
  const [addCommandToolOpen, setAddCommandToolOpen] = useState(false);
  const [editServerOpen, setEditServerOpen] = useState(false);
  const [addRuleOpen, setAddRuleOpen] = useState(false);
  const [addHookOpen, setAddHookOpen] = useState(false);
  const [addSubagentOpen, setAddSubagentOpen] = useState(false);
  const [addPluginOpen, setAddPluginOpen] = useState(false);

  const q = search.trim();
  const searching = q.length > 0;

  const agentsCount =
    (agents?.base ? 1 : 0) + (agents?.additional?.length ?? 0);

  const forceOpen = useMemo(() => {
    if (!searching) {
      return {
        plugins: false,
        skills: false,
        tools: false,
        rules: false,
        hooks: false,
        agents: false,
        subagents: false,
      };
    }

    const agentsMatch =
      (agents?.base &&
        matchesSearch([agents.base.path, agents.base.ref, agents.base.type], q)) ||
      (agents?.additional || []).some((s) =>
        matchesSearch([s.id, s.content, s.path, s.url], q),
      );

    return {
      plugins: plugins.some((p) => matchesSearch([p.id, p.def?.repo], q)),
      skills: skills.some((s) => matchesSearch([s.id, s.description, s.path], q)),
      tools:
        servers.some((s) => {
          const cmdStr = s.cmd ? [s.cmd, ...(s.args || [])].join(' ') : '';
          return matchesSearch([s.id, s.displayName, s.url, cmdStr, s.description], q);
        }) ||
        tools.some((tool) =>
          matchesSearch([tool.id, tool.description, tool.mcpTool, tool.mcpServer, tool.command], q),
        ),
      rules: rules.some((r) => matchesSearch([r.id, r.description, r.content, r.path], q)),
      hooks: hooks.some((h) => matchesSearch([h.id, h.description, h.on, h.command, h.prompt], q)),
      agents: !!agentsMatch,
      subagents: subagents.some((s) =>
        matchesSearch([s.id, s.description, s.instructions, ...s.skills, ...s.tools], q),
      ),
    };
  }, [searching, q, plugins, skills, servers, tools, rules, hooks, agents, subagents]);

  const needsOAuthCount = useMemo(
    () => servers.filter((s) => s.requiresOAuth && !s.isConnected).length,
    [servers],
  );

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

      <CapabilityCollapsible
        title={t('detail.plugins')}
        icon={Puzzle}
        count={plugins.length}
        forceOpen={forceOpen.plugins}
        onAdd={() => setAddPluginOpen(true)}
        addLabel={t('actions.addPlugin')}
        dialog={
          <RegistryBrowseDialog
            open={addPluginOpen}
            onOpenChange={setAddPluginOpen}
            projectId={projectId}
            capability="plugins"
            title={t('actions.addPlugin')}
          />
        }
      >
        <PluginsEditor authored={plugins} resolved={resolvedPlugins} projectId={projectId} />
      </CapabilityCollapsible>

      <CapabilityCollapsible
        title={t('detail.skills')}
        icon={Sparkles}
        count={skills.length}
        forceOpen={forceOpen.skills}
        onAdd={() => setAddSkillOpen(true)}
        addLabel={t('actions.addSkill')}
        dialog={
          <RegistryBrowseDialog
            open={addSkillOpen}
            onOpenChange={setAddSkillOpen}
            projectId={projectId}
            capability="skills"
            title={t('actions.addSkill')}
            allowInline
            allowLocal
          />
        }
      >
        <SkillsList skills={skills} search={search} projectId={projectId} />
      </CapabilityCollapsible>

      <CapabilityCollapsible
        title={t('detail.toolsSection')}
        icon={Wrench}
        count={servers.length + tools.length}
        forceOpen={forceOpen.tools}
        keepMounted={addServerOpen || editServerOpen || addCommandToolOpen}
        badges={
          needsOAuthCount > 0 ? (
            <span className="rounded-sm bg-[hsl(40_80%_50%/0.15)] px-1.5 py-0.5 text-[10px] font-medium text-[hsl(40_80%_45%)]">
              {needsOAuthCount === 1
                ? t('actions.needsOAuth')
                : t('actions.needsOAuthCount', { count: needsOAuthCount })}
            </span>
          ) : null
        }
        actions={
          <ToolsAddMenu
            onAddServer={() => setAddServerOpen(true)}
            onAddCommandTool={() => setAddCommandToolOpen(true)}
          />
        }
      >
        <ToolsSection
          projectId={projectId}
          skills={skills}
          tools={tools}
          servers={servers}
          search={search}
          addServerOpen={addServerOpen}
          addCommandToolOpen={addCommandToolOpen}
          onAddServerOpenChange={setAddServerOpen}
          onAddCommandToolOpenChange={setAddCommandToolOpen}
          onEditServerOpenChange={setEditServerOpen}
        />
      </CapabilityCollapsible>

      <CapabilityCollapsible
        title={t('detail.rules')}
        icon={ScrollText}
        count={rules.length}
        forceOpen={forceOpen.rules}
        keepMounted={addRuleOpen}
        onAdd={() => setAddRuleOpen(true)}
        addLabel={t('actions.addRule')}
      >
        <RulesList
          rules={rules}
          search={search}
          projectId={projectId}
          addOpen={addRuleOpen}
          onAddOpenChange={setAddRuleOpen}
        />
      </CapabilityCollapsible>

      <CapabilityCollapsible
        title={t('detail.hooks')}
        icon={Webhook}
        count={hooks.length}
        forceOpen={forceOpen.hooks}
        keepMounted={addHookOpen}
        onAdd={() => setAddHookOpen(true)}
        addLabel={t('actions.addHook')}
      >
        <HooksList
          hooks={hooks}
          search={search}
          projectId={projectId}
          addOpen={addHookOpen}
          onAddOpenChange={setAddHookOpen}
        />
      </CapabilityCollapsible>

      <CapabilityCollapsible
        title={t('detail.agents')}
        icon={FileText}
        count={agentsCount}
        forceOpen={forceOpen.agents}
      >
        <AgentsEditor agents={agents} search={search} projectId={projectId} />
      </CapabilityCollapsible>

      <CapabilityCollapsible
        title={t('detail.subagents')}
        icon={Bot}
        count={subagents.length}
        forceOpen={forceOpen.subagents}
        keepMounted={addSubagentOpen}
        onAdd={() => setAddSubagentOpen(true)}
        addLabel={t('actions.addSubagent')}
      >
        <SubagentsList
          subagents={subagents}
          skills={skills}
          tools={tools}
          search={search}
          projectId={projectId}
          addOpen={addSubagentOpen}
          onAddOpenChange={setAddSubagentOpen}
        />
      </CapabilityCollapsible>
    </div>
  );
}
