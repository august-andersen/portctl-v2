import type { ChildProcess } from 'node:child_process';

import type { LogEntry, ProcessLogsResponse } from '../shared/types';

interface LogBuffer {
  entries: LogEntry[];
  nextId: number;
  truncated: boolean;
}

function splitLines(chunk: string): string[] {
  return chunk.replace(/\r\n/g, '\n').split('\n').filter((line) => line.length > 0);
}

export class LogStore {
  private readonly buffers = new Map<number, LogBuffer>();

  public constructor(private readonly getMaxBufferSize: () => number) {}

  public attachChildProcess(
    child: ChildProcess,
    metadata: { pid: number; processName: string; port: number },
  ): void {
    const pid = metadata.pid;
    this.recordSystemLine(
      pid,
      `${metadata.processName} started on port ${metadata.port}`,
    );

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      for (const line of splitLines(chunk)) {
        this.pushEntry(pid, 'stdout', line);
      }
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      for (const line of splitLines(chunk)) {
        this.pushEntry(pid, 'stderr', line);
      }
    });

    child.on('exit', (code, signal) => {
      this.recordSystemLine(
        pid,
        `Process exited${signal ? ` with ${signal}` : ''}${
          code !== null ? ` (code ${code})` : ''
        }`,
      );
    });
  }

  public hasLogs(pid: number): boolean {
    return this.buffers.has(pid);
  }

  public recordSystemLine(pid: number, line: string): void {
    this.pushEntry(pid, 'system', line);
  }

  public getLogs(pid: number): ProcessLogsResponse {
    const buffer = this.buffers.get(pid);
    return {
      pid,
      entries: buffer?.entries ?? [],
      truncated: buffer?.truncated ?? false,
    };
  }

  public clear(pid: number): void {
    const existing = this.buffers.get(pid);
    if (!existing) {
      return;
    }

    existing.entries = [];
    existing.truncated = false;
  }

  public cleanup(pid: number): void {
    this.buffers.delete(pid);
  }

  private pushEntry(pid: number, stream: LogEntry['stream'], line: string): void {
    const buffer = this.getOrCreateBuffer(pid);
    const entry: LogEntry = {
      id: buffer.nextId,
      pid,
      stream,
      line,
      createdAt: new Date().toISOString(),
    };

    buffer.entries.push(entry);
    buffer.nextId += 1;

    const maxSize = this.getMaxBufferSize();
    if (buffer.entries.length > maxSize) {
      buffer.entries.splice(0, buffer.entries.length - maxSize);
      buffer.truncated = true;
    }
  }

  private getOrCreateBuffer(pid: number): LogBuffer {
    const existing = this.buffers.get(pid);
    if (existing) {
      return existing;
    }

    const created: LogBuffer = {
      entries: [],
      nextId: 1,
      truncated: false,
    };
    this.buffers.set(pid, created);
    return created;
  }
}
