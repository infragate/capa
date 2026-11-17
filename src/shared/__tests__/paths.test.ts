import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { logger } from '../logger';
import {
  generateProjectId,
  getCapabilitiesPath,
  detectCapabilitiesFile,
  getProjectUploadRelDir,
  listCapabilitiesCandidates,
  projectNameFromId,
} from '../paths';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'capa-paths-test-'));
}

describe('paths', () => {
  describe('generateProjectId', () => {
    it('should generate a project ID with directory name and hash', () => {
      const projectPath = '/path/to/my-project';
      const id = generateProjectId(projectPath);

      expect(id).toMatch(/^my-project-[a-f0-9]{4}$/);
    });

    it('should sanitize directory names with special characters', () => {
      const projectPath = '/path/to/My_Project!@#$';
      const id = generateProjectId(projectPath);

      expect(id).toMatch(/^my-project-[a-f0-9]{4}$/);
    });

    it('should handle multiple consecutive special characters', () => {
      const projectPath = '/path/to/my___project!!!';
      const id = generateProjectId(projectPath);

      expect(id).toMatch(/^my-project-[a-f0-9]{4}$/);
    });

    it('should generate consistent IDs for the same path', () => {
      const projectPath = '/path/to/project';
      const id1 = generateProjectId(projectPath);
      const id2 = generateProjectId(projectPath);

      expect(id1).toBe(id2);
    });

    it('should generate different IDs for different paths', () => {
      const id1 = generateProjectId('/path/to/project1');
      const id2 = generateProjectId('/path/to/project2');

      expect(id1).not.toBe(id2);
    });
  });

  describe('projectNameFromId', () => {
    it('strips the trailing 4-char hash', () => {
      expect(projectNameFromId('ontology-builder-a6a5')).toBe('ontology-builder');
    });

    it('leaves ids without a hash suffix unchanged', () => {
      expect(projectNameFromId('test-proj')).toBe('test-proj');
    });
  });

  describe('getCapabilitiesPath', () => {
    it('should return JSON capabilities path', () => {
      const projectPath = '/path/to/project';
      const path = getCapabilitiesPath(projectPath, 'json');

      expect(path).toBe(resolve(projectPath, 'capabilities.json'));
    });

    it('should return YAML capabilities path', () => {
      const projectPath = '/path/to/project';
      const path = getCapabilitiesPath(projectPath, 'yaml');

      expect(path).toBe(resolve(projectPath, 'capabilities.yaml'));
    });

    it('should return TOML capabilities path at project root', () => {
      const projectPath = '/path/to/project';
      expect(getCapabilitiesPath(projectPath, 'toml')).toBe(
        resolve(projectPath, 'capabilities.toml'),
      );
    });
  });

  describe('detectCapabilitiesFile', () => {
    let projectDir: string;

    beforeEach(() => {
      projectDir = makeTempDir();
    });

    afterEach(() => {
      rmSync(projectDir, { recursive: true, force: true });
    });

    it('returns null when no capabilities file exists', async () => {
      expect(await detectCapabilitiesFile(projectDir)).toBeNull();
    });

    it('detects root capabilities.yaml', async () => {
      writeFileSync(join(projectDir, 'capabilities.yaml'), 'providers: []\n');
      const result = await detectCapabilitiesFile(projectDir);
      expect(result).toEqual({
        path: join(projectDir, 'capabilities.yaml'),
        format: 'yaml',
      });
    });

    it('detects root capabilities.toml preferred over yaml and json', async () => {
      writeFileSync(join(projectDir, 'capabilities.toml'), 'providers = []\n');
      writeFileSync(join(projectDir, 'capabilities.yaml'), 'providers: []\n');
      writeFileSync(join(projectDir, 'capabilities.json'), '{}');
      const result = await detectCapabilitiesFile(projectDir);
      expect(result?.format).toBe('toml');
      expect(result?.path).toBe(join(projectDir, 'capabilities.toml'));
    });

    it('detects .config/capabilities.yaml when root has none', async () => {
      mkdirSync(join(projectDir, '.config'), { recursive: true });
      writeFileSync(join(projectDir, '.config', 'capabilities.yaml'), 'providers: []\n');
      const result = await detectCapabilitiesFile(projectDir);
      expect(result).toEqual({
        path: join(projectDir, '.config', 'capabilities.yaml'),
        format: 'yaml',
      });
    });

    it('detects .config/capa/config.toml', async () => {
      mkdirSync(join(projectDir, '.config', 'capa'), { recursive: true });
      writeFileSync(
        join(projectDir, '.config', 'capa', 'config.toml'),
        'providers = []\n',
      );
      const result = await detectCapabilitiesFile(projectDir);
      expect(result).toEqual({
        path: join(projectDir, '.config', 'capa', 'config.toml'),
        format: 'toml',
      });
    });

    it('prefers root over .config locations', async () => {
      writeFileSync(join(projectDir, 'capabilities.yaml'), 'providers: []\n');
      mkdirSync(join(projectDir, '.config'), { recursive: true });
      writeFileSync(join(projectDir, '.config', 'capabilities.toml'), 'providers = []\n');
      const result = await detectCapabilitiesFile(projectDir);
      expect(result?.path).toBe(join(projectDir, 'capabilities.yaml'));
    });

    it('warns when multiple candidates exist and still returns the winner', async () => {
      writeFileSync(join(projectDir, 'capabilities.yaml'), 'providers: []\n');
      writeFileSync(join(projectDir, 'capabilities.json'), '{}');
      const warn = spyOn(logger, 'warn').mockImplementation(() => {});
      const result = await detectCapabilitiesFile(projectDir);
      expect(result?.format).toBe('yaml');
      expect(warn).toHaveBeenCalled();
      const msg = String(warn.mock.calls[0]?.[0] ?? '');
      expect(msg).toMatch(/multiple/i);
      warn.mockRestore();
    });

    it('dedupes multi-file warnings for the same conflict signature', async () => {
      writeFileSync(join(projectDir, 'capabilities.yaml'), 'providers: []\n');
      writeFileSync(join(projectDir, 'capabilities.json'), '{}');
      const warn = spyOn(logger, 'warn').mockImplementation(() => {});
      await detectCapabilitiesFile(projectDir);
      await detectCapabilitiesFile(projectDir);
      const multiCalls = warn.mock.calls.filter((c) =>
        String(c[0] ?? '').match(/multiple/i),
      );
      expect(multiCalls).toHaveLength(1);
      warn.mockRestore();
    });

    it('lists candidates in discovery order', () => {
      const paths = listCapabilitiesCandidates(projectDir).map((c) => c.path);
      expect(paths).toEqual([
        join(projectDir, 'capabilities.toml'),
        join(projectDir, 'capabilities.yaml'),
        join(projectDir, 'capabilities.json'),
        join(projectDir, '.config', 'capabilities.toml'),
        join(projectDir, '.config', 'capabilities.yaml'),
        join(projectDir, '.config', 'capabilities.json'),
        join(projectDir, '.config', 'capa', 'config.toml'),
        join(projectDir, '.config', 'capa', 'config.yaml'),
        join(projectDir, '.config', 'capa', 'config.json'),
      ]);
    });
  });

  describe('getProjectUploadRelDir', () => {
    let projectDir: string;

    beforeEach(() => {
      projectDir = makeTempDir();
    });

    afterEach(() => {
      rmSync(projectDir, { recursive: true, force: true });
    });

    it('uses .capa/imports when capabilities are at project root', async () => {
      writeFileSync(join(projectDir, 'capabilities.yaml'), 'providers: []\n');
      expect(await getProjectUploadRelDir(projectDir, 'skills')).toBe(
        '.capa/imports',
      );
      expect(await getProjectUploadRelDir(projectDir, 'rules')).toBe(
        '.capa/imports',
      );
    });

    it('uses typed .config/capa dirs when config is under .config', async () => {
      mkdirSync(join(projectDir, '.config'), { recursive: true });
      writeFileSync(
        join(projectDir, '.config', 'capabilities.yaml'),
        'providers: []\n',
      );
      expect(await getProjectUploadRelDir(projectDir, 'skills')).toBe(
        '.config/capa/skills',
      );
      expect(await getProjectUploadRelDir(projectDir, 'rules')).toBe(
        '.config/capa/rules',
      );
      expect(await getProjectUploadRelDir(projectDir, 'instructions')).toBe(
        '.config/capa/instructions',
      );
    });

    it('uses typed dirs when config is .config/capa/config.toml', async () => {
      mkdirSync(join(projectDir, '.config', 'capa'), { recursive: true });
      writeFileSync(
        join(projectDir, '.config', 'capa', 'config.toml'),
        'providers = []\n',
      );
      expect(await getProjectUploadRelDir(projectDir, 'rules')).toBe(
        '.config/capa/rules',
      );
    });

    it('falls back to .capa/imports when no capabilities file exists', async () => {
      expect(await getProjectUploadRelDir(projectDir, 'skills')).toBe(
        '.capa/imports',
      );
    });
  });
});
