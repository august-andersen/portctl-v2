import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { LogStore } from './logger';
import { resolveReservation } from './reservation';
import type {
  PortctlConfig,
  ProcessRecord,
  ProcessStatus,
  ProcessType,
} from '../shared/types';

const execFileAsync = promisify(execFile);

interface LsofEntry {
  pid: number;
  processName: string;
  port: number;
}

interface ProcessDetails {
  pid: number;
  parentPid: number | null;
  memoryRssKb: number | null;
  cpuPercent: number | null;
  uptime: string | null;
  status: ProcessStatus;
  startedAt: string | null;
  command: string;
}

const WEB_PATTERNS = [
  /\bvite\b/i,
  /\bnext\b/i,
  /\bwebpack-dev-server\b/i,
  /\breact-scripts\b/i,
  /\bhttp-server\b/i,
  /\bserve\b/i,
  /\bflask\b/i,
  /\bdjango\b/i,
  /\buvicorn\b/i,
  /\bgunicorn\b/i,
  /\brails\b/i,
  /\bpuma\b/i,
  /\bwebrick\b/i,
  /\bphp\b/i,
];

const API_PATTERNS = [
  /\bexpress\b/i,
  /\bfastify\b/i,
  /\bnest\b/i,
  /\bkoa\b/i,
  /\bhono\b/i,
  /\bgraphql\b/i,
  /\buvicorn\b/i,
  /\bgunicorn\b/i,
  /\bflask\b/i,
  /\bapi\b/i,
];

const DATABASE_PATTERNS = [
  /\bpostgres\b/i,
  /\bpostmaster\b/i,
  /\bmysql\b/i,
  /\bmariadb\b/i,
  /\bmongod\b/i,
  /\bredis-server\b/i,
  /\bmemcached\b/i,
  /\bclickhouse\b/i,
  /\belasticsearch\b/i,
];

const SYSTEM_PATTERNS = [
  /\bmdnsresponder\b/i,
  /\bcontrolcenter\b/i,
  /\bairplay\b/i,
  /\brapportd\b/i,
  /\bsharingd\b/i,
  /\bkernel\b/i,
];

function parsePort(name: string): number | null {
  const match = name.match(/:(\d+)(?:->|$)/);
  if (!match) {
    return null;
  }

  const port = Number.parseInt(match[1], 10);
  return Number.isInteger(port) ? port : null;
}

async function runCommand(
  file: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(file, args, {
    maxBuffer: 8 * 1024 * 1024,
  });
}

async function getListeningEntries(): Promise<LsofEntry[]> {
  try {
    const { stdout } = await runCommand('lsof', [
      '-nP',
      '-iTCP',
      '-sTCP:LISTEN',
      '-Fpcn',
    ]);

    const entries: LsofEntry[] = [];
    let currentPid = 0;
    let currentCommand = '';

    for (const line of stdout.split('\n')) {
      if (!line) {
        continue;
      }

      const field = line[0];
      const value = line.slice(1);

      if (field === 'p') {
        currentPid = Number.parseInt(value, 10);
      }

      if (field === 'c') {
        currentCommand = value;
      }

      if (field === 'n') {
        const port = parsePort(value);
        if (port !== null && currentPid > 0) {
          entries.push({
            pid: currentPid,
            processName: currentCommand || 'unknown',
            port,
          });
        }
      }
    }

    return entries;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException & { code?: string | number }).code;
    if (String(code) === '1') {
      return [];
    }

    throw error;
  }
}

async function getProcessDetails(pids: number[]): Promise<Map<number, ProcessDetails>> {
  if (pids.length === 0) {
    return new Map();
  }

  const { stdout } = await runCommand('ps', [
    '-ww',
    '-p',
    pids.join(','),
    '-o',
    'pid=',
    '-o',
    'ppid=',
    '-o',
    'rss=',
    '-o',
    '%cpu=',
    '-o',
    'etime=',
    '-o',
    'stat=',
    '-o',
    'lstart=',
    '-o',
    'command=',
  ]);

  const details = new Map<number, ProcessDetails>();
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const tokens = trimmed.split(/\s+/);
    if (tokens.length < 12) {
      continue;
    }

    const pid = Number.parseInt(tokens[0], 10);
    const parentPid = Number.parseInt(tokens[1], 10);
    const memoryRssKb = Number.parseInt(tokens[2], 10);
    const cpuPercent = Number.parseFloat(tokens[3]);
    const uptime = tokens[4] ?? null;
    const stat = tokens[5] ?? '';
    const startedAt = tokens.slice(6, 11).join(' ');
    const command = tokens.slice(11).join(' ');

    details.set(pid, {
      pid,
      parentPid: Number.isInteger(parentPid) ? parentPid : null,
      memoryRssKb: Number.isInteger(memoryRssKb) ? memoryRssKb : null,
      cpuPercent: Number.isFinite(cpuPercent) ? cpuPercent : null,
      uptime,
      status: stat.includes('T') ? 'suspended' : 'running',
      startedAt,
      command,
    });
  }

  return details;
}

