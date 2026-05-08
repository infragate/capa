import { useState, useMemo } from 'react';
import { FolderOpen, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TopBar } from '../components/layout/TopBar';
import { Page } from '../components/layout/Page';
import { SearchInput } from '../components/common/SearchInput';
import { EmptyState } from '../components/common/EmptyState';
import { Spinner } from '../components/common/Spinner';
import { ProjectsTable } from '../features/projects/components/ProjectsTable';
import { useProjects } from '../features/projects/hooks';

export function ProjectsListPage() {
  const { t } = useTranslation('projects');
  const { data: projects, isLoading, error } = useProjects();
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    if (!projects) return [];
    if (!filter) return projects;
    const q = filter.toLowerCase();
    return projects.filter(
      (p) =>
        p.id.toLowerCase().includes(q) ||
        p.path.toLowerCase().includes(q),
    );
  }, [projects, filter]);

  return (
    <>
      <TopBar />
      <Page title={t('title')} subtitle={t('subtitle')}>
        {isLoading ? (
          <Spinner label={t('status.loading', { ns: 'common' })} />
        ) : error ? (
          <EmptyState
            icon={<AlertCircle className="h-12 w-12" />}
            title={t('common:errors.loadFailed')}
            description={(error as Error).message}
          />
        ) : !projects?.length ? (
          <EmptyState
            icon={<FolderOpen className="h-12 w-12 stroke-[1.5]" />}
            title={t('empty.title')}
            description={
              <p>
                {t('empty.description').split('capa install').map((part, i, arr) =>
                  i < arr.length - 1 ? (
                    <span key={i}>
                      {part}
                      <code className="rounded-sm bg-code-bg px-1.5 py-0.5 font-mono text-xs">
                        capa install
                      </code>
                    </span>
                  ) : (
                    <span key={i}>{part}</span>
                  ),
                )}
              </p>
            }
          />
        ) : (
          <>
            <div className="mb-4">
              <SearchInput
                placeholder={t('filterPlaceholder')}
                value={filter}
                onChange={setFilter}
              />
            </div>
            {filtered.length === 0 ? (
              <EmptyState title={t('noResults.title')} description={t('noResults.description')} />
            ) : (
              <ProjectsTable projects={filtered} />
            )}
          </>
        )}
      </Page>
    </>
  );
}
