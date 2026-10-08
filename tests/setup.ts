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
import { closeSync, existsSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { registrarDriverPrisma } from '@/infrastructure/db/driver-prisma'

/** Magic bytes do SQLite (`SQLite format 3\0`) sem carregar o arquivo. */
function magiaSqlite(caminho: string): string {
  const fd = openSync(caminho, 'r')
  try {
    const buf = Buffer.alloc(16)
    if (readSync(fd, buf, 0, 16, 0) !== 16) return ''
    return buf.toString('utf8')
  } finally {
    try {
      closeSync(fd)
    } catch {
      /* best-effort */
    }
  }
}

{
  const raiz = process.cwd()
  // O nome leva o hash do schema: qualquer mudança de schema invalida
  // templates antigos (PIDs são reciclados pelo SO — nunca confie só no pid).
  const hashSchema = createHash('sha256')
    .update(readFileSync(join(raiz, 'prisma', 'schema.prisma')))
    .digest('hex')
    .slice(0, 12)
  const template = join(tmpdir(), `aurum-test-template-${hashSchema}.db`)
  const lock = `${template}.lock`
  const TRAVA_MS = 120_000

  const travaFresca = (): boolean => {
    try {
      return Date.now() - statSync(lock).mtimeMs < TRAVA_MS
    } catch {
      return false
    }
  }

  /**
   * Template pronto para cópia? Existência NÃO basta: o `db push` cria o
   * arquivo no início e só termina segundos depois, e pode deixar WAL
   * pendente — copiar só o `.db` nesse estado gera banco rasgado
   * (`malformed`) em todos os testes. Só libera com lock ausente + magic +
   * `integrity_check` ok.
   */
  const templatePronto = (): boolean => {
    try {
      if (travaFresca()) return false
      if (!existsSync(template) || statSync(template).size <= 0) return false
      if (magiaSqlite(template) !== 'SQLite format 3\0') return false
      const db = new DatabaseSync(template, { readOnly: true })
      try {
        const r = db.prepare('PRAGMA integrity_check').get() as { integrity_check?: unknown }
        return String(r?.integrity_check ?? '').toLowerCase() === 'ok'
      } finally {
        db.close()
      }
    } catch {
      return false
    }
  }

  /** Despeja o WAL no arquivo principal e prova a integridade (dono, sob lock). */
  const finalizarTemplate = (): void => {
    const db = new DatabaseSync(template)
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE);')
      const r = db.prepare('PRAGMA integrity_check').get() as { integrity_check?: unknown }
      if (String(r?.integrity_check ?? '').toLowerCase() !== 'ok') {
        throw new Error('setup: template SQLite reprovou no integrity_check')
      }
    } finally {
      db.close()
    }
    // Sidecars consumidos pelo checkpoint: a cópia file-level leva SÓ o `.db`,
    // então nada de WAL pode restar ao lado do template.
    for (const sufixo of ['-wal', '-shm', '-journal']) {
      try {
        rmSync(`${template}${sufixo}`, { force: true })
      } catch {
        /* best-effort */
      }
    }
  }

  const inicio = Date.now()
  for (;;) {
    if (templatePronto()) break
    // Tenta virar dono (lock `wx` é atômico); trava órfã é tomada. Template
    // inválido sem dono vivo é descartado antes de recriar (resto de run
    // morta nunca envenena a próxima).
    let dono = false
    try {
      if (!travaFresca()) {
        try {
          rmSync(lock, { force: true })
        } catch {
          /* best-effort */
        }
      }
      writeFileSync(lock, String(process.pid), { flag: 'wx' })
      dono = true
    } catch {
      dono = false
    }
    if (dono) {
      try {
        try {
          rmSync(template, { force: true })
        } catch {
          /* best-effort */
        }
        execFileSync(
          process.execPath,
          [join('node_modules', 'prisma', 'build', 'index.js'), 'db', 'push', '--accept-data-loss', '--skip-generate'],
          {
            cwd: raiz,
            env: { ...process.env, DATABASE_URL: `file:${template}` },
            stdio: 'ignore',
          },
        )
        finalizarTemplate()
      } finally {
        try {
          rmSync(lock, { force: true })
        } catch {
          /* best-effort */
        }
      }
    } else {
      if (Date.now() - inicio > TRAVA_MS) {
        throw new Error(`setup: template SQLite não ficou pronto: ${template}`)
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200)
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
