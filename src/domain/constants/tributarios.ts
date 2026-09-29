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
  art127: {
    titulo: 'Art. 127 — Profissões regulamentadas (redução de 30%)',
    texto:
      'Redução de 30% das alíquotas do IBS e da CBS para serviços de profissões intelectuais de natureza científica, literária ou artística submetidas a conselho profissional.',
    link: `${LINK_LC214}#art127`,
  },
  art158: {
    titulo: 'Art. 158 — Reabilitação urbana (redução de 80%)',
    texto:
      'Redução de 80% das alíquotas do IBS e da CBS para locação de imóveis em zonas reabilitadas, pelo prazo de 5 anos do habite-se, em projetos delimitados por lei municipal ou distrital.',
    link: `${LINK_LC214}#art158`,
  },
  art261: {
    titulo: 'Art. 261 — Bens imóveis (redução de 50% / 70%)',
    texto:
      'Redução de 50% das alíquotas do IBS e da CBS nas operações com bens imóveis e de 70% na locação, cessão onerosa e arrendamento de bens imóveis.',
    link: `${LINK_LC214}#art261`,
  },
  art275: {
    titulo: 'Art. 275 — Bares e restaurantes (redução de 40%)',
    texto: 'Redução de 40% das alíquotas do IBS e da CBS para bares e restaurantes.',
    link: `${LINK_LC214}#art275`,
  },
  art281: {
    titulo: 'Art. 281 — Hotelaria e parques (redução de 40%)',
    texto:
      'Redução de 40% das alíquotas do IBS e da CBS para hotelaria, parques de diversão e parques temáticos.',
    link: `${LINK_LC214}#art281`,
  },
  art286: {
    titulo: 'Art. 286 — Transporte coletivo (redução de 40%)',
    texto:
      'Redução de 40% das alíquotas do IBS e da CBS para transporte coletivo de passageiros rodoviário, ferroviário e hidroviário intermunicipal e interestadual.',
    link: `${LINK_LC214}#art286`,
  },
  art287: {
    titulo: 'Art. 287 — Transporte aéreo regional (redução de 40%)',
    texto:
      'Redução de 40% das alíquotas do IBS e da CBS para serviços de transporte aéreo regional coletivo de passageiros ou de carga.',
    link: `${LINK_LC214}#art287`,
  },
  art289: {
    titulo: 'Art. 289 — Agências de turismo (redução de 40%)',
    texto: 'Redução de 40% das alíquotas do IBS e da CBS para agências de turismo.',
    link: `${LINK_LC214}#art289`,
  },
  art308: {
    titulo: 'Art. 308 — Prouni (IBS −60% / CBS −100%)',
    texto:
      'Fornecimento de serviços de educação do Prouni: redução de 60% da alíquota do IBS e de 100% (alíquota zero) da CBS.',
    link: `${LINK_LC214}#art308`,
  },
}

/** Capítulos abrangidos pelo Art. 135 (alimentos) — SPEC R2.19 (17 entradas). */
export const CAPITULOS_ART_135: ReadonlySet<string> = new Set([
  '02', '03', '04', '07', '08', '09', '10', '11', '12', '15', '16', '17', '18',
  '19', '20', '21', '22',
])

/** Limiares de redução de alíquota (SPEC R2.22). Mantidos por compatibilidade. */
export const LIMIARES = { ZERO: 100, REDUZIDA: 60, PARCIAL: 30 } as const

/** Percentuais oficiais de redução previstos na LC 214/2025. */
export const REDUCOES_OFICIAIS = [80, 70, 60, 50, 40, 30] as const

/** Rótulos do anexo derivado da redução (SPEC R3.3 — faixas oficiais + misto). */
export const ANEXO_LABELS: Record<string, string> = {
  '0': '🟢 Alíquota zero',
  '80': '🟠 Redução 80%',
  '70': '🟠 Redução 70%',
  '60': '🟡 Redução 60%',
  '50': '🔵 Redução 50%',
  '40': '🔵 Redução 40%',
  '30': '🔵 Redução 30%',
  misto: '🟣 Redução IBS ≠ CBS',
  isento: '⚪ Sem redução',
}

const ROMANOS: Record<string, string> = {
  '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V', '6': 'VI', '7': 'VII',
  '8': 'VIII', '9': 'IX', '10': 'X', '11': 'XI', '12': 'XII', '13': 'XIII',
  '14': 'XIV', '15': 'XV',
}

/**
 * Rótulo do anexo OFICIAL da base (`Número do Anexo`: "1".."15", "9xxxx").
 *
 * Não confundir com `ANEXO_LABELS` (faixas derivadas da redução usadas no
 * SPED): passar o número oficial direto caía no fallback "Sem redução".
 * Números 1–15 viram "Anexo IX" etc.; códigos 9xxxx (referência interna da
 * base a artigos da lei) são exibidos crus com prefixo neutro — sem inferir
 * dispositivo.
 */
export function rotuloAnexoOficial(anexo: unknown): string {
  const chave = String(anexo ?? '').trim()
  const romano = ROMANOS[chave]
  if (romano) return `Anexo ${romano} — LC 214/2025`
  if (chave) return `Ref. oficial ${chave}`
  return ANEXO_LABELS.isento
}

/**
 * Diferimento — Anexo IX (insumos agropecuários e aquícolas) e CST 510/515.
 *
 * - `CCTS_ANEXO_IX`: cClassTribs que identificam o Anexo IX na base oficial
 *   (`200038` = fornecimento com redução 60% + diferimento do art. 138;
 *   `515001` = CST de diferimento com redução).
 * - `CSTS_DIFERIMENTO`: CSTs de diferimento (510 = diferimento puro,
 *   515 = diferimento com redução).
 */
export const CCTS_ANEXO_IX: ReadonlySet<string> = new Set(['200038', '515001'])

export const CSTS_DIFERIMENTO: ReadonlySet<string> = new Set(['510', '515'])

export const LINK_ART138 = `${LINK_LC214}#art138`
export const LINK_ART168 = `${LINK_LC214}#art168`
export const LINK_ART213 = `${LINK_LC214}#art213`
export const LINK_ART214 = `${LINK_LC214}#art214`
