import { Listr, type ListrTask, type ListrRendererValue } from 'listr2'
import { isInteractive, isJson, isQuiet, isVerbose } from './flags'

export type Task<Ctx = unknown> = ListrTask<Ctx>

export interface RunTasksOptions {
  concurrent?: boolean | number
  exitOnError?: boolean
}

export async function runTasks<Ctx = Record<string, unknown>>(
  tasks: ListrTask<Ctx>[],
  options: RunTasksOptions = {},
  initialCtx?: Ctx,
): Promise<Ctx> {
  const renderer: ListrRendererValue = isJson()
    ? 'silent'
    : isQuiet()
      ? 'silent'
      : !isInteractive()
        ? 'simple'
        : isVerbose()
          ? 'verbose'
          : 'default'

  const listr = new Listr<Ctx, ListrRendererValue, ListrRendererValue>(tasks, {
    concurrent: options.concurrent ?? false,
    exitOnError: options.exitOnError ?? true,
    renderer,
    fallbackRenderer: 'simple',
  })

  if (initialCtx) {
    Object.assign(listr.ctx as object, initialCtx)
  }

  await listr.run()
  return listr.ctx as Ctx
}
