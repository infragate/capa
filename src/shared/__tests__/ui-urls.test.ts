import { describe, it, expect } from 'bun:test';
import { projectUiPath, projectUiUrl } from '../ui-urls';

describe('ui-urls', () => {
  it('projectUiPath uses /ui/project with id query param', () => {
    expect(projectUiPath('my-proj-1234')).toBe('/ui/project?id=my-proj-1234');
  });

  it('projectUiPath appends extra query params', () => {
    const path = projectUiPath('my-proj-1234', { oauth_success: 'true', server: 'slack' });
    expect(path).toContain('/ui/project?');
    expect(path).toContain('id=my-proj-1234');
    expect(path).toContain('oauth_success=true');
    expect(path).toContain('server=slack');
  });

  it('projectUiUrl builds absolute URL', () => {
    expect(projectUiUrl('http://127.0.0.1:5912', 'proj-1')).toBe(
      'http://127.0.0.1:5912/ui/project?id=proj-1'
    );
  });
});
