import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudflare } from '@cloudflare/vite-plugin'
import { fileURLToPath } from 'node:url'

const shared = fileURLToPath(new URL('./shared', import.meta.url))

export default defineConfig({
  plugins: [react(), cloudflare()],
  resolve: {
    alias: { '@shared': shared },
  },
  environments: {
    client: {
      build: {
        target: 'es2022',
        chunkSizeWarningLimit: 900,
        rollupOptions: {
          output: {
            // 3D 엔진과 지리 투영은 별도 청크로: 랜딩은 가볍게, 지구본은 지연 로딩
            manualChunks(id: string) {
              if (id.includes('node_modules/three')) return 'three'
              if (id.includes('node_modules/d3-geo') || id.includes('node_modules/topojson-client') || id.includes('node_modules/d3-array')) return 'geo'
              return undefined
            },
          },
        },
      },
    },
  },
  server: { port: 5173, strictPort: true },
})
