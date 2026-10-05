/**
 * Aurum AI — artefatos visuais do chat (gráficos + tabelas customizadas).
 *
 * Fluxo agêntico (planejamento → construção → sugestão):
 * - `detectarPedidoGrafico` (agente 1 — intenção visual): entende SE o usuário
 *   quer visual e QUAL modelo (pizza/barra/linha/tabela), sem mudar a intenção
 *   fiscal base (dados/simples/calculo). É um MODIFICADOR, não uma intenção.
 * - `planejar*` (agente 2 — mapeamento): dado o domínio + agregações do motor,
 *   escolhe o gráfico principal + alternativas coerentes + insight de 1 linha.
 *   Todo número vem do motor (P1 Determinismo); aqui só se mapeia rótulo→valor.
 * - `sugestaoGrafico` (agente 3 — upsell): frase + botões padrão para a IA
 *   sugerir rotineiramente o visual sem poluir a resposta.
 *
 * Tudo é puro e testável (sem I/O, sem Chart.js): o componente
 * `src/ui/grafico-chat.tsx` renderiza; este módulo só planeja dados.
 */

export type TipoGraficoChat = 'barra' | 'pizza' | 'linha' | 'tabela'

export interface SerieGraficoChat {
  nome: string
  valores: number[]
}

export interface GraficoChat {
  /** Título exibido no cartão (ex.: "Top fornecedores por crédito"). */
  titulo: string
  subtitulo?: string
  tipo: TipoGraficoChat
  labels: string[]
  series: SerieGraficoChat[]
  unidade: 'moeda' | 'numero' | 'percent'
  /** 1 linha de leitura pronta ("Top1 concentra 42% do crédito"). */
  insight?: string
  /** Tabela customizada (quando tipo === 'tabela' ou como alternativa). */
  colunas?: string[]
  linhasTabela?: string[][]
  /** Outros modelos coerentes que o usuário pode alternar sem nova pergunta. */
  alternativas?: TipoGraficoChat[]
  /** Origem para auditoria (ex.: 'dados:fornecedores', 'simples:reparticao'). */
  origem: string
}

/* ------------------------------------------------- agente 1: pedido -- */

const RX_NAVEGAR_TELA = /me leva|ir para|abre a|abra a|abrir a|mostra a tela|quero ver (o|a) /i

export interface PedidoGrafico {
  quer: boolean
  tipo: TipoGraficoChat | null
}

