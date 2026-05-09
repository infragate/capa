import type { ReactNode } from 'react';

interface PageProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function Page({ title, subtitle, children }: PageProps) {
  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8">
      <div className="mb-6">
        <h1 className="mb-2 text-[28px] font-normal text-text-primary">{title}</h1>
        {subtitle && (
          <p className="text-sm font-normal text-text-secondary">{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  );
}
