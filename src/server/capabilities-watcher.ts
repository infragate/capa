import { type FSWatcher, statSync, watch } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { detectCapabilitiesFile, listCapabilitiesCandidates } from '../shared/paths';

const DEBOUNCE_MS = 400;
const SELF_WRITE_GRACE_MS = 1200;
const POLL_MS = 1500;
export type CapabilitiesChangeHandler = (projectId: string) => void | Promise<void>;
type DirectoryWatch = { handle: FSWatcher; identity: string };
type ProjectWatch = {
  root: string;
  directories: Map<string, DirectoryWatch>;
  file?: string;
  mtime?: number;
  selfWriteUntil: number;
  poll?: ReturnType<typeof setInterval>;
  debounce?: ReturnType<typeof setTimeout>;
  pendingDiscovery: boolean;
  running?: Promise<void>;
  stopped: boolean;
};

/** Directory events discover candidates; the backup poll only inspects the active file. */
export class CapabilitiesFileWatcher {
  private projects = new Map<string, ProjectWatch>();
  constructor(
    private readonly onChange: CapabilitiesChangeHandler,
    private readonly log: { info: (message: string) => void; warn: (message: string) => void; debug: (message: string) => void },
  ) {}

  markSelfWrite(projectId: string): void {
    const state = this.projects.get(projectId);
    if (state) state.selfWriteUntil = Date.now() + SELF_WRITE_GRACE_MS;
  }

  async watchProject(projectId: string, projectPath: string): Promise<void> {
    const root = resolve(projectPath);
    let state = this.projects.get(projectId);
    if (state?.root === root) {
      // Configure can call back into us during a reload. Do not await ourselves.
      if (!state.running) {
        this.reconcileDirectories(projectId, state);
        this.schedule(projectId, state, true);
      }
      return;
    }
    this.unwatchProject(projectId);
    state = { root, directories: new Map(), selfWriteUntil: 0, pendingDiscovery: false, stopped: false };
    this.projects.set(projectId, state);
    this.reconcileDirectories(projectId, state);
    const selected = await detectCapabilitiesFile(root);
    if (state.stopped) return;
    state.file = selected?.path;
    state.mtime = state.file ? this.mtime(state.file) : undefined;
    state.poll = setInterval(() => this.poll(projectId, state!), POLL_MS);
    this.log.debug(`Watching capabilities for ${projectId}: ${state.file ?? 'awaiting creation'}`);
  }

  async refreshProject(projectId: string): Promise<void> {
    const state = this.projects.get(projectId);
    if (!state) return;
    state.pendingDiscovery = true;
    await this.process(projectId, state);
  }

  unwatchProject(projectId: string): void {
    const state = this.projects.get(projectId);
    if (!state) return;
    state.stopped = true;
    if (state.poll) clearInterval(state.poll);
    if (state.debounce) clearTimeout(state.debounce);
    for (const { handle } of state.directories.values()) handle.close();
    this.projects.delete(projectId);
  }

  stop(): void {
    for (const id of this.projects.keys()) this.unwatchProject(id);
  }

  private mtime(path: string): number | undefined {
    try { return statSync(path).mtimeMs; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR') return undefined;
      throw error;
    }
  }

  private poll(projectId: string, state: ProjectWatch): void {
    if (state.stopped || !state.file) return;
    try {
      const next = this.mtime(state.file);
      if (next === undefined) this.schedule(projectId, state, true);
      else if (next !== state.mtime) this.schedule(projectId, state, false);
    } catch (error) {
      this.log.warn(`Capabilities poll failed for ${projectId}: ${String(error)}`);
    }
  }

  private schedule(projectId: string, state: ProjectWatch, discover: boolean): void {
    if (state.stopped) return;
    state.pendingDiscovery ||= discover;
    if (state.debounce) clearTimeout(state.debounce);
    state.debounce = setTimeout(() => {
      state.debounce = undefined;
      void this.process(projectId, state);
    }, DEBOUNCE_MS);
  }

  private process(projectId: string, state: ProjectWatch): Promise<void> {
    if (state.stopped) return Promise.resolve();
    if (state.running) {
      // The pending discovery bit and the next scheduled pass retain intervening events.
      this.schedule(projectId, state, state.pendingDiscovery);
      return state.running;
    }
    state.running = this.reload(projectId, state).catch(error => {
      this.log.warn(`Failed to reload capabilities for ${projectId}: ${String(error)}`);
    }).finally(() => {
      state.running = undefined;
      if (state.pendingDiscovery) this.schedule(projectId, state, true);
    });
    return state.running;
  }

  private async reload(projectId: string, state: ProjectWatch): Promise<void> {
    const previous = state.file;
    if (state.pendingDiscovery) {
      state.pendingDiscovery = false;
      this.reconcileDirectories(projectId, state);
      const selected = await detectCapabilitiesFile(state.root);
      if (state.stopped) return;
      state.file = selected?.path;
    }
    const winnerChanged = previous !== state.file;
    const nextMtime = state.file ? this.mtime(state.file) : undefined;
    if (state.stopped) return;
    if (Date.now() < state.selfWriteUntil && !winnerChanged) {
      state.mtime = nextMtime;
      return;
    }
    if (!winnerChanged && (nextMtime === undefined || nextMtime === state.mtime)) return;
    // First selection must reload even when its freshly sampled timestamp is unchanged.
    this.log.info(`Capabilities file changed for ${projectId}, reloading`);
    await this.onChange(projectId);
    if (!state.stopped) state.mtime = nextMtime;
  }

  private reconcileDirectories(projectId: string, state: ProjectWatch): void {
    const directories = [state.root, join(state.root, '.config'), join(state.root, '.config', 'capa')];
    const candidates = listCapabilitiesCandidates(state.root);
    for (const directory of directories) {
      let identity: string | undefined;
      try {
        const stat = statSync(directory);
        if (stat.isDirectory()) identity = `${stat.dev}:${stat.ino}`;
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) this.log.warn(`Cannot watch ${directory}: ${String(error)}`);
      }
      const current = state.directories.get(directory);
      if (current && current.identity !== identity) {
        current.handle.close();
        state.directories.delete(directory);
      }
      if (!identity || state.directories.has(directory)) continue;
      try {
        const handle = watch(directory, (_event, filename) => {
          if (filename) {
            const name = basename(String(filename));
            const structural = (directory === state.root && name === '.config') || (directory === join(state.root, '.config') && name === 'capa');
            if (!structural && !candidates.some(candidate => dirname(candidate.path) === directory && basename(candidate.path) === name)) return;
          }
          this.schedule(projectId, state, true);
        });
        handle.on('error', error => {
          handle.close();
          state.directories.delete(directory);
          this.log.warn(`Capabilities watch error for ${projectId}: ${error.message}`);
          this.schedule(projectId, state, true);
        });
        state.directories.set(directory, { handle, identity });
      } catch (error) {
        this.log.warn(`fs.watch failed for ${projectId} (${directory}): ${String(error)}`);
      }
    }
  }
}
