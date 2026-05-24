import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Webhook } from 'lucide-react';
import type { Hook } from '../../../types/api';
import { highlightText, matchesSearch } from '../../../lib/utils';

interface HooksListProps {
  hooks: Hook[];
  search?: string;
}

export function HooksList({ hooks, search = '' }: HooksListProps) {
  const { t } = useTranslation('projects');

  const visible = hooks.filter((hook) =>
    matchesSearch(
      [hook.id, hook.description, hook.on, hook.type, ...hook.providers, hook.matcher],
      search,
    ),
  );

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-text-primary">
        <Webhook size={18} />
        <span>{t('detail.hooks')}</span>
        <span className="rounded-sm bg-bg-tertiary px-1.5 py-0.5 text-xs text-text-secondary">
          {visible.length}
        </span>
      </div>
      {visible.length === 0 ? (
        <div className="py-6 text-center text-xs text-text-tertiary">
          {search ? t('detail.noHooksMatch') : t('detail.noHooks')}
        </div>
      ) : (
        <div className="space-y-1">
          {visible.map((hook) => (
            <HookItem key={hook.id} hook={hook} search={search} />
          ))}
        </div>
      )}
    </div>
  );
}

function HookItem({ hook, search }: { hook: Hook; search: string }) {
  const { t } = useTranslation('projects');
  const [expanded, setExpanded] = useState(false);

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
              title={hook.id}
              dangerouslySetInnerHTML={{ __html: highlightText(hook.id, search) }}
            />
            <span className="shrink-0 rounded-sm bg-bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
              {hook.on}
            </span>
            <span className="shrink-0 rounded-sm bg-bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase text-text-secondary">
              {hook.type}
            </span>
          </div>
          {!expanded && hook.description && (
            <div className="mt-0.5 truncate text-[11px] text-text-tertiary" title={hook.description}>
              {hook.description}
            </div>
          )}
          {!expanded && hook.installed.length > 0 && (
            <div className="mt-0.5 truncate text-[11px] text-text-tertiary">
              {t('hooks.installedOn')}: {hook.installed.map((i) => i.providerId).join(', ')}
            </div>
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border-secondary px-3 pb-3 pt-2 text-xs">
          {hook.description && (
            <p
              className="mb-2 break-words leading-relaxed text-text-secondary"
              dangerouslySetInnerHTML={{ __html: highlightText(hook.description, search) }}
            />
          )}

          <div className="space-y-1.5">
            <div className="flex items-baseline gap-2">
              <span className="font-medium text-text-primary">{t('hooks.event')}:</span>
              <span className="font-mono text-text-secondary">{hook.on}</span>
            </div>

            <div className="flex items-baseline gap-2">
              <span className="font-medium text-text-primary">{t('hooks.providers')}:</span>
              <span className="text-text-secondary">
                {hook.providers.length > 0 ? hook.providers.join(', ') : t('hooks.allProviders')}
              </span>
            </div>

            {hook.matcher && (
              <div className="flex items-baseline gap-2">
                <span className="font-medium text-text-primary">{t('hooks.matcher')}:</span>
                <span className="font-mono text-text-secondary">{hook.matcher}</span>
              </div>
            )}

            {hook.timeout != null && (
              <div className="flex items-baseline gap-2">
                <span className="font-medium text-text-primary">{t('hooks.timeout')}:</span>
                <span className="text-text-secondary">{hook.timeout}s</span>
              </div>
            )}

            {hook.sourceType && (
              <div className="flex items-baseline gap-2">
                <span className="font-medium text-text-primary">{t('hooks.source')}:</span>
                <span className="text-text-secondary">{hook.sourceType}</span>
              </div>
            )}

            {hook.command && (
              <div className="flex flex-col gap-1">
                <span className="font-medium text-text-primary">{t('hooks.command')}:</span>
                <pre className="overflow-x-auto rounded-sm bg-bg-secondary px-2 py-1 font-mono text-[11px] text-text-secondary">
                  {hook.command}
                </pre>
              </div>
            )}

            {hook.prompt && (
              <div className="flex flex-col gap-1">
                <span className="font-medium text-text-primary">{t('hooks.prompt')}:</span>
                <pre className="overflow-x-auto whitespace-pre-wrap rounded-sm bg-bg-secondary px-2 py-1 font-mono text-[11px] text-text-secondary">
                  {hook.prompt}
                </pre>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}
