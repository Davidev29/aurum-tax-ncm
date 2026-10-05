/**
 * Regras hierárquicas — herança de benefício por família (capítulo/posição/
 * subposição) + exceções que quebram a herança.
 *
 * Mapeamento gerado por `scripts/mapear-familias-ncm.mjs` contra a base
 * oficial (`reforma_tributaria_por_ncm.json` × `Tabela_NCM_Vigente`):
 * - cobertura exata: só 15,9% dos NCMs vigentes têm vínculo de 8 dígitos;
 * - 839 subposições SH6 e 166 posições SH4 integralmente mapeadas e unânimes;
 * - 7 capítulos integralmente mapeados e unânimes (07, 10, 11, 12, 15, 25, 31).
 *
 * Política (conservadora, auditável — nunca inventa benefício):
 * 1. **Exato** (8 dígitos) sempre vence — herança só entra quando NÃO há
 *    vínculo exato nem manual nem revogação;
 * 2. **Condicional nunca herda sozinho**: cClassTribs cuja descrição exige
 *    destinação/adquirente/evento (`CCTS_CONDICIONAIS`) só viram hipótese
 *    "a confirmar", nunca herança automática;
 * 3. **Seção sozinha nunca decide**: seção (I–XXI) é ampla demais — serve
 *    só de contexto para a IA (RAG/lexical) e para hipóteses, jamais para
 *    herdar alíquota;
 * 4. Herança automática exige **unanimidade dos irmãos vinculados** +
 *    cobertura mínima dos vigentes do prefixo + mínimo de irmãos;
 * 5. Abaixo do limiar, o motor devolve **hipóteses por família** (candidatos
 *    a confirmar), não herança — sem restringir grupo com possível benefício.
 */

import type { NivelNcm } from './hierarquia-fiscal'

/** Regra de família presumida por capítulo (capítulos 100% mapeados e unânimes). */
export interface RegraCapitulo {
  capitulo: string
  cst: string
  cClassTrib: string
  anexo: string
  baseLegal: string
  /** Cobertura medida na base de referência (1 = 100%). */
  coberturaReferencia: number
}

/**
 * Capítulos integralmente mapeados e unânimes na base de referência
 * (todos os NCMs vigentes do capítulo têm vínculo, todos no mesmo
 * `200/200038` — Anexo IX, insumos agropecuários e aquícolas, art. 138).
 * NCM novo/vigente sem vínculo exato nesses capítulos herda por família
 * (nível capítulo), com confiança média e carimbo "a confirmar".
 *
 * Capítulos 06 e 23 foram EXCLUÍDOS de propósito: 06 é misto
 * (200038 + 200014/Anexo XV) e 23 tem cobertura parcial (92%) — ali a
 * herança só vale por posição/subposição, nunca pelo capítulo.
 */
export const REGRAS_CAPITULO: RegraCapitulo[] = [
  { capitulo: '07', cst: '200', cClassTrib: '200038', anexo: '9', baseLegal: 'Art. 138 — Anexo IX (herança por família: capítulo 07)', coberturaReferencia: 1 },
  { capitulo: '10', cst: '200', cClassTrib: '200038', anexo: '9', baseLegal: 'Art. 138 — Anexo IX (herança por família: capítulo 10)', coberturaReferencia: 1 },
  { capitulo: '11', cst: '200', cClassTrib: '200038', anexo: '9', baseLegal: 'Art. 138 — Anexo IX (herança por família: capítulo 11)', coberturaReferencia: 1 },
  { capitulo: '12', cst: '200', cClassTrib: '200038', anexo: '9', baseLegal: 'Art. 138 — Anexo IX (herança por família: capítulo 12)', coberturaReferencia: 1 },
  { capitulo: '15', cst: '200', cClassTrib: '200038', anexo: '9', baseLegal: 'Art. 138 — Anexo IX (herança por família: capítulo 15)', coberturaReferencia: 1 },
  { capitulo: '25', cst: '200', cClassTrib: '200038', anexo: '9', baseLegal: 'Art. 138 — Anexo IX (herança por família: capítulo 25)', coberturaReferencia: 1 },
  { capitulo: '31', cst: '200', cClassTrib: '200038', anexo: '9', baseLegal: 'Art. 138 — Anexo IX (herança por família: capítulo 31)', coberturaReferencia: 1 },
]

/** Regra de capítulo por código (busca O(1)). */
export function regraDoCapitulo(capitulo: unknown): RegraCapitulo | null {
  const c = String(capitulo ?? '').replace(/\D+/g, '').padStart(2, '0').slice(-2)
  return REGRAS_CAPITULO.find((r) => r.capitulo === c) ?? null
}

