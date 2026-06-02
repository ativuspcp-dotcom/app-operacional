import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  server: {
    host: true,
    port: 3001,
    proxy: {
      '/api': {
        target: 'https://tableros.ngrok.app',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  },
  plugins: [
    basicSsl(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: {
        enabled: true
      },
      manifest: {
        name: 'Tableros Operacional',
        short_name: 'Operacional',
        description: 'App operacional de chão de fábrica',
        theme_color: '#569650',
        background_color: '#f5f5f0',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ]
});
