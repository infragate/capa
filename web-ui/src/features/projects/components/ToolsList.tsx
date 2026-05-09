import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import type { EnrichedTool, ToolSchema } from '../../../types/api';
import { highlightText, matchesSearch } from '../../../lib/utils';
import { SourceBadge } from '../../../components/common/ServerBadge';

const DESC_PREVIEW_LENGTH = 80;

interface ToolsListProps {
  tools: EnrichedTool[];
  search: string;
  toolRequiredByMap: Record<string, string[]>;
  serverToolSchemaCache: Record<string, Record<string, ToolSchema>>;
}

function enrichTool(
  tool: EnrichedTool,
  cache: Record<string, Record<string, ToolSchema>>,
): EnrichedTool {
  if (tool.type !== 'mcp' || !tool.mcpServer || !tool.mcpTool) return tool;
  const serverId = tool.mcpServer.replace(/^@/, '');
  const serverCache = cache[serverId] || {};
  const schema = serverCache[tool.mcpTool];
  if (!schema) return tool;
  return {
    ...tool,
    _description: schema.description || '',
    _inputSchema: schema.inputSchema || {},
  };
}

export function ToolsList({ tools, search, toolRequiredByMap, serverToolSchemaCache }: ToolsListProps) {
  const { t } = useTranslation('projects');
  const enriched = tools.map((tool) => enrichTool(tool, serverToolSchemaCache));

  const visible = enriched.filter((tool) => {
    const desc = tool._description || '';
    const paramTexts = Object.entries(tool._inputSchema?.properties || {}).flatMap(([name, s]) => [
      name,
      s.description || '',
    ]);
    const cmdTexts =
      tool.type === 'command'
        ? [tool.command || '', ...(tool.commandArgs || []).flatMap((a) => [a.name, a.description || ''])]
        : [];
    const requiredBy = toolRequiredByMap[tool.id] || [];
    return matchesSearch([tool.id, desc, ...paramTexts, ...cmdTexts, ...requiredBy], search);
  });

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-text-primary">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
        <span>{t('detail.configuredTools')}</span>
        <span className="rounded-sm bg-bg-tertiary px-1.5 py-0.5 text-xs text-text-secondary">
          {visible.length}
        </span>
      </div>
      {visible.length === 0 ? (
        <div className="py-6 text-center text-xs text-text-tertiary">
          {search ? t('detail.noToolsMatch') : t('detail.noTools')}
        </div>
      ) : (
        <div className="space-y-1">
          {visible.map((tool) => (
            <ToolItem
              key={tool.id}
              tool={tool}
              search={search}
              requiredBy={toolRequiredByMap[tool.id] || []}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolItem({
  tool,
  search,
  requiredBy,
}: {
  tool: EnrichedTool;
  search: string;
  requiredBy: string[];
}) {
  const { t } = useTranslation('projects');
  const [expanded, setExpanded] = useState(false);

  const desc = tool._description || '';
  const descPreview = desc.length > DESC_PREVIEW_LENGTH
    ? desc.slice(0, DESC_PREVIEW_LENGTH) + '...'
    : desc;

  const paramEntries = (() => {
    let props: Record<string, { type?: string; description?: string }> = {};
    let req: string[] = [];

    if (tool.type === 'mcp' && tool._inputSchema?.properties) {
      props = tool._inputSchema.properties;
      req = tool._inputSchema.required || [];
    } else if (tool.type === 'command' && tool.commandArgs?.length) {
      for (const a of tool.commandArgs) {
        props[a.name] = { type: a.type || 'string', description: a.description || '' };
        if (a.required !== false) req.push(a.name);
      }
    }

    return { props, req, entries: Object.entries(props) };
  })();

  return (
    <div className="overflow-hidden rounded-sm border border-border-tertiary bg-bg-tertiary">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full cursor-pointer items-start gap-2 px-3 py-2 text-left hover:bg-hover-bg"
      >
        <ChevronRight
          size={14}
          className={`mt-0.5 shrink-0 text-text-tertiary transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="truncate font-mono text-xs font-medium text-text-primary"
              title={tool.id}
              dangerouslySetInnerHTML={{ __html: highlightText(tool.id, search) }}
            />
            <span className="shrink-0 rounded-sm bg-bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase text-text-tertiary">
              {tool.type}
            </span>
            {paramEntries.entries.length > 0 && (
              <span className="shrink-0 rounded-sm bg-bg-secondary px-1.5 py-0.5 text-[10px] text-text-tertiary">
                {paramEntries.entries.length} param{paramEntries.entries.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          {!expanded && descPreview && (
            <div className="mt-0.5 truncate text-[11px] text-text-tertiary" title={desc}>
              {descPreview}
            </div>
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border-secondary px-3 pb-3 pt-2">
          {tool.type === 'mcp' && tool.mcpServer && tool.mcpTool && (
            <div className="mb-2 flex items-center gap-1.5 text-xs text-text-secondary">
              <span className="text-text-tertiary">{t('tool.from')}</span>
              <SourceBadge name={tool.mcpServer.replace(/^@/, '')} kind="server" search={search} />
              <span className="text-text-tertiary">&rarr;</span>
              <span
                className="font-mono"
                dangerouslySetInnerHTML={{ __html: highlightText(tool.mcpTool, search) }}
              />
            </div>
          )}
          {tool.type === 'command' && tool.command && (
            <div className="mb-2 flex items-center gap-1.5 text-xs text-text-secondary">
              <span className="text-text-tertiary">{t('tool.cmd')}</span>
              <span dangerouslySetInnerHTML={{ __html: highlightText(tool.command, search) }} />
            </div>
          )}
          {desc && (
            <p
              className="mb-2 break-words text-xs leading-relaxed text-text-secondary"
              dangerouslySetInnerHTML={{ __html: highlightText(desc, search) }}
            />
          )}
          {paramEntries.entries.length > 0 && (
            <div className="space-y-1 border-l-2 border-border-tertiary pl-3">
              {paramEntries.entries.map(([name, schema]) => {
                const isRequired = paramEntries.req.includes(name);
                return (
                  <div key={name} className="text-xs">
                    <div className="flex flex-wrap items-baseline gap-1.5">
                      <span
                        className="font-mono font-medium text-text-primary"
                        dangerouslySetInnerHTML={{ __html: highlightText(name, search) }}
                      />
                      <span className="text-text-tertiary">{schema.type || 'any'}</span>
                      {isRequired && (
                        <span className="rounded-sm bg-accent-primary/10 px-1 py-px text-[10px] font-medium text-accent-primary">
                          required
                        </span>
                      )}
                    </div>
                    {schema.description && (
                      <p
                        className="mt-0.5 break-words text-text-secondary"
                        dangerouslySetInnerHTML={{ __html: highlightText(schema.description, search) }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {requiredBy.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px]">
              <span className="text-text-tertiary">{t('tool.requiredBy')}</span>
              {requiredBy.map((s) => (
                <span
                  key={s}
                  className="rounded-sm bg-accent-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-accent-primary"
                  dangerouslySetInnerHTML={{ __html: highlightText(s, search) }}
                />
              ))}
            </div>
          )}
          {tool.sourcePlugin?.name && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-text-tertiary">
              <span>from</span>
              <SourceBadge name={tool.sourcePlugin.name} kind="plugin" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
