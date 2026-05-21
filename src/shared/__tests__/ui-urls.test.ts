import { describe, it, expect } from 'bun:test';
import { CAPA_CLOUD_OAUTH_URL, CAPA_DOCS_URL, projectUiPath, projectUiUrl } from '../ui-urls';

describe('ui-urls', () => {
  it('CAPA_DOCS_URL points to capa docs site', () => {
    expect(CAPA_DOCS_URL).toBe('https://capa.infragate.ai');
  });

  it('CAPA_CLOUD_OAUTH_URL points to cloud OAuth endpoint', () => {
    expect(CAPA_CLOUD_OAUTH_URL).toBe('https://capa.infragate.ai/auth');
  });

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

  it('projectUiPath ignores id in query so projectId always wins', () => {
    expect(projectUiPath('real-proj', { id: 'other-proj', oauth_success: 'true' })).toBe(
      '/ui/project?oauth_success=true&id=real-proj'
    );
  });

  it('projectUiUrl builds absolute URL', () => {
    expect(projectUiUrl('http://127.0.0.1:5912', 'proj-1')).toBe(
      'http://127.0.0.1:5912/ui/project?id=proj-1'
    );
  });
});
