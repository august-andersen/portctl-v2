import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
} from '@dnd-kit/sortable';

import type { ProcessRecord } from '@shared/types';

import { ProcessCard, type CardActionHandlers } from './Card';

interface CardGridProps extends CardActionHandlers {
  processes: ProcessRecord[];
  pinnedPorts: number[];
  pendingPorts: number[];
  startablePorts: number[];
  onReorder: (ports: number[]) => void;
}

export function CardGrid({
  processes,
  pinnedPorts,
  pendingPorts,
  startablePorts,
  onReorder,
  ...handlers
}: CardGridProps): JSX.Element {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
  );

  return (
    <DndContext
      collisionDetection={closestCenter}
      onDragEnd={(event) => {
        const { active, over } = event;
        if (!over || active.id === over.id) {
          return;
        }

        const activeIndex = processes.findIndex((processRecord) => processRecord.port === active.id);
        const overIndex = processes.findIndex((processRecord) => processRecord.port === over.id);
        if (activeIndex === -1 || overIndex === -1) {
          return;
        }

        const nextOrder = arrayMove(processes, activeIndex, overIndex).map(
          (processRecord) => processRecord.port,
        );
        onReorder(nextOrder);
      }}
      sensors={sensors}
    >
      <SortableContext
        items={processes.map((processRecord) => processRecord.port)}
        strategy={rectSortingStrategy}
      >
        <div className="grid-layout">
          {processes.map((processRecord) => (
            <ProcessCard
              key={processRecord.port}
              canStart={startablePorts.includes(processRecord.port)}
              isPending={pendingPorts.includes(processRecord.port)}
              isPinned={pinnedPorts.includes(processRecord.port)}
              processRecord={processRecord}
              {...handlers}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
