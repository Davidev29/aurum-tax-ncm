/**
 * Motor do banco SQLite — API compatível com o Dexie usado pelo app.
 *
 * Este módulo NÃO importa nada de Node (seguro para o bundle web/renderer).
 * O driver real é resolvido por contexto:
 *   - renderer no Electron (`window.aurum.db` presente) → `IpcDriver`;
 *   - Node com driver registrado (`tests/setup.ts`, scripts) → Prisma;
 *   - navegador puro (dev web) → `MemoryDriver` (Map em memória).
 *
 * Semântica preservada do Dexie:
 * get/put/add/delete/clear/count/toArray/limit/where/orderBy/update,
 * `where().equals().{toArray,first,delete,count,limit,and}`,
 * `anyOf().toArray()`, `between().toArray()`, índice composto
 * `'[empresaId+chave]'`, `.and(fn)`, `.reverse().sortBy(campo)`,
 * `orderBy().reverse().limit().toArray()`, `db.table(nome)`, `db.delete()`,
 * `db.open()/close()/isOpen()`, `db.transaction(...)` (coleta de ops +
 * lote atômico via `db:transaction` no Electron; execução direta sequencial
 * — fallback documentado — fora dele) e `transacionar(ops)` (primitiva
 * atômica usada por `excluirEmpresa`/`restaurarBackup`).
 */
import {
  STORE_META,
  TODAS_STORES,
  camposDe,
  campoSeguro,
  somenteConhecidos,
  type DbOp,
  type ModoLote,
  type OpWhere,
} from './db-protocolo'
import { validarChave, validarRegistro } from './validacao'

export type Registro = Record<string, unknown>

/* ------------------------------------------------------------------ */
/* Driver                                                               */
/* ------------------------------------------------------------------ */

export interface Driver {
  buscar(tabela: string, where: OpWhere | null): Promise<Registro[]>
  contar(tabela: string, where: OpWhere | null): Promise<number>
  porChave(tabela: string, chave: string | number): Promise<Registro | null>
  inserir(tabela: string, registro: Registro): Promise<string | number>
  upsert(tabela: string, registro: Registro): Promise<string | number>
  /** Lote atômico (uma transação; usado por `bulkPut`). */
  lote(tabela: string, registros: Registro[], modo?: ModoLote): Promise<void>
  atualizar(tabela: string, chave: string | number, patch: Registro): Promise<number>
  remover(tabela: string, chave: string | number): Promise<void>
  limpar(tabela: string): Promise<void>
  removerOnde(tabela: string, where: OpWhere): Promise<number>
  apagarTudo(tabelas: string[]): Promise<void>
  fechar?(): Promise<void>
  /**
   * Lote heterogêneo ATÔMICO (várias tabelas/ops em uma transação; um
   * resultado por op). Ausente = driver sem suporte — o chamador usa o
   * fallback sequencial documentado. Prisma usa `BEGIN IMMEDIATE`/`COMMIT`
   * (ver `driver-prisma.ts`), memória usa snapshot+rollback, IPC delega ao
   * canal `db:transaction` do main.
   */
  transacionar?(ops: DbOp[]): Promise<unknown[]>
}

/**
 * Executa UMA op do protocolo contra qualquer driver (replay sequencial —
 * fallback documentado quando `transacionar` está ausente ou o canal IPC
 * transacional não existe no main antigo).
 */
