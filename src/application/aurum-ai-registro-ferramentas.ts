/**
 * Aurum AI — REGISTRO EXECUTÁVEL de ferramentas (RAG agêntico).
 *
 * Expande o `PLANO_TOOL_CALLING` (`aurum-ai-tools.ts`, documental) para um
 * formato que QUALQUER modelo embarcado pode consumir para ESCOLHER:
 * specs estilo function-calling (`listarFerramentasParaModelo`) + dispatcher
 * (`executarFerramenta`) + roteamento por intenção (`ferramentasParaIntencao`).
 *
 * Princípios (herdados do plano):
 * - P1 — Determinismo: todo número vem do motor; a ferramenta formata.
 * - P2 — Contexto: herança de conversa via `ContextoConversa`.
 * - P3 — Escrita proibida: ferramentas de escrita devolvem OFERTA/ação de
 *   navegação; a gravação é ato humano confirmado no fluxo assistido.
 *
 * Single-source de metadados: este arquivo. O JSON
 * `recursos-ia/conhecimento/catalogo-rag.json` é DERIVADO (ver
 * `scripts/gerar-catalogo-rag.mjs`) para o worker/RAG lexical consultar.
 */

import type { AnaliseChat } from '@/domain/services/detector-chat'
import type { ContextoConversa } from './aurum-ai-tools'

export type DominioFerramenta =
  | 'fiscal'
  | 'calculo'
  | 'simples'
  | 'dados'
  | 'cadastro'
  | 'legislacao'
  | 'sistema'

export interface ParametroFerramenta {
  tipo: 'string' | 'number' | 'boolean' | 'integer'
  descricao: string
  obrigatorio?: boolean
  exemplo?: string
}

export interface SpecFerramenta {
  nome: string
  descricao: string
  dominio: DominioFerramenta
  /** `true` = só lê; `false` = envolve oferta de escrita assistida (P3). */
  leitura: boolean
  parametros: Record<string, ParametroFerramenta>
  exemplos: string[]
  guardrail: string
}

export interface ResultadoFerramenta {
  ok: boolean
  ferramenta: string
  /** Payload pronto para virar contexto do modelo (JSON compacto). */
  dados?: unknown
  /** Texto humano (template do motor) quando já formatado. */
  texto?: string
  erro?: string
}