/**
 * cClassTribs condicionais: a descrição exige destinação, adquirente,
 * evento ou regime específico. Herdar sem confirmar a condição seria
 * atribuir benefício indevido — por isso esses ccts NUNCA geram herança
 * automática: viram hipótese "a confirmar" com a condição citada.
 */
export const CCTS_CONDICIONAIS: Record<string, string> = {
  '000003': 'Projetos incentivados do regime automotivo (art. 311) — exige habilitação.',
  '000004': 'Projetos incentivados do regime automotivo (art. 312) — exige habilitação.',
  '200002': 'Destinado a produtor rural não contribuinte ou transportador autônomo PF (art. 110) — exige destinação.',
  '200005': 'Dispositivo médico do Anexo IV quando adquirido por adm. pública/entidade imune CEBAS (art. 144) — exige adquirente.',
  '200006': 'Emergência de saúde pública reconhecida pelo Legislativo (art. 144, §3º) — exige ato conjunto vigente.',
  '200008': 'Dispositivo de acessibilidade do Anexo V quando adquirido por adm. pública/entidade imune (art. 145) — exige adquirente.',
  '200010': 'Medicamento quando adquirido por adm. pública/entidade imune — exige adquirente.',
  '200011': 'Composições enterais/paranterais destinadas a erros inatos do metabolismo — exige destinação clínica.',
  '200012': 'Emergência de saúde pública (art. 144, §3º) — exige ato conjunto vigente.',
  '200015': 'Automóveis de passageiros nacionais ≥4 portas (condições do art.) — exige característica do bem.',
  '200022': 'Operação originada fora da ZFM destinada a contribuinte incentivado — exige regime.',
  '200023': 'Operação entre indústrias incentivadas — exige regime.',
  '410014': 'Fornecimento de produtor rural não contribuinte (art. 164) — exige condição do fornecedor.',
  '410015': 'Fornecimento por transportador autônomo não contribuinte (art. 169) — exige condição do prestador.',
  '550019': 'Importação por indústria incentivada para uso na ZFM (art. 443) — exige regime.',
  '810001': 'Crédito presumido em fornecimentos a partir da ZFM (art. 450) — exige origem.',
}

/** `true` quando o cct exige condição (nunca herda sozinho). */
export function ehCondicional(cct: unknown): boolean {
  const d = String(cct ?? '').replace(/\D+/g, '').padStart(6, '0').slice(-6)
  return d in CCTS_CONDICIONAIS
}

/** Condição textual do cct condicional (para a hipótese "a confirmar"). */
export function condicaoDoCct(cct: unknown): string | null {
  const d = String(cct ?? '').replace(/\D+/g, '').padStart(6, '0').slice(-6)
  return CCTS_CONDICIONAIS[d] ?? null
}

/* ---------------- limiares de herança (curadoria, ver mapeamento) -------- */

/**
 * Limiares mínimos para herança AUTOMÁTICA por nível.
 * - `minIrmaos`: irmãos vinculados unânimes exigidos;
 * - `coberturaMin`: vinculados / vigentes do prefixo.
 *
 * Calibragem: SH6 com 1/253 vinculados (ex.: 2933) NÃO herda; SH6
 * 230990 com 7/8 vinculados herda. Posição exige mais lastro (mais filhos).
 * Capítulo só herda nos 7 capítulos curados acima (cobertura 100%).
 */
export const LIMIAR_HERANCA = {
  subposicao: { minIrmaos: 2, coberturaMin: 0.6 },
  posicao: { minIrmaos: 3, coberturaMin: 0.75 },
  capitulo: { minIrmaos: 5, coberturaMin: 0.95 },
} as const

/** Nível de herança permitido (seção/item/exato excluídos por construção). */
export type NivelHeranca = 'subposicao' | 'posicao' | 'capitulo'

/** Origem da classificação herdada (para trilha/auditoria). */
export type OrigemHeranca = 'familia-SH6' | 'familia-SH4' | 'familia-capitulo' | 'capitulo-curado'

/* ---------------- exceções que quebram a herança -------------------------- */

/** Exceção cadastrada: condição que invalida a herança por família. */
export interface ExcecaoFamilia {
  id: string
  motivo: string
  /** Sinais do classificador que disparam a exceção. */
  sinais: string[]
  /** Texto de alerta exibido na justificativa. */
  alerta: string
}

/**
 * Exceções que QUEBRAM a herança (o benefício da família não se aplica
 * quando a condição está presente — o motor rebaixa para hipótese ou
 * regra geral + alerta, nunca herda em silêncio).
 */
