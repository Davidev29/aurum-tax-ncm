/**
 * Banco SQLite no processo main — Prisma em `<userData>/aurum.db`.
 *
 * Por que no main: o renderer roda sem Node (`nodeIntegration: false`) e o
 * IndexedDB do renderer não oferece durabilidade/segurança de um arquivo com
 * WAL + `foreign_keys`. O renderer acessa via IPC (`db:op`) e nunca toca no
 * arquivo.
 *
 * Segurança do canal (defesa em profundidade, além do Prisma parametrizado):
 * - `tabela` restrita à allowlist (`STORES_SQLITE`);
 * - `op` restrita às 11 operações conhecidas (+ `db:transaction` para lotes
 *   atômicos, com as mesmas validações por op);
 * - `where` validado por forma (campo no alfabeto, listas ≤ 500 itens);
 * - registros validados por `validarRegistro()` (domínio) + Prisma (tipos);
 * - tetos: 2000 registros/lote, 4 MB por operação, 500 ops/transação;
 * - caminho do banco FIXO (userData) — nenhum input do renderer vira path.
 *
 * Snapshots pré-restore são ROTATIVOS (`aurum.db.pre-restore-<ISO>.bak`,
 * retendo os 5 mais novos) — nunca um nome fixo sobrescrito.
 *
 * Compilado pelo esbuild junto ao `main.ts` (`@prisma/client` externo).
 */
