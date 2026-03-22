import type {
  PortctlConfig,
  ProcessRecord,
  Reservation,
  ReservationMatcher,
} from '../shared/types';

export interface ReservationConflict {
  port: number;
  processes: ProcessRecord[];
  reservations: Reservation[];
}

export interface MigrationPlan {
  process: ProcessRecord;
  reservation: Reservation;
  occupier: ProcessRecord | null;
}

export interface PolicyPlan {
  blocked: ProcessRecord[];
  migrations: MigrationPlan[];
  conflicts: ReservationConflict[];
}

function matchesMatcher(
  process: Pick<ProcessRecord, 'command' | 'processName' | 'workingDirectory'>,
  matcher: ReservationMatcher,
): boolean {
  const command = process.command.toLowerCase();
  const processName = process.processName.toLowerCase();
  const workingDirectory = process.workingDirectory?.toLowerCase() ?? '';
  const needle = matcher.value.toLowerCase();

  switch (matcher.type) {
    case 'command_contains':
      return command.includes(needle);
    case 'process_name':
      return processName === needle;
    case 'working_directory':
      return workingDirectory === needle;
    case 'regex':
      try {
        return new RegExp(matcher.value, 'i').test(process.command);
      } catch {
        return false;
      }
  }
}

export function findMatchingReservations(
  process: Pick<ProcessRecord, 'command' | 'processName' | 'workingDirectory'>,
  reservations: Reservation[],
): Reservation[] {
  return reservations.filter((reservation) =>
    matchesMatcher(process, reservation.matcher),
  );
}

export function resolveReservation(
  process: Pick<ProcessRecord, 'command' | 'processName' | 'workingDirectory'>,
  reservations: Reservation[],
): Reservation | null {
  return findMatchingReservations(process, reservations)[0] ?? null;
}

export function createPolicyPlan(
  processes: ProcessRecord[],
  config: PortctlConfig,
): PolicyPlan {
  const activeProcesses = processes.filter((process) => process.pid > 0);
  const blocked = activeProcesses.filter(
    (process) => config.blockedPorts.includes(process.port) && !process.isPortctl,
  );

  const processesByPort = new Map<number, ProcessRecord>();
  const reservationByPid = new Map<number, Reservation | null>();
  const conflicts: ReservationConflict[] = [];

  for (const process of activeProcesses) {
    processesByPort.set(process.port, process);
    reservationByPid.set(
      process.pid,
      resolveReservation(process, config.reservations),
    );
  }

  const reservationTargets = new Map<
    number,
    Array<{ process: ProcessRecord; reservation: Reservation }>
  >();
  for (const process of activeProcesses) {
    const reservation = reservationByPid.get(process.pid);
    if (!reservation) {
      continue;
    }

    const existing = reservationTargets.get(reservation.port) ?? [];
    existing.push({ process, reservation });
    reservationTargets.set(reservation.port, existing);
  }

  const conflictedPorts = new Set<number>();
  for (const [port, matches] of reservationTargets.entries()) {
    const distinctProcesses = new Map(matches.map((match) => [match.process.pid, match]));
    if (distinctProcesses.size <= 1) {
      continue;
    }

    conflictedPorts.add(port);
    conflicts.push({
      port,
      processes: [...distinctProcesses.values()].map((match) => match.process),
      reservations: [...distinctProcesses.values()].map((match) => match.reservation),
    });
  }

  const migrations: MigrationPlan[] = [];
  for (const process of activeProcesses) {
    const reservation = reservationByPid.get(process.pid);
    if (!reservation || reservation.port === process.port) {
      continue;
    }

    if (conflictedPorts.has(reservation.port)) {
      continue;
    }

    const occupier = processesByPort.get(reservation.port) ?? null;
    if (!occupier || occupier.pid === process.pid) {
      migrations.push({ process, reservation, occupier: null });
      continue;
    }

    const occupierReservation = reservationByPid.get(occupier.pid);
    if (occupierReservation) {
      conflicts.push({
        port: reservation.port,
        processes: [process, occupier],
        reservations: [reservation, occupierReservation],
      });
      conflictedPorts.add(reservation.port);
      continue;
    }

    migrations.push({ process, reservation, occupier });
  }

  return {
    blocked,
    migrations: migrations.filter(
      (migration) => !conflictedPorts.has(migration.reservation.port),
    ),
    conflicts,
  };
}
