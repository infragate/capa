import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { initAuth, _resetAuthStateForTests } from '../../../server/auth-middleware';
import { localApiHeaders } from '../local-api';

describe('localApiHeaders', () => {
  beforeEach(() => {
    _resetAuthStateForTests();
    process.env.CAPA_AUTH_TOKEN = 'cli-secret';
    initAuth('127.0.0.1');
  });

  afterEach(() => {
    _resetAuthStateForTests();
  });

  it('adds Authorization: Bearer from the capa auth token', () => {
    expect(localApiHeaders({ 'Content-Type': 'application/json' })).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer cli-secret',
    });
  });
});