export async function executarOp(driver: Driver, op: DbOp): Promise<unknown> {
  switch (op.op) {
    case 'buscar':
      return driver.buscar(op.tabela as string, op.where ?? null)
    case 'contar':
      return driver.contar(op.tabela as string, op.where ?? null)
    case 'porChave':
      return driver.porChave(op.tabela as string, op.chave as string | number)
    case 'inserir':
      return driver.inserir(op.tabela as string, (op.registro ?? {}) as Registro)
    case 'upsert':
      return driver.upsert(op.tabela as string, (op.registro ?? {}) as Registro)
    case 'lote':
      await driver.lote(op.tabela as string, (op.registros ?? []) as Registro[], op.modo ?? 'upsert')
      return null
    case 'atualizar':
      return driver.atualizar(op.tabela as string, op.chave as string | number, (op.patch ?? {}) as Registro)
    case 'remover':
      await driver.remover(op.tabela as string, op.chave as string | number)
      return null
    case 'limpar':
      await driver.limpar(op.tabela as string)
      return null
    case 'removerOnde': {
      if (op.where === null || op.where === undefined) {
        throw new Error(`validacao:${String(op.tabela)}:where-obrigatorio`)
      }
      return driver.removerOnde(op.tabela as string, op.where)
    }
    case 'apagarTudo':
      await driver.apagarTudo((op.tabelas ?? []) as string[])
      return null
    default:
      throw new Error(`validacao:transacao:op-desconhecida:${String((op as DbOp).op)}`)
  }
}

/* --------------------------------------- coletor transacional --- */

/**
 * Coletor de ops para o `db.transaction()` estilo Dexie no Electron.
 *
 * O callback não declara ops antecipadamente — então, com driver IPC, os
 * métodos do `DriverIpc` empilham as ops aqui em vez de enviá-las na hora;
 * ao final, o lote vai em UMA transação atômica (`db:transaction`). Fora de
 * coleta, o comportamento é o envio direto de sempre. Sem suporte a
 * aninhamento (transação dentro de transação usa o coletor externo).
 */
let coletorOps: DbOp[] | null = null

/** Há uma coleta de transação em curso (só o `DriverIpc` consulta). */
export function coletorTransacaoAtivo(): boolean {
  return coletorOps !== null
}

export function iniciarColetaTransacao(): void {
  coletorOps = []
}

export function encerrarColetaTransacao(): DbOp[] {
  const ops = coletorOps ?? []
  coletorOps = null
  return ops
}

export function abortarColetaTransacao(): void {
  coletorOps = null
}

/**
 * Retorno fictício durante a coleta: a op ainda NÃO executou (o valor real
 * só existe após o commit). Leituras devolvem vazio; escritas ecoam a chave
 * informada (ou `0` quando o id seria gerado). Callbacks que dependem de ids
 * gerados ou de leituras intermediárias não são atomicamente transacionáveis
 * — os chamadores atuais (`excluirEmpresa`, restore) só usam remoções e
 * escritas com chave conhecida.
 */
function resultadoColeta(op: DbOp): Registro | Registro[] | number | string | null {
  switch (op.op) {
    case 'buscar':
      return []
    case 'contar':
    case 'atualizar':
    case 'removerOnde':
      return 0
    case 'porChave':
    case 'lote':
    case 'remover':
    case 'limpar':
    case 'apagarTudo':
      return null
    case 'inserir':
    case 'upsert': {
      const tabela = op.tabela ?? ''
      const meta = STORE_META[tabela]
      const v = meta ? (op.registro ?? {})[meta.pk] : undefined
      return typeof v === 'string' || typeof v === 'number' ? v : 0
    }
  }
}

function metaDe(tabela: string) {
  const m = STORE_META[tabela]
  if (!m) throw new Error(`validacao:${tabela}:store-desconhecida`)
  return m
}

function casaWhere(r: Registro, where: OpWhere | null): boolean {
  if (!where) return true
  switch (where.tipo) {
    case 'equals':
      return (r[where.campo] ?? null) === (where.valor ?? null)
    case 'anyOf':
      return where.valores.some((v) => (r[where.campo] ?? null) === (v ?? null))
    case 'between': {
      const v = r[where.campo] as string | number | null | undefined
      if (v === undefined || v === null) return false
      const lo = where.incMin ? v >= where.min : v > where.min
      const hi = where.incMax ? v <= where.max : v < where.max
      return lo && hi
    }
    case 'composto':
      return where.campos.every((c, i) => (r[c] ?? null) === (where.valores[i] ?? null))
    case 'startsWith': {
      const v = r[where.campo]
      return typeof v === 'string' && v.startsWith(where.prefixo)
    }
  }
}

