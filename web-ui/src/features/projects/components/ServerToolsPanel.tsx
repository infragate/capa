import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import type { ToolSchema } from '../../../types/api';
import { useServerTools } from '../hooks';
import { Spinner } from '../../../components/common/Spinner';
import { highlightText, matchesSearch } from '../../../lib/utils';

const DESC_PREVIEW_LENGTH = 80;

interface ServerToolsPanelProps {
  projectId: string;
  serverId: string;
  search?: string;
  prefetchedTools?: ToolSchema[];
}

export function ServerToolsPanel({ projectId, serverId, search = '', prefetchedTools }: ServerToolsPanelProps) {
  const { t } = useTranslation('projects');
  const { data: fetchedData, isLoading, error } = useServerTools(projectId, serverId);

  const tools = prefetchedTools ?? fetchedData ?? [];

  if (!prefetchedTools && isLoading) {
    return (
      <div className="mt-3 border-t border-border-tertiary pt-3">
        <Spinner className="py-4" label={t('status.loading', { ns: 'common' })} />
      </div>
    );
  }

  if (!prefetchedTools && error) {
    return (
      <div className="mt-3 border-t border-border-tertiary pt-3 text-xs text-error-text">
        {(error as Error).message || t('tool.serverUnreachable')}
      </div>
    );
  }

  if (!tools.length) {
    return (
      <div className="mt-3 border-t border-border-tertiary pt-3 text-xs text-text-tertiary">
        {t('tool.noToolsOnServer')}
      </div>
    );
  }

  const visible = search
    ? tools.filter((tool) => {
        const paramTexts = Object.entries(tool.inputSchema?.properties || {}).flatMap(
          ([name, s]) => [name, s.description || ''],
        );
        return matchesSearch([tool.name, tool.description, ...paramTexts], search);
      })
    : tools;

  if (search && visible.length === 0) {
    return (
      <div className="mt-3 border-t border-border-tertiary pt-3 text-xs text-text-tertiary">
        {t('detail.noToolsMatch')}
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-1 border-t border-border-tertiary pt-3">
      {visible.map((tool) => (
        <ToolCard key={tool.name} tool={tool} search={search} />
      ))}
    </div>
  );
}

function ToolCard({ tool, search }: { tool: ToolSchema; search: string }) {
  const props = tool.inputSchema?.properties || {};
  const required = tool.inputSchema?.required || [];
  const entries = Object.entries(props);
  const hasDetails = entries.length > 0;

  const isMatch = useMemo(() => {
    if (!search) return false;
    const paramTexts = entries.flatMap(([name, s]) => [name, s.description || '']);
    return matchesSearch([tool.name, tool.description, ...paramTexts], search);
  }, [search, tool, entries]);

  const [manualToggle, setManualToggle] = useState<boolean | null>(null);
  const expanded = manualToggle ?? (search ? isMatch : false);

  useEffect(() => {
    setManualToggle(null);
  }, [search]);

  const descPreview =
    tool.description && tool.description.length > DESC_PREVIEW_LENGTH
      ? tool.description.slice(0, DESC_PREVIEW_LENGTH) + '...'
      : tool.description;

  return (
    <div className="overflow-hidden rounded-sm border border-border-secondary bg-bg-secondary">
      <button
        type="button"
        onClick={() => setManualToggle(expanded ? false : true)}
        className="flex w-full cursor-pointer items-start gap-2 px-2.5 py-2 text-left hover:bg-hover-bg"
      >
        <ChevronRight
          size={14}
          className={`mt-px shrink-0 text-text-tertiary transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
        />
        <div className="min-w-0 flex-1">
          <span
            className="font-mono text-xs font-medium text-text-primary"
            dangerouslySetInnerHTML={{ __html: highlightText(tool.name, search) }}
          />
          {!expanded && descPreview && (
            <span className="ml-2 text-[11px] text-text-tertiary">{descPreview}</span>
          )}
        </div>
        {hasDetails && (
          <span className="shrink-0 rounded-sm bg-bg-tertiary px-1.5 py-px text-[10px] text-text-tertiary">
            {entries.length}
          </span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-border-tertiary px-2.5 pb-2.5 pt-2">
          {tool.description && (
            <p
              className="mb-2 break-words text-[11px] leading-relaxed text-text-secondary"
              dangerouslySetInnerHTML={{ __html: highlightText(tool.description, search) }}
            />
          )}
          {entries.length > 0 && (
            <div className="space-y-1 border-l-2 border-border-tertiary pl-2.5">
              {entries.map(([name, schema]) => {
                const isRequired = required.includes(name);
                return (
                  <div key={name} className="text-[11px]">
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
        </div>
      )}
    </div>
  );
}
