import { Link } from 'react-router-dom';
import { GitBranch, BookOpen, Package } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FaGithub } from 'react-icons/fa';

export function NavLinks() {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-1">
      <Link
        to="/ui/registries"
        className="flex items-center gap-2 rounded-sm px-3 py-2 text-[13px] text-text-secondary no-underline transition-colors hover:bg-hover-bg"
        title={t('registries:nav.registries')}
      >
        <Package className="h-4 w-4" />
        <span>{t('registries:nav.registries')}</span>
      </Link>
      <Link
        to="/ui/integrations"
        className="flex items-center gap-2 rounded-sm px-3 py-2 text-[13px] text-text-secondary no-underline transition-colors hover:bg-hover-bg"
        title={t('nav.integrations')}
      >
        <GitBranch className="h-4 w-4" />
        <span>{t('nav.integrations')}</span>
      </Link>
      <a
        href="https://capa.infragate.ai"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 rounded-sm px-3 py-2 text-[13px] text-text-secondary no-underline transition-colors hover:bg-hover-bg"
        title={t('nav.docs')}
      >
        <BookOpen className="h-4 w-4" />
        <span>{t('nav.docs')}</span>
      </a>
      <a
        href="https://github.com/infragate/capa"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center rounded-sm p-2 text-text-secondary no-underline transition-colors hover:bg-hover-bg"
        title={t('nav.github')}
      >
        <FaGithub className="h-4 w-4" />
      </a>
    </div>
  );
}
