import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    // Expose WEREAD_* from .env to the client (e.g. WEREAD_API_KEY, WEREAD_API_URL).
    envPrefix: ["VITE_", "WEREAD_"],
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // Allow ngrok and other tunnel Host headers in dev (avoids Vite "Blocked request").
      allowedHosts: [".ngrok-free.app", ".ngrok.io", ".ngrok.app", "localhost"],
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
