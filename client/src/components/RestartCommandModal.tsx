import { useState } from 'react';

interface RestartCommandModalProps {
  port: number;
  initialValue: string;
  onClose: () => void;
  onSave: (command: string) => Promise<void>;
}

export function RestartCommandModal({
  port,
  initialValue,
  onClose,
  onSave,
}: RestartCommandModalProps): JSX.Element {
  const [command, setCommand] = useState(initialValue);
  const [saving, setSaving] = useState(false);

  return (
    <div className="overlay" role="presentation">
      <div className="modal modal-small">
        <div className="modal-header">
          <div>
            <h3>Restart Command</h3>
            <div className="muted">
              Save a custom template for port {port}. Use {'{{PORT}}'} as the placeholder.
            </div>
          </div>
          <button className="backdrop-close" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="form-grid">
          <textarea
            className="app-textarea"
            rows={6}
            value={command}
            onChange={(event) => {
              setCommand(event.target.value);
            }}
          />

          <div className="helper-row">
            <button
              className="primary-button"
              disabled={saving}
              onClick={() => {
                setSaving(true);
                void onSave(command).finally(() => {
                  setSaving(false);
                  onClose();
                });
              }}
              type="button"
            >
              {saving ? 'Saving...' : 'Save'}
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
