import { useEffect, useRef, useState } from 'react';

import { CSS } from '@dnd-kit/utilities';
import { useSortable } from '@dnd-kit/sortable';

import type { ActionResponse, ProcessGroup } from '@shared/types';

import { Popover } from './Popover';
import { formatCpu, formatMemory } from '../utils/format';

export interface CardActionHandlers {
  onPrimaryOpen: (group: ProcessGroup) => void;
  onKill: (group: ProcessGroup) => void;
  onMove: (group: ProcessGroup, targetPort: number) => Promise<ActionResponse>;
  onOpenMoveModal: (group: ProcessGroup) => void;
  onTogglePin: (group: ProcessGroup) => void;
  onToggleSuspend: (group: ProcessGroup) => void;
  onViewLogs: (group: ProcessGroup) => void;
  onReserve: (group: ProcessGroup) => void;
  onEditTags: (group: ProcessGroup) => void;
  onEditCommand: (group: ProcessGroup) => void;
  onRename: (group: ProcessGroup, nextName: string) => Promise<void>;
  onToggleHidden: (group: ProcessGroup) => Promise<void>;
  onStart: (group: ProcessGroup) => void;
  onTagClick: (tag: string) => void;
}

interface ProcessCardProps extends CardActionHandlers {
  group: ProcessGroup;
  isPinned: boolean;
  canStart: boolean;
  isPending: boolean;
  compact?: boolean;
}

function statusClass(status: ProcessGroup['status']): string {
  switch (status) {
    case 'running':
      return 'status-running';
    case 'suspended':
      return 'status-suspended';
    case 'error':
      return 'status-error';
    case 'empty':
      return 'status-empty';
  }
}

