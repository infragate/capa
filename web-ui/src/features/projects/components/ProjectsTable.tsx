import { useTranslation } from 'react-i18next';
import type { ProjectSummary } from '../../../types/api';
import { projectDisplayName, formatDate } from '../../../lib/utils';

interface ProjectsTableProps {
  projects: ProjectSummary[];
}

export function ProjectsTable({ projects }: ProjectsTableProps) {
  const { t } = useTranslation('projects');

  return (
    <div className="overflow-hidden rounded-lg border border-border-primary bg-bg-secondary">
      <div className="grid grid-cols-[1fr_80px_80px_80px_140px] items-center border-b border-border-secondary px-5 py-3 text-xs font-medium uppercase tracking-wider text-text-tertiary max-md:hidden">
        <div>{t('columns.project')}</div>
        <div className="text-center">{t('columns.skills')}</div>
        <div className="text-center">{t('columns.tools')}</div>
        <div className="text-center">{t('columns.servers')}</div>
        <div className="text-right">{t('columns.lastUpdated')}</div>
      </div>
      <div>
        {projects.map((project) => (
          <ProjectRow key={project.id} project={project} />
        ))}
      </div>
    </div>
  );
}

function ProjectRow({ project }: { project: ProjectSummary }) {
  const name = projectDisplayName(project.path, project.id);

  return (
    <a
      href={`/ui/project?id=${encodeURIComponent(project.id)}`}
      className="grid grid-cols-[1fr_80px_80px_80px_140px] items-center border-b border-border-tertiary px-5 py-4 text-text-primary no-underline transition-colors hover:bg-hover-bg max-md:grid-cols-1 max-md:gap-2"
    >
      <div>
        <div className="mb-1 text-sm font-medium">{name}</div>
        <div className="truncate font-mono text-xs text-text-tertiary">{project.path}</div>
      </div>
      <div className="text-center text-sm text-text-secondary max-md:hidden">
        {project.skills_count}
      </div>
      <div className="text-center text-sm text-text-secondary max-md:hidden">
        {project.tools_count}
      </div>
      <div className="text-center text-sm text-text-secondary max-md:hidden">
        {project.servers_count}
      </div>
      <div className="text-right text-xs text-text-tertiary max-md:text-left">
        {formatDate(project.updated_at)}
      </div>
      <div className="hidden max-md:flex max-md:gap-4 max-md:text-xs max-md:text-text-tertiary">
        <span>{project.skills_count} skills</span>
        <span>{project.tools_count} tools</span>
        <span>{project.servers_count} servers</span>
      </div>
    </a>
  );
}
