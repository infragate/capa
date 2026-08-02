import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import type { ProjectSummary } from '../../../types/api';
import { projectDisplayName, formatDate } from '../../../lib/utils';
import { useDeleteProject } from '../hooks';

interface ProjectsTableProps {
  projects: ProjectSummary[];
}

export function ProjectsTable({ projects }: ProjectsTableProps) {
  const { t } = useTranslation('projects');

  return (
    <div className="overflow-hidden rounded-lg border border-border-primary bg-bg-secondary">
      <div className="grid grid-cols-[1fr_80px_80px_80px_140px_72px] items-center border-b border-border-secondary px-5 py-3 text-xs font-medium uppercase tracking-wider text-text-tertiary max-md:hidden">
        <div>{t('columns.project')}</div>
        <div className="text-center">{t('columns.skills')}</div>
        <div className="text-center">{t('columns.tools')}</div>
        <div className="text-center">{t('columns.servers')}</div>
        <div className="text-right">{t('columns.lastUpdated')}</div>
        <div className="text-right">{t('columns.actions')}</div>
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
  const { t } = useTranslation('projects');
  const deleteProject = useDeleteProject();
  const name = projectDisplayName(project.path, project.id);

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(t('actions.confirmDeleteProject', { name }))) return;
    deleteProject.mutate(project.id);
  };

  return (
    <div className="grid grid-cols-[1fr_80px_80px_80px_140px_72px] items-center border-b border-border-tertiary px-5 py-4 text-text-primary transition-colors hover:bg-hover-bg max-md:grid-cols-[1fr_auto] max-md:gap-2">
      <Link
        to={`/ui/project?id=${encodeURIComponent(project.id)}`}
        className="min-w-0 no-underline text-inherit max-md:col-span-1"
      >
        <div className="mb-1 text-sm font-medium">{name}</div>
        <div className="truncate font-mono text-xs text-text-tertiary" title={project.path}>
          {project.path}
        </div>
      </Link>
      <div className="text-center text-sm text-text-secondary max-md:hidden">
        {project.skills_count}
      </div>
      <div className="text-center text-sm text-text-secondary max-md:hidden">
        {project.tools_count}
      </div>
      <div className="text-center text-sm text-text-secondary max-md:hidden">
        {project.servers_count}
      </div>
      <div className="text-right text-xs text-text-tertiary max-md:hidden">
        {formatDate(project.updated_at)}
      </div>
      <div className="flex justify-end max-md:row-start-1 max-md:col-start-2">
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleteProject.isPending}
          title={t('actions.deleteProject')}
          aria-label={t('actions.deleteProject')}
          className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-text-tertiary transition-colors hover:bg-error-bg hover:text-error-text cursor-pointer disabled:opacity-50"
        >
          <Trash2 size={16} />
        </button>
      </div>
      <div className="hidden max-md:col-span-2 max-md:flex max-md:gap-4 max-md:text-xs max-md:text-text-tertiary">
        <span>{project.skills_count} skills</span>
        <span>{project.tools_count} tools</span>
        <span>{project.servers_count} servers</span>
        <span>{formatDate(project.updated_at)}</span>
      </div>
    </div>
  );
}
