import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
} from '@dnd-kit/sortable';

import type { ProcessGroup } from '@shared/types';

import { ProcessCard, type CardActionHandlers } from './Card';

interface CardGridProps extends CardActionHandlers {
  groups: ProcessGroup[];
  pinnedPorts: number[];
  pendingIds: string[];
  startableIds: string[];
  onReorder: (ids: string[]) => void;
}

const SECTION_ORDER: Array<ProcessGroup['section']> = [
  'pinned',
  'processes',
  'system',
  'hidden',
];

const SECTION_LABELS: Record<ProcessGroup['section'], string> = {
  pinned: 'Pinned',
  processes: 'Processes',
  system: 'System',
  hidden: 'Hidden',
};

function reorderGroups(
  groups: ProcessGroup[],
  section: ProcessGroup['section'],
  activeId: string,
  overId: string,
): string[] {
  const sectionGroups = groups.filter((group) => group.section === section);
  const activeIndex = sectionGroups.findIndex((group) => group.id === activeId);
  const overIndex = sectionGroups.findIndex((group) => group.id === overId);
  if (activeIndex === -1 || overIndex === -1) {
    return groups.map((group) => group.id);
  }

  const reorderedSection = arrayMove(sectionGroups, activeIndex, overIndex);
  const sectionIdSet = new Set(sectionGroups.map((group) => group.id));
  const baseOrder = groups.filter((group) => !sectionIdSet.has(group.id));
  const nextGroups: ProcessGroup[] = [];

  for (const candidateSection of SECTION_ORDER) {
    if (candidateSection === section) {
      nextGroups.push(...reorderedSection);
      continue;
    }

    nextGroups.push(...baseOrder.filter((group) => group.section === candidateSection));
  }

  return nextGroups.map((group) => group.id);
}

export function CardGrid({
  groups,
  pinnedPorts,
  pendingIds,
  startableIds,
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

  const renderSection = (
    section: ProcessGroup['section'],
    options?: { emphasized?: boolean },
  ) => {
    const sectionGroups = groups.filter((group) => group.section === section);
    if (sectionGroups.length === 0) {
      return null;
    }

    return (
      <section
        className={`group-section${options?.emphasized ? ' group-section-pinned' : ''}`}
        key={section}
      >
        <div className="group-section-header">
          <h2>{SECTION_LABELS[section]}</h2>
          <span className="muted">{sectionGroups.length}</span>
        </div>

        <DndContext
          collisionDetection={closestCenter}
          onDragEnd={(event) => {
            const { active, over } = event;
            if (!over || active.id === over.id) {
              return;
            }

            onReorder(
              reorderGroups(groups, section, String(active.id), String(over.id)),
            );
          }}
          sensors={sensors}
        >
          <SortableContext
            items={sectionGroups.map((group) => group.id)}
            strategy={rectSortingStrategy}
          >
            <div className="grid-layout">
              {sectionGroups.map((group) => (
                <ProcessCard
                  compact={section === 'system'}
                  key={group.id}
                  canStart={startableIds.includes(group.id)}
                  group={group}
                  isPending={pendingIds.includes(group.id)}
                  isPinned={group.processes.some((processRecord) =>
                    pinnedPorts.includes(processRecord.port),
                  )}
                  {...handlers}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </section>
    );
  };

  const pinnedSection = renderSection('pinned', { emphasized: true });
  const remainingSections = SECTION_ORDER.filter((section) => section !== 'pinned')
    .map((section) => renderSection(section))
    .filter(Boolean);

  return (
    <div className="section-grid">
      {pinnedSection}
      {pinnedSection && remainingSections.length > 0 ? (
        <div className="section-divider" aria-hidden="true" />
      ) : null}
      {remainingSections.length > 0 ? (
        <div className="section-grid-rest">{remainingSections}</div>
      ) : null}
    </div>
  );
}
