import React, { useEffect, useState } from 'react';
import { Bot, Loader2, X } from 'lucide-react';
import { canvasToBase64, parseLegendWithAI } from '../api.js';

/**
 * Ask Claude to read the legend image and compare with the text parse.
 * A small, manual "eval": where do the two disagree? In the dev container the
 * API runs in mock mode, so this shows the saved response.
 */
export default function AiCompare({ legend, getLegendImage, onClose }) {
  const [state, setState] = useState({ status: 'working' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const canvas = await getLegendImage();
        if (!canvas) throw new Error('No legend region found to send.');
        const res = await parseLegendWithAI({
          imageBase64: canvasToBase64(canvas, { maxSide: 2400 }),
          candidateCodes: legend.map((e) => e.code),
        });
        if (!cancelled) setState({ status: 'done', ...res });
      } catch (err) {
        if (!cancelled) setState({ status: 'error', error: err.message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [legend, getLegendImage]);

  const rows = state.status === 'done' ? compare(legend, state.units) : [];
  const agree = rows.filter((r) => r.status === 'same').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" role="dialog" aria-modal="true">
      <div className="flex max-h-full w-full max-w-3xl flex-col rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        <header className="flex items-center gap-2 border-b border-slate-800 p-4">
          <Bot size={18} className="text-emerald-400" />
          <h2 className="font-semibold">AI legend check</h2>
          {state.mode && (
            <span className={`rounded px-2 py-0.5 text-xs ${state.mode === 'mock' ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
              {state.mode === 'mock' ? 'MOCK response' : `live · ${state.model}`}
            </span>
          )}
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto rounded p-1 text-slate-400 hover:bg-slate-800">
            <X size={18} />
          </button>
        </header>
        <div className="overflow-y-auto p-4">
          {state.status === 'working' && (
            <p className="flex items-center gap-2 text-slate-300">
              <Loader2 className="animate-spin" size={16} /> Sending the legend image to the API server…
            </p>
          )}
          {state.status === 'error' && <p className="text-red-300">{state.error}</p>}
          {state.status === 'done' && (
            <>
              <p className="mb-3 text-sm text-slate-400">
                Text parse and AI agree on {agree} of {rows.length} unit names.
              </p>
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-1 pr-2">Code</th>
                    <th className="py-1 pr-2">From PDF text</th>
                    <th className="py-1 pr-2">From AI</th>
                    <th className="py-1" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.code} className="border-t border-slate-800">
                      <td className="py-1.5 pr-2 font-mono">{r.code}</td>
                      <td className="py-1.5 pr-2 text-slate-300">{r.text || '—'}</td>
                      <td className="py-1.5 pr-2 text-slate-300">{r.ai || '—'}</td>
                      <td className="py-1.5 text-xs">
                        {r.status === 'same' ? <span className="text-emerald-400">same</span> : <span className="text-amber-400">{r.status}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function compare(legend, aiUnits) {
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const ai = new Map(aiUnits.map((u) => [u.code, u]));
  const codes = [...new Set([...legend.map((e) => e.code), ...aiUnits.map((u) => u.code)])];
  return codes.map((code) => {
    const t = legend.find((e) => e.code === code);
    const a = ai.get(code);
    let status = 'same';
    if (!t) status = 'AI only';
    else if (!a) status = 'text only';
    else if (norm(t.name) !== norm(a.name)) status = 'differs';
    return { code, text: t?.name, ai: a?.name, status };
  });
}
