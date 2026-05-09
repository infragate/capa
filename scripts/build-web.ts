import { $ } from 'bun';
import { existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(import.meta.dir, '..');
const WEB_UI_SRC = join(ROOT, 'web-ui', 'src');
const WEB_UI_DIST = join(ROOT, 'web-ui', 'dist');
const GENERATED = join(WEB_UI_SRC, '.generated');

async function buildWeb() {
  console.log('[build-web] Building web UI...');

  if (!existsSync(GENERATED)) {
    mkdirSync(GENERATED, { recursive: true });
  }

  if (!existsSync(WEB_UI_DIST)) {
    mkdirSync(WEB_UI_DIST, { recursive: true });
  }

  // Step 0: Read logo assets
  const DOCS_PUBLIC = join(ROOT, 'capa-docs', 'public');
  const faviconSvgPath = join(DOCS_PUBLIC, 'favicon.svg');
  const logoPngPath = join(DOCS_PUBLIC, 'favicon-white.png');

  let faviconDataUrl = '';
  let logoPngDataUrl = '';

  if (existsSync(faviconSvgPath)) {
    const svgBuf = await Bun.file(faviconSvgPath).arrayBuffer();
    faviconDataUrl = `data:image/svg+xml;base64,${Buffer.from(svgBuf).toString('base64')}`;
  }
  if (existsSync(logoPngPath)) {
    const pngBuf = await Bun.file(logoPngPath).arrayBuffer();
    logoPngDataUrl = `data:image/png;base64,${Buffer.from(pngBuf).toString('base64')}`;
  }

  // Step 1: Compile Tailwind CSS
  console.log('[build-web] Compiling Tailwind CSS...');
  const tailwindInput = join(WEB_UI_SRC, 'index.css');
  const tailwindOutput = join(GENERATED, 'tailwind.css');

  const tailwindResult = await $`bunx @tailwindcss/cli -i ${tailwindInput} -o ${tailwindOutput} --minify`.quiet().nothrow();
  if (tailwindResult.exitCode !== 0) {
    console.error('[build-web] Tailwind compilation failed:');
    console.error(tailwindResult.stderr.toString());
    process.exit(1);
  }
  console.log('[build-web] Tailwind CSS compiled successfully');

  // Step 2: Bundle with Bun
  console.log('[build-web] Bundling with Bun...');
  const entrypoint = join(WEB_UI_SRC, 'main.tsx');

  const buildResult = await Bun.build({
    entrypoints: [entrypoint],
    outdir: WEB_UI_DIST,
    target: 'browser',
    minify: true,
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  });

  if (!buildResult.success) {
    console.error('[build-web] Bun build failed:');
    for (const log of buildResult.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  // Step 3: Read the compiled assets and produce a single HTML file
  console.log('[build-web] Assembling single HTML file...');
  const jsFile = buildResult.outputs.find((o) => o.path.endsWith('.js'));
  const cssContent = await Bun.file(tailwindOutput).text();
  const jsRaw = jsFile ? await Bun.file(jsFile.path).text() : '';
  // Escape </script> inside the inlined JS so the HTML parser doesn't close the tag early
  const jsContent = jsRaw.replaceAll('</script>', '<\\/script>');

  const faviconLink = faviconDataUrl
    ? `<link rel="icon" type="image/svg+xml" href="${faviconDataUrl}" />`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>CAPA</title>
${faviconLink}
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
<style>${cssContent}</style>
</head>
<body>
<div id="root" data-logo="${logoPngDataUrl}"></div>
<script type="module">${jsContent}</script>
</body>
</html>`;

  const outputPath = join(WEB_UI_DIST, 'index.html');
  await Bun.write(outputPath, html);

  const stat = Bun.file(outputPath);
  const sizeKb = ((await stat.size) / 1024).toFixed(1);
  console.log(`[build-web] Output: ${outputPath} (${sizeKb} KB)`);
  console.log('[build-web] Build complete.');
}

buildWeb().catch((err) => {
  console.error('[build-web] Fatal error:', err);
  process.exit(1);
});
