import type { Express, Request, Response } from 'express';
import express from 'express';
import { z } from 'zod';

import type { ConfigStore } from './config';
import type { ProcessController } from './actions';
import type {
  DashboardSnapshot,
  EventRecord,
  ProcessLogsResponse,
  Reservation,
  StatusResponse,
} from '../shared/types';

const reservationSchema = z.object({
  port: z.number().int().positive(),
  matcher: z.object({
    type: z.enum([
      'command_contains',
      'process_name',
      'working_directory',
      'regex',
    ]),
    value: z.string().min(1),
  }),
  restartTemplate: z.string().nullable(),
  label: z.string().nullable(),
});

const moveSchema = z.object({
  targetPort: z.number().int().positive(),
  conflictStrategy: z
    .enum(['swap', 'moveOccupier', 'killOccupier', 'cancel'])
    .optional(),
  alternativePort: z.number().int().positive().optional(),
});

const portBodySchema = z.object({
  port: z.number().int().positive(),
});

const nameBodySchema = z.object({
  name: z.string().trim().min(1),
});

const tagsBodySchema = z.object({
  tags: z.array(z.string()),
});

const customNameSchema = z.object({
  name: z.string(),
});

const restartCommandSchema = z.object({
  command: z.string(),
});

const cardOrderSchema = z.object({
  cardOrder: z.array(z.string().min(1)),
});

const configSchema = z.object({
  version: z.number().int().positive(),
  settings: z.object({
    dashboardPort: z.number().int().positive(),
    pollingInterval: z.number().int().min(250),
    defaultView: z.enum(['card', 'table']),
    theme: z.enum(['dark', 'light']),
    cardClickBehavior: z.enum(['openBrowser', 'openLogs']),
    logBufferSize: z.number().int().min(100),
  }),
  reservations: z.array(reservationSchema),
  blockedPorts: z.array(z.number().int().positive()),
  pinnedPorts: z.array(z.number().int().positive()),
  hiddenProcesses: z.array(z.string()),
  tags: z.record(z.string(), z.array(z.string())),
  cardOrder: z.array(z.string()),
  customNames: z.record(z.string(), z.string()),
  customRestartCommands: z.record(z.string(), z.string()),
});

function sendError(response: Response, status: number, message: string): void {
  response.status(status).json({
    ok: false,
    message,
  });
}

