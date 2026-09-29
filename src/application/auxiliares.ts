/**
 * Casos de uso das **tabelas auxiliares** (CFOP, CST ICMS, CST PIS/COFINS,
 * CST da Reforma, cClassTrib, NCM, Nomenclatura, NBS, Referência).
 *
 * A v1 tinha duas lacunas aqui:
 *
 * 1. **`[BUG] L1879`** — a checagem de duplicidade rodava apenas para stores com
 *    keyPath `codigo`. Em `cstClassTrib` (keyPath `id`, composto `cst|cClassTrib`)
 *    um "novo" com combinação já existente **sobrescrevia silenciosamente** o
 *    registro via `put`.
 * 2. Ao trocar a chave em modo edição, o registro antigo era apagado *antes* da
 *    validação de obrigatórios, de modo que um erro de validação perdia dado.
 *
 * `salvarRegistroAux` corrige os dois: valida → confere duplicidade em
 * **qualquer** keyPath → apaga a chave antiga → grava.
 */
import { norm, uid } from '@/domain/services/format'
import type { StoreName } from '@/domain/constants'
import { db } from '@/infrastructure/db/schema'

export type KeyPath = 'codigo' | 'id' | 'chave'

export interface CampoObrigatorio {
  nome: string
  label: string
}

export interface EntradaRegistroAux {
  store: StoreName
  keyPath: KeyPath
  /** Dados já coletados do formulário. */
  dados: Record<string, unknown>
  /** `null` quando é um registro novo. */
  chaveOriginal?: string | number | null
  camposObrigatorios?: CampoObrigatorio[]
  /** Normalizações específicas do tipo de tabela (ncm/cfop/cst). */
  normalizar?: (dados: Record<string, unknown>) => void
}

export type ResultadoRegistroAux =
  | { ok: true; status: 'criado' | 'atualizado'; registro: Record<string, unknown> }
  | { ok: false; motivo: string }

/**
 * Normalizações que a v1 fazia inline por tipo (SPEC §10.4).
 *
 * `[BUG] L1872`: em `tipo 'cst'` a chave do registro chama-se `codigo`, não
 * `cst` — a v1 normalizava um campo inexistente e gravava `'5'` ao lado de
 * `'005'`. Aqui o normalizador escreve na chave real.
 */
export const NORMALIZADORES: Record<string, (d: Record<string, unknown>) => void> = {
  ncm: (d) => { if (d.codigo) d.codigo = norm(d.codigo) },
  ncmnomen: (d) => { if (d.codigo) d.codigo = norm(d.codigo) },
  cfop: (d) => { if (d.codigo) d.codigo = norm(d.codigo) },
  cst: (d) => {
    if (d.codigo) d.codigo = String(d.codigo).replace(/\D/g, '').padStart(3, '0')
    if (d.cst) d.cst = String(d.cst).replace(/\D/g, '').padStart(3, '0')
  },
}

/** Chave composta `cst|cClassTrib` (ambos com preenchimento à esquerda). */
export const idCstCct = (cst: unknown, cClassTrib: unknown): string =>
  `${String(cst ?? '').replace(/\D/g, '').padStart(3, '0')}|${String(cClassTrib ?? '').replace(/\D/g, '').padStart(6, '0')}`

/** Chave única de vínculo NCM (paridade com a v1, que acrescenta um sufixo). */
export const idVinculoNcm = (codigo: unknown, cClassTrib: unknown, anterior?: unknown): string =>
  anterior ? String(anterior) : `${norm(codigo)}|${cClassTrib ?? ''}|${uid()}`

export async function salvarRegistroAux(e: EntradaRegistroAux): Promise<ResultadoRegistroAux> {
  const dados = { ...e.dados }
  e.normalizar?.(dados)
  // O tipo também pode ser reconhecido pela store.
  if (e.store === 'cst' || e.store === 'cstIcms' || e.store === 'cfop') NORMALIZADORES[e.store]?.(dados)

  // 1) obrigatórios — validados **antes** de qualquer escrita.
  for (const campo of e.camposObrigatorios ?? []) {
    const valor = dados[campo.nome]
    if (valor == null || String(valor).trim() === '') {
      return { ok: false, motivo: `Campo "${campo.label}" é obrigatório.` }
    }
  }

  // 2) montagem da chave composta.
  if (e.keyPath === 'id' && e.store === 'cstClassTrib') {
    dados.id = idCstCct(dados.cst, dados.cClassTrib)
    dados.cst = String(dados.id).split('|')[0]
    dados.cClassTrib = String(dados.id).split('|')[1]
  } else if (e.keyPath === 'id' && e.store === 'ncm') {
    dados.id = idVinculoNcm(dados.codigo, dados.cClassTrib, dados.id)
  } else if (e.keyPath === 'id' && !dados.id) {
    dados.id = uid()
  }

  const chave = dados[e.keyPath] as string | number | undefined
  if (chave == null || String(chave).trim() === '') {
    return { ok: false, motivo: 'Chave do registro vazia.' }
  }

  const editando = e.chaveOriginal != null

  // 3) duplicidade — agora cobre `codigo` **e** `id` (correção do L1879).
  if (!editando) {
    const existente = await db.table(e.store).get(chave)
    if (existente) {
      return { ok: false, motivo: 'Já existe um registro com esta chave. Ajuste os dados para não sobrescrever o existente.' }
    }
  } else if (String(e.chaveOriginal) !== String(chave)) {
    // Chave alterada em edição: só remove a antiga quando a nova não colide.
    const colisao = await db.table(e.store).get(chave)
    if (colisao) {
      return { ok: false, motivo: 'Já existe outro registro com esta chave.' }
    }
    await db.table(e.store).delete(e.chaveOriginal as string | number)
  }

  try {
    await db.table(e.store).put(dados as never)
    return { ok: true, status: editando ? 'atualizado' : 'criado', registro: dados }
  } catch (erro) {
    return { ok: false, motivo: `Erro ao gravar: ${(erro as Error).message}` }
  }
}

export async function excluirRegistroAux(store: StoreName, chave: string | number): Promise<void> {
  await db.table(store).delete(chave)
}

/* --------------------------------------------------------------- semente -- */

/**
 * Garante que as três tabelas simples tenham conteúdo (CFOP, CST ICMS e
 * CST PIS/COFINS), sem duplicar o que o usuário já cadastrou.
 */
export async function garantirSementes(
  sementes: { cfop: { codigo: string; descricao: string; tipo?: 'Entrada' | 'Saída' | 'Outros' }[]; cstIcms: { codigo: string; descricao: string }[]; cstPisCofins: { codigo: string; descricao: string }[] },
): Promise<void> {
  const [nCfop, nIcms, nPis] = await Promise.all([db.cfop.count(), db.cstIcms.count(), db.cstPisCofins.count()])
  if (nCfop === 0 && sementes.cfop.length) await db.cfop.bulkPut(sementes.cfop as never[])
  if (nIcms === 0 && sementes.cstIcms.length) await db.cstIcms.bulkPut(sementes.cstIcms as never[])
  if (nPis === 0 && sementes.cstPisCofins.length) await db.cstPisCofins.bulkPut(sementes.cstPisCofins as never[])
}
