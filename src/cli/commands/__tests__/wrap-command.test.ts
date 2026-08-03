import { describe, it, expect, mock, beforeEach, spyOn } from 'bun:test';

const ensureServerMock = mock(async () => ({
  running: true,
  url: 'http://127.0.0.1:5912',
}));

const prepareWorkspaceMock = mock(async () => ({
  cachePath: '/tmp/capa-wrap-cache',
  workspacePath: '/tmp/capa-wrap-ws',
  realProjectPath: '/tmp/capa-wrap-real',
  capabilitiesPath: '/tmp/capa-wrap-real/capabilities.yaml',
  exclusionProviderIds: [] as string[],
  cold: false,
  installed: false,
}));

const pruneWorkspacesMock = mock(async () => 0);

const ensureBinaryMock = mock(async () => {});

const launchProviderMock = mock(async () => ({
  closed: Promise.resolve(0),
  kill: () => {},
}));

const startWrapWatchersMock = mock(() => ({
  stop: () => {},
  exitSweep: () => {},
}));

const writeWrapSessionMock = mock(() => true);
const clearWrapSessionMock = mock(() => {});

mock.module('../../utils/server-manager', () => ({
  ensureServer: ensureServerMock,
  startServer: mock(async () => {}),
  stopServer: mock(async () => {}),
  getServerStatus: mock(async () => ({ running: false })),
  restartServer: mock(async () => {}),
}));

mock.module('../../utils/wrap/workspace', () => ({
  prepareWorkspace: prepareWorkspaceMock,
  pruneWorkspaces: pruneWorkspacesMock,
}));

mock.module('../wrap-ensure-binary', () => ({
  ensureWrapBinaryOnPath: ensureBinaryMock,
}));

mock.module('../../utils/wrap/launch', () => ({
  launchProvider: launchProviderMock,
}));

mock.module('../../utils/wrap/watch-project', () => ({
  startWrapWatchers: startWrapWatchersMock,
}));

mock.module('../../utils/wrap/session-file', () => ({
  writeWrapSession: writeWrapSessionMock,
  clearWrapSession: clearWrapSessionMock,
}));

mock.module('../../utils/wrap/wait-for-interrupt', () => ({
  waitForInterrupt: mock(async () => {
    await new Promise(() => {});
  }),
}));

const { wrapCommand } = await import('../wrap');

describe('wrapCommand', () => {
  beforeEach(() => {
    ensureServerMock.mockClear();
    prepareWorkspaceMock.mockClear();
    pruneWorkspacesMock.mockClear();
    ensureBinaryMock.mockClear();
    launchProviderMock.mockClear();
    startWrapWatchersMock.mockClear();
    writeWrapSessionMock.mockClear();
    clearWrapSessionMock.mockClear();
    ensureServerMock.mockImplementation(async () => ({
      running: true,
      url: 'http://127.0.0.1:5912',
    }));
  });

  it('ensures the server is running on warm wrap (no install)', async () => {
    const exitSpy = spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as typeof process.exit);

    try {
      await wrapCommand('cursor', []);
    } catch (err) {
      // GUI path exits 0 after cleanup; treat that as success.
      if (!(err instanceof Error) || !err.message.startsWith('process.exit')) {
        throw err;
      }
    } finally {
      exitSpy.mockRestore();
    }

    expect(ensureServerMock).toHaveBeenCalled();
    expect(prepareWorkspaceMock).toHaveBeenCalled();
    expect(launchProviderMock).toHaveBeenCalled();
  });

  it('exits when the server fails to start', async () => {
    ensureServerMock.mockImplementation(async () => ({
      running: false,
      url: undefined,
    }));

    const exitSpy = spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit(1)');
    }) as typeof process.exit);

    try {
      await expect(wrapCommand('cursor', [])).rejects.toThrow('process.exit(1)');
      expect(ensureServerMock).toHaveBeenCalled();
      expect(prepareWorkspaceMock).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
    }
  });

  it('does not start the server for --prune', async () => {
    await wrapCommand(undefined, [], { prune: true });
    expect(pruneWorkspacesMock).toHaveBeenCalled();
    expect(ensureServerMock).not.toHaveBeenCalled();
  });
});
