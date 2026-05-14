import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import * as Tabs from '@radix-ui/react-tabs';
import { Copy, Check, ExternalLink, File, Folder, ChevronRight, ChevronDown } from 'lucide-react';
import { marked } from 'marked';
import { Spinner } from '../../../components/common/Spinner';
import { useRegistryView } from '../hooks';

interface ItemDetailProps {
  registryId: string;
  registryName: string;
  capability: string;
  itemId: string | undefined;
}

function yamlDump(obj: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const [k2, v2] of Object.entries(value as Record<string, unknown>)) {
        if (v2 === undefined || v2 === null) continue;
        lines.push(`  ${k2}: ${JSON.stringify(v2)}`);
      }
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  return lines.join('\n');
}

function stripFrontmatter(md: string): string {
  return md.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function highlightCli(cmd: string): string {
  const parts = cmd.split(/\s+/);
  if (parts.length === 0) return escapeHtml(cmd);
  const bin = `<span class="sh-bin">${escapeHtml(parts[0])}</span>`;
  const sub = parts[1] ? ` <span class="sh-sub">${escapeHtml(parts[1])}</span>` : '';
  const rest = parts.slice(2).map((p) =>
    p.startsWith('-')
      ? `<span class="sh-flag">${escapeHtml(p)}</span>`
      : `<span class="sh-arg">${escapeHtml(p)}</span>`,
  );
  return [bin, sub, ...rest.map((r) => ' ' + r)].join('');
}

function highlightYaml(yaml: string): string {
  return escapeHtml(yaml).replace(/^(\s*)(\w[\w-]*)(:)(.*)/gm, (_m, indent, key, colon, value) => {
    const val = value.trim();
    let valHtml: string;
    if (val.startsWith('&quot;') && val.endsWith('&quot;')) {
      valHtml = ` <span class="yl-str">${val}</span>`;
    } else if (/^(true|false|null)$/i.test(val)) {
      valHtml = ` <span class="yl-bool">${val}</span>`;
    } else if (val && !isNaN(Number(val))) {
      valHtml = ` <span class="yl-num">${val}</span>`;
    } else if (val) {
      valHtml = ` <span class="yl-str">${val}</span>`;
    } else {
      valHtml = '';
    }
    return `${indent}<span class="yl-key">${key}</span><span class="yl-colon">${colon}</span>${valHtml}`;
  });
}

function renderMarkdown(md: string): string {
  return marked.parse(stripFrontmatter(md), { async: false, gfm: true, breaks: true }) as string;
}

/* ---- File tree helpers ---- */

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
        node.children.set(seg, { name: seg, children: new Map(), isFile: i === segments.length - 1 });
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
    return <>{sorted.map((child) => <FileTreeNode key={child.name} node={child} depth={0} />)}</>;
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
          open ? <ChevronDown className="h-3 w-3 shrink-0 text-text-tertiary" /> : <ChevronRight className="h-3 w-3 shrink-0 text-text-tertiary" />
        ) : (
          <span className="inline-block w-3" />
        )}
        {node.isFile ? (
          <File className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
        ) : (
          <Folder className="h-3.5 w-3.5 shrink-0 text-accent-primary" />
        )}
        <span className={`truncate ${node.isFile ? 'text-text-secondary' : 'text-text-primary font-medium'}`}>
          {node.name}
        </span>
      </button>
      {open && sorted.map((child) => <FileTreeNode key={child.name} node={child} depth={depth + 1} />)}
    </div>
  );
}

function FileTree({ files }: { files: string[] }) {
  const tree = useMemo(() => buildTree(files), [files]);
  return (
    <div className="rounded-lg border border-border-primary bg-bg-secondary p-3">
      <FileTreeNode node={tree} />
    </div>
  );
}

/* ---- Main component ---- */

