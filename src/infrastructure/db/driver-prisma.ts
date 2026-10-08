/**
 * Driver Prisma (SQLite) — contextos Node apenas.
 *
 * Importado SOMENTE por `tests/setup.ts` (via registro) e pelo processo main
 * do Electron (`electron/main/db.ts`, que o usa diretamente). Nunca
 * referenciado por `motor.ts`/`schema.ts` via import estático — o registro é
 * feito com `definirDriver()` para que o bundle web/renderer jamais encoste
 * em `@prisma/client` ou `node:*`.
 */
import { campoSeguro, somenteConhecidos, STORE_META, type ModoLote, type OpWhere } from './db-protocolo'
import { validarChave, validarRegistro } from './validacao'
import { fecharPrisma, prismaComo, resolverCaminhoBanco } from './prisma-no'
import { definirDriver, type Driver, type Registro } from './motor'

/**
 * Reintenta escritas em contenção (`SQLITE_BUSY`/lock/timeout): o SQLite
 * serializa escritores e o `busy_timeout` nem sempre basta sob rajadas
 * (seed + sync + UI). Até 3 tentativas com backoff; outro erro relança
 * imediatamente. Leituras não reintentam (são instantâneas em WAL).
 */
async function comRetry<T>(fn: () => Promise<T>): Promise<T> {
  let ultimo: unknown = null
  for (let i = 0; i < 3; i++) {
    try {
      return await fn()
    } catch (e) {
      ultimo = e
      const msg = e instanceof Error ? e.message : String(e)
      if (!/busy|locked|timeout|eagain/i.test(msg)) throw e
      await new Promise((r) => setTimeout(r, 100 * (i + 1)))
    }
  }
  throw ultimo
}

type PrismaTx = {
  [delegate: string]: {
    findMany(a?: unknown): Promise<Registro[]>
    findUnique(a: unknown): Promise<Registro | null>
    count(a?: unknown): Promise<number>
    create(a: unknown): Promise<Registro>
    createMany(a: unknown): Promise<{ count: number }>
    upsert(a: unknown): Promise<Registro>
    update(a: unknown): Promise<Registro>
    deleteMany(a?: unknown): Promise<{ count: number }>
  }
}

function traduzirWhere(where: OpWhere | null): Record<string, unknown> {
  if (!where) return {}
  switch (where.tipo) {
    case 'equals':
      if (!campoSeguro(where.campo)) throw new Error('validacao:query:campo-invalido')
      return { [where.campo]: where.valor }
    case 'anyOf':
      if (!campoSeguro(where.campo)) throw new Error('validacao:query:campo-invalido')
      if (!where.valores.length) return { __vazio: true }
      return { [where.campo]: { in: where.valores } }
    case 'between': {
      if (!campoSeguro(where.campo)) throw new Error('validacao:query:campo-invalido')
      const cond: Record<string, unknown> = {}
      cond[where.incMin ? 'gte' : 'gt'] = where.min
      cond[where.incMax ? 'lte' : 'lt'] = where.max
      return { [where.campo]: cond }
    }
    case 'composto': {
      for (const c of where.campos) {
        if (!campoSeguro(c)) throw new Error('validacao:query:campo-invalido')
      }
      return { AND: where.campos.map((c, i) => ({ [c]: where.valores[i] })) }
    }
    case 'startsWith':
      if (!campoSeguro(where.campo)) throw new Error('validacao:query:campo-invalido')
      return { [where.campo]: { startsWith: where.prefixo } }
  }
}

/** Chave de deduplicação do modo inserir (paridade last-wins do `bulkPut` Dexie). */
function chaveDedupe(tabela: string, d: Registro, seq: number): string {
  const { pk } = STORE_META[tabela]
  const v = d[pk]
  if (v !== undefined) return `pk:${String(v)}`
  // Tabelas auto-incremento sem id explícito nunca colidem na PK; a única
  // unique extra do seed é o par (`cnaeNbs`: `cnae7|nbs`).
  if (tabela === 'cnaeNbs') return `par:${String(d.cnae7)}|${String(d.nbs)}`
  return `novo:${seq}`
}

