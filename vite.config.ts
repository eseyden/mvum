import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Relative base so the build works from any static host sub-path.
  base: './',
  // MapLibre alone is ~1 MB; the whole bundle is precached for offline use anyway.
  build: { chunkSizeWarningLimit: 1500 },
  worker: { format: 'es' },
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Lolo NF Motor Vehicle Use Maps',
        short_name: 'Lolo MVUM',
        description: 'Offline Lolo National Forest MVUM/OSVUM maps with your location and road open dates.',
        theme_color: '#2f5d3a',
        background_color: '#ece8dc',
        display: 'standalone',
        orientation: 'any',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell + the bundled manifest/roads/trails snapshot. Map files are large and
        // are stored on demand in IndexedDB instead (see src/lib/store.ts).
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}', 'data/*.{json,geojson}'],
        globIgnores: ['maps/**'],
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
        runtimeCaching: [
          {
            // Live USFS MVUM API calls: use the network when available, else the last response.
            urlPattern: /^https:\/\/apps\.fs\.usda\.gov\/arcx\/rest\/services\/EDW\/EDW_MVUM_0\d\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'usfs-mvum-api',
              networkTimeoutSeconds: 15,
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 24 * 3600 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
});
