/**
 * Aurum AI — mapa de recursos do sistema (fonte do fine-tuning do chat).
 *
 * Single-source do que a IA "sabe fazer": cada view, tool read-only e
 * exportador, com guardrails explícitos. O orquestrador
 * (`src/application/aurum-ai-chat.ts`) importa este mapa para responder
 * capacidades/ajuda/navegação/relatórios — nada aqui escreve no sistema.
 *
 * Fine-tuning v2: além de classificar e calcular, a IA explica CONCEITOS
 * SIMPLES do sistema (ver `aurum-ai-conhecimento.ts`) e compara anexos/
 * regimes com o motor determinístico. O plano de tool calling vive em
 * `src/application/aurum-ai-tools.ts` (intenção → tool + contexto).
 *
 * Mapeado por varredura multiagente (views + motores + intents + tools).
 */

import type { ViewId } from '@/store/ui'

export interface RecursoView {
  view: ViewId
  rotulo: string
  descricao: string
  /** O que o usuário faz lá (para a IA orientar). */
  acoes: string[]
  /** Leitura permitida ao chat via botão navegar (sem escrita). */
  navegavel: boolean
}

export const VIEWS_AURUM_AI: RecursoView[] = [
  {
    view: 'consulta',
    rotulo: 'Consulta NCM',
    descricao: 'Busque por NCM (8 dígitos), nome do produto ou frase — a IA responde e a base oficial valida (0/1/N).',
    acoes: ['buscar por número', 'buscar por nome', 'descrever com palavras livres', 'adicionar à calculadora', 'salvar como produto'],
    navegavel: true,
  },
  {
    view: 'servicos',
    rotulo: 'Serviços (NBS)',
    descricao: 'Busque por NBS (9 dígitos), nome do serviço ou CNPJ (puxa CNAEs na Receita).',
    acoes: ['buscar NBS manual', 'consultar por CNPJ', 'adicionar à calculadora', 'salvar como produto'],
    navegavel: true,
  },
  {
    view: 'calculadora',
    rotulo: 'Calculadora Tributária',
    descricao: 'Simule IBS/CBS por item com as regras cadastradas (reduções, referência IBS/CBS).',
    acoes: ['adicionar item por NCM ou produto', 'editar qtd/valor', 'ajustar alíquotas de referência', 'revalidar'],
    navegavel: true,
  },
  {
    view: 'simples',
    rotulo: 'Simples Nacional',
    descricao: 'DAS por Anexo I–V + Reforma (Convencional × Híbrido), Fator R, sublimite 3,6M.',
    acoes: ['escolher anexo manual ou por CNPJ/CNAE', 'informar RBT12/receita/folha', 'ver DAS e repartição', 'exportar CSV/JSON/PDF'],
    navegavel: true,
  },
  {
    view: 'lote',
    rotulo: 'Classificação em lote',
    descricao: 'Envie CSV/Excel, revise com a IA e salve como produtos.',
    acoes: ['baixar modelo CSV', 'enviar planilha', 'revisar assistida', 'exportar PDF', 'salvar todos (modal humano)'],
    navegavel: true,
  },
  {
    view: 'nfe',
    rotulo: 'Notas Fiscais (XML)',
    descricao: 'Importe XMLs de NF-e/NFC-e, apure IBS/CBS e gere relatório com IA.',
    acoes: ['importar XMLs', 'filtrar por período/CFOP/fornecedor', 'ver apuração e créditos', 'gerar relatório PDF/CSV'],
    navegavel: true,
  },
  {
    view: 'produtos',
    rotulo: 'Produtos',
    descricao: 'Produtos cadastrados por empresa — o chat cadastra de forma assistida (conferência + SIM explícito) e orienta a exportar.',
    acoes: ['filtrar e paginar', 'exportar CSV/JSON/PDF', 'ver na consulta', 'enviar para calculadora', 'cadastrar via chat com conferência'],
    navegavel: true,
  },
  {
    view: 'auxiliares',
    rotulo: 'Tabelas auxiliares',
    descricao: 'CST, cClassTrib, NCM, CFOP e demais tabelas (edição humana).',
    acoes: ['filtrar', 'criar/editar/excluir (humano)', 'ver referência oficial e auditoria'],
    navegavel: true,
  },
  {
    view: 'legislacao',
    rotulo: 'Legislação',
    descricao: 'Normas dentro do sistema — base federal, decretos e portais.',
    acoes: ['filtrar por sigla/título', 'ler no sistema', 'baixar PDF/imprimir'],
    navegavel: true,
  },
]

/** Tools read-only que o chat pode usar (allowlist fechada — nada escreve).
 * Espelha `PLANO_TOOL_CALLING` em `aurum-ai-tools.ts` (intenção → tool).
 * Exceção assistida: `salvarEmpresa` (ato humano confirmado, idempotente). */
