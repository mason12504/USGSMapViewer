import React, { useEffect, useState } from 'react';
import { Link, NavLink, useMatch } from 'react-router-dom';
import { ChevronRight, Library, Map } from 'lucide-react';
import { listLibrary } from '../libraryApi.js';

const linkClass = ({ isActive }) =>
  `flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm ${isActive ? 'bg-slate-800 text-slate-100' : 'text-slate-300 hover:bg-slate-800'}`;

/** Slim bar on every page: home, catalog, and which map is open. */
export default function NavBar() {
  const viewing = useMatch('/mapviewer/:id');
  const id = viewing?.params.id;
  const [title, setTitle] = useState(null);

  useEffect(() => {
    setTitle(null);
    if (!id) return undefined;
    let live = true;
    listLibrary().then((list) => live && setTitle(list.find((m) => m.id === id)?.title || null)).catch(() => {});
    return () => { live = false; };
  }, [id]);

  return (
    <nav className="flex items-center gap-2 border-b border-slate-800 bg-slate-950 px-4 py-1.5" data-testid="navbar">
      <Link to="/" className="flex items-center gap-2 font-semibold text-slate-100" data-testid="nav-home">
        <span className="rounded-md bg-emerald-500/10 p-1 text-emerald-400"><Map size={16} /></span>
        Geologic Map Explorer
      </Link>
      <NavLink to="/catalog" className={linkClass} data-testid="nav-catalog">
        <Library size={14} /> Catalog
      </NavLink>
      {id && (
        <span className="flex min-w-0 items-center gap-1 text-sm text-slate-400" data-testid="nav-current-map">
          <ChevronRight size={14} className="shrink-0" />
          <span className="truncate text-slate-200">{title || id}</span>
        </span>
      )}
    </nav>
  );
}
