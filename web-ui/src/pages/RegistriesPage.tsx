import { useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Settings } from 'lucide-react';
import { TopBar } from '../components/layout/TopBar';
import { Page } from '../components/layout/Page';
import { Spinner } from '../components/common/Spinner';
import { RegistryTabs } from '../features/registries/components/RegistryTabs';
import { CapabilityTabs } from '../features/registries/components/CapabilityTabs';
import { SearchPane } from '../features/registries/components/SearchPane';
import { ItemDetail } from '../features/registries/components/ItemDetail';
import { useRegistries, useRegistrySearch } from '../features/registries/hooks';

export function RegistriesPage() {
  const { t } = useTranslation('registries');
  const { data: registries, isLoading } = useRegistries();
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedRegistry = searchParams.get('registry') ?? '';
  const selectedCapability = searchParams.get('capability') ?? '';
  const query = searchParams.get('q') ?? '';
  const selectedItemId = searchParams.get('item') || undefined;

  const updateParams = useCallback(
    (updates: Record<string, string | undefined>) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(updates)) {
          if (v === undefined || v === '') {
            next.delete(k);
          } else {
            next.set(k, v);
          }
        }
        return next;
      });
    },
    [setSearchParams],
  );

  // Auto-select first registry when loaded
  useEffect(() => {
    if (registries && registries.length > 0 && !selectedRegistry) {
      const first = registries[0];
      updateParams({
        registry: first.id,
        capability: first.capabilities[0],
      });
    }
  }, [registries, selectedRegistry, updateParams]);

  const activeRegistry = registries?.find((r) => r.id === selectedRegistry);

  // Auto-select first capability when registry changes and current cap is invalid
  useEffect(() => {
    if (
      activeRegistry &&
      activeRegistry.capabilities.length > 0 &&
      !activeRegistry.capabilities.includes(selectedCapability)
    ) {
      updateParams({ capability: activeRegistry.capabilities[0], q: undefined, item: undefined });
    }
  }, [activeRegistry, selectedCapability, updateParams]);

  const { data: searchResult, isLoading: isSearching } = useRegistrySearch(
    selectedRegistry || undefined,
    selectedCapability || undefined,
    query,
  );

  const handleRegistryChange = useCallback(
    (id: string) => updateParams({ registry: id, capability: undefined, q: undefined, item: undefined }),
    [updateParams],
  );

  const handleCapabilityChange = useCallback(
    (cap: string) => updateParams({ capability: cap, q: undefined, item: undefined }),
    [updateParams],
  );

  const handleQueryChange = useCallback(
    (q: string) => updateParams({ q: q || undefined, item: undefined }),
    [updateParams],
  );

  const handleItemSelect = useCallback(
    (id: string | undefined) => updateParams({ item: id }),
    [updateParams],
  );

  return (
    <>
      <TopBar title={t('title')} showBack />
      <Page
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Link
            to="/ui/registries/settings"
            className="inline-flex items-center gap-2 rounded-sm border border-border-primary bg-bg-tertiary px-3 py-1.5 text-sm text-text-primary no-underline transition-colors hover:bg-hover-bg"
            title={t('manageLink')}
          >
            <Settings className="h-4 w-4" />
            <span>{t('manageLink')}</span>
          </Link>
        }
      >
        {isLoading ? (
          <Spinner />
        ) : !registries || registries.length === 0 ? (
          <div className="rounded-lg border border-border-primary bg-bg-secondary p-8 text-center">
            <h3 className="mb-2 text-base font-medium text-text-primary">{t('empty.title')}</h3>
            <p className="mb-4 text-sm text-text-secondary">{t('empty.description')}</p>
            <Link
              to="/ui/registries/settings"
              className="inline-flex items-center rounded-sm border border-border-primary bg-bg-tertiary px-4 py-2 text-sm text-text-primary no-underline transition-colors hover:bg-hover-bg"
            >
              {t('empty.manageLink')}
            </Link>
          </div>
        ) : (
          <RegistryTabs
            registries={registries}
            selected={selectedRegistry}
            onSelect={handleRegistryChange}
          >
            {activeRegistry && (
              <CapabilityTabs
                capabilities={activeRegistry.capabilities}
                selected={selectedCapability}
                onSelect={handleCapabilityChange}
              >
                <div className="grid min-h-[calc(100vh-340px)] grid-cols-1 gap-6 lg:grid-cols-[380px_1fr]">
                  {/* Left: search + results — height driven by right column */}
                  <div className="relative min-h-[300px]">
                    <div className="absolute inset-0 flex flex-col overflow-hidden rounded-lg border border-border-primary bg-bg-secondary p-4">
                      <SearchPane
                        query={query}
                        onQueryChange={handleQueryChange}
                        items={searchResult?.items}
                        isLoading={isSearching}
                        selectedId={selectedItemId}
                        onSelect={handleItemSelect}
                        capability={selectedCapability}
                        registryName={activeRegistry.name}
                      />
                    </div>
                  </div>

                  {/* Right: detail pane — grows naturally, drives the row height */}
                  <div className="min-w-0 rounded-lg border border-border-primary bg-bg-secondary p-4">
                    <ItemDetail
                      registryId={selectedRegistry}
                      registryName={activeRegistry.name}
                      capability={selectedCapability}
                      itemId={selectedItemId}
                    />
                  </div>
                </div>
              </CapabilityTabs>
            )}
          </RegistryTabs>
        )}
      </Page>
    </>
  );
}
