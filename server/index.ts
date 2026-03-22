import path from 'node:path';
import { promises as fsPromises } from 'node:fs';
import http from 'node:http';

import express from 'express';

import packageJson from '../package.json';
import { ProcessController } from './actions';
import { ConfigStore } from './config';
import {
  ensurePortctlDirectories,
  formatDashboardUrl,
  removeDaemonState,
  removePidFile,
  resolvePortctlPaths,
  writeDaemonState,
  writePidFile,
} from './daemon';
import { discoverProcesses } from './discovery';
import { LogStore } from './logger';
import { createPolicyPlan } from './reservation';
import { registerRoutes } from './routes';
import type {
  DashboardSnapshot,
  EventLevel,
  EventRecord,
  PortctlConfig,
  ProcessRecord,
  StatusResponse,
} from '../shared/types';

class PortctlServer {
  private readonly configStore = new ConfigStore((message) => {
    this.emitEvent('warning', 'Config Reset', message);
  });

  private readonly logStore = new LogStore(
    () => this.configStore.getConfig().settings.logBufferSize,
  );

  private readonly controller = new ProcessController({
    getSnapshot: () => this.snapshot.processes,
    getConfig: () => this.configStore.getConfig(),
    logStore: this.logStore,
    emitEvent: (level, title, message) => {
      this.emitEvent(level, title, message);
    },
  });

  private readonly paths = resolvePortctlPaths();
  private readonly startedAt = new Date().toISOString();
  private readonly events: EventRecord[] = [];
  private readonly activeConflictKeys = new Set<string>();

  private nextEventId = 1;
  private pollFailures = 0;
  private banner: string | null = null;
  private polling = false;
  private policyEnforcementInFlight = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private server: http.Server | null = null;

  private snapshot: DashboardSnapshot = {
    updatedAt: new Date(0).toISOString(),
    pollFailures: 0,
    banner: null,
    processes: [],
  };

  public async start(): Promise<void> {
    await ensurePortctlDirectories(this.paths);
    const config = await this.configStore.initialize();

    const app = express();
    registerRoutes(app, {
      configStore: this.configStore,
      controller: this.controller,
      getSnapshot: () => this.snapshot,
      getLogs: (pid) => this.logStore.getLogs(pid),
      clearLogs: (pid) => this.logStore.clear(pid),
      getStatus: () => this.getStatus(),
      getEvents: (since) => this.getEvents(since),
    });

    this.registerStaticAssets(app);

    await this.listen(app, config.settings.dashboardPort);
    await writePidFile(process.pid, this.paths);
    await writeDaemonState(
      {
        pid: process.pid,
        startedAt: this.startedAt,
        dashboardPort: config.settings.dashboardPort,
        url: formatDashboardUrl(config.settings.dashboardPort),
        version: packageJson.version,
      },
      this.paths,
    );

    await this.refreshSnapshot();
    this.scheduleNextPoll();
  }

  public async stop(): Promise<void> {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }

    await removePidFile(this.paths);
    await removeDaemonState(this.paths);

    await new Promise<void>((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private async listen(app: express.Express, port: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const server = app.listen(port, '127.0.0.1', () => {
        this.server = server;
        resolve();
      });

      server.on('error', reject);
    });
  }

  private registerStaticAssets(app: express.Express): void {
    const staticDir = path.resolve(__dirname, '..', 'client');
    const staticIndex = path.join(staticDir, 'index.html');

    app.use(express.static(staticDir));
    app.use(async (_request, response) => {
      try {
        await fsPromises.access(staticIndex);
        response.sendFile(staticIndex);
      } catch {
        response
          .status(503)
          .send(
            'portctl frontend is not built yet. Run "npm run build" for a production bundle or use "npm run dev" during development.',
          );
      }
    });
  }

  private scheduleNextPoll(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }

