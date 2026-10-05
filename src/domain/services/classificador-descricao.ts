/**
 * Classificador por descrição livre — etapa 1 (pura, sem IndexedDB).
 *
 * Papel: transformar "boi vivo Nelore para reprodução" em sinais fiscais
 * auditáveis (palavras-chave, capítulo prioritário, consultas expandidas,
 * RGI aplicável, perguntas complementares). A etapa 2
 * (`src/application/classificacao-inteligente.ts`) ancora cada candidato no
 * NCM vigente + vínculo oficial da Reforma — **nunca inventa NCM nem
 * benefício**: a base oficial (`public/base/`, nível Deus) é a única fonte
 * de NCMs, CST/cClassTrib, anexos e base legal.
 *
 * Todas as comparações usam `normalizarBusca` (sem acento/caixa/pontuação).
 */
import { normalizarBusca, pareceCodigoNcm, tokenizarBusca } from './busca-texto'
import { SINONIMOS_FISCAIS, expandirSinonimoFiscal } from './vocabulario'
import { secaoDoCapitulo } from './hierarquia-fiscal'
import { EXCECOES_FAMILIA } from './regras-hierarquicas'

/** Entrada do classificador: descrição livre + contexto opcional. */
export interface EntradaDescricao {
  descricao: string
  destinacao?: string
  composicao?: string
  uso?: string
}

export type Confianca = 'alta' | 'media' | 'baixa'

/** Sinais fiscais extraídos do texto (ids estáveis, usados em testes). */
export type SinalFiscal =
  | 'VIVO'
  | 'REPRODUTOR'
  | 'ABATE'
  | 'SEMENTE_PLANTIO'
  | 'RACAO_ANIMAL'
  | 'SAL_ADICIONADO'
  | 'HORTICOLA'
  | 'CARNE'
  | 'CEREAL'
  | 'DISPOSITIVO_MEDICO'
  | 'MEDICAMENTO'
  | 'VESTUARIO'
  | 'CALCADO'
  | 'ELETRONICO'
  | 'MOVEIS'
  | 'VEICULO'
  | 'COZIDO'
  | 'IN_NATURA'
  | 'QUIMICO'
  | 'PLASTICO_BORRACHA'
  | 'MADEIRA_PAPEL'
  | 'MAQUINA_EQUIPAMENTO'
  | 'INSTRUMENTO_OTICA'
  | 'ESTADO_CORTE'
  | 'ESTADO_CONSERVACAO'

export interface AnaliseDescricao {
  /** Texto combinado (descrição + contexto), normalizado. */
  textoNormalizado: string
  /** Tokens úteis (sem stopwords). */
  tokens: string[]
  /** Sinais fiscais detectados. */
  sinais: SinalFiscal[]
  /** Ambiguidades / condições de risco que pedem atenção. */
  ambiguidades: string[]
  /** Capítulos NCM prioritários para desempate (ex.: ['01']). */
  capitulosPrioritarios: string[]
  /** Seções SH prioritárias (derivadas dos capítulos — contexto p/ RAG/lexical). */
  secoesPrioritarias: string[]
  /**
   * Exceções de família ativas: condições presentes no texto que QUEBRAM a
   * herança automática do benefício (sal, cozido, destinação condicional…).
   * A IA deve citar o alerta em vez de herdar em silêncio.
   */
  excecoesFamiliaAtivas: string[]
  /** Variações de consulta para a busca textual oficial. */
  consultasExpandidas: string[]
  /** RGIs citadas na justificativa. */
  rgiAplicaveis: string[]
  /** `true` quando o texto é insuficiente para classificar. */
  insuficiente: boolean
}

/** Palavras sem valor fiscal, descartadas dos tokens úteis. */
const STOPWORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'para', 'pra', 'com', 'sem', 'em', 'no', 'na',
  'nos', 'nas', 'e', 'ou', 'um', 'uma', 'uns', 'umas', 'o', 'a', 'os', 'as',
  'tipo', 'produto', 'mercadoria', 'item', 'coisa', 'et', 'se', 'que', 'por',
])

