import fs from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { DEFAULT_CONFIG, type StatusResponse } from '../shared/types';

export interface PortctlPaths {
  rootDir: string;
  logsDir: string;
  configFile: string;
  configBackupFile: string;
  pidFile: string;
  daemonLogFile: string;
  stateFile: string;
}

export interface DaemonState {
  pid: number;
  startedAt: string;
  dashboardPort: number;
  url: string;
  version: string;
}

export function resolvePortctlPaths(): PortctlPaths {
  const rootDir = process.env.PORTCTL_HOME
    ? path.resolve(process.env.PORTCTL_HOME)
    : path.join(os.homedir(), '.portctl');
  const logsDir = path.join(rootDir, 'logs');

  return {
    rootDir,
    logsDir,
    configFile: path.join(rootDir, 'config.json'),
    configBackupFile: path.join(rootDir, '.config.json.bak'),
    pidFile: path.join(rootDir, 'portctl.pid'),
    daemonLogFile: path.join(logsDir, 'daemon.log'),
    stateFile: path.join(rootDir, 'state.json'),
  };
}

export async function ensurePortctlDirectories(
  paths: PortctlPaths = resolvePortctlPaths(),
): Promise<void> {
  await fsPromises.mkdir(paths.rootDir, { recursive: true });
  await fsPromises.mkdir(paths.logsDir, { recursive: true });
}

export async function readPidFile(
  paths: PortctlPaths = resolvePortctlPaths(),
): Promise<number | null> {
  try {
    const content = await fsPromises.readFile(paths.pidFile, 'utf8');
    const pid = Number.parseInt(content.trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

export async function writePidFile(
  pid: number,
  paths: PortctlPaths = resolvePortctlPaths(),
): Promise<void> {
  await ensurePortctlDirectories(paths);
  await fsPromises.writeFile(paths.pidFile, `${pid}\n`, 'utf8');
}

export async function removePidFile(
  paths: PortctlPaths = resolvePortctlPaths(),
): Promise<void> {
  try {
    await fsPromises.rm(paths.pidFile, { force: true });
  } catch {
    // Intentionally ignored.
  }
}

export async function readDaemonState(
  paths: PortctlPaths = resolvePortctlPaths(),
): Promise<DaemonState | null> {
  try {
    const raw = await fsPromises.readFile(paths.stateFile, 'utf8');
    return JSON.parse(raw) as DaemonState;
  } catch {
    return null;
  }
}

export async function writeDaemonState(
  state: DaemonState,
  paths: PortctlPaths = resolvePortctlPaths(),
): Promise<void> {
  await ensurePortctlDirectories(paths);
  await fsPromises.writeFile(
    paths.stateFile,
    `${JSON.stringify(state, null, 2)}\n`,
    'utf8',
  );
}

export async function removeDaemonState(
  paths: PortctlPaths = resolvePortctlPaths(),
): Promise<void> {
  try {
    await fsPromises.rm(paths.stateFile, { force: true });
  } catch {
    // Intentionally ignored.
  }
}

export function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function formatDashboardUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export async function getConfiguredDashboardPort(
  paths: PortctlPaths = resolvePortctlPaths(),
): Promise<number> {
  try {
    const raw = await fsPromises.readFile(paths.configFile, 'utf8');
    const parsed = JSON.parse(raw) as Partial<typeof DEFAULT_CONFIG>;
    const configuredPort = parsed.settings?.dashboardPort;
    return typeof configuredPort === 'number' && Number.isInteger(configuredPort)
      ? configuredPort
      : DEFAULT_CONFIG.settings.dashboardPort;
  } catch {
    return DEFAULT_CONFIG.settings.dashboardPort;
  }
}

export async function checkPortctlHealth(
  port: number,
  timeoutMs = 1200,
): Promise<StatusResponse | null> {
  return new Promise((resolve) => {
    const request = http.get(
      {
        host: '127.0.0.1',
        port,
        path: '/api/status',
        timeout: timeoutMs,
      },
      (response) => {
        let body = '';

        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          try {
            const parsed = JSON.parse(body) as StatusResponse;
            resolve(parsed.ok ? parsed : null);
          } catch {
            resolve(null);
          }
        });
      },
    );

    request.on('timeout', () => {
      request.destroy();
      resolve(null);
    });

    request.on('error', () => {
      resolve(null);
    });
  });
}

export async function waitForHealthyDaemon(
  port: number,
  attempts = 20,
  delayMs = 300,
): Promise<StatusResponse | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const status = await checkPortctlHealth(port);
    if (status) {
      return status;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }

  return null;
}

export function openDaemonLogStream(
  paths: PortctlPaths = resolvePortctlPaths(),
): number {
  ensurePortctlDirectories(paths).catch(() => undefined);

  return fs.openSync(paths.daemonLogFile, 'a');
}
