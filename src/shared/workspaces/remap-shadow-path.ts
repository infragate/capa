/** Normalize to posix slashes (no trailing slash except root). */
export function normalizePosixPath(raw: string): string {
  return raw.replace(/\\/g, "/").replace(/\/+/g, "/");
}

const CAPA_WORKSPACES_MARKER = "/.capa/workspaces/";

/**
 * If `filePath` lives under a capa wrap shadow workspace, map it to the real
 * project tree. Nested layout:
 *   ~/.capa/workspaces/<cache-slug>/<projectBasename>/… → <realProjectPath>/…
 *
 * Shadow roots and `.capa/workspaces` segments never appear in the result.
 */
export function remapWrapShadowPath(
  filePath: string,
  realProjectPath: string | null | undefined,
): string {
  const path = normalizePosixPath(filePath.trim());
  if (!path || !realProjectPath?.trim()) return path;

  const realBase = normalizePosixPath(realProjectPath.trim()).replace(/\/+$/, "");
  if (!realBase) return path;

  const idx = path.indexOf(CAPA_WORKSPACES_MARKER);
  if (idx === -1) return path;

  const after = path.slice(idx + CAPA_WORKSPACES_MARKER.length);
  const parts = after.split("/").filter(Boolean);
  if (parts.length === 0) return realBase;

  const projectBasename =
    realBase.split("/").filter(Boolean).pop()?.toLowerCase() ?? "";

  // Nested cwd: <cache>/<basename>/rest…
  if (parts.length >= 2 && projectBasename) {
    const nested = parts[1]!.toLowerCase();
    if (nested === projectBasename) {
      const rest = parts.slice(2);
      return rest.length === 0 ? realBase : `${realBase}/${rest.join("/")}`;
    }
    return path;
  }

  // Legacy flat cache: <cache>/rest…
  if (parts.length >= 1) {
    const rest = parts.slice(1);
    return rest.length === 0 ? realBase : `${realBase}/${rest.join("/")}`;
  }

  return path;
}