/**
 * Sinônimos/inferências: termo do dia a dia → vocabulário da nomenclatura.
 * Fonte única em `./vocabulario` (cobertura de todos os capítulos, não só
 * agro). A inferência só EXPANDE a consulta — a prova continua sendo o match
 * na descrição oficial.
 *
 * ATENÇÃO (armadilha do AND): a busca estrita exige TODOS os termos no caminho
 * do NCM, então cada expansão deve ser termo ÚNICO presente literalmente no
 * texto oficial — de preferência o radical comum às flexões
 * (`bovin` casa com bovino/bovina/bovinos; `suin` com suíno/suína/suínos).
 * Multi-termo só quando os termos coocorrem no oficial (ex.: `cães` + `gatos`
 * em 2309.10.00). Termo sem correspondente oficial cai no fallback tolerante
 * (2ª fase OR + fuzzy do RAG).
 */
const SINONIMOS: Record<string, string> = SINONIMOS_FISCAIS

/** Cada sinal: gatilhos (tokens normalizados) e capítulos prioritários. */
const REGRAS_SINAL: { sinal: SinalFiscal; gatilhos: string[]; capitulos: string[] }[] = [
  { sinal: 'VIVO', gatilhos: ['vivo', 'vivos', 'viva', 'vivas'], capitulos: ['01'] },
  {
    sinal: 'REPRODUTOR',
    gatilhos: ['reprodutor', 'reprodutores', 'reproducao', 'matriz', 'matrizes', 'raca', 'pura', 'prenhe', 'prenhes', 'cria', 'reprodutora'],
    capitulos: ['01'],
  },
  { sinal: 'ABATE', gatilhos: ['abate', 'frigorifico', 'frigorifico', 'corte', 'carcaca', 'carne'], capitulos: ['01', '02'] },
  {
    sinal: 'SEMENTE_PLANTIO',
    gatilhos: ['semeadura', 'semente', 'sementes', 'sementeira', 'plantio', 'plantar', 'cultivo', 'lavoura'],
    capitulos: ['10', '12'],
  },
  {
    sinal: 'RACAO_ANIMAL',
    gatilhos: ['racao', 'alimentacao', 'forragem', 'pastagem', 'suplemento', 'caes', 'gatos', 'pet', 'nutricao'],
    capitulos: ['23'],
  },
  { sinal: 'SAL_ADICIONADO', gatilhos: ['sal', 'salgado', 'sodio', 'cloreto'], capitulos: [] },
  {
    sinal: 'HORTICOLA',
    gatilhos: ['horticola', 'verdura', 'legume', 'fruta', 'ovo', 'ovos', 'hortalica', 'tomate', 'alface', 'batata'],
    capitulos: ['07', '08'],
  },
  { sinal: 'CARNE', gatilhos: ['carne', 'carnes', 'carcaca', 'carcacas', 'miudeza', 'miudezas', 'bovina', 'bovino', 'bovin', 'suina', 'suino', 'suin', 'frango', 'ave', 'aves', 'ovina', 'caprina', 'equina'], capitulos: ['02', '03', '16'] },
  {
    sinal: 'CEREAL',
    gatilhos: ['cereal', 'cereais', 'milho', 'trigo', 'arroz', 'cevada', 'aveia', 'sorgo', 'grao'],
    capitulos: ['10'],
  },
  { sinal: 'DISPOSITIVO_MEDICO', gatilhos: ['dispositivo', 'protese', 'seringa', 'cateter', 'medico', 'hospitalar'], capitulos: ['90'] },
  { sinal: 'MEDICAMENTO', gatilhos: ['medicamento', 'remedio', 'farmaco', 'antibiotico', 'comprimido'], capitulos: ['30'] },
  { sinal: 'VESTUARIO', gatilhos: ['camisa', 'camiseta', 'blusa', 'calca', 'jeans', 'bermuda', 'vestido', 'saia', 'terno', 'cueca', 'meia', 'algodao', 'seda', 'poliester', 'vestuario', 'confeccao', 'tecido', 'malha'], capitulos: ['52', '54', '55', '60', '61', '62'] },
  { sinal: 'CALCADO', gatilhos: ['calcado', 'sapato', 'tenis', 'chinelo', 'sandalia', 'bota', 'couro', 'bolsa', 'mochila', 'mala', 'cinto'], capitulos: ['41', '42', '64'] },
  { sinal: 'ELETRONICO', gatilhos: ['telefone', 'tablet', 'computador', 'monitor', 'teclado', 'impressora', 'televisao', 'radio', 'audio', 'fone', 'carregador', 'bateria', 'lampada', 'led', 'refrigerador', 'congelador', 'fogao', 'forno', 'microondas', 'condicionador', 'ventilador'], capitulos: ['84', '85'] },
  { sinal: 'MOVEIS', gatilhos: ['assento', 'mesa', 'cama', 'armario', 'estante', 'colchao', 'panela', 'talher', 'copo', 'prato', 'moveis', 'mobilia'], capitulos: ['44', '73', '82', '94'] },
  { sinal: 'VEICULO', gatilhos: ['veiculo', 'motocicleta', 'caminhao', 'onibus', 'bicicleta', 'pneu', 'retrovisor', 'farol', 'automovel', 'carro', 'moto', 'pneumatico', 'amortecedor', 'embreagem', 'reboque', 'barco', 'aviao', 'helicoptero', 'locomotiva', 'vagao'], capitulos: ['86', '87', '88', '89'] },
  { sinal: 'COZIDO', gatilhos: ['cozido', 'cozida', 'cozidos', 'cozimento', 'precozido'], capitulos: [] },
  { sinal: 'IN_NATURA', gatilhos: ['natura', 'fresco', 'fresca', 'frescas', 'frescos', 'cru', 'crua', 'resfriado', 'resfriada', 'congelado', 'congelada'], capitulos: [] },
  // --- funil rigoroso animal: corte e conservação decidem 01×02×03 ---
  // 01 = vivo · 02.01 = bovina fresca/refrigerada · 02.02 = bovina congelada ·
  // 02.03 = suína · 02.07 = aves em pedaços/miudezas. Sem o estado, o NCM
  // de 8 dígitos é chute — o sinal força o refino antes do ranque.
  { sinal: 'ESTADO_CORTE', gatilhos: ['pedaco', 'pedacos', 'cortada', 'cortado', 'cortadas', 'cortados', 'carcaca', 'carcacas', 'desossada', 'desossado', 'desossadas', 'desossados', 'miudeza', 'miudezas', 'quarto', 'quartos', 'perna', 'pernas', 'pe', 'asa', 'coxa', 'sobrecoxa', 'inteiro', 'inteira', 'parte', 'partes'], capitulos: ['02', '03'] },
  { sinal: 'ESTADO_CONSERVACAO', gatilhos: ['congelada', 'congelado', 'congeladas', 'congelados', 'refrigerada', 'refrigerado', 'refrigeradas', 'refrigerados', 'resfriada', 'resfriado', 'resfriadas', 'resfriados', 'fresca', 'fresco', 'frescas', 'frescos'], capitulos: ['02', '03'] },
  // --- contexto preditivo v2: químicos / plásticos / madeira / máquinas / instrumentos ---
  // Cada sinal novo carrega capítulos prioritários para o desempate + perguntas
  // de refino. Gatilhos já normalizados (sem acento) e expandidos via
  // SINONIMOS_FISCAIS — a prova continua sendo o match oficial + resolvedor.
  { sinal: 'QUIMICO', gatilhos: ['acido', 'oxido', 'sulfato', 'cloreto', 'nitrato', 'fosfato', 'carbonato', 'hidroxido', 'amonio', 'potassio', 'metanol', 'etanol', 'ureia', 'acetato', 'fertilizante', 'adubo', 'herbicida', 'inseticida', 'fungicida', 'pesticida', 'tinta', 'verniz', 'pigmento', 'corante', 'solvente', 'resina', 'vitamina', 'dipirona', 'paracetamol', 'amoxicilina', 'quimico', 'farmaco'], capitulos: ['28', '29', '30', '31', '32', '33', '34', '38'] },
  { sinal: 'PLASTICO_BORRACHA', gatilhos: ['plastico', 'etileno', 'propileno', 'pvc', 'acrilico', 'silicone', 'borracha', 'latex', 'polietileno', 'embalagem', 'mangueira'], capitulos: ['39', '40'] },
  { sinal: 'MADEIRA_PAPEL', gatilhos: ['madeira', 'tabua', 'compensado', 'fibra', 'palete', 'lenha', 'carvao', 'cortica', 'papel', 'papelao', 'cartolina', 'envelope', 'etiqueta', 'livro', 'revista', 'jornal'], capitulos: ['44', '45', '46', '47', '48', '49'] },
  { sinal: 'MAQUINA_EQUIPAMENTO', gatilhos: ['maquina', 'motor', 'bomba', 'valvula', 'rolamento', 'engrenagem', 'torno', 'fresa', 'prensa', 'furar', 'gerador', 'transformador', 'caldeira', 'compressor', 'trator', 'colheitadeira', 'empilhadeira', 'elevador', 'condicionador', 'roteador', 'servidor', 'transmissao'], capitulos: ['84', '85'] },
  { sinal: 'INSTRUMENTO_OTICA', gatilhos: ['oculos', 'lente', 'armacao', 'termometro', 'microscopio', 'relogio', 'bussola', 'navegacao', 'ortese', 'protese', 'eletrocardiografo', 'ultrassom', 'tomografo', 'piano', 'violao', 'guitarra'], capitulos: ['90', '91', '92'] },
]