/** Remove duplicadas mantendo a ÚLTIMA ocorrência (como o Dexie). */
function deduparParaInserir(tabela: string, linhas: Registro[]): Registro[] {
  const vistas = new Set<string>()
  const saida: Registro[] = []
  for (let i = linhas.length - 1; i >= 0; i--) {
    const k = chaveDedupe(tabela, linhas[i], i)
    if (vistas.has(k)) continue
    vistas.add(k)
    saida.push(linhas[i])
  }
  return saida.reverse()
}

export class DriverPrisma implements Driver {
  private prisma: PrismaTx | null = null
  private conectando: Promise<PrismaTx> | null = null
  /** Caminho resolvido UMA vez por instância: close()/open() preservam o banco. */
  private readonly caminho: string

  constructor(caminhoExplicito?: string) {
    this.caminho = resolverCaminhoBanco(caminhoExplicito)
  }

  private async db(): Promise<PrismaTx> {
    if (this.prisma) return this.prisma
    if (!this.conectando) {
      const caminho = this.caminho
      this.conectando = prismaComo(caminho).then((p) => p as unknown as PrismaTx)
    }
    this.prisma = await this.conectando
    return this.prisma
  }

  private delegate(tabela: string) {
    const m = STORE_META[tabela]
    if (!m) throw new Error(`validacao:${tabela}:store-desconhecida`)
    return m
  }

  private async tabela(tabela: string) {
    const p = await this.db()
    const d = p[this.delegate(tabela).delegate]
    if (!d) throw new Error(`sqlite:${tabela}:modelo-ausente`)
    return d
  }

  private filtro(where: OpWhere | null): Record<string, unknown> | null {
    if (!where) return {}
    const f = traduzirWhere(where)
    if ((f as Record<string, unknown>).__vazio) return null
    return f
  }

  async buscar(tabela: string, where: OpWhere | null): Promise<Registro[]> {
    const f = this.filtro(where)
    if (f === null) return []
    return (await this.tabela(tabela)).findMany({ where: f })
  }

  async contar(tabela: string, where: OpWhere | null): Promise<number> {
    const f = this.filtro(where)
    if (f === null) return 0
    return (await this.tabela(tabela)).count({ where: f })
  }

  async porChave(tabela: string, chave: string | number): Promise<Registro | null> {
    validarChave(tabela, chave)
    const { pk } = this.delegate(tabela)
    return (await this.tabela(tabela)).findUnique({ where: { [pk]: chave } })
  }

  async inserir(tabela: string, registro: Registro): Promise<string | number> {
    validarRegistro(tabela, registro)
    const { pk, auto } = this.delegate(tabela)
    const dados = somenteConhecidos(tabela, { ...registro })
    if (auto && dados[pk] === undefined) delete dados[pk]
    const t = await this.tabela(tabela)
    const criado = await comRetry(() => t.create({ data: dados }))
    return criado[pk] as string | number
  }

  async upsert(tabela: string, registro: Registro): Promise<string | number> {
    validarRegistro(tabela, registro)
    const { pk, auto } = this.delegate(tabela)
    const dados = somenteConhecidos(tabela, { ...registro })
    const v = dados[pk]
    const temChave =
      (typeof v === 'string' && v !== '') || (typeof v === 'number' && Number.isInteger(v) && v >= 0)
    const t = await this.tabela(tabela)
    if (!temChave) {
      if (!auto) throw new Error(`validacao:${tabela}:chave-ausente`)
      if (dados[pk] === undefined) delete dados[pk]
      const criado = await comRetry(() => t.create({ data: dados }))
      return criado[pk] as string | number
    }
    const resto = { ...dados }
    delete resto[pk]
    const gravado = await comRetry(() => t.upsert({ where: { [pk]: v }, update: resto, create: dados }))
    return gravado[pk] as string | number
  }

