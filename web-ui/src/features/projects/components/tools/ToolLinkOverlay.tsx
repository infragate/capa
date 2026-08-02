import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { findAnchorEl, clipYToPanel, type ToolLink } from './anchors';

export function ToolLinkOverlay({
  containerRef,
  links,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  links: ToolLink[];
}) {
  const [paths, setPaths] = useState<Array<{ d: string; key: string }>>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const rafRef = useRef<number | null>(null);
  const pathsKeyRef = useRef('');

  const redraw = useCallback(() => {
    const root = containerRef.current;
    if (!root) return;
    const rootRect = root.getBoundingClientRect();
    const nextW = root.clientWidth;
    const nextH = root.clientHeight;

    if (rootRect.width < 1024) {
      if (pathsKeyRef.current !== '') {
        pathsKeyRef.current = '';
        setPaths([]);
      }
      return;
    }

    const next: Array<{ d: string; key: string }> = [];
    for (const link of links) {
      const fromEl = findAnchorEl(root, link.fromKey);
      const toEl = findAnchorEl(root, link.toKey);
      if (!fromEl || !toEl) continue;

      const from = fromEl.getBoundingClientRect();
      const to = toEl.getBoundingClientRect();
      const x1 = from.right - rootRect.left;
      const x2 = to.left - rootRect.left;
      const rawY1 = from.top + from.height / 2 - rootRect.top;
      const rawY2 = to.top + to.height / 2 - rootRect.top;

      const fromClip = clipYToPanel(fromEl, rawY1, rootRect);
      const toClip = clipYToPanel(toEl, rawY2, rootRect);
      if (!fromClip.inView && !toClip.inView) continue;

      const y1 = fromClip.y;
      const y2 = toClip.y;
      const dx = Math.max(40, (x2 - x1) * 0.45);
      const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
      next.push({ d, key: `${link.fromKey}->${link.toKey}` });
    }

    const key = next.map((p) => p.d).join('|');
    if (key !== pathsKeyRef.current) {
      pathsKeyRef.current = key;
      setPaths(next);
    }
    setSize((prev) => (prev.w === nextW && prev.h === nextH ? prev : { w: nextW, h: nextH }));
  }, [containerRef, links]);

  const scheduleRedraw = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      redraw();
    });
  }, [redraw]);

  useLayoutEffect(() => {
    redraw();
  }, [redraw]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const observed = new Set<Element>();
    const ro = new ResizeObserver(() => scheduleRedraw());

    const observeEl = (el: Element) => {
      if (observed.has(el)) return;
      observed.add(el);
      ro.observe(el);
    };

    const syncObservers = () => {
      observeEl(root);
      root.querySelectorAll('[data-tools-panel-content]').forEach(observeEl);
      root.querySelectorAll('[data-link-anchor]').forEach(observeEl);
    };

    syncObservers();
    const mo = new MutationObserver(() => {
      syncObservers();
      scheduleRedraw();
    });
    mo.observe(root, { childList: true, subtree: true });

    window.addEventListener('scroll', scheduleRedraw, true);
    return () => {
      mo.disconnect();
      ro.disconnect();
      observed.clear();
      window.removeEventListener('scroll', scheduleRedraw, true);
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [containerRef, scheduleRedraw]);

  if (paths.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-20 hidden overflow-hidden lg:block text-accent-primary"
      width={size.w}
      height={size.h}
      aria-hidden
    >
      {paths.map((p) => (
        <path
          key={p.key}
          d={p.d}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="opacity-80"
        />
      ))}
    </svg>
  );
}
