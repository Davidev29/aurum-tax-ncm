/**
 * Aurum AI — contexto empresa/produto/cálculo (fine-tuning v3).
 *
 * Problema que resolve:
 * 1. "DE QUAL EMPRESA o usuário está falando?" — antes, `clienteTexto` vinha
 *    de 2 regexes frágeis ("cliente X") e o escopo caía para a empresa ativa
 *    ou TODAS sem avisar. Agora a menção é extraída de 6 padrões (aspas,
 *    "empresa X", "cliente X", "da/do <Nome>", CNPJ) e resolvida contra o
 *    cadastro: única → ancora; ambígua → pergunta qual; não encontrada →
 *    orienta; nenhuma → usa ativa/todas AVISANDO.
 * 2. "É PRODUTO ESPECÍFICO DELA?" — separa menção de produto da menção de
 *    empresa ("queijo minas DA Padaria Y") e localiza o produto NOS XMLs do
 *    escopo (descrição/código/NCM), para cálculo e tributação usarem o NCM
 *    real da empresa — não um chute do RAG.
 * 3. "QUER FAZER ALGUM CÁLCULO?" — classifica a intenção de cálculo com
 *    escopo (empresa + produto + valor + código) antes de rotear, para
 *    "quanto fica esse queijo da Padaria Y?" virar cálculo ancorado, e não
 *    NCM genérico.
 *
 * Tudo puro e testável (sem Dexie aqui): o orquestrador injeta empresas e
 * notas; este módulo só DECIDE. Nenhum número é calculado aqui (P1).
 */

export interface EmpresaResumo {
  id: number | null
  razaoSocial: string
  fantasia: string
  cnpj: string
}

export type TipoResolucaoEmpresa =
  | 'unica'
  | 'ambigua'
  | 'nao_encontrada'
  | 'sem_mencao_com_ativa'
  | 'sem_mencao_todas'

export interface ResolucaoEmpresa {
  tipo: TipoResolucaoEmpresa
  /** Empresas candidatas (1 na única, N na ambígua). */
  candidatas: EmpresaResumo[]
  /** Texto da menção original ("Padaria Pão Dourado"), se houve. */
  mencao: string | null
}

function normBaixo(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

function soDigitos(s: string): string {
  return String(s ?? '').replace(/\D+/g, '')
}

const GENERICOS_EMPRESA = new Set([
  'algum', 'alguma', 'alguns', 'algumas', 'todos', 'todas', 'meus', 'minhas',
  'meu', 'minha', 'desse', 'deste', 'dessa', 'desta', 'disso', 'dele', 'dela',
  'nesse', 'neste', 'nessa', 'nesta', 'qualquer', 'cada', 'outro', 'outra',
])

/**
 * Extrai a menção de empresa da pergunta (puro).
 * Ordem: aspas → CNPJ com lastro → "empresa/cliente X" → "da/do <Nome>".
 * Retorna o nome/CNPJ cru ou null quando genérico ("algum cliente").
 */
export function extrairMencaoEmpresa(pergunta: string): string | null {
  const cru = String(pergunta ?? '')
  if (!cru.trim()) return null
  // 1) Aspas: da empresa "Pão Dourado" / produto "queijo minas" da 'Padaria Y'.
  // Pega a ÚLTIMA aspa quando há 2+ (a empresa costuma vir depois do produto).
  const aspas = [...cru.matchAll(/["'“”‘’]([^"'“”‘’]{2,60})["'“”‘’]/g)].map((m) => m[1].trim())
  if (aspas.length) {
    const cand = [...aspas].reverse().find((a) => !GENERICOS_EMPRESA.has(normBaixo(a).split(/\s+/)[0]))
    if (cand) return cand
  }
  // 2) CNPJ (só com lastro de empresa na frase, para não roubar NCM+valor).
  const mask = cru.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/)
  if (mask && /cnpj|empresa|cliente|estabelecimento|contribuinte|emissor/i.test(cru)) return mask[0]
  // 3) "empresa/cliente X" explícito.
  const mExp = cru.match(/(?:empresa|cliente|companhia|loja)\s+(?:de\s+|da\s+|do\s+|chamad[ao]\s+)?([^,.;?]{2,60})/i)
  if (mExp?.[1]) {
    const nome = mExp[1].trim().replace(/\s+(tem|possui|com|e|que|para|me|se)\b.*$/i, '').trim()
    const primeira = normBaixo(nome).split(/\s+/)[0]
    if (nome.length >= 2 && !GENERICOS_EMPRESA.has(primeira)) return nome
  }
  // 4) "da/do/na/no <Nome Próprio>" — exige ao menos 1 token com maiúscula ou 2+ tokens,
  // para "da receita" / "do mês" não virarem empresa.
  const mNome = cru.match(/\b(?:da|de|do|na|no)\s+([A-ZÀ-Ú][A-Za-zÀ-ú0-9&'.\-]{1,30}(?:\s+[A-ZÀ-Úa-zà-ú0-9&'.\-]{2,30}){0,4})/)
  if (mNome?.[1]) {
    const nome = mNome[1].trim()
    const toks = nome.split(/\s+/).filter(Boolean)
    const temMaiuscula = /^[A-ZÀ-Ú]/.test(nome)
    if ((toks.length >= 2 || temMaiuscula) && nome.length >= 3) {
      const stop = /^(receita|receitas|folha|rbt|anexo|das|simples|conversa|calculo|nota|notas|xml|lei|artigo|art|tabela|mes|ano|periodo|cliente$|empresa$|sistema$)/i
      if (!stop.test(toks[0]) && !/^(qual|quais|que|quanto|como|onde|quando)\b/i.test(nome)) return nome
    }
  }
  return null
}

