import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

// The hand-written DSA modules live in ../dsa and are shared by the browser
// (live animation, instant re-routing) and the Express backend.
const dsaDir = fileURLToPath(new URL('../dsa', import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@dsa': dsaDir } },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    proxy: { '/api': 'http://localhost:4000' },
  },
});
