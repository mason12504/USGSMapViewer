import React from 'react';
import { paintColors } from '../lib/color/paint.js';

/**
 * Legend swatch preview: the real rendered swatch once it's ready, otherwise
 * the paint's colors as a placeholder (base color + accent dots).
 */
export default function Swatch({ entry, url, className = 'h-6 w-12' }) {
  if (url) {
    return <img src={url} alt={`${entry.code} swatch`} className={`${className} rounded border border-slate-600 object-cover`} />;
  }
  const [base = '#334155', ...accents] = entry.swatch ? paintColors(entry.swatch.paint) : [];
  const dots = accents.length
    ? { backgroundImage: `radial-gradient(${accents[0]} 18%, transparent 20%)`, backgroundSize: '6px 6px' }
    : {};
  return <div className={`${className} rounded border border-slate-600`} style={{ backgroundColor: base, ...dots }} />;
}
