/**
 * Pure placement planning for instruction files and folded rules.
 *
 * Several providers read the same instructions file (Codex, Gemini CLI,
 * Cursor, OpenCode… all read `AGENTS.md`). This module decides, before
 * anything is written:
 *
 *   1. Which instructions file each provider reads. This is a function of the
 *      active provider set only: a provider with `isolatedFilename` moves onto
 *      its private file whenever another active provider shares its default.
 *   2. Where each folded rule block goes (root or nested `dir/<file>`), and
 *      which placements would widen visibility or scope. Those are reported
 *      as diagnostics instead of happening silently.
 *   3. Which providers with a native rules directory already read a folded
 *      copy (Cursor reads `AGENTS.md`), so their native file is skipped
 *      instead of delivering the rule twice.
 *
 * Install, prune, and clean all derive their view of the world from this
 * plan, so their results don't depend on provider iteration order.
 */

import { posix } from 'path';
import type { Rule } from '../../types/rules';
import type { CapabilitiesOptions } from '../../types/capabilities';
import type { InstructionsContextConfig } from '../../types/providers';
import { getAllProviders, getProvider } from '../../shared/providers';

export type RuleConflictMode = 'warn' | 'error';

export type RuleDiagnosticCode =
  | 'visibility-conflict'
  | 'scope-not-representable'
  | 'scope-widened'
  | 'invalid-glob';

export interface RuleDiagnostic {
  code: RuleDiagnosticCode;
  ruleId: string;
  /** `error` diagnostics mean the rule was not placed. */
  level: 'warn' | 'error';
  message: string;
}

export interface InstructionLayout {
  /** Root instructions filename → active providers that read it (sorted). */
  files: Map<string, string[]>;
  /** Provider id → root instructions filename it reads. */
  providerFile: Map<string, string>;
  /** Provider id → the filename selection capa wants in its context config. */
  contextConfig: Map<string, { config: InstructionsContextConfig; fileNames: string[] }>;
}

export interface PlannedRuleBlock {
  ruleId: string;
  /** Markdown prepended to the rule body (e.g. an "Applies to" note). */
  preamble?: string;
}

export interface RulePlacementPlan {
  layout: InstructionLayout;
  /** Project-relative POSIX path → rule blocks placed there, in rule order. */
  blocks: Map<string, PlannedRuleBlock[]>;
  diagnostics: RuleDiagnostic[];
  /**
   * Provider id → rule ids it already receives through a folded instructions
   * file. Install skips the native rule file for these and deletes an existing
   * one only after that folded copy is written. Prune leaves the native file
   * in place until then, so a failed body fetch cannot remove the only copy.
   */
  nativeCovered: Map<string, Set<string>>;
}

export interface PlanRulePlacementInput {
  rules: Rule[];
  /** Every active provider. Decides who reads each shared file. */
  readerProviders: string[];
  /**
   * Providers to place blocks for (defaults to `readerProviders`). Partial
   * installs (e.g. a wrap shadow for one provider) pass a subset here.
   */
  targetProviders?: string[];
  conflicts?: RuleConflictMode;
  /**
   * Whether a nested placement (`dir/<file>`) can actually be written. A
   * native rule file is only dropped in favour of folded copies that land.
   * Defaults to true (pure planning, e.g. diagnostics only).
   */
  canWrite?: (relPath: string) => boolean;
}

/** Resolve `options.rules.conflicts`, defaulting to `error` under `onInstallError: stop`. */
export function resolveRuleConflictMode(
  options: CapabilitiesOptions | undefined,
): RuleConflictMode {
  const explicit = options?.rules?.conflicts;
  if (explicit === 'warn' || explicit === 'error') return explicit;
  return options?.onInstallError === 'stop' ? 'error' : 'warn';
}

/**
 * Decide which instructions file each active provider reads. Depends only on
 * the provider set.
 */
export function computeInstructionLayout(providerIds: string[]): InstructionLayout {
  const active = uniqueProviders(providerIds).filter((p) => p.instructions);

  const byDefault = new Map<string, string[]>();
  for (const p of active) {
    const list = byDefault.get(p.instructions!.filename) ?? [];
    list.push(p.id);
    byDefault.set(p.instructions!.filename, list);
  }

  const providerFile = new Map<string, string>();
  for (const p of active) {
    const { filename, isolatedFilename } = p.instructions!;
    const shared = (byDefault.get(filename) ?? []).length > 1;
    providerFile.set(p.id, isolatedFilename && shared ? isolatedFilename : filename);
  }

  const grouped = new Map<string, string[]>();
  for (const [pid, file] of providerFile) {
    const list = grouped.get(file) ?? [];
    list.push(pid);
    grouped.set(file, list);
  }
  const files = new Map<string, string[]>();
  for (const file of [...grouped.keys()].sort()) {
    files.set(file, grouped.get(file)!.sort());
  }

  const contextConfig: InstructionLayout['contextConfig'] = new Map();
  for (const p of active) {
    if (!p.instructions!.contextConfig) continue;
    contextConfig.set(p.id, {
      config: p.instructions!.contextConfig,
      fileNames: [providerFile.get(p.id)!],
    });
  }

  return { files, providerFile, contextConfig };
}

