import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLinks } from './NavLinks';
import { ThemeToggle } from './ThemeToggle';

const logoSrc = document.getElementById('root')?.dataset.logo || '';

interface TopBarProps {
  title?: string;
  showBack?: boolean;
}

export function TopBar({ title, showBack }: TopBarProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const isHome = location.pathname === '/';

  return (
    <header className="sticky top-0 z-50 flex h-16 items-center border-b border-border-secondary bg-bg-secondary px-6 shadow-[var(--shadow-sm)]">
      <div className="flex w-full items-center gap-4">
        {showBack && (
          <Link
            to="/"
            className="flex items-center gap-1 rounded-sm px-3 py-2 text-sm text-text-secondary no-underline transition-colors hover:bg-hover-bg"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>{t('nav.back')}</span>
          </Link>
        )}
        <div className="flex flex-1 items-center gap-3 text-lg font-normal text-text-secondary">
          {logoSrc && (
            <span
              className="nav-logo inline-block h-6 w-6 shrink-0 bg-accent-primary"
              style={{
                WebkitMaskImage: `url(${logoSrc})`,
                maskImage: `url(${logoSrc})`,
                WebkitMaskSize: 'contain',
                maskSize: 'contain',
                WebkitMaskRepeat: 'no-repeat',
                maskRepeat: 'no-repeat',
              }}
            />
          )}
          <span className="font-medium tracking-tight text-accent-primary">{t('appName')}</span>
          {title && (
            <>
              <span className="text-text-tertiary">&rsaquo;</span>
              <span className="truncate">{title}</span>
            </>
          )}
          {isHome && !title && <span>{t('projects:title')}</span>}
        </div>
        <NavLinks />
        <ThemeToggle />
      </div>
    </header>
  );
}
