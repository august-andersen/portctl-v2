import { useEffect, useMemo, useRef, useState } from 'react';

import type {
  ActionResponse,
  DashboardSnapshot,
  EventLevel,
  EventRecord,
  PortctlConfig,
  ProcessRecord,
  Reservation,
  StatusResponse,
  ViewMode,
} from '@shared/types';
import { DEFAULT_CONFIG } from '@shared/types';

import { CardGrid } from './components/CardGrid';
import { Header } from './components/Header';
import { LogViewer } from './components/LogViewer';
import { ReserveModal } from './components/ReserveModal';
import { RestartCommandModal } from './components/RestartCommandModal';
import { Settings } from './components/Settings';
import { SwitchPortModal } from './components/SwitchPortModal';
import { TableView } from './components/TableView';
import { TagEditor } from './components/TagEditor';
import { ToastViewport, type ToastItem } from './components/Toast';
import { fetchJson, postJson } from './utils/api';
import { filterText } from './utils/format';

function getTagStorageKey(processRecord: ProcessRecord): string {
  return processRecord.reservation
    ? `matcher:${processRecord.reservation.matcher.value}`
    : `port:${processRecord.port}`;
}

function usesBrowserOpen(processRecord: ProcessRecord): boolean {
  return processRecord.classifications.includes('web');
}

