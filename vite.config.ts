import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({ plugins: [react()], server: { host: '127.0.0.1', port: 4173, strictPort: true }, build: { rollupOptions: { input: { app: fileURLToPath(new URL('./index.html', import.meta.url)), restart: fileURLToPath(new URL('./restart.html', import.meta.url)) } } } });