export const TOOLS_AURUM_AI = [
  'consultarNCM (termo + composição/destinação/uso → NCM validado + CST/cClassTrib + template §6)',
  'consultarNBS (termo → NBS validado + CST/cClassTrib; TI genérico com desambiguação CNAE/LC116)',
  'consultarCNPJ (CNPJ com/sem máscara → CNAEs + Anexo Simples + NBS + upsell Simples/Híbrido)',
  'consultarClientes (clientes cadastrados + movimento: qtd notas, base, tributos)',
  'consultarDadosXml (XMLs ↔ clientes: fornecedor que dá crédito, produto de débito/crédito, diferidos, reduções, NCM/CFOP/CST, período, filtros)',
  'gerarRelatorioDados (PDF customizado dos dados no padrão do sistema: timbrado + blocos com dado)',
  'gerarGrafico (MODIFICADOR visual: pizza/barras/linha/tabela 3D sobre qualquer número do motor — DAS×Híbrido, repartição, top produtos/fornecedores, evolução mensal — + sugestão rotineira)',
  'responderTempo (hora/data local: "que horas são?", "que dia é hoje?" — relógio do sistema, sem rede)',
  'calcularContaBasica (matemática PT-BR: soma, subtração, multiplicação, divisão, porcentagem, resto — com follow-up "e mais 5?")',
  'salvarEmpresa (assistido: "salvar essa empresa como cliente" → idempotente, sem duplicar)',
  'verificarCadastroCnpj ("o cnpj X tá cadastrado?" → verifica no banco; se ausente, oferece e só cadastra após confirmação explícita)',
  'cadastrarProdutoAssistido (empresa → SKU → nome → NCM → CFOP/CST-ICMS/PIS/COFINS digitados → conferência → grava após SIM; SKU existente exige SIM ATUALIZAR)',
  'detalharCodigo (NCM/NBS → descrição TEC + reduções + hipótese)',
  'calcularIBSCBS (código + base → IBS/CBS/total, com memória da conversa)',
  'calcularSimples (anexo + RBT12 + receita [+folha] → DAS + Fator R, com memória)',
  'simularComparativo (III×V / Conv×Híb: explica regra ou usa motor com contexto)',
  'explicarConceito (verbetes curados: IBS, CBS, Fator R, DAS, sublimite… — sem cálculo)',
  'gerarRelatorioConversa / gerarRelatorioCalculo (CSV em memória para baixar; entende "desse cálculo" vs "da conversa")',
  'navegarPara (troca de view, sem escrita)',
] as const

/** Conceitos simples que o chat explica sem RAG (verbetes determinísticos). */
export const CONCEITOS_AURUM_AI = [
  'IBS e CBS (o que são, onde ver)',
  'NCM e NBS (códigos, onde consultar)',
  'CST e cClassTrib',
  'Fator R (28%, gap de folha)',
  'Anexo III × Anexo V',
  'DAS (alíquota efetiva)',
  'Sublimite R$ 3,6 mi',
  'Convencional × Híbrido',
  'Relatórios e Simples Nacional',
] as const

/** Escrita proibida ao chat (só UI humana): guardrail documentado.
 * Exceções assistidas (PERMITIDO_ASSISTIDO): sempre com confirmação
 * explícita do usuário vinculada a oferta/conferência no histórico. */
export const PROIBIDO_AURUM_AI = [
  'excluir produto', 'editar tabelas auxiliares', 'importar XML ou planilha',
  'salvar lote', 'reclassificar manualmente', 'trocar empresa ativa',
  'restaurar backup', 'gravar ia_feedback diretamente',
] as const

/** Escrita assistida permitida (com confirmação explícita do usuário). */
export const PERMITIDO_ASSISTIDO_AURUM_AI = [
  'salvar empresa do CNPJ consultado como cliente/emissor (idempotente, sem duplicar)',
  'cadastrar empresa ausente após oferta + SIM explícito (via BrasilAPI, idempotente)',
  'cadastrar produto após conferência + SIM PARA SALVAR (SKU existente exige SIM ATUALIZAR)',
  'preencher tributação antiga do produto (CFOP/CST-ICMS/PIS/COFINS) digitada pelo usuário, dentro do fluxo de cadastro com conferência',
] as const

/** Botão customizado do chat (contrato store → UI). */
export interface BotaoChat {
  rotulo: string
  /** navegar: troca de view · perguntar/detalhar: re-envia · baixar: baixa o relatório · formato: baixa no formato escolhido. */
  acao: 'navegar' | 'perguntar' | 'baixar' | 'detalhar' | 'formato'
  alvo: string
}

export function botoesCapacidades(): BotaoChat[] {
  return [
    { rotulo: '🔍 Consultar NCM', acao: 'navegar', alvo: 'consulta' },
    { rotulo: '🧾 Consultar NBS', acao: 'navegar', alvo: 'servicos' },
    { rotulo: '🧮 Abrir Calculadora', acao: 'navegar', alvo: 'calculadora' },
    { rotulo: '💰 Simples Nacional', acao: 'navegar', alvo: 'simples' },
    { rotulo: 'Tem algum NCM de banana?', acao: 'perguntar', alvo: 'Tem algum NCM de banana?' },
    { rotulo: 'Qual o NBS para aula de inglês?', acao: 'perguntar', alvo: 'Qual o NBS para aula de inglês?' },
  ]
}
