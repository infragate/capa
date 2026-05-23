import { useMemo } from 'react';
import hljsCore from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import { cn } from '../../lib/utils';

// Register grammars lazily on first import. We only ship the TS grammar
// because every adapter file is a `.ts` module; this keeps the bundle
// far smaller than pulling in the default `highlight.js` build.
let registered = false;
function ensureRegistered() {
  if (registered) return;
  hljsCore.registerLanguage('typescript', typescript);
  hljsCore.registerAliases(['ts', 'tsx'], { languageName: 'typescript' });
  registered = true;
}

interface CodeBlockProps {
  code: string;
  language?: string;
  className?: string;
}

export function CodeBlock({ code, language = 'typescript', className }: CodeBlockProps) {
  ensureRegistered();

  // hljs.highlight returns HTML that it produced itself (no user-controlled
  // markup is interpreted), so dangerouslySetInnerHTML is safe here.
  const html = useMemo(() => {
    try {
      return hljsCore.highlight(code, { language, ignoreIllegals: true }).value;
    } catch {
      return hljsCore.highlightAuto(code).value;
    }
  }, [code, language]);

  return (
    <pre
      className={cn(
        'hljs m-0 whitespace-pre-wrap break-all px-3 py-3 font-mono text-xs',
        className,
      )}
    >
      <code dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}
