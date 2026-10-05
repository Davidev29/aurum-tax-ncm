/**
 * Motor determinístico de ações de DADOS (XML ↔ cliente).
 *
 * Problema que resolve: "quais top produtos desse cliente?" caía em NCM
 * (semLastro) porque o detector só conhecia "quais produtos" exato — o
 * "top" no meio quebrava o substring. O mesmo valia para "lista os produtos
 * vendidos", "mais vendidos/comprados", "geraram mais crédito/débito", etc.
 *
 * Este motor enumera TODAS as ações possíveis sobre o movimento importado e
 * dá um score 0–1 determinístico por mensagem + histórico. O detector e o
 * `refinarIntencaoComContexto` usam o top-1 como roteamento; o `responderDados`
 * usa o ranking para decidir quais blocos mostrar. Puro e testável — nenhum
 * número vem daqui, só a DECISÃO de qual agregação exibir (P1 mantido).
 */

export type AcaoDados =
  | 'inventario'
  | 'ranking_fornecedores'
  | 'ranking_produtos_geral'
  | 'ranking_produtos_credito'
  | 'ranking_produtos_debito'
  | 'listar_produtos'
  | 'diferidos'
  | 'reducoes'
  | 'tributacao_ncm'
  | 'apuracao'
  | 'filtros'
  | 'panorama'

export interface ContextoAcoesDados {
  /** Já houve consulta de dados nesta conversa (panorama, ranking, etc). */
  houveDados: boolean
  /** Já houve classificação NCM/NBS (para não roubar refino "100% algodão"). */
  houveClassificacao?: boolean
}

export interface AvaliacaoAcaoDados {
  acao: AcaoDados
  /** Confiança absoluta 0–1 (soma de sinais + bônus de contexto, clamp). */
  score: number
  /** Probabilidade relativa (score / soma dos scores, 0–1). */
  probabilidade: number
  motivos: string[]
}

