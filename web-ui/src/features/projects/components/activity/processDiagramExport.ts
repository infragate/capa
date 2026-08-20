import type { ViewTransform } from './processDiagramTypes';

export type { ViewTransform };

const MIN_SCALE = 0.15;
const MAX_SCALE = 3;

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Fit rendered SVG content inside a pan/zoom viewport (used once when opening process view). */
export function fitDiagramTransform(
  viewport: HTMLElement,
  svgRoot: SVGSVGElement,
  padding = 32,
): ViewTransform {
  const vb = svgRoot.viewBox.baseVal;
  const contentW = vb.width > 0 ? vb.width : svgRoot.getBoundingClientRect().width || 1;
  const contentH = vb.height > 0 ? vb.height : svgRoot.getBoundingClientRect().height || 1;
  const availW = Math.max(viewport.clientWidth - padding * 2, 1);
  const availH = Math.max(viewport.clientHeight - padding * 2, 1);
  const scale = clampScale(Math.min(availW / contentW, availH / contentH));
  return {
    scale,
    x: (viewport.clientWidth - contentW * scale) / 2,
    y: (viewport.clientHeight - contentH * scale) / 2,
  };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadText(text: string, filename: string, mimeType: string): void {
  downloadBlob(new Blob([text], { type: mimeType }), filename);
}

export async function exportSvgAsPng(
  svgMarkup: string,
  filename: string,
  backgroundColor: string,
): Promise<void> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgMarkup, 'image/svg+xml');
  const svgEl = doc.documentElement;
  const vb = svgEl.viewBox.baseVal;
  const width = Math.ceil(vb.width > 0 ? vb.width : Number(svgEl.getAttribute('width')) || 800);
  const height = Math.ceil(vb.height > 0 ? vb.height : Number(svgEl.getAttribute('height')) || 600);

  if (!svgEl.getAttribute('xmlns')) {
    svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }

  const serialized = new XMLSerializer().serializeToString(svgEl);
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;

  await new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas not supported'));
        return;
      }
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('PNG export failed'));
          return;
        }
        downloadBlob(blob, filename);
        resolve();
      }, 'image/png');
    };
    img.onerror = () => reject(new Error('Failed to load SVG for PNG export'));
    img.src = dataUrl;
  });
}

export function exportBaseName(viewKey: string): string {
  const safe = viewKey.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe ? `process-${safe.slice(0, 48)}` : 'process-diagram';
}
