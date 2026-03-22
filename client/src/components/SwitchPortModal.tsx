import { useState } from 'react';

import type { ActionResponse, ProcessRecord } from '@shared/types';

interface SwitchPortModalProps {
  processRecord: ProcessRecord;
  onClose: () => void;
  onMove: (
    targetPort: number,
    options?: {
      conflictStrategy?: 'swap' | 'moveOccupier' | 'killOccupier' | 'cancel';
      alternativePort?: number;
    },
  ) => Promise<ActionResponse>;
}

export function SwitchPortModal({
  processRecord,
  onClose,
  onMove,
}: SwitchPortModalProps): JSX.Element {
  const [targetPort, setTargetPort] = useState(`${processRecord.port}`);
  const [alternativePort, setAlternativePort] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [conflict, setConflict] = useState<ActionResponse['conflict'] | null>(null);

  const submitMove = async (
    options?: Parameters<SwitchPortModalProps['onMove']>[1],
  ): Promise<void> => {
    setSubmitting(true);
    try {
      const response = await onMove(Number.parseInt(targetPort, 10), options);
      if (response.conflict) {
        setConflict(response.conflict);
        return;
      }

      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="overlay" role="presentation">
      <div className="modal modal-small">
        <div className="modal-header">
          <div>
            <h3>Switch Port</h3>
            <div className="muted">
              Move {processRecord.processName} from {processRecord.port}
            </div>
          </div>
          <button className="backdrop-close" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="form-grid">
          <div className="field">
            <label htmlFor="target-port">Target port</label>
            <input
              className="app-input"
              id="target-port"
              inputMode="numeric"
              value={targetPort}
              onChange={(event) => {
                setTargetPort(event.target.value);
              }}
            />
          </div>

          {conflict ? (
            <div className="section-block">
              <strong>
                Port {conflict.requestedPort} is occupied by {conflict.occupiedBy.processName}
              </strong>
              <div className="muted">Choose how portctl should resolve the conflict.</div>
              <div className="helper-row">
                <button
                  className="primary-button"
                  disabled={submitting}
                  onClick={() => {
                    void submitMove({ conflictStrategy: 'swap' });
                  }}
                  type="button"
                >
                  Swap ports
                </button>
                <button
                  className="secondary-button"
                  disabled={submitting}
                  onClick={() => {
                    void submitMove({ conflictStrategy: 'killOccupier' });
                  }}
                  type="button"
                >
                  Kill existing
                </button>
              </div>
              <div className="helper-row">
                <input
                  className="app-input"
                  inputMode="numeric"
                  placeholder="Move existing process to..."
                  value={alternativePort}
                  onChange={(event) => {
                    setAlternativePort(event.target.value);
                  }}
                />
                <button
                  className="secondary-button"
                  disabled={submitting || alternativePort.trim().length === 0}
                  onClick={() => {
                    void submitMove({
                      conflictStrategy: 'moveOccupier',
                      alternativePort: Number.parseInt(alternativePort, 10),
                    });
                  }}
                  type="button"
                >
                  Move existing
                </button>
              </div>
            </div>
          ) : null}

          <div className="helper-row">
            <button
              className="primary-button"
              disabled={submitting}
              onClick={() => {
                void submitMove();
              }}
              type="button"
            >
              {submitting ? 'Moving...' : 'Switch'}
            </button>
            <button className="ghost-button" onClick={onClose} type="button">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
