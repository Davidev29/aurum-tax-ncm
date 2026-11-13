/**
 * Artefatos NBS oficiais da base embutida (`public/base/`, gerados pelo
 * `build-base.mjs` a partir de `bases-fonte/` via `npm run fontes:sync`):
 *
 *   - `nbs-nomenclatura.json` — NBS 2.00 completa (3.239 posições, 919
 *     subitens; hierarquia capítulos → subitens com descrições oficiais).
 *     Fonte: MDIC — Painel de Códigos NBS (Power BI), Portaria Conjunta
 *     RFB/SCS nº 2.000, de 18/12/2018.
 *   - `nbs-depara.json` — DE-PARA NBS 1.1 ↔ 2.0 (1.391 linhas).
 *     Fonte: MDIC — "Planilha de Correlação entre as versões 1.1 e 2.0 da
 *     NBS" (Comissão da NBS, 2019). Orientação de migração — sem caráter
 *     oficial de classificação.
 *
 * Estes arquivos são ESTÁTICOS por build (não passam pelo SQLite). Este
 * módulo é o único ponto de acesso: carrega sob demanda, cacheia em
 * memória e tolera a ausência do artefato (retorna `null` — a UI cai no
 * comportamento legado de "sem descrição oficial").
 */
import { lerArquivoBase } from '@/infrastructure/bridge'

export type NivelNbs =
  | 'capitulo'
  | 'posicao'
  | 'subposicao1'
  | 'subposicao2'
  | 'item'
  | 'subitem'

export interface NbsNomenclaturaItem {
  /** Dígitos sem pontuação (ex.: `101011100`). */
  codigo: string
  /** Pontilhado oficial (ex.: `1.0101.11.00`). */
  codigoFormatado: string
  /** Descrição efetiva (própria ou herdada do ancestral mais próximo). */
  descricao: string
  /** Descrição crua da fonte; `null` quando o nó é publicamente vazio. */
  descricaoOriginal: string | null
  nivel: NivelNbs
  /** Dígitos do código-pai (`null` nos capítulos). */
  pai: string | null
  /** `true` apenas no nível subitem (9 dígitos). */
  folha: boolean
}

export interface NbsNomenclaturaArtefato {
  meta: {
    fonte: string
    url?: string
    norma?: string
    versao?: string
    capturaEm?: string | null
    refreshModelo?: string | null
    descricao?: string
    total?: number
    totalFolhas?: number
  }
  itens: NbsNomenclaturaItem[]
}

export interface NbsDeparaItem {
  nbs11: string | null
  nbs11Formatado: string | null
  desc11: string | null
  nbs20: string | null
  nbs20Formatado: string | null
  desc20: string | null
  /** Código idêntico nas duas versões. */
  identico: boolean
  /** `mapeado` (1.1→2.0) · `extinto` (sem correspondente 2.0) · `novo` (sem 1.1). */
  relacao: 'mapeado' | 'extinto' | 'novo'
  nivel: NivelNbs
}

export interface NbsDeparaArtefato {
  meta: {
    fonte: string
    url?: string
    norma?: string
    capturaEm?: string | null
    sha256Csv?: string | null
    total?: number
    mapeados?: number
    identidade?: number
    migrados?: number
    extintos?: number
    novos?: number
    nota?: string
  }
  itens: NbsDeparaItem[]
}

/** Apenas dígitos de uma entrada de código (entrada do usuário ou da base). */
export const digitosNbs = (v: unknown): string => String(v ?? '').replace(/\D+/g, '')

const cache = new Map<string, Promise<unknown | null>>()

async function carregarJson<T>(nome: string): Promise<T | null> {
  if (!cache.has(nome)) {
    cache.set(
      nome,
      lerArquivoBase(nome)
        .then((texto) => JSON.parse(texto) as T)
        .catch(() => null),
    )
  }
  return (await cache.get(nome)) as T | null
}

export function carregarNbsNomenclatura(): Promise<NbsNomenclaturaArtefato | null> {
  return carregarJson<NbsNomenclaturaArtefato>('nbs-nomenclatura.json')
}

export function carregarNbsDepara(): Promise<NbsDeparaArtefato | null> {
  return carregarJson<NbsDeparaArtefato>('nbs-depara.json')
}

const indiceNomenclatura = (() => {
  let promessa: Promise<Map<string, NbsNomenclaturaItem>> | null = null
  return () => {
    if (!promessa) {
      promessa = carregarNbsNomenclatura().then((artefato) => {
        const mapa = new Map<string, NbsNomenclaturaItem>()
        for (const item of artefato?.itens ?? []) {
          if (item && typeof item.codigo === 'string') mapa.set(item.codigo, item)
        }
        return mapa
      })
    }
    return promessa
  }
})()

/**
 * Descrição oficial NBS 2.00 do código (9 dígitos → subitem; aceita também
 * posições/itens). `null` quando o artefato está ausente ou o código não existe.
 */
export async function descricaoNbsOficial(codigo: string): Promise<NbsNomenclaturaItem | null> {
  const digitos = digitosNbs(codigo)
  if (!digitos) return null
  return (await indiceNomenclatura()).get(digitos) ?? null
}

/** Contadores para a aba Bases/status (contagem de itens do artefato). */
export async function contarNbsOficiais(): Promise<{ nomenclatura: number | null; depara: number | null }> {
  const [nom, dep] = await Promise.all([carregarNbsNomenclatura(), carregarNbsDepara()])
  return {
    nomenclatura: Array.isArray(nom?.itens) ? nom.itens.length : null,
    depara: Array.isArray(dep?.itens) ? dep.itens.length : null,
  }
}
