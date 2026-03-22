import {
  useEffect,
  useLayoutEffect,
  useRef,
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

    const anchorBounds = anchorRef.current.getBoundingClientRect();
    const popoverBounds = contentRef.current.getBoundingClientRect();
    const roomBelow = window.innerHeight - anchorBounds.bottom;
    const roomAbove = anchorBounds.top;

    const nextPlacement =
      roomBelow < popoverBounds.height + 18 && roomAbove > roomBelow ? 'top' : 'bottom';
    contentRef.current.dataset.placement = nextPlacement;
    contentRef.current.classList.toggle('popover-top', nextPlacement === 'top');
    contentRef.current.classList.toggle('popover-bottom', nextPlacement === 'bottom');
  }, [anchorRef, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className={`popover popover-bottom popover-${align}`}
      data-placement="bottom"
      ref={contentRef}
    >
      {children}
    </div>
  );
}
