import React, { useEffect, useMemo, useState } from 'react';
import { Bot, FileUp, Loader2, Palette } from 'lucide-react';
import UploadScreen from './components/UploadScreen.jsx';
import MapViewer from './components/MapViewer.jsx';
import UnitDetails from './components/UnitDetails.jsx';
import LegendPanel from './components/LegendPanel.jsx';
import AiCompare from './components/AiCompare.jsx';
import { useMapParser } from './hooks/useMapParser.js';
import { getHealth } from './api.js';

export default function App() {
  const { state, load, identify, legendImage, reset } = useMapParser();
  const [selection, setSelection] = useState(null); // {entry, label?, identify?}
  const [highlightKey, setHighlightKey] = useState(null);
  const [marker, setMarker] = useState(null);
  const [showColorCheck, setShowColorCheck] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [api, setApi] = useState(null);

  useEffect(() => {
    getHealth().then(setApi);
  }, []);

  const legendByKey = useMemo(
    () => Object.fromEntries((state.result?.legend || []).map((e) => [e.key, e])),
    [state.result],
  );

  const clearSelection = () => {
    setSelection(null);
    setMarker(null);
    setHighlightKey(null);
  };

  if (state.status === 'idle' || state.status === 'error') {
    return <UploadScreen onFile={load} error={state.error} />;
  }

  if (state.status === 'working') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-300" data-testid="progress">
        <Loader2 className="animate-spin text-emerald-400" size={32} />
        <p className="font-medium">{state.stage}…</p>
        <p className="text-sm text-slate-500">{state.fileName}</p>
      </div>
    );
  }

  const { result, map, swatches } = state;
  const colorStats = result.color.vector || result.color.raster;

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-800 bg-slate-900 px-4 py-2">
        <h1 className="font-semibold">Geologic Map Explorer</h1>
        <span className="truncate text-sm text-slate-400" title={state.fileName}>{state.fileName}</span>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Chip testId="stat-units">{result.legend.length} units</Chip>
          <Chip testId="stat-labels">{result.labels.length} labels</Chip>
          {colorStats && (
            <Chip title={`${result.color.primary} strategy`}>
              color agrees {(colorStats.accuracy * 100).toFixed(0)}%
            </Chip>
          )}
          {api && (
            <Chip tone={api.mode === 'live' ? 'green' : api.ok ? 'amber' : 'red'}>
              API: {api.ok ? api.mode : 'offline'}
            </Chip>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-slate-300 hover:bg-slate-800">
            <input type="checkbox" checked={showColorCheck} onChange={(e) => setShowColorCheck(e.target.checked)} data-testid="toggle-color-check" />
            <Palette size={14} /> Color check
          </label>
          <button type="button" onClick={() => setAiOpen(true)} disabled={!api?.ok} className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40">
            <Bot size={14} /> AI legend check
          </button>
          <button
            type="button"
            onClick={() => {
              clearSelection();
              reset();
            }}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1 text-sm font-medium hover:bg-emerald-500"
          >
            <FileUp size={14} /> Open another
          </button>
        </div>
      </header>

      {result.warnings.length > 0 && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-sm text-amber-200">
          {result.warnings.map((w) => w.message).join(' ')}
        </div>
      )}

      <main className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <MapViewer
            map={map}
            labels={result.labels}
            selectedLabelId={selection?.label?.id}
            highlightKey={highlightKey}
            showColorCheck={showColorCheck}
            marker={marker}
            onLabelClick={(label) => {
              setMarker(null);
              setHighlightKey(null);
              setSelection({ entry: legendByKey[label.key], label });
            }}
            onMapClick={(x, y) => {
              const hit = identify(x, y);
              setMarker({ x, y });
              setHighlightKey(null);
              if (!hit) return setSelection(null);
              setSelection({ entry: hit.units.length ? legendByKey[hit.units[0]] : null, identify: hit });
            }}
          />
        </div>
        <aside className="flex w-96 shrink-0 flex-col gap-3 overflow-hidden border-l border-slate-800 bg-slate-900/60 p-3">
          {selection ? (
            <UnitDetails
              entry={selection.entry}
              label={selection.label}
              identify={selection.identify}
              swatchUrl={selection.entry ? swatches[selection.entry.key] : null}
              legendByKey={legendByKey}
              onClose={clearSelection}
            />
          ) : (
            <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">
              Click a unit label on the map, or anywhere on the map to identify the unit by its color.
              Pick a unit below to highlight its labels.
            </p>
          )}
          <LegendPanel
            legend={result.legend}
            swatches={swatches}
            activeKey={highlightKey}
            onSelect={(e) => {
              setMarker(null);
              setHighlightKey((k) => (k === e.key ? null : e.key));
              setSelection({ entry: e });
            }}
          />
        </aside>
      </main>

      {aiOpen && <AiCompare legend={result.legend} getLegendImage={legendImage} onClose={() => setAiOpen(false)} />}
    </div>
  );
}

const CHIP_TONES = {
  slate: 'bg-slate-800 text-slate-300',
  green: 'bg-emerald-500/15 text-emerald-300',
  amber: 'bg-amber-500/15 text-amber-300',
  red: 'bg-red-500/15 text-red-300',
};

function Chip({ children, tone = 'slate', title, testId }) {
  return (
    <span className={`rounded-full px-2 py-0.5 ${CHIP_TONES[tone]}`} title={title} data-testid={testId}>
      {children}
    </span>
  );
}
