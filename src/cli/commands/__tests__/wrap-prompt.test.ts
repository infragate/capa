import { describe, it, expect, spyOn, afterEach } from 'bun:test';
import * as flags from '../../ui/flags';
import * as prompts from '../../ui/prompts';
import { buildWrapSelectOptions, resolveWrapProviderArg } from '../wrap-prompt';

describe('buildWrapSelectOptions', () => {
  it('includes wrappable providers and wrap aliases', () => {
    const options = buildWrapSelectOptions();
    const values = options.map((o) => o.value);

    expect(values).toContain('cursor');
    expect(values).toContain('agent');
    expect(values).toContain('claude-code');
    expect(values).toContain('gemini-cli');
    expect(values).not.toContain('github-copilot');

    const agent = options.find((o) => o.value === 'agent');
    expect(agent?.label).toContain('Cursor');
    expect(agent?.hint).toBe('agent');

    const cursor = options.find((o) => o.value === 'cursor');
    expect(cursor?.hint).toBe('cursor');
  });
});

describe('resolveWrapProviderArg', () => {
  afterEach(() => {
    // restore spies created in each test
  });

  it('returns the provided arg when present', async () => {
    expect(await resolveWrapProviderArg('gemini-cli')).toBe('gemini-cli');
    expect(await resolveWrapProviderArg('  agent  ')).toBe('agent');
  });

  it('errors in non-interactive mode when no provider is given', async () => {
    const interactive = spyOn(flags, 'isInteractive').mockReturnValue(false);
    await expect(resolveWrapProviderArg(undefined)).rejects.toThrow(
      /Missing provider/,
    );
    interactive.mockRestore();
  });

  it('prompts interactively when no provider is given', async () => {
    const interactive = spyOn(flags, 'isInteractive').mockReturnValue(true);
    const select = spyOn(prompts.prompt, 'select').mockResolvedValue('agent');

    await expect(resolveWrapProviderArg(undefined)).resolves.toBe('agent');
    expect(select).toHaveBeenCalled();
    const [message, options] = select.mock.calls[0] as unknown as [
      string,
      Array<{ value: string }>,
    ];
    expect(message).toBe('Which provider do you want to wrap?');
    expect(options.map((o) => o.value)).toContain('agent');

    select.mockRestore();
    interactive.mockRestore();
  });
});
