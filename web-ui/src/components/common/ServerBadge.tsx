import type { CSSProperties } from 'react';
import { Server, Puzzle } from 'lucide-react';
import { getServerHue, highlightText } from '../../lib/utils';

interface SourceBadgeProps {
  name: string;
  kind?: 'server' | 'plugin';
  search?: string;
}

const ICONS = {
  server: Server,
  plugin: Puzzle,
} as const;

export function SourceBadge({ name, kind = 'server', search }: SourceBadgeProps) {
  const hue = getServerHue(name);
  const style = { '--badge-hue': hue } as CSSProperties;
  const Icon = ICONS[kind];

  return (
    <span
      className="server-badge inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none"
      style={style}
    >
      <Icon size={10} className="shrink-0" />
      {search ? (
        <span dangerouslySetInnerHTML={{ __html: highlightText(name, search) }} />
      ) : (
        name
      )}
    </span>
  );
}

/** @deprecated Use SourceBadge instead */
export const ServerBadge = SourceBadge;
