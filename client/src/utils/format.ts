export function formatMemory(rssKb: number | null): string {
  if (rssKb === null) {
    return 'n/a';
  }

  return `${(rssKb / 1024).toFixed(rssKb > 1024 * 1024 ? 1 : 0)}MB`;
}

export function formatCpu(cpuPercent: number | null): string {
  if (cpuPercent === null) {
    return 'n/a';
  }

  return `${cpuPercent.toFixed(1)}%`;
}

export function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function filterText(value: string): string {
  return value.trim().toLowerCase();
}
