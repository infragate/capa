import { describe, it, expect, mock, beforeEach } from 'bun:test';

const ensureServerMock = mock(async (): Promise<{
  running: boolean;
  url?: string;
}> => ({
  running: true,
  url: 'http://127.0.0.1:5912',
}));

mock.module('../../utils/server-manager', () => ({
  ensureServer: ensureServerMock,
  startServer: mock(async () => {}),
  stopServer: mock(async () => {}),
  getServerStatus: mock(async () => ({ running: false })),
  restartServer: mock(async () => {}),
}));

const { ensureWrapServerRunning } = await import('../wrap-ensure-server');

describe('ensureWrapServerRunning', () => {
  beforeEach(() => {
    ensureServerMock.mockClear();
    ensureServerMock.mockImplementation(async () => ({
      running: true,
      url: 'http://127.0.0.1:5912',
    }));
  });

  it('resolves when ensureServer reports a running server', async () => {
    await ensureWrapServerRunning();
    expect(ensureServerMock).toHaveBeenCalled();
  });

  it('rejects when the server fails to start', async () => {
    ensureServerMock.mockImplementation(async () => ({
      running: false,
      url: undefined,
    }));
    await expect(ensureWrapServerRunning()).rejects.toThrow('Failed to start server');
  });
});
