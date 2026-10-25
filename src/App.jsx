import React, { useEffect, useMemo, useState } from 'react';
import { Bot, FileUp, Layers, Loader2, Map as MapIcon, Palette } from 'lucide-react';
import UploadScreen from './components/UploadScreen.jsx';
import MapViewer from './components/MapViewer.jsx';
import UnitDetails from './components/UnitDetails.jsx';
import LegendPanel from './components/LegendPanel.jsx';
import AiCompare from './components/AiCompare.jsx';
import { useMapParser } from './hooks/useMapParser.js';
import { getHealth } from './api.js';

export default function App() {
  const { state, load, identify, legendImage, showPlate, reset } = useMapParser();
  const [selection, setSelection] = useState(null); // {entry, label?, identify?}
  const [highlightKey, setHighlightKey] = useState(null);
  const [marker, setMarker] = useState(null);
  const [showColorCheck, setShowColorCheck] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [view, setView] = useState('map'); // 'map' | 'plate'
  const [showOther, setShowOther] = useState(true); // cross-section / chart labels in the plate view
  const [api, setApi] = useState(null);

  useEffect(() => {
    getHealth().then(setApi);
  }, []);

  const legendByKey = useMemo(
    () => Object.fromEntries((state.result?.legend || []).map((e) => [e.key, e])),
    [state.result],
  );

  const changeView = (v) => {
    setView(v);
    setMarker(null);
    if (v === 'plate') showPlate();
  };

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

  const { result, map, swatches, plate } = state;
  const plateReady = view === 'plate' && plate?.status === 'ready';
  const viewMap = plateReady ? plate : map;
  const viewLabels = plateReady && showOther ? [...result.labels, ...(result.plateLabels || [])] : result.labels;
  const doc = result.document;
  const mapBox = result.mapRegion.bbox;
  const inMapFrame = (x, y) => x >= mapBox.x0 && x <= mapBox.x1 && y >= mapBox.y0 && y <= mapBox.y1;
  const colorStats = result.color.vector || result.color.raster;

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-800 bg-slate-900 px-4 py-2">
        <h1 className="font-semibold">Geologic Map Explorer</h1>
        <span className="truncate text-sm text-slate-400" title={state.fileName}>{state.fileName}</span>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Chip testId="stat-units">{result.legend.length} units</Chip>
          <Chip testId="stat-labels">{result.labels.length} labels</Chip>
          {doc?.pageCount > 1 && <Chip title="The plate is the large sheet; the other pages are report text">plate p.{doc.plate.pageNumber} of {doc.pageCount}</Chip>}
          {doc?.report && <Chip testId="stat-descriptions" tone={doc.report.matched === result.legend.length ? 'green' : 'amber'}>{doc.report.matched} full descriptions</Chip>}
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
          <div className="flex rounded-lg bg-slate-800 p-0.5 text-sm" role="group" aria-label="View">
            <ViewButton active={view === 'map'} onClick={() => changeView('map')} icon={MapIcon} testId="view-map">Map</ViewButton>
            <ViewButton active={view === 'plate'} onClick={() => changeView('plate')} icon={Layers} testId="view-plate">Full plate</ViewButton>
          </div>
          {view === 'plate' && (
            <label className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-slate-300 hover:bg-slate-800" title="Unit codes on the cross-sections and the correlation chart">
              <input type="checkbox" checked={showOther} onChange={(e) => setShowOther(e.target.checked)} data-testid="toggle-other-labels" />
              Cross-section labels
            </label>
          )}
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
              setView('map');
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
        <div className="relative min-w-0 flex-1">
          {view === 'plate' && plate?.status !== 'ready' && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-slate-950/70 text-slate-300" data-testid="plate-loading">
              {plate?.status === 'error' ? <p className="text-red-300">Could not render the plate: {plate.error}</p> : <><Loader2 className="animate-spin text-emerald-400" size={28} /><p>Rendering the full plate…</p></>}
            </div>
          )}
          <MapViewer
            map={viewMap}
            labels={viewLabels}
            frame={plateReady ? mapBox : null}
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
              if (!inMapFrame(x, y)) return clearSelection(); // color identification only knows the map frame
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

function ViewButton({ active, onClick, icon: Icon, testId, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 ${active ? 'bg-slate-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}
    >
      <Icon size={14} /> {children}
    </button>
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