/* ------------------------------------------------------- memória --- */

export class DriverMemoria implements Driver {
  private tabelas = new Map<string, Map<string | number, Registro>>()
  private seq = new Map<string, number>()

  private mapa(tabela: string): Map<string | number, Registro> {
    metaDe(tabela)
    let m = this.tabelas.get(tabela)
    if (!m) {
      m = new Map()
      this.tabelas.set(tabela, m)
    }
    return m
  }

  private chavePk(tabela: string, registro: Registro): string | number {
    const { pk, auto } = metaDe(tabela)
    const v = registro[pk]
    if (typeof v === 'string' && v) return v
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v
    if (auto) {
      const prox = (this.seq.get(tabela) ?? 0) + 1
      this.seq.set(tabela, prox)
      return prox
    }
    throw new Error(`validacao:${tabela}:chave-ausente`)
  }

  async buscar(tabela: string, where: OpWhere | null): Promise<Registro[]> {
    return [...this.mapa(tabela).values()].filter((r) => casaWhere(r, where)).map((r) => ({ ...r }))
  }

  async contar(tabela: string, where: OpWhere | null): Promise<number> {
    return [...this.mapa(tabela).values()].filter((r) => casaWhere(r, where)).length
  }

  async porChave(tabela: string, chave: string | number): Promise<Registro | null> {
    const r = this.mapa(tabela).get(chave)
    return r ? { ...r } : null
  }

  async inserir(tabela: string, registro: Registro): Promise<string | number> {
    validarRegistro(tabela, registro)
    const copia = somenteConhecidos(tabela, { ...registro })
    const chave = this.chavePk(tabela, copia)
    const m = this.mapa(tabela)
    if (m.has(chave)) throw new Error(`sqlite:${tabela}:chave-duplicada`)
    const { pk } = metaDe(tabela)
    copia[pk] = chave
    m.set(chave, copia)
    return chave
  }

  async upsert(tabela: string, registro: Registro): Promise<string | number> {
    validarRegistro(tabela, registro)
    const copia = somenteConhecidos(tabela, { ...registro })
    const { pk, auto } = metaDe(tabela)
    const v = copia[pk]
    const temChave =
      (typeof v === 'string' && v !== '') || (typeof v === 'number' && Number.isInteger(v) && v >= 0)
    if (!temChave) {
      if (!auto) throw new Error(`validacao:${tabela}:chave-ausente`)
      return this.inserir(tabela, copia)
    }
    const m = this.mapa(tabela)
    m.set(v as string | number, copia)
    return v as string | number
  }

  async lote(tabela: string, registros: Registro[], modo: ModoLote = 'upsert'): Promise<void> {
    if (modo === 'inserir') {
      // Só-insere: duplicadas são puladas em silêncio (paridade skipDuplicates).
      for (const r of registros) {
        try {
          await this.inserir(tabela, r)
        } catch (e) {
          if (!(e instanceof Error) || !e.message.includes('chave-duplicada')) throw e
        }
      }
      return
    }
    for (const r of registros) {
      await this.upsert(tabela, r)
    }
  }

  async atualizar(tabela: string, chave: string | number, patch: Registro): Promise<number> {
    const atual = this.mapa(tabela).get(chave)
    if (!atual) return 0
    const limpo = somenteConhecidos(tabela, patch)
    const mesclado = { ...atual, ...limpo }
    validarRegistro(tabela, mesclado)
    this.mapa(tabela).set(chave, mesclado)
    return 1
  }

  async remover(tabela: string, chave: string | number): Promise<void> {
    this.mapa(tabela).delete(chave)
  }

  async limpar(tabela: string): Promise<void> {
    this.mapa(tabela).clear()
  }

  async removerOnde(tabela: string, where: OpWhere): Promise<number> {
    const m = this.mapa(tabela)
    let n = 0
    for (const [k, r] of [...m.entries()]) {
      if (casaWhere(r, where)) {
        m.delete(k)
        n++
      }
    }
    return n
  }

