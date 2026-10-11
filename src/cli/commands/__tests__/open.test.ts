import { describe, it, expect } from 'bun:test';
import { resolveDashboardUrl } from '../open';
import { generateProjectId } from '../../../shared/paths';

const SERVER = 'http://127.0.0.1:5912';

describe('resolveDashboardUrl', () => {
  it('opens the project page for a known project path', () => {
    const id = generateProjectId('.');
    const db = { getProject: (pid: string) => (pid === id ? ({ id } as any) : null) };
    expect(resolveDashboardUrl(SERVER, '.', db)).toBe(`${SERVER}/ui/project?id=${id}`);
  });

  it('falls back to the dashboard home for an unknown path', () => {
    const db = { getProject: () => null };
    expect(resolveDashboardUrl(SERVER, './not-a-project', db)).toBe(`${SERVER}/`);
  });
});