/**
 * Resolve a menção contra o cadastro (puro).
 * - com menção: busca por nome (razão/fantasia contém) ou CNPJ exato;
 * - sem menção: usa a ativa (se existir) ou todas (visão geral).
 */
export function resolverEmpresaAlvo(
  mencao: string | null,
  empresas: EmpresaResumo[],
  empresaAtivaId: number | null,
): ResolucaoEmpresa {
  const lista = (empresas ?? []).filter((e) => e.id != null)
  if (mencao) {
    const dig = soDigitos(mencao)
    if (dig.length === 14) {
      const porCnpj = lista.filter((e) => soDigitos(e.cnpj) === dig)
      if (porCnpj.length === 1) return { tipo: 'unica', candidatas: porCnpj, mencao }
      if (porCnpj.length > 1) return { tipo: 'ambigua', candidatas: porCnpj, mencao }
      return { tipo: 'nao_encontrada', candidatas: [], mencao }
    }
    const n = normBaixo(mencao).trim()
    const porNome = lista.filter(
      (e) => normBaixo(e.razaoSocial ?? '').includes(n) || normBaixo(e.fantasia ?? '').includes(n),
    )
    if (porNome.length === 1) return { tipo: 'unica', candidatas: porNome, mencao }
    if (porNome.length > 1) return { tipo: 'ambigua', candidatas: porNome.slice(0, 5), mencao }
    return { tipo: 'nao_encontrada', candidatas: [], mencao }
  }
  if (empresaAtivaId != null) {
    const ativa = lista.filter((e) => e.id === empresaAtivaId)
    if (ativa.length === 1) return { tipo: 'sem_mencao_com_ativa', candidatas: ativa, mencao: null }
  }
  return { tipo: 'sem_mencao_todas', candidatas: [], mencao: null }
}

/** Nome de exibição ("Razão (Fantasia)" quando diferem). */
export function nomeEmpresa(e: EmpresaResumo): string {
  if (e.fantasia && e.fantasia !== e.razaoSocial) return `${e.razaoSocial} (${e.fantasia})`
  return e.razaoSocial || e.cnpj || `empresa ${e.id}`
}

/** Linha de escopo citada no topo das respostas com empresa. */
export function linhaEscopoEmpresa(r: ResolucaoEmpresa): string | null {
  if (r.tipo === 'unica') return `**Empresa:** ${nomeEmpresa(r.candidatas[0])}`
  if (r.tipo === 'sem_mencao_com_ativa') return `**Empresa:** ${nomeEmpresa(r.candidatas[0])} (ativa no sistema)`
  if (r.tipo === 'sem_mencao_todas') return null
  return null
}

/** Pergunta de desambiguação quando 2+ empresas casam. */
export function textoDesambiguacaoEmpresa(r: ResolucaoEmpresa): string {
  const linhas = r.candidatas.map((e, i) => `${i + 1}. **${nomeEmpresa(e)}**`).join('\n')
  return (
    `Encontrei **${r.candidatas.length} empresas** para "${r.mencao}":\n${linhas}\n\n` +
    `Me diga o número ou o nome exato (ou o CNPJ) — e se quiser, já diga o produto ou o cálculo junto (ex.: "o 1, quanto fica o queijo minas?").`
  )
}

/* ------------------------------------------------- produto da empresa -- */

export interface IntencaoEmpresaProdutoCalculo {
  /** A frase menciona alguma empresa (nome entre aspas, "empresa X", CNPJ...)? */
  querEmpresa: boolean
  empresaTexto: string | null
  /** Há menção de produto específico (não genérico)? */
  querProduto: boolean
  produtoTexto: string | null
  /** Há pedido de cálculo (valor, "quanto fica", IBS/CBS, DAS...)? */
  querCalculo: boolean
  valor: number | null
  codigo: string | null
}

