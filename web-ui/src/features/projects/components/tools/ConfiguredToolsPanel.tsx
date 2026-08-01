import { useTranslation } from 'react-i18next';
import type { EnrichedTool, Skill, Tool, ToolSchema } from '../../../../types/api';
import { matchesSearch } from '../../../../lib/utils';
import { useDeleteCapability, useReorderCapability } from '../../hooks';
import { ReorderableList } from '../../../../components/common/ReorderableList';
import { configuredToolAnchor, isToolFocused } from './anchors';
import { ConfiguredToolCard } from './ConfiguredToolCard';

export function ConfiguredToolsPanel({
  projectId,
  tools,
  skills,
  search,
  toolRequiredByMap,
  serverToolSchemaCache,
  focusedAnchor,
  onSelectAnchor,
  onEditCommandTool,
}: {
  projectId: string;
  tools: EnrichedTool[];
  skills: Skill[];
  search: string;
  toolRequiredByMap: Record<string, string[]>;
  serverToolSchemaCache: Record<string, Record<string, ToolSchema>>;
  focusedAnchor: string | null;
  onSelectAnchor: (key: string) => void;
  onEditCommandTool: (tool: Tool) => void;
}) {
  const { t } = useTranslation('projects');
  const deleteMutation = useDeleteCapability(projectId);
  const reorderMutation = useReorderCapability(projectId);
  const searching = !!search.trim();

  const enriched = tools.map((tool) => {
    if (tool.type !== 'mcp' || !tool.mcpServer || !tool.mcpTool) return tool;
    const serverId = tool.mcpServer.replace(/^@/, '');
    const schema = serverToolSchemaCache[serverId]?.[tool.mcpTool];
    if (!schema) return tool;
    return {
      ...tool,
      _description: schema.description || '',
      _inputSchema: schema.inputSchema || {},
    };
  });

  const visible = enriched.filter((tool) => {
    const paramTexts = Object.entries(tool._inputSchema?.properties || {}).flatMap(
      ([name, s]) => [name, s.description || ''],
    );
    const requiredBy = toolRequiredByMap[tool.id] || [];
    return matchesSearch(
      [
        tool.id,
        tool.description,
        tool._description,
        tool.mcpTool,
        tool.mcpServer,
        tool.command,
        ...paramTexts,
        ...requiredBy,
      ],
      search,
    );
  });

  if (visible.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-text-tertiary">
        {search ? t('detail.noToolsMatch') : t('actions.emptyTools')}
      </div>
    );
  }

  return (
    <div
      data-tools-panel-scroll
      className="max-h-[520px] overflow-y-auto pr-1"
    >
      <div data-tools-panel-content>
        <ReorderableList
          items={visible}
          getId={(tool) => tool.id}
          disabled={searching}
          handleLabel={t('actions.dragToReorder')}
          className="space-y-2"
          onReorder={(ids) => reorderMutation.mutate({ section: 'tools', ids })}
          renderItem={(tool, { handle }) => (
            <ConfiguredToolCard
              projectId={projectId}
              tool={tool}
              skills={skills}
              search={search}
              requiredBy={toolRequiredByMap[tool.id] || []}
              focused={isToolFocused(tool, focusedAnchor)}
              onSelect={() => onSelectAnchor(configuredToolAnchor(tool))}
              onEditCommand={
                tool.type === 'command' ? () => onEditCommandTool(tool) : undefined
              }
              onDelete={() => {
                if (confirm(t('actions.confirmDeleteTool', { id: tool.id }))) {
                  deleteMutation.mutate({ section: 'tools', entryId: tool.id });
                }
              }}
              deleting={deleteMutation.isPending}
              dragHandle={handle}
            />
          )}
        />
      </div>
    </div>
  );
}