import type { App, IpcMain } from 'electron'
import { closeSync, copyFileSync, existsSync, openSync, readSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import type { DbOp, OpWhere } from '../../src/infrastructure/db/db-protocolo'
import { STORES_SQLITE, validarChave, validarRegistro } from '../../src/infrastructure/db/validacao'
import { DriverPrisma } from '../../src/infrastructure/db/driver-prisma'
import { checarIntegridade, fecharPrisma, prismaComo } from '../../src/infrastructure/db/prisma-no'

const OPS_VALIDAS = new Set([
  'buscar',
  'contar',
  'porChave',
  'inserir',
  'upsert',
  'lote',
  'atualizar',
  'remover',
  'limpar',
  'removerOnde',
  'apagarTudo',
])

const TETO_LOTE = 2000
const TETO_BYTES = 4 * 1024 * 1024
/** Teto de ops por transação (restore fatiado em 500 fica em ~60 ops). */
const TETO_TRANSACAO_OPS = 500
/** Snapshots pré-restore retidos (rotativos — os mais novos vencem). */
const RETENCAO_SNAPSHOTS = 5

/** Caminho fixo do banco: `<userData>/aurum.db` (preservado nos updates). */
export function caminhoBanco(app: App): string {
  return path.join(app.getPath('userData'), 'aurum.db')
}

/**
 * Caminho de UM snapshot pré-restore rotativo:
 * `<userData>/aurum.db.pre-restore-<ISO>.bak` (ISO sem `:`/`.` — inválidos no
 * Windows; ordenável lexicograficamente = cronológico). Cada restore gera um
 * arquivo novo; `podarSnapshots` retém os 5 mais novos.
 */
export function caminhoSnapshot(caminhoBanco: string, quando: Date = new Date()): string {
  const iso = quando.toISOString().replace(/[:.]/g, '-')
  return `${caminhoBanco}.pre-restore-${iso}.bak`
}

/**
 * Poda best-effort: mantém só os `reter` snapshots mais novos. Nunca lança —
 * falha de poda não bloqueia o restore. O `.bak` legado de nome fixo
 * (`aurum.db.pre-restore.bak`) NÃO casa o prefixo e é preservado.
 */
export function podarSnapshots(caminhoBanco: string, reter: number = RETENCAO_SNAPSHOTS): void {
  try {
    const dir = path.dirname(caminhoBanco)
    const base = path.basename(caminhoBanco)
    const prefixo = `${base}.pre-restore-`
    const candidatos = readdirSync(dir)
      .filter((f) => f.startsWith(prefixo) && f.endsWith('.bak'))
      .sort()
    while (candidatos.length > reter) {
      const antigo = candidatos.shift()
      if (!antigo) break
      try {
        unlinkSync(path.join(dir, antigo))
      } catch {
        /* best-effort por arquivo */
      }
    }
  } catch {
    /* best-effort: poda nunca bloqueia o restore */
  }
}

/**
 * Prepara o banco antes da janela abrir (primeira coisa com I/O no boot):
 * conecta, roda `integrity_check` e, se corrompido, coloca o arquivo em
 * quarentena (`aurum.db.corrompido-<timestamp>`) e recomeça do zero — o
 * schema é recriado pelo bootstrap e a base oficial é ressemeada pelo app.
 * Arquivo zerado/ausente não é corrupção: o bootstrap o materializa.
 *
 * Nunca lança: em último caso o app abre e o renderer recebe erros
 * explícitos por operação (fail-closed visível em vez de base vazia muda).
 */
export async function prepararBanco(app: App): Promise<{ ok: boolean; detalhe: string }> {
  const caminho = caminhoBanco(app)
  try {
    const p = await prismaComo(caminho)
    const estado = await checarIntegridade(p)
    if (estado === 'ok') return { ok: true, detalhe: 'ok' }
    // Corrompido: checkpoint best-effort (despeja o WAL no arquivo principal
    // para a quarentena levar o estado completo), depois quarentena + recomeço.
    // Os sidecars (`-wal`/`-shm`/`-journal`) pertencem à geração corrompida:
    // são removidos junto — sem isso, um `-wal` órfão seria reanexado ao novo
    // `aurum.db` vazio no próximo boot e a corrupção "voltava".
    try {
      const p = await prismaComo(caminho)
      await p.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE);')
    } catch {
      /* checkpoint best-effort: segue para a quarentena mesmo assim */
    }
    try {
      await fecharPrisma()
    } catch {
      /* best-effort */
    }
    const quarentena = `${caminho}.corrompido-${new Date().toISOString().replace(/[:.]/g, '-')}`
    try {
      if (existsSync(caminho)) renameSync(caminho, quarentena)
      // Sidecars da geração corrompida não migram para o banco novo.
      for (const sufixo of ['-wal', '-shm', '-journal']) {
        try {
          const lateral = `${caminho}${sufixo}`
          if (existsSync(lateral)) renameSync(lateral, `${quarentena}${sufixo}`)
        } catch {
          /* best-effort por sidecar */
        }
      }
    } catch {
      /* sem quarentena: segue para recriação */
    }
    const novo = await prismaComo(caminho)
    const recheck = await checarIntegridade(novo)
    return { ok: recheck === 'ok', detalhe: recheck === 'ok' ? `quarentena:${quarentena}` : recheck }
  } catch (erro) {
    return { ok: false, detalhe: erro instanceof Error ? erro.message : String(erro) }
  }
}

/**
 * Cópia de segurança do banco (pré-update / pré-restauração). Best-effort:
 * devolve o caminho do backup ou `null`.
 */
export function copiarBanco(caminho: string, sufixo: string): string | null {
  try {
    if (!existsSync(caminho)) return null
    const destino = `${caminho}.${sufixo}`
    copyFileSync(caminho, destino)
    return destino
  } catch {
    return null
  }
}

function textoSeguro(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 500
}

function valorCurto(v: unknown, tabela: string): void {
  if (v !== null && typeof v !== 'string' && typeof v !== 'number') {
    throw new Error(`db:${tabela}:valor-invalido`)
  }
  if (typeof v === 'string' && v.length > 500) throw new Error(`db:${tabela}:valor-longo`)
}

