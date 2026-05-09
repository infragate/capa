import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Scale } from 'lucide-react';
import type { Rule } from '../../../types/api';
import { highlightText, matchesSearch } from '../../../lib/utils';
import { sourceTypeBadgeClasses } from './sourceTypeColors';

interface RulesListProps {
  rules: Rule[];
  search?: string;
}

export function RulesList({ rules, search = '' }: RulesListProps) {
  const { t } = useTranslation('projects');

  const visible = rules.filter((rule) =>
    matchesSearch(
      [rule.id, rule.description, rule.type, ...rule.providers, ...rule.appliesTo],
      search,
    ),
  );

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-text-primary">
        <Scale size={18} />
        <span>{t('detail.rules')}</span>
        <span className="rounded-sm bg-bg-tertiary px-1.5 py-0.5 text-xs text-text-secondary">
          {visible.length}
        </span>
      </div>
      {visible.length === 0 ? (
        <div className="py-6 text-center text-xs text-text-tertiary">
          {search ? t('detail.noRulesMatch') : t('detail.noRules')}
        </div>
      ) : (
        <div className="space-y-1">
          {visible.map((rule) => (
            <RuleItem key={rule.id} rule={rule} search={search} />
          ))}
        </div>
      )}
    </div>
  );
}

function RuleItem({ rule, search }: { rule: Rule; search: string }) {
  const { t } = useTranslation('projects');
  const [expanded, setExpanded] = useState(false);

  const typeColor = sourceTypeBadgeClasses(rule.type);

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
              title={rule.id}
              dangerouslySetInnerHTML={{ __html: highlightText(rule.id, search) }}
            />
            <span
              className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase ${typeColor}`}
            >
              {rule.type}
            </span>
          </div>
          {!expanded && rule.description && (
            <div className="mt-0.5 truncate text-[11px] text-text-tertiary" title={rule.description}>
              {rule.description}
            </div>
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border-secondary px-3 pb-3 pt-2 text-xs">
          {rule.description && (
            <p
              className="mb-2 break-words leading-relaxed text-text-secondary"
              dangerouslySetInnerHTML={{ __html: highlightText(rule.description, search) }}
            />
          )}

          <div className="space-y-1.5">
            <div className="flex items-baseline gap-2">
              <span className="font-medium text-text-primary">{t('rules.type')}:</span>
              <span className={`rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase ${typeColor}`}>
                {rule.type}
              </span>
            </div>

            <div className="flex items-baseline gap-2">
              <span className="font-medium text-text-primary">{t('rules.providers')}:</span>
              <span className="text-text-secondary">
                {rule.providers.length > 0
                  ? rule.providers.map((p, i) => (
                      <span key={p}>
                        {i > 0 && ', '}
                        <span dangerouslySetInnerHTML={{ __html: highlightText(p, search) }} />
                      </span>
                    ))
                  : t('rules.allProviders')}
              </span>
            </div>

            {rule.appliesTo.length > 0 && (
              <div className="flex items-baseline gap-2">
                <span className="font-medium text-text-primary">{t('rules.appliesTo')}:</span>
                <span className="font-mono text-text-secondary">
                  {rule.appliesTo.map((g, i) => (
                    <span key={g}>
                      {i > 0 && ', '}
                      <span dangerouslySetInnerHTML={{ __html: highlightText(g, search) }} />
                    </span>
                  ))}
                </span>
              </div>
            )}

            <div className="flex items-baseline gap-2">
              <span className="font-medium text-text-primary">{t('rules.alwaysApply')}:</span>
              <span className="text-text-secondary">
                {rule.alwaysApply ? 'Yes' : 'No'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
