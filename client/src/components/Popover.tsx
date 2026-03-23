import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';

interface PopoverProps {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: 'left' | 'right';
}

export function Popover({
  anchorRef,
  open,
  onClose,
  children,
  align = 'left',
}: PopoverProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [positionStyle, setPositionStyle] = useState<CSSProperties>({
    visibility: 'hidden',
  });
  const [placement, setPlacement] = useState<'top' | 'bottom'>('bottom');

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (contentRef.current?.contains(target) || anchorRef.current?.contains(target)) {
        return;
      }

      onClose();
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [anchorRef, onClose, open]);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !contentRef.current) {
      return;
    }

    const viewportPadding = 12;
    const gap = 8;

    const updatePosition = (): void => {
      if (!anchorRef.current || !contentRef.current) {
        return;
      }

      const anchorBounds = anchorRef.current.getBoundingClientRect();
      const popoverWidth = contentRef.current.offsetWidth;
      const popoverHeight = contentRef.current.offsetHeight;
      const roomBelow = window.innerHeight - anchorBounds.bottom - viewportPadding;
      const roomAbove = anchorBounds.top - viewportPadding;
      const nextPlacement =
        roomBelow < popoverHeight + gap && roomAbove > roomBelow ? 'top' : 'bottom';
      const availableRoom = Math.max(
        0,
        (nextPlacement === 'top' ? roomAbove : roomBelow) - gap,
      );
      const visibleHeight = Math.min(popoverHeight, availableRoom);
      const preferredLeft =
        align === 'right' ? anchorBounds.right - popoverWidth : anchorBounds.left;
      const maxLeft = Math.max(
        viewportPadding,
        window.innerWidth - viewportPadding - popoverWidth,
      );
      const left = Math.min(Math.max(preferredLeft, viewportPadding), maxLeft);
      const top =
        nextPlacement === 'top'
          ? Math.max(viewportPadding, anchorBounds.top - visibleHeight - gap)
          : Math.min(
              anchorBounds.bottom + gap,
              window.innerHeight - viewportPadding - visibleHeight,
            );

      setPlacement(nextPlacement);
      setPositionStyle({
        left: `${left}px`,
        maxHeight: `${availableRoom}px`,
        top: `${top}px`,
        visibility: 'visible',
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [align, anchorRef, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className={`popover popover-${placement}`}
      data-placement={placement}
      ref={contentRef}
      style={positionStyle}
    >
      {children}
    </div>
  );
}