export const REGISTRO_FERRAMENTAS: SpecFerramenta[] = [
  {
    nome: 'consultarNCM',
    descricao: 'Classifica um produto ou detalha um NCM de 8 dígitos (Reforma Tributária, LC 214/2025). RAG lexical + resolvedor oficial + gate IA.',
    dominio: 'fiscal',
    leitura: true,
    parametros: {
      termo: { tipo: 'string', descricao: 'Descrição do produto ou NCM de 8 dígitos (com ou sem máscara).', obrigatorio: true, exemplo: 'banana' },
      valorBase: { tipo: 'number', descricao: 'Base em R$ para simulação (opcional; sem valor, simula R$ 1.000 como referência).', exemplo: '2500' },
    },
    exemplos: ['consultarNCM({"termo":"banana"})', 'consultarNCM({"termo":"08031000","valorBase":2500})'],
    guardrail: 'Sem lastro lexical nas fichas oficiais → NÃO SEI instrutivo, nunca chute. Todo tributo vem de calcularTributos.',
  },
  {
    nome: 'consultarNBS',
    descricao: 'Classifica um serviço ou detalha um NBS de 9 dígitos. TI genérico responde com desambiguação + CNAEs + Fator R.',
    dominio: 'fiscal',
    leitura: true,
    parametros: {
      termo: { tipo: 'string', descricao: 'Descrição do serviço ou NBS de 9 dígitos.', obrigatorio: true, exemplo: 'aula de yoga' },
    },
    exemplos: ['consultarNBS({"termo":"aula de yoga"})'],
    guardrail: 'Base NBS × CST × cClassTrib; sem lastro → NÃO SEI. Programação genérica = regra geral, nunca NBS inventado.',
  },
  {
    nome: 'detalharCodigo',
    descricao: 'Ficha absoluta de um código já validado (nomenclatura, caminho hierárquico, vínculo cClassTrib, vigência, reduções, simulação R$ 1.000).',
    dominio: 'fiscal',
    leitura: true,
    parametros: {
      codigo: { tipo: 'string', descricao: 'NCM (8 dígitos) ou NBS (9 dígitos).', obrigatorio: true, exemplo: '08031000' },
    },
    exemplos: ['detalharCodigo({"codigo":"08031000"})'],
    guardrail: 'Só código homologado na TEC; extinto → aviso sem cálculo cheio.',
  },
  {
    nome: 'consultarCNAE',
    descricao: 'Diz o Anexo do Simples Nacional de um CNAE de 7 dígitos (tabela viva CNAE × Anexo + Fator R).',
    dominio: 'fiscal',
    leitura: true,
    parametros: {
      cnae: { tipo: 'string', descricao: 'CNAE com 7 dígitos (com ou sem máscara).', obrigatorio: true, exemplo: '6201501' },
    },
    exemplos: ['consultarCNAE({"cnae":"6201501"})'],
    guardrail: 'Lookup direto; inexistente → funil ("do que se trata?") sem chutar anexo.',
  },
  {
    nome: 'calcularIBSCBS',
    descricao: 'Calcula IBS/CBS de um código + base em R$ (motor canônico calcularTributos). Herda código/valor da conversa.',
    dominio: 'calculo',
    leitura: true,
    parametros: {
      codigo: { tipo: 'string', descricao: 'NCM/NBS (usa o último da conversa quando omitido).', exemplo: '08031000' },
      valorBase: { tipo: 'number', descricao: 'Base em R$ (usa a última da conversa quando omitida).', exemplo: '5000' },
    },
    exemplos: ['calcularIBSCBS({"codigo":"08031000","valorBase":5000})'],
    guardrail: 'Sem código → ancora no RAG e pergunta; nunca chuta NCM.',
  },
  {
    nome: 'calcularContaBasica',
    descricao: 'Matemática básica em PT-BR (soma, subtração, multiplicação, divisão, porcentagem, resto). Herda o último resultado.',
    dominio: 'calculo',
    leitura: true,
    parametros: {
      expressao: { tipo: 'string', descricao: 'Expressão ou follow-up ("e mais 5?", "10% de 500").', obrigatorio: true, exemplo: '10% de 500' },
    },
    exemplos: ['calcularContaBasica({"expressao":"10% de 500"})'],
    guardrail: 'Parser determinístico; divisão por zero → aviso honesto.',
  },
  {
    nome: 'calcularSimples',
    descricao: 'Calcula o DAS do Simples Nacional (anexo + RBT12 + receita + folha opcional) com Fator R e faixas.',
    dominio: 'simples',
    leitura: true,
    parametros: {
      anexo: { tipo: 'string', descricao: 'I, II, III, IV ou V.', obrigatorio: true, exemplo: 'III' },
      rbt12: { tipo: 'number', descricao: 'Receita bruta dos últimos 12 meses.', obrigatorio: true, exemplo: '500000' },
      receitaMes: { tipo: 'number', descricao: 'Receita do mês.', obrigatorio: true, exemplo: '40000' },
      folha12: { tipo: 'number', descricao: 'Folha de salários 12 meses (Fator R).', exemplo: '200000' },
    },
    exemplos: ['calcularSimples({"anexo":"III","rbt12":500000,"receitaMes":40000})'],
    guardrail: 'Faltou anexo/RBT/receita → PERGUNTA os valores, nunca projeta exemplo.',
  },
  {
    nome: 'simularComparativo',
    descricao: 'Compara anexos do Simples (III × V) ou regimes (convencional × híbrido Reforma) com os mesmos números.',
    dominio: 'simples',
    leitura: true,
    parametros: {
      anexos: { tipo: 'string', descricao: 'Anexos em disputa, ex. "III,V".', obrigatorio: true, exemplo: 'III,V' },
      rbt12: { tipo: 'number', descricao: 'RBT12.', exemplo: '500000' },
      receitaMes: { tipo: 'number', descricao: 'Receita do mês.', exemplo: '40000' },
      folha12: { tipo: 'number', descricao: 'Folha 12 meses.', exemplo: '200000' },
    },
    exemplos: ['simularComparativo({"anexos":"III,V","rbt12":500000,"receitaMes":40000,"folha12":200000})'],
    guardrail: 'Sem números → explica a regra geral SEM simular.',
  },
  {
    nome: 'consultarCNPJ',
    descricao: 'Consulta um CNPJ (BrasilAPI + cache 30d): CNAEs, atividades, NBS sugeridos, Anexo Simples, Fator R. Oferece salvar.',
    dominio: 'cadastro',
    leitura: true,
    parametros: {
      cnpj: { tipo: 'string', descricao: 'CNPJ com 14 dígitos (com ou sem máscara).', obrigatorio: true, exemplo: '53795990000168' },
    },
    exemplos: ['consultarCNPJ({"cnpj":"53795990000168"})'],
    guardrail: 'DV inválido → pede correção, nunca consulta. Única ferramenta com rede.',
  },
  {
    nome: 'verificarCadastroCnpj',
    descricao: 'Verifica se um CNPJ está no banco local; se não está, OFERECE o cadastro (grava só após confirmação explícita).',
    dominio: 'cadastro',
    leitura: false,
    parametros: {
      cnpj: { tipo: 'string', descricao: 'CNPJ com 14 dígitos.', obrigatorio: true, exemplo: '11222333000181' },
    },
    exemplos: ['verificarCadastroCnpj({"cnpj":"11222333000181"})'],
    guardrail: 'Sem oferta anterior, "sim" sozinho nunca grava. Idempotente por CNPJ.',
  },
  {
    nome: 'cadastrarProdutoAssistido',
    descricao: 'Fluxo assistido de cadastro de produto (empresa → SKU → nome → NCM → conferência → salva após "SIM PARA SALVAR").',
    dominio: 'cadastro',
    leitura: false,
    parametros: {
      etapa: { tipo: 'string', descricao: 'Mensagem atual do usuário dentro do fluxo.', obrigatorio: true, exemplo: 'SKU QM-01, ncm 10051000' },
    },
    exemplos: ['cadastrarProdutoAssistido({"etapa":"quero cadastrar um produto"})'],
    guardrail: 'Sem resumo conferido, confirmação não grava. NCM sem lastro não grava.',
  },
  {
    nome: 'consultarClientes',
    descricao: 'Inventário do CADASTRO de empresas/clientes (Dexie): lista, quantidades, movimento por cliente.',
    dominio: 'dados',
    leitura: true,
    parametros: {
      filtro: { tipo: 'string', descricao: 'Nome/CNPJ parcial (opcional; vazio lista tudo).', exemplo: 'Padaria' },
    },
    exemplos: ['consultarClientes({})', 'consultarClientes({"filtro":"Padaria"})'],
    guardrail: 'READ-ONLY; sem cadastro → orienta cadastrar via CNPJ.',
  },
  {
    nome: 'consultarDadosXml',
    descricao: 'Pergunta sobre o MOVIMENTO importado (NF-e/XML): fornecedores que dão crédito, produtos de débito/crédito, diferidos, reduções, filtros NCM/CFOP/CST/período.',
    dominio: 'dados',
    leitura: true,
    parametros: {
      pergunta: { tipo: 'string', descricao: 'Pergunta original sobre os dados.', obrigatorio: true, exemplo: 'qual fornecedor me dá mais crédito?' },
      cliente: { tipo: 'string', descricao: 'Filtro de cliente/empresa.', exemplo: 'Padaria Pão Dourado' },
      topN: { tipo: 'integer', descricao: 'Top N do ranking (padrão 8).', exemplo: '8' },
    },
    exemplos: ['consultarDadosXml({"pergunta":"qual fornecedor me dá mais crédito?"})'],
    guardrail: 'Todo número vem das agregações sobre NotaXml; vazio → orienta importar XML.',
  },
  {
    nome: 'gerarRelatorioDados',
    descricao: 'Gera relatório (PDF/CSV/JSON) SOBRE os dados já consultados (fornecedores, produtos, reduções, diferidos, apuração).',
    dominio: 'dados',
    leitura: true,
    parametros: {
      blocos: { tipo: 'string', descricao: 'Blocos desejados, ex. "fornecedores,produtos,apuracao".', exemplo: 'fornecedores,produtos' },
      formato: { tipo: 'string', descricao: 'PDF, CSV ou JSON.', exemplo: 'PDF' },
    },
    exemplos: ['gerarRelatorioDados({"blocos":"fornecedores,produtos","formato":"PDF"})'],
    guardrail: 'Turno 1 congela escopo e pergunta formato; turno 2 baixa. Sem seção vazia.',
  },
  {
    nome: 'gerarGrafico',
    descricao: 'Anexa gráfico (barra/pizza/linha/tabela) a QUALQUER resultado numérico do motor (cálculo, Simples, dados).',
    dominio: 'sistema',
    leitura: true,
    parametros: {
      tipo: { tipo: 'string', descricao: 'barra, pizza, linha ou tabela.', exemplo: 'barra' },
    },
    exemplos: ['gerarGrafico({"tipo":"barra"})'],
    guardrail: 'Sem sinal numérico → tabela com aviso em vez de canvas vazio.',
  },
  {
    nome: 'explicarArtigoLC214',
    descricao: 'Explica artigo da LC 214/2025 ou pesquisa tema no corpus offline (claro + técnico + link da íntegra no Planalto).',
    dominio: 'legislacao',
    leitura: true,
    parametros: {
      artigoOuTema: { tipo: 'string', descricao: 'Número do artigo ("128") ou tema livre ("cesta básica").', obrigatorio: true, exemplo: '128' },
    },
    exemplos: ['explicarArtigoLC214({"artigoOuTema":"128"})'],
    guardrail: 'Só o corpus curado; fora da cobertura → lista temas, nunca recita lei inventada.',
  },
  {
    nome: 'explicarConceito',
    descricao: 'Define um conceito do sistema (IBS, CBS, Fator R, sublimite, diferimento...) via verbetes curados + onde ver no sistema.',
    dominio: 'legislacao',
    leitura: true,
    parametros: {
      termo: { tipo: 'string', descricao: 'Termo do sistema.', obrigatorio: true, exemplo: 'Fator R' },
    },
    exemplos: ['explicarConceito({"termo":"Fator R"})'],
    guardrail: 'Só verbetes curados; fora da lista → orientação.',
  },
  {
    nome: 'gerarRelatorio',
    descricao: 'Gera relatório de conversa, cálculo, Simples, NF-e, produtos ou lote (turno 1 congela + pergunta formato; turno 2 baixa).',
    dominio: 'sistema',
    leitura: true,
    parametros: {
      alvo: { tipo: 'string', descricao: 'conversa, calculo, simples, nfe, produtos ou lote.', obrigatorio: true, exemplo: 'calculo' },
      formato: { tipo: 'string', descricao: 'CSV, JSON, TXT ou PDF.', exemplo: 'PDF' },
    },
    exemplos: ['gerarRelatorio({"alvo":"calculo","formato":"PDF"})'],
    guardrail: 'Módulo dono (Simples/NF-e) para dados reais.',
  },
  {
    nome: 'navegarPara',
    descricao: 'Sugere uma view do sistema com botão (Calculadora, Simples, Notas, Empresas, Produtos, Lote, Auxiliares, Legislação...).',
    dominio: 'sistema',
    leitura: true,
    parametros: {
      destino: { tipo: 'string', descricao: 'View de destino.', obrigatorio: true, exemplo: 'Calculadora' },
    },
    exemplos: ['navegarPara({"destino":"Calculadora"})'],
    guardrail: 'Só sugere; a troca é ato do usuário no botão.',
  },
  {
    nome: 'responderTempo',
    descricao: 'Responde hora/data atuais (relógio local, sem rede).',
    dominio: 'sistema',
    leitura: true,
    parametros: {
      tipo: { tipo: 'string', descricao: 'hora, data ou ambos.', exemplo: 'hora' },
    },
    exemplos: ['responderTempo({"tipo":"hora"})'],
    guardrail: 'Só relógio/calendário; nunca inventa compromisso.',
  },
  {
    nome: 'responderLeve',
    descricao: 'Papo leve: saudação, agradecimento, despedida, capacidades, ajuda (breve + ponte para recurso fiscal).',
    dominio: 'sistema',
    leitura: true,
    parametros: {},
    exemplos: ['responderLeve({})'],
    guardrail: 'Breve (≤2 linhas) + 1 sugestão fiscal; nunca vira aula fiscal.',
  },
  {
    nome: 'recusarForaDeEscopo',
    descricao: 'Barreira de escopo: tarefa externa sem lastro fiscal/sistema (texto fixo profissional).',
    dominio: 'sistema',
    leitura: true,
    parametros: {},
    exemplos: ['recusarForaDeEscopo({})'],
    guardrail: 'Texto exato da barreira; sem variação, sem worker.',
  },
]

