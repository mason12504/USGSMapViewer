import React, { useState } from 'react';
import { AlertTriangle, BookOpen, CheckCircle2, ChevronDown, ChevronRight, CornerDownRight, HelpCircle, Maximize2, MousePointerClick, X } from 'lucide-react';
import Swatch from './Swatch.jsx';
import DescriptionReader from './DescriptionReader.jsx';
import { describePaint } from '../lib/color/paint.js';

export default function UnitDetails({ entry, label, identify, swatchUrl, legendByKey, onClose }) {
  if (!entry) {
    return (
      <Card onClose={onClose}>
        <div className="flex items-center gap-2 text-slate-300">
          <HelpCircle size={18} /> No legend unit is painted here.
        </div>
        {identify?.paintKey && <p className="mt-2 text-xs text-slate-500">Paint at this point: {identify.paintKey}</p>}
      </Card>
    );
  }

  return (
    <Card onClose={onClose} testId="unit-details">
      <div className="flex items-start gap-4">
        <Swatch entry={entry} url={swatchUrl} className="h-16 w-32 shrink-0" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-mono text-sm font-semibold text-emerald-300" data-testid="unit-code">
              {entry.code}
            </span>
            {entry.age && <span className="text-xs text-slate-400">{entry.age.period}</span>}
          </div>
          <h2 className="mt-1 text-lg font-semibold leading-snug" data-testid="unit-name">
            {entry.name}
          </h2>
          {entry.ageText && <p className="text-sm text-slate-300">{entry.ageText}</p>}
          {(entry.parent || entry.group) && (
            <p className="mt-1 flex items-center gap-1 text-xs text-slate-400">
              <CornerDownRight size={12} />
              {entry.parent ? `${entry.parent.name} (${entry.parent.code})` : entry.group.name}
            </p>
          )}
        </div>
      </div>

      {entry.description && <p className="mt-3 text-sm leading-relaxed text-slate-300">{entry.description}</p>}
      {entry.report && <FullDescription key={entry.key} entry={entry} swatchUrl={swatchUrl} />}

      {label && <ColorCheck label={label} legendByKey={legendByKey} />}
      {label?.read && <ReadNote read={label.read} />}
      {identify && (
        <div className="mt-3 rounded-lg bg-sky-500/10 p-2 text-xs text-sky-200" data-testid="identify-note">
          <p className="flex items-center gap-2">
            <MousePointerClick size={14} className="shrink-0" />
            {identify.via === 'raster'
              ? 'Identified by comparing the color at the point you clicked with each legend swatch (experimental).'
              : 'Identified from the color/pattern at the point you clicked (experimental).'}
          </p>
          {identify.candidates?.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 pl-6" data-testid="identify-candidates">
              {identify.candidates.map((c) => (
                <li key={c.key}>
                  <span className="font-mono">{c.keys.map((k) => legendByKey[k]?.code ?? k).join(' / ')}</span>
                  {legendByKey[c.key] && <span className="text-sky-300/80"> {legendByKey[c.key].name}</span>}
                  <span className="text-sky-300/60"> {Math.round(c.fraction * 100)}%</span>
                </li>
              ))}
            </ul>
          )}
          {identify.via === 'raster' && <p className="mt-1.5 pl-6 text-sky-300/70">Look-alike units share a color; the list shows the closest.</p>}
        </div>
      )}

      {entry.swatch && (
        <p className="mt-3 text-xs text-slate-500">
          Legend paint: {describePaint(entry.swatch.paint)} · {entry.labelCount ?? 0} labels on map
          {entry.source === 'ai' ? ' · legend read by AI' : ''}
        </p>
      )}
    </Card>
  );
}

/** Brief by default (the plate's legend line above); the report's full text on demand. */
function FullDescription({ entry, swatchUrl }) {
  const [open, setOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-testid="full-description-toggle"
        className="flex w-full items-center gap-2 rounded-lg bg-slate-700/40 px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-700/70"
      >
        <Chevron size={14} className="shrink-0" />
        <span className="flex-1">{open ? 'Hide full description' : 'Full description'}</span>
        <span className="flex items-center gap-1 text-xs text-slate-400">
          <BookOpen size={12} /> {entry.report.page ? `report p.${entry.report.page}` : 'from the legend'}
        </span>
      </button>
      {open && (
        <div className="relative mt-2 rounded-lg border border-slate-700 bg-slate-900/60">
          <button
            type="button"
            onClick={() => setReading(true)}
            title="Open in a larger reader"
            aria-label="Expand description"
            data-testid="full-description-expand"
            className="absolute right-1.5 top-1.5 rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
          >
            <Maximize2 size={14} />
          </button>
          <div className="max-h-56 overflow-y-auto p-3 pr-9" data-testid="full-description-text">
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-200">{entry.report.text}</p>
            {entry.report.truncated && <p className="mt-2 text-xs text-amber-300">Long description: showing the first part only.</p>}
          </div>
        </div>
      )}
      {reading && <DescriptionReader entry={entry} swatchUrl={swatchUrl} onClose={() => setReading(false)} />}
    </div>
  );
}

