import {
  CAPITULOS_ART_135,
  CCTS_ANEXO_IX,
  CSTS_DIFERIMENTO,
  LIMIARES,
  LINK_ART138,
  OBS_ARTIGOS,
} from '../constants/tributarios'
import { LINK_LC214 } from '../constants'
import { CAPITULOS_IN_NATURA, CAPITULOS_NCM } from '../constants/capitulos'
import type { Classificacao, NomenclaturaNcm, Observacao, ResultadoCalculo } from '../entities'
import { norm } from './format'
import { observacaoExtincaoNcm } from './classificacao'
import { observacaoRevogacao } from './revogacao'

/**
 * Cálculo tributário (LC 214/2025 — redução de ALÍQUOTA).
 *
 * Mecânica legal: a base de cálculo é o valor cheio da operação
 * (`qtd × valor`) e a redução incide sobre a alíquota de referência:
 * - `aliqIBS = refIBS × (1 − redIBS/100)` (zerada se red ≥ 100);
 * - `aliqCBS = refCBS × (1 − redCBS/100)` (zerada se red ≥ 100);
 * - `vIBS = base × aliqIBS/100`, `vCBS = base × aliqCBS/100`.
 * - `bcIBS/bcCBS` = base cheia (mantidos por compatibilidade de exibição
 *   e soma de relatórios; NÃO há redução de base aqui — `pRed` da base
 *   oficial é sempre redução de alíquota).
 * - Reduções são clampadas em 0–100 (red 100% ⇒ alíquota zero, sem tributo,
 *   com a BC preservada).
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
  const aliqIBS = refI * (1 - rIBS / 100)
  const aliqCBS = refC * (1 - rCBS / 100)
  const bcIBS = base
  const bcCBS = base
  const vIBS = base * (aliqIBS / 100)
  const vCBS = base * (aliqCBS / 100)
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

/** Compara percentuais com tolerância de centésimos (ruído de importação). */
const mesmoPct = (a: number, b: number): boolean => Math.abs(a - b) < 0.005

/**
 * Anexo derivado — faixas oficiais da LC 214/2025 (30/40/50/60/70/80/100).
 *
 * - `redIBS ≈ redCBS ≈ 100` → `'0'` (alíquota zero);
 * - `redIBS ≠ redCBS` → `'misto'` (ex.: Prouni 60/100, art. 308);
 * - percentual oficial exato (tolerância 0,005) → `'30' | '40' | '50' | '60' | '70' | '80'`;
 * - demais valores positivos → faixa imediatamente inferior (piso), sem
 *   inflar a redução;
 * - `0` → `'isento'`.
 */
