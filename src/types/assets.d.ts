/** Bun `with { type: 'text' }` SVG imports resolve to the file contents as a string. */
declare module '*.svg' {
  const content: string;
  export default content;
}
