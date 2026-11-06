import React, { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Files, Library, Loader2, Upload } from 'lucide-react';
import { addPairToLibrary, addToLibrary } from '../libraryApi.js';

export default function HomePage() {
  const navigate = useNavigate();
  const input = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(null); // file name while it is being saved
  const [error, setError] = useState(null);
  const [twoFiles, setTwoFiles] = useState(false); // the plate + pamphlet form
  const [pair, setPair] = useState({ plate: null, pamphlet: null, title: '' });

  // Save into the map library (never twice: same bytes = same map), then open it. A duplicate goes to its catalog card.
  const run = async (label, save) => {
    if (saving) return;
    setError(null);
    setSaving(label);
    try {
      const saved = await save();
      if (saved.duplicate) navigate('/catalog', { state: { identified: { id: saved.id, title: saved.title } } });
      else navigate(`/mapviewer/${saved.id}`);
    } catch (err) {
      setError(err.message || String(err));
      setSaving(null);
    }
  };
  const pick = (files) => {
    const file = files?.[0];
    if (file) run(file.name, () => addToLibrary(file));
  };

  const setPart = (part, file) =>
    setPair((p) => ({ ...p, [part]: file, title: p.title || (part === 'plate' && file ? file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ') : '') }));
  const savePair = () => run(`${pair.title || pair.plate.name} (plate + pamphlet)`, () => addPairToLibrary({ plate: pair.plate, pamphlet: pair.pamphlet, title: pair.title.trim() || pair.plate.name.replace(/\.pdf$/i, '') }));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
        <header className="rounded-2xl border border-slate-800 bg-gradient-to-br from-emerald-500/10 to-slate-900 p-8 text-center" data-testid="welcome-banner">
          <h1 className="text-3xl font-semibold tracking-tight">Welcome to Geologic Map Explorer</h1>
          <p className="mx-auto mt-3 max-w-xl text-slate-400">
            Open a USGS or state-survey geologic map PDF, or a whole publication with the plate and its report text.
            Unit labels and the legend are read straight from the PDF; click a label to see its unit, or right-click a unit
            to focus on it.
          </p>
        </header>

        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pick(e.dataTransfer.files);
          }}
          className={`flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed p-12 transition-colors ${
            dragging ? 'border-emerald-400 bg-emerald-500/10' : 'border-slate-700 hover:border-slate-500'
          }`}
          data-testid="upload-box"
        >
          {saving ? <Loader2 className="animate-spin text-emerald-400" /> : <Upload className="text-slate-400" />}
          <span className="font-medium">{saving ? `Saving ${saving} to your map library…` : 'Choose a map or report PDF'}</span>
          <span className="text-center text-sm text-slate-500">
            or drag it here. It is saved in your map library (the map_library folder on this computer) and opens at its own link.
            A map you already have is recognized instead of saved twice.
          </span>
          <input
            ref={input}
            data-testid="file-input"
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            disabled={!!saving}
            onChange={(e) => pick(e.target.files)}
          />
        </label>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4" data-testid="two-file-section">
          <button
            type="button"
            onClick={() => setTwoFiles((v) => !v)}
            aria-expanded={twoFiles}
            data-testid="two-file-toggle"
            className="flex w-full items-center gap-2 text-left text-sm text-slate-300 hover:text-slate-100"
          >
            <Files size={16} className="text-slate-400" />
            Is your map two files, a plate and a pamphlet (unit descriptions)?
            <span className="ml-auto text-xs text-slate-500">{twoFiles ? 'hide' : 'add both'}</span>
          </button>
          {twoFiles && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <FilePick label="Plate (the map sheet)" testId="plate-input" file={pair.plate} onFile={(f) => setPart('plate', f)} disabled={!!saving} />
              <FilePick label="Pamphlet (unit descriptions)" testId="pamphlet-input" file={pair.pamphlet} onFile={(f) => setPart('pamphlet', f)} disabled={!!saving} />
              <label className="text-sm text-slate-300 sm:col-span-2">
                Name in the catalog
                <input
                  value={pair.title}
                  onChange={(e) => setPair((p) => ({ ...p, title: e.target.value }))}
                  data-testid="pair-title"
                  placeholder="e.g. Manitou Springs"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </label>
              <p className="text-xs text-slate-500 sm:col-span-2">
                Both files are kept in their own folder in map_library, and merged into one PDF (pamphlet pages first, plate last) that opens in the explorer.
              </p>
              <button
                type="button"
                onClick={savePair}
                disabled={!pair.plate || !pair.pamphlet || !!saving}
                data-testid="pair-submit"
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40 sm:col-span-2"
              >
                Save, merge and open
              </button>
            </div>
          )}
        </section>

        {error && (
          <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300" data-testid="upload-error">
            {error}
          </p>
        )}

        <Link
          to="/catalog"
          data-testid="catalog-banner"
          className="group flex items-center gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-5 transition-colors hover:border-emerald-500/50 hover:bg-slate-800/70"
        >
          <span className="rounded-xl bg-emerald-500/10 p-3 text-emerald-400"><Library size={24} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-lg font-medium">View catalog</span>
            <span className="block text-sm text-slate-400">Browse the maps already in your library and open one.</span>
          </span>
          <ArrowRight className="text-slate-500 transition-transform group-hover:translate-x-1 group-hover:text-emerald-400" />
        </Link>
      </div>
    </div>
  );
}

/** One PDF slot of the two-file form. */
function FilePick({ label, testId, file, onFile, disabled }) {
  return (
    <label className={`flex cursor-pointer flex-col gap-1 rounded-xl border border-dashed p-3 text-sm ${file ? 'border-emerald-500/50' : 'border-slate-700 hover:border-slate-500'}`}>
      <span className="text-slate-300">{label}</span>
      <span className="truncate text-xs text-slate-500" title={file?.name}>
        {file ? `${file.name} · ${(file.size / 1e6).toFixed(1)} MB` : 'Choose a PDF'}
      </span>
      <input type="file" accept="application/pdf,.pdf" className="hidden" data-testid={testId} disabled={disabled} onChange={(e) => onFile(e.target.files?.[0] || null)} />
    </label>
  );
}
