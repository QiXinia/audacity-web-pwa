import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';
import tailwindcss from '@tailwindcss/vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 支持通过环境变量配置 base，用于 GitHub Pages 子路径部署
// 默认 '/'，部署到 Pages 时设为 '/audacity-web-pwa/'
const APP_BASE = process.env.VITE_APP_BASE || '/';

export default defineConfig({
  base: APP_BASE,
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  plugins: [
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      manifestFilename: 'manifest.webmanifest',
      manifest: {
        name: 'Audacity Web - 音频编辑器',
        short_name: 'Audacity Web',
        description:
          '基于 Web 的多轨音频编辑器，灵感来自 Audacity，使用 React + Rust/WASM 构建',
        start_url: APP_BASE,
        scope: APP_BASE,
        display: 'standalone',
        background_color: '#0f0f1a',
        theme_color: '#ff5522',
        orientation: 'landscape',
        categories: ['productivity', 'music', 'utilities'],
        icons: [
          {
            src: `${APP_BASE}favicon.svg`,
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: `${APP_BASE}icon-192.png`,
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: `${APP_BASE}icon-512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,wasm,png,jpg,ico,woff,woff2,json}'],
        navigateFallback: `${APP_BASE}index.html`,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 86400,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|gif|webp|avif|svg)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'image-cache',
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    mockReset: true,
    // Bounded CI/container resources can otherwise leave fork workers unstarted.
    fileParallelism: false,
    maxWorkers: 1,
  },
});