export function ItemDetail({ registryId, registryName, capability, itemId }: ItemDetailProps) {
  const { t } = useTranslation('registries');
  const { data: detail, isLoading, error } = useRegistryView(registryId, capability, itemId);
  const [copied, setCopied] = useState<'yaml' | 'cli' | null>(null);

  const handleCopy = useCallback(
    async (text: string, kind: 'yaml' | 'cli') => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(kind);
        setTimeout(() => setCopied(null), 2000);
      } catch {}
    },
    [],
  );

  const previewHtml = useMemo(
    () => (detail?.preview ? renderMarkdown(detail.preview) : ''),
    [detail?.preview],
  );

  if (!itemId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-tertiary">
        {t('detail.selectPrompt')}
      </div>
    );
  }

  if (isLoading) {
    return <Spinner label={t('detail.loading')} />;
  }

  if (error || !detail) {
    return (
      <div className="py-8 text-center text-sm text-red-500">
        {t('errors.viewFailed')}
      </div>
    );
  }

  const snippet = detail.installSnippet;
  const innerYaml = snippet ? yamlDump(snippet as unknown as Record<string, unknown>) : '';
  const yamlSnippet = innerYaml
    ? `${capability}:\n` + innerYaml.split('\n').map((l, i) => i === 0 ? `  - ${l}` : `    ${l}`).join('\n')
    : '';
  const showCli = capability === 'skills';
  const cliCommand = showCli ? `capa add ${registryId}:${detail.id}` : '';

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="mb-4 border-b border-border-secondary pb-4">
        <h2 className="text-lg font-medium text-text-primary">{detail.title}</h2>
        {detail.description && (
          <p className="mt-1 text-sm text-text-secondary">{detail.description}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-text-tertiary">
          {detail.author && (
            <span>
              {t('detail.author')}: <span className="text-text-secondary">{detail.author}</span>
            </span>
          )}
          {detail.version && (
            <span>
              {t('detail.version')}: <span className="text-text-secondary">{detail.version}</span>
            </span>
          )}
          <span className="text-text-tertiary">{t('detail.via', { registry: registryName })}</span>
          {detail.homepage && (
            <a
              href={detail.homepage}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-accent-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              {t('detail.homepage')}
            </a>
          )}
        </div>
        {detail.tags && detail.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {detail.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-sm bg-bg-tertiary px-2 py-0.5 text-[11px] text-text-secondary"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Install section */}
      <div className="mb-4 rounded-lg border border-border-primary bg-bg-secondary p-4">
        <h3 className="mb-3 text-sm font-medium text-text-primary">{t('detail.installTitle')}</h3>
        <Tabs.Root defaultValue={showCli ? 'cli' : 'yaml'}>
          <Tabs.List className="mb-3 flex gap-1 border-b border-border-secondary">
            {showCli && (
              <Tabs.Trigger
                value="cli"
                className="border-b-2 border-transparent px-3 py-1.5 text-xs text-text-secondary transition-colors data-[state=active]:border-accent-primary data-[state=active]:text-text-primary"
              >
                {t('detail.cliTab')}
              </Tabs.Trigger>
            )}
            <Tabs.Trigger
              value="yaml"
              className="border-b-2 border-transparent px-3 py-1.5 text-xs text-text-secondary transition-colors data-[state=active]:border-accent-primary data-[state=active]:text-text-primary"
            >
              {t('detail.yamlTab')}
            </Tabs.Trigger>
          </Tabs.List>
          {showCli && (
            <Tabs.Content value="cli">
              <div className="group relative">
                <pre className="overflow-x-auto rounded-sm bg-code-bg p-3 text-xs text-text-primary">
                  <code dangerouslySetInnerHTML={{ __html: highlightCli(cliCommand) }} />
                </pre>
                <button
                  onClick={() => handleCopy(cliCommand, 'cli')}
                  className="absolute right-2 top-2 rounded-sm p-1 text-text-tertiary transition-colors hover:bg-hover-bg hover:text-text-primary"
                  title={t('detail.copy')}
                >
                  {copied === 'cli' ? (
                    <Check className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </Tabs.Content>
          )}
          <Tabs.Content value="yaml">
            <div className="group relative">
              <pre className="overflow-x-auto rounded-sm bg-code-bg p-3 text-xs text-text-primary">
                <code dangerouslySetInnerHTML={{ __html: highlightYaml(yamlSnippet) }} />
              </pre>
              <button
                onClick={() => handleCopy(yamlSnippet, 'yaml')}
                className="absolute right-2 top-2 rounded-sm p-1 text-text-tertiary transition-colors hover:bg-hover-bg hover:text-text-primary"
                title={t('detail.copy')}
              >
                {copied === 'yaml' ? (
                  <Check className="h-3.5 w-3.5 text-green-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </Tabs.Content>
        </Tabs.Root>
      </div>

      {/* File tree */}
      {detail.files && detail.files.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-2 text-sm font-medium text-text-primary">{t('detail.filesTitle')}</h3>
          <FileTree files={detail.files} />
        </div>
      )}

      {/* Preview / SKILL.md content */}
      {previewHtml && (
        <div className="min-h-0 flex-1">
          <div
            className="registry-markdown text-sm text-text-secondary"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        </div>
      )}
    </div>
  );
}