function normBaixo(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/**
 * Detecta pedido visual. Puro e testável.
 * "mostra em gráfico pizza" → { quer: true, tipo: 'pizza' }
 * "me leva para tabelas" → { quer: false } (é navegar, não visual do chat).
 */
export function detectarPedidoGrafico(texto: string): PedidoGrafico {
  const cru = String(texto ?? '')
  if (!cru.trim()) return { quer: false, tipo: null }
  if (RX_NAVEGAR_TELA.test(cru)) return { quer: false, tipo: null }
  const n = normBaixo(cru)
  const temGrafico =
    /grafico|chart|pizza|rosca|doughnut|fatia|barras?|colunas?|histograma|linha|evolucao|tendencia|visual|mostra em|em forma de|compar.*visual|desenha|tabela|planilha|quadro/i.test(cru) &&
    !/tabela do brasileirao|tabela periodica/i.test(n)
  if (!temGrafico) return { quer: false, tipo: null }
  // "tabela" isolada sem verbo visual ainda conta (ex.: "tabela dos produtos"),
  // exceto quando é claramente a view de tabelas auxiliares.
  if (/tabelas? auxiliares|cst.*cclasstrib.*tabela/i.test(n) && !/grafico|pizza|barra|linha|visual/i.test(n)) {
    return { quer: false, tipo: null }
  }
  let tipo: TipoGraficoChat | null = null
  if (/pizza|rosca|doughnut|fatia|setor/i.test(cru)) tipo = 'pizza'
  else if (/linha|evolucao|tendencia|ao longo|mensal|temporal/i.test(cru)) tipo = 'linha'
  else if (/tabela|planilha|quadro|colunas/i.test(cru)) tipo = 'tabela'
  else if (/barra|histograma|ranking/i.test(cru)) tipo = 'barra'
  return { quer: true, tipo }
}

/**
 * `true` quando o texto é SÓ pedido visual ("mostra em tabela", "e em
 * pizza?", "gráfico, por favor") — sem conteúdo fiscal próprio. Puro e
 * testável. O orquestrador usa para herdar o domínio da conversa em vez de
 * classificar o andaime no RAG ("mostra em tabela" sozinho NÃO é produto).
 */
const STOP_VISUAL = new Set([
  'mostra', 'mostre', 'mostrar', 'exibe', 'exibir', 'gera', 'gerar', 'gere',
  'cria', 'criar', 'crie', 'faz', 'fazer', 'faca', 'monte', 'monta', 'montar',
  'em', 'de', 'da', 'do', 'das', 'dos', 'no', 'na', 'forma', 'por', 'favor',
  'pra', 'para', 'mim', 'isso', 'disso', 'desse', 'dessa', 'esse', 'essa',
  'este', 'esta', 'isto', 'um', 'uma', 'o', 'a', 'os', 'as', 'me', 'com',
  'como', 'e', 'agora', 'aqui', 'ai',
])

const VOCAB_VISUAL = /^(grafico|graficos|chart|pizza|barra|barras|linha|linhas|tabela|tabelas|planilha|planilhas|quadro|visual|rosca|doughnut|coluna|fatia|evolucao)$/

export function ehPedidoVisualPuro(texto: string): boolean {
  if (!detectarPedidoGrafico(texto).quer) return false
  const n = normBaixo(String(texto ?? ''))
  const toks = n
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((t) => !STOP_VISUAL.has(t) && !VOCAB_VISUAL.test(t))
  return toks.length === 0
}

/* ------------------------------------------------- helpers de mapa -- */

const MAX_LABEL = 26

export function rotuloCurto(s: string, max = MAX_LABEL): string {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim() || '—'
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

function soma(v: number[]): number {
  return v.reduce((a, b) => a + (Number(b) || 0), 0)
}

function pctParteTodo(parte: number, todo: number): string {
  if (!(todo > 0)) return '—'
  return `${((parte / todo) * 100).toFixed(1).replace('.', ',')}%`
}

function comTipo(
  base: Omit<GraficoChat, 'tipo' | 'alternativas'>,
  tipo: TipoGraficoChat,
  alternativas: TipoGraficoChat[],
): GraficoChat {
  return { ...base, tipo, alternativas: alternativas.filter((a) => a !== tipo) }
}

/**
 * Totais de um gráfico (todas as séries). Puro.
 * Usado para decidir se o visual tem sinal: pizza/barra/linha com soma
 * zerada renderiza um canvas vazio (parece "quebrado" — ver print Top
 * produtos com eixo R$ 0–1). Sem sinal, o planejador força tabela.
 */
export function somaGrafico(g: Pick<GraficoChat, 'series'>): number {
  let total = 0
  for (const s of g.series ?? []) {
    for (const v of s.valores ?? []) total += Number(v) || 0
  }
  return Math.round(total * 100) / 100
}

/** `true` quando há pelo menos um valor relevante para desenhar. */
export function graficoTemSinal(g: Pick<GraficoChat, 'series'>): boolean {
  let max = 0
  for (const s of g.series ?? []) {
    for (const v of s.valores ?? []) {
      const n = Math.abs(Number(v) || 0)
      if (n > max) max = n
    }
  }
  return max > 0.005
}

const AVISO_SEM_SINAL =
  'IBS+CBS zerado neste recorte (isenção/redução 100% ou sem destaque) — exibindo tabela com base e NCM.'

/**
 * Garante um tipo viável: sem sinal numérico, barra/pizza/linha viram
 * tabela (o canvas ficaria vazio). Mantém as alternativas para o usuário
 * conferir o visual vazio se quiser — o componente sempre oferece
 * pizza/barras/tabela.
 */
function comTipoViavel(
  base: Omit<GraficoChat, 'tipo' | 'alternativas'>,
  preferido: TipoGraficoChat,
  alternativas: TipoGraficoChat[],
): GraficoChat {
  const soma = somaGrafico({ series: base.series })
  if (!(soma > 0.005)) {
    const insight = base.insight ? `${base.insight} ${AVISO_SEM_SINAL}` : AVISO_SEM_SINAL
    const alts: TipoGraficoChat[] = [...new Set([preferido, ...alternativas, 'barra', 'pizza', 'tabela'])].filter(
      (a): a is TipoGraficoChat => a === 'barra' || a === 'pizza' || a === 'linha' || a === 'tabela',
    )
    return comTipo({ ...base, insight }, 'tabela', alts.filter((a) => a !== 'tabela'))
  }
  return comTipo(base, preferido, alternativas)
}

/** Aplica a preferência explícita ("em pizza") sobre o plano padrão. */
export function aplicarTipoPreferido(g: GraficoChat, preferido: TipoGraficoChat | null): GraficoChat {
  if (!preferido || preferido === g.tipo) return g
  // Sem sinal numérico, barra/pizza/linha renderizam canvas vazio — mantém
  // a tabela forçada pelo planejador (o usuário ainda alterna no cartão).
  if (preferido !== 'tabela' && !graficoTemSinal(g)) return g
  // Linha com 1 ponto não faz sentido — mantém barra/pizza/tabela.
  if (preferido === 'linha' && g.labels.length < 2) return g
  // Pizza com múltiplas séries usa a 1ª (documentado no insight).
  const insight =
    g.series.length > 1 && preferido === 'pizza'
      ? `${g.insight ?? ''} (pizza da 1ª série: ${g.series[0]?.nome ?? ''}).`.trim()
      : g.insight
  return comTipo({ ...g, insight }, preferido, [g.tipo, ...(g.alternativas ?? [])])
}

/* --------------------------------------- agente 2: builders puros -- */

export interface EntradaReparticao {
  IRPJ: number
  CSLL: number
  CBS: number
  IBS: number
  CPP: number
  ICMS: number
  IPI: number
  ISS: number
}

/** Pizza da repartição do DAS (8 fatias, ordem fixa do motor). */
export function graficoReparticaoDAS(reparticao: EntradaReparticao, anexoId: string): GraficoChat {
  const ordem: Array<keyof EntradaReparticao> = ['IRPJ', 'CSLL', 'CBS', 'IBS', 'CPP', 'ICMS', 'IPI', 'ISS']
  const labels = ordem
  const valores = ordem.map((k) => Math.round((Number(reparticao[k]) || 0) * 100) / 100)
  const total = soma(valores)
  const top = ordem.reduce((a, b) => ((reparticao[b] || 0) > (reparticao[a] || 0) ? b : a), ordem[0])
  const base: Omit<GraficoChat, 'tipo' | 'alternativas'> = {
    titulo: `Repartição do DAS — Anexo ${anexoId}`,
    subtitulo: `Total ${formatarCurto(total)} · 8 tributos`,
    labels,
    series: [{ nome: 'DAS', valores }],
    unidade: 'moeda',
    insight: total > 0 ? `${top} é a maior fatia (${pctParteTodo(Number(reparticao[top]) || 0, total)} do DAS).` : undefined,
    colunas: ['Tributo', 'Valor (R$)', 'Fatia'],
    linhasTabela: ordem.map((k) => [k, (Number(reparticao[k]) || 0).toFixed(2), total > 0 ? pctParteTodo(Number(reparticao[k]) || 0, total) : '—']),
    origem: 'simples:reparticao',
  }
  return comTipoViavel(base, 'pizza', ['barra', 'tabela'])
}

/** Barra DAS por anexo (matriz I–V com mesmos RBT12/receita). */
export function graficoComparativoAnexos(
  linhas: Array<{ id: string; das: number }>,
  rbt12: number,
  receita: number,
): GraficoChat {
  const ordenadas = [...linhas].sort((a, b) => a.id.localeCompare(b.id))
  const labels = ordenadas.map((l) => `Anexo ${l.id}`)
  const valores = ordenadas.map((l) => Math.round((Number(l.das) || 0) * 100) / 100)
  const vencedor = ordenadas.reduce((a, b) => ((b.das ?? Infinity) < (a.das ?? Infinity) ? b : a), ordenadas[0])
  const base: Omit<GraficoChat, 'tipo' | 'alternativas'> = {
    titulo: 'Comparativo DAS por anexo (I–V)',
    subtitulo: `Mesmos RBT12 e receita do seu caso`,
    labels,
    series: [{ nome: 'DAS mensal', valores }],
    unidade: 'moeda',
    insight: vencedor ? `Menor carga: Anexo ${vencedor.id}.` : undefined,
    colunas: ['Anexo', 'DAS (R$)', 'RBT12 (R$)', 'Receita (R$)'],
    linhasTabela: ordenadas.map((l) => [`Anexo ${l.id}`, Number(l.das || 0).toFixed(2), rbt12.toFixed(2), receita.toFixed(2)]),
    origem: 'simples:comparativo-anexos',
  }
  return comTipoViavel(base, 'barra', ['tabela', 'pizza'])
}

/** Barra Convencional × Híbrido em TODOS os anexos (exploratório sem empresa).
 * 2 séries (Convencional, Híbrido) × 5 anexos. Puro: só mapeia números do motor. */
export function graficoConvHibTodosAnexos(
  linhas: Array<{ id: string; conv: number; hib: number }>,
): GraficoChat {
  const ordenadas = [...linhas].sort((a, b) => a.id.localeCompare(b.id))
  const labels = ordenadas.map((l) => `Anexo ${l.id}`)
  const conv = ordenadas.map((l) => Math.round((Number(l.conv) || 0) * 100) / 100)
  const hib = ordenadas.map((l) => Math.round((Number(l.hib) || 0) * 100) / 100)
  const menorConv = ordenadas.reduce((a, b) => (b.conv < a.conv ? b : a), ordenadas[0])
  const base: Omit<GraficoChat, 'tipo' | 'alternativas'> = {
    titulo: 'Convencional × Híbrido por anexo (I–V)',
    subtitulo: 'Mesmos RBT12, receita e créditos do seu caso',
    labels,
    series: [
      { nome: 'Convencional (DAS)', valores: conv },
      { nome: 'Híbrido (total)', valores: hib },
    ],
    unidade: 'moeda',
    insight: menorConv ? `Menor DAS convencional: Anexo ${menorConv.id}. Compare a 2ª barra (híbrido) de cada anexo.` : undefined,
    colunas: ['Anexo', 'Convencional (R$)', 'Híbrido (R$)'],
    linhasTabela: ordenadas.map((l) => [`Anexo ${l.id}`, Number(l.conv || 0).toFixed(2), Number(l.hib || 0).toFixed(2)]),
    origem: 'simples:conv-hib-todos',
  }
  return comTipoViavel(base, 'barra', ['tabela', 'pizza'])
}

/** Barra Convencional × Híbrido (DAS cheio vs DAS reduzido + CBS fora). */
export function graficoConvXHibrido(args: {
  anexo: string
  dasConv: number
  dasReduzido: number
  cbsFora: number
  totalHib: number
  economia: number
}): GraficoChat {
  const base: Omit<GraficoChat, 'tipo' | 'alternativas'> = {
    titulo: `Convencional × Híbrido — Anexo ${args.anexo}`,
    subtitulo: args.economia > 0.005 ? `Híbrido economiza ${formatarCurto(args.economia)}` : args.economia < -0.005 ? 'Convencional vence' : 'Empate técnico',
    labels: ['Convencional (DAS)', 'Híbrido (total)'],
    series: [{ nome: 'Carga mensal', valores: [round2(args.dasConv), round2(args.totalHib)] }],
    unidade: 'moeda',
    insight:
      args.economia > 0.005
        ? `Híbrido vence por ${formatarCurto(args.economia)} (DAS reduzido ${formatarCurto(args.dasReduzido)} + CBS fora ${formatarCurto(args.cbsFora)}).`
        : args.economia < -0.005
          ? `Convencional vence por ${formatarCurto(Math.abs(args.economia))}.`
          : 'Empate técnico entre os regimes.',
    colunas: ['Regime', 'DAS/Carga (R$)', 'Detalhe'],
    linhasTabela: [
      ['Convencional (DAS)', args.dasConv.toFixed(2), 'DAS com CBS dentro'],
      ['Híbrido — DAS reduzido', args.dasReduzido.toFixed(2), 'DAS sem CBS'],
      ['Híbrido — CBS fora', args.cbsFora.toFixed(2), 'débitos − créditos'],
      ['Híbrido — total', args.totalHib.toFixed(2), args.economia > 0 ? `economia ${args.economia.toFixed(2)}` : '—'],
    ],
    origem: 'simples:convxhibrido',
  }
  return comTipoViavel(base, 'barra', ['tabela', 'pizza'])
}

/** Barra IBS × CBS de um cálculo unitário. */
export function graficoCalculoIBS(codigo: string, vIBS: number, vCBS: number, base: number): GraficoChat {
  const total = round2(vIBS + vCBS)
  const g: Omit<GraficoChat, 'tipo' | 'alternativas'> = {
    titulo: `IBS × CBS — base ${formatarCurto(base)}`,
    subtitulo: `NCM ${codigo} · total ${formatarCurto(total)}`,
    labels: ['IBS', 'CBS'],
    series: [{ nome: 'Tributo', valores: [round2(vIBS), round2(vCBS)] }],
    unidade: 'moeda',
    insight: total > 0 ? `CBS representa ${pctParteTodo(vCBS, total)} do tributo.` : undefined,
    colunas: ['Tributo', 'Valor (R$)', 'Fatia'],
    linhasTabela: [
      ['IBS', Number(vIBS || 0).toFixed(2), total > 0 ? pctParteTodo(vIBS, total) : '—'],
      ['CBS', Number(vCBS || 0).toFixed(2), total > 0 ? pctParteTodo(vCBS, total) : '—'],
      ['Total', total.toFixed(2), '—'],
    ],
    origem: 'calculo:ibscbs',
  }
  return comTipoViavel(g, 'barra', ['pizza', 'tabela'])
}

/** Barra top fornecedores por crédito. */
export function graficoFornecedores(
  linhas: Array<{ nome: string; creditoTotal: number; simples?: boolean }>,
  limite = 6,
): GraficoChat | null {
  const top = [...linhas].sort((a, b) => (b.creditoTotal || 0) - (a.creditoTotal || 0)).slice(0, Math.max(1, limite))
  if (!top.length) return null
  const total = soma(top.map((l) => l.creditoTotal || 0))
  const g: Omit<GraficoChat, 'tipo' | 'alternativas'> = {
    titulo: 'Top fornecedores por crédito (IBS+CBS)',
    subtitulo: `${top.length} fornecedor(es) · entradas`,
    labels: top.map((l) => rotuloCurto(l.simples ? `${l.nome} (Simples)` : l.nome)),
    series: [{ nome: 'Crédito', valores: top.map((l) => round2(l.creditoTotal || 0)) }],
    unidade: 'moeda',
    insight: total > 0 ? `${rotuloCurto(top[0]?.nome ?? '')} concentra ${pctParteTodo(top[0]?.creditoTotal || 0, total)} do Top ${top.length}.` : undefined,
    colunas: ['Fornecedor', 'Crédito (R$)', 'Simples?'],
    linhasTabela: top.map((l) => [rotuloCurto(l.nome, 40), Number(l.creditoTotal || 0).toFixed(2), l.simples ? 'Sim (sem crédito)' : 'Não']),
    origem: 'dados:fornecedores',
  }
  return comTipoViavel(g, 'barra', ['pizza', 'tabela'])
}

/** Barra top produtos por tributo (débito = vendas, crédito = compras). */
export function graficoProdutos(
  linhas: Array<{ nome: string; ncm?: string; trib: number; direcao?: string }>,
  rotuloDirecao: 'débito (vendas)' | 'crédito (compras)' | 'tributo',
  limite = 6,
): GraficoChat | null {
  const top = [...linhas].sort((a, b) => (b.trib || 0) - (a.trib || 0)).slice(0, Math.max(1, limite))
  if (!top.length) return null
  const total = soma(top.map((l) => l.trib || 0))
  const g: Omit<GraficoChat, 'tipo' | 'alternativas'> = {
    titulo: `Top produtos — ${rotuloDirecao}`,
    subtitulo: `${top.length} produto(s) por IBS+CBS`,
    labels: top.map((l) => rotuloCurto(l.nome)),
    series: [{ nome: 'IBS+CBS', valores: top.map((l) => round2(l.trib || 0)) }],
    unidade: 'moeda',
    insight: total > 0 ? `"${rotuloCurto(top[0]?.nome ?? '', 32)}" lidera com ${pctParteTodo(top[0]?.trib || 0, total)} do Top ${top.length}.` : undefined,
    colunas: ['Produto', 'NCM', 'IBS+CBS (R$)'],
    linhasTabela: top.map((l) => [rotuloCurto(l.nome, 44), String(l.ncm || '—'), Number(l.trib || 0).toFixed(2)]),
    origem: `dados:produtos-${rotuloDirecao.includes('débito') ? 'debito' : rotuloDirecao.includes('crédito') ? 'credito' : 'geral'}`,
  }
  return comTipoViavel(g, 'barra', ['pizza', 'tabela'])
}

/** Pizza das reduções por base. */
export function graficoReducoes(linhas: Array<{ rotulo: string; base: number }>): GraficoChat | null {
  const top = [...linhas].sort((a, b) => (b.base || 0) - (a.base || 0)).slice(0, 6)
  if (!top.length) return null
  const total = soma(top.map((l) => l.base || 0))
  const g: Omit<GraficoChat, 'tipo' | 'alternativas'> = {
    titulo: 'Base por faixa de redução',
    subtitulo: `${top.length} faixa(s) nas notas`,
    labels: top.map((l) => rotuloCurto(l.rotulo, 30)),
    series: [{ nome: 'Base', valores: top.map((l) => round2(l.base || 0)) }],
    unidade: 'moeda',
    insight: total > 0 ? `Maior base: "${rotuloCurto(top[0]?.rotulo ?? '', 32)}" (${pctParteTodo(top[0]?.base || 0, total)}).` : undefined,
    colunas: ['Redução', 'Base (R$)'],
    linhasTabela: top.map((l) => [rotuloCurto(l.rotulo, 48), Number(l.base || 0).toFixed(2)]),
    origem: 'dados:reducoes',
  }
  return comTipoViavel(g, 'pizza', ['barra', 'tabela'])
}

/** Barra base diferida por NCM/produto. */
export function graficoDiferidos(linhas: Array<{ nome: string; ncm?: string; base: number }>): GraficoChat | null {
  const top = [...linhas].sort((a, b) => (b.base || 0) - (a.base || 0)).slice(0, 6)
  if (!top.length) return null
  const g: Omit<GraficoChat, 'tipo' | 'alternativas'> = {
    titulo: 'Base com diferimento',
    subtitulo: `${top.length} item(ns) diferidos`,
    labels: top.map((l) => rotuloCurto(l.ncm ? `${l.nome} (${l.ncm})` : l.nome)),
    series: [{ nome: 'Base diferida', valores: top.map((l) => round2(l.base || 0)) }],
    unidade: 'moeda',
    insight: undefined,
    colunas: ['Produto', 'NCM', 'Base (R$)'],
    linhasTabela: top.map((l) => [rotuloCurto(l.nome, 44), String(l.ncm || '—'), Number(l.base || 0).toFixed(2)]),
    origem: 'dados:diferidos',
  }
  return comTipoViavel(g, 'barra', ['tabela', 'pizza'])
}

/** Barra top NCM por base. */
export function graficoNcms(linhas: Array<{ ncm: string; exemplo?: string; base: number }>): GraficoChat | null {
  const top = [...linhas].sort((a, b) => (b.base || 0) - (a.base || 0)).slice(0, 8)
  if (!top.length) return null
  const g: Omit<GraficoChat, 'tipo' | 'alternativas'> = {
    titulo: 'Top NCM por base',
    subtitulo: `${top.length} NCM(s) no recorte`,
    labels: top.map((l) => rotuloCurto(String(l.ncm || '—'), 12)),
    series: [{ nome: 'Base', valores: top.map((l) => round2(l.base || 0)) }],
    unidade: 'moeda',
    insight: undefined,
    colunas: ['NCM', 'Exemplo', 'Base (R$)'],
    linhasTabela: top.map((l) => [String(l.ncm || '—'), rotuloCurto(l.exemplo || '', 40), Number(l.base || 0).toFixed(2)]),
    origem: 'dados:ncm',
  }
  return comTipoViavel(g, 'barra', ['tabela', 'pizza'])
}

/** Barra crédito × débito × saldo (apuração do escopo). */
export function graficoApuracao(resumo: { credito: number; debito: number; saldo: number; resultado: string }): GraficoChat {
  const g: Omit<GraficoChat, 'tipo' | 'alternativas'> = {
    titulo: 'Apuração do recorte — crédito × débito',
    subtitulo: `Saldo ${formatarCurto(resumo.saldo)} (${resumo.resultado})`,
    labels: ['Crédito (entradas)', 'Débito (saídas)'],
    series: [{ nome: 'IBS+CBS', valores: [round2(resumo.credito), round2(resumo.debito)] }],
    unidade: 'moeda',
    insight:
      resumo.debito > 0
        ? `Créditos cobrem ${pctParteTodo(resumo.credito, resumo.debito)} dos débitos.`
        : 'Sem débitos no recorte — só crédito.',
    colunas: ['Lado', 'Valor (R$)'],
    linhasTabela: [
      ['Crédito (entradas)', Number(resumo.credito || 0).toFixed(2)],
      ['Débito (saídas)', Number(resumo.debito || 0).toFixed(2)],
      [`Saldo (${resumo.resultado})`, Number(resumo.saldo || 0).toFixed(2)],
    ],
    origem: 'dados:apuracao',
  }
  return comTipoViavel(g, 'barra', ['pizza', 'tabela'])
}

/** Linha evolução mensal (entradas × saídas). */
export function graficoEvolucaoMensal(
  pontos: Array<{ rotulo: string; baseEntradas: number; baseSaidas: number }>,
): GraficoChat | null {
  const lista = [...pontos].slice(-12)
  if (lista.length < 2) return null
  const g: Omit<GraficoChat, 'tipo' | 'alternativas'> = {
    titulo: 'Evolução mensal — base por direção',
    subtitulo: `${lista.length} mese(s)`,
    labels: lista.map((p) => rotuloCurto(p.rotulo, 10)),
    series: [
      { nome: 'Entradas', valores: lista.map((p) => round2(p.baseEntradas || 0)) },
      { nome: 'Saídas', valores: lista.map((p) => round2(p.baseSaidas || 0)) },
    ],
    unidade: 'moeda',
    insight: `Último mês: entradas ${formatarCurto(lista[lista.length - 1]?.baseEntradas || 0)} × saídas ${formatarCurto(lista[lista.length - 1]?.baseSaidas || 0)}.`,
    colunas: ['Mês', 'Entradas (R$)', 'Saídas (R$)'],
    linhasTabela: lista.map((p) => [p.rotulo, Number(p.baseEntradas || 0).toFixed(2), Number(p.baseSaidas || 0).toFixed(2)]),
    origem: 'dados:evolucao-mensal',
  }
  return comTipoViavel(g, 'linha', ['barra', 'tabela'])
}

/** Barra regime antigo × novo (confronto IBS/CBS). */
export function graficoConfrontoRegimes(args: { antigo: number; novo: number; icms: number; pisCofins: number; ibs: number; cbs: number }): GraficoChat {
  const g: Omit<GraficoChat, 'tipo' | 'alternativas'> = {
    titulo: 'Regime antigo × Reforma',
    subtitulo: `ICMS+PIS/COFINS vs IBS+CBS`,
    labels: ['Antigo', 'Novo (IBS+CBS)'],
    series: [{ nome: 'Tributo', valores: [round2(args.antigo), round2(args.novo)] }],
    unidade: 'moeda',
    insight: args.antigo > 0 ? `Variação de ${(((args.novo - args.antigo) / args.antigo) * 100).toFixed(1).replace('.', ',')}% vs o regime antigo.` : undefined,
    colunas: ['Regime', 'Valor (R$)'],
    linhasTabela: [
      ['Antigo (ICMS+PIS/COFINS)', Number(args.antigo || 0).toFixed(2)],
      ['Novo — IBS', Number(args.ibs || 0).toFixed(2)],
      ['Novo — CBS', Number(args.cbs || 0).toFixed(2)],
      ['Novo — total', Number(args.novo || 0).toFixed(2)],
    ],
    origem: 'dados:confronto-regimes',
  }
  return comTipoViavel(g, 'barra', ['tabela', 'pizza'])
}

/** Barra clientes por base (cadastro + movimento). */
export function graficoClientes(
  linhas: Array<{ razaoSocial: string; fantasia?: string; base: number; qtdNotas: number }>,
  limite = 8,
): GraficoChat | null {
  const top = [...linhas].sort((a, b) => (b.base || 0) - (a.base || 0)).slice(0, Math.max(1, limite))
  if (!top.length) return null
  const g: Omit<GraficoChat, 'tipo' | 'alternativas'> = {
    titulo: 'Clientes por movimento (base)',
    subtitulo: `${top.length} cliente(s)`,
    labels: top.map((l) => rotuloCurto(l.fantasia && l.fantasia !== l.razaoSocial ? `${l.razaoSocial} (${l.fantasia})` : l.razaoSocial)),
    series: [{ nome: 'Base', valores: top.map((l) => round2(l.base || 0)) }],
    unidade: 'moeda',
    insight: undefined,
    colunas: ['Cliente', 'Notas', 'Base (R$)'],
    linhasTabela: top.map((l) => [rotuloCurto(l.razaoSocial, 44), String(l.qtdNotas), Number(l.base || 0).toFixed(2)]),
    origem: 'clientes:movimento',
  }
  return comTipoViavel(g, 'barra', ['pizza', 'tabela'])
}

/* ------------------------------- agente 2: roteador por pergunta -- */

export interface AgregacoesDadosParaGrafico {
  fornecedores: Array<{ nome: string; creditoTotal: number; simples?: boolean }>
  produtosCred: Array<{ nome: string; ncm?: string; trib: number }>
  produtosDeb: Array<{ nome: string; ncm?: string; trib: number }>
  reducoes: Array<{ rotulo: string; base: number }>
  diferidosEfetivos: Array<{ nome: string; ncm?: string; base: number }>
  diferidosCondicionais: Array<{ nome: string; ncm?: string; base: number }>
  ncms: Array<{ ncm: string; exemplo?: string; base: number }>
  resumo: { credito: number; debito: number; saldo: number; resultado: string }
  evolucao?: Array<{ rotulo: string; baseEntradas: number; baseSaidas: number }>
  confronto?: { antigo: number; novo: number; icms: number; pisCofins: number; ibs: number; cbs: number }
}

/**
 * Roteador agêntico dados → gráfico. Escolhe o recorte que a pergunta mira
 * (fornecedor/produto/diferido/redução/NCM/evolução/confronto/panorama) e
 * devolve o visual principal + alternativas. Nunca inventa número: sem dado,
 * retorna null (o texto orienta a importar XML).
 */
export function planejarGraficoDados(pergunta: string, agg: AgregacoesDadosParaGrafico, preferido?: TipoGraficoChat | null): GraficoChat | null {
  const n = normBaixo(String(pergunta ?? ''))
  const comPreferencia = (g: GraficoChat | null): GraficoChat | null => {
    if (!g) return null
    return aplicarTipoPreferido(g, preferido ?? null)
  }
  if (/evolucao|evolução|mensal|ao longo|por mes|tendencia|serie temporal/.test(n)) {
    if (agg.evolucao?.length) return comPreferencia(graficoEvolucaoMensal(agg.evolucao))
  }
  if (/confronto|antigo.*novo|novo.*antigo|regime antigo|reforma.*compar/.test(n)) {
    if (agg.confronto) return comPreferencia(graficoConfrontoRegimes(agg.confronto))
  }
  if (/fornecedor|credito|quem.*(da|gera)|comprou de/.test(n)) {
    return comPreferencia(graficoFornecedores(agg.fornecedores))
  }
  if (/diferid/.test(n)) {
    return comPreferencia(graficoDiferidos([...agg.diferidosEfetivos, ...agg.diferidosCondicionais]))
  }
  if (/reducao|reduc|isento|beneficio|anexo/.test(n)) {
    return comPreferencia(graficoReducoes(agg.reducoes))
  }
  if (/\bncm\b|cst|cclasstrib|cct|cfop/.test(n)) {
    return comPreferencia(graficoNcms(agg.ncms))
  }
  // Apuração explícita ("quanto comprei e vendi?", "saldo", "panorama")
  // vence o recorte por produto: a pergunta mira os TOTAIS, não o ranking.
  if (/apuracao|saldo|credito.*debito|debito.*credito|entradas.*saidas|panorama|resumo|quanto.*(comprei|vendi)/.test(n)) {
    return comPreferencia(graficoApuracao(agg.resumo))
  }
  if (/produto|debito|vendi|vendeu|comprei|comprou|mais vendido|top.*venda/.test(n) && !/fornecedor/.test(n)) {
    const compra = /compra|comprei|comprou|entrada|credito/.test(n)
    const venda = /venda|vendi|vendeu|saida|debito/.test(n)
    if (compra && !venda) {
      return comPreferencia(graficoProdutos(agg.produtosCred, 'crédito (compras)'))
    }
    if (venda && !compra) {
      return comPreferencia(graficoProdutos(agg.produtosDeb, 'débito (vendas)'))
    }
    const todos = [...agg.produtosCred.map((p) => ({ ...p, direcao: 'entrada' as const })), ...agg.produtosDeb.map((p) => ({ ...p, direcao: 'saida' as const }))]
      .sort((a, b) => (b.trib || 0) - (a.trib || 0))
      .slice(0, 8)
    if (todos.length) {
      const g: GraficoChat = comTipoViavel(
        {
          titulo: 'Top produtos — IBS+CBS (compras × vendas)',
          subtitulo: `${todos.length} produto(s)`,
          labels: todos.map((p) => rotuloCurto(`${p.nome} (${p.direcao === 'entrada' ? 'compra' : 'venda'})`)),
          series: [{ nome: 'IBS+CBS', valores: todos.map((p) => round2(p.trib || 0)) }],
          unidade: 'moeda',
          insight: undefined,
          colunas: ['Produto', 'Direção', 'IBS+CBS (R$)'],
          linhasTabela: todos.map((p) => [rotuloCurto(p.nome, 44), p.direcao === 'entrada' ? 'compra' : 'venda', Number(p.trib || 0).toFixed(2)]),
          origem: 'dados:produtos-geral',
        },
        'barra',
        ['pizza', 'tabela'],
      )
      return comPreferencia(g)
    }
  }
  // Panorama padrão: o recorte com mais sinal (fornecedor > produto > apuração).
  return (
    comPreferencia(graficoFornecedores(agg.fornecedores)) ??
    comPreferencia(graficoApuracao(agg.resumo))
  )
}

/* ------------------------------- agente 3: sugestão rotineira -- */

export interface SugestaoGrafico {
  frase: string
  sugestoes: string[]
  botoes: Array<{ rotulo: string; acao: 'perguntar'; alvo: string }>
}

/**
 * Upsell padrão: a IA sugere rotineiramente o visual sem poluir. O `alvo`
 * carrega o contexto (recorte/valores) para o turno seguinte reconstruir
 * o mesmo escopo e anexar o gráfico.
 */
export function sugestaoGrafico(alvo: string, alvoTabela?: string): SugestaoGrafico {
  const base = String(alvo ?? '').trim()
  const derivado = (base.replace(/gráfico( de barras| em pizza| de pizza| em linha)?/i, 'tabela').trim() || `${base} em tabela`)
  const alvoTab = (alvoTabela ?? derivado)
  return {
    frase: `📊 **Quer ver em gráfico?** Gero pizza, barras, linha ou tabela com esses números — diga por exemplo "mostra em gráfico pizza".`,
    sugestoes: ['Mostra em gráfico pizza', 'Mostra em tabela'],
    botoes: [
      { rotulo: '📊 Ver gráfico', acao: 'perguntar', alvo },
      { rotulo: '📋 Ver tabela', acao: 'perguntar', alvo: alvoTab },
    ],
  }
}

export function alvoGraficoDados(recorte: string): string {
  const r = String(recorte ?? '').trim() || 'todo o movimento'
  return `Mostra em gráfico de barras: ${r}`
}

export function alvoGraficoSimples(anexoId: string, rbt12: number, receita: number, folha?: number | null): string {
  const f = folha != null ? `, folha ${folha}` : ''
  return `Mostra em gráfico pizza a repartição do DAS: Anexo ${anexoId}, RBT12 ${rbt12}, receita ${receita}${f}`
}

export function alvoGraficoSimplesTodos(rbt12: number, receita: number, folha?: number | null): string {
  const f = folha != null ? `, folha ${folha}` : ''
  return `Mostra em gráfico o comparativo dos anexos I–V: RBT12 ${rbt12}, receita ${receita}${f}`
}

export function alvoGraficoHibridoTodos(rbt12: number, receita: number): string {
  return `Mostra em gráfico Convencional × Híbrido por anexo: RBT12 ${rbt12}, receita ${receita}`
}

export function alvoGraficoCalculo(codigo: string, base: number): string {
  return `Mostra em gráfico IBS/CBS do NCM ${codigo} sobre ${base}`
}

/* ------------------------------------------------------- formato -- */

function round2(v: number): number {
  return Math.round((Number(v) || 0) * 100) / 100
}

function formatarCurto(v: number): string {
  const n = Number(v) || 0
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })
}