function validarWhere(w: OpWhere | null | undefined, tabela: string): void {
  if (w === null || w === undefined) return
  if (typeof w !== 'object') throw new Error(`db:${tabela}:where-invalido`)
  switch (w.tipo) {
    case 'equals':
      if (typeof w.campo !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(w.campo)) {
        throw new Error(`db:${tabela}:campo-invalido`)
      }
      valorCurto(w.valor, tabela)
      return
    case 'anyOf':
      if (typeof w.campo !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(w.campo)) {
        throw new Error(`db:${tabela}:campo-invalido`)
      }
      if (!Array.isArray(w.valores) || w.valores.length > 500) throw new Error(`db:${tabela}:lista-invalida`)
      for (const v of w.valores) valorCurto(v, tabela)
      return
    case 'between':
      if (typeof w.campo !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(w.campo)) {
        throw new Error(`db:${tabela}:campo-invalido`)
      }
      for (const v of [w.min, w.max]) {
        if (typeof v !== 'string' && typeof v !== 'number') throw new Error(`db:${tabela}:valor-invalido`)
        if (typeof v === 'string' && v.length > 500) throw new Error(`db:${tabela}:valor-longo`)
      }
      return
    case 'composto': {
      if (!Array.isArray(w.campos) || !Array.isArray(w.valores) || w.campos.length !== w.valores.length) {
        throw new Error(`db:${tabela}:composto-invalido`)
      }
      if (w.campos.length > 4) throw new Error(`db:${tabela}:composto-grande`)
      for (const c of w.campos) {
        if (typeof c !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(c)) throw new Error(`db:${tabela}:campo-invalido`)
      }
      if (w.valores.length > 4) throw new Error(`db:${tabela}:composto-grande`)
      for (const v of w.valores) valorCurto(v, tabela)
      return
    }
    case 'startsWith':
      if (typeof w.campo !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(w.campo)) {
        throw new Error(`db:${tabela}:campo-invalido`)
      }
      if (!textoSeguro(w.prefixo)) throw new Error(`db:${tabela}:prefixo-invalido`)
      return
    default:
      throw new Error(`db:${tabela}:where-invalido`)
  }
}

function validarRequisicao(req: DbOp): void {
  if (!req || typeof req !== 'object') throw new Error('db:requisicao-invalida')
  if (!OPS_VALIDAS.has(req.op)) throw new Error(`db:op-invalida:${String((req as { op?: unknown }).op)}`)
  if (req.op === 'apagarTudo') {
    // Sem default: lista explícita e não-vazia (um `where` ausente no
    // `removerOnde` também é recusado abaixo — wipe acidental é fail-closed).
    if (!Array.isArray(req.tabelas) || req.tabelas.length === 0 || req.tabelas.length > 40) {
      throw new Error('db:tabelas-invalidas')
    }
    for (const t of req.tabelas) {
      if (!STORES_SQLITE.includes(t)) throw new Error(`db:store-desconhecida:${String(t)}`)
    }
    return
  }
  if (typeof req.tabela !== 'string' || !STORES_SQLITE.includes(req.tabela)) {
    throw new Error(`db:store-desconhecida:${String(req.tabela)}`)
  }
  const tabela = req.tabela
  validarWhere(req.where, tabela)
  if (req.chave !== undefined) validarChave(tabela, req.chave)
  if (req.registro !== undefined) {
    if (JSON.stringify(req.registro).length > TETO_BYTES) throw new Error(`db:${tabela}:registro-grande`)
    validarRegistro(tabela, req.registro)
  }
  if (req.patch !== undefined) {
    if (typeof req.patch !== 'object' || req.patch === null) throw new Error(`db:${tabela}:patch-invalido`)
    if (JSON.stringify(req.patch).length > TETO_BYTES) throw new Error(`db:${tabela}:patch-grande`)
  }
  if (req.registros !== undefined) {
    if (!Array.isArray(req.registros) || req.registros.length > TETO_LOTE) {
      throw new Error(`db:${tabela}:lote-invalido`)
    }
    if (JSON.stringify(req.registros).length > TETO_BYTES) throw new Error(`db:${tabela}:lote-grande`)
    for (const r of req.registros) validarRegistro(tabela, r)
  }
  if (req.modo !== undefined && req.modo !== 'upsert' && req.modo !== 'inserir') {
    throw new Error(`db:${tabela}:modo-invalido`)
  }
}

