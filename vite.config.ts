import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
// Served from https://<owner>.github.io/sola/. Override with BASE_PATH (must match scripts/build-sw.mjs, which reads the same variable).
export default defineConfig({ base: process.env.BASE_PATH ?? '/sola/', plugins: [react()], server: { host: '127.0.0.1', port: 4173, strictPort: true }, build: { rollupOptions: { input: { app: fileURLToPath(new URL('./index.html', import.meta.url)), restart: fileURLToPath(new URL('./restart.html', import.meta.url)) } } } });
