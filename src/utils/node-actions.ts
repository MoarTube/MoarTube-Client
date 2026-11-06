import { createHash, randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

export function requireNodeSuccess<T>(value: T): T {
  const response = value as
    | { isError?: boolean; success?: boolean; message?: string; error?: string }
    | undefined;
  if (response?.isError === true || response?.success === false) {
    throw new Error(response.message ?? response.error ?? 'Node rejected the mutation');
  }
  return value;
}

export interface NodeAction {
  id: string;
  token: string;
  origin: string;
  jwtToken: string;
  route: string;
  data: unknown;
  scope: string;
  created: number;
  state: 'writing' | 'ready';
  owner: number;
  followup?: { route: string; data: unknown };
}

/** One journal per Client data directory. Files survive shutdown; credentials never enter logs. */
export class NodeActions {
  private readonly writers = new Set<string>();
  private readonly sending = new Set<string>();
  private readonly memory = new Map<string, NodeAction>();

  constructor(private readonly directory: string | undefined) {}

  private file(id: string): string {
    return path.join(this.directory as string, id + '.json');
  }

  private save(action: NodeAction): void {
    this.memory.set(action.id, action);
    if (this.directory === undefined) {
      return;
    }
    mkdirSync(this.directory, { recursive: true });
    const temporary = this.file(action.id) + '.' + randomUUID() + '.part';
    writeFileSync(temporary, JSON.stringify(action), { mode: 0o600, flag: 'wx' });
    renameSync(temporary, this.file(action.id));
  }

  prepare(
    origin: string,
    jwtToken: string,
    route: string,
    data: unknown,
    scope: string,
    writing = false,
    followup?: { route: string; data: unknown }
  ): NodeAction {
    const token = randomUUID();
    const id = createHash('sha256')
      .update(JSON.stringify([origin, route, data, followup, writing ? token : undefined]))
      .digest('hex');
    const action: NodeAction = {
      id,
      token,
      origin,
      jwtToken,
      route,
      data,
      scope,
      created: Date.now(),
      state: writing ? 'writing' : 'ready',
      owner: process.pid,
      ...(followup ? { followup } : {}),
    };
    if (writing) {
      this.writers.add(action.token);
    }
    this.save(action);
    return action;
  }

  ready(action: NodeAction): void {
    this.writers.delete(action.token);
    if (this.current(action.id)?.token === action.token) {
      this.save({ ...action, state: 'ready' });
    }
  }

  private current(id: string): NodeAction | undefined {
    if (this.directory === undefined) {
      return this.memory.get(id);
    }
    try {
      return JSON.parse(readFileSync(this.file(id), 'utf8')) as NodeAction;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  }

  isCurrent(action: NodeAction): boolean {
    return this.current(action.id)?.token === action.token;
  }

  cancelPublication(scope: string, output?: { format: string; resolution: string }): void {
    for (const action of this.pending()) {
      const data = action.data as { format?: string; resolution?: string };
      const matches =
        !output ||
        action.route.endsWith('/masterManifest') ||
        (data.format === output.format && data.resolution === output.resolution);
      if (
        action.scope === scope &&
        matches &&
        (action.route.endsWith('/published') || action.route.endsWith('/masterManifest'))
      ) {
        if (this.directory !== undefined) {
          unlinkSync(this.file(action.id));
        }
        this.memory.delete(action.id);
      }
    }
  }

  pending(): NodeAction[] {
    if (this.directory === undefined) {
      return [...this.memory.values()];
    }
    let names: string[];
    try {
      names = readdirSync(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
    return names
      .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
      .flatMap((name) => {
        const action = this.current(name.slice(0, -5));
        return action ? [action] : [];
      })
      .sort(
        (a, b) =>
          Number(a.route.startsWith('/streams/')) - Number(b.route.startsWith('/streams/')) ||
          a.created - b.created
      );
  }

  async deliver(action: NodeAction, send: (action: NodeAction) => Promise<unknown>): Promise<void> {
    if (this.sending.has(action.token)) {
      return;
    }
    this.sending.add(action.token);
    try {
      requireNodeSuccess(await send(action));
      if (this.current(action.id)?.token === action.token) {
        if (this.directory !== undefined) {
          unlinkSync(this.file(action.id));
        }
        this.memory.delete(action.id);
      }
    } finally {
      this.sending.delete(action.token);
    }
  }

  async replay(send: (action: NodeAction) => Promise<unknown>): Promise<void> {
    const blocked = new Set<string>();
    for (const action of this.pending()) {
      if (blocked.has(action.scope)) {
        continue;
      }
      if (this.sending.has(action.token)) {
        blocked.add(action.scope);
        continue;
      }
      if (action.state === 'writing') {
        let alive = this.writers.has(action.token);
        if (action.owner !== process.pid) {
          try {
            process.kill(action.owner, 0);
            alive = true;
          } catch (error) {
            alive = (error as NodeJS.ErrnoException).code !== 'ESRCH';
          }
        }
        if (alive) {
          if (!action.route.startsWith('/streams/')) {
            blocked.add(action.scope);
          }
          continue;
        }
        if (typeof (action.data as { activityId?: string } | undefined)?.activityId === 'string') {
          // A dead Client cannot acknowledge that remote writes drained. Preserve the
          // lease for operator reconciliation rather than allowing a migration race.
          blocked.add(action.scope);
          continue;
        }
        this.ready(action);
      }
      try {
        await this.deliver(action, send);
      } catch {
        blocked.add(action.scope);
      }
    }
  }
}
