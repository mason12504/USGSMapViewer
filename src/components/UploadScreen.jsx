import React, { useRef, useState } from 'react';
import { Upload, Map } from 'lucide-react';

export default function UploadScreen({ onFile, error }) {
  const input = useRef(null);
  const [dragging, setDragging] = useState(false);

  const pick = (files) => {
    const f = files?.[0];
    if (f) onFile(f);
  };

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-xl text-center">
        <div className="mb-6 flex justify-center">
          <div className="rounded-2xl bg-emerald-500/10 p-4 text-emerald-400">
            <Map size={40} />
          </div>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Geologic Map Explorer</h1>
        <p className="mt-2 text-slate-400">
          Drop a USGS or state-survey geologic map PDF. Unit labels and the legend are read straight from the
          PDF; click any label to see its unit.
        </p>

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
          className={`mt-8 flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed p-10 transition-colors ${
            dragging ? 'border-emerald-400 bg-emerald-500/10' : 'border-slate-700 hover:border-slate-500'
          }`}
        >
          <Upload className="text-slate-400" />
          <span className="font-medium">Choose a map PDF</span>
          <span className="text-sm text-slate-500">or drag it here — nothing is uploaded anywhere</span>
          <input
            ref={input}
            data-testid="file-input"
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => pick(e.target.files)}
          />
        </label>

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
