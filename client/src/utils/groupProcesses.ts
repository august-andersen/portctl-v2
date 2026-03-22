import type {
  PortctlConfig,
  PortProcess,
  ProcessGroup,
  ProcessStatus,
  ProcessType,
} from '@shared/types';

const CLASSIFICATION_PRIORITY: ProcessType[] = [
  'system',
  'database',
  'web',
  'api',
  'other',
];

type SectionCandidate = Omit<
  ProcessGroup,
  'section' | 'defaultGroupId' | 'canUngroup' | 'isUngrouped'
>;

function getCustomNameKey(processRecord: PortProcess): string {
  return `port:${processRecord.port}`;
}

function getDefaultGroupKey(
  processRecord: PortProcess,
  config: PortctlConfig,
  displayName: string,
): string {
  const hasCustomName = Boolean(config.customNames[getCustomNameKey(processRecord)]);
  if (processRecord.status === 'empty' && !hasCustomName) {
    return `slot:${processRecord.port}`;
  }

  return `app:${displayName.trim().toLowerCase()}`;
}

export function getDisplayName(
  processRecord: PortProcess,
  config: PortctlConfig,
): string {
  const customName = config.customNames[getCustomNameKey(processRecord)];
  if (customName) {
    return customName;
  }

  if (processRecord.status === 'empty') {
    return processRecord.reservation?.label ?? `Port ${processRecord.port}`;
  }

  return processRecord.processName;
}

function getGroupKey(
  processRecord: PortProcess,
  config: PortctlConfig,
  displayName: string,
): string {
  const defaultGroupKey = getDefaultGroupKey(processRecord, config, displayName);
  if (config.ungroupedGroups.includes(defaultGroupKey) && defaultGroupKey.startsWith('app:')) {
    return `${defaultGroupKey}:port:${processRecord.port}`;
  }

  return defaultGroupKey;
}

function resolvePrimaryProcess(processes: PortProcess[]): PortProcess {
  return [...processes].sort((left, right) => {
    const leftWeight = left.status === 'empty' ? 1 : 0;
    const rightWeight = right.status === 'empty' ? 1 : 0;
    if (leftWeight !== rightWeight) {
      return leftWeight - rightWeight;
    }

    if (left.isSystemProcess !== right.isSystemProcess) {
      return Number(left.isSystemProcess) - Number(right.isSystemProcess);
    }

    return left.port - right.port;
  })[0];
}

function resolveStatus(processes: PortProcess[]): ProcessStatus {
  if (processes.some((processRecord) => processRecord.status === 'running')) {
    return 'running';
  }
  if (processes.some((processRecord) => processRecord.status === 'suspended')) {
    return 'suspended';
  }
  if (processes.some((processRecord) => processRecord.status === 'error')) {
    return 'error';
  }
  return 'empty';
}

function sumMetric(values: Array<number | null>): number | null {
  const numericValues = values.filter(
    (value): value is number => typeof value === 'number',
  );
  if (numericValues.length === 0) {
    return null;
  }

  return numericValues.reduce((total, value) => total + value, 0);
}

function resolvePrimaryClassification(classifications: ProcessType[]): ProcessType {
  return (
    CLASSIFICATION_PRIORITY.find((classification) =>
      classifications.includes(classification),
    ) ?? 'other'
  );
}

function resolveSection(group: SectionCandidate): ProcessGroup['section'] {
  if (group.isHidden) {
    return 'hidden';
  }

  if (group.hasPinnedSlot) {
    return 'pinned';
  }

  if (group.isSystemGroup) {
    return 'system';
  }

  return 'processes';
}

export function groupProcesses(
  processes: PortProcess[],
  config: PortctlConfig,
): ProcessGroup[] {
  const defaultGroupCounts = new Map<string, number>();
  for (const processRecord of processes) {
    const displayName = getDisplayName(processRecord, config);
    const defaultGroupKey = getDefaultGroupKey(processRecord, config, displayName);
    defaultGroupCounts.set(
      defaultGroupKey,
      (defaultGroupCounts.get(defaultGroupKey) ?? 0) + 1,
    );
  }

  const buckets = new Map<string, PortProcess[]>();

  for (const processRecord of processes) {
    const displayName = getDisplayName(processRecord, config);
    const key = getGroupKey(processRecord, config, displayName);
    const existing = buckets.get(key) ?? [];
    existing.push(processRecord);
    buckets.set(key, existing);
  }

  return [...buckets.entries()].map(([id, groupedProcesses]) => {
    const primaryProcess = resolvePrimaryProcess(groupedProcesses);
    const displayName = getDisplayName(primaryProcess, config);
    const defaultGroupId = getDefaultGroupKey(primaryProcess, config, displayName);
    const classifications = [
      ...new Set(groupedProcesses.flatMap((processRecord) => processRecord.classifications)),
    ];
    const tags = [
      ...new Set(groupedProcesses.flatMap((processRecord) => processRecord.tags)),
    ];
    const ports = [...new Set(groupedProcesses.flatMap((processRecord) => processRecord.ports))].sort(
      (left, right) => left - right,
    );

    const baseGroup: SectionCandidate = {
      id,
      displayName,
      processes: [...groupedProcesses].sort((left, right) => left.port - right.port),
      primaryProcess,
      ports,
      pid: primaryProcess.pid,
      cpuPercent: sumMetric(groupedProcesses.map((processRecord) => processRecord.cpuPercent)),
      memoryRssKb: sumMetric(groupedProcesses.map((processRecord) => processRecord.memoryRssKb)),
      uptime: primaryProcess.uptime,
      status: resolveStatus(groupedProcesses),
      classifications,
      primaryClassification: resolvePrimaryClassification(classifications),
      tags,
      hiddenName: displayName,
      isHidden: config.hiddenProcesses.includes(displayName),
      isSystemGroup:
        groupedProcesses.some((processRecord) => processRecord.isSystemProcess) &&
        groupedProcesses.every(
          (processRecord) =>
            processRecord.isSystemProcess || processRecord.status === 'empty',
        ),
      hasPinnedSlot:
        groupedProcesses.some((processRecord) => processRecord.status === 'empty') ||
        groupedProcesses.some((processRecord) => config.pinnedPorts.includes(processRecord.port)),
      hasActiveProcess: groupedProcesses.some(
        (processRecord) => processRecord.status !== 'empty',
      ),
      isPortctl: groupedProcesses.some((processRecord) => processRecord.isPortctl),
    };

    return {
      ...baseGroup,
      defaultGroupId,
      canUngroup:
        defaultGroupId.startsWith('app:') &&
        ((defaultGroupCounts.get(defaultGroupId) ?? 0) > 1 ||
          config.ungroupedGroups.includes(defaultGroupId)),
      isUngrouped: config.ungroupedGroups.includes(defaultGroupId),
      section: resolveSection(baseGroup),
    };
  });
}
