import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Accessible modal dialog: labelled, Escape closes, focus moves in, is trapped, and returns to the opener on close. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const box = ref.current;
    const first = box?.querySelector<HTMLElement>(FOCUSABLE);
    (first || box)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      } else if (e.key === 'Tab' && box) {
        const els = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (!els.length) return;
        const [a, z] = [els[0], els[els.length - 1]];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          z.focus();
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, []);

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} ref={ref} tabIndex={-1}>
        <div className="modal__head">
          <h2 id={`${id}-title`}>{title}</h2>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
            <Icon name="close" />
            <span className="visually-hidden">{t('common.close')}</span>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
