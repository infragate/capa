import { cleanCache, formatBytes, getCacheStats } from '../../shared/cache';

/**
 * Print a summary of the on-disk cache: location, total size, and per-repo
 * breakdown sorted by size descending.
 */
export async function cacheInfoCommand(): Promise<void> {
  const stats = getCacheStats();
  console.log(`Cache directory: ${stats.cacheDir}`);

  if (!stats.exists || stats.repos.length === 0) {
    console.log('  (empty — nothing cached yet)');
    return;
  }

  console.log(`Total size:      ${formatBytes(stats.totalBytes)}`);
  console.log(`Repositories:    ${stats.repos.length}`);
  console.log('');
  console.log('Per-repo breakdown (largest first):');

  for (const repo of stats.repos) {
    const totals = formatBytes(repo.totalBytes);
    const mirror = formatBytes(repo.mirrorBytes);
    const snaps = formatBytes(repo.snapshotBytes);
    console.log(`  ${repo.platform}:${repo.repoPath}`);
    console.log(`    total:     ${totals}`);
    console.log(`    mirror:    ${mirror}`);
    console.log(`    snapshots: ${snaps} (${repo.snapshotCount})`);
  }
}

/**
 * Wipe the entire on-disk cache.
 */
export async function cacheCleanCommand(): Promise<void> {
  const stats = getCacheStats();
  if (!stats.exists || stats.repos.length === 0) {
    console.log('Cache is already empty.');
    return;
  }

  const before = formatBytes(stats.totalBytes);
  cleanCache();
  console.log(`✓ Cleared cache (freed ${before}) at ${stats.cacheDir}`);
}
