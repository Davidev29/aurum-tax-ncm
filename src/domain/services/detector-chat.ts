/**
 * Detector de intenção do chat Aurum AI (puro, sem I/O).
 *
 * Taxonomia v2 (fine-tuning — ordem de checagem no orquestrador):
 * `capacidades` | `ajuda` | `navegar` | `status` | `tempo` | `conta` |
 * `saudacao` |
 * `conversa_leve` | `conceito` | `comparativo` | `legislacao` |
 * `cadastrar_produto` | `relatorio` | `clientes` | `dados` | `simples` |
 * `calculo` | `nbs` | `ncm` | `fora-escopo` | `generico`.
 *
 * - `cadastrar_produto` (fine-tuning v4): "quero cadastrar um produto" →
 *   coleta assistida (empresa/SKU/nome/NCM + tributária antiga opcional) com
 *   conferência e gravação SÓ após confirmação explícita.
 *
 * - `legislacao` (fine-tuning v3): "explica o art. 128", "o que diz a LC 214
 *   sobre cesta básica?" → pesquisa no corpus offline (`lc214.ts`) com molde
 *   claro + técnico + link da íntegra. Exige lastro legal explícito.
 *
 * - `conceito`: "o que é IBS?", "o que é Fator R?", "o que é sublimite?"
 *   → responde explicação simples determinística (sem RAG, sem cálculo).
 * - `comparativo`: "qual melhor III ou V?", "convencional x híbrido?"
 *   → explica regra + pede números ou usa contexto da conversa.
 * - `conversa_leve`: "obrigado", "bom dia, tudo bem?" (com saudação já
 *   coberta) → resposta breve + ponte para recursos.
 *
 * O orquestrador (`src/application/aurum-ai-chat.ts`) usa a intenção para
 * escolher a tool local — ver `src/application/aurum-ai-tools.ts` (plano
 * de tool calling) para o mapa intenção→tool.
 */

export type IntencaoChat =
  | 'capacidades'
  | 'ajuda'
  | 'navegar'
  | 'status'
  | 'tempo'
  | 'conta'
  | 'ncm'
  | 'nbs'
  | 'cnae'
  | 'cnpj'
  | 'cadastrar_produto'
  | 'calculo'
  | 'simples'
  | 'relatorio'
  | 'clientes'
  | 'dados'
  | 'legislacao'
  | 'saudacao'
  | 'conversa_leve'
  | 'conceito'
  | 'comparativo'
  | 'fora-escopo'
  | 'generico'

export type DestinoNavegar =
  | 'aurum'
  | 'calculadora'
  | 'simples'
  | 'consulta'
  | 'servicos'
  | 'lote'
  | 'nfe'
  | 'produtos'
  | 'auxiliares'
  | 'legislacao'
  | null

export interface AnaliseChat {
  intencao: IntencaoChat
  /** 8 dígitos (NCM) ou 9 dígitos (NBS) encontrados na mensagem. */
  codigoDigitos: string | null
  /** CNPJ (14 dígitos normalizados) quando a mensagem cita um CNPJ. */
  cnpj?: string | null
  /** CNAE (7 dígitos normalizados) quando a mensagem cita um CNAE. */
  cnae?: string | null
  /** Valor monetário R$ detectado (para cálculo direto). */
  valorBase: number | null
  /** Texto limpo para o RAG (sem "gera relatório", "quanto fica", etc). */
  termoBusca: string
  /** Só quando `intencao === 'navegar'`. */
  destino?: DestinoNavegar
  /** Menção de empresa extraída (nome/CNPJ) — para ancorar dados/cálculo. */
  empresaMencionada?: string | null
  /** Menção de produto específico ("queijo minas da Padaria Y" → "queijo minas"). */
  produtoMencionado?: string | null
  /**
   * Modificador visual (fluxo agêntico de gráficos): a intenção fiscal base
   * (dados/simples/calculo) é preservada; este flag diz ao orquestrador para
   * ANEXAR o artefato visual. Preenchido pelo orquestrador via
   * `detectarPedidoGrafico` (ver `aurum-ai-graficos.ts`) — opcional para não
   * quebrar o detector puro.
   */
  querGrafico?: boolean
  tipoGrafico?: import('@/application/aurum-ai-graficos').TipoGraficoChat | null
}

const SINAIS_NBS = [
  'nbs', 'servico', 'servicos', 'atividade', 'atividades', 'cnae', 'profiss', 'consultoria',
  'aula', 'curso', 'advocacia', 'medico', 'dentista', 'fisioterapia', 'yoga',
  'manutencao', 'transporte de pessoas', 'hospedagem', 'restaurante como servico',
  'tomador', 'prestacao', 'lc 116', 'lc116', 'lista de servicos', 'iss',
  'programacao', 'programação', 'desenvolvimento de software', 'software',
  'licenciamento de software', 'saas', 'suporte tecnico',
]

const SINAIS_CNPJ = [
  'cnpj', 'cnpjs', 'quais atividades', 'que atividades', 'atividades do cnpj',
  'atividades desse cnpj', 'consultar cnpj', 'consulta cnpj', 'consultar por cnpj',
  'dados do cnpj', 'dados dessa empresa', 'dessa empresa', 'salvar empresa',
  'salvar como cliente', 'salvar como emissor', 'cadastrar empresa',
  // Verificação de cadastro (fine-tuning v4 — "tá cadastrado?"). Só os
  // específicos entram aqui; os genéricos ("no sistema", "já tem") vivem no
  // check com CNPJ (abaixo) para não virar lastro fiscal de frase vaga.
  'cadastrad', 'registrad',
]

const SINAIS_CALCULO = [
  'quanto fica', 'quanto vou pagar', 'quanto da', 'calcula', 'calcule', 'calculo',
  'simula', 'simular', 'simulacao', 'ibs/cbs', 'ibs e cbs', 'aliquota efetiva',
  'carga tributaria', 'valor com imposto', 'r$',
]

const SINAIS_SIMPLES = [
  'simples', 'das', 'anexo', 'anexo i', 'anexo ii', 'anexo iii', 'anexo iv', 'anexo v',
  'anexo 1', 'anexo 2', 'anexo 3', 'anexo 4', 'anexo 5', 'rbt12', 'fator r',
  'sublimite', 'receita bruta', 'folha', 'rbt', 'receita', 'comercio', 'industria', 'construcao', 'advocacia', 'advogado', 'medico', 'engenheiro', 'contador', 'consultoria', 'programador', 'software', 'salao', 'barbeiro', 'academia', 'mei',
  'hibrido', 'hibrida', 'convencional', 'todos os anexos', 'cada anexo', 'sem empresa', 'nao tenho empresa', 'despesa', 'credito cbs', 'cbs por fora',
]

/**
 * 08-01: sinais de atividade para rotear "sou comercio/medico ..." ao Simples
 * quando há valores. NÃO entra em SINAIS_SIMPLES direto para não roubar
 * NBS ("qual NBS para aula de yoga?" continua NBS) nem conceito
 * ("o que é Fator R?" retorna antes). O fallback abaixo exige atividade +
 * ("sou/trabalho/atuo/tenho" ou valor monetário) e ausência de código/CNPJ
 * e de pedido explícito de NBS/CNAE.
 */
const SINAIS_ATIVIDADE_SIMPLES = [
  'comercio', 'comesio', 'loja', 'revenda', 'mercadinho', 'distribuidora', 'lojista',
  'industria', 'fabrica', 'fabrico', 'produzo',
  'salao', 'barbeiro', 'academia', 'aula', 'curso', 'manutencao', 'reparo',
  'locacao', 'creche', 'ensino',
  'construcao', 'empreitada', 'vigilancia', 'limpeza', 'conservacao',
  'advocacia', 'advogacia', 'advogado',
  'medico', 'engenheiro', 'emgenheiro', 'contador', 'consultoria',
  'programador', 'software', 'designer', 'auditor', 'publicidade',
]

const SINAIS_RELATORIO = [
  'relatorio', 'relatório', 'exporta', 'exportar', 'baixar', 'pdf',
  'csv', 'json', 'gera um texto', 'gera o relatorio', 'documento',
]
// NOTA: 'baixa' saiu da lista (varredura vocab s05/s08) — casava dentro de
// "folha baixa" e "baixa renda". "Baixa o PDF/relatório" continua coberto
// por 'baixar'/'pdf'/'relatorio'.

