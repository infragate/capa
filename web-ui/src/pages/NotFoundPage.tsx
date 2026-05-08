import { Link } from 'react-router-dom';
import { TopBar } from '../components/layout/TopBar';
import { EmptyState } from '../components/common/EmptyState';

export function NotFoundPage() {
  return (
    <>
      <TopBar showBack />
      <div className="flex min-h-[60vh] items-center justify-center">
        <EmptyState
          title="Page not found"
          description={
            <Link
              to="/"
              className="mt-2 inline-block text-accent-primary transition-colors hover:text-accent-hover"
            >
              Return to projects
            </Link>
          }
        />
      </div>
    </>
  );
}
