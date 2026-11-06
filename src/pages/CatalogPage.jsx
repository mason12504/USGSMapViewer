import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CheckCircle2, Loader2, MapIcon } from 'lucide-react';
import { fetchLibraryFile, libraryThumbUrl, listLibrary, saveThumb } from '../libraryApi.js';
import { openPdf, renderRegion } from '../pdf/pdfjs.browser.js';
import { classifyPages, pickPlate, readPageSizes } from '../lib/document.js';

const THUMB_LONG_SIDE = 520; // px
let thumbQueue = Promise.resolve(); // one thumbnail render at a time: these PDFs are big

/** Render the plate of a library map to a small JPEG blob (the big sheet, not a report page). */
async function renderThumb(item) {
  const file = await fetchLibraryFile(item);
  const doc = await openPdf(new Uint8Array(await file.arrayBuffer()));
  try {
    const plate = pickPlate(classifyPages(await readPageSizes(doc)));
    const page = await doc.getPage(plate.pageNumber);
    const scale = THUMB_LONG_SIDE / Math.max(plate.width, plate.height);
    const canvas = await renderRegion(page, { x0: 0, y0: 0, x1: plate.width, y1: plate.height }, scale);
    return await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no image'))), 'image/jpeg', 0.8));
  } finally {
    await doc.loadingTask.destroy(); // frees the worker's copy of the PDF
  }
}

const formatBytes = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

/** The saved thumbnail, or one rendered now (once) and saved for next time. */
function Thumb({ item }) {
  const [src, setSrc] = useState(libraryThumbUrl(item.id) + '?v=' + item.sha256.slice(0, 8));
  const [state, setState] = useState('loading'); // loading | ready | rendering | none
  const tried = useRef(false);

  const onError = () => {
    if (tried.current) return setState('none');
    tried.current = true;
    setState('rendering');
    thumbQueue = thumbQueue.then(async () => {
      try {
        const blob = await renderThumb(item);
        setSrc(URL.createObjectURL(blob));
        setState('ready');
        saveThumb(item.id, blob).catch(() => {}); // a failed save only means rendering again next visit
      } catch (err) {
        console.error(`thumbnail for ${item.id} failed`, err);
        setState('none');
      }
    });
  };

  return (
    <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-slate-800">
      {state !== 'none' && (
        <img
          src={src}
          alt=""
          onLoad={() => setState('ready')}
          onError={onError}
          className={`h-full w-full object-contain transition-opacity ${state === 'ready' ? 'opacity-100' : 'opacity-0'}`}
          data-testid="catalog-thumb"
        />
      )}
      {(state === 'loading' || state === 'rendering') && <Loader2 size={20} className="absolute animate-spin text-slate-500" />}
      {state === 'none' && <MapIcon size={32} className="text-slate-600" />}
    </div>
  );
}

export default function CatalogPage() {
  const identified = useLocation().state?.identified; // set when a dropped PDF was already in the library
  const [maps, setMaps] = useState(null);
  const [error, setError] = useState(null);
  const highlighted = useRef(null);

  useEffect(() => {
    listLibrary().then(setMaps).catch((e) => setError(e.message || String(e)));
  }, []);

  useEffect(() => {
    if (maps && identified) highlighted.current?.scrollIntoView({ block: 'center' });
  }, [maps, identified]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Catalog</h1>
        <p className="mt-1 text-sm text-slate-400">The maps in your library. Click one to open it in the explorer.</p>

        {identified && (
          <p role="status" data-testid="identified-banner" className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">
            <CheckCircle2 size={16} className="shrink-0" />
            Map identified as “{identified.title}”. It is already in your library, so nothing was saved again.
          </p>
        )}
        {error && <p role="alert" className="mt-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
        {!maps && !error && <Loader2 className="mt-8 animate-spin text-emerald-400" />}
        {maps && !maps.length && (
          <p className="mt-6 rounded-xl border border-dashed border-slate-700 p-6 text-sm text-slate-400" data-testid="catalog-empty">
            The library is empty. Drop a PDF on the <Link to="/" className="text-emerald-400 underline">home page</Link>, or put PDFs in the map_library folder.
          </p>
        )}

        <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="catalog-grid">
          {(maps || []).map((m) => {
            const hit = identified?.id === m.id;
            return (
              <li key={m.id} ref={hit ? highlighted : undefined}>
                <Link
                  to={`/mapviewer/${m.id}`}
                  data-testid="catalog-card"
                  data-id={m.id}
                  data-highlighted={hit || undefined}
                  className={`block overflow-hidden rounded-xl border bg-slate-900 transition-colors hover:border-emerald-500/60 ${hit ? 'border-emerald-400 ring-2 ring-emerald-400/50' : 'border-slate-800'}`}
                >
                  <Thumb item={m} />
                  <div className="p-3">
                    <h2 className="truncate font-medium" title={m.title}>{m.title}</h2>
                    <p className="mt-0.5 truncate text-xs text-slate-500" title={m.file}>{m.pair ? 'plate + pamphlet' : m.file} · {formatBytes(m.bytes)}</p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
