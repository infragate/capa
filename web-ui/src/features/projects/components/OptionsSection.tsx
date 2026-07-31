import { useState } from 'react';
import { Settings, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CapabilitiesOptions, RequiredCommand } from '../../../types/api';
import { usePatchOptions } from '../hooks';

interface OptionsSectionProps {
  projectId: string;
  options: CapabilitiesOptions | null;
}

const EXPOSURE_MODES = ['on-demand', 'expose-all', 'none'] as const;

export function OptionsSection({ projectId, options }: OptionsSectionProps) {
  const { t } = useTranslation('projects');
  const patchMutation = usePatchOptions(projectId);
  const [cli, setCli] = useState('');
  const [cliDesc, setCliDesc] = useState('');

  const toolExposure = options?.toolExposure || 'on-demand';
  const requiresCommands: RequiredCommand[] = options?.requiresCommands || [];

  return (
    <div className="mb-6 rounded-lg border border-border-primary bg-bg-secondary p-6">
      <div className="mb-4 border-b border-border-secondary pb-4">
        <h2 className="flex items-center gap-2 text-base font-medium text-text-primary">
          <Settings size={18} />
          {t('options.title')}
        </h2>
        <p className="mt-1 text-xs text-text-tertiary">{t('options.subtitle')}</p>
      </div>

      <div className="space-y-5">
        <div>
          <h3 className="mb-2 text-xs font-medium text-text-primary">{t('options.toolExposure')}</h3>
          <div className="flex flex-wrap gap-2">
            {EXPOSURE_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                disabled={patchMutation.isPending}
                onClick={() => patchMutation.mutate({ toolExposure: mode })}
                className={`rounded-sm px-2.5 py-1.5 text-xs cursor-pointer disabled:opacity-50 ${
                  toolExposure === mode
                    ? 'bg-accent-primary/15 text-accent-primary'
                    : 'bg-bg-tertiary text-text-secondary hover:bg-hover-bg'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-medium text-text-primary">
            {t('options.requiredCommands')}
          </h3>
          <div className="mb-2 space-y-1">
            {requiresCommands.length === 0 ? (
              <p className="text-xs text-text-tertiary">{t('actions.emptyCommands')}</p>
            ) : (
              requiresCommands.map((cmd) => (
                <div
                  key={cmd.cli}
                  className="flex items-center gap-2 rounded-sm border border-border-tertiary bg-bg-tertiary px-3 py-2"
                >
                  <span className="font-mono text-xs text-text-primary">{cmd.cli}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
                    {cmd.description || '—'}
                  </span>
                  <button
                    type="button"
                    disabled={patchMutation.isPending}
                    onClick={() =>
                      patchMutation.mutate({
                        requiresCommands: requiresCommands.filter((c) => c.cli !== cmd.cli),
                      })
                    }
                    className="rounded-sm p-1 text-text-tertiary hover:bg-error-bg hover:text-error-text cursor-pointer"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              value={cli}
              onChange={(e) => setCli(e.target.value)}
              placeholder="cli"
              className="w-32 rounded-sm border border-border-tertiary bg-bg-tertiary px-2 py-1.5 font-mono text-xs text-text-primary"
            />
            <input
              value={cliDesc}
              onChange={(e) => setCliDesc(e.target.value)}
              placeholder={t('actions.description')}
              className="min-w-0 flex-1 rounded-sm border border-border-tertiary bg-bg-tertiary px-2 py-1.5 text-xs text-text-primary"
            />
            <button
              type="button"
              disabled={!cli.trim() || patchMutation.isPending}
              onClick={() => {
                const next = [
                  ...requiresCommands.filter((c) => c.cli !== cli.trim()),
                  { cli: cli.trim(), description: cliDesc.trim() || null },
                ];
                patchMutation.mutate({ requiresCommands: next });
                setCli('');
                setCliDesc('');
              }}
              className="inline-flex items-center gap-1 rounded-sm border border-border-tertiary px-2.5 py-1.5 text-xs cursor-pointer hover:bg-hover-bg disabled:opacity-50"
            >
              <Plus size={14} />
              {t('actions.add')}
            </button>
          </div>
        </div>

        {options?.security && (
          <div>
            <h3 className="mb-2 text-xs font-medium text-text-primary">{t('options.security')}</h3>
            <div className="space-y-2 rounded-sm border border-border-tertiary bg-bg-tertiary p-3 text-xs text-text-secondary">
              {Array.isArray(options.security.blockedPhrases) &&
                options.security.blockedPhrases.length > 0 && (
                <div>
                  <span className="font-medium text-text-primary">{t('options.blockedPhrases')}:</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {options.security.blockedPhrases.map((phrase) => (
                      <span
                        key={phrase}
                        className="rounded-sm bg-error-bg px-1.5 py-0.5 font-mono text-[11px] text-error-text"
                      >
                        {phrase}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {options.security.allowedCharacters && (
                <div>
                  <span className="font-medium text-text-primary">
                    {t('options.allowedCharacters')}:
                  </span>{' '}
                  <span className="font-mono">{options.security.allowedCharacters}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
