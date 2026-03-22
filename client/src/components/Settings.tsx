import { useEffect, useMemo, useState } from 'react';

import type {
  PortctlConfig,
  Reservation,
  StatusResponse,
  ThemeMode,
  ViewMode,
} from '@shared/types';

interface SettingsProps {
  config: PortctlConfig;
  status: StatusResponse | null;
  onClose: () => void;
  onSaveConfig: (config: PortctlConfig) => Promise<void>;
  onSaveReservation: (reservation: Reservation) => Promise<void>;
  onDeleteReservation: (port: number) => Promise<void>;
  onAddBlockedPort: (port: number) => Promise<void>;
  onRemoveBlockedPort: (port: number) => Promise<void>;
  onAddPinnedPort: (port: number) => Promise<void>;
  onRemovePinnedPort: (port: number) => Promise<void>;
}

export function Settings({
  config,
  status,
  onClose,
  onSaveConfig,
  onSaveReservation,
  onDeleteReservation,
  onAddBlockedPort,
  onRemoveBlockedPort,
  onAddPinnedPort,
  onRemovePinnedPort,
}: SettingsProps): JSX.Element {
  const [draftConfig, setDraftConfig] = useState(config);
  const [reservationDraft, setReservationDraft] = useState<Reservation>({
    port: 3000,
    matcher: {
      type: 'command_contains',
      value: '',
    },
    restartTemplate: null,
    label: null,
  });
  const [blockedDraft, setBlockedDraft] = useState('');
  const [pinnedDraft, setPinnedDraft] = useState('');

  useEffect(() => {
    setDraftConfig(config);
  }, [config]);

  const githubUrl = useMemo(
    () => 'https://github.com/august-andersen/portctl',
    [],
  );

  return (
    <div className="overlay" role="presentation">
      <div className="modal">
        <div className="modal-header">
          <div>
            <h2>Settings</h2>
            <div className="muted">
              Configure polling, reserved ports, blocked ports, and pinning.
            </div>
          </div>
          <button className="backdrop-close" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="form-grid">
          <section className="section-block">
            <h3>General</h3>
            <div className="form-grid columns-2">
              <div className="field">
                <label htmlFor="dashboard-port">Dashboard port</label>
                <input
                  className="app-input"
                  id="dashboard-port"
                  inputMode="numeric"
                  value={draftConfig.settings.dashboardPort}
                  onChange={(event) => {
                    setDraftConfig((current) => ({
                      ...current,
                      settings: {
                        ...current.settings,
                        dashboardPort: Number.parseInt(event.target.value, 10) || 47777,
                      },
                    }));
                  }}
                />
              </div>

              <div className="field">
                <label htmlFor="poll-interval">Polling interval (ms)</label>
                <input
                  className="app-input"
                  id="poll-interval"
                  inputMode="numeric"
                  value={draftConfig.settings.pollingInterval}
                  onChange={(event) => {
                    setDraftConfig((current) => ({
                      ...current,
                      settings: {
                        ...current.settings,
                        pollingInterval:
                          Number.parseInt(event.target.value, 10) || 1000,
                      },
                    }));
                  }}
                />
              </div>

              <div className="field">
                <label htmlFor="default-view">Default view</label>
                <select
                  className="app-select"
                  id="default-view"
                  value={draftConfig.settings.defaultView}
                  onChange={(event) => {
                    setDraftConfig((current) => ({
                      ...current,
                      settings: {
                        ...current.settings,
                        defaultView: event.target.value as ViewMode,
                      },
                    }));
                  }}
                >
                  <option value="card">Card</option>
                  <option value="table">Table</option>
                </select>
              </div>

              <div className="field">
                <label htmlFor="theme-mode">Theme</label>
                <select
                  className="app-select"
                  id="theme-mode"
                  value={draftConfig.settings.theme}
                  onChange={(event) => {
                    setDraftConfig((current) => ({
                      ...current,
                      settings: {
                        ...current.settings,
                        theme: event.target.value as ThemeMode,
                      },
                    }));
                  }}
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </div>

              <div className="field">
                <label htmlFor="click-behavior">Card click behavior</label>
                <select
                  className="app-select"
                  id="click-behavior"
                  value={draftConfig.settings.cardClickBehavior}
                  onChange={(event) => {
                    setDraftConfig((current) => ({
                      ...current,
                      settings: {
                        ...current.settings,
                        cardClickBehavior: event.target.value as
                          PortctlConfig['settings']['cardClickBehavior'],
                      },
                    }));
                  }}
                >
                  <option value="openBrowser">Open in browser</option>
                  <option value="openLogs">Open logs</option>
                </select>
              </div>

              <div className="field">
                <label htmlFor="log-buffer">Log buffer size</label>
                <input
                  className="app-input"
                  id="log-buffer"
                  inputMode="numeric"
                  value={draftConfig.settings.logBufferSize}
                  onChange={(event) => {
                    setDraftConfig((current) => ({
                      ...current,
                      settings: {
                        ...current.settings,
                        logBufferSize:
                          Number.parseInt(event.target.value, 10) || 10000,
                      },
                    }));
                  }}
                />
              </div>
            </div>

            <div className="helper-row">
              <button
                className="primary-button"
                onClick={() => {
                  void onSaveConfig(draftConfig);
                }}
                type="button"
              >
                Save general settings
              </button>
            </div>
          </section>

          <section className="section-block">
            <h3>Port Reservations</h3>
            <div className="list-stack">
              {config.reservations.length === 0 ? (
                <div className="muted">No reservations yet.</div>
              ) : (
                config.reservations.map((reservation) => (
                  <div className="list-row" key={reservation.port}>
                    <div className="list-row-copy">
                      <strong>Port {reservation.port}</strong>
                      <span className="muted">
                        {reservation.matcher.type}: {reservation.matcher.value}
                      </span>
                      {reservation.restartTemplate ? (
                        <span className="subtle">{reservation.restartTemplate}</span>
                      ) : null}
                    </div>
                    <div className="helper-row">
                      <button
                        className="ghost-button"
                        onClick={() => {
                          setReservationDraft(reservation);
                        }}
                        type="button"
                      >
                        Edit
                      </button>
                      <button
                        className="danger-button"
                        onClick={() => {
                          void onDeleteReservation(reservation.port);
                        }}
                        type="button"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="form-grid columns-2">
              <div className="field">
                <label>Port</label>
                <input
                  className="app-input"
                  inputMode="numeric"
                  value={reservationDraft.port}
                  onChange={(event) => {
                    setReservationDraft((current) => ({
                      ...current,
                      port: Number.parseInt(event.target.value, 10) || current.port,
                    }));
                  }}
                />
              </div>
              <div className="field">
                <label>Matcher type</label>
                <select
                  className="app-select"
                  value={reservationDraft.matcher.type}
                  onChange={(event) => {
                    setReservationDraft((current) => ({
                      ...current,
                      matcher: {
                        ...current.matcher,
                        type: event.target.value as Reservation['matcher']['type'],
                      },
                    }));
                  }}
                >
                  <option value="command_contains">command_contains</option>
                  <option value="process_name">process_name</option>
                  <option value="working_directory">working_directory</option>
                  <option value="regex">regex</option>
                </select>
              </div>
              <div className="field">
                <label>Matcher value</label>
                <input
                  className="app-input"
                  value={reservationDraft.matcher.value}
                  onChange={(event) => {
                    setReservationDraft((current) => ({
                      ...current,
                      matcher: {
                        ...current.matcher,
                        value: event.target.value,
                      },
                    }));
                  }}
                />
              </div>
              <div className="field">
                <label>Label</label>
                <input
                  className="app-input"
                  value={reservationDraft.label ?? ''}
                  onChange={(event) => {
                    setReservationDraft((current) => ({
                      ...current,
                      label: event.target.value,
                    }));
                  }}
                />
              </div>
            </div>
            <div className="field">
              <label>Custom restart command</label>
              <textarea
                className="app-textarea"
                rows={3}
                value={reservationDraft.restartTemplate ?? ''}
                onChange={(event) => {
                  setReservationDraft((current) => ({
                    ...current,
                    restartTemplate: event.target.value,
                  }));
                }}
              />
            </div>

            <div className="helper-row">
              <button
                className="primary-button"
                onClick={() => {
                  void onSaveReservation({
                    ...reservationDraft,
                    label: reservationDraft.label?.trim() || null,
                    restartTemplate: reservationDraft.restartTemplate?.trim() || null,
                  });
                }}
                type="button"
              >
                Save reservation
              </button>
            </div>
          </section>

          <section className="section-block">
            <h3>Blocked Ports</h3>
            <div className="list-stack">
              {config.blockedPorts.map((port) => (
                <div className="list-row" key={port}>
                  <div className="list-row-copy">
                    <strong>Port {port}</strong>
                    <span className="muted">Any process on this port is terminated.</span>
                  </div>
                  <button
                    className="danger-button"
                    onClick={() => {
                      void onRemoveBlockedPort(port);
                    }}
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <div className="helper-row">
              <input
                className="app-input"
                inputMode="numeric"
                placeholder="Add blocked port"
                value={blockedDraft}
                onChange={(event) => {
                  setBlockedDraft(event.target.value);
                }}
              />
              <button
                className="primary-button"
                onClick={() => {
                  void onAddBlockedPort(Number.parseInt(blockedDraft, 10));
                  setBlockedDraft('');
                }}
                type="button"
              >
                Add
              </button>
            </div>
          </section>

          <section className="section-block">
            <h3>Pinned Ports</h3>
            <div className="list-stack">
              {config.pinnedPorts.map((port) => (
                <div className="list-row" key={port}>
                  <div className="list-row-copy">
                    <strong>Port {port}</strong>
                    <span className="muted">Shows a card even when nothing is running.</span>
                  </div>
                  <button
                    className="danger-button"
                    onClick={() => {
                      void onRemovePinnedPort(port);
                    }}
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <div className="helper-row">
              <input
                className="app-input"
                inputMode="numeric"
                placeholder="Add pinned port"
                value={pinnedDraft}
                onChange={(event) => {
                  setPinnedDraft(event.target.value);
                }}
              />
              <button
                className="primary-button"
                onClick={() => {
                  void onAddPinnedPort(Number.parseInt(pinnedDraft, 10));
                  setPinnedDraft('');
                }}
                type="button"
              >
                Add
              </button>
            </div>
          </section>

          <section className="section-block">
            <h3>About</h3>
            <div className="list-stack">
              <div className="list-row">
                <div className="list-row-copy">
                  <strong>Version</strong>
                  <span className="muted">v{status?.version ?? '0.1.0'}</span>
                </div>
              </div>
              <div className="list-row">
                <div className="list-row-copy">
                  <strong>Daemon</strong>
                  <span className="muted">
                    {status?.ok ? `Running for ${status.uptime}` : 'Not responding'}
                  </span>
                </div>
              </div>
              <div className="list-row">
                <div className="list-row-copy">
                  <strong>Project</strong>
                  <a href={githubUrl} rel="noreferrer" target="_blank">
                    {githubUrl}
                  </a>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
