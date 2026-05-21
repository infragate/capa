import { CapaDatabase } from '../../db/database';
import { loadSettings, getDatabasePath, getManagedRegistriesDir } from '../../shared/config';
import { RegistryManager } from '../../shared/registries/manager';

export async function registryListCommand(): Promise<void> {
  const settings = await loadSettings();
  const db = new CapaDatabase(getDatabasePath(settings));
  try {
    const records = db.listRegistries();

    if (records.length === 0) {
      console.log('No registries configured.');
      console.log('\nAdd one with:');
      console.log('  capa registry add <source> [slug]');
      return;
    }

    const manager = new RegistryManager(db);
    const manifests = await manager.list();
    const manifestByLoadedSlug = new Map<string, { name: string; description?: string }>();
    for (const m of manifests) {
      manifestByLoadedSlug.set(m.id, { name: m.name, description: m.description });
    }

    console.log(`Found ${records.length} registry(ies):\n`);
    for (const r of records) {
      const loaded = manifestByLoadedSlug.get(r.slug);
      const flag =
        r.status === 'installed' && r.enabled ? 'ok' :
        r.status === 'failed' ? 'failed' :
        !r.enabled ? 'disabled' :
        r.status;
      const display = loaded?.name ?? r.slug;
      console.log(`  ${display} (${r.slug}) [${flag}]`);
      console.log(`    Type:   ${r.type}`);
      console.log(`    Source: ${r.source}`);
      if (r.resolvedRef) console.log(`    Ref:    ${r.resolvedRef.slice(0, 7)}`);
      if (loaded?.description) console.log(`    ${loaded.description}`);
      if (r.lastError) console.log(`    Error:  ${r.lastError}`);
      console.log();
    }

    console.log('Note: Registry adapters are executable TypeScript — only add sources you trust.');
  } finally {
    db.close();
  }
}

export async function registryPathCommand(): Promise<void> {
  console.log(getManagedRegistriesDir());
}
