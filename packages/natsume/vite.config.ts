import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: true,
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'natsume' },
    rolldownOptions: { external: ['pixi.js', 'fflate', 'flatbuffers', 'gl-matrix'] },
  },
});