/**
 * Clientes cadastrados (empresas do banco local).
 * "quais meus clientes?", "lista meus clientes", "tem XML do cliente X?"
 * (com nome) cai aqui quando o foco é o CADASTRO; com foco em movimento
 * (notas, crédito, produto) a rota é `dados`.
 */
const SINAIS_CLIENTES = [
  'meus clientes', 'meu cliente', 'lista de clientes', 'quais clientes',
  'quantos clientes', 'clientes cadastrados', 'empresas cadastradas',
  'quais empresas', 'que empresas', 'tem algum cliente', 'algum cliente',
]

/**
 * Dados reais (XML ↔ cliente, vice-versa): perguntas sobre o MOVIMENTO
 * importado — fornecedor que dá crédito, produto que gera débito/crédito,
 * diferidos, reduções, filtros, NCM/CFOP/CST nas notas, período, ranking.
 * Tem precedência sobre NCM/NBS/conceito-genérico (ex.: "qual fornecedor
 * me dá mais crédito?" contém "crédito" mas NÃO é conceito).
 *
 * Cobertura 10-2026 (bug "quais top produtos desse cliente?" → NCM):
 * o "top/ranking/lista" no meio quebrava o substring ("quais produtos"),
 * então além dos substrings abaixo há o `ehSinalDadosAvancado()` com
 * regexes de top/ranking/vendido/comprado/lista — ver motor
 * `acoes-dados.ts` para o ranking determinístico completo.
 */
const SINAIS_DADOS = [
  'xml', 'xmls', 'nota fiscal', 'notas fiscais', 'nfe', 'nf-e', 'nfce', 'nfc-e',
  'fornecedor', 'fornecedores', 'loja que', 'lojas que',
  'diferido', 'diferidos', 'diferimento',
  'quais filtros', 'que filtros', 'filtrar por', 'filtrar',
  'qual produto', 'quais produtos', 'que produto',
  'top produto', 'top produtos', 'top fornecedor', 'top fornecedores',
  'mais vendido', 'mais vendido', 'mais vendidos', 'mais vendidos',
  'mais comprado', 'mais comprados', 'mais comprados',
  'produtos vendidos', 'produtos comprados', 'produto vendido', 'produto comprado',
  'lista de produtos', 'listar produtos', 'liste os produtos', 'lista os produtos',
  'produtos desse', 'produtos deste', 'produtos do cliente',
  'mais credito', 'mais crédito', 'mais debito', 'mais débito',
  'gerando credito', 'gerando crédito', 'gerando debito', 'gerando débito',
  'gera credito', 'gera crédito', 'gera debito', 'gera débito',
  'geraram credito', 'geraram crédito', 'geraram debito', 'geraram débito',
  'que mais comprei', 'que mais vendi', 'mais comprei', 'mais vendi',
  'que mais comprou', 'que mais vendeu', 'top fornecedor', 'ranking',
  'reducao nas notas', 'redução nas notas', 'quais reducoes', 'quais reduções',
  'tem reducao', 'tem redução', 'comprou de simples',
  'quanto comprei', 'quanto vendi', 'entradas e saidas', 'entradas e saídas',
]

/**
 * Sinais de movimento que o substring NÃO pega ("quais TOP produtos",
 * "lista os produtos vendidos", "produtos que mais geraram débito").
 * Puro e testável. Mantido aqui (camada detector) para não criar ciclo:
 * o motor `acoes-dados.ts` é a fonte completa do ranking; isto é só o
 * portão rápido do roteamento.
 */
export function ehSinalDadosAvancado(normalizado: string): boolean {
  const n = String(normalizado ?? '')
  if (!n) return false
  return (
    // "quais top produtos", "top 5 produtos/fornecedores", "ranking de produtos"
    /\btop\b\s*(\d{1,2}\s*)?(produtos?|fornecedor|clientes?|vendas?|compras?)/.test(n) ||
    /\branking\b.*\b(produtos?|fornecedor|vendas?|compras?|credito|debito)/.test(n) ||
    /\b(produtos?|fornecedor|vendas?|compras?|credito|debito)\b.*\branking\b/.test(n) ||
    // "quais ... produtos" com qualquer miolo ("quais top produtos", "quais os produtos")
    /\bquais?\b.{0,24}\bprodutos?\b/.test(n) ||
    // "produtos vendidos/comprados", "produto mais vendido", "mais vendidos"
    /\bprodutos?\b.{0,32}\b(vendid[oa]s?|comprad[oa]s?|credito|debito)\b/.test(n) ||
    /\b(vendid[oa]s?|comprad[oa]s?)\b.{0,24}\b(credito|debito|produtos?)\b/.test(n) ||
    /\bmais\b.{0,16}\b(vendid[oa]s?|comprad[oa]s?|credito|debito)\b/.test(n) ||
    // "lista/listar/listagem ... produtos/vendas/compras/fornecedor"
    /\b(list[aae]|listagem|mostra|mostre)\b.{0,24}\b(produtos?|vendas?|compras?|fornecedor|notas?|xml)/.test(n) ||
    // "produtos desse/deste/do cliente", "vendas desse cliente"
    /\b(produtos?|vendas?|compras?|notas?|xml)\b.{0,16}\b(desse|deste|dessa|desta|disso|do cliente|desse cliente)\b/.test(n) ||
    // "geraram mais crédito/débito", "que mais vendeu/comprou"
    /\bgerar[ao]m?\b.{0,24}\b(credito|debito)\b/.test(n) ||
    /\bque mais\b.{0,24}\b(vendi|vendeu|comprei|comprou|vendid|comprad|credito|debito)\b/.test(n)
  )
}

const SINAIS_NCM = [
  'ncm', 'produto', 'mercadoria', 'tem algum ncm', 'qual ncm', 'classifica',
  'classificacao', 'banana', 'queijo', 'carne', 'medicamento',
]

/** Pergunta sobre o que a IA sabe fazer (nunca é RAG fiscal).
 * v2: exige ausência de termo fiscal — "o que é IBS?" é conceito, não capacidade. */
const SINAIS_CAPACIDADES = [
  'o que voce pode fazer', 'o que voce faz', 'o que voce sabe fazer',
  'o que voce consegue fazer', 'quais suas funcoes', 'quais sao suas funcoes',
  'quais seus recursos', 'suas capacidades', 'lista de recursos',
  'para que voce serve', 'para que serve voce', 'como voce funciona',
  'como voce pode me ajudar', 'quem e voce', 'o que voce e', 'se apresente',
  'sua apresentacao', 'o que e voce', 'quem e vc', 'quem eh voce',
]

/** Explicação simples de conceito do sistema (sem cálculo, sem RAG). */
const SINAIS_CONCEITO = [
  'o que e ', 'o que significa', 'o que sao', 'o que significa',
  'me explica', 'me explique', 'explica ', 'explicacao',
  'conceito de', 'definicao de', 'para que serve o',
  'como funciona o fator', 'como funciona a', 'como funciona o ibs',
  'diferenca entre', 'qual a diferenca',
]

const TERMOS_CONCEITO = [
  'ibs', 'cbs', 'ncm', 'nbs', 'cst', 'cclasstrib', 'cfop', 'cest',
  'das', 'simples', 'anexo', 'fator r', 'fatorr', 'sublimite',
  'rbt', 'rba', 'folha', 'prolabore', 'hibrido', 'convencional',
  'reforma', 'tribut', 'imposto', 'aliquota', 'reducao', 'credito', 'debito',
  'diferimento', 'vigencia', 'cnae', 'cnpj', 'lc 116', 'lc116', 'iss',
  'lista de servicos',
  'sped', 'xml', 'nfe',
]

/** Comparação entre anexos/regimes ("qual vale mais a pena?"). */
const SINAIS_COMPARATIVO = [
  'qual melhor', 'qual vale', 'qual compensa', 'vale a pena',
  'compara', 'comparacao', 'comparativo', 'iii ou v', 'iii x v',
  'convencional ou hibrido', 'conv x hib',
  'iii vs v', 'hibrido vs convencional',
]

