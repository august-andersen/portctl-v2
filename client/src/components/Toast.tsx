import type { EventLevel } from '@shared/types';

export interface ToastItem {
  id: number;
  level: EventLevel;
  title: string;
  message: string;
}

interface ToastViewportProps {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}

export function ToastViewport({
  toasts,
  onDismiss,
}: ToastViewportProps): JSX.Element {
  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.level}`}>
          <strong>{toast.title}</strong>
          <div className="muted">{toast.message}</div>
          <div className="helper-row" style={{ marginTop: 10 }}>
            <button
              className="ghost-button"
              onClick={() => {
                onDismiss(toast.id);
              }}
              type="button"
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