  async apagarTudo(tabelas: string[]): Promise<void> {
    for (const t of tabelas) this.mapa(t).clear()
  }

  /**
   * Transação atômica com rollback: fotografa as tabelas tocadas (e o
   * contador de auto-incremento); qualquer falha restaura tudo.
   */
  async transacionar(ops: DbOp[]): Promise<unknown[]> {
    const tocadas = new Set<string>()
    for (const op of ops) {
      if (op.op === 'apagarTudo') {
        for (const t of op.tabelas ?? []) tocadas.add(t)
      } else if (op.tabela) {
        tocadas.add(op.tabela)
      }
    }
    for (const t of tocadas) metaDe(t)
    const foto = new Map<string, Map<string | number, Registro>>()
    for (const t of tocadas) {
      const m = this.tabelas.get(t)
      foto.set(t, new Map([...(m ?? new Map()).entries()].map(([k, v]) => [k, { ...v }] as const)))
    }
    const fotoSeq = new Map(this.seq)
    const saida: unknown[] = []
    try {
      for (const op of ops) saida.push(await executarOp(this, op))
    } catch (e) {
      for (const [t, m] of foto) this.tabelas.set(t, m)
      this.seq = fotoSeq
      throw e
    }
    return saida
  }
}

/* ----------------------------------------------------------- IPC --- */

export interface PonteDb {
  op(requisicao: DbOp): Promise<Registro | Registro[] | number | string | null>
  /**
   * Lote atômico no main (canal `db:transaction` → `prisma.$transaction`).
   * Opcional: builds antigos expõem só `op` — nesse caso `transacionar`
   * lança `ipc:sem-transacao` e o chamador usa o replay sequencial.
   */
  transacao?(ops: DbOp[]): Promise<unknown[]>
}

function ponteDb(): PonteDb | null {
  try {
    const w = window as unknown as Record<string, unknown>
    const aurum = w.aurum as { db?: PonteDb } | undefined
    if (aurum && aurum.db && typeof aurum.db.op === 'function') return aurum.db
  } catch {
    /* sem window (Node/testes) */
  }
  return null
}

export class DriverIpc implements Driver {
  constructor(private ponte: PonteDb) {}

  private async chamar(op: DbOp): Promise<never | unknown> {
    // Em coleta transacional (`db.transaction` no Electron): empilha a op e
    // devolve um stub — nada é enviado antes do commit em lote.
    if (coletorTransacaoAtivo() && coletorOps) {
      coletorOps.push(op)
      return resultadoColeta(op)
    }
    return this.ponte.op(op)
  }

  /**
   * Delega o lote ao main (`db:transaction`, atômico de verdade). Sem o
   * canal (main/preload antigo), lança `ipc:sem-transacao` — o chamador faz
   * o replay sequencial via `executarOp` (fallback documentado).
   */
  async transacionar(ops: DbOp[]): Promise<unknown[]> {
    const fn = this.ponte.transacao
    if (typeof fn !== 'function') throw new Error('ipc:sem-transacao')
    const r = await fn.call(this.ponte, ops)
    return Array.isArray(r) ? r : []
  }

  async buscar(tabela: string, where: OpWhere | null): Promise<Registro[]> {
    return (await this.chamar({ op: 'buscar', tabela, where })) as Registro[]
  }

  async contar(tabela: string, where: OpWhere | null): Promise<number> {
    return (await this.chamar({ op: 'contar', tabela, where })) as number
  }

  async porChave(tabela: string, chave: string | number): Promise<Registro | null> {
    return (await this.chamar({ op: 'porChave', tabela, chave })) as Registro | null
  }

  async inserir(tabela: string, registro: Registro): Promise<string | number> {
    validarRegistro(tabela, registro)
    return (await this.chamar({ op: 'inserir', tabela, registro })) as string | number
  }

  async upsert(tabela: string, registro: Registro): Promise<string | number> {
    validarRegistro(tabela, registro)
    return (await this.chamar({ op: 'upsert', tabela, registro })) as string | number
  }

