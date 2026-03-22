import { useEffect, useMemo, useRef, useState } from 'react';

import Convert from 'ansi-to-html';

import type { ProcessLogsResponse, ProcessRecord } from '@shared/types';

import { fetchJson, postJson } from '../utils/api';

interface LogViewerProps {
  processRecord: ProcessRecord;
  onClose: () => void;
}

const ansiConverter = new Convert({
  fg: '#eaf1ff',
  bg: '#071019',
  newline: true,
  escapeXML: true,
});

export function LogViewer({
  processRecord,
  onClose,
}: LogViewerProps): JSX.Element {
  const [logs, setLogs] = useState<ProcessLogsResponse | null>(null);
  const [search, setSearch] = useState('');
  const [pinToBottom, setPinToBottom] = useState(true);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadLogs = async (): Promise<void> => {
      const nextLogs = await fetchJson<ProcessLogsResponse>(
        `/api/processes/${processRecord.pid}/logs`,
      );
      if (!cancelled) {
        setLogs(nextLogs);
      }
    };

    void loadLogs();
    const interval = window.setInterval(() => {
      void loadLogs();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [processRecord.pid]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    if (!pinToBottom) {
      return;
    }

    const element = scrollerRef.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [logs, pinToBottom]);

  const filteredLines = useMemo(() => {
    const entries = logs?.entries ?? [];
    const normalizedSearch = search.trim().toLowerCase();

    return entries.filter((entry) =>
      normalizedSearch.length === 0
        ? true
        : entry.line.toLowerCase().includes(normalizedSearch),
    );
  }, [logs, search]);

  return (
    <div className="overlay" role="presentation">
      <div className="modal">
        <div className="modal-header">
          <div>
            <h2>{processRecord.processName}</h2>
            <div className="muted">
              Port {processRecord.port} • PID {processRecord.pid}
            </div>
          </div>
          <button className="backdrop-close" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="log-shell">
          <div className="log-toolbar">
            <input
              className="app-input"
              placeholder="Search logs"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
              }}
            />
            <div className="helper-row">
              <button
                className={pinToBottom ? 'chip-active' : 'chip'}
                onClick={() => {
                  setPinToBottom((current) => !current);
                }}
                type="button"
              >
                {pinToBottom ? 'Pin bottom: on' : 'Pin bottom: off'}
              </button>
              <button
                className="ghost-button"
                onClick={() => {
                  void postJson(`/api/processes/${processRecord.pid}/logs/clear`);
                  setLogs((current) =>
                    current
                      ? {
                          ...current,
                          entries: [],
                          truncated: false,
                        }
                      : current,
                  );
                }}
                type="button"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="log-content" ref={scrollerRef}>
            {filteredLines.length === 0 ? (
              <div className="muted">
                {processRecord.logStatus === 'live'
                  ? 'No captured output yet.'
                  : 'Logs are available from the next restart that portctl manages.'}
              </div>
            ) : (
              filteredLines.map((entry) => (
                <div
                  key={entry.id}
                  dangerouslySetInnerHTML={{
                    __html: ansiConverter.toHtml(entry.line),
                  }}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