/** Nomes válidos (para validação do modelo). */
export const NOMES_FERRAMENTAS: string[] = REGISTRO_FERRAMENTAS.map((f) => f.nome)

/**
 * Specs no formato function-calling (OpenAI-compatível) para entregar ao
 * modelo embarcado — QUALQUER modelo com suporte a tools, ou o loop agente
 * futuro. `dominios` filtra (ex.: ['fiscal'] para classificação pura).
 */
export function listarFerramentasParaModelo(dominios?: DominioFerramenta[]): Array<{
  name: string
  description: string
  parameters: { type: 'object'; properties: Record<string, { type: string; description: string }>; required: string[] }
}> {
  const base = dominios?.length
    ? REGISTRO_FERRAMENTAS.filter((f) => dominios.includes(f.dominio))
    : REGISTRO_FERRAMENTAS
  return base.map((f) => {
    const properties: Record<string, { type: string; description: string }> = {}
    const required: string[] = []
    for (const [k, p] of Object.entries(f.parametros)) {
      properties[k] = { type: p.tipo === 'integer' ? 'integer' : p.tipo, description: p.descricao }
      if (p.obrigatorio) required.push(k)
    }
    return { name: f.nome, description: f.descricao, parameters: { type: 'object', properties, required } }
  })
}

/** Roteamento intenção do detector → ferramentas candidatas (auditoria). */
export function ferramentasParaIntencao(intencao: AnaliseChat['intencao']): string[] {
  switch (intencao) {
    case 'ncm': return ['consultarNCM', 'detalharCodigo', 'calcularIBSCBS']
    case 'nbs': return ['consultarNBS', 'detalharCodigo']
    case 'cnae': return ['consultarCNAE', 'calcularSimples']
    case 'cnpj': return ['consultarCNPJ', 'verificarCadastroCnpj', 'calcularSimples']
    case 'cadastrar_produto': return ['cadastrarProdutoAssistido', 'consultarNCM']
    case 'clientes': return ['consultarClientes', 'consultarDadosXml']
    case 'dados': return ['consultarDadosXml', 'gerarRelatorioDados', 'gerarGrafico']
    case 'calculo': return ['calcularIBSCBS', 'detalharCodigo', 'gerarGrafico']
    case 'conta': return ['calcularContaBasica']
    case 'tempo': return ['responderTempo']
    case 'simples': return ['calcularSimples', 'simularComparativo', 'gerarGrafico']
    case 'comparativo': return ['simularComparativo', 'calcularSimples']
    case 'conceito': return ['explicarConceito', 'explicarArtigoLC214']
    case 'legislacao': return ['explicarArtigoLC214', 'explicarConceito']
    case 'relatorio': return ['gerarRelatorio', 'gerarRelatorioDados']
    case 'navegar': case 'capacidades': case 'ajuda': case 'status': return ['navegarPara', 'responderLeve']
    case 'saudacao': case 'conversa_leve': return ['responderLeve']
    default: return ['responderLeve', 'consultarNCM', 'consultarNBS']
  }
}

