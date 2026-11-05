import React, { useEffect, useRef } from 'react';
import { Eye, EyeOff } from 'lucide-react';

/** Right-click menu for a unit: where it was clicked (client px), which unit, and whether the others are hidden. */
export default function UnitMenu({ x, y, entry, hiding, onHideOthers, onShowAll, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    const away = (e) => !ref.current?.contains(e.target) && onClose();
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', esc);
    window.addEventListener('wheel', onClose, { passive: true });
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', esc);
      window.removeEventListener('wheel', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  // Keep the menu on screen near the window's right and bottom edges.
  const left = Math.min(x, window.innerWidth - 220);
  const top = Math.min(y, window.innerHeight - 110);

  return (
    <div
      ref={ref}
      role="menu"
      data-testid="unit-menu"
      className="fixed z-50 w-52 overflow-hidden rounded-lg border border-slate-700 bg-slate-800 py-1 text-sm shadow-xl"
      style={{ left, top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="truncate border-b border-slate-700 px-3 py-1.5 text-xs text-slate-400" title={entry.name}>
        <span className="font-mono font-semibold text-slate-200">{entry.code}</span> {entry.name}
      </div>
      <button type="button" role="menuitem" data-testid="hide-other-units" onClick={() => { onHideOthers(entry); onClose(); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-slate-200 hover:bg-slate-700">
        <EyeOff size={14} /> Hide other units
      </button>
      {hiding && (
        <button type="button" role="menuitem" data-testid="show-all-units" onClick={() => { onShowAll(); onClose(); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-slate-200 hover:bg-slate-700">
          <Eye size={14} /> Show all units
        </button>
      )}
    </div>
  );
}
