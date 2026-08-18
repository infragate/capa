import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Capabilities, SubAgent } from '../../../types/capabilities';
import {
  installSubAgentInstructions,
  removeSubAgentInstructions,
} from '../agents-file';

describe('subagents install path guard', () => {
  let projectPath: string;
  const capabilities: Capabilities = { skills: [], tools: [], servers: [] };
  const subAgent: SubAgent = {
    id: 'helper',
    description: 'Test helper',
    instructions: 'Do helpful things.',
    skills: [],
    tools: [],
  };

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'capa-subagents-guard-'));
    mkdirSync(join(projectPath, '.claude', 'agents'), { recursive: true });
    mkdirSync(join(projectPath, 'src'), { recursive: true });
    writeFileSync(join(projectPath, 'src', 'secret.txt'), 'keep');
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
  });

  it('refuses to write through a leaf subagent symlink', () => {
    symlinkSync(
      join(projectPath, 'src', 'secret.txt'),
      join(projectPath, '.claude', 'agents', 'helper.md'),
    );

    expect(() =>
      installSubAgentInstructions(
        projectPath,
        subAgent,
        capabilities,
        ['claude-code'],
      ),
    ).toThrow(/symlink/i);
    expect(readFileSync(join(projectPath, 'src', 'secret.txt'), 'utf8')).toBe(
      'keep',
    );
  });

  it('refuses to delete through a leaf subagent symlink', () => {
    symlinkSync(
      join(projectPath, 'src', 'secret.txt'),
      join(projectPath, '.claude', 'agents', 'helper.md'),
    );

    expect(() =>
      removeSubAgentInstructions(projectPath, 'helper', ['claude-code']),
    ).toThrow(/symlink/i);
    expect(existsSync(join(projectPath, 'src', 'secret.txt'))).toBe(true);
  });
});
