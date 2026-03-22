import { useMemo, useState } from 'react';

import type { ProcessRecord } from '@shared/types';

import { formatCpu, formatMemory } from '../utils/format';

interface TableViewProps {
  processes: ProcessRecord[];
  pendingPorts: number[];
  onKill: (processRecord: ProcessRecord) => void;
  onMove: (processRecord: ProcessRecord) => void;
  onToggleSuspend: (processRecord: ProcessRecord) => void;
  onPrimaryOpen: (processRecord: ProcessRecord) => void;
  onViewLogs: (processRecord: ProcessRecord) => void;
  onTogglePin: (processRecord: ProcessRecord) => void;
}

type SortKey =
  | 'port'
  | 'processName'
  | 'status'
  | 'uptime'
  | 'cpu'
  | 'memory';

export function TableView({
  processes,
  pendingPorts,
  onKill,
  onMove,
  onToggleSuspend,
  onPrimaryOpen,
  onViewLogs,
  onTogglePin,
}: TableViewProps): JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>('port');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const sortedProcesses = useMemo(() => {
    const sorted = [...processes];
    sorted.sort((left, right) => {
      const factor = sortDirection === 'asc' ? 1 : -1;

      switch (sortKey) {
        case 'port':
          return (left.port - right.port) * factor;
        case 'processName':
          return left.processName.localeCompare(right.processName) * factor;
        case 'status':
          return left.status.localeCompare(right.status) * factor;
        case 'uptime':
          return (left.uptime ?? '').localeCompare(right.uptime ?? '') * factor;
        case 'cpu':
          return ((left.cpuPercent ?? 0) - (right.cpuPercent ?? 0)) * factor;
        case 'memory':
          return ((left.memoryRssKb ?? 0) - (right.memoryRssKb ?? 0)) * factor;
      }
    });
    return sorted;
  }, [processes, sortDirection, sortKey]);

  const toggleSort = (nextKey: SortKey): void => {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortKey(nextKey);
    setSortDirection('asc');
  };

  return (
    <div className="table-shell">
      <table className="process-table">
        <thead>
          <tr>
            <th>
              <button className="ghost-button" onClick={() => toggleSort('port')} type="button">
                Port
              </button>
            </th>
            <th>
              <button
                className="ghost-button"
                onClick={() => toggleSort('processName')}
                type="button"
              >
                Process
              </button>
            </th>
            <th>PID</th>
            <th>
              <button className="ghost-button" onClick={() => toggleSort('status')} type="button">
                Status
              </button>
            </th>
            <th>
              <button className="ghost-button" onClick={() => toggleSort('uptime')} type="button">
                Uptime
              </button>
            </th>
            <th>
              <button className="ghost-button" onClick={() => toggleSort('cpu')} type="button">
                CPU
              </button>
            </th>
            <th>
              <button className="ghost-button" onClick={() => toggleSort('memory')} type="button">
                Memory
              </button>
            </th>
            <th>Tags</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {sortedProcesses.map((processRecord) => (
            <tr key={processRecord.port}>
              <td>:{processRecord.port}</td>
              <td>
                <strong>{processRecord.processName}</strong>
                <div className="muted">{processRecord.primaryClassification}</div>
              </td>
              <td>{processRecord.pid || '--'}</td>
              <td>{processRecord.status}</td>
              <td>{processRecord.uptime ?? 'n/a'}</td>
              <td>{formatCpu(processRecord.cpuPercent)}</td>
              <td>{formatMemory(processRecord.memoryRssKb)}</td>
              <td>
                <div className="badges">
                  {processRecord.tags.map((tag) => (
                    <span className="badge" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              </td>
              <td>
                <div className="table-actions">
                  {processRecord.status !== 'empty' ? (
                    <>
                      <button
                        className="ghost-button"
                        onClick={() => {
                          onPrimaryOpen(processRecord);
                        }}
                        type="button"
                      >
                        Open
                      </button>
                      <button
                        className="ghost-button"
                        disabled={pendingPorts.includes(processRecord.port)}
                        onClick={() => {
                          onViewLogs(processRecord);
                        }}
                        type="button"
                      >
                        Logs
                      </button>
                      <button
                        className="ghost-button"
                        disabled={pendingPorts.includes(processRecord.port)}
                        onClick={() => {
                          onMove(processRecord);
                        }}
                        type="button"
                      >
                        Move
                      </button>
                      <button
                        className="ghost-button"
                        disabled={pendingPorts.includes(processRecord.port)}
                        onClick={() => {
                          onToggleSuspend(processRecord);
                        }}
                        type="button"
                      >
                        {processRecord.status === 'suspended' ? 'Resume' : 'Suspend'}
                      </button>
                      <button
                        className="danger-button"
                        disabled={pendingPorts.includes(processRecord.port)}
                        onClick={() => {
                          onKill(processRecord);
                        }}
                        type="button"
                      >
                        Kill
                      </button>
                    </>
                  ) : null}
                  <button
                    className="ghost-button"
                    onClick={() => {
                      onTogglePin(processRecord);
                    }}
                    type="button"
                  >
                    Pin
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
