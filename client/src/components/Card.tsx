import { useState } from 'react';

import { CSS } from '@dnd-kit/utilities';
import { useSortable } from '@dnd-kit/sortable';

import type { ProcessRecord } from '@shared/types';

import { formatCpu, formatMemory } from '../utils/format';

export interface CardActionHandlers {
  onPrimaryOpen: (processRecord: ProcessRecord) => void;
  onKill: (processRecord: ProcessRecord) => void;
  onMove: (processRecord: ProcessRecord) => void;
  onTogglePin: (processRecord: ProcessRecord) => void;
  onToggleSuspend: (processRecord: ProcessRecord) => void;
  onViewLogs: (processRecord: ProcessRecord) => void;
  onReserve: (processRecord: ProcessRecord) => void;
  onEditTags: (processRecord: ProcessRecord) => void;
  onEditCommand: (processRecord: ProcessRecord) => void;
  onStart: (processRecord: ProcessRecord) => void;
  onTagClick: (tag: string) => void;
}

interface ProcessCardProps extends CardActionHandlers {
  processRecord: ProcessRecord;
  isPinned: boolean;
  canStart: boolean;
  isPending: boolean;
}

function statusClass(status: ProcessRecord['status']): string {
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
  processRecord,
  isPinned,
  canStart,
  isPending,
  onPrimaryOpen,
  onKill,
  onMove,
  onTogglePin,
  onToggleSuspend,
  onViewLogs,
  onReserve,
  onEditTags,
  onEditCommand,
  onStart,
  onTagClick,
}: ProcessCardProps): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: processRecord.port,
    });
  const [showKillConfirm, setShowKillConfirm] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <article
      className={`card ${isDragging ? 'dragging' : ''}`}
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
          <span>:{processRecord.port}</span>
        </div>
        <div className="helper-row">
          <span className={`status-dot ${statusClass(processRecord.status)}`} />
          <span className="muted">
            {processRecord.status === 'empty' ? 'empty' : processRecord.status}
          </span>
        </div>
      </div>

      <button
        className="ghost-button"
        onClick={() => {
          if (processRecord.status !== 'empty') {
            onPrimaryOpen(processRecord);
          }
        }}
        style={{ padding: 0, textAlign: 'left' }}
        type="button"
      >
        <div className="card-title-row">
          <h3 title={processRecord.processName}>{processRecord.processName}</h3>
          <span className="muted">PID {processRecord.pid || '--'}</span>
        </div>

        {processRecord.status === 'empty' ? (
          <div className="empty-state">
            <div className="muted">No active process</div>
            {processRecord.reservation ? (
              <div className="subtle">
                Reserved for {processRecord.reservation.label ?? processRecord.reservation.matcher.value}
              </div>
            ) : (
              <div className="subtle">Pin a command template to start something here later.</div>
            )}
          </div>
        ) : (
          <>
            <div className="muted">{processRecord.uptime ?? 'uptime unavailable'}</div>
            <div className="card-meta">
              <span>CPU {formatCpu(processRecord.cpuPercent)}</span>
              <span>MEM {formatMemory(processRecord.memoryRssKb)}</span>
              <span>{processRecord.primaryClassification}</span>
              {processRecord.workerCount > 0 ? (
                <span>{processRecord.workerCount} workers</span>
              ) : null}
            </div>
          </>
        )}
      </button>

      <div className="badges">
        {processRecord.tags.map((tag) => (
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
        {processRecord.isPortctl ? <span className="badge">portctl</span> : null}
        {processRecord.isSystemProcess ? <span className="badge">system</span> : null}
        {processRecord.reservation ? <span className="badge">reserved</span> : null}
      </div>

      {showKillConfirm ? (
        <div className="section-block">
          <strong>Kill {processRecord.processName}?</strong>
          <div className="helper-row">
            <button
              className="danger-button"
              disabled={isPending}
              onClick={() => {
                setShowKillConfirm(false);
                onKill(processRecord);
              }}
              type="button"
            >
              Confirm kill
            </button>
            <button
              className="ghost-button"
              onClick={() => {
                setShowKillConfirm(false);
              }}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="actions-row">
        {processRecord.status === 'empty' ? (
          <>
            <button
              className="secondary-button"
              onClick={() => {
                onTogglePin(processRecord);
              }}
              type="button"
            >
              {isPinned ? 'Unpin' : 'Pin'}
            </button>
            <button
              className="primary-button"
              disabled={!canStart || isPending}
              onClick={() => {
                onStart(processRecord);
              }}
              type="button"
            >
              Start
            </button>
          </>
        ) : (
          <>
            <button
              className="danger-button"
              disabled={!processRecord.canKill || isPending}
              onClick={() => {
                setShowKillConfirm(true);
              }}
              type="button"
            >
              Kill
            </button>
            <button
              className="secondary-button"
              disabled={isPending}
              onClick={() => {
                onMove(processRecord);
              }}
              type="button"
            >
              Switch Port
            </button>
            <button
              className="secondary-button"
              onClick={() => {
                onTogglePin(processRecord);
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
            More
          </button>
          {menuOpen ? (
            <div className="menu-popover">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  if (processRecord.status === 'empty') {
                    onEditCommand(processRecord);
                    return;
                  }
                  onViewLogs(processRecord);
                }}
                type="button"
              >
                {processRecord.status === 'empty' ? 'Edit restart command' : 'View logs'}
              </button>
              {processRecord.status !== 'empty' ? (
                <>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onPrimaryOpen(processRecord);
                    }}
                    type="button"
                  >
                    Open target
                  </button>
                  <button
                    disabled={!processRecord.canSuspend}
                    onClick={() => {
                      setMenuOpen(false);
                      onToggleSuspend(processRecord);
                    }}
                    type="button"
                  >
                    {processRecord.status === 'suspended' ? 'Resume' : 'Suspend'}
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onReserve(processRecord);
                    }}
                    type="button"
                  >
                    Reserve port
                  </button>
                </>
              ) : null}
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onEditTags(processRecord);
                }}
                type="button"
              >
                Edit tags
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onEditCommand(processRecord);
                }}
                type="button"
              >
                Edit restart command
              </button>
              {processRecord.pid > 0 ? (
                <>
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(`${processRecord.pid}`);
                      setMenuOpen(false);
                    }}
                    type="button"
                  >
                    Copy PID
                  </button>
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(processRecord.command);
                      setMenuOpen(false);
                    }}
                    type="button"
                  >
                    Copy command
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
