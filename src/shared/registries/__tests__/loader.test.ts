import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import * as config from '../../config';
import { RegistryLoader } from '../loader';

describe('RegistryLoader', () => {
  let registriesDir: string;
  let getRegistriesDirSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    registriesDir = mkdtempSync(join(tmpdir(), 'capa-registry-loader-test-'));
    getRegistriesDirSpy = spyOn(config, 'getRegistriesDir').mockReturnValue(registriesDir);
  });

  afterEach(() => {
    getRegistriesDirSpy.mockRestore();
    rmSync(registriesDir, { recursive: true, force: true });
  });

  it('loads valid adapters and records failures for throwing modules', async () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    writeFileSync(
      join(registriesDir, 'good.js'),
      `export default {
        manifest: { id: 'good-registry', name: 'Good', capabilities: ['skills'] },
        search: async () => ({ items: [] }),
        view: async () => ({
          id: 'item',
          capability: 'skills',
          title: 'Item',
          preview: '',
          installSnippet: { id: 'item', type: 'inline', def: { content: '' } },
        }),
      };`
    );
    writeFileSync(join(registriesDir, 'broken.js'), 'throw new Error("adapter boom");');

    const loader = new RegistryLoader();
    const { adapters, failures } = await loader.loadAll();

    expect(adapters.size).toBe(1);
    expect(adapters.get('good-registry')?.manifest.name).toBe('Good');
    expect(failures).toHaveLength(1);
    expect(failures![0].path).toBe(join(registriesDir, 'broken.js'));
    expect(failures![0].error).toBe('adapter boom');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(join(registriesDir, 'broken.js'))
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('adapter boom'));

    warnSpy.mockRestore();
  });
});
