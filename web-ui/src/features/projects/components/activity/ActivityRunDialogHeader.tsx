import * as Dialog from '@radix-ui/react-dialog';
import { ArrowDown, Maximize2, Minimize2, Pause, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../../lib/utils';
import {
  formatDuration,
  formatRelative,
  type RunTokenTotals,
} from './groupActivityRuns';
import { sourceLabelText, TokenUsageLabel } from './ActivityShared';
import { ActivityRunViewTabs, type ActivityRunRightView } from './ActivityRunViewTabs';

type ActivityRunDialogHeaderProps = {
  displayTitle: string;
  displaySource: string | null;
  displayStartedAt: number;
  displayDuration: number | null;
  multiMode: boolean;
  activeRunCount: number;
  eventCount: number;
  tokenTotals: RunTokenTotals;
  errors: number;
  live: boolean;
  running: boolean;
  rightView: ActivityRunRightView;
  onRightViewChange: (view: ActivityRunRightView) => void;
  followLatest: boolean;
  onFollowLatest: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
};

export function ActivityRunDialogHeader({
  displayTitle,
  displaySource,
  displayStartedAt,
  displayDuration,
  multiMode,
  activeRunCount,
  eventCount,
  tokenTotals,
  errors,
  live,
  running,
  rightView,
  onRightViewChange,
  followLatest,
  onFollowLatest,
  fullscreen,
  onToggleFullscreen,
}: ActivityRunDialogHeaderProps) {
  const { t } = useTranslation('projects');

  return (
    <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border-secondary px-5 py-4">
      <div className="min-w-0 flex-1">
        <Dialog.Title className="truncate text-base font-medium text-text-primary">
          {displayTitle}
        </Dialog.Title>
        <Dialog.Description className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-tertiary">
          <span>{sourceLabelText(displaySource, t)}</span>
          <span className="tabular-nums">{formatRelative(displayStartedAt)}</span>
          {multiMode ? (
            <span className="tabular-nums">
              {activeRunCount}{' '}
              {activeRunCount === 1 ? t('activity.generation') : t('activity.generations')}
            </span>
          ) : null}
          <span className="tabular-nums">
            {eventCount} {eventCount === 1 ? t('activity.span') : t('activity.spans')}
          </span>
          <span className="tabular-nums">{formatDuration(displayDuration)}</span>
          {tokenTotals.hasAny ? <TokenUsageLabel totals={tokenTotals} t={t} /> : null}
          {errors > 0 ? (
            <span className="font-medium text-error-text">
              {errors} {t('activity.errors')}
            </span>
          ) : (
            <span className="text-status-connected-dot">{t('activity.runOk')}</span>
          )}
          {(live || running) && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-primary" />
              {t('activity.live')}
            </span>
          )}
        </Dialog.Description>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <ActivityRunViewTabs
          value={rightView}
          onChange={onRightViewChange}
          tracesLabel={t('activity.processAnalysis.tabTraces')}
          processLabel={t('activity.processAnalysis.tabProcess')}
        />
        <button
          type="button"
          onClick={onFollowLatest}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium cursor-pointer',
            followLatest
              ? 'bg-accent-primary/15 text-accent-primary'
              : 'bg-bg-tertiary text-text-secondary hover:bg-hover-bg',
          )}
          title={followLatest ? t('activity.followingLatest') : t('activity.followLatest')}
        >
          {followLatest ? <ArrowDown size={12} /> : <Pause size={12} />}
          {followLatest ? t('activity.followingLatest') : t('activity.followLatest')}
        </button>
        <button
          type="button"
          onClick={onToggleFullscreen}
          className="rounded-md p-1.5 text-text-tertiary hover:bg-hover-bg cursor-pointer"
          title={fullscreen ? t('activity.exitFullscreen') : t('activity.enterFullscreen')}
          aria-label={fullscreen ? t('activity.exitFullscreen') : t('activity.enterFullscreen')}
        >
          {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
        <Dialog.Close asChild>
          <button
            type="button"
            className="rounded-md p-1.5 text-text-tertiary hover:bg-hover-bg cursor-pointer"
            aria-label={t('activity.closeRun')}
          >
            <X size={16} />
          </button>
        </Dialog.Close>
      </div>
    </div>
  );
}
