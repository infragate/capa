import { useMemo, useState } from 'react';
import { ChevronRight, File, Folder } from 'lucide-react';

interface TreeNode {
  name: string;
  children: Map<string, TreeNode>;
  isFile: boolean;
}

function buildTree(paths: string[]): TreeNode {
  const root: TreeNode = { name: '', children: new Map(), isFile: false };
  for (const p of paths) {
    const segments = p.replace(/\\/g, '/').split('/').filter(Boolean);
    let node = root;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (!node.children.has(seg)) {
        node.children.set(seg, {
          name: seg,
          children: new Map(),
          isFile: i === segments.length - 1,
        });
      }
      node = node.children.get(seg)!;
    }
  }
  return root;
}

function FileTreeNode({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  const [open, setOpen] = useState(false);
  const hasChildren = node.children.size > 0;
  const sorted = useMemo(
    () =>
      Array.from(node.children.values()).sort((a, b) => {
        if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
        return a.name.localeCompare(b.name);
      }),
    [node.children],
  );

  if (!node.name) {
    return (
      <>
        {sorted.map((child) => (
          <FileTreeNode key={child.name} node={child} depth={0} />
        ))}
      </>
    );
  }

  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-1.5 rounded-sm px-1 py-0.5 text-left text-xs hover:bg-hover-bg"
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        onClick={() => hasChildren && setOpen((v) => !v)}
      >
        {hasChildren ? (
          <ChevronRight
            className="ui-chevron h-3 w-3 shrink-0 text-text-tertiary"
            data-open={open ? 'true' : 'false'}
          />
        ) : (
          <span className="inline-block w-3" />
        )}
        {node.isFile ? (
          <File className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
        ) : (
          <Folder className="h-3.5 w-3.5 shrink-0 text-accent-primary" />
        )}
        <span
          className={`truncate ${node.isFile ? 'text-text-secondary' : 'font-medium text-text-primary'}`}
        >
          {node.name}
        </span>
      </button>
      {open && (
        <div className="ui-panel-enter">
          {sorted.map((child) => (
            <FileTreeNode key={child.name} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree({ files }: { files: string[] }) {
  const tree = useMemo(() => buildTree(files), [files]);
  if (files.length === 0) return null;
  return (
    <div className="rounded-lg border border-border-primary bg-bg-secondary p-3">
      <FileTreeNode node={tree} />
    </div>
  );
}