/** Expande um token para o vocabulário da nomenclatura (ou `null`). */
export function expandirSinonimo(token: string): string | null {
  return expandirSinonimoFiscal(token) ?? SINONIMOS[token] ?? null
}

/** Extrai os sinais fiscais presentes nos tokens. */
export function extrairSinais(tokens: string[]): SinalFiscal[] {
  const tem = new Set(tokens)
  const out: SinalFiscal[] = []
  for (const regra of REGRAS_SINAL) {
    if (regra.gatilhos.some((g) => tem.has(g))) out.push(regra.sinal)
  }
  // "reprodutor/matriz/para plantio/para ração" implicam o estado do produto
  // mesmo sem a palavra literal ("vivo", "semente"): infere a partir do uso.
  if (out.includes('REPRODUTOR') && !out.includes('VIVO')) out.push('VIVO')
  if (out.includes('SEMENTE_PLANTIO') && !out.includes('CEREAL')) out.push('CEREAL')
  return out
}

/** Monta as variações de consulta (original + expansão com sinônimos). */
export function expandirConsultas(tokensUteis: string[]): string[] {
  const base = tokensUteis.join(' ')
  if (!base) return []
  const consultas = [base]
  const expandidos = tokensUteis.map((t) => expandirSinonimo(t) ?? t)
  const expandida = [...new Set(expandidos.join(' ').split(' '))].join(' ')
  if (expandida && expandida !== base) consultas.push(expandida)
  return [...new Set(consultas)].slice(0, 2)
}