  /**
   * Lote em UMA transação (paridade `bulkPut` do Dexie, mas atômico de
   * verdade). Sem chave em tabela auto-incremento vira `create`; com chave,
   * `upsert`. Validação item a item antes de abrir a transação.
   */
  async lote(tabela: string, registros: Registro[], modo: ModoLote = 'upsert'): Promise<void> {
    if (!registros.length) return
    const { pk, auto } = this.delegate(tabela)
    const limpos = registros.map((r) => {
      validarRegistro(tabela, r)
      return somenteConhecidos(tabela, { ...r })
    })
    const t = await this.tabela(tabela)
    if (modo === 'inserir') {
      // Só-insere em UM statement (createMany): duplicadas puladas no banco.
      // Usado após clear()/delete-where — tudo é novo por construção.
      const comChave = new Map<string, Registro>()
      const semChave: Registro[] = []
      for (const d of limpos) {
        const copia = { ...d }
        if (auto && copia[pk] === undefined) delete copia[pk]
        if (copia[pk] === undefined) semChave.push(copia)
        else comChave.set(String(copia[pk]), copia)
      }
      // Remove as que já existem no banco (uma consulta por lote).
      if (comChave.size) {
        const chaves = [...comChave.values()].map((d) => d[pk]) as Array<string | number>
        const existentes = await t.findMany({
          where: { [pk]: { in: chaves } },
          select: { [pk]: true },
        })
        for (const e of existentes) comChave.delete(String(e[pk]))
      }
      let dados = deduparParaInserir(tabela, [...comChave.values(), ...semChave])
      // Par único extra (`cnaeNbs` sem id): filtra contra o banco.
      if (tabela === 'cnaeNbs' && dados.some((d) => d[pk] === undefined)) {
        const pares = await t.findMany({ select: { cnae7: true, nbs: true } })
        const vistos = new Set(pares.map((p) => `${String(p.cnae7)}|${String(p.nbs)}`))
        dados = dados.filter((d) => {
          if (d[pk] !== undefined) return true
          const k = `${String(d.cnae7)}|${String(d.nbs)}`
          if (vistos.has(k)) return false
          vistos.add(k)
          return true
        })
      }
      if (!dados.length) return
      await comRetry(() => t.createMany({ data: dados as never[] }))
      return
    }
    const ops = limpos.map((dados) => {
      const v = dados[pk]
      const temChave =
        (typeof v === 'string' && v !== '') || (typeof v === 'number' && Number.isInteger(v) && v >= 0)
      if (!temChave) {
        if (!auto) throw new Error(`validacao:${tabela}:chave-ausente`)
        const semPk = { ...dados }
        if (semPk[pk] === undefined) delete semPk[pk]
        return t.create({ data: semPk })
      }
      const resto = { ...dados }
      delete resto[pk]
      return t.upsert({ where: { [pk]: v }, update: resto, create: dados })
    })
    const p = await this.db()
    const tx = (p as unknown as { $transaction(ops: unknown[]): Promise<unknown[]> }).$transaction
    if (typeof tx !== 'function') {
      for (const _op of ops) await _op
      return
    }
    await comRetry(() => tx.call(p, ops))
  }

  async atualizar(tabela: string, chave: string | number, patch: Registro): Promise<number> {
    validarChave(tabela, chave)
    const t = await this.tabela(tabela)
    const { pk } = this.delegate(tabela)
    const atual = await t.findUnique({ where: { [pk]: chave } })
    if (!atual) return 0
    const { [pk]: _ignorado, ...restoPatch } = somenteConhecidos(tabela, patch)
    const mesclado = { ...atual, ...restoPatch }
    validarRegistro(tabela, mesclado)
    const dados = { ...restoPatch }
    delete dados[pk]
    await comRetry(() => t.update({ where: { [pk]: chave }, data: dados }))
    return 1
  }

  async remover(tabela: string, chave: string | number): Promise<void> {
    validarChave(tabela, chave)
    const { pk } = this.delegate(tabela)
    const t = await this.tabela(tabela)
    await comRetry(() => t.deleteMany({ where: { [pk]: chave } }))
  }

  async limpar(tabela: string): Promise<void> {
    const t = await this.tabela(tabela)
    await comRetry(() => t.deleteMany({}))
  }

  async removerOnde(tabela: string, where: OpWhere): Promise<number> {
    const f = this.filtro(where)
    if (f === null) return 0
    const t = await this.tabela(tabela)
    const r = await comRetry(() => t.deleteMany({ where: f }))
    return r.count
  }

  async apagarTudo(tabelas: string[]): Promise<void> {
    for (const t of tabelas) {
      this.delegate(t)
      const tab = await this.tabela(t)
      await comRetry(() => tab.deleteMany({}))
    }
  }

  async fechar(): Promise<void> {
    await fecharPrisma()
    this.prisma = null
    this.conectando = null
  }
}

/** Registra o driver Prisma como padrão do processo Node atual. */
export function registrarDriverPrisma(caminhoExplicito?: string): DriverPrisma {
  const d = new DriverPrisma(caminhoExplicito)
  definirDriver(d)
  return d
}
