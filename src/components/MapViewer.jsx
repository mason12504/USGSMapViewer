import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Maximize, ZoomIn, ZoomOut } from 'lucide-react';

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 8;

function labelStyle(label, { selected, highlighted, showColorCheck }) {
  if (selected) return { stroke: '#10b981', fill: 'rgba(16,185,129,0.35)' };
  if (highlighted) return { stroke: '#f59e0b', fill: 'rgba(245,158,11,0.35)' };
  if (showColorCheck && label.color) {
    if (!label.color.predicted.length) return { stroke: '#94a3b8', fill: 'transparent' };
    return label.color.agrees
      ? { stroke: '#16a34a', fill: 'rgba(22,163,74,0.12)' }
      : { stroke: '#dc2626', fill: 'rgba(220,38,38,0.18)' };
  }
  return { stroke: 'rgba(16,185,129,0.7)', fill: 'transparent' };
}

export default function MapViewer({
  map,
  labels,
  selectedLabelId,
  highlightKey,
  showColorCheck,
  marker,
  onLabelClick,
  onMapClick,
}) {
  const scroller = useRef(null);
  const [zoom, setZoom] = useState(null); // screen px per page unit
  const { region } = map;
  const w = region.x1 - region.x0;
  const h = region.y1 - region.y0;

  const fit = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setZoom(Math.min(el.clientWidth / w, el.clientHeight / h) * 0.98);
  }, [w, h]);

  useLayoutEffect(() => {
    fit();
  }, [fit]);

  const zoomBy = useCallback((factor, anchor) => {
    const el = scroller.current;
    setZoom((z) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor));
      if (el && anchor) {
        // Keep the point under the cursor fixed while zooming.
        const k = next / z;
        requestAnimationFrame(() => {
          el.scrollLeft = (el.scrollLeft + anchor.x) * k - anchor.x;
          el.scrollTop = (el.scrollTop + anchor.y) * k - anchor.y;
        });
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return; // plain wheel scrolls
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, { x: e.clientX - r.left, y: e.clientY - r.top });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  const handleSvgClick = (e) => {
    const svg = e.currentTarget;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    onMapClick?.(p.x, p.y);
  };

  return (
    <div className="relative h-full w-full">
      <div ref={scroller} className="h-full w-full overflow-auto bg-slate-900" data-testid="map-scroller">
        {zoom && (
          <div className="relative mx-auto" style={{ width: w * zoom, height: h * zoom }}>
            <img
              src={map.url}
              alt="Geologic map"
              draggable={false}
              className="absolute inset-0 h-full w-full select-none"
              data-testid="map-image"
            />
            <svg
              className="absolute inset-0 h-full w-full cursor-crosshair"
              viewBox={`${region.x0} ${region.y0} ${w} ${h}`}
              onClick={handleSvgClick}
              data-testid="map-overlay"
            >
              {labels.map((l) => {
                const s = labelStyle(l, {
                  selected: l.id === selectedLabelId,
                  highlighted: highlightKey && l.key === highlightKey,
                  showColorCheck,
                });
                const pad = 1;
                return (
                  <rect
                    key={l.id}
                    data-testid="map-label"
                    data-code={l.code}
                    x={l.bbox.x0 - pad}
                    y={l.bbox.y0 - pad}
                    width={l.bbox.x1 - l.bbox.x0 + 2 * pad}
                    height={l.bbox.y1 - l.bbox.y0 + 2 * pad}
                    rx={1}
                    fill={s.fill}
                    stroke={s.stroke}
                    strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                    className="cursor-pointer hover:fill-sky-400/30"
                    onClick={(e) => {
                      e.stopPropagation();
                      onLabelClick(l);
                    }}
                  >
                    <title>{l.code}</title>
                  </rect>
                );
              })}
              {marker && (
                <circle
                  cx={marker.x}
                  cy={marker.y}
                  r={4}
                  fill="none"
                  stroke="#f43f5e"
                  strokeWidth={2.5}
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
              )}
            </svg>
          </div>
        )}
      </div>

      <div className="absolute bottom-4 left-4 flex gap-1 rounded-lg bg-slate-800/90 p-1 shadow-lg backdrop-blur">
        <IconButton label="Zoom in" onClick={() => zoomBy(1.3)}>
          <ZoomIn size={18} />
        </IconButton>
        <IconButton label="Zoom out" onClick={() => zoomBy(1 / 1.3)}>
          <ZoomOut size={18} />
        </IconButton>
        <IconButton label="Fit map" onClick={fit}>
          <Maximize size={18} />
        </IconButton>
        <span className="px-2 py-1.5 text-xs tabular-nums text-slate-400">
          {zoom ? `${Math.round(zoom * 100)}%` : ''}
        </span>
      </div>
    </div>
  );
}

function IconButton({ label, onClick, children }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="rounded-md p-1.5 text-slate-300 hover:bg-slate-700"
    >
      {children}
    </button>
  );
}