export function registerRoutes(
  app: Express,
  dependencies: {
    configStore: ConfigStore;
    controller: ProcessController;
    getSnapshot: () => DashboardSnapshot;
    getLogs: (pid: number) => ProcessLogsResponse;
    clearLogs: (pid: number) => void;
    getStatus: () => StatusResponse;
    getEvents: (since?: number) => EventRecord[];
  },
): void {
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/processes', (_request, response) => {
    response.json(dependencies.getSnapshot());
  });

  app.post('/api/processes/:pid/kill', async (request, response) => {
    const pid = Number.parseInt(request.params.pid, 10);
    if (!Number.isInteger(pid)) {
      sendError(response, 400, 'Invalid PID.');
      return;
    }

    try {
      const result = await dependencies.controller.killProcess(pid);
      response.status(result.ok ? 200 : 400).json(result);
    } catch (error) {
      sendError(response, 409, error instanceof Error ? error.message : String(error));
    }
  });

  app.post('/api/processes/:pid/suspend', async (request, response) => {
    const pid = Number.parseInt(request.params.pid, 10);
    if (!Number.isInteger(pid)) {
      sendError(response, 400, 'Invalid PID.');
      return;
    }

    try {
      const result = await dependencies.controller.suspendProcess(pid);
      response.status(result.ok ? 200 : 400).json(result);
    } catch (error) {
      sendError(response, 409, error instanceof Error ? error.message : String(error));
    }
  });

  app.post('/api/processes/:pid/resume', async (request, response) => {
    const pid = Number.parseInt(request.params.pid, 10);
    if (!Number.isInteger(pid)) {
      sendError(response, 400, 'Invalid PID.');
      return;
    }

    try {
      const result = await dependencies.controller.resumeProcess(pid);
      response.status(result.ok ? 200 : 400).json(result);
    } catch (error) {
      sendError(response, 409, error instanceof Error ? error.message : String(error));
    }
  });

  app.post('/api/processes/:pid/move', async (request, response) => {
    const pid = Number.parseInt(request.params.pid, 10);
    if (!Number.isInteger(pid)) {
      sendError(response, 400, 'Invalid PID.');
      return;
    }

    const parsed = moveSchema.safeParse(request.body);
    if (!parsed.success) {
      sendError(response, 400, 'Invalid move request.');
      return;
    }

    try {
      const result = await dependencies.controller.moveProcess(pid, parsed.data);
      response.status(result.conflict ? 409 : result.ok ? 200 : 400).json(result);
    } catch (error) {
      sendError(response, 409, error instanceof Error ? error.message : String(error));
    }
  });

  app.get('/api/processes/:pid/logs', (request, response) => {
    const pid = Number.parseInt(request.params.pid, 10);
    if (!Number.isInteger(pid)) {
      sendError(response, 400, 'Invalid PID.');
      return;
    }

    response.json(dependencies.getLogs(pid));
  });

  app.post('/api/processes/:pid/logs/clear', (request, response) => {
    const pid = Number.parseInt(request.params.pid, 10);
    if (!Number.isInteger(pid)) {
      sendError(response, 400, 'Invalid PID.');
      return;
    }

    dependencies.clearLogs(pid);
    response.json({
      ok: true,
      message: 'Log buffer cleared.',
    });
  });

  app.post('/api/ports/:port/start', async (request, response) => {
    const port = Number.parseInt(request.params.port, 10);
    if (!Number.isInteger(port)) {
      sendError(response, 400, 'Invalid port.');
      return;
    }

    try {
      const result = await dependencies.controller.startPort(port);
      response.status(result.ok ? 200 : 400).json(result);
    } catch (error) {
      sendError(response, 409, error instanceof Error ? error.message : String(error));
    }
  });

  app.get('/api/config', (_request, response) => {
    response.json(dependencies.configStore.getConfig());
  });

  app.put('/api/config', async (request, response) => {
    const parsed = configSchema.safeParse(request.body);
    if (!parsed.success) {
      sendError(response, 400, 'Invalid config payload.');
      return;
    }

    const previousPort =
      dependencies.configStore.getConfig().settings.dashboardPort;
    const nextConfig = await dependencies.configStore.update(parsed.data);
    const message =
      previousPort !== nextConfig.settings.dashboardPort
        ? 'Config saved. Restart portctl for the dashboard port change to take effect.'
        : 'Config saved.';

    response.json({
      ok: true,
      message,
      config: nextConfig,
    });
  });

  app.post('/api/config/reservations', async (request, response) => {
    const parsed = reservationSchema.safeParse(request.body);
    if (!parsed.success) {
      sendError(response, 400, 'Invalid reservation.');
      return;
    }

    const reservation = parsed.data as Reservation;
    const nextConfig = await dependencies.configStore.update((current) => ({
      ...current,
      reservations: [
        ...current.reservations.filter((entry) => entry.port !== reservation.port),
        reservation,
      ],
    }));

    response.json({
      ok: true,
      message: `Reserved port ${reservation.port}.`,
      config: nextConfig,
    });
  });

  app.delete('/api/config/reservations/:port', async (request, response) => {
    const port = Number.parseInt(request.params.port, 10);
    if (!Number.isInteger(port)) {
      sendError(response, 400, 'Invalid port.');
      return;
    }

    const nextConfig = await dependencies.configStore.update((current) => ({
      ...current,
      reservations: current.reservations.filter((entry) => entry.port !== port),
    }));

    response.json({
      ok: true,
      message: `Removed reservation for port ${port}.`,
      config: nextConfig,
    });
  });

  app.post('/api/config/blocked-ports', async (request, response) => {
    const parsed = portBodySchema.safeParse(request.body);
    if (!parsed.success) {
      sendError(response, 400, 'Invalid port.');
      return;
    }
    const { port } = parsed.data;

    const nextConfig = await dependencies.configStore.update((current) => ({
      ...current,
      blockedPorts: [...new Set([...current.blockedPorts, port])],
    }));

    response.json({
      ok: true,
      message: `Blocked port ${port}.`,
      config: nextConfig,
    });
  });

  app.delete('/api/config/blocked-ports/:port', async (request, response) => {
    const port = Number.parseInt(request.params.port, 10);
    if (!Number.isInteger(port)) {
      sendError(response, 400, 'Invalid port.');
      return;
    }

    const nextConfig = await dependencies.configStore.update((current) => ({
      ...current,
      blockedPorts: current.blockedPorts.filter((value) => value !== port),
    }));

    response.json({
      ok: true,
      message: `Unblocked port ${port}.`,
      config: nextConfig,
    });
  });

  app.post('/api/config/pinned-ports', async (request, response) => {
    const parsed = portBodySchema.safeParse(request.body);
    if (!parsed.success) {
      sendError(response, 400, 'Invalid port.');
      return;
    }
    const { port } = parsed.data;

    const nextConfig = await dependencies.configStore.update((current) => ({
      ...current,
      pinnedPorts: [...new Set([...current.pinnedPorts, port])],
    }));

    response.json({
      ok: true,
      message: `Pinned port ${port}.`,
      config: nextConfig,
    });
  });

  app.delete('/api/config/pinned-ports/:port', async (request, response) => {
    const port = Number.parseInt(request.params.port, 10);
    if (!Number.isInteger(port)) {
      sendError(response, 400, 'Invalid port.');
      return;
    }

    const nextConfig = await dependencies.configStore.update((current) => ({
      ...current,
      pinnedPorts: current.pinnedPorts.filter((value) => value !== port),
    }));

    response.json({
      ok: true,
      message: `Unpinned port ${port}.`,
      config: nextConfig,
    });
  });

  app.post('/api/config/hidden-processes', async (request, response) => {
    const parsed = nameBodySchema.safeParse(request.body);
    if (!parsed.success) {
      sendError(response, 400, 'Invalid hidden process payload.');
      return;
    }
    const { name } = parsed.data;

    const nextConfig = await dependencies.configStore.update((current) => ({
      ...current,
      hiddenProcesses: [...new Set([...current.hiddenProcesses, name])],
    }));

    response.json({
      ok: true,
      message: `Hidden ${name}.`,
      config: nextConfig,
    });
  });

  app.delete('/api/config/hidden-processes/:name', async (request, response) => {
    const name = request.params.name.trim();
    if (!name) {
      sendError(response, 400, 'Invalid process name.');
      return;
    }

    const nextConfig = await dependencies.configStore.update((current) => ({
      ...current,
      hiddenProcesses: current.hiddenProcesses.filter((value) => value !== name),
    }));

    response.json({
      ok: true,
      message: `Unhid ${name}.`,
      config: nextConfig,
    });
  });

  app.post('/api/config/tags/:key', async (request, response) => {
    const key = request.params.key;
    const parsed = tagsBodySchema.safeParse(request.body);
    if (!parsed.success) {
      sendError(response, 400, 'Invalid tags payload.');
      return;
    }
    const { tags } = parsed.data;

    const nextConfig = await dependencies.configStore.update((current) => ({
      ...current,
      tags: {
        ...current.tags,
        [key]: tags,
      },
    }));

    response.json({
      ok: true,
      message: `Updated tags for ${key}.`,
      config: nextConfig,
    });
  });

  app.put('/api/config/custom-names/:key', async (request, response) => {
    const key = request.params.key;
    const parsed = customNameSchema.safeParse(request.body);
    if (!parsed.success) {
      sendError(response, 400, 'Invalid custom name payload.');
      return;
    }

    const name = parsed.data.name.trim();
    const nextConfig = await dependencies.configStore.update((current) => ({
      ...current,
      customNames: name
        ? {
            ...current.customNames,
            [key]: name,
          }
        : Object.fromEntries(
            Object.entries(current.customNames).filter(
              ([entryKey]) => entryKey !== key,
            ),
          ),
    }));

    response.json({
      ok: true,
      message: name ? `Saved custom name for ${key}.` : `Removed custom name for ${key}.`,
      config: nextConfig,
    });
  });

  app.post('/api/config/custom-restart-commands/:key', async (request, response) => {
    const key = request.params.key;
    const parsed = restartCommandSchema.safeParse(request.body);
    if (!parsed.success) {
      sendError(response, 400, 'Invalid restart command payload.');
      return;
    }
    const { command } = parsed.data;

    const nextConfig = await dependencies.configStore.update((current) => ({
      ...current,
      customRestartCommands: command.trim()
        ? {
            ...current.customRestartCommands,
            [key]: command,
          }
        : Object.fromEntries(
            Object.entries(current.customRestartCommands).filter(
              ([entryKey]) => entryKey !== key,
            ),
          ),
    }));

    response.json({
      ok: true,
      message: command.trim()
        ? `Saved restart command for ${key}.`
        : `Removed restart command for ${key}.`,
      config: nextConfig,
    });
  });

  app.put('/api/config/card-order', async (request, response) => {
    const parsed = cardOrderSchema.safeParse(request.body);
    if (!parsed.success) {
      sendError(response, 400, 'Invalid card order.');
      return;
    }
    const { cardOrder } = parsed.data;

    const nextConfig = await dependencies.configStore.update((current) => ({
      ...current,
      cardOrder,
    }));

    response.json({
      ok: true,
      message: 'Updated card order.',
      config: nextConfig,
    });
  });

  app.get('/api/events', (request, response) => {
    const sinceRaw = Array.isArray(request.query.since)
      ? request.query.since[0]
      : request.query.since;
    const since =
      typeof sinceRaw === 'string' ? Number.parseInt(sinceRaw, 10) : undefined;
    response.json({
      events: dependencies.getEvents(since),
    });
  });

  app.get('/api/status', (_request: Request, response: Response) => {
    response.json(dependencies.getStatus());
  });
}
