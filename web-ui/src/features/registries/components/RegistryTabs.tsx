import * as Tabs from '@radix-ui/react-tabs';
import type { RegistryManifest } from '../api';

interface RegistryTabsProps {
  registries: RegistryManifest[];
  selected: string;
  onSelect: (id: string) => void;
  children: React.ReactNode;
}

export function RegistryTabs({ registries, selected, onSelect, children }: RegistryTabsProps) {
  return (
    <Tabs.Root value={selected} onValueChange={onSelect}>
      <Tabs.List className="mb-4 flex gap-1 border-b border-border-secondary">
        {registries.map((r) => (
          <Tabs.Trigger
            key={r.id}
            value={r.id}
            className="inline-flex items-center gap-2 border-b-2 border-transparent px-4 py-2 text-sm text-text-secondary transition-colors hover:text-text-primary data-[state=active]:border-accent-primary data-[state=active]:text-text-primary"
          >
            {r.icon && (
              <img
                src={r.icon}
                alt=""
                className="h-4 w-4 shrink-0 rounded-sm object-contain"
              />
            )}
            {r.name}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {children}
    </Tabs.Root>
  );
}