/**
 * Núcleo forte (fallback, NUNCA na rodada primária): os 2 tokens mais
 * específicos (mais longos) quando há 3+. Descrições reais trazem ruído
 * ("linha", "novo", "original") que dilui a margem do determinístico — por
 * isso o núcleo só entra quando a rodada primária + tolerantes deram vazio.
 */
export function expandirConsultasNucleoForte(tokensUteis: string[]): string[] {
  if (tokensUteis.length < 3) return []
  const nucleo = [...tokensUteis].sort((a, b) => b.length - a.length).slice(0, 2).join(' ')
  if (!nucleo) return []
  const out = [nucleo]
  const nucleoExp = [...new Set(nucleo.split(' ').map((t) => expandirSinonimo(t) ?? t))].join(' ')
  if (nucleoExp && nucleoExp !== nucleo) out.push(nucleoExp)
  return [...new Set(out)].slice(0, 2)
}

/** Tokens de condição de risco: saem da consulta-núcleo (o match é no
 *  produto-base), mas os sinais continuam valendo para risco/perguntas. */
const TOKENS_CONDICAO_RISCO = new Set([
  'sal', 'salgado', 'salgada', 'sodio', 'cloreto', 'adicao', 'adicionado',
  'adicionada', 'acrescido', 'acrescida', 'cozido', 'cozida', 'cozidos',
  'cozimento', 'precozido',
])

