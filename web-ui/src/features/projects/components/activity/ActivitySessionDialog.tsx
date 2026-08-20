import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, X } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import {
  useProjectActivityConversation,
  useProjectActivitySession,
} from '../../hooks';
import { ActivityRunDialog } from './ActivityRunDialog';
import {
  type ActivityRun,
  formatDuration,
  formatRelative,
  groupActivityConversations,
  maxSpanDuration,
} from './groupActivityRuns';
import { LatencyBar } from './ActivityShared';

export type ActivityTracesView =
  | { kind: 'session'; id: string }
  | { kind: 'conversation'; id: string };

interface ActivityTracesDialogProps {
  projectId: string;
  view: ActivityTracesView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectPath?: string | null;
}

export function ActivityTracesDialog({
  projectId,
  view,
  open,
  onOpenChange,
  projectPath = null,
}: ActivityTracesDialogProps) {
  const { t } = useTranslation('projects');
  const sessionQuery = useProjectActivitySession(
    open && view?.kind === 'session' ? projectId : null,
    open && view?.kind === 'session' ? view.id : null,
  );
  const conversationQuery = useProjectActivityConversation(
    open && view?.kind === 'conversation' ? projectId : null,
    open && view?.kind === 'conversation' ? view.id : null,
  );

  const conversationRuns = useMemo(() => {
    if (!conversationQuery.data) return [];
    return groupActivityConversations(conversationQuery.data).flatMap((c) => c.generations);
  }, [conversationQuery.data]);

  if (view?.kind === 'conversation') {
    return (
      <ActivityRunDialog
        run={null}
        runs={conversationRuns}
        title={t('activity.conversation', {
          defaultValue: 'Conversation {{id}}',
          id: view.id,
        })}
        open={open}
        onOpenChange={onOpenChange}
        loading={conversationQuery.isLoading}
        error={conversationQuery.error ? (conversationQuery.error as Error).message : null}
        emptyLabel={t('activity.conversationTracesEmpty')}
        projectPath={projectPath}
      />
    );
  }

  return (
    <ActivitySessionTracesDialog
      sessionId={view?.kind === 'session' ? view.id : null}
      open={open}
      onOpenChange={onOpenChange}
      projectPath={projectPath}
      query={sessionQuery}
    />
  );
}

/** @deprecated Use ActivityTracesDialog */
export const ActivitySessionDialog = ActivityTracesDialog;

function ActivitySessionTracesDialog({
  sessionId,
  open,
  onOpenChange,
  projectPath,
  query,
}: {
  sessionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectPath?: string | null;
  query: ReturnType<typeof useProjectActivitySession>;
}) {
  const { t } = useTranslation('projects');
  const { data: calls, isLoading, error } = query;
  const conversations = useMemo(
    () => (calls ? groupActivityConversations(calls) : []),
    [calls],
  );
  const runs = useMemo(
    () => conversations.flatMap((c) => c.generations),
    [conversations],
  );
  const maxMs = useMemo(() => maxSpanDuration(runs), [runs]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const selectedRun = useMemo(
    () => (selectedRunId ? runs.find((r) => r.id === selectedRunId) ?? null : null),
    [runs, selectedRunId],
  );

  return (
    <>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="ui-overlay fixed inset-0 z-40 bg-black/45" />
          <Dialog.Content
            className={cn(
              'ui-dialog fixed z-50 flex w-[min(720px,94vw)] max-h-[min(85vh,720px)] flex-col',
              'overflow-hidden rounded-lg border border-border-primary bg-bg-secondary shadow-lg',
            )}
            onOpenAutoFocus={(e) => e.preventDefault()}
            aria-describedby={undefined}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border-secondary px-5 py-4">
              <div className="min-w-0">
                <Dialog.Title className="text-base font-medium text-text-primary">
                  {t('activity.sessionTraces')}
                </Dialog.Title>
                <Dialog.Description className="mt-1 truncate font-mono text-[11px] text-text-tertiary">
                  {sessionId}
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-md p-1.5 text-text-tertiary hover:bg-hover-bg cursor-pointer"
                  aria-label={t('activity.closeTracesView')}
                >
                  <X size={16} />
                </button>
              </Dialog.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {isLoading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-text-tertiary">
                  <Loader2 size={16} className="animate-spin" />
                  {t('activity.loading')}
                </div>
              ) : error ? (
                <p className="px-5 py-8 text-sm text-error-text">{(error as Error).message}</p>
              ) : runs.length === 0 ? (
                <p className="px-5 py-12 text-center text-sm text-text-tertiary">
                  {t('activity.sessionTracesEmpty')}
                </p>
              ) : (
                runs.map((run) => (
                  <TracesRunRow
                    key={run.id}
                    run={run}
                    maxMs={maxMs}
                    onOpen={() => setSelectedRunId(run.id)}
                  />
                ))
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ActivityRunDialog
        run={selectedRun}
        open={selectedRunId != null && selectedRun != null}
        onOpenChange={(next) => {
          if (!next) setSelectedRunId(null);
        }}
        projectPath={projectPath}
      />
    </>
  );
}

function TracesRunRow({
  run,
  maxMs,
  onOpen,
}: {
  run: ActivityRun;
  maxMs: number;
  onOpen: () => void;
}) {
  const spanCount = run.spans.length + (run.prompt ? 1 : 0);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-2 border-b border-border-secondary/90 px-4 py-2.5 text-left cursor-pointer hover:bg-hover-bg/60"
    >
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-primary">
        {run.title}
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-text-tertiary">{spanCount}</span>
      <LatencyBar ms={run.duration_ms} maxMs={maxMs} errored={run.hasError} />
      <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-text-secondary">
        {formatDuration(run.duration_ms)}
      </span>
      <span className="hidden w-14 shrink-0 text-right text-[11px] tabular-nums text-text-tertiary sm:block">
        {formatRelative(run.started_at)}
      </span>
    </button>
  );
}