/**
 * 'Qual anexo' sozinho ("qual anexo do simples para 80 mil?") é pergunta do
 * Simples — só vira comparativo com disjunção ou verbo de comparação
 * ("qual anexo compensa/melhor?", "qual anexo, III ou V?").
 */
function contemComparativo(n: string): boolean {
  if (SINAIS_COMPARATIVO.some((s) => n.includes(s))) return true
  return /qual anexo/.test(n) && /( ou | ou\?| x | vs |,|melhor|compensa|vale|compar|fica melhor)/.test(n)
}

/**
 * Legislação LC 214/2025 (fine-tuning v3 — corpus offline em
 * `domain/services/lc214.ts`).
 *
 * Pedido para EXPLICAR/PESQUISAR a lei ("explica o art. 128", "o que diz a
 * LC 214 sobre cesta básica?", "pesquisa diferimento na lei"). Exige lastro
 * legal explícito (artigo numerado ou LC 214 + verbo/tema) para não roubar
 * "Anexo III" (Simples) nem "qual NBS..." (NBS).
 */
const SINAIS_LEGISLACAO = [
  'lc 214', 'lcp 214', 'lei complementar 214', 'lei complementar nº 214',
  'explica o art', 'explique o art', 'o que diz o art', 'o que diz a lei',
  'o que diz a lc', 'onde a lei fala', 'pesquisa na lei', 'pesquisa na lc',
  'texto da lei', 'integra da lei', 'na lc 214', 'pela lc 214', 'conforme a lc',
  'artigo da lc', 'artigo 128', 'artigo 135', 'artigo 137', 'artigo 138',
]

/** `true` quando a frase é pedido de explicação/pesquisa da LC 214. Puro. */
export function ehPedidoLegislacao(cru: string, normalizado: string): boolean {
  const texto = String(cru ?? '')
  const n = String(normalizado ?? '')
  if (!texto.trim()) return false
  // Artigo numerado sem código fiscal ("art. 128", "artigo 137") = lei.
  // Com NCM/NBS/CNPJ junto, o código vence (ex.: "NCM 0803 pelo art..." → NCM).
  if (/art(?:igo)?\.?\s*\d{1,3}\b/i.test(texto) && !/\bncm\b|\bnbs\b|\bcnpj\b|\b\d{8}\b|\b\d{9}\b/.test(n)) return true
  // "LC 214" + verbo/tema explicativo ou pergunta sobre a lei.
  if (/lc\s*214|lcp\s*214|lei complementar/.test(n)) {
    if (/art|anexo|diz|fala|explica|pesquisa|texto|onde|qual|o que|lista|reducao|diferimento|transicao|cesta|imovel|credito|debito|aliquota/.test(n)) return true
    // "LC 214" sozinha com verbo de pergunta também vale ("o que a LC 214 diz?").
    if (/^(o que|qual|como|onde|quando|por que|explique|explica|pesquise|lista)/.test(n)) return true
  }
  if (SINAIS_LEGISLACAO.some((s) => n.includes(s))) return true
  return false
}

/**
 * Menção leve de empresa (camada detector — sem I/O, sem importar
 * `application/`). Espelha `aurum-ai-empresa.extrairMencaoEmpresa` nos casos
 * de 1 linha; a resolução contra o cadastro acontece no orquestrador.
 */
export function extrairMencaoEmpresaLeve(texto: string): string | null {
  const cru = String(texto ?? '')
  if (!cru.trim()) return null
  const aspas = [...cru.matchAll(/["'“”‘’]([^"'“”‘’]{2,60})["'“”‘’]/g)].map((m) => m[1].trim())
  if (aspas.length) {
    const genericos = new Set(['algum', 'alguma', 'meus', 'desse', 'desta', 'disso'])
    const cand = [...aspas].reverse().find((a) => !genericos.has(a.toLowerCase().split(/\s+/)[0]))
    if (cand) return cand
  }
  const mask = cru.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/)
  if (mask && /cnpj|empresa|cliente|estabelecimento|contribuinte|emissor/i.test(cru)) return mask[0]
  const mExp = cru.match(/(?:empresa|cliente|companhia|loja)\s+(?:de\s+|da\s+|do\s+|chamad[ao]\s+)?([^,.;?]{2,60})/i)
  if (mExp?.[1]) {
    const nome = mExp[1].trim().replace(/\s+(tem|possui|com|e|que|para|me|se)\b.*$/i, '').trim()
    if (nome.length >= 2 && !/^(algum|alguma|todos|meus|desse|deste)\b/i.test(nome)) return nome
  }
  const mLoc = cru.match(/\b(?:da|de|do|na|no)\s+([A-ZÀ-Ú][A-Za-zÀ-ú0-9&'.\-]{1,30}(?:\s+[A-ZÀ-Úa-zà-ú0-9&'.\-]{2,30}){0,4})/)
  if (mLoc?.[1]) {
    const nome = mLoc[1].trim()
    if (nome.length >= 3 && !/^(receita|nota|xml|lei|art|mes|ano|cliente|empresa|sistema)\b/i.test(nome)) return nome
  }
  return null
}

/** Menção leve de produto específico ("produto X", aspas, "o Y da <Empresa>"). Puro. */
export function extrairProdutoMencionadoLeve(texto: string): string | null {
  const cru = String(texto ?? '')
  const mProd = cru.match(/produtos?\s+(?:de\s+|da\s+|do\s+|chamad[ao]\s+)?([^,.;?]{2,60})/i)
  if (mProd?.[1]) {
    const nome = mProd[1].trim().split(/\s+(da|de|do|desse|desta)\b/i)[0].trim()
    if (nome.length >= 2 && !/^(diferido|diferidos|com reducao|que|qual|quais|mais|menos|top|ranking|lista|desse|deste)\b/i.test(nome)) return nome
  }
  const aspas = [...cru.matchAll(/["'“”‘’]([^"'“”‘’]{2,60})["'“”‘’]/g)].map((m) => m[1].trim())
  if (aspas.length >= 2) return aspas[0]
  const mAntes = cru.match(/(?:o|a|os|as|esse|essa|este|esta)\s+([^,.;?]{2,50})\s+(?:da|de|do)\s+/i)
  if (mAntes?.[1]) {
    const cand = mAntes[1].trim()
    if (cand.length >= 3 && !/^(cliente|empresa|fornecedor|produto|calculo|valor|imposto)\b/i.test(cand)) return cand
  }
  return null
}

/** Conversa leve (agradecimento/despedida/confirmação/social breve). */
const SINAIS_CONVERSA_LEVE = [
  'obrigado', 'obrigada', 'valeu', 'brigado', 'brigada',
  'tchau', 'ate mais', 'ate logo', 'ate breve',
  'ok', 'beleza', 'entendi', 'perfeito', 'show', 'legal',
  'bom dia', 'boa tarde', 'boa noite',
  'como voce esta', 'como vai', 'como vai voce', 'tudo bem',
  'tudo certo', 'bom te ver', 'oi tudo bem',
]

/**
 * "E você?" isolado é conversa leve — mas "o que você acha?" (com verbo de
 * opinião) é vago de verdade (generico). Lista de verbos que descaracterizam.
 */
const VERBOS_OPINIAO = ['acha', 'acham', 'pensa', 'pensam', 'sabe', 'sabem', 'faz', 'fazem', 'recomenda', 'sugere', 'diria', 'diz', 'conhece', 'opina']

function ehConversaLeveDetector(n: string): boolean {
  if (SINAIS_CONVERSA_LEVE.some((s) => n.includes(s))) return true
  // "e você?" / "e vc?" sem verbo de opinião (varredura vocab s10).
  if (/\be vo?c?e\b/.test(n) && !VERBOS_OPINIAO.some((v) => n.includes(v))) return true
  return false
}

/** Pedido de tutorial de um recurso do sistema. */
const SINAIS_AJUDA = [
  'como consulto', 'como consultar', 'como calculo', 'como calcular',
  'como gero', 'como gerar', 'como uso', 'como usar', 'como faco',
  'me ensina', 'me explica como', 'me ajuda a usar', 'tutorial',
  'passo a passo', 'como funciona o', 'como funciona a',
]

