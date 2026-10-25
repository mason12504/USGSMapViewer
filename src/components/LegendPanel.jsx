import React, { useMemo, useState } from 'react';
import { BookOpen, Search } from 'lucide-react';
import Swatch from './Swatch.jsx';

export default function LegendPanel({ legend, swatches, activeKey, onSelect }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return legend;
    return legend.filter((e) =>
      e.code.toLowerCase().includes(s) || e.name.toLowerCase().includes(s) || (e.ageText || '').toLowerCase().includes(s));
  }, [legend, q]);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="relative mb-2">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-slate-500" />
        <input
          data-testid="legend-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search units…"
          className="w-full rounded-lg border border-slate-700 bg-slate-800 py-1.5 pl-8 pr-2 text-sm placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
        />
      </div>
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {shown.map((e) => (
          <li key={e.key}>
            <button
              type="button"
              data-testid="legend-item"
              data-code={e.code}
              onClick={() => onSelect(e)}
              className={`flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors ${
                activeKey === e.key ? 'bg-amber-500/15 ring-1 ring-amber-500/50' : 'hover:bg-slate-800'
              }`}
            >
              <Swatch entry={e} url={swatches[e.key]} className="h-6 w-12 shrink-0" />
              <span className="w-12 shrink-0 font-mono text-sm font-semibold text-slate-200">{e.code}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-slate-300" title={e.name}>
                {e.name}
              </span>
              {e.report && <BookOpen size={12} className="shrink-0 text-slate-500" aria-label="Full description available" />}
              <span className="shrink-0 text-xs tabular-nums text-slate-500">{e.labelCount}</span>
            </button>
          </li>
        ))}
        {!shown.length && <li className="p-2 text-sm text-slate-500">No units match “{q}”.</li>}
      </ul>
    </section>
  );
}