    const interval = this.configStore.getConfig().settings.pollingInterval;
    this.pollTimer = setTimeout(() => {
      void this.runPoll();
    }, interval);
  }

  private async runPoll(): Promise<void> {
    if (this.polling) {
      this.scheduleNextPoll();
      return;
    }

    this.polling = true;
    try {
      await this.refreshSnapshot();
    } finally {
      this.polling = false;
      this.scheduleNextPoll();
    }
  }

  private async refreshSnapshot(): Promise<void> {
    try {
      const config = this.configStore.getConfig();
      const activeProcesses = await discoverProcesses({
        config,
        logStore: this.logStore,
        portctlPid: process.pid,
      });

      this.pollFailures = 0;
      this.banner = null;
      this.snapshot = {
        updatedAt: new Date().toISOString(),
        pollFailures: this.pollFailures,
        banner: this.banner,
        processes: this.composeDashboardProcesses(activeProcesses, config),
      };

      await this.enforcePolicies(activeProcesses, config);
    } catch (error) {
      this.pollFailures += 1;
      if (this.pollFailures >= 3) {
        this.banner =
          'Process discovery is having trouble talking to lsof. portctl will retry automatically.';
      }

      this.snapshot = {
        ...this.snapshot,
        updatedAt: new Date().toISOString(),
        pollFailures: this.pollFailures,
        banner: this.banner,
      };
      this.emitEvent(
        'warning',
        'Discovery Retry',
        `Process discovery failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private composeDashboardProcesses(
    activeProcesses: ProcessRecord[],
    config: PortctlConfig,
  ): ProcessRecord[] {
    const processesByPort = new Map(activeProcesses.map((entry) => [entry.port, entry]));
    const allPorts = new Set<number>([
      ...activeProcesses.map((entry) => entry.port),
      ...config.pinnedPorts,
    ]);

    const merged: ProcessRecord[] = [];
    for (const port of allPorts) {
      const existing = processesByPort.get(port);
      if (existing) {
        merged.push(existing);
        continue;
      }

      const reservation =
        config.reservations.find((entry) => entry.port === port) ?? null;
      const tags = [
        ...new Set(
          [
            ...(config.tags[`port:${port}`] ?? []),
            ...(reservation ? config.tags[`matcher:${reservation.matcher.value}`] ?? [] : []),
          ],
        ),
      ];

      merged.push({
        port,
        ports: [port],
        pid: 0,
        parentPid: null,
        workerCount: 0,
        processName: 'No active process',
        command: '',
        workingDirectory: null,
        memoryRssKb: null,
        cpuPercent: null,
        protocol: 'TCP',
        startedAt: null,
        uptime: null,
        status: 'empty',
        classifications: ['other'],
        primaryClassification: 'other',
        tags,
        isPortctl: false,
        isSystemProcess: false,
        canKill: false,
        canSuspend: false,
        logStatus: 'available-next-restart',
        reservation: reservation
          ? {
              label: reservation.label,
              matcher: reservation.matcher,
              port: reservation.port,
            }
          : null,
        lastError: null,
      });
    }

    return merged.sort((left, right) => this.sortByCardOrder(left.port, right.port, config));
  }

  private sortByCardOrder(leftPort: number, rightPort: number, config: PortctlConfig): number {
    const leftIndex = config.cardOrder.indexOf(leftPort);
    const rightIndex = config.cardOrder.indexOf(rightPort);

    if (leftIndex !== -1 && rightIndex !== -1) {
      return leftIndex - rightIndex;
    }
    if (leftIndex !== -1) {
      return -1;
    }
    if (rightIndex !== -1) {
      return 1;
    }

    return leftPort - rightPort;
  }

  private async enforcePolicies(
    activeProcesses: ProcessRecord[],
    config: PortctlConfig,
  ): Promise<void> {
    if (this.policyEnforcementInFlight) {
      return;
    }

    this.policyEnforcementInFlight = true;
    try {
      const plan = createPolicyPlan(activeProcesses, config);
      const currentConflictKeys = new Set<string>();

      for (const conflict of plan.conflicts) {
        const key = `${conflict.port}:${conflict.processes
          .map((entry) => entry.pid)
          .sort((left, right) => left - right)
          .join(',')}`;
        currentConflictKeys.add(key);

        if (!this.activeConflictKeys.has(key)) {
          this.emitEvent(
            'error',
            'Reservation Conflict',
            `Reservation conflict: ${conflict.processes
              .map((entry) => entry.processName)
              .join(' and ')} both target port ${conflict.port}. Resolve it in settings.`,
          );
        }
      }

      this.activeConflictKeys.clear();
      for (const key of currentConflictKeys) {
        this.activeConflictKeys.add(key);
      }

      for (const blockedProcess of plan.blocked) {
        if (this.controller.isBusy(blockedProcess.pid)) {
          continue;
        }

        const result = await this.controller.killProcess(blockedProcess.pid);
        if (result.ok) {
          this.emitEvent(
            'warning',
            'Blocked Port',
            `Killed ${blockedProcess.processName} on blocked port ${blockedProcess.port}.`,
          );
        }
      }

      for (const migration of plan.migrations) {
        if (this.controller.isBusy(migration.process.pid)) {
          continue;
        }

        if (migration.occupier && this.controller.isBusy(migration.occupier.pid)) {
          continue;
        }

        const result = await this.controller.moveProcess(migration.process.pid, {
          targetPort: migration.reservation.port,
          conflictStrategy: migration.occupier ? 'killOccupier' : undefined,
        });

        if (!result.ok) {
          this.emitEvent(
            'error',
            'Reservation Move Failed',
            result.message,
          );
          continue;
        }

        if (migration.occupier) {
          this.emitEvent(
            'info',
            'Reserved Port Reclaimed',
            `Killed ${migration.occupier.processName} on port ${migration.reservation.port} and moved ${migration.process.processName} to its reserved port.`,
          );
        } else {
          this.emitEvent(
            'info',
            'Reserved Port Applied',
            `Moved ${migration.process.processName} to reserved port ${migration.reservation.port}.`,
          );
        }
      }
    } finally {
      this.policyEnforcementInFlight = false;
    }
  }

  private emitEvent(level: EventLevel, title: string, message: string): void {
    this.events.push({
      id: this.nextEventId,
      level,
      title,
      message,
      createdAt: new Date().toISOString(),
    });
    this.nextEventId += 1;

    if (this.events.length > 200) {
      this.events.splice(0, this.events.length - 200);
    }
  }

  private getEvents(since?: number): EventRecord[] {
    if (!since) {
      return this.events.slice(-30);
    }

    return this.events.filter((event) => event.id > since);
  }

  private getStatus(): StatusResponse {
    const dashboardPort = this.configStore.getConfig().settings.dashboardPort;
    return {
      ok: true,
      pid: process.pid,
      url: formatDashboardUrl(dashboardPort),
      startedAt: this.startedAt,
      uptime: this.computeUptime(),
      version: packageJson.version,
    };
  }

  private computeUptime(): string {
    const elapsedSeconds = Math.max(
      1,
      Math.floor((Date.now() - new Date(this.startedAt).getTime()) / 1000),
    );
    const hours = Math.floor(elapsedSeconds / 3600);
    const minutes = Math.floor((elapsedSeconds % 3600) / 60);
    const seconds = elapsedSeconds % 60;

    return `${hours}h ${minutes}m ${seconds}s`;
  }
}

async function main(): Promise<void> {
  const server = new PortctlServer();
  await server.start();

  const shutdown = async () => {
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