/** How a label on a scanned map was read: by OCR, or by Claude from a cropped picture. */
function ReadNote({ read }) {
  const how = read.by?.startsWith('ai') ? `Read by Claude from a cropped image of the label${read.by.startsWith('ai-reread') ? ' (read a second time with the full legend list)' : ''}` : read.by === 'ocr+legend'
    ? `Read by OCR as “${read.ocrText}” and matched to the closest legend code` : 'Read by OCR and matched to a legend code';
  const unsure = read.confidence && read.confidence !== 'high' ? ` (${read.confidence} confidence)` : '';
  return (
    <div className="mt-3" data-testid="read-note">
      <Note icon={HelpCircle} tone={unsure ? 'amber' : 'slate'}>{how}{unsure}. Scanned maps can contain misreads.</Note>
    </div>
  );
}

function ColorCheck({ label, legendByKey }) {
  const c = label.color;
  const notes = [];
  if (label.uncertain) notes.push(<Note key="u" icon={HelpCircle} tone="slate">Marked “?” on the map: uncertain identification.</Note>);
  if (!c) return notes.length ? <div className="mt-3 space-y-2">{notes}</div> : null;

  const names = (keys) => keys.map((k) => `${legendByKey[k]?.code ?? k}${legendByKey[k] ? ` (${legendByKey[k].name})` : ''}`).join(' or ');
  if (c.method === 'raster') {
    // Scans: is a block of the label's unit color near the label? (see src/lib/scan/colorCheck.js)
    if (c.verdict === 'conflict') {
      const name = (k) => `${legendByKey[k]?.code ?? k}${legendByKey[k] ? ` (${legendByKey[k].name})` : ''}`;
      notes.push(
        <Note key="c" icon={AlertTriangle} tone="amber">
          The color under the text is {c.suggest.map(name).join(' or ')}'s, a near-twin of this code.
          {c.nearestPt != null ? ` This unit's own color is ${c.nearestPt} pt away.` : ' This unit\'s own color is not nearby.'} Did the label mean {c.suggest.map((k) => legendByKey[k]?.code ?? k).join(' or ')}?
        </Note>,
      );
    } else if (c.directAgrees) {
      notes.push(<Note key="c" icon={CheckCircle2} tone="green">This unit's legend color is right at the label.</Note>);
    } else if (c.agrees) {
      notes.push(
        <Note key="c" icon={CheckCircle2} tone="green">
          A block of this unit's legend color is {c.nearestPt} pt from the label, not under the text (a leader line, or the next polygon over).
        </Note>,
      );
    } else if (c.predicted.length) {
      notes.push(
        <Note key="c" icon={AlertTriangle} tone="amber">
          No block of this unit's color near the label; the nearest legend color is {names(c.predicted)}. The label may be misread, or point further away.
        </Note>,
      );
    } else {
      notes.push(<Note key="c" icon={HelpCircle} tone="slate">No legend color found around this label (a margin or an unmatched color).</Note>);
    }
    return <div className="mt-3 space-y-2" data-testid="color-check">{notes}</div>;
  }
  if (c.agrees && c.via === 'leader') {
    notes.push(<Note key="c" icon={CheckCircle2} tone="green">Color/pattern matches the legend, via the leader line (label sits outside its polygon).</Note>);
  } else if (c.agrees) {
    notes.push(<Note key="c" icon={CheckCircle2} tone="green">Color/pattern under this label matches the legend swatch.</Note>);
  } else if (c.predicted.length) {
    notes.push(
      <Note key="c" icon={AlertTriangle} tone="amber">
        Color/pattern here looks like {names(c.predicted)}. The label may point to a nearby polygon or sit on a contact.
      </Note>,
    );
  } else {
    notes.push(<Note key="c" icon={HelpCircle} tone="slate">No legend color found under this label.</Note>);
  }
  return <div className="mt-3 space-y-2" data-testid="color-check">{notes}</div>;
}

const TONES = {
  green: 'bg-emerald-500/10 text-emerald-200',
  amber: 'bg-amber-500/10 text-amber-200',
  slate: 'bg-slate-700/40 text-slate-300',
};

function Note({ icon: Icon, tone, children }) {
  return (
    <p className={`flex items-start gap-2 rounded-lg p-2 text-xs ${TONES[tone]}`}>
      <Icon size={14} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function Card({ children, onClose, testId }) {
  return (
    <section className="relative rounded-xl border border-slate-700 bg-slate-800/80 p-4 shadow-xl" data-testid={testId}>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-2 top-2 rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
      >
        <X size={16} />
      </button>
      {children}
    </section>
  );
}