/**
 * Every filename any registry provider may use as an isolated instructions
 * file. Prune and clean scan these even when isolation is no longer active.
 */
export function allIsolatedInstructionFilenames(): string[] {
  const names = new Set<string>();
  for (const p of getAllProviders()) {
    if (p.instructions?.isolatedFilename) names.add(p.instructions.isolatedFilename);
  }
  return [...names].sort();
}

/** True when the provider folds rules into its instructions file (no rules dir). */
export function foldsRulesIntoInstructions(providerId: string): boolean {
  const p = getProvider(providerId);
  return !!p?.instructions && !p.rules;
}

export function planRulePlacement(input: PlanRulePlacementInput): RulePlacementPlan {
  const layout = computeInstructionLayout(input.readerProviders);
  const conflicts = input.conflicts ?? 'warn';
  const level: RuleDiagnostic['level'] = conflicts === 'error' ? 'error' : 'warn';
  const activeIds = [...layout.providerFile.keys()];
  const targetSet = new Set(
    (input.targetProviders ?? input.readerProviders).map((id) => getProvider(id)?.id ?? id),
  );

  const blocks = new Map<string, PlannedRuleBlock[]>();
  const diagnostics: RuleDiagnostic[] = [];
  const nativeCovered = new Map<string, Set<string>>();

  for (const rule of input.rules) {
    const allowed = new Set(
      rule.providers && rule.providers.length > 0
        ? rule.providers.map((id) => getProvider(id)?.id ?? id)
        : activeIds,
    );
    const targets = activeIds
      .filter((pid) => targetSet.has(pid) && allowed.has(pid))
      .filter(foldsRulesIntoInstructions)
      .sort();
    if (targets.length === 0) continue;

    const ruleDiagnostics: RuleDiagnostic[] = [];
    const scope = resolveRuleScope(rule, targets);
    for (const glob of scope.invalid) {
      ruleDiagnostics.push({
        code: 'invalid-glob',
        ruleId: rule.id,
        level,
        message:
          `Rule "${rule.id}": appliesTo glob "${glob}" points outside the project` +
          (level === 'error' ? '; the rule was skipped.' : ' and was ignored.'),
      });
    }

    const locations: Array<{ dir: string; preamble?: string }> = scope.nestedDirs.map((dir) => ({
      dir,
    }));
    if (scope.rootGlobs !== null) {
      if (scope.rootGlobs.length === 0) {
        locations.push({ dir: '' });
      } else {
        locations.push({ dir: '', preamble: appliesToPreamble(scope.rootGlobs) });
        if (rule.scope !== 'best-effort') {
          ruleDiagnostics.push({
            code: 'scope-not-representable',
            ruleId: rule.id,
            level,
            message:
              `Rule "${rule.id}": appliesTo ${scope.rootGlobs.map((g) => `"${g}"`).join(', ')} ` +
              `can't be scoped natively for ${targets.join(', ')}; ` +
              (level === 'error'
                ? 'the rule was skipped. '
                : 'it is loaded for the whole project with an "Applies to" note. ') +
              `Use directory globs (e.g. "src/**") or set "scope: best-effort" on the rule to ` +
              `accept a project-wide fold.`,
          });
        }
      }
    }

    const placements: Array<{ path: string; preamble?: string }> = [];
    for (const { dir, preamble } of locations) {
      const files = [...new Set(targets.map((pid) => layout.providerFile.get(pid)!))].sort();
      for (const file of files) {
        // Nested files count every reader of the filename, not only providers
        // flagged `hierarchical`. That flag says where capa may *write* a
        // scoped rule; other providers can still *read* nested files (Cursor
        // loads nested AGENTS.md), so this errs toward reporting a conflict.
        const readers = layout.files.get(file) ?? [];
        const leaked = readers.filter((pid) => !allowed.has(pid));
        const path = dir ? `${dir}/${file}` : file;
        if (leaked.length > 0 && rule.visibility !== 'best-effort') {
          ruleDiagnostics.push({
            code: 'visibility-conflict',
            ruleId: rule.id,
            level,
            message:
              `Rule "${rule.id}" is limited to ${[...allowed].sort().join(', ')}, but ${path} is also ` +
              `read by ${leaked.join(', ')}` +
              (level === 'error' ? '; the rule was skipped. ' : '. ') +
              `Adjust the rule's providers, or set ` +
              `"visibility: best-effort" on the rule to accept this.`,
          });
        }
        placements.push({ path, preamble });
      }
    }

    const skipped = level === 'error' && ruleDiagnostics.length > 0;
    if (!skipped && placements.length > 0) {
      // An allowed provider with a native rules dir that also reads the file
      // this rule is folded into (Cursor + AGENTS.md) would get it twice. The
      // folded copy is at least as broad as the native one, so the native
      // file adds nothing but the duplicate. Only the provider's own file
      // counts (not an isolated GEMINI.md copy), and only if every location
      // got a copy that will actually be written.
      for (const pid of activeIds) {
        if (!allowed.has(pid) || foldsRulesIntoInstructions(pid)) continue;
        const file = layout.providerFile.get(pid);
        const mine = placements.filter((p) => posix.basename(p.path) === file);
        if (mine.length !== locations.length) continue;
        if (!mine.every((p) => p.path === file || (input.canWrite?.(p.path) ?? true))) continue;
        const covered = nativeCovered.get(pid) ?? new Set<string>();
        covered.add(rule.id);
        nativeCovered.set(pid, covered);
        if (mine.some((p) => p.preamble)) {
          // Reported even under `scope: best-effort`: that opt-in covers the
          // folding providers, not one that could scope the rule natively.
          ruleDiagnostics.push({
            code: 'scope-widened',
            ruleId: rule.id,
            level: 'warn',
            message:
              `Rule "${rule.id}": ${pid} also reads ${mine.map((p) => p.path).join(', ')}, ` +
              `so it gets the project-wide copy folded for ${targets.join(', ')} instead of its ` +
              `native appliesTo scope (its own rule file is skipped to avoid a duplicate). ` +
              `Use directory globs (e.g. "src/**") to keep the scope for every provider.`,
          });
        }
      }
    }

    diagnostics.push(...ruleDiagnostics);
    if (skipped) continue;

    for (const { path, preamble } of placements) {
      const list = blocks.get(path) ?? [];
      list.push(preamble ? { ruleId: rule.id, preamble } : { ruleId: rule.id });
      blocks.set(path, list);
    }
  }

  return { layout, blocks, diagnostics, nativeCovered };
}