async function getWorkingDirectory(pid: number): Promise<string | null> {
  try {
    const { stdout } = await runCommand('lsof', ['-nP', '-a', '-p', `${pid}`, '-d', 'cwd', '-Fn']);
    const cwdLine = stdout
      .split('\n')
      .find((line) => line.startsWith('n') && line.length > 1);

    return cwdLine ? cwdLine.slice(1) : null;
  } catch {
    return null;
  }
}

function classifyProcess(process: {
  processName: string;
  command: string;
  workingDirectory: string | null;
}): ProcessType[] {
  const haystack = `${process.processName} ${process.command} ${
    process.workingDirectory ?? ''
  }`;
  const classifications = new Set<ProcessType>();

  if (SYSTEM_PATTERNS.some((pattern) => pattern.test(haystack))) {
    classifications.add('system');
  }
  if (DATABASE_PATTERNS.some((pattern) => pattern.test(haystack))) {
    classifications.add('database');
  }
  if (WEB_PATTERNS.some((pattern) => pattern.test(haystack))) {
    classifications.add('web');
  }
  if (API_PATTERNS.some((pattern) => pattern.test(haystack))) {
    classifications.add('api');
  }
  if (classifications.size === 0) {
    classifications.add('other');
  }

  return [...classifications];
}

function resolvePrimaryClassification(classifications: ProcessType[]): ProcessType {
  const priority: ProcessType[] = ['system', 'database', 'web', 'api', 'other'];
  return priority.find((item) => classifications.includes(item)) ?? 'other';
}

export async function discoverProcesses(options: {
  config: PortctlConfig;
  logStore: LogStore;
  portctlPid: number;
}): Promise<ProcessRecord[]> {
  const listeningEntries = await getListeningEntries();
  const pids = [...new Set(listeningEntries.map((entry) => entry.pid))];
  const processDetails = await getProcessDetails(pids);
  const workingDirectories = new Map<number, string | null>();

  await Promise.all(
    pids.map(async (pid) => {
      workingDirectories.set(pid, await getWorkingDirectory(pid));
    }),
  );

  const allPortsByPid = new Map<number, number[]>();
  for (const entry of listeningEntries) {
    const existing = allPortsByPid.get(entry.pid) ?? [];
    existing.push(entry.port);
    allPortsByPid.set(entry.pid, [...new Set(existing)]);
  }

  const groupedByPort = new Map<number, LsofEntry[]>();
  for (const entry of listeningEntries) {
    const current = groupedByPort.get(entry.port) ?? [];
    current.push(entry);
    groupedByPort.set(entry.port, current);
  }

  const records: ProcessRecord[] = [];
  for (const [port, group] of groupedByPort.entries()) {
    const uniquePids = [...new Set(group.map((entry) => entry.pid))];
    const rootPid =
      uniquePids.find((pid) => {
        const parentPid = processDetails.get(pid)?.parentPid;
        return typeof parentPid !== 'number' || !uniquePids.includes(parentPid);
      }) ?? uniquePids[0];

    const details = processDetails.get(rootPid);
    if (!details) {
      continue;
    }

    const processName =
      group.find((entry) => entry.pid === rootPid)?.processName ??
      group[0]?.processName ??
      'unknown';
    const workingDirectory = workingDirectories.get(rootPid) ?? null;
    const classifications = classifyProcess({
      processName,
      command: details.command,
      workingDirectory,
    });
    const reservation = resolveReservation(
      {
        command: details.command,
        processName,
        workingDirectory,
      },
      options.config.reservations,
    );
    const tagKeys = [
      `port:${port}`,
      ...(reservation ? [`matcher:${reservation.matcher.value}`] : []),
    ];
    const tags = [
      ...new Set(
        tagKeys.flatMap((key) => options.config.tags[key] ?? []),
      ),
    ];

    records.push({
      port,
      ports: allPortsByPid.get(rootPid) ?? [port],
      pid: rootPid,
      parentPid: details.parentPid,
      workerCount: Math.max(uniquePids.length - 1, 0),
      processName,
      command: details.command,
      workingDirectory,
      memoryRssKb: details.memoryRssKb,
      cpuPercent: details.cpuPercent,
      protocol: 'TCP',
      startedAt: details.startedAt,
      uptime: details.uptime,
      status: details.status,
      classifications,
      primaryClassification: resolvePrimaryClassification(classifications),
      tags,
      isPortctl: rootPid === options.portctlPid,
      isSystemProcess: classifications.includes('system'),
      canKill: rootPid !== options.portctlPid,
      canSuspend: rootPid !== options.portctlPid,
      logStatus: options.logStore.hasLogs(rootPid)
        ? 'live'
        : 'available-next-restart',
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

  return records;
}
