import { CAPITULOS_ART_135, LIMIARES, OBS_ARTIGOS } from '../constants/tributarios'
import { LINK_LC214 } from '../constants'
import { CAPITULOS_IN_NATURA, CAPITULOS_NCM } from '../constants/capitulos'
import type { Observacao, ResultadoCalculo } from '../entities'
import { norm } from './format'

/**
 * Cálculo tributário (LC 214/2025 — redução via base de cálculo).
 *
 * - `valorOperacao` = base cheia (qtd × valor).
 * - `bcIBS = valorOperacao × (1 − redIBS/100)` (zerada se red ≥ 100).
 * - `bcCBS = valorOperacao × (1 − redCBS/100)` (zerada se red ≥ 100).
 * - `vIBS = bcIBS × refIBS/100`, `vCBS = bcCBS × refCBS/100`.
 * - `aliqIBS/aliqCBS` = alíquotas efetivas sobre o valor cheio
 *   (`ref × (1 − red/100)`) — mantidas por compatibilidade de exibição;
 *   o débito é sempre `BC reduzida × alíquota cheia`, de modo que
 *   `vIBS = base × aliqIBS/100` continua valendo.
 * - Reduções são clampadas em 0–100 (red 100% ⇒ BC zero, sem tributo).
 */
export function calcularTributos(
  valorBase: number,
  redIBS: number,
  redCBS: number,
  refIBS: number,
  refCBS: number,
): ResultadoCalculo {
  const base = Number(valorBase) || 0
  const rIBS = Math.min(100, Math.max(0, Number(redIBS) || 0))
  const rCBS = Math.min(100, Math.max(0, Number(redCBS) || 0))
  const refI = Number(refIBS) || 0
  const refC = Number(refCBS) || 0
  const bcIBS = base * (1 - rIBS / 100)
  const bcCBS = base * (1 - rCBS / 100)
  const aliqIBS = refI * (1 - rIBS / 100)
  const aliqCBS = refC * (1 - rCBS / 100)
  const vIBS = bcIBS * (refI / 100)
  const vCBS = bcCBS * (refC / 100)
  const total = vIBS + vCBS
  return {
    base,
    valorOperacao: base,
    bcIBS,
    bcCBS,
    redIBS: rIBS,
    redCBS: rCBS,
    refIBS: refI,
    refCBS: refC,
    aliqIBS,
    aliqCBS,
    vIBS,
    vCBS,
    total,
    carga: base > 0 ? (total / base) * 100 : 0,
  }
}

/**
 * Anexo derivado — **somente** no fluxo SPED (SPEC R3.3).
 * Derivado exclusivamente de `redIBS` (mesma particularidade da v1).
 */
export function anexoDeReducao(redIBS: number): '0' | '60' | '30' | 'isento' {
  const n = Number(redIBS) || 0
  if (n >= LIMIARES.ZERO) return '0'
  if (n >= LIMIARES.REDUZIDA) return '60'
  if (n >= LIMIARES.PARCIAL) return '30'
  return 'isento'
}

export type CorPill = 'red' | 'amber' | 'emerald'

/** Badge visual de redução (SPEC R2.23). */
export function badgeReducao(valor: unknown): { rotulo: string; cor: CorPill } {
  const n = Number(valor) || 0
  if (n >= LIMIARES.ZERO) return { rotulo: '⚡ Alíquota zero', cor: 'red' }
  if (n > 0) {
    const txt = `−${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
    return { rotulo: txt, cor: 'amber' }
  }
  return { rotulo: 'Sem redução', cor: 'emerald' }
}

/**
 * Observações legais (SPEC R2.18–R2.21).
 *
 * Ramos por faixa de redução (decisão exclusiva por `if / else if`, portanto
 * **no máximo um** grupo por faixa):
 *
 * - `>= 60%` — o grupo é **acumulativo**: art. 137 (se capítulo *in natura*),
 *   art. 135 (se capítulo dos 17 do art. 135) e **sempre** o art. 128.
 * - demais faixas — um único item fixo.
 *
 * Paridade: `art133` (medicamentos) e `art139` (produções culturais) continuam
 * definidos em `OBS_ARTIGOS` mas **não são emitidos** — o motor cobre medicamentos
 * e demais setores pelo `art128`, exatamente como a v1 (SPEC R2.20 / §12).
 */
export function observacoesLegais(ncm: string, redIBS: number): Observacao[] {
  const cod = norm(ncm)
  const cap = cod.slice(0, 2)
  const red = Number(redIBS) || 0

  if (red >= LIMIARES.ZERO) {
    return [
      {
        titulo: 'Alíquota Zero',
        texto: 'Produto com alíquota zero de IBS/CBS conforme legislação específica.',
        cor: 'emerald',
      },
    ]
  }

  if (red >= LIMIARES.REDUZIDA) {
    const obs: Observacao[] = []
    if (CAPITULOS_IN_NATURA.has(cap)) obs.push(comArtigo('art137'))
    if (CAPITULOS_ART_135.has(cap)) obs.push(comArtigo('art135'))
    obs.push(comArtigo('art128'))
    return obs
  }

  if (red >= LIMIARES.PARCIAL) {
    return [
      {
        titulo: 'Redução parcial',
        texto: 'Produto com redução parcial de alíquotas conforme Anexo da LC 214/2025.',
        cor: 'amber',
      },
    ]
  }

  return [
    {
      titulo: 'Regra geral',
      texto:
        'Produto sujeito à tributação integral (alíquota cheia) de IBS/CBS conforme regra geral da LC 214/2025.',
      cor: 'slate',
    },
  ]
}

/** Aviso "produto potencialmente in natura" (Art. 137) — SPEC R2.16. */
export function avisoInNatura(ncm: string): Observacao | null {
  const cod = norm(ncm)
  if (cod.length !== 8) return null
  const cap = cod.slice(0, 2)
  if (!CAPITULOS_IN_NATURA.has(cap)) return null
  const nome = CAPITULOS_NCM[cap] ?? ''
  return {
    titulo: `Produto potencialmente in natura — Capítulo ${cap}${nome ? ` — ${nome}` : ''}`,
    texto:
      `Este NCM pertence ao Capítulo ${cap}${nome ? ` — ${nome}` : ''}, que pode conter produtos in natura. ` +
      'Art. 137 da LC 214/2025: fornecimento de produtos agropecuários, aquícolas, pesqueiros, florestais ' +
      'e extrativistas vegetais in natura tem redução de 60% das alíquotas de IBS e CBS.',
    adendo:
      'Verifique se o seu produto se enquadra como "in natura". Caso positivo, a classificação pode ser diferente.',
    cor: 'emerald',
    link: `${LINK_LC214}#art137`,
    rotuloLink: 'Consultar Art. 137 da LC 214/2025',
  }
}

function comArtigo(chave: 'art137' | 'art135' | 'art128'): Observacao {
  const o = OBS_ARTIGOS[chave]
  const numero = chave.replace('art', '')
  return {
    titulo: o.titulo,
    texto: o.texto,
    cor: chave === 'art137' ? 'emerald' : 'amber',
    link: o.link.includes('#') ? o.link : `${LINK_LC214}#art${numero}`,
  }
}
