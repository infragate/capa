import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { marked } from 'marked';
import adapter from './adapter';

const marketplace = {
  plugins: [
    {
      name: 'url-ref',
      description: 'Pinned to a branch via a url source',
      homepage: 'https://acme.dev/url-ref',
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
    {
      name: 'pdf&calc.exe&',
      description: 'Shell metacharacters in the name',
      source: './plugins/pdf',
    },
    {
      name: 'has space',
      source: './plugins/x',
    },
    {
      name: 'hostile',
      displayName: '<img src=x onerror=alert(1)>',
      description:
        '<style>body{display:none}</style><form action="https://evil.example"><input name=t></form>\n\n## Install\n[click](https://evil.example)',
      author: { name: '**bold** <b>x</b>' },
      category: '`code`',
      homepage: 'https://evil.example/x)\n\n# Fake',
      source: { source: 'url', url: 'https://github.com/acme/hostile.git' },
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
    expect(total).toBe(4);
    expect(items.map((i) => i.id)).toEqual(['url-ref', 'repo-ref', 'local', 'hostile']);
  });

  it('skips plugins whose name is not a plain identifier', async () => {
    await expect(adapter.view({ capability: 'plugins', id: 'pdf&calc.exe&' })).rejects.toThrow(
      /not found/,
    );
    await expect(adapter.view({ capability: 'plugins', id: 'has space' })).rejects.toThrow(
      /not found/,
    );
  });

  it('renders marketplace strings in the preview as plain text', async () => {
    const { preview } = await adapter.view({ capability: 'plugins', id: 'hostile' });
    const html = marked.parse(preview, { async: false, gfm: true, breaks: true }) as string;
    for (const tag of ['<img', '<style', '<form', '<input', '<b>', '<strong>bold']) {
      expect(html).not.toContain(tag);
    }
    expect(html).not.toContain('href="https://evil.example');
    expect(html.match(/<h[12]/g)).toEqual(['<h1', '<h2']); // title + our own "Install"
    expect(html).toContain('&lt;style&gt;body{display:none}&lt;/style&gt;');
    expect(html).toContain('href="https://github.com/acme/hostile/tree/main"');
  });

  it('links an https homepage and the source', async () => {
    const { preview } = await adapter.view({ capability: 'plugins', id: 'url-ref' });
    const html = marked.parse(preview, { async: false }) as string;
    expect(html).toContain('<a href="https://acme.dev/url-ref">https://acme.dev/url-ref</a>');
    expect(html).toContain('href="https://github.com/acme/url-ref/tree/release"');
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

  it('installs marketplace-local plugins from their exact declared path', async () => {
    const local = await adapter.view({ capability: 'plugins', id: 'local' });
    expect(local.installSnippet).toEqual({
      id: 'local',
      type: 'github',
      def: { repo: 'anthropics/claude-plugins-official::plugins/local' },
    });
  });
});
