import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'child_process';
import { withPluginRootEnv } from '../plugin-install';

describe('withPluginRootEnv (#326)', () => {
  const root = 'C:\\Users\\me\\.capa\\plugins\\p\\ponytail';

  it('sets CLAUDE_PLUGIN_ROOT for a hook that reads it at runtime', () => {
    const cmd =
      "node -e \"require(require('path').join(process.env.CLAUDE_PLUGIN_ROOT, 'hooks/ponytail-activate.js'))\"";
    expect(withPluginRootEnv(cmd, undefined, root)).toEqual({
      command: `export CLAUDE_PLUGIN_ROOT=C:/Users/me/.capa/plugins/p/ponytail; ${cmd}`,
      args: undefined,
      setsRoot: true,
    });
  });

  it('turns an exec-form hook that reads it into one shell command', () => {
    expect(
      withPluginRootEnv('node', ['-e', 'console.log(process.env.CLAUDE_PLUGIN_ROOT)'], '/p/my plugin'),
    ).toEqual({
      command: "export CLAUDE_PLUGIN_ROOT='/p/my plugin'; node -e 'console.log(process.env.CLAUDE_PLUGIN_ROOT)'",
      args: undefined,
      setsRoot: true,
    });
  });

  it('recognizes the usual runtime reads', () => {
    for (const cmd of [
      'sh "$CLAUDE_PLUGIN_ROOT/run.sh"',
      'sh "${CLAUDE_PLUGIN_ROOT:-.}/run.sh"',
      'python -c "import os; print(os.environ[\'CLAUDE_PLUGIN_ROOT\'])"',
      'python -c "import os; print(os.getenv(\'CLAUDE_PLUGIN_ROOT\'))"',
      'node -e "console.log(process.env[\'CLAUDE_PLUGIN_ROOT\'])"',
      'pwsh -c "$env:CLAUDE_PLUGIN_ROOT"',
      'cmd /c "%CLAUDE_PLUGIN_ROOT%\\run.cmd"',
    ]) {
      expect(withPluginRootEnv(cmd, undefined, root).setsRoot).toBe(true);
    }
  });

  it('leaves hooks that do not read it alone', () => {
    for (const cmd of ['node /p/x.js', 'env | grep -q CLAUDE_PLUGIN_ROOT', 'echo MY_CLAUDE_PLUGIN_ROOTS']) {
      expect(withPluginRootEnv(cmd, undefined, root)).toEqual({ command: cmd, args: undefined, setsRoot: false });
    }
    expect(withPluginRootEnv('node', ['/p/x.js'], root)).toEqual({
      command: 'node',
      args: ['/p/x.js'],
      setsRoot: false,
    });
  });

  it('reaches every command of a chain', () => {
    const { command } = withPluginRootEnv(
      'echo ready && node -e "console.log(process.env.CLAUDE_PLUGIN_ROOT)"',
      undefined,
      'C:/plugins/root', // Git Bash would rewrite /p/root to P:/root for node
    );
    const run = spawnSync('bash', ['-c', command!], { encoding: 'utf8' });
    if (run.error) return; // no bash on this machine
    expect(run.stdout.trim().split('\n')).toEqual(['ready', 'C:/plugins/root']);
  });
});
