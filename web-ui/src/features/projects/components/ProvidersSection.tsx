import { useTranslation } from 'react-i18next';
import { Cpu } from 'lucide-react';
import type { CSSProperties } from 'react';
import { getServerHue } from '../../../lib/utils';

interface ProvidersSectionProps {
  providers: string[];
}

export function ProvidersSection({ providers }: ProvidersSectionProps) {
  const { t } = useTranslation('projects');

  if (providers.length === 0) return null;

  return (
    <div className="mb-6 rounded-lg border border-border-primary bg-bg-secondary p-6">
      <div className="mb-4 border-b border-border-secondary pb-4">
        <h2 className="text-base font-medium text-text-primary">{t('providers.title')}</h2>
        <p className="mt-1 text-xs text-text-tertiary">{t('providers.subtitle')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {providers.map((provider) => {
          const hue = getServerHue(provider);
          const style = { '--badge-hue': hue } as CSSProperties;
          return (
            <span
              key={provider}
              className="server-badge inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none"
              style={style}
            >
              <Cpu size={10} className="shrink-0" />
              {provider}
            </span>
          );
        })}
      </div>
    </div>
  );
}
