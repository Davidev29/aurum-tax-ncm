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
import { observacaoHerancaFamilia } from './classificacao'
import { observacaoRevogacao } from './revogacao'

/**
 * Arredondamento fiscal para centavos (R$).
 * Todo valor monetário do sistema passa por aqui: cada tributo é
 * arredondado de forma independente e os totais são a soma dos
 * valores já arredondados. Isso garante que `IBS + CBS === Total`
 * em qualquer tela, relatório ou exportação — sem resíduos de float
 * (ex.: `0.1 + 0.05 = 0.15000000000000002`) e sem divergência de
 * 1 centavo entre parcelas exibidas e total exibido.
 */
export const round2 = (v: unknown): number => Math.round((Number(v) || 0) * 100) / 100

/**
 * C-011: CSTs onde a fórmula `ref × (1 − red)` NÃO vale — aplicar `calcularTributos`
 * aqui cobra imposto cheio onde o débito é zero (exportação imune, monofásica com
 * imposto retido antes, ajustes/transferências que nem são débito).
 * Gate pré-cálculo: `motivoRegimeEspecial()` != null → NÃO calcular; emitir a
 * observação de regime em vez de número.
 */
export const CST_SEM_DEBITO_NESTA_ETAPA = new Set([
  '410', // imunidade/isenção/não-incidência
  '550', // suspensão/regimes aduaneiros
  '620', // monofásica (retido anteriormente)
  '800', '810', '811', // ajustes/fusão/transferência de crédito
  '820', '830', // ajustes documentais
])

export function motivoRegimeEspecial(cst: unknown, tipoAliquota?: unknown): string | null {
  const c = String(cst ?? '').replace(/\D+/g, '').slice(0, 3)
  if (!c) return null
  if (c === '550') return 'regime-aduaneiro-suspensao: sem débito nesta etapa (arts. 82/84/85/87) — não aplicar alíquota cheia'
  if (c === '620') return 'monofasica: imposto retido anteriormente — não aplicar alíquota cheia sobre a operação'
  if (c === '410') return 'imunidade/isencao/nao-incidencia: sem débito — não aplicar alíquota cheia'
  if (['800', '810', '811', '820', '830'].includes(c)) {
    return 'ajuste-documental/transferencia: não é débito da operação — não aplicar alíquota cheia'
  }
  if (Number(tipoAliquota) === 3) return 'tipo-sem-aliquota: operação sem alíquota — não aplicar fórmula'
  return null
}

/**
 * Cálculo tributário (LC 214/2025 — redução de ALÍQUOTA).
 *
 * Mecânica legal: a base de cálculo é o valor cheio da operação
 * (`qtd × valor`) e a redução incide sobre a alíquota de referência:
 * - `aliqIBS = refIBS × (1 − redIBS/100)` (zerada se red ≥ 100);
 * - `aliqCBS = refCBS × (1 − redCBS/100)` (zerada se red ≥ 100);
 * - `vIBS = round2(base × aliqIBS/100)`, `vCBS = round2(base × aliqCBS/100)`.
 * - `bcIBS/bcCBS` = base cheia (mantidos por compatibilidade de exibição
 *   e soma de relatórios; NÃO há redução de base aqui — `pRed` da base
 *   oficial é sempre redução de alíquota).
 * - Reduções são clampadas em 0–100 (red 100% ⇒ alíquota zero, sem tributo,
 *   com a BC preservada).
 * - `base` é arredondada para centavos; `total = vIBS + vCBS` (soma de
 *   parcelas já arredondadas, com novo `round2` contra resíduo binário);
 *   `carga = total / base × 100` sobre os valores arredondados — é a carga
 *   efetivamente pagável, não a soma nominal das referências.
 */
