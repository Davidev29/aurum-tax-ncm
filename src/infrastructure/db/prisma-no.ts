/**
 * Prisma Client singleton para contextos Node (main do Electron, Vitest, scripts).
 *
 * NUNCA importado pelo renderer (sem Node no bundle web) — o renderer usa IPC
 * (`IpcDriver` em `motor.ts`). A separação é por construção: este módulo importa
 * `@prisma/client` (Node-only).
 *
 * Resolução do arquivo:
 * - `caminhoExplicito` (main do Electron → `<userData>/aurum.db`);
 * - Vitest (`VITEST=true`): banco por ARQUIVO de teste, clonado do template
 *   criado em `tests/setup.ts` (`AURUM_TEST_TEMPLATE`). O contador vive em
 *   `globalThis`, então cada re-importação isolada ganha um arquivo próprio —
 *   sem vazamento entre arquivos, mesmo no mesmo worker;
 * - demais casos Node: `./prisma/dev.db` (relativo à raiz do projeto).
 *
 * Robustez SQLite aplicada em toda conexão:
 * `journal_mode=WAL` (escritas não bloqueiam leituras), `synchronous=NORMAL`,
 * `foreign_keys=ON`, `busy_timeout=5000`.
 */
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { SCHEMA_SQL } from './schema-sql'

type PrismaClientLike = {
  $connect(): Promise<unknown>
  $disconnect(): Promise<unknown>
  $queryRawUnsafe(q: string): Promise<unknown>
  $executeRawUnsafe(q: string): Promise<unknown>
}

let instancia: PrismaClientLike | null = null
let caminhoAtual: string | null = null

function raizProjeto(): string {
  // `src/infrastructure/db/` → raiz = 4 níveis acima em dev; em teste, cwd já é a raiz.
  const cwd = process.cwd()
  return cwd
}

function garantirDir(caminho: string): void {
  const dir = caminho.split(/[\\/]/).slice(0, -1).join('/')
  if (dir) mkdirSync(dir, { recursive: true })
}

/** Magic bytes do SQLite sem carregar o arquivo (prova rápida anti-rasgo). */
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

function seqGlobal(): number {
  const g = globalThis as Record<string, unknown>
  const atual = typeof g.__aurumDbSeq === 'number' ? (g.__aurumDbSeq as number) : 0
  g.__aurumDbSeq = atual + 1
  return atual + 1
}

function caminhoTestes(): string {
  const template = process.env.AURUM_TEST_TEMPLATE ?? ''
  // Sufixo aleatório por cópia: o contador em `globalThis` supostamente basta,
  // mas com workers reciclados ele pode repetir — duas suítes no mesmo arquivo
  // rasgariam uma à outra. Colisão aqui = banco malformado no teste vizinho.
  const id = `${process.pid}-${process.env.VITEST_WORKER_ID ?? '0'}-${seqGlobal()}-${Math.random().toString(36).slice(2, 10)}`
  const destino = join(tmpdir(), `aurum-test-${id}.db`)
  if (template && existsSync(template)) {
    garantirDir(destino)
    // Cópia verificada: o template é um `.db` autocontido (o setup faz
    // checkpoint e remove sidecars antes de liberar), então a cópia sai
    // íntegra — mas confirma magic + tamanho antes de entregar. Em caso de
    // falha, tenta de novo uma vez; persistindo, cai no fallback (`db push`).
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      try {
        copyFileSync(template, destino)
        if (magiaSqlite(destino) === 'SQLite format 3\0') return destino
      } catch {
        /* tenta de novo / cai no fallback */
      }
      try {
        rmSync(destino, { force: true })
      } catch {
        /* best-effort */
      }
    }
  }
  // Fallback (setup não rodou): cria e empurra o schema de forma síncrona.
  garantirDir(destino)
  const url = `file:${destino}`
  const projeto = raizProjeto()
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--accept-data-loss', '--skip-generate'], {
    cwd: projeto,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'ignore',
  })
  return destino
}

export function resolverCaminhoBanco(caminhoExplicito?: string): string {
  if (caminhoExplicito) return caminhoExplicito
  if (process.env.VITEST === 'true' || process.env.VITEST_WORKER_ID !== undefined) {
    return caminhoTestes()
  }
  if (process.env.AURUM_DB_PATH) return process.env.AURUM_DB_PATH
  return join(raizProjeto(), 'prisma', 'dev.db')
}

