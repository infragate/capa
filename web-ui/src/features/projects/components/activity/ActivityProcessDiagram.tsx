import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import mermaid from 'mermaid';
import type { ActivityRun } from './groupActivityRuns';
import {
  buildProcessGraph,
  toMermaidFlowchart,
  type MermaidClassColors,
  type ProcessGraph,
} from './buildProcessGraph';

interface ActivityProcessDiagramProps {
  runs: ActivityRun[];
  /** Changes when viewing a different run/conversation; pan/zoom resets only then. */
  viewKey: string;
}

const MIN_SCALE = 0.15;
const MAX_SCALE = 3;

type ViewTransform = {
  scale: number;
  x: number;
  y: number;
};

function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function capaMermaidColors(): MermaidClassColors {
  return {
    startFill: cssVar('--success-btn', '#34d399'),
    startText: cssVar('--bg-secondary', '#0f1120'),
    startStroke: cssVar('--success-text', '#34d399'),
    toolFill: cssVar('--accent-primary', '#818cf8'),
    toolText: cssVar('--bg-secondary', '#0f1120'),
    toolStroke: cssVar('--accent-hover', '#a5b4fc'),
    skillFill: cssVar('--info-bg', '#1a1540'),
    skillText: cssVar('--info-text', '#818cf8'),
    skillStroke: cssVar('--info-border', '#1e2036'),
    errorFill: cssVar('--error-bg', '#2d1215'),
    errorText: cssVar('--error-text', '#f87171'),
    errorStroke: cssVar('--error-border', '#1e2036'),
    edge: cssVar('--accent-primary', '#818cf8'),
    edgeLabelBg: cssVar('--bg-secondary', '#0f1120'),
    edgeLabelText: cssVar('--text-primary', '#f1f5f9'),
  };
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

const DEFAULT_TRANSFORM: ViewTransform = { scale: 1, x: 24, y: 24 };

/** Survives ProcessMermaid remounts during live diagram updates. */
const viewTransformByKey = new Map<string, ViewTransform>();
let activeDiagramViewKey: string | undefined;

function usePersistedViewTransform(viewKey: string): [
  ViewTransform,
  (next: ViewTransform | ((prev: ViewTransform) => ViewTransform)) => void,
] {
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (activeDiagramViewKey === viewKey) return;
    activeDiagramViewKey = viewKey;
    viewTransformByKey.set(viewKey, DEFAULT_TRANSFORM);
    forceRender((n) => n + 1);
  }, [viewKey]);

  const transform = viewTransformByKey.get(viewKey) ?? DEFAULT_TRANSFORM;

  const setTransform = useCallback(
    (next: ViewTransform | ((prev: ViewTransform) => ViewTransform)) => {
      const prev = viewTransformByKey.get(viewKey) ?? DEFAULT_TRANSFORM;
      const value = typeof next === 'function' ? next(prev) : next;
      viewTransformByKey.set(viewKey, value);
      forceRender((n) => n + 1);
    },
    [viewKey],
  );

  return [transform, setTransform];
}