  async lote(tabela: string, registros: Registro[], modo: ModoLote = 'upsert'): Promise<void> {
    for (const r of registros) validarRegistro(tabela, r)
    await this.chamar({ op: 'lote', tabela, registros, modo })
  }

  async atualizar(tabela: string, chave: string | number, patch: Registro): Promise<number> {
    return (await this.chamar({ op: 'atualizar', tabela, chave, patch })) as number
  }

  async remover(tabela: string, chave: string | number): Promise<void> {
    await this.chamar({ op: 'remover', tabela, chave })
  }

  async limpar(tabela: string): Promise<void> {
    await this.chamar({ op: 'limpar', tabela })
  }

  async removerOnde(tabela: string, where: OpWhere): Promise<number> {
    return (await this.chamar({ op: 'removerOnde', tabela, where })) as number
  }

  async apagarTudo(tabelas: string[]): Promise<void> {
    await this.chamar({ op: 'apagarTudo', tabelas })
  }
}

/* -------------------------------------------------------- registro --- */

let driverRegistrado: Driver | null = null
const memoriaPadrao = new DriverMemoria()

/** Node/testes/scripts registram o driver Prisma aqui (sem importar Node no bundle). */
export function definirDriver(driver: Driver): void {
  driverRegistrado = driver
}

export function resolverDriver(): Driver {
  const ponte = ponteDb()
  if (ponte) return new DriverIpc(ponte)
  if (driverRegistrado) return driverRegistrado
  return memoriaPadrao
}

/* ------------------------------------------------------------------ */
/* Coleção (pipeline preguiçoso estilo Dexie)                           */
/* ------------------------------------------------------------------ */

type Predicado<T> = (valor: T) => boolean

export class Colecao<T extends object> {
  constructor(
    private driver: Driver,
    private tabela: string,
    private where: OpWhere | null = null,
    private filtros: Array<Predicado<T>> = [],
    private ordem: { campo: string; dir: 'asc' | 'desc' } | null = null,
    private teto: number | null = null,
  ) {}

  and(fn: Predicado<T>): Colecao<T> {
    return new Colecao(this.driver, this.tabela, this.where, [...this.filtros, fn], this.ordem, this.teto)
  }

  reverse(): Colecao<T> {
    if (this.ordem) {
      return new Colecao(
        this.driver, this.tabela, this.where, this.filtros,
        { campo: this.ordem.campo, dir: this.ordem.dir === 'asc' ? 'desc' : 'asc' }, this.teto,
      )
    }
    return new Colecao(this.driver, this.tabela, this.where, this.filtros, { campo: metaDe(this.tabela).pk, dir: 'desc' }, this.teto)
  }

  limit(n: number): Colecao<T> {
    return new Colecao(this.driver, this.tabela, this.where, this.filtros, this.ordem, Math.max(0, Math.trunc(n)))
  }

  private comparar(a: T, b: T): number {
    if (!this.ordem) return 0
    const { campo, dir } = this.ordem
    const ra = a as Registro
    const rb = b as Registro
    const va = (ra[campo] ?? null) as string | number | null
    const vb = (rb[campo] ?? null) as string | number | null
    let c = 0
    if (va === vb) c = 0
    else if (va === null || va === undefined) c = -1
    else if (vb === null || vb === undefined) c = 1
    else if (typeof va === 'number' && typeof vb === 'number') c = va < vb ? -1 : 1
    else c = String(va) < String(vb) ? -1 : 1
    return dir === 'asc' ? c : -c
  }

  private async executar(): Promise<T[]> {
    const base = (await this.driver.buscar(this.tabela, this.where)) as T[]
    let linhas = this.filtros.length ? base.filter((r) => this.filtros.every((f) => f(r))) : base
    if (this.ordem) linhas = [...linhas].sort((a, b) => this.comparar(a, b))
    if (this.teto !== null) linhas = linhas.slice(0, this.teto)
    return linhas
  }

  async toArray(): Promise<T[]> {
    return this.executar()
  }

