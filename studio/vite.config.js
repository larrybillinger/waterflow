import { defineConfig } from 'vite';

/**
 * Waterflow build configuration.
 *
 * Shaders are imported as plain text with Vite's `?raw` suffix rather than through a
 * GLSL plugin. That keeps the build dependency-light and means a shader compile error
 * surfaces in the browser console with the real source, which matters a great deal when
 * debugging the solver.
 */
export default defineConfig({
  root: '.',
  base: './',

  server: {
    port: 8099,
    strictPort: false,
    host: true,
  },

  preview: {
    port: 8099,
    host: true,
  },

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        // Three.js is the bulk of the bundle and changes only when the dependency is
        // upgraded, so splitting it keeps the app chunk small and cacheable.
        // Vite 8 uses Rolldown, which takes a function here rather than an object map.
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          return null;
        },
      },
    },
  },

  // Shaders live next to the code that uses them and are loaded with ?raw.
  assetsInclude: ['**/*.glsl'],
});
