import { useTranslation } from 'react-i18next';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Cpu, Plus, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import { getServerHue } from '../../../lib/utils';
import { errMessage } from '../../../lib/errors';
import { PROVIDER_DISPLAY_NAMES, getProviderDisplayName } from '../../../lib/providers';
import { usePutProviders } from '../hooks';

interface ProvidersSectionProps {
  providers: string[];
  projectId: string;
}

export function ProvidersSection({ providers, projectId }: ProvidersSectionProps) {
  const { t } = useTranslation('projects');
  const putMut = usePutProviders(projectId);
  const available = Object.keys(PROVIDER_DISPLAY_NAMES)
    .filter((id) => !providers.includes(id))
    .sort((a, b) => getProviderDisplayName(a).localeCompare(getProviderDisplayName(b)));

  return (
    <div className="mb-6 rounded-lg border border-border-primary bg-bg-secondary p-6">
      <div className="mb-4 flex items-start justify-between gap-3 border-b border-border-secondary pb-4">
        <div>
          <h2 className="text-base font-medium text-text-primary">{t('providers.title')}</h2>
          <p className="mt-1 text-xs text-text-tertiary">{t('providers.subtitle')}</p>
        </div>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              disabled={putMut.isPending || available.length === 0}
              title={t('providers.add')}
              aria-label={t('providers.add')}
              className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-text-secondary transition-colors hover:bg-hover-bg hover:text-text-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus size={16} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="ui-dropdown z-50 max-h-72 min-w-[180px] overflow-y-auto rounded-sm border border-border-primary bg-bg-secondary py-1 shadow-lg"
            >
              {available.map((id) => (
                <DropdownMenu.Item
                  key={id}
                  onSelect={() => putMut.mutate([...providers, id])}
                  className="flex w-full px-3 py-2 text-left text-xs text-text-primary outline-none hover:bg-hover-bg data-[highlighted]:bg-hover-bg cursor-pointer"
                >
                  {getProviderDisplayName(id)}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      {providers.length === 0 ? (
        <p className="text-xs text-text-tertiary">{t('providers.empty')}</p>
      ) : (
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
                <button
                  type="button"
                  disabled={putMut.isPending}
                  onClick={() => putMut.mutate(providers.filter((p) => p !== provider))}
                  title={t('providers.remove', { provider })}
                  aria-label={t('providers.remove', { provider })}
                  className="-mr-1 inline-flex items-center rounded-full p-0.5 opacity-70 transition-opacity hover:opacity-100 cursor-pointer disabled:cursor-not-allowed"
                >
                  <X size={10} />
                </button>
              </span>
            );
          })}
        </div>
      )}
      {putMut.error && (
        <p className="mt-3 text-xs text-error-text">{errMessage(putMut.error, 'Update failed')}</p>
      )}
    </div>
  );
}