/** Rule body as written inside its marker block. */
export function renderPlannedRuleBody(block: PlannedRuleBlock, body: string): string {
  return block.preamble ? `${block.preamble}\n\n${body}` : body;
}

// ---------------------------------------------------------------------------
// appliesTo → scope
// ---------------------------------------------------------------------------

interface RuleScope {
  /** Nested directories (POSIX, no trailing slash) that get their own file. */
  nestedDirs: string[];
  /** `null`: no root block. `[]`: unscoped root block. Otherwise root globs for the preamble. */
  rootGlobs: string[] | null;
  invalid: string[];
}

const MATCH_ALL_GLOBS = new Set(['**', '**/*', './**', './**/*']);
const GLOB_META = /[*?[\]{}!]/;

function resolveRuleScope(rule: Rule, targets: string[]): RuleScope {
  const globs = (rule.appliesTo ?? []).map((g) => String(g).trim()).filter(Boolean);
  if (rule.alwaysApply || globs.length === 0 || globs.some((g) => MATCH_ALL_GLOBS.has(g))) {
    return { nestedDirs: [], rootGlobs: [], invalid: [] };
  }

  const hierarchical = targets.every((pid) => getProvider(pid)?.instructions?.hierarchical);
  const dirs: string[] = [];
  const rootGlobs: string[] = [];
  const invalid: string[] = [];

  for (const glob of globs) {
    const normalized = glob.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
    if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
      invalid.push(glob);
      continue;
    }
    if (normalized.split('/').includes('..')) {
      invalid.push(glob);
      continue;
    }
    const dir = directoryPrefix(normalized);
    if (dir !== null && hierarchical) {
      dirs.push(dir);
    } else {
      rootGlobs.push(glob);
    }
  }

  // `src/**` already covers `src/api/**`.
  const unique = [...new Set(dirs)].sort();
  const nestedDirs = unique.filter(
    (dir) => !unique.some((other) => other !== dir && dir.startsWith(`${other}/`)),
  );

  if (nestedDirs.length === 0 && rootGlobs.length === 0) {
    // Every glob was invalid: don't silently widen to the whole project.
    return { nestedDirs: [], rootGlobs: null, invalid };
  }
  return { nestedDirs, rootGlobs: rootGlobs.length > 0 ? rootGlobs : null, invalid };
}

/** `dir/**` or `dir/**\/*` → `dir`; anything else → null. */
function directoryPrefix(glob: string): string | null {
  const match = glob.match(/^(.+?)\/\*\*(?:\/\*)?\/?$/);
  if (!match) return null;
  const dir = match[1].replace(/\/+$/, '');
  if (!dir || GLOB_META.test(dir)) return null;
  if (dir.split('/').some((seg) => seg === '' || seg === '.')) return null;
  return dir;
}

function appliesToPreamble(globs: string[]): string {
  return `> Applies to: ${globs.map((g) => `\`${g}\``).join(', ')}`;
}

function uniqueProviders(providerIds: string[]) {
  const seen = new Set<string>();
  const out = [];
  for (const raw of providerIds) {
    const p = getProvider(raw);
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}
