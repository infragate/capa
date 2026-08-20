import { describe, it, expect } from 'bun:test';
import { McpServerStateManager } from '../mcp-server-state';

describe('McpServerStateManager', () => {
  it('defaults servers to disabled', () => {
    const mgr = new McpServerStateManager();
    expect(mgr.isEnabled('proj', 'slack')).toBe(false);
  });

  it('tracks enabled servers per project', () => {
    const mgr = new McpServerStateManager();
    mgr.setEnabled('proj', 'slack', true);
    expect(mgr.isEnabled('proj', 'slack')).toBe(true);
    expect(mgr.isEnabled('proj', 'github')).toBe(false);
    mgr.setEnabled('proj', 'slack', false);
    expect(mgr.isEnabled('proj', 'slack')).toBe(false);
  });

  it('strips @ prefix from server ids', () => {
    const mgr = new McpServerStateManager();
    mgr.setEnabled('proj', '@slack', true);
    expect(mgr.getEnabledServers('proj').has('slack')).toBe(true);
  });
});
