import React, { useEffect } from 'react';
import { BookOpen, X } from 'lucide-react';
import Swatch from './Swatch.jsx';

/** Large reader for one unit's full description (from the report text). */
export default function DescriptionReader({ entry, swatchUrl, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Full description of ${entry.name}`}
      onClick={onClose}
      data-testid="full-description-modal"
    >
      <div
        className="flex max-h-full w-full max-w-3xl flex-col rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start gap-3 border-b border-slate-800 p-4">
          <Swatch entry={entry} url={swatchUrl} className="h-10 w-20 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-mono text-sm font-semibold text-emerald-300">{entry.code}</span>
              <span className="flex items-center gap-1 text-xs text-slate-400">
                <BookOpen size={12} /> {entry.report.page ? `Report page ${entry.report.page}` : 'From the legend'}
              </span>
            </div>
            <h2 className="mt-1 text-lg font-semibold leading-snug">{entry.name}</h2>
            {entry.ageText && <p className="text-sm text-slate-300">{entry.ageText}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200">
            <X size={18} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <p className="whitespace-pre-line text-[15px] leading-7 text-slate-200" data-testid="full-description-modal-text">
            {entry.report.text}
          </p>
          {entry.report.truncated && (
            <p className="mt-3 text-xs text-amber-300">Long description: showing the first part only.</p>
          )}
        </div>
      </div>
    </div>
  );
}
