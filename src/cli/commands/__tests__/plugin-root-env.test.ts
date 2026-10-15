import { describe, expect, it } from 'bun:test';
import { withPluginRootEnv } from '../plugin-install';

describe('withPluginRootEnv (#326)', () => {
  const root = 'C:\\Users\\me\\.capa\\plugins\\p\\ponytail';

  it('sets CLAUDE_PLUGIN_ROOT for a hook that reads it at runtime', () => {
    const cmd =
      "node -e \"require(require('path').join(process.env.CLAUDE_PLUGIN_ROOT, 'hooks/ponytail-activate.js'))\"";
    expect(withPluginRootEnv(cmd, undefined, root)).toEqual({
      command: `CLAUDE_PLUGIN_ROOT=C:/Users/me/.capa/plugins/p/ponytail ${cmd}`,
      args: undefined,
    });
  });

  it('turns an exec-form hook that reads it into one shell command', () => {
    expect(
      withPluginRootEnv('node', ['-e', 'console.log(process.env.CLAUDE_PLUGIN_ROOT)'], '/p/my plugin'),
    ).toEqual({
      command: "CLAUDE_PLUGIN_ROOT='/p/my plugin' node -e 'console.log(process.env.CLAUDE_PLUGIN_ROOT)'",
      args: undefined,
    });
  });

  it('leaves hooks that do not read it alone', () => {
    expect(withPluginRootEnv('node /p/x.js', undefined, root)).toEqual({
      command: 'node /p/x.js',
      args: undefined,
    });
    expect(withPluginRootEnv('node', ['/p/x.js'], root)).toEqual({ command: 'node', args: ['/p/x.js'] });
    // A name that merely contains it is not a read.
    expect(withPluginRootEnv('echo MY_CLAUDE_PLUGIN_ROOTS', undefined, root).command).toBe(
      'echo MY_CLAUDE_PLUGIN_ROOTS',
    );
  });
});
