import { execFile, spawn } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

import { parse, quote } from 'shell-quote';

import type { LogStore } from './logger';
import { resolveReservation } from './reservation';
import { isPidRunning } from './daemon';
import type {
  ActionResponse,
  MoveProcessRequest,
  PortctlConfig,
  ProcessRecord,
} from '../shared/types';

const execFileAsync = promisify(execFile);

interface SpawnResult {
  pid: number | undefined;
  ok: boolean;
}

interface RestartPlan {
  commandLine: string;
  env: NodeJS.ProcessEnv;
  cwd: string;
  processName: string;
}

type EventEmitter = (
  level: 'success' | 'error' | 'info' | 'warning',
  title: string,
  message: string,
) => void;

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readProcessInvocation(pid: number): Promise<string> {
  const { stdout } = await execFileAsync(
    'ps',
    ['eww', '-p', `${pid}`, '-o', 'command='],
    { maxBuffer: 8 * 1024 * 1024 },
  );

  const invocation = stdout.trim();
  if (!invocation) {
    throw new Error('Could not determine how the process was launched.');
  }

  return invocation;
}

function stringifyTokens(tokens: string[]): string {
  return quote(tokens);
}

function parseInvocation(invocation: string): {
  env: NodeJS.ProcessEnv;
  commandTokens: string[];
} {
  const tokens = parse(invocation);
  const env: NodeJS.ProcessEnv = {};
  const commandTokens: string[] = [];
  let inEnvPrefix = true;

  for (const token of tokens) {
    if (typeof token !== 'string') {
      throw new Error('Unsupported shell operator in command. Set a custom restart command.');
    }

    if (inEnvPrefix && /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token)) {
      const separatorIndex = token.indexOf('=');
      const key = token.slice(0, separatorIndex);
      const value = token.slice(separatorIndex + 1);
      env[key] = value;
      continue;
    }

    inEnvPrefix = false;
    commandTokens.push(token);
  }

  if (commandTokens.length === 0) {
    throw new Error('Could not detect the process command.');
  }

  return { env, commandTokens };
}

function replacePortToken(
  token: string,
  currentPort: number,
  targetPort: number,
): string | null {
  const next = `${targetPort}`;
  const current = `${currentPort}`;

  if (token === current) {
    return next;
  }

  if (token.includes(`:${current}`)) {
    return token.replace(`:${current}`, `:${next}`);
  }

  if (token.includes(`=${current}`)) {
    return token.replace(`=${current}`, `=${next}`);
  }

  if (token === `-p${current}`) {
    return `-p${next}`;
  }

  return null;
}

function applyPortToTokens(
  commandTokens: string[],
  env: NodeJS.ProcessEnv,
  currentPort: number,
  targetPort: number,
): boolean {
  if (env.PORT === `${currentPort}`) {
    env.PORT = `${targetPort}`;
    return true;
  }

  for (let index = 0; index < commandTokens.length; index += 1) {
    const token = commandTokens[index];
    const nextToken = commandTokens[index + 1];

    if (
      (token === '--port' || token === '-p' || token === '--listen') &&
      typeof nextToken === 'string'
    ) {
      commandTokens[index + 1] =
        replacePortToken(nextToken, currentPort, targetPort) ?? `${targetPort}`;
      return true;
    }

    const directReplacement = replacePortToken(token, currentPort, targetPort);
    if (directReplacement !== null) {
      commandTokens[index] = directReplacement;
      return true;
    }
  }

  return false;
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!isPidRunning(pid)) {
      return true;
    }
    await wait(150);
  }

  return !isPidRunning(pid);
}

async function waitForListeningPort(
  port: number,
  timeoutMs: number,
  expectedPid?: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const { stdout } = await execFileAsync(
        'lsof',
        ['-nP', '-iTCP', `:${port}`, '-sTCP:LISTEN', '-Fp'],
        { maxBuffer: 1024 * 1024 },
      );
      const pids = stdout
        .split('\n')
        .filter((line) => line.startsWith('p'))
        .map((line) => Number.parseInt(line.slice(1), 10))
        .filter((pid) => Number.isInteger(pid));

      if (pids.length === 0) {
        await wait(150);
        continue;
      }

      if (!expectedPid || pids.includes(expectedPid)) {
        return true;
      }
    } catch {
      // Best effort poll.
    }

    await wait(150);
  }

  return false;
}

export class ProcessController {
  private readonly busyPids = new Set<number>();

  public constructor(
    private readonly dependencies: {
      getSnapshot: () => ProcessRecord[];
      getConfig: () => PortctlConfig;
      logStore: LogStore;
      emitEvent: EventEmitter;
    },
  ) {}

