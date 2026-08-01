import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { AuthoredPlugin, ResolvedPlugin } from '../../../types/api';
import { Spinner } from '../../../components/common/Spinner';
import { useRegistries } from '../../registries/hooks';
import { registriesApi } from '../../registries/api';

function stripFrontmatter(md: string): string {
  return md.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '');
}

function renderMarkdown(md: string): string {
  const raw = marked.parse(stripFrontmatter(md), { async: false, gfm: true, breaks: true }) as string;
  return DOMPurify.sanitize(raw);
}

function listSection(title: string, items: string[] | undefined): string[] {
  if (!items?.length) return [];
  const lines = [`### ${title}`, ''];
  for (const id of items) {
    lines.push(`- \`${id}\``);
  }
  lines.push('');
  return lines;
}

function buildLocalPluginPreview(
  plugin: AuthoredPlugin,
  resolved: ResolvedPlugin | undefined,
): string {
  const title = resolved?.name || plugin.id || plugin.def.repo;
  const parts: string[] = [`# ${title}`, ''];
  if (plugin.def.repo) parts.push(`**Repository:** \`${plugin.def.repo}\``, '');
  if (resolved?.version || plugin.def.version) {
    parts.push(`**Version:** ${resolved?.version || plugin.def.version}`, '');
  }
  if (resolved?.provider) {
    parts.push(`**Provider:** \`${resolved.provider}\``, '');
  }

  const hasContents =
    (resolved?.skills?.length ?? 0) > 0 ||
    (resolved?.serverIds?.length ?? 0) > 0 ||
    (resolved?.subagentIds?.length ?? 0) > 0 ||
    (resolved?.hookIds?.length ?? 0) > 0 ||
    (resolved?.ruleIds?.length ?? 0) > 0;

  if (hasContents) {
    parts.push('## Contents', '');
    parts.push(
      ...listSection('Skills', resolved?.skills),
      ...listSection('Sub-agents', resolved?.subagentIds),
      ...listSection('Hooks', resolved?.hookIds),
      ...listSection('Rules', resolved?.ruleIds),
      ...listSection('MCP servers', resolved?.serverIds),
    );
  }

  parts.push('## Install', '');
  parts.push('```');
  parts.push(`capa add ${plugin.def.repo}`);
  parts.push('```');
  parts.push('');
  return parts.join('\n');
}

interface PluginPreviewDialogProps {
  plugin: AuthoredPlugin | null;
  resolved: ResolvedPlugin | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PluginPreviewDialog({
  plugin,
  resolved,
  open,
  onOpenChange,
}: PluginPreviewDialogProps) {
  const { t } = useTranslation('projects');
  const { data: registries = [] } = useRegistries();
  const pluginRegistries = registries.filter((r) => r.capabilities.includes('plugins'));
  const itemId = plugin?.id || null;

  const viewQueries = useQueries({
    queries: pluginRegistries.map((registry) => ({
      queryKey: ['registry-view', registry.id, 'plugins', itemId] as const,
      queryFn: () => registriesApi.view(registry.id, 'plugins', itemId!),
      enabled: open && !!itemId,
      retry: false,
      staleTime: 5 * 60_000,
    })),
  });

  const registryDetail = viewQueries.find((q) => q.data)?.data;
  const loading = !!itemId && viewQueries.some((q) => q.isLoading || q.isPending);
  const localPreview = useMemo(
    () => (plugin ? buildLocalPluginPreview(plugin, resolved) : ''),
    [plugin, resolved],
  );
  const previewMd = registryDetail?.preview || localPreview;
  const previewHtml = useMemo(
    () => (previewMd ? renderMarkdown(previewMd) : ''),
    [previewMd],
  );

  const matchedRegistryIndex = viewQueries.findIndex((q) => q.data != null && q.data === registryDetail);
  const matchedRegistry =
    matchedRegistryIndex >= 0 ? pluginRegistries[matchedRegistryIndex] : undefined;

  const title = registryDetail?.title || resolved?.name || plugin?.id || plugin?.def.repo || '';
  const description = registryDetail?.description;
  const meta = [
    matchedRegistry?.name,
    registryDetail?.author,
    registryDetail?.version || resolved?.version || plugin?.def.version,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-overlay fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="ui-dialog fixed z-50 flex max-h-[min(860px,92vh)] w-[min(720px,96vw)] flex-col overflow-hidden rounded-lg border border-border-primary bg-bg-secondary shadow-xl">
          <div className="flex items-start justify-between gap-3 border-b border-border-secondary px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="truncate font-mono text-base font-medium text-text-primary">
                {title}
              </Dialog.Title>
              {description && (
                <p className="mt-1 text-xs text-text-secondary">{description}</p>
              )}
              {meta && <p className="mt-1 text-[11px] text-text-tertiary">{meta}</p>}
              {!description && plugin?.def.repo && (
                <p className="mt-1 font-mono text-[11px] text-text-tertiary">{plugin.def.repo}</p>
              )}
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-sm p-1 text-text-tertiary hover:bg-hover-bg cursor-pointer"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {loading && !registryDetail && <Spinner className="py-12" />}
            {!loading && previewHtml ? (
              <div
                className="registry-markdown overflow-hidden text-sm text-text-secondary"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            ) : null}
            {!loading && !previewHtml && (
              <p className="py-8 text-center text-xs text-text-tertiary">{t('actions.noPreview')}</p>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
