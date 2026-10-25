import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// pdf.js needs a few static asset folders at runtime (JBIG2/JPX wasm decoders,
// standard fonts, CMaps). Serve them from node_modules in dev and copy them
// into the build, so nothing is fetched from a CDN.
const PDFJS_ASSETS = ['wasm', 'standard_fonts', 'cmaps'];
const pdfjsRoot = path.resolve('node_modules/pdfjs-dist');

function pdfjsAssets() {
  return {
    name: 'pdfjs-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const rel = decodeURIComponent((req.url || '').split('?')[0]).replace(/^\/+/, '');
        const [dir] = rel.split('/');
        const file = path.join(pdfjsRoot, rel);
        if (!PDFJS_ASSETS.includes(dir) || !file.startsWith(pdfjsRoot + path.sep) || !fs.existsSync(file)) return next();
        if (file.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm');
        fs.createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const dir of PDFJS_ASSETS) {
        for (const name of fs.readdirSync(path.join(pdfjsRoot, dir))) {
          const src = path.join(pdfjsRoot, dir, name);
          if (fs.statSync(src).isFile()) {
            this.emitFile({ type: 'asset', fileName: `pdfjs/${dir}/${name}`, source: fs.readFileSync(src) });
          }
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), pdfjsAssets()],
  server: {
    proxy: {
      // The browser only ever talks to this dev server; /api is forwarded to
      // the API server (mock in the dev container, api-real when you opt in).
      '/api': process.env.API_TARGET || 'http://127.0.0.1:3001',
    },
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
});
