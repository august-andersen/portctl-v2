import { useEffect, useMemo, useRef, useState } from 'react';

import type {
  ActionResponse,
  DashboardSnapshot,
  EventLevel,
  EventRecord,
  PortProcess,
  PortctlConfig,
  ProcessGroup,
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
import { getDisplayName, groupProcesses } from './utils/groupProcesses';

function getTagStorageKey(processRecord: PortProcess): string {
  return processRecord.reservation
    ? `matcher:${processRecord.reservation.matcher.value}`
    : `port:${processRecord.port}`;
}

function getCustomNameKey(processRecord: PortProcess): string {
  return `port:${processRecord.port}`;
}

function usesBrowserOpen(group: ProcessGroup): boolean {
  return group.classifications.includes('web');
}

function sortGroups(groups: ProcessGroup[], cardOrder: string[]): ProcessGroup[] {
  const orderLookup = new Map(cardOrder.map((value, index) => [value, index]));

  return [...groups].sort((left, right) => {
    const leftIndex = orderLookup.get(left.id);
    const rightIndex = orderLookup.get(right.id);
    if (leftIndex !== undefined && rightIndex !== undefined) {
      return leftIndex - rightIndex;
    }
    if (leftIndex !== undefined) {
      return -1;
    }
    if (rightIndex !== undefined) {
      return 1;
    }

    return (
      left.displayName.localeCompare(right.displayName) ||
      (left.ports[0] ?? 0) - (right.ports[0] ?? 0)
    );
  });
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
  const [typeFilter, setTypeFilter] = useState<PortProcess['primaryClassification'] | 'all'>(
    'all',
  );
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [showSystem, setShowSystem] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logProcess, setLogProcess] = useState<PortProcess | null>(null);
  const [switchProcess, setSwitchProcess] = useState<PortProcess | null>(null);
  const [reserveProcess, setReserveProcess] = useState<PortProcess | null>(null);
  const [tagProcess, setTagProcess] = useState<PortProcess | null>(null);
  const [restartProcess, setRestartProcess] = useState<PortProcess | null>(null);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
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

  const groupedProcesses = useMemo(
    () => sortGroups(groupProcesses(snapshot.processes, config), config.cardOrder),
    [config, snapshot.processes],
  );

  const hiddenCount = groupedProcesses.filter((group) => group.section === 'hidden').length;
  const systemCount = groupedProcesses.filter((group) => group.section === 'system').length;

  const filteredGroups = useMemo(() => {
    const normalizedSearch = filterText(search);
    return groupedProcesses.filter((group) => {
      if (!showHidden && group.section === 'hidden') {
        return false;
      }
      if (!showSystem && group.section === 'system') {
        return false;
      }
      if (typeFilter !== 'all' && !group.classifications.includes(typeFilter)) {
        return false;
      }
      if (activeTag && !group.tags.includes(activeTag)) {
        return false;
      }
      if (normalizedSearch.length === 0) {
        return true;
      }

      const haystack = [
        group.displayName,
        group.primaryProcess.command,
        group.ports.join(' '),
        group.tags.join(' '),
        group.classifications.join(' '),
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  }, [activeTag, groupedProcesses, search, showHidden, showSystem, typeFilter]);

  const startableIds = useMemo(
    () =>
      groupedProcesses
        .filter(
          (group) =>
            !group.hasActiveProcess &&
            Boolean(
              config.customRestartCommands[`port:${group.primaryProcess.port}`] ||
                config.reservations.find(
                  (entry) => entry.port === group.primaryProcess.port,
                )?.restartTemplate,
            ),
        )
        .map((group) => group.id),
    [config.customRestartCommands, config.reservations, groupedProcesses],
  );

  const withPendingGroup = async (
    id: string,
    operation: () => Promise<void>,
  ): Promise<void> => {
    setPendingIds((current) => [...new Set([...current, id])]);
    try {
      await operation();
    } finally {
      setPendingIds((current) => current.filter((value) => value !== id));
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

  const openPrimaryTarget = (group: ProcessGroup): void => {
    if (config.settings.cardClickBehavior === 'openLogs' || !usesBrowserOpen(group)) {
      setLogProcess(group.primaryProcess);
      return;
    }

    window.open(`http://localhost:${group.primaryProcess.port}`, '_blank');
  };

  const maybeConfirmSystemAction = (group: ProcessGroup): boolean => {
    if (!group.isSystemGroup) {
      return true;
    }

    return window.confirm(
      'This is a system process group. Killing or suspending it may affect macOS. Continue?',
    );
  };

  const killGroup = (group: ProcessGroup): void => {
    if (!maybeConfirmSystemAction(group)) {
      return;
    }

    void withPendingGroup(group.id, async () => {
      await handleActionResponse(
        postJson<ActionResponse>(`/api/processes/${group.pid}/kill`),
        'Kill Process',
      );
    });
  };

  const toggleSuspend = (group: ProcessGroup): void => {
    if (!maybeConfirmSystemAction(group)) {
      return;
    }

    void withPendingGroup(group.id, async () => {
      await handleActionResponse(
        postJson<ActionResponse>(
          `/api/processes/${group.pid}/${group.status === 'suspended' ? 'resume' : 'suspend'}`,
        ),
        group.status === 'suspended' ? 'Resume Process' : 'Suspend Process',
      );
    });
  };

  const togglePin = (group: ProcessGroup): void => {
    const primaryProcess = group.primaryProcess;
    const pinned = config.pinnedPorts.includes(primaryProcess.port);

    void withPendingGroup(group.id, async () => {
      const response = await postJson<{ config: PortctlConfig; message: string }>(
        pinned
          ? `/api/config/pinned-ports/${primaryProcess.port}`
          : '/api/config/pinned-ports',
        pinned ? undefined : { port: primaryProcess.port },
        pinned ? 'DELETE' : 'POST',
      );
      setConfig(response.config);
      addToast('success', pinned ? 'Port Unpinned' : 'Port Pinned', response.message);
      await refreshRef.current();
    });
  };

  const startPinnedPort = (group: ProcessGroup): void => {
    void withPendingGroup(group.id, async () => {
      await handleActionResponse(
        postJson<ActionResponse>(`/api/ports/${group.primaryProcess.port}/start`),
        'Start Process',
      );
    });
  };

  const saveTags = async (processRecord: PortProcess, tags: string[]): Promise<void> => {
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

  const saveRestartCommand = async (
    processRecord: PortProcess,
    command: string,
  ): Promise<void> => {
    const response = await postJson<{ config: PortctlConfig; message: string }>(
      `/api/config/custom-restart-commands/${encodeURIComponent(`port:${processRecord.port}`)}`,
      { command },
    );
    setConfig(response.config);
    addToast('success', 'Restart Command Saved', response.message);
    await refreshRef.current();
  };

  const renameGroup = async (group: ProcessGroup, nextName: string): Promise<void> => {
    const response = await postJson<{ config: PortctlConfig; message: string }>(
      `/api/config/custom-names/${encodeURIComponent(getCustomNameKey(group.primaryProcess))}`,
      { name: nextName },
      'PUT',
    );
    setConfig(response.config);
    addToast('success', 'Name Updated', response.message);
    await refreshRef.current();
  };

  const toggleHidden = async (group: ProcessGroup): Promise<void> => {
    const hidden = config.hiddenProcesses.includes(group.hiddenName);
    const response = await postJson<{ config: PortctlConfig; message: string }>(
      hidden
        ? `/api/config/hidden-processes/${encodeURIComponent(group.hiddenName)}`
        : '/api/config/hidden-processes',
      hidden ? undefined : { name: group.hiddenName },
      hidden ? 'DELETE' : 'POST',
    );
    setConfig(response.config);
    addToast('success', hidden ? 'Process Visible' : 'Process Hidden', response.message);
    await refreshRef.current();
  };

  const moveGroup = async (
    group: ProcessGroup,
    targetPort: number,
    options?: {
      conflictStrategy?: 'swap' | 'moveOccupier' | 'killOccupier' | 'cancel';
      alternativePort?: number;
    },
  ): Promise<ActionResponse> => {
    const response = await fetch(`/api/processes/${group.pid}/move`, {
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

  const reorderCards = (ids: string[]): void => {
    void postJson<{ config: PortctlConfig; message: string }>(
      '/api/config/card-order',
      { cardOrder: ids },
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
          hiddenCount={hiddenCount}
          onClearTag={() => {
            setActiveTag(null);
          }}
          onOpenSettings={() => {
            setSettingsOpen(true);
          }}
          onSearchChange={setSearch}
          onToggleHidden={() => {
            setShowHidden((current) => !current);
          }}
          onToggleSystem={() => {
            setShowSystem((current) => !current);
          }}
          onToggleTheme={() => {
            void toggleTheme();
          }}
          onTypeFilterChange={setTypeFilter}
          onViewModeChange={(nextView) => {
            void changeViewMode(nextView);
          }}
          search={search}
          showHidden={showHidden}
          showSystem={showSystem}
          systemCount={systemCount}
          theme={config.settings.theme}
          typeFilter={typeFilter}
          viewMode={viewMode}
        />

        <section className="status-strip">
          <div className="panel status-tile">
            <label>Active Groups</label>
            <strong>{groupedProcesses.filter((group) => group.hasActiveProcess).length}</strong>
          </div>
          <div className="panel status-tile">
            <label>Reserved</label>
            <strong>{config.reservations.length}</strong>
          </div>
          <div className="panel status-tile">
            <label>Hidden</label>
            <strong>{hiddenCount}</strong>
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
              groups={filteredGroups}
              onEditCommand={(group) => {
                setRestartProcess(group.primaryProcess);
              }}
              onEditTags={(group) => {
                setTagProcess(group.primaryProcess);
              }}
              onKill={killGroup}
              onMove={moveGroup}
              onOpenMoveModal={(group) => {
                setSwitchProcess(group.primaryProcess);
              }}
              onPrimaryOpen={openPrimaryTarget}
              onRename={renameGroup}
              onReorder={reorderCards}
              onReserve={(group) => {
                setReserveProcess(group.primaryProcess);
              }}
              onStart={startPinnedPort}
              onTagClick={(tag) => {
                setActiveTag(tag);
              }}
              onToggleHidden={toggleHidden}
              onTogglePin={togglePin}
              onToggleSuspend={toggleSuspend}
              onViewLogs={(group) => {
                setLogProcess(group.primaryProcess);
              }}
              pendingIds={pendingIds}
              pinnedPorts={config.pinnedPorts}
              startableIds={startableIds}
            />
          ) : (
            <TableView
              groups={filteredGroups}
              onKill={killGroup}
              onMove={(group) => {
                setSwitchProcess(group.primaryProcess);
              }}
              onPrimaryOpen={openPrimaryTarget}
              onTogglePin={togglePin}
              onToggleSuspend={toggleSuspend}
              onViewLogs={(group) => {
                setLogProcess(group.primaryProcess);
              }}
              pendingIds={pendingIds}
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
              moveGroup(
                groupProcesses([switchProcess], config)[0] ?? {
                  id: `port:${switchProcess.port}`,
                  displayName: getDisplayName(switchProcess, config),
                  processes: [switchProcess],
                  primaryProcess: switchProcess,
                  ports: switchProcess.ports,
                  pid: switchProcess.pid,
                  cpuPercent: switchProcess.cpuPercent,
                  memoryRssKb: switchProcess.memoryRssKb,
                  uptime: switchProcess.uptime,
                  status: switchProcess.status,
                  classifications: switchProcess.classifications,
                  primaryClassification: switchProcess.primaryClassification,
                  tags: switchProcess.tags,
                  hiddenName: getDisplayName(switchProcess, config),
                  isHidden: false,
                  isSystemGroup: switchProcess.isSystemProcess,
                  hasPinnedSlot: switchProcess.status === 'empty',
                  hasActiveProcess: switchProcess.status !== 'empty',
                  isPortctl: switchProcess.isPortctl,
                  section: switchProcess.isSystemProcess ? 'system' : 'processes',
                },
                targetPort,
                options,
              )
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