  async first(): Promise<T | undefined> {
    const linhas = await this.limit(1).executar()
    return linhas[0]
  }

  async count(): Promise<number> {
    // Conta pós-filtros (paridade Dexie: filtros `.and()` valem na contagem).
    if (!this.filtros.length && !this.ordem && this.teto === null) {
      return this.driver.contar(this.tabela, this.where)
    }
    return (await this.executar()).length
  }

  /**
   * Chaves únicas da ordenação (paridade `uniqueKeys()` do Dexie).
   * Com `orderBy(campo)` devolve os valores distintos do campo; sem
   * ordenação, as chaves primárias distintas. Pós-filtros.
   */
  async uniqueKeys(): Promise<Array<string | number>> {
    const linhas = await this.executar()
    const campo = this.ordem ? this.ordem.campo : metaDe(this.tabela).pk
    const vistos = new Set<string | number>()
    for (const r of linhas) {
      const v = (r as Registro)[campo] as string | number | null | undefined
      if (typeof v === 'string' || typeof v === 'number') vistos.add(v)
    }
    return [...vistos]
  }

  async delete(): Promise<number> {
    if (!this.filtros.length && this.where) {
      return this.driver.removerOnde(this.tabela, this.where)
    }
    // Com predicados JS: resolve as chaves e remove uma a uma.
    const linhas = await this.executar()
    const { pk } = metaDe(this.tabela)
    for (const r of linhas) {
      await this.driver.remover(this.tabela, (r as Registro)[pk] as string | number)
    }
    return linhas.length
  }

  /** Ordenação ascendente terminal (paridade `sortBy` do Dexie). */
  async sortBy(campo: string): Promise<T[]> {
    if (!campoSeguro(campo)) throw new Error(`validacao:${this.tabela}:campo-invalido`)
    const comOrdem = new Colecao<T>(this.driver, this.tabela, this.where, this.filtros, { campo, dir: 'asc' }, this.teto)
    return comOrdem.executar()
  }
}

export interface Condicao<T extends object> {
  toArray(): Promise<T[]>
  first(): Promise<T | undefined>
  delete(): Promise<number>
  count(): Promise<number>
  uniqueKeys(): Promise<Array<string | number>>
  and(fn: Predicado<T>): Colecao<T>
  limit(n: number): Colecao<T>
  reverse(): Colecao<T>
}

/* ------------------------------------------------------------------ */
/* Tabela                                                               */
/* ------------------------------------------------------------------ */

export class Tabela<T extends object, K extends string | number> {
  constructor(private tabela: string) {}

  private driver(): Driver {
    return resolverDriver()
  }

  async get(chave: K): Promise<T | undefined> {
    validarChave(this.tabela, chave)
    const r = await this.driver().porChave(this.tabela, chave)
    return (r as T | null) ?? undefined
  }

  async put(valor: T): Promise<K> {
    const registro = { ...(valor as Registro) }
    validarRegistro(this.tabela, registro)
    return (await this.driver().upsert(this.tabela, registro)) as K
  }

  async add(valor: T, chave?: K): Promise<K> {
    const registro = { ...(valor as Registro) }
    if (chave !== undefined) registro[metaDe(this.tabela).pk] = chave
    validarRegistro(this.tabela, registro)
    return (await this.driver().inserir(this.tabela, registro)) as K
  }

  async update(chave: K, patch: Partial<T>): Promise<number> {
    validarChave(this.tabela, chave)
    return this.driver().atualizar(this.tabela, chave, { ...(patch as Registro) })
  }

  async delete(chave: K): Promise<void> {
    validarChave(this.tabela, chave)
    await this.driver().remover(this.tabela, chave)
  }

  async clear(): Promise<void> {
    await this.driver().limpar(this.tabela)
  }

  async count(): Promise<number> {
    return this.driver().contar(this.tabela, null)
  }

  async toArray(): Promise<T[]> {
    return (await this.driver().buscar(this.tabela, null)) as T[]
  }

