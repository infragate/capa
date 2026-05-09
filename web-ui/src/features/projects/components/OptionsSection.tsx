import { useTranslation } from 'react-i18next';
import { Settings } from 'lucide-react';
import type { CapabilitiesOptions } from '../../../types/api';

interface OptionsSectionProps {
  options: CapabilitiesOptions;
}

export function OptionsSection({ options }: OptionsSectionProps) {
  const { t } = useTranslation('projects');

  const hasContent =
    options.toolExposure ||
    options.security ||
    options.requiresCommands.length > 0;

  if (!hasContent) return null;

  return (
    <div className="mb-6 rounded-lg border border-border-primary bg-bg-secondary p-6">
      <div className="mb-4 border-b border-border-secondary pb-4">
        <h2 className="flex items-center gap-2 text-base font-medium text-text-primary">
          <Settings size={18} />
          {t('options.title')}
        </h2>
        <p className="mt-1 text-xs text-text-tertiary">{t('options.subtitle')}</p>
      </div>

      <div className="space-y-4">
        {options.toolExposure && (
          <div>
            <h3 className="mb-1 text-xs font-medium text-text-primary">
              {t('options.toolExposure')}
            </h3>
            <span className="rounded-sm bg-bg-tertiary px-2 py-1 text-xs text-text-secondary">
              {options.toolExposure}
            </span>
          </div>
        )}

        {options.security && (
          <div>
            <h3 className="mb-2 text-xs font-medium text-text-primary">
              {t('options.security')}
            </h3>
            <div className="space-y-2 rounded-sm border border-border-tertiary bg-bg-tertiary p-3">
              {options.security.blockedPhrases.length > 0 && (
                <div>
                  <span className="text-xs font-medium text-text-primary">
                    {t('options.blockedPhrases')}:
                  </span>
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
                <div className="text-xs">
                  <span className="font-medium text-text-primary">
                    {t('options.allowedCharacters')}:
                  </span>{' '}
                  <span className="font-mono text-text-secondary">
                    {options.security.allowedCharacters}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {options.requiresCommands.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-medium text-text-primary">
              {t('options.requiredCommands')}
            </h3>
            <div className="overflow-hidden rounded-sm border border-border-tertiary">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border-tertiary bg-bg-tertiary">
                    <th className="px-3 py-2 text-left font-medium text-text-primary">CLI</th>
                    <th className="px-3 py-2 text-left font-medium text-text-primary">
                      Description
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {options.requiresCommands.map((cmd) => (
                    <tr
                      key={cmd.cli}
                      className="border-b border-border-tertiary last:border-0"
                    >
                      <td className="px-3 py-2 font-mono text-text-primary">{cmd.cli}</td>
                      <td className="px-3 py-2 text-text-secondary">
                        {cmd.description || '\u2014'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
