/**
 * Hierarquia fiscal do NCM — capítulo, posição, subposição, seção e família.
 *
 * Motivação (LC 214/2025): os anexos nem sempre listam o NCM completo de
 * 8 dígitos. A lei opera por **família** — capítulo (2 dígitos, ex.: `07`),
 * posição SH4 (4 dígitos, ex.: `0713`), subposição SH6 (6 dígitos,
 * ex.: `0713.33`), item (7º dígito) e subitem (8º dígito). O que passar do
 * prefixo listado, desde que pertença à mesma família (mesmo início,
 * capítulo e seção), pode pertencer à regra do anexo.
 *
 * Este módulo é 100% puro (sem I/O): descreve a estrutura. A decisão de
 * herdar ou não vive em `regras-hierarquicas.ts` (curadoria + limiares) e
 * a execução em `infrastructure/base/classificacao-repo.ts`
 * (`resolverPorFamilia`).
 *
 * Estrutura do NCM (8 dígitos `PPPPSSII` na prática `CC PPPP SS I S`):
 * - `CC` (dígitos 1–2): capítulo (01–97, sem 77);
 * - `PPPP` (dígitos 1–4): posição (SH4);
 * - `PPPPSS` (dígitos 1–6): subposição (SH6);
 * - dígito 7: item; dígito 8: subitem (nível Mercosul).
 */

import { norm } from './format'

/** Nível hierárquico de um código (2/4/6/7/8 dígitos ou inválido). */
export type NivelNcm = 'capitulo' | 'posicao' | 'subposicao' | 'item' | 'exato' | 'invalido'

/** Seção do Sistema Harmonizado (agrupamento oficial de capítulos). */
export interface SecaoNcm {
  /** Algarismo romano (I–XXI). */
  numero: string
  nome: string
  /** Capítulos de 2 dígitos pertencentes à seção. */
  capitulos: string[]
}

/**
 * 21 seções do SH — agrupamento OMC usado pela TEC.
 * Fonte: estrutura do Sistema Harmonizado (capítulos 01–97, sem 77).
 */
export const SECOES_NCM: SecaoNcm[] = [
  { numero: 'I', nome: 'Animais vivos e produtos do reino animal', capitulos: ['01', '02', '03', '04', '05'] },
  { numero: 'II', nome: 'Produtos do reino vegetal', capitulos: ['06', '07', '08', '09', '10', '11', '12', '13', '14'] },
  { numero: 'III', nome: 'Gorduras e óleos animais ou vegetais', capitulos: ['15'] },
  { numero: 'IV', nome: 'Produtos das indústrias alimentares; bebidas; fumo', capitulos: ['16', '17', '18', '19', '20', '21', '22', '23', '24'] },
  { numero: 'V', nome: 'Produtos minerais', capitulos: ['25', '26', '27'] },
  { numero: 'VI', nome: 'Produtos das indústrias químicas ou conexas', capitulos: ['28', '29', '30', '31', '32', '33', '34', '35', '36', '37', '38'] },
  { numero: 'VII', nome: 'Plásticos e borracha', capitulos: ['39', '40'] },
  { numero: 'VIII', nome: 'Peles, couros e suas obras', capitulos: ['41', '42', '43'] },
  { numero: 'IX', nome: 'Madeira, carvão vegetal e cortiça', capitulos: ['44', '45', '46'] },
  { numero: 'X', nome: 'Pastas de madeira; papel e suas obras', capitulos: ['47', '48', '49'] },
  { numero: 'XI', nome: 'Matérias têxteis e suas obras', capitulos: ['50', '51', '52', '53', '54', '55', '56', '57', '58', '59', '60', '61', '62', '63'] },
  { numero: 'XII', nome: 'Calçados, chapéus, guarda-chuvas e afins', capitulos: ['64', '65', '66', '67'] },
  { numero: 'XIII', nome: 'Obras de pedra, gesso, cerâmica e vidro', capitulos: ['68', '69', '70'] },
  { numero: 'XIV', nome: 'Pérolas, pedras e metais preciosos; bijuterias', capitulos: ['71'] },
  { numero: 'XV', nome: 'Metais comuns e suas obras', capitulos: ['72', '73', '74', '75', '76', '78', '79', '80', '81', '82', '83'] },
  { numero: 'XVI', nome: 'Máquinas e aparelhos elétricos', capitulos: ['84', '85'] },
  { numero: 'XVII', nome: 'Material de transporte', capitulos: ['86', '87', '88', '89'] },
  { numero: 'XVIII', nome: 'Instrumentos de precisão; relógios; música', capitulos: ['90', '91', '92'] },
  { numero: 'XIX', nome: 'Armas e munições', capitulos: ['93'] },
  { numero: 'XX', nome: 'Mercadorias e produtos diversos (móveis, brinquedos)', capitulos: ['94', '95', '96'] },
  { numero: 'XXI', nome: 'Objetos de arte, coleção e antiguidades', capitulos: ['97'] },
]

/** Capítulo (2 dígitos) → seção (busca O(1)). */
const CAPITULO_SECAO: Record<string, SecaoNcm> = {}
for (const s of SECOES_NCM) {
  for (const c of s.capitulos) CAPITULO_SECAO[c] = s
}

/** Seção de um capítulo (`01` → Seção I). `null` quando capítulo desconhecido. */
export function secaoDoCapitulo(capitulo: unknown): SecaoNcm | null {
  const c = String(capitulo ?? '').replace(/\D+/g, '').padStart(2, '0').slice(-2)
  return CAPITULO_SECAO[c] ?? null
}

