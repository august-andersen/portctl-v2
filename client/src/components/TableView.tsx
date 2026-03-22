import { useMemo, useState } from 'react';

import type { ProcessGroup } from '@shared/types';

import { formatCpu, formatMemory } from '../utils/format';

interface TableViewProps {
  groups: ProcessGroup[];
  pendingIds: string[];
  onKill: (group: ProcessGroup) => void;
  onMove: (group: ProcessGroup) => void;
  onToggleSuspend: (group: ProcessGroup) => void;
  onPrimaryOpen: (group: ProcessGroup) => void;
  onViewLogs: (group: ProcessGroup) => void;
  onTogglePin: (group: ProcessGroup) => void;
}

type SortKey =
  | 'ports'
  | 'displayName'
  | 'status'
  | 'uptime'
  | 'cpu'
  | 'memory';

export function TableView({
  groups,
  pendingIds,
  onKill,
  onMove,
  onToggleSuspend,
  onPrimaryOpen,
  onViewLogs,
  onTogglePin,
}: TableViewProps): JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>('ports');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const sortedGroups = useMemo(() => {
    const sorted = [...groups];
    sorted.sort((left, right) => {
      const factor = sortDirection === 'asc' ? 1 : -1;

      switch (sortKey) {
        case 'ports':
          return ((left.ports[0] ?? 0) - (right.ports[0] ?? 0)) * factor;
        case 'displayName':
          return left.displayName.localeCompare(right.displayName) * factor;
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
  }, [groups, sortDirection, sortKey]);

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
              <button className="ghost-button" onClick={() => toggleSort('ports')} type="button">
                Ports
              </button>
            </th>
            <th>
              <button
                className="ghost-button"
                onClick={() => toggleSort('displayName')}
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
          {sortedGroups.map((group) => (
            <tr key={group.id}>
              <td>{group.ports.map((port) => `:${port}`).join(', ')}</td>
              <td>
                <strong>{group.displayName}</strong>
                <div className="muted">{group.primaryClassification}</div>
              </td>
              <td>{group.pid || '--'}</td>
              <td>{group.status}</td>
              <td>{group.uptime ?? 'n/a'}</td>
              <td>{formatCpu(group.cpuPercent)}</td>
              <td>{formatMemory(group.memoryRssKb)}</td>
              <td>
                <div className="badges">
                  {group.tags.map((tag) => (
                    <span className="badge" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              </td>
              <td>
                <div className="table-actions">
                  {group.status !== 'empty' ? (
                    <>
                      <button
                        className="ghost-button"
                        onClick={() => {
                          onPrimaryOpen(group);
                        }}
                        type="button"
                      >
                        Open
                      </button>
                      <button
                        className="ghost-button"
                        disabled={pendingIds.includes(group.id)}
                        onClick={() => {
                          onViewLogs(group);
                        }}
                        type="button"
                      >
                        Logs
                      </button>
                      <button
                        className="ghost-button"
                        disabled={pendingIds.includes(group.id)}
                        onClick={() => {
                          onMove(group);
                        }}
                        type="button"
                      >
                        Move
                      </button>
                      <button
                        className="ghost-button"
                        disabled={pendingIds.includes(group.id)}
                        onClick={() => {
                          onToggleSuspend(group);
                        }}
                        type="button"
                      >
                        {group.status === 'suspended' ? 'Resume' : 'Suspend'}
                      </button>
                      <button
                        className="danger-button"
                        disabled={pendingIds.includes(group.id)}
                        onClick={() => {
                          onKill(group);
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
                      onTogglePin(group);
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
