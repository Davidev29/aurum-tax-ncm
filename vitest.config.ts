import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // Suíte I/O-heavy: seeds de ~28k linhas SQLite por arquivo + workers em
    // paralelo disputando disco. 30s evita flakes sob carga (padrão: 5s).
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      include: ['src/domain/**', 'src/application/**', 'src/infrastructure/**'],
      thresholds: {
        'src/domain/services/calculo.ts': { lines: 95, branches: 90 },
        'src/simples/calculo.ts': { lines: 90, branches: 85 },
      },
    },
  },
})
