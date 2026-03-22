import { useState } from 'react';

import type { MatcherType, ProcessRecord, Reservation } from '@shared/types';

interface ReserveModalProps {
  processRecord: ProcessRecord;
  onClose: () => void;
  onSave: (reservation: Reservation) => Promise<void>;
}

const MATCHER_OPTIONS: MatcherType[] = [
  'command_contains',
  'process_name',
  'working_directory',
  'regex',
];

export function ReserveModal({
  processRecord,
  onClose,
  onSave,
}: ReserveModalProps): JSX.Element {
  const [matcherType, setMatcherType] = useState<MatcherType>(
    processRecord.reservation?.matcher.type ?? 'command_contains',
  );
  const [matcherValue, setMatcherValue] = useState(
    processRecord.reservation?.matcher.value ??
      processRecord.processName ??
      processRecord.command,
  );
  const [label, setLabel] = useState(
    processRecord.reservation?.label ?? processRecord.processName,
  );
  const [restartTemplate, setRestartTemplate] = useState('');
  const [saving, setSaving] = useState(false);

  return (
    <div className="overlay" role="presentation">
      <div className="modal modal-small">
        <div className="modal-header">
          <div>
            <h3>Reserve Port {processRecord.port}</h3>
            <div className="muted">
              Save how portctl should recognize this process later.
            </div>
          </div>
          <button className="backdrop-close" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="form-grid">
          <div className="field">
            <label htmlFor="matcher-type">Matcher type</label>
            <select
              className="app-select"
              id="matcher-type"
              value={matcherType}
              onChange={(event) => {
                setMatcherType(event.target.value as MatcherType);
              }}
            >
              {MATCHER_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="matcher-value">Matcher value</label>
            <input
              className="app-input"
              id="matcher-value"
              value={matcherValue}
              onChange={(event) => {
                setMatcherValue(event.target.value);
              }}
            />
          </div>

          <div className="field">
            <label htmlFor="reservation-label">Label</label>
            <input
              className="app-input"
              id="reservation-label"
              value={label}
              onChange={(event) => {
                setLabel(event.target.value);
              }}
            />
          </div>

          <div className="field">
            <label htmlFor="restart-template">Custom restart command</label>
            <textarea
              className="app-textarea"
              id="restart-template"
              placeholder="Optional. Use {{PORT}} where the target port belongs."
              rows={4}
              value={restartTemplate}
              onChange={(event) => {
                setRestartTemplate(event.target.value);
              }}
            />
          </div>

          <div className="helper-row">
            <button
              className="primary-button"
              disabled={saving || matcherValue.trim().length === 0}
              onClick={() => {
                setSaving(true);
                void onSave({
                  port: processRecord.port,
                  matcher: {
                    type: matcherType,
                    value: matcherValue,
                  },
                  label: label.trim() || null,
                  restartTemplate: restartTemplate.trim() || null,
                }).finally(() => {
                  setSaving(false);
                  onClose();
                });
              }}
              type="button"
            >
              {saving ? 'Saving...' : 'Reserve'}
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
