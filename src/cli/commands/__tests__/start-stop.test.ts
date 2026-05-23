import { describe, it, expect } from 'bun:test';
import { startCommand } from '../start';
import { stopCommand } from '../stop';

describe('startCommand', () => {
  it('module loads and exports startCommand', () => {
    expect(typeof startCommand).toBe('function');
  });
});

describe('stopCommand', () => {
  it('module loads and exports stopCommand', () => {
    expect(typeof stopCommand).toBe('function');
  });
});

describe('start/stop command exports', () => {
  it('exports distinct start and stop handlers', () => {
    expect(startCommand).not.toBe(stopCommand);
    expect(startCommand.name).toBe('startCommand');
    expect(stopCommand.name).toBe('stopCommand');
  });
});
