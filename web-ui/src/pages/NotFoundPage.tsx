import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { TopBar } from '../components/layout/TopBar';
import { EmptyState } from '../components/common/EmptyState';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <>
      <TopBar showBack />
      <div className="flex min-h-[60vh] items-center justify-center">
        <EmptyState
          title={t('notFound.title')}
          description={
            <Link
              to="/"
              className="mt-2 inline-block text-accent-primary transition-colors hover:text-accent-hover"
            >
              {t('notFound.backToProjects')}
            </Link>
          }
        />
      </div>
    </>
  );
}
