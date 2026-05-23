import { select as clackSelect, confirm as clackConfirm, text as clackText, isCancel } from '@clack/prompts'
import { isInteractive, isYes } from './flags'

export interface SelectOption<T = string> {
  value: T
  label: string
  hint?: string
}

function ensureInteractive(promptKind: string, flagHint: string): void {
  if (!isInteractive()) {
    throw new Error(
      `Interactive ${promptKind} prompt is not available in this environment. ` +
        `Pass ${flagHint} instead.`,
    )
  }
}

function handleCancel<T>(result: T | symbol): T {
  if (isCancel(result)) {
    throw new Error('User cancelled')
  }
  return result as T
}

export const prompt = {
  async select<T extends string = string>(
    message: string,
    options: SelectOption<T>[],
    flagHint = '--<flag>',
  ): Promise<T> {
    ensureInteractive('select', flagHint)
    const result = await clackSelect<T>({
      message,
      options: options.map((o) => ({
        value: o.value,
        label: o.label,
        ...(o.hint !== undefined ? { hint: o.hint } : {}),
      })) as NonNullable<Parameters<typeof clackSelect<T>>[0]>['options'],
    })
    return handleCancel(result) as T
  },

  async confirm(message: string, defaultValue = false, flagHint = '--yes'): Promise<boolean> {
    if (isYes()) return true
    ensureInteractive('confirm', flagHint)
    const result = await clackConfirm({ message, initialValue: defaultValue })
    return handleCancel(result)
  },

  async text(message: string, placeholder?: string, flagHint = '--<flag>'): Promise<string> {
    ensureInteractive('text', flagHint)
    const result = await clackText({ message, placeholder })
    return handleCancel(result)
  },
}
