export type ViewMode = 'card' | 'table';
export type ThemeMode = 'dark' | 'light';
export type CardClickBehavior = 'openBrowser' | 'openLogs';
export type ProcessStatus = 'running' | 'suspended' | 'empty' | 'error';
export type ProcessType = 'web' | 'api' | 'database' | 'system' | 'other';
export type MatcherType =
  | 'command_contains'
  | 'process_name'
  | 'working_directory'
  | 'regex';
export type LogStatus = 'live' | 'available-next-restart';
export type EventLevel = 'success' | 'error' | 'info' | 'warning';
export type ConflictStrategy =
  | 'swap'
  | 'moveOccupier'
  | 'killOccupier'
  | 'cancel';

export interface Settings {
  dashboardPort: number;
  pollingInterval: number;
  defaultView: ViewMode;
  theme: ThemeMode;
  cardClickBehavior: CardClickBehavior;
  logBufferSize: number;
}

export interface ReservationMatcher {
  type: MatcherType;
  value: string;
}

export interface Reservation {
  port: number;
  matcher: ReservationMatcher;
  restartTemplate: string | null;
  label: string | null;
}

export interface PortctlConfig {
  version: number;
  settings: Settings;
  reservations: Reservation[];
  blockedPorts: number[];
  pinnedPorts: number[];
  tags: Record<string, string[]>;
  cardOrder: number[];
  customRestartCommands: Record<string, string>;
}

export interface PortReservationSummary {
  label: string | null;
  matcher: ReservationMatcher;
  port: number;
}

export interface ProcessRecord {
  port: number;
  ports: number[];
  pid: number;
  parentPid: number | null;
  workerCount: number;
  processName: string;
  command: string;
  workingDirectory: string | null;
  memoryRssKb: number | null;
  cpuPercent: number | null;
  protocol: 'TCP';
  startedAt: string | null;
  uptime: string | null;
  status: ProcessStatus;
  classifications: ProcessType[];
  primaryClassification: ProcessType;
  tags: string[];
  isPortctl: boolean;
  isSystemProcess: boolean;
  canKill: boolean;
  canSuspend: boolean;
  logStatus: LogStatus;
  reservation: PortReservationSummary | null;
  lastError: string | null;
}

export interface DashboardSnapshot {
  updatedAt: string;
  pollFailures: number;
  banner: string | null;
  processes: ProcessRecord[];
}

export interface LogEntry {
  id: number;
  pid: number;
  stream: 'stdout' | 'stderr' | 'system';
  line: string;
  createdAt: string;
}

export interface ProcessLogsResponse {
  pid: number;
  entries: LogEntry[];
  truncated: boolean;
}

export interface EventRecord {
  id: number;
  level: EventLevel;
  title: string;
  message: string;
  createdAt: string;
}

export interface StatusResponse {
  ok: boolean;
  pid: number | null;
  url: string;
  startedAt: string | null;
  uptime: string | null;
  version: string;
}

export interface MoveProcessRequest {
  targetPort: number;
  conflictStrategy?: ConflictStrategy;
  alternativePort?: number;
}

export interface MoveConflict {
  occupiedBy: ProcessRecord;
  requestedPort: number;
}

export interface ActionResponse {
  ok: boolean;
  message: string;
  nextPid?: number;
  conflict?: MoveConflict;
}

export const CONFIG_VERSION = 1;
export const DEFAULT_CONFIG: PortctlConfig = {
  version: CONFIG_VERSION,
  settings: {
    dashboardPort: 47777,
    pollingInterval: 1000,
    defaultView: 'card',
    theme: 'dark',
    cardClickBehavior: 'openBrowser',
    logBufferSize: 10000
  },
  reservations: [],
  blockedPorts: [],
  pinnedPorts: [],
  tags: {},
  cardOrder: [],
  customRestartCommands: {}
};
