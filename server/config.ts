import { promises as fsPromises } from 'node:fs';
import fs from 'node:fs';

import {
  CONFIG_VERSION,
  DEFAULT_CONFIG,
  type PortctlConfig,
  type Reservation,
} from '../shared/types';
import { ensurePortctlDirectories, resolvePortctlPaths } from './daemon';

type ConfigListener = (config: PortctlConfig) => void;
type WarningReporter = (message: string) => void;

function cloneDefaultConfig(): PortctlConfig {
  return structuredClone(DEFAULT_CONFIG);
}

function normalizePortList(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value > 0))];
}

function normalizeStringList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeReservations(reservations: Reservation[]): Reservation[] {
  return reservations
    .filter((reservation) => Number.isInteger(reservation.port) && reservation.port > 0)
    .map((reservation) => ({
      ...reservation,
      matcher: {
        ...reservation.matcher,
        value: reservation.matcher.value.trim(),
      },
      label: reservation.label?.trim() || null,
      restartTemplate: reservation.restartTemplate?.trim() || null,
    }));
}

function normalizeConfig(config: PortctlConfig): PortctlConfig {
  const next = cloneDefaultConfig();
  next.version = CONFIG_VERSION;
  next.settings = {
    ...next.settings,
    ...config.settings,
  };
  next.settings.dashboardPort =
    Number.isInteger(next.settings.dashboardPort) && next.settings.dashboardPort > 0
      ? next.settings.dashboardPort
      : DEFAULT_CONFIG.settings.dashboardPort;
  next.settings.pollingInterval =
    Number.isInteger(next.settings.pollingInterval) &&
    next.settings.pollingInterval >= 250
      ? next.settings.pollingInterval
      : DEFAULT_CONFIG.settings.pollingInterval;
  next.settings.logBufferSize =
    Number.isInteger(next.settings.logBufferSize) &&
    next.settings.logBufferSize >= 100
      ? next.settings.logBufferSize
      : DEFAULT_CONFIG.settings.logBufferSize;

  next.reservations = normalizeReservations(config.reservations ?? []);
  next.blockedPorts = normalizePortList(config.blockedPorts ?? []);
  next.pinnedPorts = normalizePortList(config.pinnedPorts ?? []);
  next.hiddenProcesses = normalizeStringList(config.hiddenProcesses ?? []);
  next.cardOrder = normalizeStringList(
    (config.cardOrder ?? []).map((value) => String(value)),
  );
  next.tags = Object.fromEntries(
    Object.entries(config.tags ?? {}).map(([key, value]) => [
      key,
      [...new Set(value.filter(Boolean).map((item) => item.trim()).filter(Boolean))],
    ]),
  );
  next.customNames = Object.fromEntries(
    Object.entries(config.customNames ?? {})
      .map(([key, value]) => [key, value.trim()] as const)
      .filter((entry) => entry[1].length > 0),
  );
  next.customRestartCommands = Object.fromEntries(
    Object.entries(config.customRestartCommands ?? {})
      .map(([key, value]) => [key, value.trim()] as const)
      .filter((entry) => entry[1].length > 0),
  );

  return next;
}

export class ConfigStore {
  private config: PortctlConfig = cloneDefaultConfig();
  private readonly listeners = new Set<ConfigListener>();
  private writeQueue: Promise<void> = Promise.resolve();
  private watching = false;

  public constructor(private readonly reportWarning: WarningReporter = () => undefined) {}

  public async initialize(): Promise<PortctlConfig> {
    const paths = resolvePortctlPaths();
    await ensurePortctlDirectories(paths);
    this.config = await this.loadFromDisk(true);
    this.startWatching();
    return this.getConfig();
  }

  public getConfig(): PortctlConfig {
    return structuredClone(this.config);
  }

  public subscribe(listener: ConfigListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async update(
    updater:
      | PortctlConfig
      | ((current: PortctlConfig) => PortctlConfig | Promise<PortctlConfig>),
  ): Promise<PortctlConfig> {
    const current = this.getConfig();
    const updated =
      typeof updater === 'function' ? await updater(current) : structuredClone(updater);
    const normalized = normalizeConfig(updated);

    this.config = normalized;
    await this.persist(normalized);
    this.notify();

    return this.getConfig();
  }

  public async reloadFromDisk(): Promise<PortctlConfig> {
    this.config = await this.loadFromDisk(false);
    this.notify();
    return this.getConfig();
  }

  private notify(): void {
    const snapshot = this.getConfig();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private startWatching(): void {
    if (this.watching) {
      return;
    }

    const paths = resolvePortctlPaths();
    fs.watchFile(paths.configFile, { interval: 1000 }, (current, previous) => {
      if (current.mtimeMs === previous.mtimeMs) {
        return;
      }

      void this.reloadFromDisk();
    });

    this.watching = true;
  }

  private async loadFromDisk(allowRecovery: boolean): Promise<PortctlConfig> {
    const paths = resolvePortctlPaths();

    try {
      const raw = await fsPromises.readFile(paths.configFile, 'utf8');
      const parsed = JSON.parse(raw) as PortctlConfig;
      return normalizeConfig(parsed);
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === 'ENOENT' ||
        !allowRecovery
      ) {
        const fresh = cloneDefaultConfig();
        await this.persist(fresh);
        return fresh;
      }

      try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        await fsPromises.copyFile(
          paths.configFile,
          `${paths.configFile}.corrupt-${timestamp}`,
        );
      } catch {
        // Best effort backup.
      }

      const fresh = cloneDefaultConfig();
      await this.persist(fresh);
      this.reportWarning(
        'Config file was unreadable. A backup was kept and portctl reset to defaults.',
      );
      return fresh;
    }
  }

  private async persist(config: PortctlConfig): Promise<void> {
    const paths = resolvePortctlPaths();

    this.writeQueue = this.writeQueue.then(async () => {
      await ensurePortctlDirectories(paths);

      try {
        await fsPromises.copyFile(paths.configFile, paths.configBackupFile);
      } catch {
        // Best effort backup.
      }

      await fsPromises.writeFile(
        paths.configFile,
        `${JSON.stringify(config, null, 2)}\n`,
        'utf8',
      );
    });

    await this.writeQueue;
  }
}