  public async killProcess(pid: number): Promise<ActionResponse> {
    return this.withBusy([pid], async () => {
      const processRecord = this.findProcess(pid);
      if (!processRecord) {
        return {
          ok: false,
          message: `Process ${pid} is no longer running.`,
        };
      }

      if (!processRecord.canKill) {
        return {
          ok: false,
          message: 'portctl cannot kill its own daemon process from the dashboard.',
        };
      }

      try {
        await this.killProcessGracefully(processRecord.pid);
        return {
          ok: true,
          message: `Stopped ${processRecord.processName} on port ${processRecord.port}.`,
        };
      } catch (error) {
        const message = normalizeErrorMessage(error);
        if (message.includes('EPERM')) {
          return {
            ok: false,
            message: `Cannot kill ${processRecord.processName}: permission denied. Try running portctl with sudo.`,
          };
        }

        return {
          ok: false,
          message: `Failed to kill ${processRecord.processName}: ${message}`,
        };
      }
    });
  }

  public async suspendProcess(pid: number): Promise<ActionResponse> {
    return this.withBusy([pid], () => {
      const processRecord = this.findProcess(pid);
      if (!processRecord) {
        return {
          ok: false,
          message: `Process ${pid} is no longer running.`,
        };
      }

      if (!processRecord.canSuspend) {
        return {
          ok: false,
          message: 'portctl cannot suspend its own daemon process from the dashboard.',
        };
      }

      process.kill(processRecord.pid, 'SIGSTOP');
      return {
        ok: true,
        message: `Suspended ${processRecord.processName}.`,
      };
    });
  }

  public async resumeProcess(pid: number): Promise<ActionResponse> {
    return this.withBusy([pid], () => {
      const processRecord = this.findProcess(pid);
      if (!processRecord) {
        return {
          ok: false,
          message: `Process ${pid} is no longer running.`,
        };
      }

      process.kill(processRecord.pid, 'SIGCONT');
      return {
        ok: true,
        message: `Resumed ${processRecord.processName}.`,
      };
    });
  }

  public async moveProcess(
    pid: number,
    request: MoveProcessRequest,
  ): Promise<ActionResponse> {
    const source = this.findProcess(pid);
    if (!source) {
      return {
        ok: false,
        message: `Process ${pid} is no longer running.`,
      };
    }

    const occupier = this.findPortOccupier(request.targetPort, source.pid);
    if (occupier && !request.conflictStrategy) {
      return {
        ok: false,
        message: `Port ${request.targetPort} is already occupied.`,
        conflict: {
          occupiedBy: occupier,
          requestedPort: request.targetPort,
        },
      };
    }

    const busyPids = [source.pid, ...(occupier ? [occupier.pid] : [])];
    return this.withBusy(busyPids, async () => {
      if (!occupier) {
        return this.moveSingleProcess(source, request.targetPort);
      }

      const strategy = request.conflictStrategy ?? 'cancel';
      if (strategy === 'cancel') {
        return {
          ok: false,
          message: 'Port move cancelled.',
        };
      }

      if (strategy === 'killOccupier') {
        await this.killProcessGracefully(occupier.pid);
        return this.moveSingleProcess(source, request.targetPort);
      }

      if (strategy === 'moveOccupier') {
        if (!request.alternativePort) {
          return {
            ok: false,
            message: 'Choose a new port for the existing process first.',
          };
        }

        const occupierMove = await this.moveSingleProcess(
          occupier,
          request.alternativePort,
        );
        if (!occupierMove.ok) {
          return occupierMove;
        }

        return this.moveSingleProcess(source, request.targetPort);
      }

      return this.swapProcesses(source, occupier);
    });
  }

  public async startPort(port: number): Promise<ActionResponse> {
    const activeProcess = this.findPortOccupier(port);
    if (activeProcess) {
      return {
        ok: false,
        message: `Port ${port} is already occupied by ${activeProcess.processName}.`,
      };
    }

    const config = this.dependencies.getConfig();
    const reservation = config.reservations.find((entry) => entry.port === port) ?? null;
    const customTemplate =
      config.customRestartCommands[`port:${port}`] ?? reservation?.restartTemplate ?? null;

    if (!customTemplate) {
      return {
        ok: false,
        message:
          'There is no restart command for this pinned port yet. Add one in the card menu or settings first.',
      };
    }

    return this.withBusy([], async () => {
      const plan = this.buildTemplatePlan(customTemplate, port, port);
      const spawnResult = await this.spawnRestartProcess(plan, port);
      if (!spawnResult.ok) {
        return {
          ok: false,
          message: `Failed to start the process on port ${port}.`,
        };
      }

      return {
        ok: true,
        message: `Started a process on port ${port}.`,
        nextPid: spawnResult.pid,
      };
    });
  }

  public isBusy(pid: number): boolean {
    return this.busyPids.has(pid);
  }

  private async swapProcesses(
    source: ProcessRecord,
    occupier: ProcessRecord,
  ): Promise<ActionResponse> {
    const sourcePlan = await this.buildRestartPlan(source, occupier.port);
    const occupierPlan = await this.buildRestartPlan(occupier, source.port);

    await this.killProcessGracefully(source.pid);
    await this.killProcessGracefully(occupier.pid);

    const occupierSpawn = await this.spawnRestartProcess(occupierPlan, source.port);
    const sourceSpawn = await this.spawnRestartProcess(sourcePlan, occupier.port);

    if (!occupierSpawn.ok || !sourceSpawn.ok) {
      return {
        ok: false,
        message: `Swap failed. One or both processes did not come back cleanly.`,
      };
    }

    return {
      ok: true,
      message: `Swapped ${source.processName} to port ${occupier.port} and ${occupier.processName} to port ${source.port}.`,
      nextPid: sourceSpawn.pid,
    };
  }

