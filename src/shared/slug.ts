/**
 * Convert a tool / server / group id into the kebab-case slug used by the
 * `capa sh` CLI. Mirrors what the shell registry does when building command
 * trees, so any caller that needs to print a `capa sh ...` invocation gets
 * the exact form the user would actually type.
 *
 * Rules:
 *   - camelCase → camel-case
 *   - snake_case → snake-case
 *   - whitespace → '-'
 *   - collapse repeated '-' and trim leading/trailing '-'
 *   - everything lowercased
 */
export function slugify(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
