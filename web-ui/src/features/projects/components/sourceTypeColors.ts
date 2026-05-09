/**
 * Color classes for source-type badges shown on skills and rules.
 *
 * Both `SkillsList` and `RulesList` (and any future component that surfaces a
 * skill/rule/snippet source type) should pull from this map so a `gitlab`
 * source always reads as orange, a `github` source always reads as green,
 * etc. — no per-component drift.
 *
 * Keys cover every `Skill.type` and `Rule.type` value:
 *   - inline    : content embedded in the capabilities file
 *   - remote    : fetched from a raw URL
 *   - github    : fetched via git clone from a GitHub repo
 *   - gitlab    : fetched via git clone from a GitLab repo
 *   - local     : pointed at a directory on disk (skills only)
 *   - installed : user-installed elsewhere; capa just records it (skills only)
 *
 * The fallback (`bg-bg-secondary text-text-tertiary`) keeps unknown / future
 * types visually neutral instead of unstyled.
 */
const SOURCE_TYPE_COLORS: Record<string, string> = {
  inline: 'bg-blue-500/10 text-blue-400',
  remote: 'bg-purple-500/10 text-purple-400',
  github: 'bg-green-500/10 text-green-400',
  gitlab: 'bg-orange-500/10 text-orange-400',
  local: 'bg-slate-500/10 text-slate-400',
  installed: 'bg-amber-500/10 text-amber-400',
};

const FALLBACK = 'bg-bg-secondary text-text-tertiary';

export function sourceTypeBadgeClasses(type: string): string {
  return SOURCE_TYPE_COLORS[type] ?? FALLBACK;
}