function normBaixo(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/** Anáfora ao escopo anterior ("desse cliente", "disso", "nesse recorte"...). */
export function temAnaforaDados(n: string): boolean {
  return /\bdesse\b|\bdesta\b|\bdeste\b|\bdessa\b|\bdisso\b|\bdele\b|\bdela\b|\bnisso\b|\bnesse\b|\bneste\b|\bnessa\b|\bnesta\b|\bdos dados\b|\bdesse cliente\b|\bdeste cliente\b|\bdessa empresa\b|\bdessa consulta\b|\bdesse levantamento\b/.test(n)
}

/**
 * Avalia todas as ações possíveis para a mensagem. Determinístico: mesmos
 * inputs → mesmo ranking. Ordem de desempate fixa (array abaixo).
 */
export function avaliarAcoesDados(
  pergunta: string,
  ctx: ContextoAcoesDados = { houveDados: false },
): AvaliacaoAcaoDados[] {
  const cru = String(pergunta ?? '')
  const n = normBaixo(cru)
  const tokens = n.split(/\s+/).filter(Boolean)
  const curto = tokens.length <= 6
  const anafora = temAnaforaDados(n)
  const houveDados = ctx.houveDados === true

  // Vocabulário atômico (normalizado, sem acento).
  const temProduto = /\bprodutos?\b/.test(n)
  const temTop = /\btop\b|\branking\b/.test(n)
  const temLista = /\blista\b|\blistar\b|\bliste\b|\blistagem\b|\bmostra\b|\bmostre\b/.test(n)
  const temVendido = /vendid[oa]s?|vendi|vendeu|vendas?\b|faturei|saidas?/.test(n)
  const temComprado = /comprad[oa]s?|comprei|comprou|compras?\b|entradas?/.test(n)
  const temCredito = /credito/.test(n)
  const temDebito = /debito/.test(n)
  const temFornecedor = /fornecedor/.test(n)
  const temClienteXml = /xml|nota fiscal|\bnfe\b|\bnfce\b|notas?\b/.test(n)
  const temDiferido = /diferid|diferimento/.test(n)
  const temReducao = /reducao|reducoes|isento|isencao|imune|beneficio|aliquota cheia|sem reducao/.test(n)
  const temNcmDetalhe = /\bncm\b|\bcst\b|\bcclasstrib\b|\bcct\b|\bcfop\b|\btributacao por\b/.test(n)
  const temApuracao = /apurac|saldo|a pagar|debito.*credito|credito.*debito/.test(n)
  const temFiltroPergunta = /quais filtros|que filtros|como filtr|filtrar por|opcoes de filtro/.test(n)
  const temQuaisProdutos = /quais?\b.*\bprodutos?\b|\bque produtos?\b|\bqual produto\b/.test(n)
  const temMais = /\bmais\b/.test(n)
  const temGerou = /ger[oa].*credito|ger[oa].*debito|gerando|que mais/.test(n)

  // Acumuladores: [score, motivos[]]
  const acc = new Map<AcaoDados, { s: number; m: string[] }>()
  const add = (acao: AcaoDados, peso: number, motivo: string): void => {
    const e = acc.get(acao) ?? { s: 0, m: [] }
    e.s += peso
    e.m.push(motivo)
    acc.set(acao, e)
  }
  const todas: AcaoDados[] = [
    'inventario',
    'ranking_fornecedores',
    'ranking_produtos_geral',
    'ranking_produtos_credito',
    'ranking_produtos_debito',
    'listar_produtos',
    'diferidos',
    'reducoes',
    'tributacao_ncm',
    'apuracao',
    'filtros',
    'panorama',
  ]
  for (const a of todas) acc.set(a, { s: 0, m: [] })

  /* ---- inventário ("tem XML de algum cliente?") ---- */
  if (temClienteXml && /tem algum|algum cliente|alguma nota|quantas notas|quais clientes.*(tem|com)|tem xml/.test(n)) {
    add('inventario', 0.9, 'xml + quantificador de inventário')
  } else if (temClienteXml && /cliente|empresa/.test(n)) {
    add('inventario', 0.5, 'xml + cliente/empresa')
  } else if (temClienteXml) {
    add('inventario', 0.35, 'menção a xml/nota')
  }

  /* ---- ranking fornecedores ---- */
  if (temFornecedor && (temCredito || temTop || temMais || /quem.*(da|gera)|maior|melhor/.test(n))) {
    add('ranking_fornecedores', 0.9, 'fornecedor + crédito/top/mais')
  } else if (temFornecedor) {
    add('ranking_fornecedores', 0.55, 'menção a fornecedor')
  } else if (temCredito && temTop && !temProduto) {
    add('ranking_fornecedores', 0.4, 'top + crédito sem produto (provável fornecedor)')
  }

  /* ---- ranking produtos geral ("quais top produtos desse cliente?") ---- */
  // Caso-âncora do bug: "quais top produtos..." — o "top" quebrava o substring.
  if ((temQuaisProdutos || temProduto) && temTop) {
    add('ranking_produtos_geral', 0.95, 'produto + top/ranking')
  } else if (temTop && temProduto) {
    add('ranking_produtos_geral', 0.95, 'top + produto')
  }
  if (temQuaisProdutos && (temMais || temGerou || anafora)) {
    add('ranking_produtos_geral', 0.55, 'quais produtos + mais/gerou/anáfora')
  } else if (temQuaisProdutos) {
    add('ranking_produtos_geral', 0.5, 'quais produtos')
  } else if (temProduto && (temMais || temGerou)) {
    add('ranking_produtos_geral', 0.6, 'produto + mais/gerou')
  }
  // "top 5 desse cliente" sem a palavra produto, mas com histórico de dados.
  if (temTop && !temProduto && !temFornecedor && houveDados) {
    add('ranking_produtos_geral', 0.45, 'top isolado com histórico de dados')
  }
  if (temProduto && anafora) {
    add('ranking_produtos_geral', 0.25, 'produto + anáfora ao escopo')
  }

  /* ---- crédito (compras) vs débito (vendas) ---- */
  const sinalCompra = temComprado || (temCredito && temProduto) || /que mais comprei|mais comprei|top compra/.test(n)
  const sinalVenda = temVendido || (temDebito && temProduto) || /que mais vendi|mais vendi|top venda/.test(n)
  if (temProduto && sinalCompra && sinalVenda) {
    // "mais vendidos, comprados, geraram crédito e débito" → ambos.
    add('ranking_produtos_credito', 0.85, 'produto + compra e venda (crédito)')
    add('ranking_produtos_debito', 0.85, 'produto + compra e venda (débito)')
    add('ranking_produtos_geral', 0.5, 'produto + compra e venda (geral)')
  } else {
    if ((temProduto || temTop || temLista) && sinalCompra) {
      add('ranking_produtos_credito', 0.9, 'sinal de compra (comprado/entradas/crédito)')
    } else if (sinalCompra && houveDados && curto) {
      add('ranking_produtos_credito', 0.4, 'sinal de compra curto com histórico')
    }
    if ((temProduto || temTop || temLista) && sinalVenda) {
      add('ranking_produtos_debito', 0.9, 'sinal de venda (vendido/saídas/débito)')
    } else if (sinalVenda && houveDados && curto) {
      add('ranking_produtos_debito', 0.4, 'sinal de venda curto com histórico')
    }
  }
  // "geraram mais crédito/débito" sem a palavra produto, mas no contexto dados.
  if (temGerou && (temCredito || temDebito) && houveDados) {
    add('ranking_produtos_credito', 0.3, 'gerou + crédito com histórico')
    add('ranking_produtos_debito', 0.3, 'gerou + débito com histórico')
  }

  /* ---- listar produtos ("lista os produtos vendidos") ---- */
  if (temLista && temProduto) {
    add('listar_produtos', 0.9, 'lista + produto')
    if (sinalVenda) add('ranking_produtos_debito', 0.35, 'lista produtos + venda')
    if (sinalCompra) add('ranking_produtos_credito', 0.35, 'lista produtos + compra')
  } else if (temLista && (temVendido || temComprado) && houveDados) {
    add('listar_produtos', 0.55, 'lista + vendido/comprado com histórico')
  }
  // "produtos vendidos/comprados" sem verbo listar já é intenção de lista.
  if (temProduto && (temVendido || temComprado)) {
    add('listar_produtos', 0.5, 'produto + vendido/comprado')
  }

  /* ---- diferidos / reduções / NCM / apuração / filtros ---- */
  if (temDiferido) add('diferidos', 0.9, 'menção a diferido/diferimento')
  if (temReducao) add('reducoes', 0.85, 'menção a redução/isento/benefício')
  if (temNcmDetalhe && (houveDados || temClienteXml || temProduto || temFornecedor || /nas notas|no recorte|desse cliente/.test(n))) {
    add('tributacao_ncm', 0.8, 'ncm/cst/cfop no contexto do movimento')
  } else if (temNcmDetalhe && houveDados) {
    add('tributacao_ncm', 0.5, 'ncm/cst com histórico de dados')
  }
  if (temApuracao) {
    add('apuracao', 0.85, 'menção a apuração/saldo')
  } else if (houveDados && /resumo|total|geral|tudo/.test(n)) {
    add('apuracao', 0.3, 'resumo/total com histórico')
  }
  if (temFiltroPergunta) add('filtros', 0.95, 'pergunta explícita por filtros')
  if (/panorama|resumo geral|tudo|geral/.test(n) && (temClienteXml || houveDados)) {
    add('panorama', 0.5, 'panorama/resumo do movimento')
  }

  /* ---- bônus de contexto (histórico) ---- */
  if (houveDados) {
    if (anafora) {
      for (const e of acc.values()) {
        if (e.s > 0 && e.s < 1) {
          e.s = Math.min(1, e.s + 0.15)
          e.m.push('anáfora + histórico de dados')
        }
      }
      // Anáfora pura curta ("e desse cliente?", "só as entradas") sem sinal
      // próprio herda o escopo: dá piso a panorama/produtos.
      const semSinal = [...acc.values()].every((e) => e.s === 0)
      if (semSinal && curto) {
        const p = acc.get('panorama')!
        p.s = 0.5
        p.m.push('follow-up curto com anáfora (herda escopo)')
      }
    } else if (curto) {
      for (const [acao, e] of acc) {
        if ((acao === 'ranking_produtos_geral' || acao === 'listar_produtos' || acao === 'ranking_fornecedores') && e.s > 0) {
          e.s = Math.min(1, e.s + 0.1)
          e.m.push('follow-up curto + histórico')
        }
      }
    }
  }

  /* ---- trava anti-roubo: classificação fiscal pura não é dados ---- */
  // "tem algum ncm de banana", "08031000", "camiseta 100% algodão" sem nenhum
  // sinal de movimento → zera tudo (o RAG decide).
  const pareceClassificacaoPura =
    /\bncm\b|\bnbs\b/.test(n) && !temClienteXml && !temFornecedor && !temVendido && !temComprado &&
    !temTop && !temLista && !temDiferido && !temReducao && !temCredito && !temDebito && !anafora
  if (pareceClassificacaoPura) {
    for (const e of acc.values()) e.s = 0
  }

  // Materializa com clamp + probabilidade relativa.
  const bruto = todas.map((acao) => {
    const e = acc.get(acao)!
    return { acao, score: Math.max(0, Math.min(1, Math.round(e.s * 100) / 100)), motivos: e.m }
  })
  const soma = bruto.reduce((t, r) => t + r.score, 0)
  const out: AvaliacaoAcaoDados[] = bruto.map((r) => ({
    ...r,
    probabilidade: soma > 0 ? Math.round((r.score / soma) * 1000) / 1000 : 0,
  }))
  out.sort((a, b) => b.score - a.score || todas.indexOf(a.acao) - todas.indexOf(b.acao))
  return out
}

/** Top-1 + atalho booleano para o detector/refino. */
export function acaoPrincipalDados(
  pergunta: string,
  ctx: ContextoAcoesDados = { houveDados: false },
): AvaliacaoAcaoDados {
  return avaliarAcoesDados(pergunta, ctx)[0]
}

/**
 * `true` quando a mensagem é provavelmente sobre o movimento (dados).
 * Limiar: score ≥ 0.5; com histórico de dados + anáfora, ≥ 0.35 basta
 * (follow-ups curtos como "e desse cliente?" herdam o escopo).
 */
export function ehProvavelDados(
  pergunta: string,
  ctx: ContextoAcoesDados = { houveDados: false },
): boolean {
  const top = acaoPrincipalDados(pergunta, ctx)
  if (top.score >= 0.5) return true
  if (ctx.houveDados && top.score >= 0.35 && temAnaforaDados(normBaixo(pergunta))) return true
  return false
}
