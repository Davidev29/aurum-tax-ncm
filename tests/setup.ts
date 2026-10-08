/**
 * Pré-carregamento dos testes.
 *
 * Banco: SQLite via Prisma (substitui `fake-indexeddb`/Dexie).
 *
 * - Garante o banco-template (`AURUM_TEST_TEMPLATE`, com o schema aplicado
 *   via `prisma db push` — criado uma vez por worker);
 * - registra o driver Prisma (`driver-prisma.ts`); cada arquivo de teste ganha
 *   um banco PRÓPRIO (cópia do template em `prisma-no.ts`), ou seja, isolamento
 *   total entre arquivos sem custo de `db push` por arquivo.
 * - `db.delete()` continua disponível para reset dentro do arquivo.
 *
 * Shims mínimos de navegador para testes `node` que importam stores da UI
 * (`src/store/ui.ts` lê `localStorage`/tema no carregamento do módulo).
 * Não afetam os testes existentes: só preenchem o que não existe.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registrarDriverPrisma } from '@/infrastructure/db/driver-prisma'

{
  const raiz = process.cwd()
  // O nome leva o hash do schema: qualquer mudança de schema invalida
  // templates antigos (PIDs são reciclados pelo SO — nunca confie só no pid).
  const hashSchema = createHash('sha256')
    .update(readFileSync(join(raiz, 'prisma', 'schema.prisma')))
    .digest('hex')
    .slice(0, 12)
  const template = join(tmpdir(), `aurum-test-template-${hashSchema}.db`)
  if (!existsSync(template)) {
    // Workers paralelos disputam a criação: lock exclusivo (`wx` é atômico).
    // Quem perde aguarda o template ficar pronto; lock órfão (>120s) é tomado.
    const lock = `${template}.lock`
    let dono = false
    try {
      writeFileSync(lock, String(process.pid), { flag: 'wx' })
      dono = true
    } catch {
      dono = false
    }
    if (dono) {
      try {
        execFileSync(
          process.execPath,
          [join('node_modules', 'prisma', 'build', 'index.js'), 'db', 'push', '--accept-data-loss', '--skip-generate'],
          {
            cwd: raiz,
            env: { ...process.env, DATABASE_URL: `file:${template}` },
            stdio: 'ignore',
          },
        )
      } finally {
        try {
          rmSync(lock, { force: true })
        } catch {
          /* best-effort */
        }
      }
    } else {
      const inicio = Date.now()
      for (;;) {
        if (existsSync(template)) break
        try {
          const nasc = statSync(lock).mtimeMs
          if (Date.now() - nasc > 120_000) {
            rmSync(lock, { force: true })
            continue
          }
        } catch {
          if (existsSync(template)) break
        }
        if (Date.now() - inicio > 120_000) {
          throw new Error(`setup: template SQLite não ficou pronto: ${template}`)
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200)
      }
    }
  }
  process.env.AURUM_TEST_TEMPLATE = template
  registrarDriverPrisma()
}

{
  const g = globalThis as Record<string, unknown>
  if (typeof g.localStorage === 'undefined') {
    const mem = new Map<string, string>()
    g.localStorage = {
      getItem: (k: string) => mem.get(String(k)) ?? null,
      setItem: (k: string, v: string) => void mem.set(String(k), String(v)),
      removeItem: (k: string) => void mem.delete(String(k)),
      clear: () => mem.clear(),
    }
  }
  if (typeof g.window === 'undefined') {
    g.window = {
      matchMedia: () => ({
        matches: false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
      setTimeout: setTimeout.bind(globalThis),
      clearTimeout: clearTimeout.bind(globalThis),
      requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0),
    }
  }
  if (typeof g.document === 'undefined') {
    g.document = {
      documentElement: { classList: { toggle: () => undefined } },
      getElementById: () => null,
    }
  }
}
