import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { natsume: fileURLToPath(new URL('../natsume/src/index.ts', import.meta.url)) },
  },
  // Native file events can be missed in the desktop execution environment.
  server: { watch: { usePolling: true, interval: 300 } },
});
