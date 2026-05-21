import { RegistryManager } from '../../shared/registries/manager';
import { getRegistriesDir } from '../../shared/config';
import { CAPA_DOCS_URL } from '../../shared/ui-urls';

export async function registryListCommand(): Promise<void> {
  const manager = new RegistryManager();
  const manifests = await manager.list();

  if (manifests.length === 0) {
    console.log('No registries configured.');
    console.log(`\nPlace .ts adapter files in: ${getRegistriesDir()}`);
    console.log(`See ${CAPA_DOCS_URL} for examples.`);
    return;
  }

  console.log(`Found ${manifests.length} registry(ies):\n`);

  for (const m of manifests) {
    console.log(`  ${m.name} (${m.id})`);
    if (m.description) console.log(`    ${m.description}`);
    if (m.homepage) console.log(`    Homepage: ${m.homepage}`);
    console.log(`    Capabilities: ${m.capabilities.join(', ')}`);
    console.log();
  }

  console.log(`Note: Registry adapters are executable TypeScript — only use files from sources you trust.`);
}

export async function registryPathCommand(): Promise<void> {
  console.log(getRegistriesDir());
}