/**
 * Consultas efetivas: expandidas + variação-núcleo sem tokens de condição
 * de risco. Sem isso, "ração para cães com adição de sal" nunca matcha
 * (a nomenclatura não cita o sal) — o risco continua sinalizado pela análise.
 */
export function consultasEfetivas(analise: AnaliseDescricao): string[] {
  const base = analise.consultasExpandidas
  const nucleo = analise.tokens.filter((t) => !TOKENS_CONDICAO_RISCO.has(t))
  const semRisco = expandirConsultas(nucleo)
  return [...new Set([...base, ...semRisco])].slice(0, 6)
}

/**
 * Tolerância a ruído: descrições reais trazem termos sem correspondente
 * oficial (`raça`, `Nelore` já coberto por sinônimo, `híbrido`). Quando a
 * rodada principal não matcha nada, tenta cada consulta sem 1 token por vez
 * (vale desde 2 termos — "galeto caipira" também precisa de fallback).
 * Retorna as consultas extras e os termos ignorados (para a trilha auditar).
 */
export function consultasTolerantes(consultas: string[]): { consultas: string[]; ignorados: string[] } {
  const extras: string[] = []
  const ignorados: string[] = []
  for (const base of consultas) {
    const termos = base.split(' ').filter(Boolean)
    if (termos.length < 2) {
      // unigrama sem match: tenta o sinônimo sozinho como última bala
      for (const t of termos) {
        const s = expandirSinonimo(t)
        if (s && !consultas.includes(s) && !extras.includes(s)) {
          extras.push(s)
          if (!ignorados.includes(t)) ignorados.push(t)
        }
      }
      continue
    }
    for (const t of termos) {
      const sem = termos.filter((x) => x !== t).join(' ')
      if (sem && !consultas.includes(sem) && !extras.includes(sem)) {
        extras.push(sem)
        if (!ignorados.includes(t)) ignorados.push(t)
      }
    }
    if (extras.length >= 12) break
  }
  return { consultas: extras.slice(0, 12), ignorados }
}

/**
 * Análise completa da descrição + contexto (etapas 1–2 do chain-of-thought
 * do prompt: análise da descrição e aplicação das RGIs).
 */