function aplicarPragmas(p: PrismaClientLike): Promise<void> {
  // `busy_timeout` PRIMEIRO: sob contenção (seed + sync + UI, workers de teste
  // disputando o template), os PRAGMAs seguintes esperam em vez de lançar
  // `SQLITE_BUSY` e derrubar a conexão — era o `PRAGMA journal_mode=WAL`
  // falhando no setup dos testes. Cada pragma é best-effort individual: um
  // setter que o driver recusa (ex.: WAL em FS sem lock) não impede os demais.
  // PRAGMAs devolvem linha em setter ou getter — sempre via query.
  return (async () => {
    const pragmas = [
      'PRAGMA busy_timeout=5000;',
      'PRAGMA journal_mode=WAL;',
      'PRAGMA synchronous=NORMAL;',
      'PRAGMA foreign_keys=ON;',
    ]
    for (const pragma of pragmas) {
      try {
        await p.$queryRawUnsafe(pragma)
      } catch {
        /* best-effort por pragma: segue para o próximo */
      }
    }
  })()
}

/**
 * Bootstrap do schema: cria as 27 tabelas quando o arquivo ainda não tem
 * nenhuma (instalação limpa, arquivo zerado). O DDL é embarcado
 * (`schema-sql.ts`, gerado do `prisma/schema.prisma`) — nenhum `migrate`/
 * `db push` em runtime, nenhuma rede, nenhum binário extra.
 */
async function garantirSchema(p: PrismaClientLike): Promise<void> {
  const contagem = (await p.$queryRawUnsafe(
    "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';",
  )) as Array<{ n: number | bigint }>
  if (Number(contagem[0]?.n ?? 0) === 0) {
    for (const pedaco of SCHEMA_SQL.split(';')) {
      const stmt = pedaco
        .split('\n')
        .filter((l) => !/^\s*--/.test(l))
        .join('\n')
        .trim()
      if (!stmt) continue
      await p.$executeRawUnsafe(stmt)
    }
    return
  }
  // Migração leve v1.1: colunas entrada × saída do Produto + contador da
  // Empresa em bancos já existentes (instalação limpa já sai com elas via DDL
  // acima). `ADD COLUMN` em coluna existente lança — segue para a próxima.
  for (const [tabela, col] of [
    ['Produto', 'cfopEntrada'],
    ['Produto', 'cfopSaida'],
    ['Produto', 'cstIcmsEntrada'],
    ['Produto', 'cstIcmsSaida'],
    ['Produto', 'pisEntrada'],
    ['Produto', 'pisSaida'],
    ['Produto', 'cofinsEntrada'],
    ['Produto', 'cofinsSaida'],
    ['Empresa', 'contadorTipo'],
    ['Empresa', 'contadorNome'],
    ['Empresa', 'contadorDoc'],
    ['Empresa', 'contadorCrc'],
    ['Empresa', 'contadorEmail'],
    ['Empresa', 'contadorTelefone'],
  ] as const) {
    try {
      await p.$executeRawUnsafe(`ALTER TABLE "${tabela}" ADD COLUMN "${col}" TEXT`)
    } catch {
      /* coluna já existe: segue */
    }
  }
}

/**
 * Checagem de integridade (`PRAGMA integrity_check`). Devolve `'ok'` ou o
 * texto do problema. Arquivo zerado/ausente conta como `'ok'` — o bootstrap
 * acima o materializa.
 */
export async function checarIntegridade(p: PrismaClientLike): Promise<string> {
  const linhas = (await p.$queryRawUnsafe('PRAGMA integrity_check;')) as Array<Record<string, unknown>>
  const valores = linhas.map((l) => String(Object.values(l)[0] ?? ''))
  if (valores.length === 1 && valores[0].toLowerCase() === 'ok') return 'ok'
  return valores.join('; ').slice(0, 500) || 'integridade-desconhecida'
}

/** Devolve o singleton (cria e conecta sob demanda). */
export async function prismaComo(caminhoExplicito?: string): Promise<PrismaClientLike> {
  const caminho = resolverCaminhoBanco(caminhoExplicito)
  if (instancia && caminhoAtual === caminho) return instancia
  if (instancia) {
    try {
      await instancia.$disconnect()
    } catch {
      /* best-effort */
    }
    instancia = null
    caminhoAtual = null
  }
  garantirDir(caminho)
  // Importação preguiçosa: `@prisma/client` só existe em Node.
  const mod = (await import('@prisma/client')) as unknown as {
    PrismaClient: new (opts?: { datasources?: { db?: { url?: string } }; datasourceUrl?: string }) => PrismaClientLike
  }
  // `datasourceUrl` (Prisma 6) sobrescreve o `env("DATABASE_URL")` do schema.
  const cliente = new mod.PrismaClient({ datasourceUrl: `file:${caminho}` })
  await cliente.$connect()
  await aplicarPragmas(cliente)
  await garantirSchema(cliente)
  instancia = cliente
  caminhoAtual = caminho
  return cliente
}

/** Fecha a conexão atual (testes `db.close()` / encerramento do main). */
export async function fecharPrisma(): Promise<void> {
  if (!instancia) return
  try {
    await instancia.$disconnect()
  } catch {
    /* best-effort */
  }
  instancia = null
  caminhoAtual = null
}

/** Caminho do banco em uso (diagnóstico/testes). */
export function caminhoBancoAtual(): string | null {
  return caminhoAtual
}
