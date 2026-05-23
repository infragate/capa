import { spinner } from '@clack/prompts'
import { isInteractive, isJson, isQuiet, isVerbose } from './flags'

export interface TaskWrapper {
  title: string
  output: string
  skip: (reason?: string) => void
}

export interface Task<Ctx = unknown> {
  title: string
  enabled?: ((ctx: Ctx) => boolean | Promise<boolean>) | boolean
  task: (ctx: Ctx, task: TaskWrapper) => unknown | Promise<unknown>
}

export interface RunTasksOptions {
  exitOnError?: boolean
}

function formatLive(title: string, output: string): string {
  return output ? `${title} — ${output}` : title
}

async function resolveEnabled<Ctx>(
  enabled: Task<Ctx>['enabled'],
  ctx: Ctx,
): Promise<boolean> {
  if (enabled === undefined) return true
  if (typeof enabled === 'function') return !!(await enabled(ctx))
  return !!enabled
}

// Move up 2 lines (over `◇`/`▲` + the `│` connector) and clear to end of
// screen, so the caller's next line renders on a clean slate.
function eraseSpinnerLines(): void {
  process.stdout.write('\x1b[2A\x1b[J')
}

export async function runTasks<Ctx = Record<string, unknown>>(
  tasks: Task<Ctx>[],
  options: RunTasksOptions = {},
  initialCtx?: Ctx,
): Promise<Ctx> {
  const ctx = (initialCtx ?? ({} as Ctx)) as Ctx
  const exitOnError = options.exitOnError ?? true

  const useSpinner =
    isInteractive() && !isJson() && !isQuiet() && !isVerbose() && !process.env.CI

  if (!useSpinner) {
    return runLinear(tasks, ctx, exitOnError)
  }

  let s = spinner()
  let started = false
  let currentTitle = ''
  let currentOutput = ''

  const startOrUpdate = (text: string) => {
    if (!started) {
      s.start(text)
      started = true
    } else {
      s.message(text)
    }
  }

  for (const taskDef of tasks) {
    if (!(await resolveEnabled(taskDef.enabled, ctx))) continue

    currentTitle = taskDef.title
    currentOutput = ''
    let skipped = false

    startOrUpdate(formatLive(currentTitle, currentOutput))

    const wrapper: TaskWrapper = {
      get title() {
        return currentTitle
      },
      set title(t: string) {
        currentTitle = t
        s.message(formatLive(currentTitle, currentOutput))
      },
      get output() {
        return currentOutput
      },
      set output(o: string) {
        currentOutput = o
        s.message(formatLive(currentTitle, currentOutput))
      },
      skip(_reason?: string) {
        skipped = true
      },
    }

    try {
      await taskDef.task(ctx, wrapper)
    } catch (err) {
      s.error(currentTitle)
      started = false
      if (exitOnError) throw err
      s = spinner()
      continue
    }

    void skipped
  }

  if (started) {
    s.stop()
    eraseSpinnerLines()
  }

  return ctx
}

async function runLinear<Ctx>(
  tasks: Task<Ctx>[],
  ctx: Ctx,
  exitOnError: boolean,
): Promise<Ctx> {
  const print = !isJson() && !isQuiet()

  for (const taskDef of tasks) {
    if (!(await resolveEnabled(taskDef.enabled, ctx))) continue

    let title = taskDef.title
    let skipped = false
    let skipReason = ''

    if (print) console.log(`❯ ${title}`)

    const wrapper: TaskWrapper = {
      get title() {
        return title
      },
      set title(t: string) {
        title = t
      },
      output: '',
      skip(reason?: string) {
        skipped = true
        skipReason = reason ?? ''
      },
    } as TaskWrapper
    Object.defineProperty(wrapper, 'output', {
      get: () => '',
      set: (o: string) => {
        if (print && o) console.log(`  › ${o}`)
      },
    })

    try {
      await taskDef.task(ctx, wrapper)
    } catch (err) {
      if (print) console.log(`✖ ${title}`)
      if (exitOnError) throw err
      continue
    }

    if (print) {
      if (skipped) {
        console.log(`◯ ${skipReason ? `${title} (${skipReason})` : title}`)
      } else {
        console.log(`✔ ${title}`)
      }
    }
  }

  return ctx
}
