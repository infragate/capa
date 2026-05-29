import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { cleanCommand } from '../clean';

function isolateHome(): { restore: () => void } {
  const home = mkdtempSync(join(tmpdir(), 'capa-clean-home-'));
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  return {
    restore: () => {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      if (prevUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = prevUserProfile;
      try {
        rmSync(home, { recursive: true, force: true });
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException)?.code !== 'EBUSY') throw error;
      }
    },
  };
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function captureOutput<T>(fn: () => Promise<T> | T): Promise<{ stdout: string; result: T }> {
  return (async () => {
    const lines: string[] = [];
    const origLog = console.log;
    const origWarn = console.warn;
    const origErr = console.error;
    const origStdoutWrite = process.stdout.write.bind(process.stdout);
    const origStderrWrite = process.stderr.write.bind(process.stderr);

    const capture = (chunk: unknown) => {
      if (typeof chunk === 'string') {
        lines.push(stripAnsi(chunk));
      }
    };

    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    };
    console.warn = (...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    };
    console.error = (...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    };
    process.stdout.write = ((chunk, ...args: unknown[]) => {
      capture(chunk);
      return (origStdoutWrite as (...a: unknown[]) => boolean)(chunk, ...args);
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk, ...args: unknown[]) => {
      capture(chunk);
      return (origStderrWrite as (...a: unknown[]) => boolean)(chunk, ...args);
    }) as typeof process.stderr.write;

    try {
      const result = await fn();
      return { stdout: lines.join('\n'), result };
    } finally {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origErr;
      process.stdout.write = origStdoutWrite;
      process.stderr.write = origStderrWrite;
    }
  })();
}

describe('cleanCommand', () => {
  let projectDir: string;
  let homeCtx: { restore: () => void };
  let originalCwd: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'capa-clean-project-'));
    homeCtx = isolateHome();
    originalCwd = process.cwd();
    process.chdir(projectDir);

    writeFileSync(
      join(projectDir, 'capabilities.yaml'),
      `options:
  toolExposure: on-demand
skills: []
servers: []
tools: []
`,
      'utf-8'
    );
  });

  afterEach(() => {
    process.chdir(originalCwd);
    homeCtx.restore();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('module loads and exports cleanCommand', () => {
    expect(typeof cleanCommand).toBe('function');
  });

  it('exits cleanly when there are no managed files', async () => {
    const { stdout } = await captureOutput(() => cleanCommand());
    expect(stdout).toContain('No files to clean.');
    expect(stdout).toContain('Cleanup complete!');
  });

  it('removes capa-managed snippets from CLAUDE.md / AGENTS.md even when capabilities.yaml has no `agents:` block', async () => {
    // Sub-agent integrations (e.g. Claude's foldSubAgentsIntoInstructions)
    // can write capa snippets into the provider's instructions file without
    // a top-level `agents:` block, so `capa clean` must always run the
    // agents-file cleanup for each active provider.
    //
    // With the `getTargetFilenames` fix, claude-code only manages `CLAUDE.md`
    // (no stray `AGENTS.md`), so this test enables both `claude-code` and
    // `codex` to exercise the multi-file cleanup path.
    writeFileSync(
      join(projectDir, 'capabilities.yaml'),
      `providers: [claude-code, codex]
options:
  toolExposure: on-demand
skills: []
servers: []
tools: []
`,
      'utf-8'
    );
    writeFileSync(
      join(projectDir, 'CLAUDE.md'),
      `<!-- capa:start:sub-agent:researcher -->
## Agent: researcher

**MCP server key:** \`capa-researcher\`
<!-- capa:end:sub-agent:researcher -->
`,
      'utf-8'
    );
    writeFileSync(
      join(projectDir, 'AGENTS.md'),
      `<!-- capa:start:sub-agent:researcher -->
researcher block
<!-- capa:end:sub-agent:researcher -->
`,
      'utf-8'
    );

    await captureOutput(() => cleanCommand());

    // Both files were entirely capa-managed, so they should now be gone.
    expect(existsSync(join(projectDir, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(projectDir, 'AGENTS.md'))).toBe(false);
  });

  it('leaves a pre-existing AGENTS.md alone when claude-code is the only provider', async () => {
    // Regression: capa used to seed AGENTS.md unconditionally into the target
    // file list, so a claude-code-only `capa clean` would scan AGENTS.md even
    // though no claude-code install ever writes one. With the fix,
    // `getTargetFilenames(['claude-code'])` returns just `CLAUDE.md` and a
    // hand-authored AGENTS.md (e.g. for another tool the user is also using)
    // must not be touched.
    writeFileSync(
      join(projectDir, 'capabilities.yaml'),
      `providers: [claude-code]
options:
  toolExposure: on-demand
skills: []
servers: []
tools: []
`,
      'utf-8'
    );
    writeFileSync(
      join(projectDir, 'AGENTS.md'),
      `# My project

Hand-authored AGENTS.md unrelated to claude-code.
`,
      'utf-8'
    );

    await captureOutput(() => cleanCommand());

    expect(existsSync(join(projectDir, 'AGENTS.md'))).toBe(true);
    const remaining = readFileSync(join(projectDir, 'AGENTS.md'), 'utf-8');
    expect(remaining).toContain('Hand-authored AGENTS.md unrelated to claude-code.');
  });

  it('preserves non-capa content in CLAUDE.md while removing capa snippets', async () => {
    writeFileSync(
      join(projectDir, 'capabilities.yaml'),
      `providers: [claude-code]
options:
  toolExposure: on-demand
skills: []
servers: []
tools: []
`,
      'utf-8'
    );
    writeFileSync(
      join(projectDir, 'CLAUDE.md'),
      `# My project notes

Hand-written content that should not be touched.

<!-- capa:start:sub-agent:researcher -->
capa managed
<!-- capa:end:sub-agent:researcher -->
`,
      'utf-8'
    );

    await captureOutput(() => cleanCommand());

    expect(existsSync(join(projectDir, 'CLAUDE.md'))).toBe(true);
    const remaining = readFileSync(join(projectDir, 'CLAUDE.md'), 'utf-8');
    expect(remaining).toContain('Hand-written content');
    expect(remaining).not.toContain('capa managed');
    expect(remaining).not.toContain('capa:start');
  });
});