/** Registra o canal `db:op`. Chamado por `registrarIpc()` no `main.ts`. */
export function registrarIpcDb(ipcMain: IpcMain, app: App): void {
  const driver = new DriverPrisma(caminhoBanco(app))
  // Snapshot pré-restore ROTATIVO: cópia best-effort com timestamp + poda
  // (retém os 5 mais novos). Nunca lança — falha vira `{ ok: false }` e o
  // restore prossegue.
  ipcMain.handle('db:snapshot', async () => {
    try {
      const origem = caminhoBanco(app)
      if (!existsSync(origem)) return { ok: false, erro: 'sem-banco' }
      // Despeja o WAL no arquivo principal antes de copiar: sem checkpoint,
      // a cópia file-level poderia capturar um estado quebrado (WAL parcial).
      try {
        const p = await prismaComo(origem)
        await p.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE);')
      } catch {
        /* checkpoint best-effort: segue para a cópia mesmo assim */
      }
      const sufixo = `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.bak`
      const caminho = copiarBanco(origem, sufixo)
      if (!caminho || !existsSync(caminho)) return { ok: false, erro: 'copia-falhou' }
      const stat = statSync(caminho)
      if (stat.size <= 0) return { ok: false, erro: 'copia-vazia' }
      // Magic bytes sem carregar o arquivo inteiro na RAM.
      const fd = openSync(caminho, 'r')
      try {
        const cabeca = Buffer.alloc(16)
        if (readSync(fd, cabeca, 0, 16, 0) !== 16) return { ok: false, erro: 'copia-invalida' }
        if (cabeca.toString('utf8') !== 'SQLite format 3\0') return { ok: false, erro: 'copia-invalida' }
      } finally {
        try {
          closeSync(fd)
        } catch {
          /* best-effort */
        }
      }
      podarSnapshots(origem)
      return { ok: true, caminho }
    } catch (erro) {
      return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) }
    }
  })
  // Lote atômico (`driver.transacionar` no renderer): valida CADA op com as
  // mesmas regras do `db:op` e executa tudo numa transação SQLite real
  // (`BEGIN IMMEDIATE`…`COMMIT` com `ROLLBACK` em falha — tudo ou nada).
  ipcMain.handle('db:transaction', async (_evento, ops: unknown) => {
    if (!Array.isArray(ops) || ops.length === 0 || ops.length > TETO_TRANSACAO_OPS) {
      throw new Error('db:transacao-invalida')
    }
    const lote = ops as DbOp[]
    for (const req of lote) validarRequisicao(req)
    return driver.transacionar(lote)
  })
  ipcMain.handle('db:op', async (_evento, req: DbOp) => {
    validarRequisicao(req)
    switch (req.op) {
      case 'buscar':
        return driver.buscar(req.tabela as string, req.where ?? null)
      case 'contar':
        return driver.contar(req.tabela as string, req.where ?? null)
      case 'porChave':
        return driver.porChave(req.tabela as string, req.chave as string | number)
      case 'inserir':
        return driver.inserir(req.tabela as string, req.registro as Record<string, unknown>)
      case 'upsert':
        return driver.upsert(req.tabela as string, req.registro as Record<string, unknown>)
      case 'lote':
        return driver
          .lote(req.tabela as string, (req.registros ?? []) as Array<Record<string, unknown>>, req.modo ?? 'upsert')
          .then(() => null)
      case 'atualizar':
        return driver.atualizar(
          req.tabela as string,
          req.chave as string | number,
          (req.patch ?? {}) as Record<string, unknown>,
        )
      case 'remover':
        await driver.remover(req.tabela as string, req.chave as string | number)
        return null
      case 'limpar':
        await driver.limpar(req.tabela as string)
        return null
      case 'removerOnde':
        if (req.where === null || req.where === undefined) {
          throw new Error(`db:${req.tabela as string}:where-obrigatorio`)
        }
        return driver.removerOnde(req.tabela as string, req.where as OpWhere)
      case 'apagarTudo': {
        await driver.apagarTudo(req.tabelas as string[])
        return null
      }
      default:
        throw new Error('db:op-invalida')
    }
  })
}
