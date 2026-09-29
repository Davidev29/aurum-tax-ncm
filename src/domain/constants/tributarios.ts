import { LINK_LC214 } from './index'

/**
 * Artigos da LC 214/2025 citados nos cartões de classificação.
 * `art133` e `art139` existem no texto original mas não são referenciados
 * pelo motor de observações (mantidos por completude documental — SPEC R2.20).
 */
export interface ObservacaoLegal {
  titulo: string
  texto: string
  link: string
}

export const OBS_ARTIGOS: Record<string, ObservacaoLegal> = {
  art137: {
    titulo: 'Art. 137 — Produtos in natura',
    texto:
      'Ficam reduzidas em 60% as alíquotas do IBS e da CBS incidentes sobre o fornecimento de produtos agropecuários, aquícolas, pesqueiros, florestais e extrativistas vegetais in natura.',
    link: `${LINK_LC214}#art137`,
  },
  art128: {
    titulo: 'Art. 128 — Redução de 60%',
    texto:
      'Redução de 60% das alíquotas do IBS e da CBS para serviços de educação, saúde, dispositivos médicos, medicamentos, alimentos, produtos de higiene, insumos agropecuários, produções culturais e outros.',
    link: `${LINK_LC214}#art128`,
  },
  art135: {
    titulo: 'Art. 135 — Alimentos',
    texto: 'Redução de 60% das alíquotas do IBS e da CBS para alimentos destinados ao consumo humano.',
    link: `${LINK_LC214}#art135`,
  },
  art133: {
    titulo: 'Art. 133 — Medicamentos',
    texto:
      'Redução de 60% das alíquotas do IBS e da CBS para medicamentos registrados na ANVISA ou produzidos por farmácias de manipulação.',
    link: `${LINK_LC214}#art133`,
  },
  art139: {
    titulo: 'Art. 139 — Produções culturais',
    texto:
      'Redução de 60% das alíquotas do IBS e da CBS para produções nacionais artísticas, culturais, de eventos, jornalísticas e audiovisuais.',
    link: `${LINK_LC214}#art139`,
  },
}

/** Capítulos abrangidos pelo Art. 135 (alimentos) — SPEC R2.19 (17 entradas). */
export const CAPITULOS_ART_135: ReadonlySet<string> = new Set([
  '02', '03', '04', '07', '08', '09', '10', '11', '12', '15', '16', '17', '18',
  '19', '20', '21', '22',
])

/** Limiares de redução de alíquota (SPEC R2.22). */
export const LIMIARES = { ZERO: 100, REDUZIDA: 60, PARCIAL: 30 } as const

/** Rótulos do anexo derivado da redução de IBS (SPEC R3.3). */
export const ANEXO_LABELS: Record<string, string> = {
  '0': '🟢 Anexo I — Alíquota Zero',
  '60': '🟡 Redução 60%',
  '30': '🔵 Redução 30%',
  isento: '⚪ Sem redução',
}