export const EXCECOES_FAMILIA: ExcecaoFamilia[] = [
  {
    id: 'sal-adicionado',
    motivo: 'Adição de sal/aditivos pode descaracterizar o enquadramento do benefício.',
    sinais: ['SAL_ADICIONADO'],
    alerta: 'Adição de sal/aditivos: o benefício da família exige composição sem sal adicionado — confirmar percentual antes de aplicar.',
  },
  {
    id: 'produto-cozido',
    motivo: 'Anexo XV exige produto hortícola/fruta/ovo não cozido.',
    sinais: ['COZIDO'],
    alerta: 'Produto cozido/processado pode perder o benefício do Anexo XV (que exige in natura) — confirmar preparo.',
  },
  {
    id: 'destinacao-condicional',
    motivo: 'Benefício da família exige destinação específica (plantio, produtor rural, adm. pública).',
    sinais: ['SEMENTE_PLANTIO', 'RACAO_ANIMAL'],
    alerta: 'Benefício condicionado à destinação (plantio/consumo/ração, produtor rural, adm. pública) — confirmar uso real.',
  },
  {
    id: 'vivo-sem-destinacao',
    motivo: 'Animal vivo sem destinação clara (reprodução × abate) — a subposição depende do uso.',
    sinais: ['VIVO'],
    alerta: 'Animal vivo sem destinação (reprodução × abate): a herança por família é provisória até informar o uso.',
  },
]

/**
 * Decisão pura de herança: dados os irmãos vinculados unânimes (ou não),
 * decide herdar / sugerir hipótese / negar. Sem I/O — o repositório coleta
 * os números e chama aqui, o que mantém a regra testável sem IndexedDB.
 */
export interface EntradaDecisaoHeranca {
  nivel: NivelHeranca
  /** Irmãos com vínculo no prefixo (excluído o próprio consultado). */
  irmaosVinculados: number
  /** NCMs vigentes no prefixo (denominador da cobertura). */
  vigentesNoPrefixo: number
  /** `true` quando todos os irmãos vinculados têm o mesmo CST/cClassTrib. */
  unanime: boolean
  /** O cct unânime é condicional? (nunca herda sozinho). */
  condicional: boolean
}

export type DecisaoHeranca =
  | { tipo: 'herdar'; confianca: 'alta' | 'media' }
  | { tipo: 'hipotese'; motivo: string }
  | { tipo: 'negar'; motivo: string }

/** Aplica limiares + travas (unanimidade, condicional, cobertura). */
export function decidirHeranca(e: EntradaDecisaoHeranca): DecisaoHeranca {
  if (!e.unanime || e.irmaosVinculados === 0) {
    return { tipo: 'negar', motivo: 'irmãos com enquadramentos divergentes ou sem lastro — sem herança' }
  }
  if (e.condicional) {
    return { tipo: 'hipotese', motivo: 'enquadramento da família é condicional — exige confirmação da destinação/adquirente' }
  }
  const lim = LIMIAR_HERANCA[e.nivel]
  const cobertura = e.vigentesNoPrefixo > 0 ? e.irmaosVinculados / e.vigentesNoPrefixo : 0
  if (e.irmaosVinculados < lim.minIrmaos || cobertura < lim.coberturaMin) {
    if (e.irmaosVinculados >= 1 && cobertura >= 0.4) {
      return { tipo: 'hipotese', motivo: `lastro insuficiente para herança automática (${e.irmaosVinculados} irmão(s), cobertura ${Math.round(cobertura * 100)}%) — hipótese a confirmar` }
    }
    return { tipo: 'negar', motivo: `sem lastro de família (${e.irmaosVinculados} irmão(s)) — regra geral` }
  }
  // Cobertura total (só falta o consultado) → alta; parcial acima do limiar → média.
  const alta = cobertura >= 0.95 || e.irmaosVinculados === e.vigentesNoPrefixo - 1
  return { tipo: 'herdar', confianca: alta ? 'alta' : 'media' }
}

/** Nível → origem legível (para trilha/auditoria). */
export function origemDoNivel(nivel: NivelHeranca, curado = false): OrigemHeranca {
  if (nivel === 'capitulo' && curado) return 'capitulo-curado'
  if (nivel === 'capitulo') return 'familia-capitulo'
  if (nivel === 'posicao') return 'familia-SH4'
  return 'familia-SH6'
}

/** Nível → tamanho do prefixo em dígitos. */
export function tamanhoDoNivel(nivel: NivelHeranca): 6 | 4 | 2 {
  return nivel === 'subposicao' ? 6 : nivel === 'posicao' ? 4 : 2
}

/** Rótulo do nível para exibição (`subposicao` → "Subposição SH6"). */
export function rotuloNivelHeranca(nivel: NivelHeranca): string {
  return nivel === 'subposicao' ? 'Subposição SH6' : nivel === 'posicao' ? 'Posição SH4' : 'Capítulo'
}

export type { NivelNcm }