export function App(): JSX.Element {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>({
    updatedAt: new Date(0).toISOString(),
    pollFailures: 0,
    banner: null,
    processes: [],
  });
  const [config, setConfig] = useState<PortctlConfig>(DEFAULT_CONFIG);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('card');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<ProcessRecord['primaryClassification'] | 'all'>(
    'all',
  );
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logProcess, setLogProcess] = useState<ProcessRecord | null>(null);
  const [switchProcess, setSwitchProcess] = useState<ProcessRecord | null>(null);
  const [reserveProcess, setReserveProcess] = useState<ProcessRecord | null>(null);
  const [tagProcess, setTagProcess] = useState<ProcessRecord | null>(null);
  const [restartProcess, setRestartProcess] = useState<ProcessRecord | null>(null);
  const [pendingPorts, setPendingPorts] = useState<number[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const lastEventIdRef = useRef(0);
  const toastIdRef = useRef(1);
  const pollingRef = useRef(false);
  const refreshRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const addToast = (level: EventLevel, title: string, message: string): void => {
    const nextToast: ToastItem = {
      id: toastIdRef.current,
      level,
      title,
      message,
    };
    toastIdRef.current += 1;
    setToasts((current) => [...current, nextToast]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== nextToast.id));
    }, 4000);
  };

  const refreshDashboard = async (): Promise<void> => {
    if (pollingRef.current) {
      return;
    }

    pollingRef.current = true;
    try {
      const [nextSnapshot, nextConfig, nextStatus, eventResponse] = await Promise.all([
        fetchJson<DashboardSnapshot>('/api/processes'),
        fetchJson<PortctlConfig>('/api/config'),
        fetchJson<StatusResponse>('/api/status'),
        fetchJson<{ events: EventRecord[] }>(`/api/events?since=${lastEventIdRef.current}`),
      ]);

      setSnapshot(nextSnapshot);
      setConfig(nextConfig);
      setStatus(nextStatus);
      setViewMode(nextConfig.settings.defaultView);

      for (const event of eventResponse.events) {
        lastEventIdRef.current = Math.max(lastEventIdRef.current, event.id);
        addToast(event.level, event.title, event.message);
      }
    } catch (error) {
      addToast(
        'error',
        'Refresh Failed',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      pollingRef.current = false;
    }
  };

  refreshRef.current = refreshDashboard;

  useEffect(() => {
    void refreshRef.current();
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshRef.current();
    }, config.settings.pollingInterval);

    return () => {
      window.clearInterval(interval);
    };
  }, [config.settings.pollingInterval]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', config.settings.theme);
  }, [config.settings.theme]);

  const filteredProcesses = useMemo(() => {
    const normalizedSearch = filterText(search);
    return snapshot.processes.filter((processRecord) => {
      if (
        typeFilter !== 'all' &&
        !processRecord.classifications.includes(typeFilter)
      ) {
        return false;
      }

      if (activeTag && !processRecord.tags.includes(activeTag)) {
        return false;
      }

      if (normalizedSearch.length === 0) {
        return true;
      }

      const haystack = [
        processRecord.processName,
        processRecord.command,
        `${processRecord.port}`,
        processRecord.tags.join(' '),
        processRecord.classifications.join(' '),
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  }, [activeTag, search, snapshot.processes, typeFilter]);

  const startablePorts = useMemo(
    () =>
      snapshot.processes
        .filter(
          (processRecord) =>
            processRecord.status === 'empty' &&
            Boolean(
              config.customRestartCommands[`port:${processRecord.port}`] ||
                config.reservations.find((entry) => entry.port === processRecord.port)
                  ?.restartTemplate,
            ),
        )
        .map((processRecord) => processRecord.port),
    [config.customRestartCommands, config.reservations, snapshot.processes],
  );

  const withPendingPort = async (
    port: number,
    operation: () => Promise<void>,
  ): Promise<void> => {
    setPendingPorts((current) => [...new Set([...current, port])]);
    try {
      await operation();
    } finally {
      setPendingPorts((current) => current.filter((value) => value !== port));
    }
  };

  const handleActionResponse = async (
    action: Promise<ActionResponse>,
    successTitle: string,
  ): Promise<ActionResponse> => {
    const response = await action;
    addToast(
      response.ok ? 'success' : response.conflict ? 'warning' : 'error',
      successTitle,
      response.message,
    );
    if (response.ok) {
      await refreshRef.current();
    }
    return response;
  };

  const updateConfig = async (nextConfig: PortctlConfig): Promise<void> => {
    const response = await postJson<{ config: PortctlConfig; message: string }>(
      '/api/config',
      nextConfig,
      'PUT',
    );
    setConfig(response.config);
    addToast('success', 'Settings Saved', response.message);
    await refreshRef.current();
  };

  const toggleTheme = async (): Promise<void> => {
    await updateConfig({
      ...config,
      settings: {
        ...config.settings,
        theme: config.settings.theme === 'dark' ? 'light' : 'dark',
      },
    });
  };

  const changeViewMode = async (nextView: ViewMode): Promise<void> => {
    setViewMode(nextView);
    await updateConfig({
      ...config,
      settings: {
        ...config.settings,
        defaultView: nextView,
      },
    });
  };

  const openPrimaryTarget = (processRecord: ProcessRecord): void => {
    if (
      config.settings.cardClickBehavior === 'openLogs' ||
      !usesBrowserOpen(processRecord)
    ) {
      setLogProcess(processRecord);
      return;
    }

    window.open(`http://localhost:${processRecord.port}`, '_blank');
  };

  const maybeConfirmSystemAction = (processRecord: ProcessRecord): boolean => {
    if (!processRecord.isSystemProcess) {
      return true;
    }

    return window.confirm(
      'This is a system process. Killing or suspending it may affect macOS. Continue?',
    );
  };

  const killProcess = (processRecord: ProcessRecord): void => {
    if (!maybeConfirmSystemAction(processRecord)) {
      return;
    }

    void withPendingPort(processRecord.port, async () => {
      await handleActionResponse(
        postJson<ActionResponse>(`/api/processes/${processRecord.pid}/kill`),
        'Kill Process',
      );
    });
  };

  const toggleSuspend = (processRecord: ProcessRecord): void => {
    if (!maybeConfirmSystemAction(processRecord)) {
      return;
    }

    void withPendingPort(processRecord.port, async () => {
      await handleActionResponse(
        postJson<ActionResponse>(
          `/api/processes/${processRecord.pid}/${
            processRecord.status === 'suspended' ? 'resume' : 'suspend'
          }`,
        ),
        processRecord.status === 'suspended' ? 'Resume Process' : 'Suspend Process',
      );
    });
  };

  const togglePin = (processRecord: ProcessRecord): void => {
    const pinned = config.pinnedPorts.includes(processRecord.port);

    void withPendingPort(processRecord.port, async () => {
      const response = await postJson<{ config: PortctlConfig; message: string }>(
        pinned
          ? `/api/config/pinned-ports/${processRecord.port}`
          : '/api/config/pinned-ports',
        pinned ? undefined : { port: processRecord.port },
        pinned ? 'DELETE' : 'POST',
      );
      setConfig(response.config);
      addToast('success', pinned ? 'Port Unpinned' : 'Port Pinned', response.message);
      await refreshRef.current();
    });
  };

  const startPinnedPort = (processRecord: ProcessRecord): void => {
    void withPendingPort(processRecord.port, async () => {
      await handleActionResponse(
        postJson<ActionResponse>(`/api/ports/${processRecord.port}/start`),
        'Start Process',
      );
    });
  };

  const saveTags = async (processRecord: ProcessRecord, tags: string[]): Promise<void> => {
    const response = await postJson<{ config: PortctlConfig; message: string }>(
      `/api/config/tags/${encodeURIComponent(getTagStorageKey(processRecord))}`,
      { tags },
    );
    setConfig(response.config);
    addToast('success', 'Tags Updated', response.message);
    await refreshRef.current();
  };

  const saveReservation = async (reservation: Reservation): Promise<void> => {
    const response = await postJson<{ config: PortctlConfig; message: string }>(
      '/api/config/reservations',
      reservation,
    );
    setConfig(response.config);
    addToast('success', 'Reservation Saved', response.message);
    await refreshRef.current();
  };

  const saveRestartCommand = async (processRecord: ProcessRecord, command: string): Promise<void> => {
    const response = await postJson<{ config: PortctlConfig; message: string }>(
      `/api/config/custom-restart-commands/${encodeURIComponent(`port:${processRecord.port}`)}`,
      { command },
    );
    setConfig(response.config);
    addToast('success', 'Restart Command Saved', response.message);
    await refreshRef.current();
  };

  const moveProcess = async (
    processRecord: ProcessRecord,
    targetPort: number,
    options?: {
      conflictStrategy?: 'swap' | 'moveOccupier' | 'killOccupier' | 'cancel';
      alternativePort?: number;
    },
  ): Promise<ActionResponse> => {
    const response = await fetch(`/api/processes/${processRecord.pid}/move`, {
      body: JSON.stringify({
        targetPort,
        ...options,
      }),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
    const body = (await response.json()) as ActionResponse;
    addToast(
      body.ok ? 'success' : body.conflict ? 'warning' : 'error',
      'Move Process',
      body.message,
    );
    if (body.ok) {
      await refreshRef.current();
    }
    return body;
  };

  const reorderCards = (ports: number[]): void => {
    void postJson<{ config: PortctlConfig; message: string }>(
      '/api/config/card-order',
      { cardOrder: ports },
      'PUT',
    )
      .then((response) => {
        setConfig(response.config);
      })
      .catch((error) => {
        addToast(
          'error',
          'Card Order Failed',
          error instanceof Error ? error.message : String(error),
        );
      });
  };

  return (
    <div className="app-shell">
      <div className="app-frame">
        <Header
          activeTag={activeTag}
          onClearTag={() => {
            setActiveTag(null);
          }}
          onOpenSettings={() => {
            setSettingsOpen(true);
          }}
          onSearchChange={setSearch}
          onToggleTheme={() => {
            void toggleTheme();
          }}
          onTypeFilterChange={setTypeFilter}
          onViewModeChange={(nextView) => {
            void changeViewMode(nextView);
          }}
          search={search}
          theme={config.settings.theme}
          typeFilter={typeFilter}
          viewMode={viewMode}
        />

        <section className="status-strip">
          <div className="panel status-tile">
            <label>Active Ports</label>
            <strong>
              {snapshot.processes.filter((processRecord) => processRecord.status !== 'empty').length}
            </strong>
          </div>
          <div className="panel status-tile">
            <label>Reserved</label>
            <strong>{config.reservations.length}</strong>
          </div>
          <div className="panel status-tile">
            <label>Blocked</label>
            <strong>{config.blockedPorts.length}</strong>
          </div>
          <div className="panel status-tile">
            <label>Daemon</label>
            <strong>{status?.uptime ?? 'offline'}</strong>
          </div>
        </section>

        {snapshot.banner ? <div className="banner">{snapshot.banner}</div> : null}

        <section className="panel content-panel">
          {viewMode === 'card' ? (
            <CardGrid
              onEditCommand={(processRecord) => {
                setRestartProcess(processRecord);
              }}
              onEditTags={(processRecord) => {
                setTagProcess(processRecord);
              }}
              onKill={killProcess}
              onMove={(processRecord) => {
                setSwitchProcess(processRecord);
              }}
              onPrimaryOpen={openPrimaryTarget}
              onReorder={reorderCards}
              onReserve={(processRecord) => {
                setReserveProcess(processRecord);
              }}
              onStart={startPinnedPort}
              onTagClick={(tag) => {
                setActiveTag(tag);
              }}
              onTogglePin={togglePin}
              onToggleSuspend={toggleSuspend}
              onViewLogs={(processRecord) => {
                setLogProcess(processRecord);
              }}
              pendingPorts={pendingPorts}
              pinnedPorts={config.pinnedPorts}
              processes={filteredProcesses}
              startablePorts={startablePorts}
            />
          ) : (
            <TableView
              onKill={killProcess}
              onMove={(processRecord) => {
                setSwitchProcess(processRecord);
              }}
              onPrimaryOpen={openPrimaryTarget}
              onTogglePin={togglePin}
              onToggleSuspend={toggleSuspend}
              onViewLogs={(processRecord) => {
                setLogProcess(processRecord);
              }}
              pendingPorts={pendingPorts}
              processes={filteredProcesses}
            />
          )}
        </section>

        {settingsOpen ? (
          <Settings
            config={config}
            onAddBlockedPort={async (port) => {
              const response = await postJson<{ config: PortctlConfig; message: string }>(
                '/api/config/blocked-ports',
                { port },
              );
              setConfig(response.config);
              addToast('success', 'Blocked Port Added', response.message);
              await refreshRef.current();
            }}
            onAddPinnedPort={async (port) => {
              const response = await postJson<{ config: PortctlConfig; message: string }>(
                '/api/config/pinned-ports',
                { port },
              );
              setConfig(response.config);
              addToast('success', 'Pinned Port Added', response.message);
              await refreshRef.current();
            }}
            onClose={() => {
              setSettingsOpen(false);
            }}
            onDeleteReservation={async (port) => {
              const response = await postJson<{ config: PortctlConfig; message: string }>(
                `/api/config/reservations/${port}`,
                undefined,
                'DELETE',
              );
              setConfig(response.config);
              addToast('success', 'Reservation Removed', response.message);
              await refreshRef.current();
            }}
            onRemoveBlockedPort={async (port) => {
              const response = await postJson<{ config: PortctlConfig; message: string }>(
                `/api/config/blocked-ports/${port}`,
                undefined,
                'DELETE',
              );
              setConfig(response.config);
              addToast('success', 'Blocked Port Removed', response.message);
              await refreshRef.current();
            }}
            onRemovePinnedPort={async (port) => {
              const response = await postJson<{ config: PortctlConfig; message: string }>(
                `/api/config/pinned-ports/${port}`,
                undefined,
                'DELETE',
              );
              setConfig(response.config);
              addToast('success', 'Pinned Port Removed', response.message);
              await refreshRef.current();
            }}
            onSaveConfig={updateConfig}
            onSaveReservation={saveReservation}
            status={status}
          />
        ) : null}

        {logProcess ? (
          <LogViewer
            onClose={() => {
              setLogProcess(null);
            }}
            processRecord={logProcess}
          />
        ) : null}

        {switchProcess ? (
          <SwitchPortModal
            onClose={() => {
              setSwitchProcess(null);
            }}
            onMove={(targetPort, options) =>
              moveProcess(switchProcess, targetPort, options)
            }
            processRecord={switchProcess}
          />
        ) : null}

        {reserveProcess ? (
          <ReserveModal
            onClose={() => {
              setReserveProcess(null);
            }}
            onSave={saveReservation}
            processRecord={reserveProcess}
          />
        ) : null}

        {tagProcess ? (
          <TagEditor
            onClose={() => {
              setTagProcess(null);
            }}
            onSave={(tags) => saveTags(tagProcess, tags)}
            processRecord={tagProcess}
          />
        ) : null}

        {restartProcess ? (
          <RestartCommandModal
            initialValue={config.customRestartCommands[`port:${restartProcess.port}`] ?? ''}
            onClose={() => {
              setRestartProcess(null);
            }}
            onSave={(command) => saveRestartCommand(restartProcess, command)}
            port={restartProcess.port}
          />
        ) : null}

        <ToastViewport
          onDismiss={(id) => {
            setToasts((current) => current.filter((toast) => toast.id !== id));
          }}
          toasts={toasts}
        />
      </div>
    </div>
  );
}