export function calcularTributos(
  valorBase: number,
  redIBS: number,
  redCBS: number,
  refIBS: number,
  refCBS: number,
  opts?: { cst?: unknown; tipoAliquota?: unknown },
): ResultadoCalculo {
  // C-011: gate de regime — nunca tributo cheio onde não há débito.
  // Preserva as reduções informadas (não rotula como "alíquota zero"); zera só
  // os valores. O chamador deve exibir `motivoRegimeEspecial(cst, tipo)` junto.
  const motivo = motivoRegimeEspecial(opts?.cst, opts?.tipoAliquota)
  const base = round2(valorBase)
  const rIBS = Math.min(100, Math.max(0, Number(redIBS) || 0))
  const rCBS = Math.min(100, Math.max(0, Number(redCBS) || 0))
  if (motivo) {
    return {
      base,
      valorOperacao: base,
      bcIBS: base,
      bcCBS: base,
      redIBS: rIBS,
      redCBS: rCBS,
      refIBS: Number(refIBS) || 0,
      refCBS: Number(refCBS) || 0,
      aliqIBS: 0,
      aliqCBS: 0,
      vIBS: 0,
      vCBS: 0,
      total: 0,
      /** Alias explícito: o `total` puro é só IBS+CBS (IS não calculado — ver `observacaoIS`). */
      totalIBS_CBS: 0,
      carga: 0,
    }
  }
  const refI = Number(refIBS) || 0
  const refC = Number(refCBS) || 0
  const aliqIBS = refI * (1 - rIBS / 100)
  const aliqCBS = refC * (1 - rCBS / 100)
  const bcIBS = base
  const bcCBS = base
  const vIBS = round2(base * (aliqIBS / 100))
  const vCBS = round2(base * (aliqCBS / 100))
  const total = round2(vIBS + vCBS)
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
    /** Alias explícito: o `total` puro é só IBS+CBS (IS não calculado — ver `observacaoIS`). */
    totalIBS_CBS: total,
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
/**
 * Anexo REAL — prioriza o `anexo` oficial da base (join 3NF:
 * `resumo.anexo ?? referencia.anexo`), usa o piso derivado só como fallback.
 *
 * - oficial `1..15` / `9xxxx` (ex. '1', '9', '90111', '93081') → retornado cru
 *   (rótulo via `rotuloAnexoOficial`; `9xxxx` nunca vira artigo inferido);
 * - oficial já-derivado '0'|'30'..'80'|'misto'|'isento' → retornado como está;
 * - `null`/`''` → fallback `anexoDeReducao(redIBS, redCBS)` (piso).
 */
export function anexoReal(
  anexoOficial: unknown,
  redIBS: number,
  redCBS: number = redIBS,
): string {
  const oficial = String(anexoOficial ?? '').trim()
  if (oficial) return oficial
  return anexoDeReducao(redIBS, redCBS)
}

/**
 * Anexo OFICIAL da classificação (`Número do Anexo` da base:
 * `resumo.anexo ?? referencia.anexo`) ou `null` quando ausente.
 *
 * BLINDAGEM: nunca deriva por % de redução. Todo lugar que rotula o campo
 * como "Anexo" (telas, CSV, PDF) deve usar este helper — sem cobertura
 * oficial, sem afirmação (`null` vira `—`/vazio, nunca `60`/`isento`).
 */
export function anexoOficial(
  cl:
    | {
      resumo?: { anexo?: unknown } | null
      referencia?: { anexo?: unknown } | null
    }
    | null
    | undefined,
): string | null {
  const a = String(cl?.resumo?.anexo ?? cl?.referencia?.anexo ?? '').trim()
  return a ? a : null
}

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
 *   art. 135 (se capítulo dos 17 do art. 135) e **sempre** o art. 128 —
 *   SALVO com `semPalpiteCapitulo: true`, quando os palpites por capítulo
 *   (137/135) são suprimidos e resta só o art. 128;
 * - `80 / 70 / 50 / 40 / 30` — artigo próprio da faixa (158 / 261 / 275…);
 * - demais valores positivos — texto genérico com o percentual real;
 * - `0` — regra geral (tributação integral).
 *
 * `semPalpiteCapitulo` (usado quando há enquadramento oficial específico):
 * ser de um capítulo *in natura* ou de alimentos NÃO prova que o produto é
 * *in natura* (art. 137) ou alimento para consumo humano (art. 135) — isso
 * depende do produto concreto, não do NCM. Afirmar esses artigos a partir do
 * capítulo é o mesmo vício do diferimento automático: o NCM sozinho não
 * basta. Com enquadramento oficial (ex.: 200/200038, cujo fundamento é o
 * art. 138), os palpites por capítulo induzem ao erro e são suprimidos;
 * resta o art. 128, que é a regra geral dos 60%.
 *
 * USO RESTRITO (blindagem): os chamadores produtivos (`observacoesFiscais`,
 * cartões) só emitem esta função para a regra geral. Com enquadramento
 * específico, nenhum artigo inferido por faixa é exibido — a fundamentação
 * é exclusivamente a da base oficial. A função permanece pura e testada
 * para o fallback + reexport `observacoesDe`.
 *
 * Paridade: `art133` (medicamentos) e `art139` (produções culturais) continuam
 * definidos em `OBS_ARTIGOS` mas **não são emitidos** — o motor cobre medicamentos
 * e demais setores pelo `art128`, exatamente como a v1 (SPEC R2.20 / §12).
 */
export function observacoesLegais(
  ncm: string,
  redIBS: number,
  redCBS: number = redIBS,
  opts?: { semPalpiteCapitulo?: boolean },
): Observacao[] {
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
    if (!opts?.semPalpiteCapitulo) {
      if (CAPITULOS_IN_NATURA.has(cap)) obs.push(comArtigo('art137'))
      if (CAPITULOS_ART_135.has(cap)) obs.push(comArtigo('art135'))
    }
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
 * Imposto Seletivo (só aviso — IS não calculado) → cesta básica (selo
 * 200/200003, Anexo I/art. 125) → tipo de alíquota (uniforme/fixa substitui
 * a fundamentação por faixa, cujo artigo seria o do regime padrão).
 *
 * BLINDAGEM — fundamentação por faixa de redução (`observacoesLegais`) só é
 * emitida para a regra geral (fallback honesto, sem enquadramento). Com
 * enquadramento oficial específico (vínculo da base ou manual do usuário),
 * o sistema NÃO afirma artigo inferido por % de redução (arts. 128/127/158/
 * 261/275…, 308, "Alíquota Zero"): a fundamentação é a da base oficial
 * (cabeçalho da classificação + base legal + avisos específicos). Sem
 * cobertura oficial, sem afirmação — mesmo padrão dos selos por DFe
 * (`SelosPorSistema`: sistemas sem dados não afirmam nada).
 *
 * Usada por NF-e, SPED, Lote e revalidação. Os cartões usam a mesma regra
 * (ver `cartoes.tsx`).
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
  // Herança por família: mesmo criticidade da revogação — explica de onde
  // veio o benefício quando não há vínculo exato (vale em NF-e, SPED, Lote,
  // revalidação e consultas que usam este funil único).
  const her = observacaoHerancaFamilia(cl.heranca)
  if (her) obs.push(her)
  obs.push(...observacoesDiferimento(cl))
  const avisoIS = observacaoIS(codigo)
  if (avisoIS) obs.push(avisoIS)
  const cesta = observacaoCestaBasica(cl)
  if (cesta) obs.push(cesta)
  const tipo = observacaoTipoAliquota(cl.cstClassTribDetalhes?.tipoAliquota)
  if (tipo) {
    obs.push(tipo)
    return obs
  }
  if (cl.regraGeral) {
    const redIBS = Number(cl.resumo?.percentualReducaoIBS) || 0
    const redCBS = Number(cl.resumo?.percentualReducaoCBS) || 0
    obs.push(...observacoesLegais(codigo, redIBS, redCBS))
  }
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

/**
 * Capítulos NCM candidatos ao Imposto Seletivo (fase 1 — só aviso).
 *
 * O IS incide sobre produção/comercialização/importação de bens prejudiciais
 * à saúde e ao meio ambiente (LC 214/2025, arts. 402+). Lista CURADA de
 * capítulos onde o IS pode aparecer — capítulo candidato NÃO prova incidência:
 * 22 (bebidas), 24 (fumo/tabaco), 87 (veículos automóveis), 88 (aeronaves),
 * 89 (embarcações), 93 (armas e munições).
 *
 * Fase 1: o sistema NÃO calcula o IS — emite só o aviso para o usuário
 * conferir a lei. `total`/`totalIBS_CBS` cobrem exclusivamente IBS+CBS.
 */
export const CAPITULOS_CANDIDATOS_IS: ReadonlySet<string> = new Set([
  '22', '24', '87', '88', '89', '93',
])

/** Aviso "capítulo candidato ao Imposto Seletivo" — IS não calculado. */
export function observacaoIS(ncm: string): Observacao | null {
  const cod = norm(ncm)
  if (cod.length !== 8) return null
  const cap = cod.slice(0, 2)
  if (!CAPITULOS_CANDIDATOS_IS.has(cap)) return null
  const nome = CAPITULOS_NCM[cap] ?? ''
  return {
    titulo: `Imposto Seletivo — capítulo ${cap} candidato (IS não calculado)`,
    texto:
      `Este NCM pertence ao Capítulo ${cap}${nome ? ` — ${nome}` : ''}, candidato ao Imposto Seletivo ` +
      'sobre bens prejudiciais à saúde e ao meio ambiente (LC 214/2025, arts. 402+). ' +
      'IS não calculado — conferir LC214 e a regulamentação antes de escriturar: ' +
      'o total exibido cobre exclusivamente IBS + CBS.',
    cor: 'slate',
    link: `${LINK_LC214}#art402`,
    rotuloLink: 'Consultar Imposto Seletivo na LC 214/2025',
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
 * Fontes EXCLUSIVAMENTE oficiais (nunca descrição livre do produto/NCM,
 * que serve apenas como suporte ao usuário):
 * - `resumo.anexo` / `referencia.anexo` igual a 9/IX (campo `Número do Anexo`
 *   da base `classificacao-tributaria.json`);
 * - `cClassTrib` nos cClassTribs do Anexo IX na base oficial
 *   (`200038` = fornecimento com redução 60%; `515001` = diferimento).
 *
 * Ser do Anexo IX NÃO significa ser diferido: o diferimento do art. 138,
 * §2º é condicional à operação (ver `ehDiferimento`).
 */
export function ehAnexoIX(cl: Classificacao | null | undefined): boolean {
  if (!cl) return false
  const anexo = anexoNorm(cl.resumo?.anexo ?? cl.referencia?.anexo)
  if (anexo === '9') return true
  if (CCTS_ANEXO_IX.has(String(cl.cClassTrib ?? '').trim())) return true
  return false
}

/**
 * É operação **efetivamente diferida** (recolhimento adiado nesta etapa)?
 *
 * Fontes EXCLUSIVAMENTE oficiais, em ordem:
 * 1. CST de diferimento (`510` = diferimento puro, `515` = diferimento
 *    com redução — tabela auxiliar CST da Reforma);
 * 2. `cstDetalhes.indDiferimento` (flag `ind_gDif` da tabela CST oficial);
 * 3. `referencia.diferimento` (flag `Diferimento` da tabela de referência
 *    oficial CST × cClassTrib).
 *
 * Deliberadamente NÃO usa: anexo IX sozinho (Anexo IX com CST 200 é
 * tributação com redução 60%, só vira diferimento com CST 515 quando a
 * operação se enquadra no art. 138, §2º), nem varredura de texto em
 * descrições (descrição é suporte ao usuário, não base tributária).
 */
export function ehDiferimento(cl: Classificacao | null | undefined): boolean {
  if (!cl) return false
  if (CSTS_DIFERIMENTO.has(String(cl.cst ?? '').trim())) return true
  if (cl.cstDetalhes?.indDiferimento) return true
  if (cl.referencia?.diferimento === true) return true
  return false
}

/**
 * É produto do Anexo IX **sem** diferimento efetivo (caso típico:
 * CST 200 / cClassTrib 200038 — tributação com redução de 60%)?
 * O diferimento aqui é CONDICIONAL: depende da operação concreta
 * (art. 138, §2º — fornecimento entre contribuintes do regime regular,
 * produtor rural qualificado, importação). O NCM sozinho não basta para
 * afirmar diferimento — é preciso ver que produto/operação é.
 */
export function ehDiferimentoCondicionalAnexoIX(cl: Classificacao | null | undefined): boolean {
  if (!cl) return false
  if (ehDiferimento(cl)) return false
  return ehAnexoIX(cl)
}

function ehEnergiaEletrica(cl: Classificacao): boolean {
  if (String(cl.cClassTrib ?? '').trim() === '510001') return true
  if (String(cl.cst ?? '').trim() === '510') return true
  return false
}

/**
 * Observações de **diferimento** — mesmo padrão visual das demais
 * (`ListaObservacoes`).
 *
 * - **Diferimento efetivo — Anexo IX** (CST 515): o recolhimento é DIFERIDO
 *   nesta operação (art. 138, §§2º e 5º–9º), com redução de 60%.
 * - **Energia elétrica** (CST 510): art. 22/28 — recolhimento só no
 *   fornecimento para consumo ou para não contribuinte do regime regular.
 * - **Anexo IX sem diferimento efetivo** (ex.: CST 200/200038): NÃO é
 *   diferido — é tributação com redução de 60%. O diferimento é condicional
 *   à operação (art. 138, §2º); só há diferimento se a operação se enquadrar
 *   nas hipóteses legais (aí o CST passa a ser 515). Mensagem em âmbar,
 *   deliberadamente distinta do violeta "diferido".
 * - **Genérico**: CST 510/515 sem enquadramento específico.
 *
 * Retorna `[]` quando não há diferimento nem hipótese condicional.
 */
export function observacoesDiferimento(cl: Classificacao | null | undefined): Observacao[] {
  if (!cl) return []

  if (ehDiferimento(cl)) {
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
            'Operação com diferimento efetivo (CST 510/515 da base oficial): o recolhimento do IBS/CBS é DIFERIDO — ' +
            'fica adiado para etapa posterior da cadeia. O fornecimento tem redução de 60% das alíquotas (art. 138, caput — exige registro no MAPA quando exigido, §1º). ' +
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
          'Operação com diferimento efetivo (CST 510/515 da base oficial): o recolhimento do IBS/CBS fica adiado — ' +
          'não se recolhe nesta etapa — o imposto será recolhido por quem promover a operação que encerrar a fase do diferimento, observadas as hipóteses e o encerramento previstos na LC 214/2025 ' +
          '(para o Anexo IX, ver art. 138, §§2º e 5º–9º; para energia elétrica, arts. 22 e 28).',
        cor: 'violet',
        link: LINK_ART138,
        rotuloLink: 'Consultar diferimento na LC 214/2025',
      },
    ]
  }

  if (ehDiferimentoCondicionalAnexoIX(cl)) {
    const rotulo = norm(cl.codigo).length === 9 ? 'NBS' : 'NCM'
    return [
      {
        titulo: '⚠ Anexo IX — diferimento condicional (verificar a operação)',
        texto:
          `Este ${rotulo} é insumo agropecuário/aquícola do Anexo IX com redução de 60% das alíquotas (CST 200 da base oficial) — NÃO é automaticamente diferido. ` +
          'O diferimento do art. 138, §2º depende da operação concreta: só há diferimento no fornecimento entre contribuintes do regime regular, ' +
          'para produtor rural qualificado ou na importação (na proporção do §3º). Se a sua operação se enquadrar, o CST passa a ser 515 (diferimento com redução); ' +
          'caso contrário, tributa-se normalmente com a redução de 60%. Verifique que produto/operação é antes de escriturar como diferido.',
        cor: 'amber',
        link: LINK_ART138,
        rotuloLink: 'Consultar art. 138 e Anexo IX da LC 214/2025',
      },
    ]
  }

  return []
}

/* ------------------------------------- opção de diferimento (Anexo IX) -- */

/**
 * É item da **Cesta Básica Nacional de Alimentos** (Anexo I, art. 125)?
 *
 * Fonte EXCLUSIVAMENTE oficial: vínculo `CST 200 × cClassTrib 200003`
 * ("Vendas de produtos destinados à alimentação humana relacionados no
 * Anexo I ... observado o art. 125"), com redução 100/100 (alíquota zero).
 * Nome do alimento ou capítulo sozinho NUNCA decide — só o vínculo.
 */
export function ehCestaBasica(cl: Classificacao | null | undefined): boolean {
  if (!cl) return false
  return String(cl.cst ?? '').trim() === '200' && String(cl.cClassTrib ?? '').trim() === '200003'
}

/**
 * Selo da cesta básica — emitido quando há vínculo oficial 200/200003.
 *
 * Título fixo: "Cesta básica nacional — Anexo I / art. 125 (alíquota zero)".
 */
export function observacaoCestaBasica(cl: Classificacao | null | undefined): Observacao | null {
  if (!ehCestaBasica(cl)) return null
  return {
    titulo: 'Cesta básica nacional — Anexo I / art. 125 (alíquota zero)',
    texto:
      'Produto da Cesta Básica Nacional de Alimentos (Anexo I da LC 214/2025, art. 125): ' +
      'alíquota zero de IBS e CBS (redução de 100%). Vínculo oficial 200/200003 da base — sem cálculo adicional.',
    cor: 'emerald',
    link: `${LINK_LC214}#art125`,
    rotuloLink: 'Consultar art. 125 e Anexo I da LC 214/2025',
  }
}

/**
 * Classificação VIRTUAL da hipótese de diferimento para um item do Anexo IX
 * com diferimento condicional (caso típico: CST 200 / cClassTrib 200038 com
 * redução de 60%).
 *
 * Representa "e se a operação se enquadrar no art. 138, §2º": o CST passa a
 * ser 515 (diferimento com redução) e a redução vai a 100% — ou seja,
 * alíquota 0% de IBS/CBS nesta etapa (o recolhimento fica adiado para quem
 * encerrar a fase do diferimento).
 *
 * NÃO é um enquadramento oficial novo: deriva tudo do `cl` original (mesmo
 * NCM, descrição, vínculo e vigência) e só troca o necessário para simular.
 * `ehDiferimento(virtual) === true` (via CST 515) e `ehAnexoIX === true`
 * (via cClassTrib 515001), então os avisos violetas passam a valer.
 *
 * A UI oferece esta hipótese como SEGUNDA opção de tributação ao lado da
 * tributação normal — a escolha é do usuário, por operação.
 */
export function classificacaoDiferimentoAnexoIX(cl: Classificacao): Classificacao {
  return {
    ...cl,
    id: `${cl.id}__diferimento`,
    cst: '515',
    cClassTrib: '515001',
    baseLegal: 'Art. 138, §2º da LC 214/2025 — diferimento na operação (CST 515 · cClassTrib 515001)',
    resumo: {
      ...cl.resumo,
      descricaoCClassTrib:
        'Operações, sujeitas a diferimento, com insumos agropecuários e aquícolas, observado o art. 138 da LC 214/2025 — diferimento na operação (alíquota 0% IBS/CBS)',
      percentualReducaoIBS: 100,
      percentualReducaoCBS: 100,
    },
    referencia: cl.referencia ? { ...cl.referencia, diferimento: true } : cl.referencia,
    cstDetalhes: cl.cstDetalhes ? { ...cl.cstDetalhes, indDiferimento: true } : cl.cstDetalhes,
  }
}

/**
 * Tem SEGUNDA opção de tributação (diferimento)? Verdadeiro apenas para o
 * Anexo IX condicional — tributação normal com redução + hipótese de
 * diferimento a verificar por operação. Diferimento efetivo (CST 510/515)
 * já é diferido e não ganha opção extra; demais casos também não.
 */
export function temOpcaoDiferimento(cl: Classificacao | null | undefined): boolean {
  return ehDiferimentoCondicionalAnexoIX(cl)
}

/** Chave da opção de tributação exibida no seletor (normal × diferimento). */
export type OpcaoTributacaoChave = 'normal' | 'diferimento'

/**
 * Opções de tributação de uma classificação: sempre a tributação normal
 * (enquadramento oficial) + a hipótese de diferimento (alíquota 0%) quando
 * o Anexo IX condicional permitir. A normal é a primeira (padrão vigente).
 */
export function opcoesTributacao(cl: Classificacao): { chave: OpcaoTributacaoChave; classificacao: Classificacao }[] {
  if (!temOpcaoDiferimento(cl)) return [{ chave: 'normal', classificacao: cl }]
  return [
    { chave: 'normal', classificacao: cl },
    { chave: 'diferimento', classificacao: classificacaoDiferimentoAnexoIX(cl) },
  ]
}

/**
 * Expande uma lista de classificações com as hipóteses de diferimento:
 * cada item do Anexo IX condicional ganha, logo após si, a sua versão
 * virtual diferida (CST 515, redução 100%). Listas sem Anexo IX condicional
 * voltam intactas (mesma referência, sem cópia).
 */
export function expandirOpcoesComDiferimento(lista: Classificacao[]): Classificacao[] {
  if (!lista.some((cl) => temOpcaoDiferimento(cl))) return lista
  return lista.flatMap((cl) => (temOpcaoDiferimento(cl) ? [cl, classificacaoDiferimentoAnexoIX(cl)] : [cl]))
}