export function ProcessCard({
  group,
  isPinned,
  canStart,
  isPending,
  compact = false,
  onPrimaryOpen,
  onKill,
  onMove,
  onOpenMoveModal,
  onTogglePin,
  onToggleSuspend,
  onViewLogs,
  onReserve,
  onEditTags,
  onEditCommand,
  onRename,
  onToggleHidden,
  onStart,
  onTagClick,
}: ProcessCardProps): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: group.id,
    });
  const [menuOpen, setMenuOpen] = useState(false);
  const [killOpen, setKillOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(group.displayName);
  const [switchPort, setSwitchPort] = useState(`${group.primaryProcess.port}`);
  const killButtonRef = useRef<HTMLButtonElement | null>(null);
  const switchButtonRef = useRef<HTMLButtonElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (renaming) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renaming]);

  const groupedPorts = group.ports.map((port) => `:${port}`).join(' ');
  const processCountLabel =
    group.processes.length > 1 ? `${group.processes.length} grouped` : 'single process';

  const submitRename = (): void => {
    const trimmed = renameValue.trim();
    void onRename(group, trimmed).finally(() => {
      setRenaming(false);
    });
  };

  const submitMove = (): void => {
    const targetPort = Number.parseInt(switchPort, 10);
    if (!Number.isInteger(targetPort)) {
      return;
    }

    void onMove(group, targetPort).then((response) => {
      if (response.ok) {
        setSwitchOpen(false);
        return;
      }

      if (response.conflict) {
        setSwitchOpen(false);
        onOpenMoveModal(group);
      }
    });
  };

  return (
    <article
      className={`card ${compact ? 'card-compact' : ''} ${isDragging ? 'dragging' : ''}`}
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      <div className="card-top">
        <div className="port-pill">
          <span className="drag-handle" {...attributes} {...listeners}>
            |||
          </span>
          <span>{groupedPorts}</span>
        </div>
        <div className="helper-row">
          <span className={`status-dot ${statusClass(group.status)}`} />
          <span className="muted">{group.status}</span>
        </div>
      </div>

      <button
        className="ghost-button"
        onClick={() => {
          if (group.status !== 'empty') {
            onPrimaryOpen(group);
          }
        }}
        style={{ padding: 0, textAlign: 'left' }}
        type="button"
      >
        <div className="card-title-row">
          {renaming ? (
            <input
              className="app-input"
              onBlur={submitRename}
              onChange={(event) => {
                setRenameValue(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  submitRename();
                }
                if (event.key === 'Escape') {
                  setRenaming(false);
                  setRenameValue(group.displayName);
                }
              }}
              ref={renameInputRef}
              value={renameValue}
            />
          ) : (
            <h3
              onDoubleClick={() => {
                setRenameValue(group.displayName);
                setRenaming(true);
              }}
              title={group.displayName}
            >
              {group.displayName}
            </h3>
          )}
          <span className="muted">PID {group.pid || '--'}</span>
        </div>

        {group.status === 'empty' ? (
          <div className="empty-state">
            <div className="muted">No active process</div>
            {group.primaryProcess.reservation ? (
              <div className="subtle">
                Reserved for{' '}
                {group.primaryProcess.reservation.label ??
                  group.primaryProcess.reservation.matcher.value}
              </div>
            ) : (
              <div className="subtle">Pinned slot ready for a command template.</div>
            )}
          </div>
        ) : (
          <>
            {!compact ? (
              <div className="muted">
                {group.uptime ?? 'uptime unavailable'} • {processCountLabel}
              </div>
            ) : (
              <div className="muted">{processCountLabel}</div>
            )}
            <div className="card-meta">
              <span>CPU {formatCpu(group.cpuPercent)}</span>
              <span>MEM {formatMemory(group.memoryRssKb)}</span>
              <span>{group.primaryClassification}</span>
            </div>
          </>
        )}
      </button>

      <div className="badges">
        {group.tags.map((tag) => (
          <button
            className="badge tag"
            key={tag}
            onClick={() => {
              onTagClick(tag);
            }}
            type="button"
          >
            {tag}
          </button>
        ))}
        {group.isPortctl ? <span className="badge">portctl</span> : null}
        {group.isSystemGroup ? <span className="badge">system</span> : null}
        {group.primaryProcess.reservation ? <span className="badge">reserved</span> : null}
      </div>

      <div className="actions-row">
        {group.status === 'empty' ? (
          <>
            <button
              className="secondary-button"
              onClick={() => {
                onTogglePin(group);
              }}
              type="button"
            >
              {isPinned ? 'Unpin' : 'Pin'}
            </button>
            <button
              className="primary-button"
              disabled={!canStart || isPending}
              onClick={() => {
                onStart(group);
              }}
              type="button"
            >
              Start
            </button>
          </>
        ) : (
          <>
            <div className="popover-anchor">
              <button
                className="danger-button"
                disabled={!group.primaryProcess.canKill || isPending}
                onClick={() => {
                  setKillOpen((current) => !current);
                  setSwitchOpen(false);
                }}
                ref={killButtonRef}
                type="button"
              >
                Kill
              </button>
              <Popover
                anchorRef={killButtonRef}
                onClose={() => {
                  setKillOpen(false);
                }}
                open={killOpen}
              >
                <div className="popover-panel">
                  <strong>Kill {group.displayName}?</strong>
                  <div className="muted">This targets PID {group.pid}.</div>
                  <div className="helper-row">
                    <button
                      className="danger-button"
                      onClick={() => {
                        setKillOpen(false);
                        onKill(group);
                      }}
                      type="button"
                    >
                      Confirm kill
                    </button>
                    <button
                      className="ghost-button"
                      onClick={() => {
                        setKillOpen(false);
                      }}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </Popover>
            </div>

            <div className="popover-anchor">
              <button
                className="secondary-button"
                disabled={isPending}
                onClick={() => {
                  setSwitchOpen((current) => !current);
                  setKillOpen(false);
                }}
                ref={switchButtonRef}
                type="button"
              >
                Switch Port
              </button>
              <Popover
                align="right"
                anchorRef={switchButtonRef}
                onClose={() => {
                  setSwitchOpen(false);
                }}
                open={switchOpen}
              >
                <div className="popover-panel">
                  <strong>Move primary process</strong>
                  <div className="muted">
                    Current primary port {group.primaryProcess.port}
                  </div>
                  <input
                    className="app-input"
                    inputMode="numeric"
                    onChange={(event) => {
                      setSwitchPort(event.target.value);
                    }}
                    value={switchPort}
                  />
                  <div className="helper-row">
                    <button className="primary-button" onClick={submitMove} type="button">
                      Move
                    </button>
                    <button
                      className="ghost-button"
                      onClick={() => {
                        setSwitchOpen(false);
                      }}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </Popover>
            </div>

            <button
              className="secondary-button"
              onClick={() => {
                onTogglePin(group);
              }}
              type="button"
            >
              {isPinned ? 'Unpin' : 'Pin'}
            </button>
          </>
        )}

        <div className="menu">
          <button
            className="ghost-button"
            disabled={isPending}
            onClick={() => {
              setMenuOpen((current) => !current);
            }}
            type="button"
          >
            ...
          </button>
          {menuOpen ? (
            <div className="menu-popover">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  if (group.status === 'empty') {
                    onEditCommand(group);
                    return;
                  }
                  onViewLogs(group);
                }}
                type="button"
              >
                {group.status === 'empty' ? 'Edit Restart Command' : 'View Logs'}
              </button>
              {group.status !== 'empty' ? (
                <>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onPrimaryOpen(group);
                    }}
                    type="button"
                  >
                    Open in Browser
                  </button>
                  <button
                    disabled={!group.primaryProcess.canSuspend}
                    onClick={() => {
                      setMenuOpen(false);
                      onToggleSuspend(group);
                    }}
                    type="button"
                  >
                    {group.status === 'suspended' ? 'Resume' : 'Suspend'}
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onReserve(group);
                    }}
                    type="button"
                  >
                    Reserve Port
                  </button>
                </>
              ) : null}
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onEditTags(group);
                }}
                type="button"
              >
                Edit Tags
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setRenameValue(group.displayName);
                  setRenaming(true);
                }}
                type="button"
              >
                Rename
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  void onToggleHidden(group);
                }}
                type="button"
              >
                {group.isHidden ? 'Unhide' : 'Hide'}
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onEditCommand(group);
                }}
                type="button"
              >
                Edit Restart Command
              </button>
              {group.pid > 0 ? (
                <>
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(`${group.pid}`);
                      setMenuOpen(false);
                    }}
                    type="button"
                  >
                    Copy PID
                  </button>
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(group.primaryProcess.command);
                      setMenuOpen(false);
                    }}
                    type="button"
                  >
                    Copy Command
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
