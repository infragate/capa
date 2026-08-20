export type ViewTransform = {
  scale: number;
  x: number;
  y: number;
};

export const DEFAULT_DIAGRAM_TRANSFORM: ViewTransform = { scale: 1, x: 24, y: 24 };

export const DIAGRAM_MIN_SCALE = 0.15;
export const DIAGRAM_MAX_SCALE = 3;