export function analisarDescricao(entrada: EntradaDescricao): AnaliseDescricao {
  const combinado = [entrada.descricao, entrada.destinacao ?? '', entrada.composicao ?? '', entrada.uso ?? '']
    .join(' ')
    .trim()
  const textoNormalizado = normalizarBusca(combinado)
  const tokensBrutos = tokenizarBusca(combinado)
  const tokens = tokensBrutos.filter((t) => !STOPWORDS.has(t))
  const sinais = extrairSinais(tokens)

  const ambiguidades: string[] = []
  if (sinais.includes('RACAO_ANIMAL') && sinais.includes('SAL_ADICIONADO')) {
    ambiguidades.push(
      'Adição de sal em preparação para alimentação animal pode descaracterizar o enquadramento no benefício — confirmar composição/percentual.',
    )
  }
  if (sinais.includes('HORTICOLA') && sinais.includes('COZIDO')) {
    ambiguidades.push(
      'Produto hortícola cozido pode perder o benefício do Anexo XV (que exige produto não cozido) — confirmar preparo.',
    )
  }
  if (sinais.includes('VIVO') && !sinais.includes('REPRODUTOR') && !sinais.includes('ABATE')) {
    ambiguidades.push('Animal vivo sem destinação clara (reprodução x abate) — a subposição depende do uso.')
  }
  // Funil animal rigoroso: carne sem estado (corte + conservação) não fecha
  // 8 dígitos — 0201 (fresca) × 0202 (congelada) × 0203/0207 (pedaços).
  // Vira pergunta de refino + trava a confiança no máximo em média.
  if (sinais.includes('CARNE') && !sinais.includes('VIVO')) {
    if (!sinais.includes('ESTADO_CONSERVACAO')) {
      ambiguidades.push('Carne sem estado de conservação (fresca/refrigerada x congelada) — a posição muda (ex.: bovina 02.01 x 02.02). Informe se está fresca, refrigerada ou congelada.')
    }
    if (!sinais.includes('ESTADO_CORTE')) {
      ambiguidades.push('Carne sem corte declarado (carcaça x peças x desossada / inteiro x pedaços) — a subposição depende do corte. Informe: carcaça inteira, peças com osso, desossada ou em pedaços?')
    }
  }

  const capitulosPrioritarios = [
    ...new Set(
      REGRAS_SINAL.filter((r) => sinais.includes(r.sinal)).flatMap((r) => r.capitulos),
    ),
  ]

  // Fine-tuning família (RAG + lexical): seção como contexto e exceções que
  // quebram a herança. Seção nunca decide benefício sozinha (ampla demais),
  // mas orienta o desempate lexical e a trilha auditável.
  // `vivo-sem-destinacao` só vale SEM destinação (com REPRODUTOR/ABATE o uso
  // está declarado — sem exceção, sem trava de confiança).
  const secoesPrioritarias = [...new Set(capitulosPrioritarios.map((c) => secaoDoCapitulo(c)?.numero ?? '').filter(Boolean))]
  const excecoesFamiliaAtivas = EXCECOES_FAMILIA.filter((e) => {
    if (e.id === 'vivo-sem-destinacao') {
      return (sinais as string[]).includes('VIVO') && !(sinais as string[]).includes('REPRODUTOR') && !(sinais as string[]).includes('ABATE')
    }
    return e.sinais.some((s) => (sinais as string[]).includes(s))
  }).map((e) => e.id)

  const rgiAplicaveis = ['RGI 1 (texto das posições)', 'RGI 6 (texto das subposições)']
  if (entrada.destinacao?.trim() || entrada.uso?.trim() || excecoesFamiliaAtivas.length) {
    rgiAplicaveis.push('Notas de Seção/Capítulo (uso e destinação)')
  }

  // Proativo sem perder segurança: 1 termo LONGO e específico ("semeadura",
  // "retalho", "celular") já tenta classificar; 1 termo curto/genérico
  // ("sal", "milho", "ovo") continua insuficiente — pede contexto em vez de
  // chutar. Código NCM nunca é insuficiente.
  const unico = tokens.length === 1 ? tokens[0] : ''
  const unicoForte = unico.length >= 5 && !STOPWORDS.has(unico)
  const insuficiente = (tokens.length === 0 || (tokens.length < 2 && !unicoForte)) && !pareceCodigoNcm(combinado)
  return {
    textoNormalizado,
    tokens,
    sinais,
    ambiguidades,
    capitulosPrioritarios,
    secoesPrioritarias,
    excecoesFamiliaAtivas,
    consultasExpandidas: expandirConsultas(tokens),
    rgiAplicaveis,
    insuficiente,
  }
}

/**
 * Perguntas para refinar a classificação quando a descrição é insuficiente
 * ou há condição de risco (etapa 4 do chain-of-thought: validação de contexto).
 */