/** Pedido para ir até uma tela do sistema. */
const SINAIS_NAVEGAR = [
  'ir para', 'va para', 'leva para', 'levar para', 'me leva',
  'abre a', 'abra a', 'abrir a', 'acessar', 'mostra a tela',
  'quero ver o', 'quero ver a',
]

/**
 * 'Ir/va para' aparece dentro de "alíquota efeti-va para R$..." — exige
 * fronteira à esquerda. Demais sinais mantêm substring.
 */
function contemNavegar(n: string): boolean {
  return SINAIS_NAVEGAR.some((s) =>
    s === 'ir para' || s === 'va para' ? /(?:^|[\s,])(ir|va)\s+para\b/.test(n) : n.includes(s),
  )
}

/** Pergunta sobre saúde da base/sistema. */
const SINAIS_STATUS = [
  'base esta pronta', 'base pronta', 'base carregada', 'base atualizada',
  'quantos ncm', 'status', 'sistema ok', 'sistema pronto',
  'sistema atualizado', 'tudo carregado', 'versao da base',
  'esta ok', 'ta ok', 'esta pronta', 'ta pronta', 'esta pronto', 'ta pronto',
]

/** Último lastro fiscal genérico (para o fallback honesto). */
const SINAIS_CNPJ_FISCAL = SINAIS_CNPJ.filter(
  (s) => s !== 'cadastrad' && s !== 'registrad' && s !== 'no sistema' && s !== 'ja tem' && s !== 'ja existe' && s !== 'ja cadastrei' && s !== 'consta',
)

const SINAIS_FISCAL_GERAL = [
  ...SINAIS_NBS.filter((s) => s !== 'curso' && s !== 'aula' && s !== 'iss'),
  ...SINAIS_NCM,
  ...SINAIS_CNPJ_FISCAL,
  'fiscal', 'tribut', 'imposto', 'ibs', 'cbs', 'cst', 'cclasstrib',
  'cfop', 'anexo', 'nomenclatura', 'reforma', 'lc 214', 'cest', 'cnpj',
]

const SAUDACOES = ['oi', 'ola', 'olá', 'bom dia', 'boa tarde', 'boa noite', 'obrigad', 'valeu', 'tchau']

function normBaixo(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

import { extrairValorRobusto } from './valores-chat'
import { temSinalFiscal } from './escopo-consulta'
import { SINONIMOS_FISCAIS } from './vocabulario'
import { SINONIMOS_SERVICOS } from './vocabulario-servicos'
import { contemApelido, detectarConta, detectarTempo, removerApelido } from './basico-chat'

function extrairValor(texto: string): number | null {
  return extrairValorRobusto(texto)
}

/**
 * Extrai CNPJ (14 dígitos) com ou sem formatação.
 * Aceita "53.795.990/0001-68", "53795990000168" ou embutido em frase
 * ("Quais atividades o CNPJ: 53.795.990/0001-68 tem?").
 * Retorna os 14 dígitos normalizados ou null.
 */
export function extrairCnpj(texto: string): string | null {
  const cru = String(texto ?? '')
  if (!cru) return null
  // Formato mascarado primeiro (mais específico).
  const mask = cru.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/)
  if (mask) return mask[0].replace(/\D+/g, '')
  // Sequência de 14 dígitos (pode estar colada em texto maior).
  const m14 = cru.replace(/\D+/g, '').match(/\d{14}/)
  // Só vale se o texto original tem lastro de CNPJ ou 14 dígitos contíguos.
  // Evita confundir NCM (8) + valor com CNPJ.
  if (m14) {
    const digitos = cru.replace(/\D+/g, '')
    // Se há exatamente 14 dígitos no texto todo → CNPJ direto.
    if (digitos.length === 14) return digitos
    // Se há menção a cnpj/empresa + 14 dígitos em algum lugar → CNPJ.
    if (/cnpj|empresa|estabelecimento/i.test(cru)) return m14[0]
    // Token isolado de 14 dígitos.
    if (new RegExp(`\\b${m14[0]}\\b`).test(cru)) return m14[0]
  }
  // Fallback: token com 14 dígitos após norm (cobre "CNPJ:53795990000168").
  const porToken = String(texto ?? '').split(/[\s;,|]+/)
  for (const tok of porToken) {
    const d = tok.replace(/\D+/g, '')
    if (d.length === 14) return d
  }
  return null
}

/**
 * Slots de produto/serviço a partir de linguagem natural (fine-tuning §7).
 *
 * "catalogar um produto que tem composição: algodão 100%" →
 *   { composicao: "algodão 100%" }
 * "camiseta 100% algodão para revenda" →
 *   { descricao: "camiseta", composicao: "100% algodão", destinacao: "revenda" }
 *
 * Variações cobertas: "composição:", "composto por/de", "feito de/em",
 * "material", "ingredientes", "para (uso/consumo/revenda/plantio...)",
 * "destinação/destino", "uso em/para".
 */
export interface SlotsProduto {
  descricao: string
  composicao: string | null
  destinacao: string | null
  uso: string | null
}

export function extrairSlotsProduto(texto: string): SlotsProduto {
  const cru = String(texto ?? '').trim()
  let trabalho = ` ${cru} `
  let composicao: string | null = null
  let destinacao: string | null = null
  let uso: string | null = null

  // 1) "composição: X" (até vírgula/ponto-e-vírgula/fim ou "e com"/"destinação").
  const mCompRotulo = trabalho.match(/composi[cç][aã]o\s*:\s*([^.;]+?)(?=\s+(?:e\s+com\b|destina|\buso\b|para\b|[.;])|$)/i)
  if (mCompRotulo?.[1]?.trim()) {
    composicao = mCompRotulo[1].trim().replace(/\s+/g, ' ')
    trabalho = trabalho.replace(mCompRotulo[0], ' ')
  } else {
    // 2) "composto por X" / "composta de X" / "feito de X" / "feita em X"
    //    / "material X" / "ingredientes: X".
    const mCompNatural = trabalho.match(/(?:compost[oa]s?\s+(?:por|de)|feit[oa]s?\s+(?:de|em|com)|fabricad[oa]s?\s+(?:em|de|com)|material\s*:?|ingredientes?\s*:?)\s+([^.;]+?)(?=\s+(?:para\b|destina|\buso\b|[.;])|$)/i)
    if (mCompNatural?.[1]?.trim()) {
      composicao = mCompNatural[1].trim().replace(/\s+/g, ' ')
      trabalho = trabalho.replace(mCompNatural[0], ' ')
    } else {
      // 3) Percentual solto ("100% algodão", "algodão 100%") vira composição.
      // Prioridade para "N% material" (o padrão real de composição); o reverso
      // ("camiseta 100%") é nome do produto + teor, não composição.
      const mPctDireto = trabalho.match(/\d{1,3}\s*%\s*[a-zà-ú]+(?:\s+[a-zà-ú]+){0,2}/i)
      const candidato = mPctDireto?.[0]?.trim() ?? trabalho.match(/[a-zà-ú]+(?:\s+[a-zà-ú]+){0,2}\s+\d{1,3}\s*%/i)?.[0]?.trim() ?? null
      if (candidato && /algod|poliest|seda|lã|latex|aço|ferro|cobre|pl[aá]stico|madeira|vidro|leite|trigo|milho|carne|frango|acrilico|nailon|náilon|viscose/i.test(candidato)) {
        composicao = candidato.replace(/\s+/g, ' ')
      }
    }
  }

  // Destinação: "para revenda/consumo/plantio/uso próprio/industrialização..."
  const mDest = trabalho.match(/para\s+(revenda|consumo|consumo\s+pr[óo]prio|uso\s+pr[óo]prio|plantio|semeadura|abate|reprodu[çc][aã]o|industrializa[çc][aã]o|comercializa[çc][aã]o|exporta[çc][aã]o|alimenta[çc][aã]o\s+animal|ra[çc][aã]o)/i)
  if (mDest?.[1]?.trim()) destinacao = mDest[1].trim().replace(/\s+/g, ' ')

  // Uso: "uso em/em X", "uso: X".
  const mUso = trabalho.match(/\buso\s*(?:em|para|:)?\s*([^.;]+?)(?=[.;]|$)/i)
  if (mUso?.[1]?.trim() && mUso[1].trim().length >= 3 && mUso[1].trim().length <= 80) {
    uso = mUso[1].trim().replace(/\s+/g, ' ')
  }

  return { descricao: cru, composicao, destinacao, uso }
}