/** Seção de um NCM completo ou prefixo (lê os 2 primeiros dígitos). */
export function secaoDoNcm(codigo: unknown): SecaoNcm | null {
  const d = norm(codigo)
  if (d.length < 2) return null
  return secaoDoCapitulo(d.slice(0, 2))
}

/** Capítulo de um NCM/prefixo (2 primeiros dígitos). `''` quando sem dígitos. */
export function capituloDoNcm(codigo: unknown): string {
  return norm(codigo).slice(0, 2)
}

/** Posição SH4 (4 primeiros dígitos). */
export function posicaoDoNcm(codigo: unknown): string {
  return norm(codigo).slice(0, 4)
}

/** Subposição SH6 (6 primeiros dígitos). */
export function subposicaoDoNcm(codigo: unknown): string {
  return norm(codigo).slice(0, 6)
}

/**
 * Nível hierárquico pelos dígitos informados.
 * - 2 → capitulo · 4 → posicao · 6 → subposicao · 7 → item · 8 → exato.
 * - Qualquer outro tamanho → invalido (3, 5 e >8 são truncamentos
 *   ambíguos: a lei não opera nesses recortes, então o motor os trata como
 *   prefixo da família mais próxima sem afirmar nível).
 */
export function nivelDoCodigo(codigo: unknown): NivelNcm {
  const d = norm(codigo)
  switch (d.length) {
    case 2: return 'capitulo'
    case 4: return 'posicao'
    case 6: return 'subposicao'
    case 7: return 'item'
    case 8: return 'exato'
    default: return 'invalido'
  }
}

/** Prefixos hierárquicos de um NCM de 8 dígitos (2 → 4 → 6 → 7 → 8). */
export function prefixosDoNcm(codigo: unknown): string[] {
  const d = norm(codigo)
  if (d.length !== 8) return []
  return [d.slice(0, 2), d.slice(0, 4), d.slice(0, 6), d.slice(0, 7), d]
}

/** Rótulo legível do nível (`posicao` → "Posição SH4 0713"). */
export function rotuloNivel(nivel: NivelNcm, prefixo: string): string {
  const p = norm(prefixo)
  switch (nivel) {
    case 'capitulo': return `Capítulo ${p.slice(0, 2)}`
    case 'posicao': return `Posição SH4 ${p.slice(0, 4)}`
    case 'subposicao': return `Subposição SH6 ${p.slice(0, 6)}`
    case 'item': return `Item ${p.slice(0, 7)}`
    case 'exato': return `NCM ${p.slice(0, 8)}`
    default: return `Prefixo ${p}`
  }
}

/** Descrição da família de um NCM (capítulo + seção + prefixos). */
export interface FamiliaNcm {
  codigo: string
  capitulo: string
  secao: string | null
  nomeSecao: string | null
  posicao: string
  subposicao: string
  prefixos: string[]
}

/** Família hierárquica de um NCM de 8 dígitos. */
export function familiaDoNcm(codigo: unknown): FamiliaNcm | null {
  const d = norm(codigo)
  if (d.length !== 8) return null
  const secao = secaoDoNcm(d)
  return {
    codigo: d,
    capitulo: d.slice(0, 2),
    secao: secao?.numero ?? null,
    nomeSecao: secao?.nome ?? null,
    posicao: d.slice(0, 4),
    subposicao: d.slice(0, 6),
    prefixos: prefixosDoNcm(d),
  }
}

/**
 * `true` quando dois códigos pertencem à mesma família no nível dado.
 * Ex.: `mesmaFamilia('07133319', '07133329', 'subposicao')` → ambos
 * `071333` → mesma subposição.
 */
export function mesmaFamilia(a: unknown, b: unknown, nivel: Exclude<NivelNcm, 'invalido'> = 'subposicao'): boolean {
  const da = norm(a)
  const db = norm(b)
  const tam = nivel === 'capitulo' ? 2 : nivel === 'posicao' ? 4 : nivel === 'subposicao' ? 6 : nivel === 'item' ? 7 : 8
  if (da.length < tam || db.length < tam) return false
  return da.slice(0, tam) === db.slice(0, tam)
}

/**
 * Normaliza entrada truncada da Reforma (4–5 dígitos, ex.: subposição
 * abreviada da planilha) para o prefixo de família mais próximo.
 * - 2 dígitos → capítulo; 4 → posição; 6 → subposição;
 * - 3/5/7 dígitos → arredonda para baixo (2/4/6), pois a lei não opera
 *   nesses recortes — o motor classifica pela família que contém o recorte.
 * - 8 → exato; demais → `null`.
 */
export function prefixoDeEntradaTruncada(codigo: unknown): { prefixo: string; nivel: NivelNcm } | null {
  const d = norm(codigo)
  if (d.length === 8) return { prefixo: d, nivel: 'exato' }
  if (d.length === 7) return { prefixo: d.slice(0, 6), nivel: 'subposicao' }
  if (d.length === 6) return { prefixo: d, nivel: 'subposicao' }
  if (d.length === 5) return { prefixo: d.slice(0, 4), nivel: 'posicao' }
  if (d.length === 4) return { prefixo: d, nivel: 'posicao' }
  if (d.length === 3) return { prefixo: d.slice(0, 2), nivel: 'capitulo' }
  if (d.length === 2) return { prefixo: d, nivel: 'capitulo' }
  return null
}
