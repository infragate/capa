import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronDown, ChevronRight, ExternalLink, File, Folder, X } from 'lucide-react';
import { FaGithub, FaGitlab } from 'react-icons/fa';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Skill } from '../../../types/api';
import { Spinner } from '../../../components/common/Spinner';
import { SourceBadge } from '../../../components/common/ServerBadge';
import { useSkillContent } from '../hooks';
import { sourceTypeBadgeClasses } from './sourceTypeColors';

interface SkillDetailDialogProps {
  skill: Skill | null;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function stripFrontmatter(md: string): string {
  return md.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '');
}

function renderMarkdown(md: string): string {
  const raw = marked.parse(stripFrontmatter(md), { async: false, gfm: true, breaks: true }) as string;
  return DOMPurify.sanitize(raw);
}

function sourceHostKind(raw: string | null | undefined): 'github' | 'gitlab' | 'remote' {
  if (!raw) return 'remote';
  try {
    const hostname = new URL(raw).hostname;
    if (hostname === 'github.com' || hostname.endsWith('.github.com') || hostname === 'raw.githubusercontent.com') {
      return 'github';
    }
    if (hostname === 'gitlab.com' || hostname.endsWith('.gitlab.com')) {
      return 'gitlab';
    }
  } catch {
    // fall through
  }
  return 'remote';
}

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
      const segment = segments[i];
      if (!node.children.has(segment)) {
        node.children.set(segment, {
          name: segment,
          children: new Map(),
          isFile: i === segments.length - 1,
        });
      }
      node = node.children.get(segment)!;
    }
  }
  return root;
}

function FileTreeNode({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  const [open, setOpen] = useState(depth === 0);
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
          open ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-text-tertiary" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-text-tertiary" />
          )
        ) : (
          <span className="inline-block w-3" />
        )}
        {node.isFile ? (
          <File className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
        ) : (
          <Folder className="h-3.5 w-3.5 shrink-0 text-accent-primary" />
        )}
        <span className={`truncate ${node.isFile ? 'text-text-secondary' : 'font-medium text-text-primary'}`}>
          {node.name}
        </span>
      </button>
      {open &&
        sorted.map((child) => (
          <FileTreeNode key={child.name} node={child} depth={depth + 1} />
        ))}
    </div>
  );
}

function FileTree({ files }: { files: string[] }) {
  const tree = useMemo(() => buildTree(files), [files]);
  if (files.length === 0) return null;
  return (
    <div className="rounded-lg border border-border-primary bg-bg-secondary p-3">
      <FileTreeNode node={tree} />
    </div>
  );
}

export function SkillDetailDialog({ skill, projectId, open, onOpenChange }: SkillDetailDialogProps) {
  const { t } = useTranslation('projects');
  const { data, isLoading, isError } = useSkillContent(projectId, open && skill ? skill.id : null);

  const previewHtml = useMemo(
    () => (data?.content ? renderMarkdown(data.content) : ''),
    [data?.content],
  );

  const sourceUrl = skill?.sourceUrl || null;
  const sourceKind = sourceHostKind(sourceUrl);
  const sourceTitle =
    sourceKind === 'github'
      ? t('openOnGitHub')
      : sourceKind === 'gitlab'
        ? t('openOnGitLab')
        : t('skillDetail.viewSource');

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in data-[state=closed]:fade-out" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[min(90vw,720px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border-primary bg-bg-secondary shadow-lg">
          <div className="flex items-start justify-between border-b border-border-secondary px-6 py-4">
            <div className="min-w-0 flex-1 pr-4">
              <Dialog.Title className="truncate font-mono text-lg font-medium text-text-primary">
                {skill?.id ?? t('skillDetail.title')}
              </Dialog.Title>
              {skill && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span
                    className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase ${sourceTypeBadgeClasses(skill.type)}`}
                  >
                    {skill.type}
                  </span>
                  {skill.sourcePlugin?.name && (
                    <SourceBadge name={skill.sourcePlugin.name} kind="plugin" />
                  )}
                </div>
              )}
              <Dialog.Description className="sr-only">
                {t('skillDetail.description')}
              </Dialog.Description>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {sourceUrl && (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-hover-bg hover:text-text-primary"
                  title={sourceTitle}
                  onClick={(e) => e.stopPropagation()}
                >
                  {sourceKind === 'github' ? (
                    <FaGithub className="h-4 w-4" />
                  ) : sourceKind === 'gitlab' ? (
                    <FaGitlab className="h-4 w-4" />
                  ) : (
                    <ExternalLink className="h-3.5 w-3.5" />
                  )}
                  <span>{t('skillDetail.viewSource')}</span>
                </a>
              )}
              <Dialog.Close
                className="rounded-sm p-1 text-text-secondary transition-colors hover:bg-hover-bg"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Dialog.Close>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {isLoading && <Spinner label={t('skillDetail.loading')} />}
            {!isLoading && isError && (
              <div className="py-12 text-center text-sm text-text-tertiary">
                {t('skillDetail.unavailable')}
              </div>
            )}
            {!isLoading && !isError && previewHtml && (
              <div className="space-y-5">
                {data?.files && data.files.length > 0 && (
                  <section>
                    <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-tertiary">
                      {t('skillDetail.files')}
                    </h3>
                    <FileTree files={data.files} />
                  </section>
                )}
                <div
                  className="registry-markdown overflow-hidden text-sm text-text-secondary"
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              </div>
            )}
            {!isLoading && !isError && !previewHtml && (
              <div className="py-12 text-center text-sm text-text-tertiary">
                {t('skillDetail.unavailable')}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
