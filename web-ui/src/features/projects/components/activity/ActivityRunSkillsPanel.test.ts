import { describe, expect, it } from 'bun:test';
import type { Skill } from '../../../../types/api';
import { findManagedSkillForFolder } from './ActivityRunSkillsPanel';

function skill(partial: Partial<Skill> & { id: string }): Skill {
  return {
    type: 'local',
    description: null,
    requires: [],
    sourcePlugin: null,
    ...partial,
  };
}

describe('findManagedSkillForFolder', () => {
  it('matches capa-managed skills by id', () => {
    const managed = [skill({ id: 'debug' }), skill({ id: 'standup' })];
    expect(findManagedSkillForFolder('debug', managed)?.id).toBe('debug');
    expect(findManagedSkillForFolder('missing', managed)).toBeNull();
  });

  it('matches local skill path basenames', () => {
    const managed = [skill({ id: 'my-debug', path: 'skills/debug' })];
    expect(findManagedSkillForFolder('debug', managed)?.id).toBe('my-debug');
  });

  it('returns null for provider-built-in folders with no capa skill', () => {
    expect(findManagedSkillForFolder('create-rule', [])).toBeNull();
    expect(findManagedSkillForFolder('create-rule', undefined)).toBeNull();
  });
});