/**
 * Classifica a tríade empresa × produto × cálculo numa frase (puro).
 * Usado pelo detector/refino para rotear "quanto fica ESSE queijo DA Padaria Y?".
 */
export function classificarEmpresaProdutoCalculo(pergunta: string): IntencaoEmpresaProdutoCalculo {
  const cru = String(pergunta ?? '')
  const n = normBaixo(cru)
  const empresaTexto = extrairMencaoEmpresa(cru)
  // Produto: "produto X" explícito, aspas (primeira = produto quando há 2),
  // ou "o/a <substantivo> da/do <Empresa>" (o produto antes da empresa).
  let produtoTexto: string | null = null
  const mProd = cru.match(/produtos?\s+(?:de\s+|da\s+|do\s+|chamad[ao]\s+)?([^,.;?]{2,60})/i)
  if (mProd?.[1]) {
    const nome = mProd[1].trim().split(/\s+(da|de|do|desse|desta)\b/i)[0].trim()
    if (nome.length >= 2 && !/^(diferido|diferidos|com reducao|que|qual|quais|mais|menos|top|ranking|lista|desse|deste)\b/i.test(nome)) produtoTexto = nome
  }
  if (!produtoTexto) {
    const aspas = [...cru.matchAll(/["'“”‘’]([^"'“”‘’]{2,60})["'“”‘’]/g)].map((m) => m[1].trim())
    if (aspas.length >= 2) produtoTexto = aspas[0]
    else if (aspas.length === 1 && empresaTexto && normBaixo(aspas[0]) !== normBaixo(empresaTexto)) produtoTexto = aspas[0]
  }
  if (!produtoTexto && empresaTexto) {
    // "o queijo minas da Padaria Y" → produto = trecho entre artigo e "da Empresa".
    const idx = cru.toLowerCase().lastIndexOf(normBaixo(empresaTexto).slice(0, Math.min(8, empresaTexto.length)))
    void idx
    const mAntes = cru.match(/(?:o|a|os|as|esse|essa|este|esta)\s+([^,.;?]{2,50})\s+(?:da|de|do)\s+/i)
    if (mAntes?.[1]) {
      const cand = mAntes[1].trim()
      if (cand.length >= 3 && !/^(cliente|empresa|fornecedor|produto|calculo|valor|imposto)\b/i.test(cand)) produtoTexto = cand
    }
  }
  const m8 = cru.match(/\b\d{8}\b/) ?? cru.match(/\b\d{4}\.\d{2}\.\d{2}\b/)
  const codigo = m8 ? m8[0].replace(/\D+/g, '') : null
  const mValor = cru.match(/r\$\s*([\d.,]+)|([\d.,]+)\s*(mil|milh|k\b)/i)
  const querCalculo =
    /quanto fica|quanto vou pagar|quanto da|calcula|calcule|calculo|simula|ibs|cbs|aliquota efetiva|carga tributaria|r\$|\bdas\b|simples/i.test(n) ||
    mValor != null
  return {
    querEmpresa: empresaTexto != null,
    empresaTexto,
    querProduto: produtoTexto != null,
    produtoTexto,
    querCalculo,
    valor: null,
    codigo,
  }
}

export interface ItemNotaResumo {
  descricao: string
  codProd: string
  ncm: string
}

/**
 * Localiza um produto mencionado dentro dos itens do escopo (puro, fuzzy).
 * Retorna até `limite` candidatos ordenados por aderência.
 */
export function localizarProdutoEmNotas<T extends ItemNotaResumo>(produto: string, itens: T[], limite = 5): T[] {
  const alvo = normBaixo(produto).split(/\s+/).filter((t) => t.replace(/\W+/g, '').length >= 3)
  if (!alvo.length || !itens?.length) return []
  const scored = itens.map((it) => {
    const desc = normBaixo(`${it.descricao ?? ''} ${it.codProd ?? ''} ${it.ncm ?? ''}`)
    let s = 0
    for (const t of alvo) if (desc.includes(t)) s += t.length >= 5 ? 2 : 1
    // Cobertura total do nome curto ("queijo minas" inteiro na descrição) ancora.
    if (alvo.length <= 3 && alvo.every((t) => desc.includes(t))) s += 3
    return { it, s }
  }).filter((r) => r.s > 0)
  scored.sort((a, b) => b.s - a.s)
  return scored.slice(0, limite).map((r) => r.it)
}
