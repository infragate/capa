import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname, basename, sep, relative, resolve, isAbsolute } from 'path';
import * as yaml from 'js-yaml';
import type { Rule } from '../../types/rules';
import { getAllProviders, getProvider } from '../../shared/providers';
import { buildRuleFrontmatter } from '../../shared/providers/handlers';
import { assertSafeRepoPath } from '../../shared/repo-file';
import {
  assertCapaOwnedInstallPath,
  isCapaOwnedInstallPath,
} from '../../shared/install-path-guard';
import {
  describeUnsafeCapabilityId,
  isSafeCapabilityId,
} from '../../shared/safe-id';
import { taskLog } from '../ui';
import {
  allIsolatedInstructionFilenames,
  planRulePlacement,
  renderPlannedRuleBody,
  type RuleConflictMode,
  type RuleDiagnostic,
} from './rules-placement';

const RULE_MARKER_PREFIX = 'rule:';

function ruleMarkerId(ruleId: string): string {
  return `${RULE_MARKER_PREFIX}${ruleId}`;
}

// ---------------------------------------------------------------------------
// YAML frontmatter builder
// ---------------------------------------------------------------------------

function buildYamlFrontmatter(fields: Record<string, unknown>): string {
  const lines: string[] = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 1) {
        lines.push(`${key}: ${value[0]}`);
      } else {
        lines.push(`${key}:`);
        for (const v of value) {
          lines.push(`  - ${v}`);
        }
      }
    } else if (typeof value === 'boolean') {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

/**
 * Provider-dialect names for the `appliesTo` rule concept (claude-code calls
 * it `paths`, Cursor `globs`, GitHub Copilot `applyTo`). Used to drop a
 * source file's already-translated synonym when capa is emitting its own.
 * Captured lazily so `getAllProviders()` is only walked once.
 */
let APPLIES_TO_SYNONYMS: Set<string> | null = null;
function appliesToSynonyms(): Set<string> {
  if (APPLIES_TO_SYNONYMS) return APPLIES_TO_SYNONYMS;
  APPLIES_TO_SYNONYMS = new Set(
    getAllProviders()
      .map((p) => p.rules?.fieldMap?.appliesTo)
      .filter((s): s is string => Boolean(s))
  );
  return APPLIES_TO_SYNONYMS;
}

/**
 * Permissive YAML load for rule frontmatter. Cursor-style `.mdc` files
 * allow unquoted glob values that strict YAML rejects as alias references
 * (anything starting with `*`), e.g. an unquoted `globs:` line. We retry
 * once with such values quoted so we can still merge surrounding metadata.
 */
function loadFrontmatterYaml(text: string): unknown {
  try {
    return yaml.load(text);
  } catch {
    const requoted = text.replace(
      /^([ \t]*[\w-]+[ \t]*:[ \t]*)(\*[^\n#]*?)(\s*)$/gm,
      (_m, prefix, value, trailing) =>
        `${prefix}"${(value as string).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"${trailing}`
    );
    if (requoted === text) return null;
    try {
      return yaml.load(requoted);
    } catch {
      return null;
    }
  }
}

/**
 * Parse a leading YAML frontmatter block (`---\n...\n---`) from `body`.
 * Returns the parsed object and the remaining body, or `null` if there is
 * no well-formed frontmatter (so the caller can leave `body` untouched).
 */
function parseLeadingFrontmatter(
  body: string
): { data: Record<string, unknown>; rest: string } | null {
  const m = body.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);
  if (!m) return null;
  const parsed = loadFrontmatterYaml(m[1]);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return { data: parsed as Record<string, unknown>, rest: body.slice(m[0].length) };
}

// ---------------------------------------------------------------------------
// Capa marker-block helpers (self-contained to avoid circular imports)
// ---------------------------------------------------------------------------

const MARKER_START = (id: string) => `<!-- capa:start:${id} -->`;
const MARKER_END = (id: string) => `<!-- capa:end:${id} -->`;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function markerBlockRe(id: string): RegExp {
  return new RegExp(
    `${escapeRegex(MARKER_START(id))}[\\s\\S]*?${escapeRegex(MARKER_END(id))}`,
    'g'
  );
}

function buildBlock(id: string, body: string): string {
  return `${MARKER_START(id)}\n${body.trimEnd()}\n${MARKER_END(id)}`;
}

function upsertBlock(content: string, id: string, body: string): string {
  const block = buildBlock(id, body);
  if (markerBlockRe(id).test(content)) {
    return content.replace(markerBlockRe(id), block);
  }
  const base = content.trimEnd();
  return base.length > 0 ? `${base}\n\n${block}\n` : `${block}\n`;
}

function removeBlock(content: string, id: string): string {
  return content.replace(markerBlockRe(id), '').replace(/\n{3,}/g, '\n\n');
}

function listMarkerIds(content: string): string[] {
  const ids: string[] = [];
  const re = /<!-- capa:start:([^>]+?) -->/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    ids.push(match[1]);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

function readMd(projectPath: string, filename: string): string {
  const filePath = join(projectPath, filename);
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
}

function writeMd(projectPath: string, filename: string, content: string): void {
  const dir = dirname(join(projectPath, filename));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(projectPath, filename), content, 'utf8');
}

// ---------------------------------------------------------------------------
// Managed-path helpers
// ---------------------------------------------------------------------------

/**
 * True when `filePath` is a capa-managed rule file for one of the given providers
 * (under `provider.rules.dir` with the provider's extension).
 */
export function isProviderRulesManagedPath(
  projectPath: string,
  filePath: string,
  providers: string[]
): boolean {
  for (const pid of providers) {
    const provider = getProvider(pid);
    if (!provider?.rules) continue;
    const rulesDir = join(projectPath, provider.rules.dir);
    const dirPrefix = rulesDir.endsWith(sep) ? rulesDir : rulesDir + sep;
    if (!filePath.startsWith(dirPrefix)) continue;
    if (!filePath.endsWith(provider.rules.extension)) continue;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface InstallRulesOptions {
  /**
   * Invoked once per rule file actually written to disk by a directory-based
   * provider (e.g. `.cursor/rules/git.mdc`). Use this to register the file in
   * the managed-files DB so `capa clean` and `capa install` can prune it
   * later when the rule is removed from the capabilities file.
   *
   * Marker-block rules (folded into AGENTS.md / CLAUDE.md) do not invoke this
   * callback — they're tracked via the inline marker pattern instead.
   */
  onFileWritten?: (filePath: string) => void;
  /**
   * Invoked with the absolute path of each nested or isolated instructions
   * file (e.g. `src/AGENTS.md`, `GEMINI.md`) that received rule blocks, so
   * prune/clean can find it after the rule's scope changes.
   */
  onInstructionTargetWritten?: (filePath: string) => void;
  /**
   * Every active provider. Decides who reads a shared instructions file.
   * Defaults to `providers`; pass the full set when installing for a subset.
   */
  readerProviders?: string[];
  conflicts?: RuleConflictMode;
  /** Suppress per-file success logs (e.g. wrap warm refresh). */
  quiet?: boolean;
}

export interface InstallRulesResult {
  /** Placement conflicts from the plan. Callers decide how to surface them. */
  diagnostics: RuleDiagnostic[];
  /** Non-fatal write problems (e.g. a nested target directory is missing). */
  warnings: string[];
}

/**
 * Install rules for all active providers.
 *
 * For providers with a `rules` integration (e.g. Cursor `.cursor/rules/*.mdc`):
 *   writes each rule as a separate file with optional YAML frontmatter.
 *
 * For providers without a `rules` integration but with `instructions`:
 *   folds each rule into the instructions file(s) chosen by
 *   {@link planRulePlacement} — root, nested `dir/<file>` for directory
 *   globs, or a provider's isolated file.
 *
 * @param resolvedContent - Map from rule.id to the already-fetched rule body text.
 */
export function installRules(
  projectPath: string,
  rules: Rule[],
  providers: string[],
  resolvedContent: Map<string, string>,
  options: InstallRulesOptions = {}
): InstallRulesResult {
  const warnings: string[] = [];
  const plan = planRulePlacement({
    rules,
    readerProviders: options.readerProviders ?? providers,
    targetProviders: providers,
    conflicts: options.conflicts,
  });
  // A rule with an error-level conflict is skipped for every provider, native
  // rules directories included.
  const skipped = skippedRuleIds(plan.diagnostics);

  for (const pid of providers) {
    const provider = getProvider(pid);
    if (!provider?.rules) continue;

    const applicableRules = rules.filter((r) => {
      if (skipped.has(r.id)) return false;
      if (!r.providers || r.providers.length === 0) return true;
      return r.providers.includes(pid);
    });

    if (applicableRules.length === 0) continue;

    const rulesDir = join(projectPath, provider.rules.dir);
    assertCapaOwnedInstallPath(projectPath, rulesDir);
    mkdirSync(rulesDir, { recursive: true });

    for (const rule of applicableRules) {
      if (!isSafeCapabilityId(rule.id)) {
        taskLog(`  ⚠ Skipping rule "${rule.id}": ${describeUnsafeCapabilityId('Rule', rule.id)}`);
        continue;
      }

      const content = resolvedContent.get(rule.id);
      if (!content) continue;

      let fileContent = '';
      let body = content;
      if (provider.rules.frontmatter === 'yaml' && provider.rules.fieldMap) {
        const fm = buildRuleFrontmatter(provider.rules, rule);
        const parsed = parseLeadingFrontmatter(body);
        if (parsed) {
          body = parsed.rest;
          // Merge source extras after capa's fields: capa wins on literal-key
          // collisions, and any source synonym for an `appliesTo` field capa
          // already emitted (e.g. source `globs:` when capa wrote `paths:`)
          // is dropped so the same concept isn't duplicated.
          const appliesToKey = provider.rules.fieldMap.appliesTo;
          const capaEmitsAppliesTo = !!appliesToKey && appliesToKey in fm;
          const synonyms = capaEmitsAppliesTo ? appliesToSynonyms() : null;
          for (const [k, v] of Object.entries(parsed.data)) {
            if (k in fm) continue;
            if (synonyms?.has(k)) continue;
            fm[k] = v;
          }
        }
        if (Object.keys(fm).length > 0) {
          fileContent = buildYamlFrontmatter(fm) + '\n';
        }
      }
      fileContent += body;
      if (!fileContent.endsWith('\n')) fileContent += '\n';

      const filePath = assertSafeRepoPath(
        rulesDir,
        `${rule.id}${provider.rules.extension}`,
      );
      assertCapaOwnedInstallPath(projectPath, filePath);
      writeFileSync(filePath, fileContent, 'utf-8');
      if (!options.quiet) {
        taskLog(`  ✓ ${provider.rules.dir}/${rule.id}${provider.rules.extension} written (${provider.displayName})`);
      }
      options.onFileWritten?.(filePath);
    }
  }

  for (const [relPath, planned] of sortedEntries(plan.blocks)) {
    const blocks = planned.filter((block) => {
      if (isSafeCapabilityId(block.ruleId)) return resolvedContent.has(block.ruleId);
      taskLog(`  ⚠ Skipping rule "${block.ruleId}": ${describeUnsafeCapabilityId('Rule', block.ruleId)}`);
      return false;
    });
    if (blocks.length === 0) continue;

    const filePath = join(projectPath, relPath);
    const nested = !plan.layout.files.has(relPath);
    if (nested) {
      if (!existsSync(dirname(filePath))) {
        warnings.push(
          `Skipped ${relPath}: directory ${dirname(relPath)} does not exist ` +
            `(rules ${blocks.map((b) => `"${b.ruleId}"`).join(', ')}).`,
        );
        continue;
      }
      try {
        assertCapaOwnedInstallPath(projectPath, filePath);
      } catch (err: unknown) {
        warnings.push(`Skipped ${relPath}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
    }

    let mdContent = readMd(projectPath, relPath);
    for (const block of blocks) {
      const body = renderPlannedRuleBody(block, resolvedContent.get(block.ruleId)!);
      mdContent = upsertBlock(mdContent, ruleMarkerId(block.ruleId), body);
    }
    writeMd(projectPath, relPath, mdContent);
    if (!isDefaultInstructionsFilename(relPath)) {
      options.onInstructionTargetWritten?.(filePath);
    }
    if (!options.quiet) {
      const readers = (plan.layout.files.get(basename(relPath)) ?? [])
        .map((pid) => getProvider(pid)?.displayName ?? pid)
        .join(', ');
      taskLog(`  ✓ ${relPath} updated with ${blocks.length} rule(s) (${readers})`);
    }
  }

  return { diagnostics: plan.diagnostics, warnings };
}

export interface PruneRulesOptions {
  /** Absolute paths from {@link InstallRulesOptions.onInstructionTargetWritten}. */
  trackedInstructionTargets?: string[];
  conflicts?: RuleConflictMode;
}

export interface PruneRulesResult {
  /**
   * Absolute paths of rule files removed from disk during the prune.
   * Callers should drop these from the managed-files DB.
   */
  removedFiles: string[];
  /** Rule IDs whose marker blocks were stripped from instruction files. */
  removedMarkers: string[];
  /**
   * Tracked instruction targets that no longer hold rule blocks. Callers
   * should drop these from the managed-instruction-targets DB.
   */
  removedInstructionTargets: string[];
  /** Placement conflicts for the current rules (same plan install uses). */
  diagnostics: RuleDiagnostic[];
}

/**
 * Bring on-disk rules state in sync with the capabilities file by removing
 * rule artifacts that no longer correspond to a rule in `currentRules`.
 *
 * For directory-based providers (`provider.rules`):
 *   Iterates `previouslyManagedFiles`. Any file inside the provider's rules
 *   directory whose `<basename>{extension}` does not correspond to a current
 *   rule for that provider is deleted. User-authored files are never touched
 *   because we only consider files capa explicitly registered.
 *
 * For instruction-folded providers:
 *   Builds one placement plan for all providers and scans every candidate
 *   file (root instruction files, isolated files, tracked nested targets).
 *   Any `<!-- capa:start:rule:<id> -->` block not planned for that exact path
 *   is removed, and a file left empty is deleted. Because the plan covers all
 *   providers at once, the result doesn't depend on provider order.
 *
 * Safe to call when `currentRules` is empty — every previously-installed
 * rule artifact will be removed in that case (which is exactly what `capa
 * install` should do after the user comments out the entire rules section).
 */
export function pruneRules(
  projectPath: string,
  providers: string[],
  currentRules: Rule[],
  previouslyManagedFiles: string[],
  options: PruneRulesOptions = {}
): PruneRulesResult {
  const removedFiles: string[] = [];
  const removedMarkers: string[] = [];
  const removedInstructionTargets: string[] = [];
  const plan = planRulePlacement({
    rules: currentRules,
    readerProviders: providers,
    conflicts: options.conflicts,
  });
  const skipped = skippedRuleIds(plan.diagnostics);

  for (const pid of providers) {
    const provider = getProvider(pid);
    if (!provider?.rules) continue;

    const desiredForProvider = new Set<string>();
    for (const r of currentRules) {
      if (skipped.has(r.id)) continue;
      if (!r.providers || r.providers.length === 0 || r.providers.includes(pid)) {
        desiredForProvider.add(r.id);
      }
    }

    const rulesDir = join(projectPath, provider.rules.dir);
    const ext = provider.rules.extension;
    // `+ sep` so `.cursor/rules/foo` doesn't match `.cursor/rules-old/foo`.
    const dirPrefix = rulesDir.endsWith(sep) ? rulesDir : rulesDir + sep;

    for (const file of previouslyManagedFiles) {
      if (!file.startsWith(dirPrefix)) continue;
      if (!file.endsWith(ext)) continue;
      const ruleId = basename(file).slice(0, -ext.length);
      if (desiredForProvider.has(ruleId)) continue;

      if (existsSync(file)) {
        try {
          unlinkSync(file);
          taskLog(`  ✓ Removed orphan rule ${provider.rules.dir}/${basename(file)} (${provider.displayName})`);
        } catch (err: any) {
          console.error(`  ✗ Failed to remove orphan rule ${file}: ${err.message}`);
          // Skip DB cleanup if the file still exists on disk so we'll retry next install.
          continue;
        }
      }
      removedFiles.push(file);
    }
  }

  const tracked = new Map<string, string>();
  for (const abs of options.trackedInstructionTargets ?? []) {
    const rel = projectRelativePath(projectPath, abs);
    if (rel) tracked.set(rel, abs);
  }

  for (const relPath of instructionCandidates(providers, [...tracked.keys()])) {
    const desired = new Set((plan.blocks.get(relPath) ?? []).map((b) => b.ruleId));
    const filePath = join(projectPath, relPath);
    if (!existsSync(filePath)) continue;
    if (!isDefaultInstructionsFilename(relPath) && !isCapaOwnedInstallPath(projectPath, filePath)) {
      continue;
    }

    const mdContent = readMd(projectPath, relPath);
    let updated = mdContent;
    let removedHere = 0;
    for (const markerId of listMarkerIds(mdContent)) {
      if (!markerId.startsWith(RULE_MARKER_PREFIX)) continue;
      const ruleId = markerId.slice(RULE_MARKER_PREFIX.length);
      if (desired.has(ruleId)) continue;
      updated = removeBlock(updated, markerId);
      removedHere++;
      removedMarkers.push(ruleId);
    }
    if (removedHere > 0) {
      writeOrDeleteMd(projectPath, relPath, updated);
      taskLog(`  ✓ Removed ${removedHere} orphan rule block(s) from ${relPath}`);
    }
  }

  for (const [relPath, abs] of tracked) {
    const content = readMd(projectPath, relPath);
    if (!listMarkerIds(content).some((id) => id.startsWith(RULE_MARKER_PREFIX))) {
      removedInstructionTargets.push(abs);
    }
  }

  return { removedFiles, removedMarkers, removedInstructionTargets, diagnostics: plan.diagnostics };
}

export interface CleanRulesOptions {
  /** Absolute paths from {@link InstallRulesOptions.onInstructionTargetWritten}. */
  trackedInstructionTargets?: string[];
  /**
   * Rules from the capabilities file. Their planned nested targets are
   * cleaned too, so a clean works even when the DB has no record.
   */
  rules?: Rule[];
}

/**
 * Remove capa-managed rule files and rule marker blocks for all providers.
 *
 * @param ruleIds - IDs of rules to remove. When provided, only files matching
 *   `{ruleId}{extension}` are deleted. When omitted / empty, nothing is deleted
 *   from directory-based providers (avoiding accidental removal of user-authored files).
 */
export function cleanRules(
  projectPath: string,
  providers: string[],
  ruleIds?: string[],
  options: CleanRulesOptions = {}
): void {
  for (const pid of providers) {
    const provider = getProvider(pid);
    if (!provider?.rules) continue;

    const rulesDir = join(projectPath, provider.rules.dir);
    if (!existsSync(rulesDir)) continue;
    if (!isCapaOwnedInstallPath(projectPath, rulesDir)) continue;

    const managedNames = new Set(
      (ruleIds ?? [])
        .filter((id) => isSafeCapabilityId(id))
        .map((id) => `${id}${provider.rules!.extension}`)
    );
    const files = readdirSync(rulesDir)
      .filter((f) => f.endsWith(provider.rules!.extension))
      .filter((f) => managedNames.size === 0 ? false : managedNames.has(f));
    for (const file of files) {
      unlinkSync(join(rulesDir, file));
    }
    if (files.length > 0) {
      taskLog(`  ✓ Removed ${files.length} rule file(s) from ${provider.rules.dir} (${provider.displayName})`);
    }
  }

  const extra = (options.trackedInstructionTargets ?? [])
    .map((abs) => projectRelativePath(projectPath, abs))
    .filter((rel): rel is string => rel !== null);
  if (options.rules && options.rules.length > 0) {
    const plan = planRulePlacement({ rules: options.rules, readerProviders: providers });
    extra.push(...plan.blocks.keys());
  }

  for (const relPath of instructionCandidates(providers, extra)) {
    const filePath = join(projectPath, relPath);
    if (!existsSync(filePath)) continue;
    if (!isDefaultInstructionsFilename(relPath) && !isCapaOwnedInstallPath(projectPath, filePath)) {
      continue;
    }

    let mdContent = readMd(projectPath, relPath);
    const markerIds = listMarkerIds(mdContent).filter((id) => id.startsWith(RULE_MARKER_PREFIX));
    if (markerIds.length === 0) continue;

    for (const id of markerIds) {
      mdContent = removeBlock(mdContent, id);
    }
    writeOrDeleteMd(projectPath, relPath, mdContent);
    taskLog(`  ✓ Removed ${markerIds.length} rule marker(s) from ${relPath}`);
  }
}

// ---------------------------------------------------------------------------
// Instruction-target helpers
// ---------------------------------------------------------------------------

/**
 * Files that may hold folded rule blocks: root instruction files of the given
 * providers, every isolated filename in the registry (isolation may have been
 * switched off since the last install), and extra project-relative paths.
 */
function instructionCandidates(providers: string[], extra: string[]): string[] {
  const candidates = new Set<string>();
  for (const pid of providers) {
    const filename = getProvider(pid)?.instructions?.filename;
    if (filename) candidates.add(filename);
  }
  for (const name of allIsolatedInstructionFilenames()) candidates.add(name);
  for (const rel of extra) candidates.add(rel);
  return [...candidates].sort();
}

/** True for a provider's default root instructions filename (e.g. `AGENTS.md`). */
function isDefaultInstructionsFilename(relPath: string): boolean {
  return getAllProviders().some((p) => p.instructions?.filename === relPath);
}

/** Project-relative POSIX path, or null when `absPath` is outside the project. */
function projectRelativePath(projectPath: string, absPath: string): string | null {
  const rel = relative(resolve(projectPath), resolve(absPath));
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel.split(sep).join('/');
}

/**
 * Write the updated file. A nested or isolated file left empty only ever held
 * capa blocks, so it is deleted; root instruction files keep their existing
 * lifecycle (removed by `cleanAgentsFile`).
 */
function writeOrDeleteMd(projectPath: string, relPath: string, content: string): void {
  if (content.trim() === '' && !isDefaultInstructionsFilename(relPath)) {
    unlinkSync(join(projectPath, relPath));
    return;
  }
  writeMd(projectPath, relPath, content);
}

function skippedRuleIds(diagnostics: RuleDiagnostic[]): Set<string> {
  return new Set(diagnostics.filter((d) => d.level === 'error').map((d) => d.ruleId));
}

function sortedEntries<V>(map: Map<string, V>): Array<[string, V]> {
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}