function ProcessMermaid({ graph, viewKey }: { graph: ProcessGraph; viewKey: string }) {
  const { t } = useTranslation('projects');
  const rawId = useId();
  const renderId = `capaProcess${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const viewportRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState('');
  const [failed, setFailed] = useState(false);
  const [transform, setTransform] = usePersistedViewTransform(viewKey);
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const [themeKey, setThemeKey] = useState(
    () => document.documentElement.getAttribute('data-theme') ?? 'dark',
  );
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  useEffect(() => {
    const el = document.documentElement;
    const observer = new MutationObserver(() => {
      setThemeKey(el.getAttribute('data-theme') ?? 'dark');
    });
    observer.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const colors = capaMermaidColors();
    const definition = toMermaidFlowchart(graph, colors, (count) =>
      t('activity.processAnalysis.nodeErrors', { count }),
    );
    const textPrimary = colors.edgeLabelText;

    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: 'base',
      themeVariables: {
        background: cssVar('--bg-tertiary', '#141627'),
        primaryColor: colors.toolFill,
        primaryTextColor: textPrimary,
        primaryBorderColor: colors.toolStroke,
        secondaryColor: colors.skillFill,
        tertiaryColor: cssVar('--bg-secondary', '#0f1120'),
        lineColor: colors.edge,
        textColor: textPrimary,
        mainBkg: colors.toolFill,
        nodeBorder: colors.toolStroke,
        clusterBkg: cssVar('--bg-secondary', '#0f1120'),
        titleColor: textPrimary,
        edgeLabelBackground: colors.edgeLabelBg,
        fontFamily: 'Inter, sans-serif',
        fontSize: '16px',
      },
      flowchart: {
        htmlLabels: false,
        curve: 'basis',
        padding: 20,
        nodeSpacing: 50,
        rankSpacing: 80,
        useMaxWidth: false,
      },
    });

    const id = `${renderId}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    mermaid
      .render(id, definition)
      .then(({ svg: next }) => {
        if (!cancelled) {
          setSvg(next);
          setFailed(false);
        }
      })
      .catch((err: unknown) => {
        console.error('Process diagram mermaid render failed', err, definition);
        if (!cancelled) {
          setSvg('');
          setFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [graph, renderId, t, themeKey]);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    e.currentTarget.setPointerCapture(e.pointerId);
    const current = transformRef.current;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: current.x,
      originY: current.y,
    };
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    setTransform((prev) => ({
      ...prev,
      x: drag.originX + (e.clientX - drag.startX),
      y: drag.originY + (e.clientY - drag.startY),
    }));
  }, []);

  const endDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === e.pointerId) {
      dragRef.current = null;
    }
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
      setTransform((prev) => {
        const nextScale = clampScale(prev.scale * factor);
        const ratio = nextScale / prev.scale;
        return {
          scale: nextScale,
          x: cursorX - (cursorX - prev.x) * ratio,
          y: cursorY - (cursorY - prev.y) * ratio,
        };
      });
    };
    viewport.addEventListener('wheel', onNativeWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onNativeWheel);
  }, []);

  return (
    <div
      ref={viewportRef}
      className="relative h-full min-h-0 cursor-grab touch-none select-none overflow-hidden bg-bg-tertiary active:cursor-grabbing"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {!svg && !failed ? (
        <div className="absolute inset-0 bg-bg-tertiary" aria-hidden />
      ) : null}
      {failed ? (
        <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-text-tertiary">
          {t('activity.processAnalysis.renderError')}
        </p>
      ) : null}
      {svg ? (
        <div
          className="pointer-events-none origin-top-left select-none [&_*]:select-none [&_svg]:h-auto [&_svg]:max-w-none [&_.edgeLabel_rect]:stroke-none [&_span.edgeLabel]:border-0 [&_span.edgeLabel]:bg-transparent [&_span.edgeLabel]:p-0"
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : null}
    </div>
  );
}

export function ActivityProcessDiagram({ runs, viewKey }: ActivityProcessDiagramProps) {
  const { t } = useTranslation('projects');
  const graph = useMemo(() => buildProcessGraph(runs), [runs]);

  if (graph.activities.length === 0) {
    return (
      <p className="px-4 py-12 text-center text-sm text-text-tertiary">
        {t('activity.processAnalysis.empty')}
      </p>
    );
  }

  if (graph.edges.length === 0) {
    return (
      <div className="px-4 py-8">
        <p className="text-center text-sm text-text-tertiary">
          {t('activity.processAnalysis.singleActivity')}
        </p>
        <ul className="mx-auto mt-4 max-w-md space-y-2">
          {graph.activities.map((activity) => (
            <li
              key={activity.id}
              className="rounded-md border border-border-secondary bg-bg-primary px-3 py-2 text-xs"
            >
              <div className="font-medium text-text-primary">{activity.label}</div>
              <div className="mt-1 tabular-nums text-[10px] text-text-tertiary">
                {t('activity.processAnalysis.occurrences', {
                  count: graph.nodeCounts[activity.id] ?? 0,
                })}
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-secondary px-4 py-2 text-[11px] text-text-tertiary">
        <span>
          {t('activity.processAnalysis.summary', {
            activities: graph.activities.length,
            transitions: graph.edges.length,
            traces: graph.traceCount,
          })}
        </span>
        <span>{t('activity.processAnalysis.panHint')}</span>
      </div>
      <ProcessMermaid graph={graph} viewKey={viewKey} />
    </div>
  );
}
