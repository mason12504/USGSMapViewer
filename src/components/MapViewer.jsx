import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Maximize, ScanSearch, ZoomIn, ZoomOut } from 'lucide-react';

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;
const PAD = 160; // screen px of free space around the sheet, so edges can be dragged to the middle
const DRAG_THRESHOLD = 5; // px a left-button drag must travel before it pans instead of clicking

function labelStyle(label, { selected, highlighted, showColorCheck }) {
  // Codes outside the map frame (cross-sections, correlation chart).
  if (label.other && !selected && !highlighted) return { stroke: 'rgba(56,189,248,0.8)', fill: 'rgba(56,189,248,0.10)' };
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
  frame,
  focus,
  onLabelClick,
  onMapClick,
}) {
  const scroller = useRef(null);
  const content = useRef(null);
  const pendingFocus = useRef(null);
  const drag = useRef(null);
  const lastDragEnd = useRef(0);
  const [grabbing, setGrabbing] = useState(false);
  const [zoom, setZoom] = useState(null); // screen px per page unit
  const { region } = map;
  const w = region.x1 - region.x0;
  const h = region.y1 - region.y0;

  const fit = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setZoom(Math.min(el.clientWidth / w, el.clientHeight / h) * 0.96);
    pendingFocus.current = region; // centre the whole sheet
  }, [w, h, region]);

  /** Zoom to a box in page units (the map frame) and centre on it. */
  const focusOn = useCallback((box) => {
    const el = scroller.current;
    if (!el || !box) return;
    const z = Math.min(el.clientWidth / (box.x1 - box.x0), el.clientHeight / (box.y1 - box.y0)) * 0.96;
    pendingFocus.current = box;
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)));
  }, []);

  // After a zoom change that asked for it, scroll so the box sits in the middle.
  useLayoutEffect(() => {
    const box = pendingFocus.current;
    const el = scroller.current;
    const c = content.current;
    if (!box || !el || !c || !zoom) return;
    pendingFocus.current = null;
    const cx = ((box.x0 + box.x1) / 2 - region.x0) * zoom;
    const cy = ((box.y0 + box.y1) / 2 - region.y0) * zoom;
    el.scrollLeft = c.offsetLeft + cx - el.clientWidth / 2;
    el.scrollTop = c.offsetTop + cy - el.clientHeight / 2;
  }, [zoom, region]);

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

  // Drag to pan, like moving a photo: middle button anywhere, or the left
  // button once it has moved a few pixels (so plain clicks still select).
  const onPointerDown = (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    const el = scroller.current;
    drag.current = { id: e.pointerId, button: e.button, x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, active: e.button === 1 };
    if (e.button === 1) {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      setGrabbing(true);
    }
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    const el = scroller.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.active && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      d.active = true;
      el.setPointerCapture(d.id);
      setGrabbing(true);
    }
    if (d.active) {
      el.scrollLeft = d.left - dx;
      el.scrollTop = d.top - dy;
    }
  };
  const endDrag = () => {
    // Only a left-button drag ends in a click event (middle fires auxclick).
    if (drag.current?.active && drag.current.button === 0) lastDragEnd.current = Date.now();
    drag.current = null;
    setGrabbing(false);
  };
  // A drag that ends over a label must not also count as a click on it.
  const swallowClickAfterDrag = (e) => {
    if (Date.now() - lastDragEnd.current < 250) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

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
      <div
        ref={scroller}
        className="relative h-full w-full overflow-auto bg-slate-900"
        style={{ cursor: grabbing ? 'grabbing' : undefined }}
        data-testid="map-scroller"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onMouseDown={(e) => e.button === 1 && e.preventDefault()} // no browser autoscroll
        onAuxClick={(e) => e.preventDefault()}
        onClickCapture={swallowClickAfterDrag}
      >
        {zoom && (
          <div style={{ padding: PAD, width: 'max-content', minWidth: '100%', boxSizing: 'border-box' }}>
          <div ref={content} className="relative mx-auto shadow-2xl" style={{ width: w * zoom, height: h * zoom }}>
            <img
              key={map.url}
              src={map.url}
              alt="Geologic map"
              draggable={false}
              className="absolute inset-0 h-full w-full select-none"
              data-testid="map-image"
            />
            <svg
              className={`absolute inset-0 h-full w-full ${grabbing ? 'cursor-grabbing' : 'cursor-crosshair'}`}
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
              {frame && (
                <rect
                  x={frame.x0}
                  y={frame.y0}
                  width={frame.x1 - frame.x0}
                  height={frame.y1 - frame.y0}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth={1.5}
                  strokeDasharray="8 5"
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                  data-testid="map-frame"
                />
              )}
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
        <IconButton label="Fit whole sheet" onClick={fit}>
          <Maximize size={18} />
        </IconButton>
        {focus && (
          <IconButton label="Zoom to the map" onClick={() => focusOn(focus)} testId="zoom-to-map">
            <ScanSearch size={18} />
          </IconButton>
        )}
        <span className="px-2 py-1.5 text-xs tabular-nums text-slate-400">
          {zoom ? `${Math.round(zoom * 100)}%` : ''}
        </span>
      </div>
    </div>
  );
}

function IconButton({ label, onClick, children, testId }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      data-testid={testId}
      onClick={onClick}
      className="rounded-md p-1.5 text-slate-300 hover:bg-slate-700"
    >
      {children}
    </button>
  );
}
