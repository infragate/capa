import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import adapter from './adapter';

const marketplace = {
  plugins: [
    {
      name: 'url-ref',
      description: 'Pinned to a branch via a url source',
      source: { source: 'url', url: 'https://github.com/acme/url-ref.git', ref: 'release' },
    },
    {
      name: 'repo-ref',
      description: 'Pinned to a tag via a repo source',
      source: { source: 'github', repo: 'acme/repo-ref', ref: 'v2.0.0' },
    },
    {
      name: 'local',
      description: 'Lives in the marketplace repo',
      source: './plugins/local',
    },
  ],
};

const realFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(marketplace), { status: 200 })) as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

describe('claude-plugins adapter', () => {
  it('lists plugins from marketplace.json', async () => {
    const { items, total } = await adapter.search({ capability: 'plugins' });
    expect(total).toBe(3);
    expect(items.map((i) => i.id)).toEqual(['url-ref', 'repo-ref', 'local']);
  });

  it('keeps the ref of url and repo sources in the install snippet', async () => {
    const urlRef = await adapter.view({ capability: 'plugins', id: 'url-ref' });
    expect(urlRef.installSnippet).toEqual({
      id: 'url-ref',
      type: 'github',
      def: { repo: 'acme/url-ref', version: 'release' },
    });
    const repoRef = await adapter.view({ capability: 'plugins', id: 'repo-ref' });
    expect(repoRef.installSnippet).toEqual({
      id: 'repo-ref',
      type: 'github',
      def: { repo: 'acme/repo-ref', version: 'v2.0.0' },
    });
  });

  it('resolves marketplace-local plugins with the @name form', async () => {
    const local = await adapter.view({ capability: 'plugins', id: 'local' });
    expect(local.installSnippet).toEqual({
      id: 'local',
      type: 'github',
      def: { repo: 'anthropics/claude-plugins-official@local' },
    });
  });
});