/**
 * Andaime genérico de pergunta (forma normalizada, sem acento).
 * Interrogativos + auxiliares + substantivos fiscais + pronomes/fillers.
 * NUNCA contém nome de produto/serviço — o primeiro token fora daqui
 * inicia o núcleo ("preciso do ncm para parafuso" → "parafuso...").
 */
const ANDAIME_GENERICO = new Set([
  'qual', 'quais', 'quanto', 'quantos', 'quanta', 'como', 'onde', 'quando',
  'porque', 'o', 'que', 'voce', 'vc', 'me', 'mim', 'lhe', 'nos',
  'tem', 'temos', 'tenha', 'ter', 'ha', 'haver', 'existe', 'existem',
  'seria', 'seriam', 'e', 'eh', 'sao', 'foi', 'era',
  'saber', 'sabe', 'sabem', 'dizer', 'diz', 'diga', 'fala', 'informar', 'informa',
  'querer', 'quero', 'quer', 'precisa', 'preciso', 'precisam', 'gostaria', 'queria',
  'consegue', 'conseguem', 'pode', 'podem', 'favor',
  'esse', 'essa', 'isso', 'este', 'esta', 'isto', 'desse', 'dessa', 'disso',
  'dele', 'dela', 'nele', 'nela', 'mesmo', 'mesma', 'proprio', 'propria',
  'tributacao', 'tributo', 'imposto', 'impostos', 'ncm', 'nbs', 'codigo',
  'classificacao', 'consulta', 'aliquota', 'ai', 'entao', 'agora', 'hoje',
  'por', 'para', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'com',
  'sem', 'sobre', 'a', 'o', 'os', 'as', 'um', 'uma', 'algum', 'alguma', 'tipo',
  'sistema',
  // Andaime em inglês (a tradução PT acontece depois; o núcleo sai limpo já)
  'what', 'which', 'how', 'is', 'are', 'does', 'do', 'the', 'an', 'for',
  'of', 'to', 'i', 'want', 'know', 'please', 'tax', 'taxation', 'code',
  'there', 'any',
])

