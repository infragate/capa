import * as Tabs from '@radix-ui/react-tabs';
import { useTranslation } from 'react-i18next';

interface CapabilityTabsProps {
  capabilities: string[];
  selected: string;
  onSelect: (cap: string) => void;
  children: React.ReactNode;
}

export function CapabilityTabs({ capabilities, selected, onSelect, children }: CapabilityTabsProps) {
  const { t } = useTranslation('registries');

  return (
    <Tabs.Root value={selected} onValueChange={onSelect}>
      <Tabs.List className="mb-4 flex gap-1">
        {capabilities.map((cap) => (
          <Tabs.Trigger
            key={cap}
            value={cap}
            className="rounded-sm px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-hover-bg data-[state=active]:bg-accent-primary/10 data-[state=active]:text-accent-primary"
          >
            {t(`tabs.${cap}`, cap)}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {children}
    </Tabs.Root>
  );
}
