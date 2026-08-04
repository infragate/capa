import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Eye, File, FilePenLine, Folder, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';

export type FileTreeFileMeta = {
  read?: boolean;
  modified?: boolean;
  deleted?: boolean;
};

interface TreeNode {
  name: string;
  children: Map<string, TreeNode>;
  isFile: boolean;
  pathKey: string | null;
}

function directoryPathKeySet(
  directoryPathKeys?: ReadonlySet<string> | readonly string[],
): Set<string> | null {
  if (directoryPathKeys == null) return null;
  if (directoryPathKeys instanceof Set) return directoryPathKeys;
  return new Set(directoryPathKeys);
}

function isDirectoryPathKey(
  pathKey: string,
  directoryPathKeys: Set<string> | null,
): boolean {
  return directoryPathKeys?.has(pathKey) ?? false;
}

function normalizeDirectoryNodes(node: TreeNode): void {
  for (const child of node.children.values()) {
    normalizeDirectoryNodes(child);
  }
  if (node.children.size > 0) {
    node.isFile = false;
  }
}

function buildTree(
  paths: string[],
  directoryPathKeys?: ReadonlySet<string> | readonly string[],
): TreeNode {
  const root: TreeNode = { name: '', children: new Map(), isFile: false, pathKey: null };
  const directoryKeys = directoryPathKeySet(directoryPathKeys);

  for (const raw of paths) {
    const normalized = raw.replace(/\\/g, '/').replace(/\/+$/, '');
    const segments = normalized.split('/').filter(Boolean);
    if (segments.length === 0) continue;

    let node = root;
    let pathSoFar = '';
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      pathSoFar = pathSoFar ? `${pathSoFar}/${seg}` : seg;
      if (!node.children.has(seg)) {
        node.children.set(seg, {
          name: seg,
          children: new Map(),
          isFile: false,
          pathKey: pathSoFar,
        });
      }
      node = node.children.get(seg)!;
      node.pathKey = pathSoFar;
      if (i === segments.length - 1) {
        node.isFile = !isDirectoryPathKey(pathSoFar, directoryKeys);
      }
    }
  }

  normalizeDirectoryNodes(root);
  return root;
}

/** @internal Exported for unit tests. */
export function buildFilePathTree(
  paths: string[],
  directoryPathKeys?: ReadonlySet<string> | readonly string[],
): TreeNode {
  return buildTree(paths, directoryPathKeys);
}

function findTreeNode(root: TreeNode, pathKey: string): TreeNode | null {
  const segments = pathKey.split('/').filter(Boolean);
  let node = root;
  for (const seg of segments) {
    const next = node.children.get(seg);
    if (!next) return null;
    node = next;
  }
  return node;
}

/** @internal */
export function treeNodeIsFileLeaf(root: TreeNode, pathKey: string): boolean {
  const node = findTreeNode(root, pathKey);
  if (!node) return false;
  return node.isFile && node.children.size === 0;
}

/** @internal */
export function treeNodeIsDirectory(root: TreeNode, pathKey: string): boolean {
  const node = findTreeNode(root, pathKey);
  if (!node) return false;
  return !node.isFile || node.children.size > 0;
}

function FileMetaBadges({ meta }: { meta: FileTreeFileMeta }) {
  const items: { key: string; icon: typeof Eye; className: string }[] = [];
  if (meta.deleted) {
    items.push({ key: 'deleted', icon: Trash2, className: 'text-error-text' });
  }
  if (meta.modified) {
    items.push({
      key: 'modified',
      icon: FilePenLine,
      className: 'text-amber-600 dark:text-amber-400',
    });
  }
  if (meta.read) {
    items.push({ key: 'read', icon: Eye, className: 'text-accent-primary' });
  }
  if (items.length === 0) return null;
  return (
    <span className="ml-auto flex shrink-0 items-center gap-0.5">
      {items.map(({ key, icon: Icon, className }) => (
        <Icon key={key} size={12} className={cn(className, 'opacity-90')} aria-hidden />
      ))}
    </span>
  );
}

function pathKeySelected(
  pathKey: string | null,
  selectedPathKeys?: ReadonlySet<string> | readonly string[],
): boolean {
  if (pathKey == null || selectedPathKeys == null) return false;
  if (Array.isArray(selectedPathKeys)) return selectedPathKeys.includes(pathKey);
  return (selectedPathKeys as ReadonlySet<string>).has(pathKey);
}