/** Remove o andaime inicial genérico até o conteúdo. Puro e testável. */
export function despirAndaime(texto: string): string {
  const norm = String(texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
  const toks = norm.split(/\s+/).filter(Boolean)
  let i = 0
  // Preserva o mapa original (caixa/pontuação) fatiando pelo nº de tokens.
  const crus = String(texto ?? '').trim().split(/\s+/)
  while (i < toks.length && ANDAIME_GENERICO.has(toks[i])) i++
  if (i === 0) return String(texto ?? '').trim()
  if (i >= crus.length) return ''
  return crus.slice(i).join(' ').trim()
}

/**
 * Domínio do pedido (fine-tuning §5 — decidir ANTES de vasculhar).
 *
 * "abacate" → produto · "aula de yoga" → serviço · "consultoria" → serviço.
 * Cruza os tokens do núcleo com os dois vocabulários do sistema
 * (produtos ↔ serviços); empate ou zero sinal = `indefinido` (tenta os dois).
 */
export type DominioPedido = 'produto' | 'servico' | 'indefinido'

const MARCADORES_SERVICO_FORTES = new Set([
  'servico', 'servicos', 'atividade', 'atividades', 'aula', 'curso', 'consultoria',
  'assessoria', 'advocacia', 'dentista', 'yoga', 'cnae', 'tomador', 'prestacao',
])

const MARCADORES_PRODUTO_FORTES = new Set([
  'produto', 'produtos', 'mercadoria', 'ncm', 'composicao', 'ingrediente',
])

/**
 * 'curso'/'aula'/'iss' como substring casam dentro de "re-curso-s", "paula"
 * e "isso" — exigem fronteira de palavra. Demais sinais mantêm substring.
 */
const SINAIS_NBS_CONTORNO = new Set(['curso', 'aula', 'iss'])

export function contemNbs(n: string): boolean {
  return SINAIS_NBS.some((s) =>
    SINAIS_NBS_CONTORNO.has(s) ? new RegExp(`\\b${s}\\b`).test(n) : n.includes(s),
  )
}

export function classificarDominio(nucleo: string): DominioPedido {
  const toks = String(nucleo ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/\s+/)
    .filter((w) => w.replace(/\W+/g, '').length >= 3)
  if (!toks.length) return 'indefinido'
  let servico = 0
  let produto = 0
  for (const t of toks) {
    const limpo = t.replace(/\W+/g, '')
    if (MARCADORES_SERVICO_FORTES.has(limpo)) servico += 2
    else if (SINONIMOS_SERVICOS[limpo] != null) servico += 1
    if (MARCADORES_PRODUTO_FORTES.has(limpo)) produto += 2
    else if (SINONIMOS_FISCAIS[limpo] != null) produto += 1
  }
  if (servico > 0 && produto > 0) return servico >= produto ? 'servico' : 'produto'
  if (servico > 0) return 'servico'
  if (produto > 0) return 'produto'
  return 'indefinido'
}

/**
 * Núcleo da pergunta (fine-tuning §7 — raciocínio antes do RAG).
 *
 * "Temos tributação para tangerina?" / "Qual a tributação de X?" /
 * "tem algum ncm de banana" — a pergunta inteira NUNCA pode virar termo de
 * busca: o andaime ("temos", "tributação", "para") quebra o AND estrito e
 * gera NÃO SEI mesmo com o item na base. Aqui extraímos só o X.
 *
 * Retorna o núcleo limpo ou `null` quando nada aproveitável resta.
 */
export function extrairNucleoBusca(texto: string): string | null {
  let t = String(texto ?? '').trim()
  if (!t) return null
  // Cauda educada + interrogação.
  t = t.replace(/\s*\?\s*$/, '').trim()
  // Molduras de pergunta (ordem: mais específica primeiro).
  const molduras = [
    // "temos tributação para X" / "tem no sistema alguma tributação para X"
    /^(tem|temos|há|ha|existe|existem)\s+(no\s+sistema\s+)?(alguma?\s+)?tributa[cç][aã]o\s+(para|de|em)\s+/i,
    // "qual (é|seria) a tributação de X" / "qual tributação para X"
    /^qual\s+(é|e|seria|seriam)?\s*(a|o)?\s*tributa[cç][aã]o\s+(de|do|da|para)\s+/i,
    // "qual (é|seria) o ncm/nbs de X" / "qual o ncm: X"
    /^qual\s+(é|e|seria|seriam)?\s*(o|a)?\s*(ncm|nbs|c[óo]digo)\s+(de|do|da|para)\s+/i,
    /^qual\s+(é|e|seria|seriam)?\s*(o|a)?\s*(ncm|nbs|c[óo]digo)\s*:\s*/i,
    // "tem algum ncm/nbs de X" / "existe ncm para X"
    /^(tem|existe)\s+(algum|alguma|um|uma)\s+(ncm|nbs|c[óo]digo)\s+(de|do|da|para)\s+/i,
    // "qual ncm X" (sem preposição — o resto é limpo abaixo)
    /^qual\s+(o|a)?\s*(ncm|nbs|c[óo]digo)\s+/i,
    // "(o|um) ncm/nbs de/para X" / "ncm X"
    /^(o|a|um|uma)?\s*(ncm|nbs|c[óo]digo)\s+(de|do|da|para)?\s*/i,
    // "me diz/diga qual ..." (ordem de serviço)
    /^(me\s+(diz|diga|fala|informa)|por\s+favor\s*,?)\s+/i,
  ]
  for (const rx of molduras) {
    const antes = t
    t = t.replace(rx, '').trim()
    if (t !== antes) break
  }
  // Resíduo verbal ("casaria com X", "seria X") + preposição solta.
  for (let i = 0; i < 3; i++) {
    const antes = t
    t = t.replace(/^(casaria|casariam|casa|seria|seriam|ficaria|ficariam|fica|e|com|de|para|em)\s+/i, '').trim()
    if (t === antes) break
  }
  // Fase 2 — andaime genérico: cobre molduras NÃO previstas acima
  // ("você sabe me dizer...", "preciso do ncm para...", "consegue informar").
  // Remove tokens iniciais de andaime até o primeiro token de conteúdo.
  t = despirAndaime(t)
  // Caudas que não são o objeto ("...e quanto fica 2 mil", "...por favor").
  t = t
    .replace(/\s+e\s+quanto\s+fica.*$/i, '')
    .replace(/\s*(por\s+favor|obrigad[oa]|valeu)\s*[.?!]*$/i, '')
    .trim()
  if (!t) return null
  if (!t) return null
  // Só stopwords/andaime? ("qual a tributação?" sem X → sem núcleo)
  const utels = t.split(/\s+/).filter((w) => w.replace(/\W+/g, '').length >= 3)
  if (!utels.length) return null
  if (/^(tributa[cç][aã]o|produto|mercadoria|serviço|servico|atividade)$/i.test(t)) return null
  // Pergunta sem objeto ("qual a tributação?", "temos tributação?") — a
  // moldura não casou por faltar o X, mas continua sendo só andaime.
  if (/^(qual|quais|tem|temos|h[aá]|existe|existem|me)\b.*\b(tributa[cç][aã]o|ncm|nbs|c[óo]digo)\s*$/i.test(t)) return null
  return t
}

function extrairDigitos(texto: string): string | null {
  const t = String(texto ?? '')
  // Grupos de 8/9 dígitos em qualquer posição ("quanto fica 2000 no 08031000?").
  // NBS (9) primeiro para não fatiar um grupo de 9 como NCM de 8.
  const m9 = t.match(/\b\d{9}\b/)
  if (m9) return m9[0]
  const m8 = t.match(/\b\d{8}\b/)
  if (m8) return m8[0]
  const m = t.match(/\b\d{4}\.\d{2}\.\d{2}\b/)
  if (m) return m[0].replace(/\D+/g, '')
  return null
}

/**
 * Extrai CNAE (7 dígitos normalizados) da mensagem.
 *
 * Formatos aceitos:
 * - oficial `XXXX-X/XX` (ex.: `6201-5/01`) — vale mesmo sem a palavra "cnae";
 * - 7 dígitos isolados (`\b\d{7}\b`) SOMENTE com lastro ("cnae"/"anexo" na
 *   frase) para não confundir com CEST ou fragmento de outro código.
 *
 * Retorna os 7 dígitos ou null. Puro e testável.
 */
export function extrairCnae(texto: string): string | null {
  const cru = String(texto ?? '')
  if (!cru) return null
  const fmt = cru.match(/\b\d{4}-\d\/\d{2}\b/)
  if (fmt) return fmt[0].replace(/\D+/g, '')
  if (/\bcnae\b/i.test(cru)) {
    const m7 = cru.match(/\b\d{7}\b/)
    if (m7) return m7[0]
  }
  // "qual anexo para 6201501?" — anexo + 7 dígitos também é CNAE.
  if (/\banexo\b/i.test(cru)) {
    const m7 = cru.match(/\b\d{7}\b/)
    if (m7) return m7[0]
  }
  return null
}

/**
 * Typos/abreviações do andaime (forma normalizada → forma canônica).
 * Só cobre o VOCABULÁRIO DE INTENÇÃO (tributação, consulta, cálculo...),
 * nunca nome de produto — produto com typo cai na correção do gate
 * (`correcao-consulta`), que tem segunda chance com a base.
 */
const NORMALIZACAO_ENTRADA: Array<[RegExp, string]> = [
  [/\btributasao\b/g, 'tributacao'],
  [/\btriburacao\b/g, 'tributacao'],
  [/\btributucao\b/g, 'tributacao'],
  [/\btributacaoo\b/g, 'tributacao'],
  [/\bcunsulta\b/g, 'consulta'],
  [/\bconsuta\b/g, 'consulta'],
  [/\bcomsulta\b/g, 'consulta'],
  [/\bcaclulo\b/g, 'calculo'],
  [/\bcauculo\b/g, 'calculo'],
  [/\bcalcluo\b/g, 'calculo'],
  [/\brelatroio\b/g, 'relatorio'],
  [/\brelatorioo\b/g, 'relatorio'],
  [/\bprogramasao\b/g, 'programacao'],
  [/\bcpnpj\b/g, 'cnpj'],
  [/\bcnjp\b/g, 'cnpj'],
  [/\btip[iy]\b/g, 'tipo'],
  [/\bvc\b/g, 'voce'],
  [/\bpq\b/g, 'porque'],
  [/\btb\b/g, 'tambem'],
  [/\btbm\b/g, 'tambem'],
  [/\bobg\b/g, 'obrigado'],
  [/\bvlw\b/g, 'valeu'],
  [/\bblz\b/g, 'beleza'],
  [/\bpfv?\b/g, 'por favor'],
]

/** Normaliza a entrada para a detecção: caixa/acento + typos/abreviações. */
export function normalizarEntrada(texto: unknown): string {
  let n = normBaixo(String(texto ?? ''))
  for (const [rx, certo] of NORMALIZACAO_ENTRADA) n = n.replace(rx, certo)
  return n.replace(/\s+/g, ' ').trim()
}

function contem(lista: string[], n: string): boolean {
  return lista.some((s) => n.includes(s))
}

/**
 * `das`/`mei`/`anexo` como substring casam dentro de "ca-das-tra",
 * "meio/primeiro" e "anexado" — exigem fronteira de palavra. Demais sinais
 * mantêm substring.
 */
function contemSimples(n: string): boolean {
  return SINAIS_SIMPLES.some((s) =>
    s === 'das' || s === 'mei' || s === 'anexo' ? new RegExp(`\\b${s}\\b`).test(n) : n.includes(s),
  )
}

function extrairDestino(n: string): DestinoNavegar {
  if (/calculadora/.test(n)) return 'calculadora'
  if (/consulta.*nbs|servicos|nbs/.test(n)) return 'servicos'
  if (/consulta|ncm/.test(n)) return 'consulta'
  if (/simples|das/.test(n)) return 'simples'
  if (/lote/.test(n)) return 'lote'
  if (/nfe|nota|xml/.test(n)) return 'nfe'
  if (/produto/.test(n)) return 'produtos'
  if (/auxiliar|tabela/.test(n)) return 'auxiliares'
  if (/legisla|norma|lei/.test(n)) return 'legislacao'
  if (/aurum|chat|ia\b/.test(n)) return 'aurum'
  return null
}

/**
 * Detecta a intenção da mensagem do chat. Pura e testável.
 * `fora-escopo` aqui é só heurística de roteamento — a barreira oficial
 * (`detectarForaDeEscopo`) é aplicada pelo orquestrador antes do RAG,
 * exceto para orientação/conhecimento simples:
 * `capacidades|ajuda|navegar|status|saudacao|conversa_leve|conceito|comparativo`.
 *
 * Ordem v2 (do mais específico ao mais genérico):
 * saudação pura (só cumprimento) → capacidades (sem termo fiscal) → ajuda →
 * navegar → status → relatório → conversa_leve → comparativo →
 * conceito explícito → simples → cálculo → NBS/NCM → conceito genérico →
 * fallback por lastro fiscal (descrição de produto sem gatilho) → genérico.
 */
export function detectarIntencaoChat(mensagem: unknown): AnaliseChat {
  const cru = String(mensagem ?? '').trim()
  const n = normalizarEntrada(cru)
  const codigoDigitos = extrairDigitos(cru)
  const valorBase = extrairValor(cru)
  const cnpj = extrairCnpj(cru)
  const cnae = extrairCnae(cru)
  const empresaMencionada = extrairMencaoEmpresaLeve(cru)
  const produtoMencionado = extrairProdutoMencionadoLeve(cru)

  if (!n) return { intencao: 'generico', codigoDigitos, cnpj, cnae, valorBase, termoBusca: '', empresaMencionada, produtoMencionado }

  // Apelido da mascote (Aurinha): o vocativo não muda a intenção — "oi
  // aurinha" é saudação, "aurinha, que horas são?" é tempo. As checagens de
  // saudação usam também a forma sem apelido; tempo/conta já ignoram o
  // vocativo internamente.
  const cruSemApelido = removerApelido(cru)
  const nSemApelido = normalizarEntrada(cruSemApelido)

  // Saudação PURA: só cumprimento ("oi", "bom dia!", "oi, tudo bem?",
  // "oi aurinha", "bom dia aurinha!").
  // Com resto intencional ("oi, me leva para a calculadora") NÃO segura —
  // continua para navegar/ajuda/fiscal abaixo.
  const saud = SAUDACOES.find((s) => {
    const limpo = n.replace(/[!?.…]+$/, '').trim()
    return n === s || limpo === s || n.startsWith(`${s} `) || n.startsWith(`${s},`)
  })
  // Saudação com apelido ("oi aurinha", "bom dia, aurinha!"): o resto após
  // remover o apelido decide — sem resto intencional, é saudação pura.
  const saudApelido = !saud
    ? SAUDACOES.find((s) => {
      const limpo = nSemApelido.replace(/[!?.…]+$/, '').trim()
      return nSemApelido === s || limpo === s || nSemApelido.startsWith(`${s} `) || nSemApelido.startsWith(`${s},`)
    })
    : undefined
  const saudEfetiva = saud ?? saudApelido
  if (saudEfetiva) {
    const baseN = saud ? n : nSemApelido
    const restoCru = baseN
      .slice(baseN.startsWith(saudEfetiva) ? saudEfetiva.length : 0)
      .replace(/^[,!\s]+/, '')
      .replace(/[!?.…]+$/, '')
      .trim()
    // "oi aurinha": o resto é só o apelido — trata como cumprimento puro.
    const resto = removerApelido(removerApelido(restoCru)).replace(/^[,!\s]+/, '').trim()
    const restoLeve =
      !resto ||
      ['tudo bem', 'tudo certo', 'e voce', 'como vai', 'como vai voce', 'bom te ver', 'oi tudo bem'].some((l) => resto === l)
    if (restoLeve && !contem(SINAIS_FISCAL_GERAL, nSemApelido) && !contem(TERMOS_CONCEITO, nSemApelido) && !codigoDigitos && !cnpj && !cnae && !detectarTempo(cru)) {
      return { intencao: 'saudacao', codigoDigitos, cnpj, cnae, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
    }
  }
  // Apelido sozinho ("Aurinha?", "Aurinha!") → saudação (ela se apresenta).
  // Identidade com apelido ("você é a Aurinha?", "Aurinha, quem é você?") →
  // capacidades (apresentação + recursos).
  if (contemApelido(cru) && !codigoDigitos && !cnpj && !cnae) {
    const sobra = nSemApelido.replace(/[!?.…]+$/, '').trim()
    if (!sobra || sobra.length <= 2 || /^(oi|ola|opa|eai|oie)$/.test(sobra)) {
      return { intencao: 'saudacao', codigoDigitos, cnpj, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
    }
    if (/quem e voce|voce e|seu nome|como .*cham|o que voce e|quem eh voce|e voce/.test(n) && !contem(TERMOS_CONCEITO, nSemApelido) && !contem(SINAIS_FISCAL_GERAL, nSemApelido)) {
      return { intencao: 'capacidades', codigoDigitos, cnpj, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
    }
  }
  // Capacidades SOMENTE sem termo fiscal — "o que é IBS?" é conceito.
  if (contem(SINAIS_CAPACIDADES, n) && !contem(TERMOS_CONCEITO, n) && !contem(SINAIS_FISCAL_GERAL, n)) {
    return { intencao: 'capacidades', codigoDigitos, cnpj, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
  }
  // Capacidades com apelido no vocativo ("aurinha, o que você pode fazer?").
  if (contem(SINAIS_CAPACIDADES, nSemApelido) && !contem(TERMOS_CONCEITO, nSemApelido) && !contem(SINAIS_FISCAL_GERAL, nSemApelido)) {
    return { intencao: 'capacidades', codigoDigitos, cnpj, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
  }
  if (contem(SINAIS_AJUDA, n)) {
    return { intencao: 'ajuda', codigoDigitos, cnpj, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
  }
  if (contemNavegar(n)) {
    const destino = extrairDestino(n)
    // "Ir para o V" (anexo) ou "vale a pena ... ir para" sem tela de destino
    // não é navegação — devolve ao fluxo (comparativo/simples decidem).
    if (destino || !/(anexo|\biii\b|\biv\b|\bv\b|hibrido|convencional|compar|vale a pena)/.test(n)) {
      return { intencao: 'navegar', codigoDigitos, cnpj, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado, destino }
    }
  }
  if (contem(SINAIS_STATUS, n)) {
    return { intencao: 'status', codigoDigitos, cnpj, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
  }
  // Relatório ANTES da conversa leve: "obrigado, gera um relatório"
  // é pedido de relatório, não agradecimento.
  if (contem(SINAIS_RELATORIO, n)) {
    const termoBusca = cru.replace(/gera(r)?\s+(um|o|esse)?\s*(relatorio|relatório|texto|documento)[^\n]*/gi, '').trim() || cru
    return { intencao: 'relatorio', codigoDigitos, cnpj, valorBase, termoBusca, empresaMencionada, produtoMencionado }
  }
  // Cadastrar produto pela IA (fine-tuning v4 — fluxo assistido com
  // conferência e gravação só após confirmação explícita). Antes do CNPJ
  // para que "salvar produto da empresa X" não vire consulta de empresa.
  // "Como cadastrar um produto" já saiu em ajuda (tutorial, sem escrita).
  if (/(cadastrar|cadastra|salvar|salva|adicionar|adiciona|registrar|registra|criar|cria|atualizar|atualiza).{0,30}produtos?\b/.test(n)) {
    return { intencao: 'cadastrar_produto', codigoDigitos, cnpj, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
  }
  // CNPJ tem prioridade sobre NBS/NCM: "Quais atividades o CNPJ X tem?"
  // contém "atividades" (sinal NBS) mas a intenção é consultar a empresa.
  // Aceita com ou sem formatação (extrairCnpj normaliza). Com dígitos, a
  // verificação de cadastro ("tá cadastrado?", "já tem no sistema?") também
  // cai aqui — o orquestrador decide entre status/cadastro/atividades.
  if (cnpj && (contem(SINAIS_CNPJ, n) || /cnpj|empresa|estabelecimento|contribuinte|cadastrad|registrad|no sistema|ja tem|ja existe|ja cadastrei|consta/i.test(cru))) {
    return { intencao: 'cnpj', codigoDigitos, cnpj, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
  }
  // Inventário com particípio ("lista meus clientes cadastrados?", sem CNPJ):
  // é lista de cadastro, não verificação — antes da regra de CNPJ abaixo.
  if (!cnpj && /cadastrad|registrad/.test(n) && /clientes?\b|empresas?\b/.test(n) && !/xml|nota fiscal|\bnfe\b|fornecedor|produto|credito|debito|compra|venda|movimento/.test(n)) {
    return { intencao: 'clientes', codigoDigitos, cnpj, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
  }
  // "salvar essa empresa" sem CNPJ na frase atual → cnpj por contexto
  // (o orquestrador promove via refinarIntencaoComContexto; aqui cobre o
  // caso com verbo explícito mesmo sem dígitos).
  if (/cadastrar|cadastrad|salvar|gravar/i.test(n) && /cnpj|empresa|cliente|emissor/i.test(n)) {
    return { intencao: 'cnpj', codigoDigitos, cnpj, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
  }
  // Conversa leve antes do comparativo (evita "obrigado" virar outra coisa).
  if (ehConversaLeveDetector(n) && n.split(/\s+/).length <= 6 && !codigoDigitos && !cnpj && !cnae && valorBase == null && !contem(SINAIS_FISCAL_GERAL, n) && !contem(TERMOS_CONCEITO, n)) {
    return { intencao: 'conversa_leve', codigoDigitos, cnpj, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
  }
  // Comparativo antes do Simples: "qual melhor III ou V?" tem "anexo" mas
  // a intenção é comparar, não calcular um DAS isolado. "Qual anexo" puro
  // (sem disjunção ou verbo de comparação) é pergunta do Simples.
  if (contemComparativo(n)) {
    return { intencao: 'comparativo', codigoDigitos, cnpj, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
  }
  // Legislação LC 214 (fine-tuning v3) ANTES de conceito/Simples: "explica o
  // art. 128", "o que diz a LC 214 sobre cesta básica?" é pesquisa na lei
  // (corpus offline), não verbete simples nem cálculo de anexo.
  if (ehPedidoLegislacao(cru, n)) {
    return { intencao: 'legislacao', codigoDigitos, cnpj, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
  }
  // Conceito explícito ANTES de Simples/Cálculo: "o que é Fator R?" contém
  // "fator r" mas é explicação, não projeção de DAS. Exige verbo explicativo.
  // Com CNAE citado, a rota é o anexo (cnae), não o verbete.
  if (contem(SINAIS_CONCEITO, n) && contem(TERMOS_CONCEITO, n) && !cnae) {
    return { intencao: 'conceito', codigoDigitos, cnpj, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
  }
  // Básico (tempo + conta): "que horas são?", "que dia é hoje?", "quanto é
  // 2+3?", "10% de 500", "resto de 10 por 3". ANTES de clientes/dados/
  // Simples/cálculo para que "calcula 2+2" não vire IBS/CBS e "10% de 500"
  // não vire DAS. O guard fiscal vive em `detectarConta` (código NCM/NBS/
  // CNPJ presente → fluxo fiscal decide).
  const tipoTempo = detectarTempo(cru)
  if (tipoTempo) {
    return { intencao: 'tempo', codigoDigitos, cnpj, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
  }
  const contaBasica = detectarConta(cru)
  if (contaBasica) {
    return { intencao: 'conta', codigoDigitos, cnpj, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
  }
  // Clientes (cadastro) e Dados (movimento XML) ANTES de Simples/Cálculo/
  // NCM: "tem algum XML de algum cliente?" contém "tem algum" mas NÃO é
  // consulta NCM — é inventário de dados. "qual fornecedor me dá mais
  // crédito?" contém "crédito" mas NÃO é conceito — é ranking real.
  // Relatório explícito já saiu acima; aqui cobre perguntas analíticas.
  if (contem(SINAIS_CLIENTES, n) && !contem(SINAIS_DADOS, n) && !ehSinalDadosAvancado(n)) {
    // Com nome de cliente + movimento ("XML do cliente X", "notas do cliente
    // Y") o foco é o DADO, não o cadastro — roteia a dados.
    if (/xml|nota|nfe|movimento|compra|venda|credito|debito|produto|fornecedor/.test(n)) {
      return { intencao: 'dados', codigoDigitos, cnpj, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
    }
    return { intencao: 'clientes', codigoDigitos, cnpj, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
  }
  if (contem(SINAIS_DADOS, n) || ehSinalDadosAvancado(n)) {
    return { intencao: 'dados', codigoDigitos, cnpj, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
  }
  // CNAE direto (7 dígitos `XXXX-X/XX` ou 7 dígitos com lastro "cnae/anexo"):
  // "qual anexo do CNAE 6201-5/01?" → cnae (tabela viva CNAE × Anexo Simples).
  // Antes do Simples para "anexo" não roubar a rota.
  if (cnae) {
    return { intencao: 'cnae', codigoDigitos, cnpj, cnae, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
  }
  // Pedido explícito de código (NBS/NCM) vence a heurística do Simples:
  // "quais seriam os NBS para consultoria?" contém "consultoria" (sinal do
  // Simples), mas a intenção é consultarNBS, não calcular DAS. Sem esse
  // guard, a tool errada era chamada e a resposta vinha "sem nexo".
  // Com verbo de cálculo + código/valor, mantém o cálculo (orquestrador cruza).
  const temNbsExplicito = /\bnbs\b/.test(n) || codigoDigitos?.length === 9
  const temNcmExplicito = /\bncm\b/.test(n) || codigoDigitos?.length === 8
  const temSinalCalculo = contem(SINAIS_CALCULO, n) || (valorBase != null && codigoDigitos != null)
  if (temNbsExplicito && !temSinalCalculo) {
    return { intencao: 'nbs', codigoDigitos, cnpj, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
  }
  if (temNcmExplicito && !temSinalCalculo) {
    return { intencao: 'ncm', codigoDigitos, cnpj, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
  }
  if (contemSimples(n)) {
    return { intencao: 'simples', codigoDigitos, cnpj, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
  }
  // 08-01: "sou comercio/medico ..." com valores cai em 'simples'.
  // Exige atividade + (sou/trabalho/atuo/tenho ou valor) e ausência de
  // código/CNPJ; pedido explícito de NBS/CNAE preserva a rota NBS.
  if (!codigoDigitos && !cnpj) {
    const temAtividade = SINAIS_ATIVIDADE_SIMPLES.some((s) => n.includes(s))
    if (temAtividade && !/\bnbs\b|\bcnae\b/.test(n)) {
      const temVozAtividade = /sou\b|trabalho|atuo|tenho uma?|tenho um|dou aula|dou curso|faco |faço /.test(n)
      if (valorBase != null || temVozAtividade) {
        return { intencao: 'simples', codigoDigitos, cnpj, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
      }
    }
  }
  if (contem(SINAIS_CALCULO, n) || (valorBase != null && codigoDigitos != null)) {
    return { intencao: 'calculo', codigoDigitos, cnpj, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
  }
  const ehNbs = contemNbs(n)
  const ehNcm = contem(SINAIS_NCM, n) || /\bncm\b/.test(n)
  if (codigoDigitos?.length === 9 || (ehNbs && !ehNcm)) {
    return { intencao: 'nbs', codigoDigitos, cnpj, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
  }
  if (codigoDigitos?.length === 8 || ehNcm || /\btem algum\b/.test(n) || /\bqual\b.*\bcodigo\b/.test(n)) {
    return { intencao: 'ncm', codigoDigitos, cnpj, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
  }
  if (ehNbs) return { intencao: 'nbs', codigoDigitos, cnpj, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
  // "qual a tributação de X?" é pedido de CLASSIFICAÇÃO (produto ou serviço),
  // não conceito — o orquestrador cruza NCM + NBS antes de desistir.
  if (/tributa[cç][aã]o\s+(de|do|da|para)\s+\S/i.test(cru)) {
    return { intencao: 'ncm', codigoDigitos, cnpj, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
  }
  // "o que é sublimite?" sem verbo padrão mas com termo fiscal claro.
  // Fica DEPOIS de NBS/NCM para que "qual NBS para aula de yoga?" não vire conceito.
  if (/^(o que|qual|como|por que|porque|quando|onde)\b/.test(n) && contem(TERMOS_CONCEITO, n) && !codigoDigitos && !cnpj && !cnae && valorBase == null) {
    return { intencao: 'conceito', codigoDigitos, cnpj, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
  }
  // Hedge puro ("hmm, sei lá", "não sei"): 'lá' normaliza para 'la' (= lã,
  // produto!) e puxaria NCM via temSinalFiscal. Vago de verdade → generico.
  // Exige mensagem inteira de hedge, curta, sem dígitos (com conteúdo fiscal
  // junto, ex.: "não sei o ncm de banana", o fluxo fiscal decide).
  if (!codigoDigitos && !cnpj && !cnae && valorBase == null && /^((hmm+|hum+|ahm+|hm|sei la|nao sei|nao faco ideia)[\s,?!.]*)+$/.test(n)) {
    return { intencao: 'generico', codigoDigitos, cnpj, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
  }
  // Fallback por lastro fiscal real (vocabulário de produto + dicionário +
  // sinais de uso): descrição sem palavra-gatilho ("camiseta de algodão",
  // "vendo parafuso sextavado") tenta o RAG em vez de "não entendi".
  // Com valor monetário e sem código, NÃO força NCM — é continuação de
  // cálculo ("e para 50 mil?"), que o contexto da conversa resolve.
  if (valorBase == null && !codigoDigitos && !cnpj && temSinalFiscal(cru)) {
    return { intencao: 'ncm', codigoDigitos, cnpj, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
  }
  // Sem marcador fiscal claro, não chuta RAG: pede esclarecimento com as
  // capacidades (o orquestrador responde com orientação + botões).
  if (contem(SINAIS_FISCAL_GERAL, n) && n.length >= 2) {
    return { intencao: 'ncm', codigoDigitos, cnpj, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
  }
  return { intencao: 'generico', codigoDigitos, cnpj, valorBase, termoBusca: cru, empresaMencionada, produtoMencionado }
}