  private async moveSingleProcess(
    source: ProcessRecord,
    targetPort: number,
  ): Promise<ActionResponse> {
    const plan = await this.buildRestartPlan(source, targetPort);

    try {
      await this.killProcessGracefully(source.pid);
      const spawnResult = await this.spawnRestartProcess(plan, targetPort);

      if (!spawnResult.ok) {
        this.dependencies.logStore.recordSystemLine(
          source.pid,
          `Restart failed on port ${targetPort}: ${plan.commandLine}`,
        );
        return {
          ok: false,
          message: `Process failed to restart on port ${targetPort}. Original process was terminated.`,
        };
      }

      return {
        ok: true,
        message: `Moved ${source.processName} to port ${targetPort}.`,
        nextPid: spawnResult.pid,
      };
    } catch (error) {
      const message = normalizeErrorMessage(error);
      if (message.includes('auto-detect')) {
        return {
          ok: false,
          message: `Could not auto-detect port argument for ${source.processName}. Set a custom restart command in settings.`,
        };
      }

      return {
        ok: false,
        message: `Failed to move ${source.processName}: ${message}`,
      };
    }
  }

  private async buildRestartPlan(
    processRecord: ProcessRecord,
    targetPort: number,
  ): Promise<RestartPlan> {
    const config = this.dependencies.getConfig();
    const reservation = resolveReservation(processRecord, config.reservations);
    const customTemplate =
      config.customRestartCommands[`port:${processRecord.port}`] ??
      (reservation?.restartTemplate ?? null);

    if (customTemplate) {
      return this.buildTemplatePlan(customTemplate, processRecord.port, targetPort);
    }

    const invocation = await readProcessInvocation(processRecord.pid);
    const { env, commandTokens } = parseInvocation(invocation);
    const changed = applyPortToTokens(
      commandTokens,
      env,
      processRecord.port,
      targetPort,
    );

    if (!changed) {
      throw new Error('Could not auto-detect port argument for restart.');
    }

    return {
      commandLine: stringifyTokens(commandTokens),
      env: {
        ...process.env,
        ...env,
      },
      cwd: processRecord.workingDirectory ?? os.homedir(),
      processName: processRecord.processName,
    };
  }

  private buildTemplatePlan(
    template: string,
    currentPort: number,
    targetPort: number,
  ): RestartPlan {
    const replaced = template
      .replaceAll('{{PORT}}', `${targetPort}`)
      .replaceAll(`:${currentPort}`, `:${targetPort}`);

    return {
      commandLine: replaced,
      env: process.env,
      cwd: os.homedir(),
      processName: 'process',
    };
  }

  private async spawnRestartProcess(
    plan: RestartPlan,
    port: number,
  ): Promise<SpawnResult> {
    const child = spawn(plan.commandLine, {
      cwd: plan.cwd,
      detached: false,
      env: plan.env,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const pid = child.pid;
    if (!pid) {
      return { ok: false, pid: undefined };
    }

    this.dependencies.logStore.attachChildProcess(child, {
      pid,
      processName: plan.processName,
      port,
    });

    const ready = await waitForListeningPort(port, 5000, pid);
    if (!ready) {
      this.dependencies.logStore.recordSystemLine(
        pid,
        `Command did not bind to port ${port}: ${plan.commandLine}`,
      );
      return {
        ok: false,
        pid,
      };
    }

    return {
      ok: true,
      pid,
    };
  }

  private async killProcessGracefully(pid: number): Promise<void> {
    process.kill(pid, 'SIGTERM');
    const exited = await waitForExit(pid, 3000);
    if (!exited) {
      process.kill(pid, 'SIGKILL');
      await waitForExit(pid, 1500);
    }
  }

  private findProcess(pid: number): ProcessRecord | undefined {
    return this.dependencies
      .getSnapshot()
      .find((processRecord) => processRecord.pid === pid);
  }

  private findPortOccupier(
    port: number,
    excludedPid?: number,
  ): ProcessRecord | undefined {
    return this.dependencies
      .getSnapshot()
      .find(
        (processRecord) =>
          processRecord.port === port &&
          processRecord.pid > 0 &&
          processRecord.pid !== excludedPid,
      );
  }

  private async withBusy<T>(
    pids: number[],
    operation: () => T | Promise<T>,
  ): Promise<T> {
    const conflictingPid = pids.find((pid) => this.busyPids.has(pid));
    if (conflictingPid !== undefined) {
      throw new Error(`A process action is already running for PID ${conflictingPid}.`);
    }

    for (const pid of pids) {
      this.busyPids.add(pid);
    }

    try {
      return await operation();
    } finally {
      for (const pid of pids) {
        this.busyPids.delete(pid);
      }
    }
  }
}