function FileTreeNode({
  node,
  depth = 0,
  annotations,
  defaultExpanded = false,
  treeExpansion,
  selectedPathKeys,
  searchQuery,
  onFileSelect,
  scrollPathKey,
}: {
  node: TreeNode;
  depth?: number;
  annotations?: Record<string, FileTreeFileMeta>;
  defaultExpanded?: boolean;
  treeExpansion?: 'all' | 'none';
  selectedPathKeys?: ReadonlySet<string> | readonly string[];
  searchQuery?: string;
  onFileSelect?: (pathKey: string) => void;
  scrollPathKey?: string | null;
}) {
  const [open, setOpen] = useState(defaultExpanded);
  const rowRef = useRef<HTMLButtonElement>(null);
  const hasChildren = node.children.size > 0;
  const sorted = useMemo(
    () =>
      Array.from(node.children.values()).sort((a, b) => {
        if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
        return a.name.localeCompare(b.name);
      }),
    [node.children],
  );

  useEffect(() => {
    if (treeExpansion === 'all' && hasChildren) setOpen(true);
    if (treeExpansion === 'none' && hasChildren) setOpen(false);
  }, [treeExpansion, hasChildren]);

  useEffect(() => {
    const q = searchQuery?.trim().toLowerCase();
    if (!q || !hasChildren) return;
    const childMatches = sorted.some((child) => treeNodeMatchesSearch(child, q));
    if (childMatches) setOpen(true);
  }, [searchQuery, hasChildren, sorted]);

  const isSelected = pathKeySelected(node.pathKey, selectedPathKeys);

  useEffect(() => {
    if (isSelected && node.pathKey && node.pathKey === scrollPathKey) {
      rowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [isSelected, node.pathKey, scrollPathKey]);

  if (!node.name) {
    return (
      <>
        {sorted.map((child) => (
          <FileTreeNode
            key={child.name}
            node={child}
            depth={0}
            annotations={annotations}
            defaultExpanded={defaultExpanded}
            treeExpansion={treeExpansion}
            selectedPathKeys={selectedPathKeys}
            searchQuery={searchQuery}
            onFileSelect={onFileSelect}
            scrollPathKey={scrollPathKey}
          />
        ))}
      </>
    );
  }

  const meta = node.pathKey ? annotations?.[node.pathKey] : undefined;
  const showAsFile = node.isFile && !hasChildren;
  const canExpand = hasChildren;
  const canSelect =
    Boolean(node.pathKey && onFileSelect) &&
    (showAsFile || Boolean(meta && !hasChildren && !showAsFile));
  const isInteractive = canExpand || canSelect;

  const rowClassName = cn(
    'flex w-full min-w-0 items-center gap-1.5 rounded-sm px-1 py-0.5 text-left text-xs',
    isInteractive && 'hover:bg-hover-bg',
    isSelected && 'bg-accent-primary/15 ring-1 ring-inset ring-accent-primary/35',
    canSelect && 'cursor-pointer',
  );

  const rowBody = (
    <>
      {hasChildren ? (
        <ChevronRight
          className="ui-chevron h-3 w-3 shrink-0 text-text-tertiary"
          data-open={open ? 'true' : 'false'}
        />
      ) : (
        <span className="inline-block w-3 shrink-0" />
      )}
      {showAsFile ? (
        <File className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
      ) : (
        <Folder className="h-3.5 w-3.5 shrink-0 text-accent-primary" />
      )}
      <span
        className={cn(
          'min-w-0 flex-1 truncate',
          showAsFile ? 'text-text-secondary' : 'font-medium text-text-primary',
          isSelected && 'text-text-primary',
        )}
      >
        {node.name}
      </span>
      {meta ? <FileMetaBadges meta={meta} /> : null}
    </>
  );

  return (
    <div>
      {isInteractive ? (
        <button
          ref={rowRef}
          type="button"
          className={rowClassName}
          style={{ paddingLeft: `${depth * 16 + 4}px` }}
          onClick={() => {
            if (canSelect && showAsFile && node.pathKey) {
              onFileSelect?.(node.pathKey);
              return;
            }
            if (canSelect && !canExpand && node.pathKey) {
              onFileSelect?.(node.pathKey);
              return;
            }
            if (canExpand) setOpen((v) => !v);
          }}
          title={node.pathKey ?? undefined}
          aria-expanded={canExpand ? open : undefined}
          aria-current={isSelected ? 'true' : undefined}
        >
          {rowBody}
        </button>
      ) : (
        <div
          className={rowClassName}
          style={{ paddingLeft: `${depth * 16 + 4}px` }}
          role="treeitem"
          title={node.pathKey ?? undefined}
        >
          {rowBody}
        </div>
      )}
      {open && (
        <div className="ui-panel-enter">
          {sorted.map((child) => (
            <FileTreeNode
              key={child.name}
              node={child}
              depth={depth + 1}
              annotations={annotations}
              defaultExpanded={defaultExpanded}
              treeExpansion={treeExpansion}
              selectedPathKeys={selectedPathKeys}
              searchQuery={searchQuery}
              onFileSelect={onFileSelect}
              scrollPathKey={scrollPathKey}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function treeNodeMatchesSearch(node: TreeNode, q: string): boolean {
  if (node.pathKey?.toLowerCase().includes(q)) return true;
  if (node.name.toLowerCase().includes(q)) return true;
  for (const child of node.children.values()) {
    if (treeNodeMatchesSearch(child, q)) return true;
  }
  return false;
}

export function FileTree({
  files,
  annotations,
  variant = 'card',
  defaultExpanded = false,
  treeExpansion,
  selectedPathKeys,
  searchQuery,
  onFileSelect,
  scrollPathKey,
  directoryPathKeys,
}: {
  files: string[];
  annotations?: Record<string, FileTreeFileMeta>;
  variant?: 'card' | 'plain';
  defaultExpanded?: boolean;
  treeExpansion?: 'all' | 'none';
  selectedPathKeys?: ReadonlySet<string> | readonly string[];
  searchQuery?: string;
  onFileSelect?: (pathKey: string) => void;
  scrollPathKey?: string | null;
  /** Display paths that are directories (e.g. Grep search roots). */
  directoryPathKeys?: ReadonlySet<string> | readonly string[];
}) {
  const tree = useMemo(
    () => buildTree(files, directoryPathKeys),
    [files, directoryPathKeys],
  );
  if (files.length === 0) return null;
  const inner = (
    <FileTreeNode
      node={tree}
      annotations={annotations}
      defaultExpanded={defaultExpanded}
      treeExpansion={treeExpansion}
      selectedPathKeys={selectedPathKeys}
      searchQuery={searchQuery}
      onFileSelect={onFileSelect}
      scrollPathKey={scrollPathKey}
    />
  );
  if (variant === 'plain') {
    return <div className="font-mono">{inner}</div>;
  }
  return (
    <div className="rounded-lg border border-border-primary bg-bg-secondary p-3">
      {inner}
    </div>
  );
}
