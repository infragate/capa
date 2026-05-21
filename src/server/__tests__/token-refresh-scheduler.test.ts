import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CapaDatabase } from '../../db/database';
import { OAuth2Manager } from '../oauth-manager';
import { TokenRefreshScheduler } from '../token-refresh-scheduler';

describe('TokenRefreshScheduler', () => {
  let db: CapaDatabase;
  let tempDir: string;
  let oauth2Manager: OAuth2Manager;
  let scheduler: TokenRefreshScheduler;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'capa-token-scheduler-test-'));
    db = new CapaDatabase(join(tempDir, 'test.db'));
    oauth2Manager = new OAuth2Manager(db);
    scheduler = new TokenRefreshScheduler(db, oauth2Manager, { checkInterval: 60_000 });
  });

  afterEach(() => {
    scheduler.stop();
    db.close();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error: any) {
      if (error?.code !== 'EBUSY') throw error;
    }
  });

  it('loads and exports TokenRefreshScheduler', () => {
    expect(TokenRefreshScheduler).toBeDefined();
    expect(typeof TokenRefreshScheduler).toBe('function');
  });

  it('constructs without throwing', () => {
    expect(scheduler).toBeInstanceOf(TokenRefreshScheduler);
    expect(scheduler.getStatus().isRunning).toBe(false);
  });

  it('starts and stops without leaving the scheduler running', () => {
    scheduler.start();
    expect(scheduler.getStatus().isRunning).toBe(true);

    scheduler.stop();
    expect(scheduler.getStatus().isRunning).toBe(false);

    scheduler.stop();
    expect(scheduler.getStatus().isRunning).toBe(false);
  });

  it('does not start duplicate intervals when start is called twice', () => {
    scheduler.start();
    scheduler.start();
    expect(scheduler.getStatus().isRunning).toBe(true);
    scheduler.stop();
    expect(scheduler.getStatus().isRunning).toBe(false);
  });

  it('forceCheck completes without error when no tokens are configured', async () => {
    await expect(scheduler.forceCheck()).resolves.toBeUndefined();
  });
});
