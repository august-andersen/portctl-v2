import { useMemo, useState } from 'react';

import type { ProcessRecord } from '@shared/types';

interface TagEditorProps {
  processRecord: ProcessRecord;
  onClose: () => void;
  onSave: (tags: string[]) => Promise<void>;
}

export function TagEditor({
  processRecord,
  onClose,
  onSave,
}: TagEditorProps): JSX.Element {
  const [tags, setTags] = useState<string[]>(processRecord.tags);
  const [draft, setDraft] = useState('');

  const normalizedTags = useMemo(
    () => [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))],
    [tags],
  );

  return (
    <div className="overlay" role="presentation">
      <div className="modal modal-small">
        <div className="modal-header">
          <div>
            <h3>Edit Tags</h3>
            <div className="muted">
              Port {processRecord.port} • {processRecord.processName}
            </div>
          </div>
          <button className="backdrop-close" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="form-grid">
          <div className="badges">
            {normalizedTags.length === 0 ? (
              <span className="muted">No tags yet.</span>
            ) : (
              normalizedTags.map((tag) => (
                <button
                  key={tag}
                  className="badge tag"
                  onClick={() => {
                    setTags((current) => current.filter((item) => item !== tag));
                  }}
                  type="button"
                >
                  {tag} x
                </button>
              ))
            )}
          </div>

          <div className="helper-row">
            <input
              className="app-input"
              placeholder="Add a tag"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
              }}
            />
            <button
              className="secondary-button"
              onClick={() => {
                if (draft.trim().length === 0) {
                  return;
                }
                setTags((current) => [...current, draft.trim()]);
                setDraft('');
              }}
              type="button"
            >
              Add
            </button>
          </div>

          <div className="helper-row">
            <button
              className="primary-button"
              onClick={() => {
                void onSave(normalizedTags).finally(onClose);
              }}
              type="button"
            >
              Save
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