export function perguntasComplementares(analise: AnaliseDescricao): string[] {
  const perguntas: string[] = []
  if (analise.insuficiente) {
    perguntas.push('Informe a composição ou destinação do produto para melhor precisão (ex.: vivo ou abatido? para plantio, consumo ou ração? camisa de algodão ou sintética? celular smartphone?).')
    return perguntas
  }
  if (analise.sinais.includes('VIVO') && !analise.sinais.includes('REPRODUTOR') && !analise.sinais.includes('ABATE')) {
    perguntas.push('O animal está vivo? Qual a destinação — reprodução (raça pura?), abate/frigorífico ou outro uso?')
  }
  // Funil animal: sem corte/conservação, pede o estado antes de cravar 8 dígitos.
  if ((analise.sinais as string[]).includes('CARNE') && !(analise.sinais as string[]).includes('VIVO')) {
    if (!(analise.sinais as string[]).includes('ESTADO_CONSERVACAO')) {
      perguntas.push('A carne está fresca, refrigerada/resfriada ou congelada? (Ex.: bovina fresca 02.01 x congelada 02.02.)')
    }
    if (!(analise.sinais as string[]).includes('ESTADO_CORTE')) {
      perguntas.push('Qual o corte/apresentação — carcaça/meia-carcaça, peças com osso, desossada, em pedaços ou miudezas? (Ex.: frango inteiro x pedaços 02.07.)')
    }
  }
  if (analise.sinais.includes('RACAO_ANIMAL') && analise.sinais.includes('SAL_ADICIONADO')) {
    perguntas.push('Qual o teor de sal/aditivos e a composição da ração? É preparação completa ou suplemento à base de sal?')
  }
  if (analise.sinais.includes('HORTICOLA')) {
    perguntas.push('O produto está in natura (não cozido)? Qual o estado — fresco, resfriado, congelado ou processado?')
  }
  if (analise.sinais.includes('SEMENTE_PLANTIO')) {
    perguntas.push('É semente para semeadura (plantio) ou grão para consumo/industrialização?')
  }
  // Fine-tuning família: exceção ativa sem pergunta específica acima ganha
  // uma pergunta de confirmação (a herança exige destinação/composição).
  if (analise.excecoesFamiliaAtivas.includes('destinacao-condicional') && !analise.sinais.includes('SEMENTE_PLANTIO')) {
    perguntas.push('Qual a destinação do produto (plantio, consumo, ração, produtor rural, adm. pública)? O benefício da família depende do uso real.')
  }
  if (analise.sinais.includes('VESTUARIO')) {
    perguntas.push('Qual o tecido/composição (algodão, sintético, malha?) e o tipo de peça (camisa, calça, vestido?)?')
  }
  if (analise.sinais.includes('ELETRONICO')) {
    perguntas.push('Qual a função principal do aparelho (telefonia, informática, eletrodoméstico?) e suas características (tensão, capacidade?)?')
  }
  if (analise.sinais.includes('CALCADO')) {
    perguntas.push('Qual o material predominante (couro, têxtil, borracha?) e o tipo (tênis, sapato, bota?)?')
  }
  if (analise.sinais.includes('QUIMICO')) {
    perguntas.push('É princípio ativo, medicamento pronto, fertilizante ou tinta? Informe a composição/concentração e a forma (pó, líquido, comprimido?).')
  }
  if (analise.sinais.includes('PLASTICO_BORRACHA')) {
    perguntas.push('É de plástico ou borracha? Informe o polímero (polietileno, PVC, látex?) e a forma (chapa, tubo, embalagem?).')
  }
  if (analise.sinais.includes('MADEIRA_PAPEL')) {
    perguntas.push('É de madeira ou papel? Informe a espécie/gramatura e a forma (tábua serrada, sulfite, embalagem?).')
  }
  if (analise.sinais.includes('MAQUINA_EQUIPAMENTO')) {
    perguntas.push('Qual a função da máquina (bombear, gerar energia, refrigerar, processar dados?) e suas características (potência, tensão, capacidade?).')
  }
  if (analise.sinais.includes('INSTRUMENTO_OTICA')) {
    perguntas.push('É instrumento médico, ótica ou musical? Informe o uso (diagnóstico, medição, correção visual?) e o tipo.')
  }
  if (!perguntas.length && analise.tokens.length <= 2) {
    perguntas.push('Descreva com mais 1–2 detalhes (material, uso, estado) para a Aurum AI desempatar entre os candidatos.')
  }
  return perguntas
}

/**
 * Nível de confiança (etapa 5 do chain-of-thought).
 *
 * Regras determinísticas e auditáveis:
 * - sem candidato → baixa;
 * - condição de risco (sal, cozido, vivo sem destinação) → no máximo média;
 * - 1 candidato destacado (margem ≥ 30) e descrição com ≥ 2 tokens → alta;
 * - resto → média.
 */
export function calcularConfianca(args: {
  totalCandidatos: number
  margemTopo: number
  tokensUteis: number
  temCondicaoRisco: boolean
}): Confianca {
  if (args.totalCandidatos === 0 || args.tokensUteis < 2) return 'baixa'
  if (args.temCondicaoRisco) return 'media'
  if (args.totalCandidatos === 1 || args.margemTopo >= 30) return 'alta'
  return 'media'
}