export function anexoDeReducao(
  redIBS: number,
  redCBS: number = redIBS,
): '0' | '80' | '70' | '60' | '50' | '40' | '30' | 'misto' | 'isento' {
  const a = Number(redIBS) || 0
  const b = Number(redCBS) || 0
  if (a >= 99.995 && b >= 99.995) return '0'
  if (!mesmoPct(a, b)) return 'misto'
  const n = a
  if (n <= 0) return 'isento'
  if (n >= 99.995) return '0'
  for (const oficial of [80, 70, 60, 50, 40, 30] as const) {
    if (Math.abs(n - oficial) < 0.005) return String(oficial) as '80' | '70' | '60' | '50' | '40' | '30'
  }
  if (n >= 80) return '80'
  if (n >= 70) return '70'
  if (n >= 60) return '60'
  if (n >= 50) return '50'
  if (n >= 40) return '40'
  if (n >= 30) return '30'
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
 * Observações legais (SPEC R2.18–R2.21, estendido às faixas oficiais).
 *
 * Ramos por faixa de redução (decisão exclusiva por `if / else if`, portanto
 * **no máximo um** grupo por faixa, exceto o ramo `60` que é acumulativo):
 *
 * - `100/100` — alíquota zero;
 * - `IBS ≠ CBS` — mensagem assimétrica (ex.: Prouni 60/100, art. 308);
 * - `60` — grupo **acumulativo**: art. 137 (se capítulo *in natura*),
 *   art. 135 (se capítulo dos 17 do art. 135) e **sempre** o art. 128;
 * - `80 / 70 / 50 / 40 / 30` — artigo próprio da faixa (158 / 261 / 275…);
 * - demais valores positivos — texto genérico com o percentual real;
 * - `0` — regra geral (tributação integral).
 *
 * Paridade: `art133` (medicamentos) e `art139` (produções culturais) continuam
 * definidos em `OBS_ARTIGOS` mas **não são emitidos** — o motor cobre medicamentos
 * e demais setores pelo `art128`, exatamente como a v1 (SPEC R2.20 / §12).
 */
export function observacoesLegais(ncm: string, redIBS: number, redCBS: number = redIBS): Observacao[] {
  const cod = norm(ncm)
  const cap = cod.slice(0, 2)
  const a = Number(redIBS) || 0
  const b = Number(redCBS) || 0

  if (a >= LIMIARES.ZERO && b >= LIMIARES.ZERO) {
    return [
      {
        titulo: 'Alíquota Zero',
        texto: 'Produto com alíquota zero de IBS/CBS conforme legislação específica.',
        cor: 'emerald',
      },
    ]
  }

  if (!mesmoPct(a, b)) {
    // Caso oficial assimétrico: Prouni (IBS 60% / CBS 100%).
    if (mesmoPct(a, 60) && b >= LIMIARES.ZERO) {
      return [
        {
          titulo: 'Redução assimétrica IBS 60% / CBS zero',
          texto:
            'Fornecimento de serviços de educação do Prouni com redução de 60% da alíquota do IBS e alíquota zero da CBS (art. 308 da LC 214/2025).',
          cor: 'amber',
          link: OBS_ARTIGOS.art308.link,
          rotuloLink: 'Consultar art. 308 da LC 214/2025',
        },
      ]
    }
    return [
      {
        titulo: `Redução assimétrica IBS ${fmtRed(a)} / CBS ${fmtRed(b)}`,
        texto: `Produto com redução de ${fmtRed(a)} da alíquota do IBS e de ${fmtRed(b)} da alíquota da CBS, calculadas de forma independente sobre a base cheia (LC 214/2025).`,
        cor: 'amber',
      },
    ]
  }

  const red = a
  if (red >= LIMIARES.ZERO) {
    return [
      {
        titulo: 'Alíquota Zero',
        texto: 'Produto com alíquota zero de IBS/CBS conforme legislação específica.',
        cor: 'emerald',
      },
    ]
  }

  if (Math.abs(red - 80) < 0.005) return [comArtigo('art158')]
  if (Math.abs(red - 70) < 0.005) return [comArtigo('art261')]
  if (Math.abs(red - 50) < 0.005) return [comArtigo('art261')]
  if (Math.abs(red - 40) < 0.005) {
    return [
      {
        titulo: 'Redução de 40% — arts. 275/281/286/287/289',
        texto:
          'Redução de 40% das alíquotas do IBS e da CBS para bares e restaurantes (art. 275), hotelaria e parques (art. 281), transporte coletivo intermunicipal/interestadual (art. 286), transporte aéreo regional (art. 287) e agências de turismo (art. 289).',
        cor: 'amber',
        link: OBS_ARTIGOS.art275.link,
        rotuloLink: 'Consultar art. 275 da LC 214/2025 (abre no início da faixa)',
      },
    ]
  }
  if (Math.abs(red - 30) < 0.005) return [comArtigo('art127')]

  if (Math.abs(red - 60) < 0.005) {
    const obs: Observacao[] = []
    if (CAPITULOS_IN_NATURA.has(cap)) obs.push(comArtigo('art137'))
    if (CAPITULOS_ART_135.has(cap)) obs.push(comArtigo('art135'))
    obs.push(comArtigo('art128'))
    return obs
  }

  if (red > 0) return obsFaixaGenerica(red)

  return [
    {
      titulo: 'Regra geral',
      texto:
        'Produto sujeito à tributação integral (alíquota cheia) de IBS/CBS conforme regra geral da LC 214/2025.',
      cor: 'slate',
    },
  ]
}

function obsFaixaGenerica(red: number): Observacao[] {
  return [
    {
      titulo: `Redução de ${fmtRed(red)}`,
      texto: `Produto com redução de ${fmtRed(red)} das alíquotas de IBS/CBS sobre a base cheia, conforme LC 214/2025.`,
      cor: 'amber',
    },
  ]
}

function fmtRed(red: number): string {
  const txt = Number(red).toLocaleString('pt-BR', { maximumFractionDigits: 2 })
  return `${txt}%`
}

/* --------------------------------------- tipo de alíquota (CST 010/011…) -- */

/**
 * Observação do `tipoAliquota` oficial (`2 - Padrão`, `4 - Uniforme Nacional`,
 * `5 - Uniforme Setorial`, `1 - Fixa`, `3 - Sem aliquota`).
 *
 * Motivo: as observações por faixa de redução citam os artigos do regime
 * padrão (ex.: art. 128 para 60%). Para CST 010/011 o fundamento legal é o
 * regime de alíquotas uniformes (arts. 236 a 246 — planos de saúde/funerários,
 * intermediação, concursos), então o artigo da faixa induz ao erro.
 * Retorna `null` para Padrão/Sem-alíquota (sem conflito).
 */
export function observacaoTipoAliquota(tipo: unknown): Observacao | null {
  const t = String(tipo ?? '').trim().toLowerCase()
  if (/^4\b/.test(t) || t.includes('uniforme nacional')) {
    return {
      titulo: 'Alíquota uniforme nacional (arts. 236 a 246)',
      texto:
        'Enquadramento no regime de alíquotas uniformes nacionais da LC 214/2025 — arts. 236 a 246 ' +
        '(planos de assistência funerária e à saúde, intermediação e concursos/prognósticos). ' +
        'O percentual exibido é da alíquota uniforme — não se aplica a fundamentação por anexo de redução.',
      cor: 'slate',
      link: `${LINK_LC214}#art236`,
      rotuloLink: 'Consultar arts. 236 a 246 da LC 214/2025',
    }
  }
  if (/^5\b/.test(t) || t.includes('uniforme setorial')) {
    return {
      titulo: 'Alíquota uniforme setorial',
      texto:
        'Enquadramento no regime de alíquotas uniformes setoriais da LC 214/2025 ' +
        '(operações do FGTS e do serviço financeiro). O percentual exibido é da alíquota ' +
        'uniforme do setor — não se aplica a fundamentação por anexo de redução.',
      cor: 'slate',
    }
  }
  if (/^1\b/.test(t) || t.includes('fixa')) {
    return {
      titulo: 'Alíquota fixa setorial',
      texto:
        'Enquadramento com alíquota fixa setorial da LC 214/2025 (operações com bens imóveis). ' +
        'O percentual exibido é a alíquota fixa — não se aplica a fundamentação por anexo de redução.',
      cor: 'slate',
    }
  }
  return null
}

/**
 * Lista consolidada de observações de um item classificado, na ordem de
 * criticidade: extinção do NCM → revogação do enquadramento → diferimento →
 * tipo de alíquota (uniforme/fixa substitui a fundamentação por faixa, cujo
 * artigo seria o do regime padrão) → fundamentação por faixa de redução.
 *
 * Usada por SPED, NF-e e Lote. Os cartões usam a mesma regra via
 * `observacoesFiscais` indireta (ver `cartoes.tsx`).
 */
export function observacoesFiscais(
  codigo: string,
  cl: Classificacao,
  nomenclatura?: NomenclaturaNcm | null,
): Observacao[] {
  const obs: Observacao[] = []
  const ext = observacaoExtincaoNcm(nomenclatura)
  if (ext) obs.push(ext)
  const rev = observacaoRevogacao(cl.revogado)
  if (rev) obs.push(rev)
  obs.push(...observacoesDiferimento(cl))
  const tipo = observacaoTipoAliquota(cl.cstClassTribDetalhes?.tipoAliquota)
  if (tipo) {
    obs.push(tipo)
    return obs
  }
  const redIBS = Number(cl.resumo?.percentualReducaoIBS) || 0
  const redCBS = Number(cl.resumo?.percentualReducaoCBS) || 0
  obs.push(...observacoesLegais(codigo, redIBS, redCBS))
  return obs
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

function comArtigo(chave: 'art137' | 'art135' | 'art128' | 'art127' | 'art158' | 'art261'): Observacao {
  const o = OBS_ARTIGOS[chave]
  const numero = chave.replace('art', '')
  return {
    titulo: o.titulo,
    texto: o.texto,
    cor: chave === 'art137' ? 'emerald' : 'amber',
    link: o.link.includes('#') ? o.link : `${LINK_LC214}#art${numero}`,
  }
}

/* ------------------------------------------------- diferimento (Anexo IX) -- */

/** Normaliza o anexo vindo da base (`9`, `09`, `IX`, `Anexo IX`, …). */
function anexoNorm(anexo: unknown): string {
  const s = String(anexo ?? '').trim().toUpperCase().replace(/^ANEXO\s+/, '')
  if (s === '9' || s === '09' || s === 'IX') return '9'
  return s
}

/**
 * É produto do **Anexo IX** (insumos agropecuários e aquícolas, art. 138)?
 *
 * Detecta por qualquer um dos sinais (a base varia por importação):
 * - `resumo.anexo` / `referencia.anexo` igual a 9/IX;
 * - `cClassTrib` 200038 (fornecimento c/ redução 60%) ou 515001 (diferimento);
 * - descrição da classificação citando "Anexo IX".
 */
export function ehAnexoIX(cl: Classificacao | null | undefined): boolean {
  if (!cl) return false
  const anexo = anexoNorm(cl.resumo?.anexo ?? cl.referencia?.anexo)
  if (anexo === '9') return true
  if (CCTS_ANEXO_IX.has(String(cl.cClassTrib ?? '').trim())) return true
  const desc = `${cl.resumo?.descricaoCClassTrib ?? ''} ${cl.baseLegal ?? ''} ${cl.cstClassTribDetalhes?.descricao ?? ''} ${cl.cstClassTribDetalhes?.nome ?? ''}`.toUpperCase()
  return desc.includes('ANEXO IX')
}

/**
 * É operação **sujeita a diferimento**?
 *
 * - Anexo IX (sempre: art. 138, §2º prevê diferimento para esses insumos);
 * - CST 510/515 ou `cstDetalhes.indDiferimento` (ex.: energia elétrica, art. 28).
 */
export function ehDiferimento(cl: Classificacao | null | undefined): boolean {
  if (!cl) return false
  if (ehAnexoIX(cl)) return true
  if (CSTS_DIFERIMENTO.has(String(cl.cst ?? '').trim())) return true
  if (cl.cstDetalhes?.indDiferimento) return true
  return false
}

function ehEnergiaEletrica(cl: Classificacao): boolean {
  if (String(cl.cClassTrib ?? '').trim() === '510001') return true
  if (String(cl.cst ?? '').trim() === '510') return true
  const desc = `${cl.resumo?.descricaoCClassTrib ?? ''} ${cl.baseLegal ?? ''}`.toUpperCase()
  return desc.includes('ENERGIA EL') && !ehAnexoIX(cl)
}

/**
 * Observação elegante de **diferimento** — mesmo padrão visual das demais
 * (`ListaObservacoes`).
 *
 * - **Anexo IX**: explica o que é o diferimento, as 4 hipóteses do
 *   art. 138, §2º (fornecimento/importação × regime regular/produtor rural),
 *   quando o recolhimento é encerrado e por quem (§§5º–9º), além da
 *   redução de 60% e do registro no MAPA (§1º).
 * - **Energia elétrica** (CST 510): art. 22/28 — recolhimento só no
 *   fornecimento para consumo ou para não contribuinte do regime regular.
 * - **Genérico**: CST 510/515 sem enquadramento específico.
 *
 * Retorna `[]` quando não há diferimento (o chamador só concatena).
 */
export function observacoesDiferimento(cl: Classificacao | null | undefined): Observacao[] {
  if (!cl || !ehDiferimento(cl)) return []

  if (ehEnergiaEletrica(cl)) {
    return [
      {
        titulo: '⏳ Diferimento — Energia elétrica (art. 28)',
        texto:
          'Por se tratar de produto sujeito a diferimento, o recolhimento do IBS/CBS fica adiado para etapa posterior da cadeia. ' +
          'Nas operações com energia elétrica ou direitos a ela relacionados (importação, geração, comercialização, distribuição e transmissão), ' +
          'o recolhimento ocorre somente no fornecimento para consumo ou para contribuinte não sujeito ao regime regular (arts. 22 e 28 da LC 214/2025). ' +
          'Enquanto a energia circula entre contribuintes do regime regular, o imposto não é recolhido — quem promove a operação de consumo recolhe.',
        cor: 'violet',
        link: `${LINK_LC214}#art28`,
        rotuloLink: 'Consultar arts. 22 e 28 da LC 214/2025',
      },
    ]
  }

  if (ehAnexoIX(cl)) {
    return [
      {
        titulo: '⏳ Produto diferido — Anexo IX (art. 138)',
        texto:
          'Por se tratar de produto do Anexo IX (insumos agropecuários e aquícolas), o recolhimento do IBS/CBS é DIFERIDO: ' +
          'fica adiado para etapa posterior da cadeia. O fornecimento já tem redução de 60% das alíquotas (art. 138, caput — exige registro no MAPA quando exigido, §1º). ' +
          'Hipóteses com diferimento (§2º): (I) fornecimento por contribuinte do regime regular para (a) outro contribuinte do regime regular ou ' +
          '(b) produtor rural não contribuinte que use o insumo em bem vendido a adquirente com direito aos créditos presumidos do art. 168; ' +
          '(II) importação por (a) contribuinte do regime regular ou (b) esse mesmo produtor rural (na proporção do §3º). ' +
          'Quando recolhe: o diferimento se encerra e quem promove a operação que encerra a fase recolhe (§6º) — ' +
          'para destinatário do regime regular, ao sair do diferimento (operação não alcançada, isenta/não tributada/suspensa/alíquota zero ou sem documento fiscal, §5º, com dispensa de recolhimento se houver direito a crédito, §8º); ' +
          'para produtor rural não contribuinte, mediante redução dos créditos presumidos do art. 168 (§9º).',
        cor: 'violet',
        link: LINK_ART138,
        rotuloLink: 'Consultar art. 138 e Anexo IX da LC 214/2025',
      },
    ]
  }

  return [
    {
      titulo: '⏳ Operação sujeita a diferimento',
      texto:
        'Por se tratar de produto diferido, o recolhimento do IBS/CBS fica adiado: não se recolhe nesta etapa — ' +
        'o imposto será recolhido por quem promover a operação que encerrar a fase do diferimento, observadas as hipóteses e o encerramento previstos na LC 214/2025 ' +
        '(para o Anexo IX, ver art. 138, §§2º e 5º–9º; para energia elétrica, arts. 22 e 28).',
      cor: 'violet',
      link: LINK_ART138,
      rotuloLink: 'Consultar diferimento na LC 214/2025',
    },
  ]
}