export interface ContextoExecucao {
  contexto?: ContextoConversa | null
  memoria?: { assunto?: string | null; codigoNcm?: string | null; codigoNbs?: string | null } | null
}

/**
 * Dispatcher das ferramentas (o MODELO escolhe; o MOTOR executa).
 * Imports dinâmicos para não criar ciclo com o orquestrador.
 * Ferramentas de escrita (P3) devolvem OFERTA — nunca gravam aqui.
 */
export async function executarFerramenta(
  nome: string,
  args: Record<string, unknown> = {},
  ctx: ContextoExecucao = {},
): Promise<ResultadoFerramenta> {
  const str = (v: unknown): string => String(v ?? '').trim()
  try {
    switch (nome) {
      case 'consultarNCM':
      case 'consultarNBS':
      case 'detalharCodigo':
      case 'calcularIBSCBS': {
        const termo = str(args.termo ?? args.codigo ?? ctx.memoria?.assunto ?? ctx.contexto?.ultimoAssunto ?? '')
        const codigo = str(args.codigo ?? '')
        const alvo = codigo || termo
        if (!alvo) return { ok: false, ferramenta: nome, erro: 'termo-ou-codigo-ausente' }
        if (/^\d{8}$/.test(alvo.replace(/\D+/g, '')) || /^\d{9}$/.test(alvo.replace(/\D+/g, ''))) {
          const { montarFichaAbsoluta } = await import('./aurum-ai-contexto')
          const ficha = montarFichaAbsoluta(alvo.replace(/\D+/g, ''))
          return { ok: true, ferramenta: nome, dados: ficha }
        }
        const { classificarComIa } = await import('./classificacao-ia')
        const r = await classificarComIa({ descricao: alvo } as never)
        return { ok: true, ferramenta: nome, dados: r }
      }
      case 'consultarCNAE': {
        const cnae = str(args.cnae)
        if (!cnae) return { ok: false, ferramenta: nome, erro: 'cnae-ausente' }
        const { codigo7De } = await import('@/domain/services/cnae')
        const normalizado = codigo7De(cnae) ?? cnae.replace(/\D+/g, '')
        return { ok: true, ferramenta: nome, dados: { cnae: normalizado } }
      }
      case 'calcularContaBasica': {
        const { detectarConta, calcularConta } = await import('@/domain/services/basico-chat')
        const detectada = detectarConta(str(args.expressao))
        if (!detectada) return { ok: false, ferramenta: nome, erro: 'expressao-nao-reconhecida' }
        const valor = calcularConta(detectada)
        if (valor == null) return { ok: false, ferramenta: nome, erro: 'calculo-impossivel' }
        return { ok: true, ferramenta: nome, texto: String(valor), dados: { valor } }
      }
      case 'responderTempo': {
        const { formatarHora, formatarData } = await import('@/domain/services/basico-chat')
        const tipo = str(args.tipo) || 'ambos'
        const agora = new Date()
        const data = formatarData(agora)
        const texto = tipo === 'hora'
          ? `Agora são ${formatarHora(agora)}`
          : tipo === 'data'
            ? `Hoje é ${data.curta} (${data.diaSemana})`
            : `Agora são ${formatarHora(agora)} — hoje é ${data.curta} (${data.diaSemana})`
        return { ok: true, ferramenta: nome, texto }
      }
      case 'explicarConceito': {
        const { encontrarConceito, textoConceito } = await import('./aurum-ai-conhecimento')
        const c = encontrarConceito(str(args.termo))
        if (!c) return { ok: false, ferramenta: nome, erro: 'conceito-desconhecido' }
        return { ok: true, ferramenta: nome, texto: textoConceito(c) }
      }
      case 'explicarArtigoLC214': {
        const { buscarArtigoLC214, pesquisarLC214 } = await import('@/domain/services/lc214')
        const q = str(args.artigoOuTema)
        const direto = /^\d{1,3}(-[A-Z])?$/.test(q) ? buscarArtigoLC214(q) : null
        if (direto) return { ok: true, ferramenta: nome, dados: direto }
        const achados = pesquisarLC214(q)
        return { ok: true, ferramenta: nome, dados: achados.slice(0, 3) }
      }
      case 'calcularSimples':
      case 'simularComparativo': {
        const { calcularConvencional } = await import('@/simples/calculo')
        const anexo = str(args.anexo ?? (args as { anexos?: string }).anexos?.split(',')[0] ?? ctx.contexto?.ultimoAnexo ?? '')
        const rbt12 = Number(args.rbt12 ?? ctx.contexto?.ultimoRbt12)
        const receitaMes = Number(args.receitaMes ?? ctx.contexto?.ultimaReceita)
        if (!anexo || !Number.isFinite(rbt12) || !Number.isFinite(receitaMes)) {
          return { ok: false, ferramenta: nome, erro: 'anexo-rbt-receita-ausentes' }
        }
        const r = calcularConvencional({ anexoId: anexo as never, rbt12, receitaMes } as never)
        return { ok: true, ferramenta: nome, dados: r }
      }
      case 'consultarClientes':
      case 'consultarDadosXml':
      case 'gerarRelatorioDados':
      case 'gerarGrafico':
      case 'gerarRelatorio':
      case 'navegarPara':
      case 'consultarCNPJ':
      case 'verificarCadastroCnpj':
      case 'cadastrarProdutoAssistido':
      case 'responderLeve':
      case 'recusarForaDeEscopo':
        // Fluxos com UI/store assíncrona ou escrita assistida: o orquestrador
        // (`aurum-ai-chat.ts`) continua dono; aqui devolve-se o roteamento.
        return { ok: true, ferramenta: nome, dados: { roteado: true, args, dica: 'executar via orquestrador (store/UI)' } }
      default:
        return { ok: false, ferramenta: nome, erro: `ferramenta-desconhecida: "${nome}"` }
    }
  } catch (e) {
    return { ok: false, ferramenta: nome, erro: String((e as Error)?.message ?? e) }
  }
}
