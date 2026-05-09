import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Bot } from 'lucide-react';
import type { SubAgent } from '../../../types/api';
import { highlightText, matchesSearch } from '../../../lib/utils';

const DESC_PREVIEW_LENGTH = 80;

interface SubagentsListProps {
  subagents: SubAgent[];
  search?: string;
}

export function SubagentsList({ subagents, search = '' }: SubagentsListProps) {
  const { t } = useTranslation('projects');

  const visible = subagents.filter((agent) =>
    matchesSearch(
      [agent.id, agent.description, ...agent.skills, ...agent.tools],
      search,
    ),
  );

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-text-primary">
        <Bot size={18} />
        <span>{t('detail.subagents')}</span>
        <span className="rounded-sm bg-bg-tertiary px-1.5 py-0.5 text-xs text-text-secondary">
          {visible.length}
        </span>
      </div>
      {visible.length === 0 ? (
        <div className="py-6 text-center text-xs text-text-tertiary">
          {search ? t('detail.noSubagentsMatch') : t('detail.noSubagents')}
        </div>
      ) : (
        <div className="space-y-1">
          {visible.map((agent) => (
            <SubagentItem key={agent.id} agent={agent} search={search} />
          ))}
        </div>
      )}
    </div>
  );
}

function SubagentItem({ agent, search }: { agent: SubAgent; search: string }) {
  const { t } = useTranslation('projects');
  const [expanded, setExpanded] = useState(false);

  const desc = agent.description || '';
  const descPreview =
    desc.length > DESC_PREVIEW_LENGTH
      ? desc.slice(0, DESC_PREVIEW_LENGTH) + '...'
      : desc;

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
          <span
            className="font-mono text-xs font-medium text-text-primary"
            dangerouslySetInnerHTML={{ __html: highlightText(agent.id, search) }}
          />
          {!expanded && (
            <div className="mt-0.5 truncate text-[11px] text-text-tertiary">
              {descPreview || t('subagents.noDescription')}
            </div>
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border-secondary px-3 pb-3 pt-2 text-xs">
          {desc && (
            <p
              className="mb-2 break-words leading-relaxed text-text-secondary"
              dangerouslySetInnerHTML={{ __html: highlightText(desc, search) }}
            />
          )}

          {agent.skills.length > 0 && (
            <div className="mb-2">
              <span className="font-medium text-text-primary">
                {t('subagents.skills')}:
              </span>{' '}
              <span className="text-text-secondary">
                {agent.skills.map((s, i) => (
                  <span key={s}>
                    {i > 0 && ', '}
                    <span dangerouslySetInnerHTML={{ __html: highlightText(s, search) }} />
                  </span>
                ))}
              </span>
            </div>
          )}

          {agent.tools.length > 0 && (
            <div className="mb-2">
              <span className="font-medium text-text-primary">
                {t('subagents.tools')}:
              </span>{' '}
              <span className="text-text-secondary">
                {agent.tools.map((tool, i) => (
                  <span key={tool}>
                    {i > 0 && ', '}
                    <span dangerouslySetInnerHTML={{ __html: highlightText(tool, search) }} />
                  </span>
                ))}
              </span>
            </div>
          )}

          {agent.instructions && (
            <div>
              <span className="font-medium text-text-primary">
                {t('subagents.instructions')}:
              </span>
              <pre className="mt-1 overflow-x-auto rounded-sm bg-bg-secondary p-2 font-mono text-[11px] leading-relaxed text-text-secondary">
                {agent.instructions}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
