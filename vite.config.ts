import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    // BUILD completa anti-reversão: minify agressivo + sem sourcemap.
    // A ofuscação pesada (stringArray) roda em `scripts/ofuscar-build.cjs`
    // sobre os chunks gerados — aqui o Vite já entrega tudo minificado.
    minify: 'esbuild',
    sourcemap: false,
    cssMinify: true,
    reportCompressedSize: true,
    // Sem `manualChunks`: o rolldown (Vite 8) faz o próprio agrupamento e já
    // separa corretamente os imports dinâmicos (pdfmake, xlsx e Chart.js).
  },
  esbuild: {
    legalComments: 'none',
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
  },
})