  /**
   * Coleção total (paridade `toCollection()` do Dexie). Usado para
   * `primaryKeys()` no seed de auxiliares.
   */
  toCollection(): { primaryKeys(): Promise<K[]>; toArray(): Promise<T[]> } {
    const driver = this.driver()
    const tabela = this.tabela
    return {
      toArray: () => this.toArray(),
      primaryKeys: async () => {
        const linhas = await driver.buscar(tabela, null)
        const { pk } = metaDe(tabela)
        return linhas.map((r) => (r as Registro)[pk] as K)
      },
    }
  }

  async bulkPut(itens: T[], opts?: { modo?: ModoLote }): Promise<void> {
    const validados = itens.map((item) => {
      const registro = somenteConhecidos(this.tabela, { ...(item as Registro) })
      validarRegistro(this.tabela, registro)
      return registro
    })
    await this.driver().lote(this.tabela, validados, opts?.modo ?? 'upsert')
  }

  /**
   * Inserção em lote (paridade `bulkAdd()` do Dexie): falha na primeira
   * chave duplicada, sem upsert. Usado pelos testes de ponte CNAE→NBS.
   */
  async bulkAdd(itens: T[]): Promise<void> {
    for (const item of itens) {
      const registro = somenteConhecidos(this.tabela, { ...(item as Registro) })
      validarRegistro(this.tabela, registro)
      await this.driver().inserir(this.tabela, registro)
    }
  }

  limit(n: number): Colecao<T> {
    return new Colecao<T>(this.driver(), this.tabela).limit(n)
  }

  orderBy(campo: string): Colecao<T> {
    if (!campoSeguro(campo)) throw new Error(`validacao:${this.tabela}:campo-invalido`)
    return new Colecao<T>(this.driver(), this.tabela, null, [], { campo, dir: 'asc' })
  }

  where(indice: string): {
    equals(valor: unknown): Condicao<T>
    anyOf(valores: unknown[]): Condicao<T>
    between(min: unknown, max: unknown, incMin?: boolean, incMax?: boolean): Condicao<T>
    startsWith(prefixo: string): Condicao<T>
  } {
    const driver = this.driver()
    const montar = (where: OpWhere): Condicao<T> => {
      const col = new Colecao<T>(driver, this.tabela, where)
      return {
        toArray: () => col.toArray(),
        first: () => col.first(),
        delete: () => col.delete(),
        count: () => col.count(),
        uniqueKeys: () => col.uniqueKeys(),
        and: (fn) => col.and(fn),
        limit: (n) => col.limit(n),
        reverse: () => col.reverse(),
      }
    }
    const campos = camposDe(indice)
    for (const c of campos) {
      if (!campoSeguro(c)) throw new Error(`validacao:${this.tabela}:campo-invalido`)
    }
    const composto = campos.length > 1
    return {
      equals: (valor: unknown) => {
        if (composto) {
          if (!Array.isArray(valor) || valor.length !== campos.length) {
            throw new Error(`validacao:${this.tabela}:chave-composta-invalida`)
          }
          return montar({ tipo: 'composto', campos, valores: valor as Array<string | number> })
        }
        return montar({ tipo: 'equals', campo: campos[0], valor: valor as string | number | null })
      },
      anyOf: (valores: unknown[]) => {
        if (composto) throw new Error(`validacao:${this.tabela}:anyOf-composto-nao-suportado`)
        return montar({ tipo: 'anyOf', campo: campos[0], valores: (valores ?? []) as Array<string | number> })
      },
      between: (min: unknown, max: unknown, incMin = true, incMax = true) =>
        montar({
          tipo: 'between',
          campo: campos[0],
          min: min as string | number,
          max: max as string | number,
          incMin: incMin !== false,
          incMax: incMax !== false,
        }),
      startsWith: (prefixo: string) => {
        if (composto) throw new Error(`validacao:${this.tabela}:startsWith-composto-nao-suportado`)
        return montar({ tipo: 'startsWith', campo: campos[0], prefixo: String(prefixo) })
      },
    }
  }
}

export { TODAS_STORES }
