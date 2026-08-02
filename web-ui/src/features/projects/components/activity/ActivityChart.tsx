import { useCallback, useId, useMemo, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ActivityBucket } from '../../../../types/api';

interface ActivityChartProps {
  buckets: ActivityBucket[] | null | undefined;
}

const VIEW_W = 600;
const VIEW_H = 48;
const PAD_Y = 2;

function formatBucketTime(t: number): string {
  return new Date(t).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Cubic path with horizontal tangents — smooth curves without sharp corners or overshoot. */
function smoothLinePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    return `M${points[0]!.x.toFixed(2)},${points[0]!.y.toFixed(2)}`;
  }

  let d = `M${points[0]!.x.toFixed(2)},${points[0]!.y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i]!;
    const p1 = points[i + 1]!;
    const dx = (p1.x - p0.x) / 3;
    d += ` C${(p0.x + dx).toFixed(2)},${p0.y.toFixed(2)} ${(p1.x - dx).toFixed(2)},${p1.y.toFixed(2)} ${p1.x.toFixed(2)},${p1.y.toFixed(2)}`;
  }
  return d;
}

export function ActivityChart({ buckets }: ActivityChartProps) {
  const { t } = useTranslation('projects');
  const gradId = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);

  const data = useMemo(() => {
    if (!buckets || buckets.length === 0) {
      return Array.from({ length: 60 }, (_, i) => ({
        t: Date.now() - (59 - i) * 60_000,
        count: 0,
      }));
    }
    return buckets;
  }, [buckets]);

  const maxY = useMemo(
    () => Math.max(0, ...data.map((b) => b.count)),
    [data],
  );

  const { areaPath, linePath } = useMemo(() => {
    const n = data.length;
    if (n === 0) return { areaPath: '', linePath: '' };
    const yScale = maxY <= 0 ? () => VIEW_H - PAD_Y : (v: number) => {
      const usable = VIEW_H - PAD_Y * 2;
      return VIEW_H - PAD_Y - (v / maxY) * usable;
    };
    const xAt = (i: number) => (n === 1 ? 0 : (i / (n - 1)) * VIEW_W);

    const points = data.map((b, i) => ({ x: xAt(i), y: yScale(b.count) }));
    const line = smoothLinePath(points);
    const area = `${line} L${VIEW_W},${VIEW_H} L0,${VIEW_H} Z`;
    return { areaPath: area, linePath: line };
  }, [data, maxY]);

  const onMove = useCallback(
    (e: MouseEvent<SVGSVGElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      if (rect.width <= 0 || data.length === 0) return;
      const ratio = (e.clientX - rect.left) / rect.width;
      const idx = Math.min(
        data.length - 1,
        Math.max(0, Math.round(ratio * (data.length - 1))),
      );
      setHover(idx);
    },
    [data.length],
  );

  const hovered = hover != null ? data[hover] : null;
  const hoverX =
    hover != null && data.length > 1
      ? (hover / (data.length - 1)) * 100
      : hover === 0
        ? 0
        : 50;

  return (
    <div className="relative mb-2 w-full">
      <svg
        role="img"
        aria-label={t('activity.chartAria')}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="h-12 w-full cursor-crosshair"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-primary)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--accent-primary)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <line
          x1="0"
          y1={VIEW_H - 0.5}
          x2={VIEW_W}
          y2={VIEW_H - 0.5}
          stroke="var(--border-secondary)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        {areaPath && (
          <path d={areaPath} fill={`url(#${gradId})`} stroke="none" />
        )}
        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke="var(--accent-primary)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {hovered && hover != null && (
          <>
            <line
              x1={(hover / Math.max(1, data.length - 1)) * VIEW_W}
              y1="0"
              x2={(hover / Math.max(1, data.length - 1)) * VIEW_W}
              y2={VIEW_H}
              stroke="var(--border-primary)"
              strokeWidth="1"
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={(hover / Math.max(1, data.length - 1)) * VIEW_W}
              cy={
                maxY <= 0
                  ? VIEW_H - PAD_Y
                  : VIEW_H - PAD_Y - (hovered.count / maxY) * (VIEW_H - PAD_Y * 2)
              }
              r="3"
              fill="var(--accent-primary)"
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
      </svg>
      {hovered && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 -translate-y-full rounded-sm border border-border-secondary bg-bg-primary px-2 py-1 text-[10px] text-text-secondary shadow-sm"
          style={{ left: `${hoverX}%` }}
        >
          <span className="tabular-nums text-text-primary">{hovered.count}</span>
          {' · '}
          {formatBucketTime(hovered.t)}
        </div>
      )}
      <div className="mt-0.5 flex justify-between text-[10px] text-text-tertiary tabular-nums">
        <span>{formatBucketTime(data[0]?.t ?? Date.now() - 3_600_000)}</span>
        <span>{t('activity.chartWindow')}</span>
        <span>{formatBucketTime(data[data.length - 1]?.t ?? Date.now())}</span>
      </div>
    </div>
  );
}
