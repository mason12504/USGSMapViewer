import React from 'react';
import { Navigate, Outlet, Route, Routes, useParams } from 'react-router-dom';
import NavBar from './components/NavBar.jsx';
import HomePage from './pages/HomePage.jsx';
import CatalogPage from './pages/CatalogPage.jsx';
import MapViewerPage from './pages/MapViewerPage.jsx';

// Pages: / (welcome + upload), /catalog (the map library), /mapviewer/:id (the explorer, one map).
function Layout() {
  return (
    <div className="flex h-full flex-col">
      <NavBar />
      <div className="min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}

// A different id is a different map: start the viewer from scratch.
function Viewer() {
  const { id } = useParams();
  return <MapViewerPage key={id} />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="catalog" element={<CatalogPage />} />
        <Route path="mapviewer/:id" element={<Viewer />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
