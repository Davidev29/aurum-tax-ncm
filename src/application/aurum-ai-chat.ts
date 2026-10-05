/**
 * Aurum AI Chat — orquestrador conversacional com RAG nativo e tools locais.
 *
 * Identidade via UI (selo/bolha); no texto, o nome aparece só em
 * saudação/capacidades/ajuda/genérico/fora-de-escopo/erro. Respostas
 * operacionais (NCM/NBS/cálculo/Simples/relatório/navegação/conceito/
 * comparativo/dados) são diretas, sem ecoar a pergunta do usuário.
 *
 * Thinking honesto: `pensamento.etapas` descreve o que o orquestrador já
 * fez (intenção → enriquecer → RAG → ficha → validar → calcular). O modelo
 * local só ordena candidatos; o texto é template validado.
 *
 * Tools read-only (allowlist — NADA escreve, ver `aurum-ai-tools.ts`):
 * consultarNCM, consultarNBS, detalharCodigo, calcularIBSCBS (com memória),
 * calcularSimples (com memória), calcularContaBasica + responderTempo
 * (básico PT-BR: hora/data e soma/subtração/multiplicação/divisão/
 * porcentagem/resto, com follow-up "e mais 5?"), simularComparativo, explicarConceito,
 * consultarClientes + consultarDadosXml (Dexie local: cliente ↔ XML,
 * fornecedor-crédito, produto débito/crédito, diferidos, reduções, filtros),
 * gerarRelatorioDados (PDF customizado dos DADOS no padrão do sistema),
 * gerarGrafico (MODIFICADOR visual: pizza/barras/linha/tabela 3D sobre
 * qualquer número do motor + sugestão rotineira — ver `aurum-ai-graficos.ts`),
 * relatórios em memória (entende "desse cálculo" vs "da conversa"),
 * navegarPara (só sugere a view; a troca é ato do usuário no botão).
 */

import { calibrarConfiancaFinal, fmtConfiancaAurumAI, nivelDeConfianca } from '@/domain/aurum-ai'
import { REF_DEFAULT } from '@/domain/constants'
import { buscarArtigoLC214, disponibilidadeLC214, explicarArtigoLC214, extrairNumeroArtigoLC214, pesquisarLC214 } from '@/domain/services/lc214'
import { detectarForaDeEscopo, MENSAGEM_FORA_DE_ESCOPO, ehConversaLeve, temSinalFiscal } from '@/domain/services/escopo-consulta'
import { detectarIntencaoChat, classificarDominio, extrairCnae, extrairNucleoBusca, extrairSlotsProduto, type AnaliseChat } from '@/domain/services/detector-chat'
import { extrairSlotsSimples, extrairTodosValores, aplicarEdicaoSimples, resolverFolhaPercentual, historicoSlotsSimples, anexoExigeFolha, ehPedidoOutroAnexoAmbiguo, resolverAnexoPorReferencia, observarIntencaoSimples } from '@/domain/services/valores-chat'
import { inferirAnexoPorAtividade } from '@/domain/services/anexo-inferencia'
import { codigo7De, exigePerguntaFatorR, rotuloAnexoSimples } from '@/domain/services/cnae'
import { fmtCnae } from '@/infrastructure/base/normalizacao'
import { calcularTributos } from '@/domain/services/calculo'
import { fmtCnpj, fmtMoeda, fmtNcm, fmtNbs, norm } from '@/domain/services/format'
import { normalizarBusca } from '@/domain/services/busca-texto'
import { validarCnpj, mensagemCnpjInvalido } from '@/domain/services/cnpj'
import { classificarComIa, type ResultadoGateIa } from '@/application/classificacao-ia'
import { classificarComIaServicos, type ResultadoGateIaServicos } from '@/application/classificacao-ia-servicos'
import { resolverClassificacoes, resolverClassificacoesNbs } from '@/infrastructure/base/classificacao-repo'
import { montarCSV } from '@/infrastructure/exporters/relatorios'
import { calcularConvencional, calcularHibrido, debitoCBS, fatorR, type ResultadoConvencional, type ResultadoHibrido, type RegraDebitoCBS } from '@/simples/calculo'
import { rotuloRegraCredito, rotuloRegraDebito } from '@/domain/services/percentual-chat';
import { ANEXOS_SIMPLES, CBS_REF_PADRAO, type AnexoSimplesId } from '@/simples/tabelas'
import {
  acumularDespesas,
  detectarModoExploratorio,
  detectarQuerHibrido,
  detectarQuerTodosAnexos,
  detectarRegraDebitoReceita,
  detectarSemEmpresa,
  ehReducaoPorTipo,
  extrairCbsRef,
  extrairDespesasDoTexto,
  contextoHibridoAtivo,
  mencionaReducaoReceita,
  montarRelatorioSimples,
  orquestrarTodosAnexos,
  reconstruirEstadoColeta,
  textoColetaEtapa,
  textoExploratorioCompleto,
  DESPESAS_REFERENCIA,
  totalCreditosChat,
  type DadosSimplesChat,
  type DespesaChat,
} from './aurum-ai-simples-exploratorio'
import { VIEWS_AURUM_AI, botoesCapacidades, type BotaoChat } from './aurum-ai-recursos'
import { encontrarConceito, textoConceito } from './aurum-ai-conhecimento'
import { precisaCaminhoCompleto, sugestoesParaPadrao } from './aurum-ai-fluxos'
import { contextoBaseDoTurno, refinarIntencaoComContexto, anexarPedidoGrafico } from './aurum-ai-tools'
import {
  NOME_MASCOTE,
  calcularConta,
  contemApelido,
  detectarConta,
  detectarContaFollowUp,
  detectarTempo,
  expressaoConta,
  formatarData,
  formatarHora,
  formatarNumeroConta,
} from '@/domain/services/basico-chat'
import {
  alvoGraficoCalculo,
  alvoGraficoDados,
  alvoGraficoSimples,
  alvoGraficoSimplesTodos,
  aplicarTipoPreferido,
  detectarPedidoGrafico,
  graficoCalculoIBS,
  graficoClientes,
  graficoComparativoAnexos,
  graficoConvHibTodosAnexos,
  graficoConvXHibrido,
  graficoReparticaoDAS,
  planejarGraficoDados,
  sugestaoGrafico,
  type GraficoChat,
} from './aurum-ai-graficos'
import {
  carregarPerfilMemoria,
  declararNomeMemoria,
  ehPerguntaMemoria,
  extrairNomeDeTexto,
  extrairSinalAprendizado,
  fatoAprendidoPara,
  primeiroNome,
  registrarAprendizadoTermo,
  registrarTurnoMemoria,
  type PerfilMemoria,
} from './aurum-ai-memoria'
import {
  carregarMemoriaSistema,
  mesclarContextoComArtefato,
  type MemoriaSistema,
} from './aurum-ai-artefatos'
import { conversarLivre } from './aurum-ai-livre'

export type { BotaoChat }

export type FormatoRelatorio = 'csv' | 'json' | 'txt' | 'pdf'
export type BaseRelatorio = 'conversa' | 'calculo' | 'dados' | 'simples'

export interface RelatorioChat {
  nome: string
  conteudo: string
  mime: string
  tamanho: number
}

export interface DadosConversa {
  historico: MensagemHistorico[]
  pergunta: string
  geradoEm: string
}

export interface DadosCalculo {
  codigo: string
  base: number
  ibs: number
  cbs: number
  total: number
}

/** Payload do relatório de DADOS (congelado no turno 1, baixado no turno 2). */
export interface DadosConsulta {
  titulo: string
  pergunta: string
  escopo: string
  geradoEm: string
  /** Agregações já calculadas do escopo (números do motor, nunca da conversa). */
  payload: import('./aurum-ai-dados-pdf').DadosRelatorioIA
}

export interface RelatorioOpcoes {
  base: BaseRelatorio
  dados: DadosConversa | DadosCalculo | DadosConsulta | DadosSimplesChat
}

export { type DadosSimplesChat }
export { montarRelatorioSimples } from './aurum-ai-simples-exploratorio'

/** Builder do relatório do Simples exploratório (CSV/JSON/TXT em memória; PDF sai pelo módulo Simples). */
export function montarRelatorioSimplesChat(d: DadosSimplesChat, formato: FormatoRelatorio): RelatorioChat {
  if (formato === 'pdf') {
    return { nome: `aurum-ai-simples-${new Date().toISOString().slice(0, 10)}.pdf`, conteudo: '', mime: 'application/pdf', tamanho: 0 }
  }
  return montarRelatorioSimples(d, formato)
}

export interface PensamentoChat {
  etapas: string[]
  detalhe?: string
  ms?: number
}

export interface RespostaChat {
  texto: string
  codigo?: string | null
  tipoCodigo?: 'ncm' | 'nbs' | 'cnae' | null
  confianca: number
  nivel: 'alta' | 'media' | 'baixa'
  fontes: string[]
  /**
   * `true` quando a resposta é 100% match com dado do sistema (NCM/NBS/CNAE
   * exato validado na base). Nesse caso o texto NUNCA traz "nível de
   * confiança" — ou existe ou não existe.
   */
  exato?: boolean
  /** Turno 2: payload pronto para baixar (quando o formato já foi escolhido). */
  relatorio?: RelatorioChat | null
  /** Turno 1: pergunta o formato (3 botões), sem payload ainda. */
  relatorioOpcoes?: RelatorioOpcoes | null
  /** Artefato visual (gráfico 3D elegante ou tabela customizada) na bolha. */
  grafico?: GraficoChat | null
  sugestoes?: string[]
  botoes?: BotaoChat[]
  pensamento?: PensamentoChat | null
  /** IA-07: `true` quando o texto final foi verbalizado pelo modelo (agente). */
  viaModelo?: boolean
}

export interface MensagemHistorico {
  papel: 'user' | 'assistant'
  texto: string
}

/** Intenções de orientação/conhecimento simples — nunca passam pela barreira de escopo. */
const INTENCOES_ORIENTACAO = new Set(['capacidades', 'ajuda', 'navegar', 'status', 'tempo', 'conta', 'saudacao', 'conversa_leve', 'conceito', 'comparativo', 'legislacao'])

/** Fora do escopo: nome mantido (caso relevante) + profissional da área. */
export const MENSAGEM_FORA_DE_ESCOPO_CHAT =
  `Esse tema foge do meu escopo. ${MENSAGEM_FORA_DE_ESCOPO} Sou a Aurum AI, assistente fiscal deste sistema (NCM, NBS, IBS/CBS, Simples Nacional e seus dados: clientes, XMLs, fornecedores, produtos). ` +
  `Para esse assunto, procure um profissional da área em que ele atua.`

/* ------------------------------------------------- slot com suposição -- */

function resolverSlot<T>(bruto: T | null | undefined, padrao: T, rotulo: string, exemplo: string): { valor: T; assumido: boolean; aviso: string | null } {
  if (bruto != null && bruto !== '' && !(typeof bruto === 'number' && !(bruto > 0))) {
    return { valor: bruto as T, assumido: false, aviso: null }
  }
  return {
    valor: padrao,
    assumido: true,
    aviso: `Faltou ${rotulo} — usando ${exemplo} como exemplo. Me diga o valor certo que recalculo na hora.`,
  }
}

function ultimoCodigoHistorico(historico: MensagemHistorico[]): string | null {
  for (let i = historico.length - 1; i >= 0; i--) {
    const texto = historico[i].texto
    // Aceita corrido (08031000) e formatado (0803.10.00) — a assistente
    // sempre formata, então só o corrido perdia o contexto ("só tem esse?").
    const f = texto.match(/\b\d{4}\.\d{2}\.\d{2}\b/)
    if (f) return f[0].replace(/\D+/g, '')
    const m = texto.match(/\b\d{8}\b/)
    if (m) return m[0]
  }
  return null
}

/**
 * Compara dois assuntos em texto (não dígitos): `norm()` só guarda dígitos,
 * então `norm("danone") === norm("só tem esse") === ""` e o re-ancoramento
 * do follow-up nunca disparava — era a causa do "só tem esse?" classificar
 * o andaime em vez de "danone".
 */
function assuntosDiferem(a: string, b: string): boolean {
  const na = normalizarBusca(a)
  const nb = normalizarBusca(b)
  return na !== nb
}

function pensar(etapas: Array<string | false | null | undefined>, detalhe?: string, ms?: number): PensamentoChat {
  return { etapas: etapas.filter(Boolean) as string[], detalhe, ms }
}

const PENSAR = {
  entender: 'Entendendo…',
  enriquecer: 'Enriquecendo busca…',
  consultar: (n: number) => (n > 0 ? `Consultando base oficial… (${n} itens)` : 'Consultando base oficial…'),
  analisar: 'Analisando ficha…',
  validar: 'Validando…',
  calcular: 'Calculando…',
  calcularDas: 'Calculando DAS…',
} as const

/* ------------------------------------ variação (anti-resposta-igual) --
 * Respostas sociais/orientação NÃO podem ser template único: o mesmo "oi"
 * precisa soar vivo a cada vez, sem quebrar guardrails. Cada pool abaixo
 * mantém as ÂNCORAS que os testes e a auditoria exigem (nome da IA, botões,
 * ponte para o sistema) e varia só abertura/fecho e ordem das sugestões.
 * Round-robin por chave: determinístico, sem LLM, sem aleatoriedade que
 * quebre teste. Operacional (NCM/cálculo/Simples) continua estável de
 * propósito — número e formato não variam, só o papo varia.
 */
const contadoresVariacao: Record<string, number> = {}
function variar<T>(chave: string, opcoes: readonly T[]): T {
  const i = contadoresVariacao[chave] ?? 0
  contadoresVariacao[chave] = i + 1
  return opcoes[i % opcoes.length]
}

/** Saudação contextual: período do dia + continuidade da conversa. */
function prefixoTemporal(): string {
  const h = new Date().getHours()
  if (h >= 5 && h < 12) return 'Bom dia'
  if (h >= 12 && h < 18) return 'Boa tarde'
  return 'Boa noite'
}

/* ------------------------------------------------------- orientação -- */

function responderCapacidades(pergunta = ''): RespostaChat {
  const linhas = VIEWS_AURUM_AI.map((v) => `• **${v.rotulo}**: ${v.descricao}`).join('\n')
  const chamouApelido = contemApelido(pergunta)
  const abertura = variar('capacidades-abertura', [
    `Sou a Aurum AI${chamouApelido ? ` (pode me chamar de ${NOME_MASCOTE}! ✨)` : ''}, assistente fiscal deste sistema. Uso todos os recursos do app (só não altero seus dados):\n\n`,
    `Sou a Aurum AI${chamouApelido ? ` — isso mesmo, a ${NOME_MASCOTE}!` : ''} — moro neste sistema e conheço cada canto dele (só não mexo nos seus dados, isso é com você):\n\n`,
  ])
  return {
    texto:
      `${abertura}` +
      `${linhas}\n\n` +
      `Também:\n` +
      `• Classifico NCM de produtos e NBS de serviços com RAG nativo na base oficial\n` +
      `• Calculo IBS/CBS e Simples (DAS, Fator R) sem sair do chat — entendo o contexto ("e para 2 mil?") e o escopo da empresa ("quanto fica esse queijo da Padaria Y?" usa o NCM real dela)\n` +
      `• Faço conta rápida: soma, subtração, multiplicação, divisão, porcentagem e resto ("quanto é 2+3?", "10% de 500") — e continuo de onde paramos ("e mais 5?")\n` +
      `• Digo a hora e a data de hoje ("que horas são?", "que dia é hoje?")\n` +
      `• Consulto seus dados por empresa: digo DE QUAL empresa estou falando, localizo o produto específico dela nos XMLs e diferencio cálculo de consulta\n` +
      `• Explico a LC 214/2025 sem rede (corpus offline): pesquiso o artigo ("explica o art. 128") ou o tema ("onde a lei fala de diferimento?") no molde claro + técnico, com link da íntegra\n` +
      `• Cadastro assistido (só com sua confirmação explícita): verifico se um CNPJ está cadastrado e cadastro se você confirmar; cadastro produto com conferência (empresa → SKU → nome → NCM → trib. antiga) e gravo após o SIM\n` +
      `• Consulto seus dados: clientes, XMLs, fornecedor que dá crédito, produto de débito/crédito, diferidos, reduções, filtros\n` +
      `• Gero gráficos 3D e tabelas customizadas de qualquer número: pizza/barras/linha (DAS × Híbrido, repartição, top produtos, evolução mensal) — é só pedir "mostra em gráfico"\n` +
      `• Explico conceitos simples (IBS, Fator R, sublimite, III × V) e comparo anexos/regimes\n` +
      `• Gero relatório da conversa/cálculo — você escolhe CSV, JSON ou TXT\n` +
      `• Gero PDF customizado dos seus dados (estrutura proposta no chat, layout do sistema)\n\n` +
      `${variar('capacidades-fecho', [
        `Toque num botão abaixo ou digite sua dúvida.`,
        `Me diz o que precisa — ou já toca num botão para começar.`,
      ])}`,
    confianca: 1,
    nivel: 'alta',
    fontes: [],
    sugestoes: ['Tem algum NCM de banana?', 'Quanto é 10% de 500?', 'Que horas são?'],
    botoes: botoesCapacidades(),
    pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Orientação: capacidades → navegarPara'),
  }
}

function responderAjuda(pergunta: string): RespostaChat {
  const n = pergunta.toLowerCase()
  let dica = 'Digite sua dúvida com 1–2 detalhes (material, uso, estado) que eu consulto a base oficial na hora.'
  if (/ncm|produto|classifica/.test(n)) dica = 'Para consultar um NCM: diga o produto ("tem ncm de banana?") ou o código ("08031000"). Com composição ("camiseta 100% algodão", "composição: ...") eu cruzo material + uso. Detalhe CST/cClassTrib e simulo IBS/CBS.'
  else if (/nbs|serviço|servico|atividade|cnpj|cnae/.test(n)) dica = 'Para NBS/CNPJ/CNAE: descreva o serviço ("nbs para programação de computadores?"), diga o CNAE direto ("CNAE 6201-5/01 qual anexo?") ou diga "Quais atividades o CNPJ 53.795.990/0001-68 tem?" (com ou sem formatação). Listo CNAEs + Anexo do Simples + NBS e já ofereço simular o DAS e salvar como cliente.'
  else if (/calcul|ibs|cbs|simula/.test(n)) dica = 'Para calcular: diga valor + código (ex.: "quanto fica R$ 2.500 no NCM 0803.10.00?"). Sem valor, uso R$ 1.000 como exemplo e aviso.'
  else if (/simples|das|anexo|rbt/.test(n)) dica = 'Para o Simples: diga anexo + RBT12 + receita (ex.: "DAS Anexo III, RBT12 500 mil, receita 40 mil"). Sem os dados, projeto com exemplo e aviso.'
  else if (/xml|nota fiscal|fornecedor|cliente|diferid|reducao|redução|filtro|credito|crédito|debito|débito/.test(n)) dica = 'Para seus dados: pergunte direto ("tem XML de algum cliente?", "qual fornecedor me dá mais crédito?", "produtos da Padaria Pão Dourado?", "quanto fica esse queijo da Padaria Y?"). Eu digo de qual empresa estou falando, localizo o produto dela e diferencio cálculo de consulta. Entendo cliente, fornecedor, produto, NCM, CFOP, CST, período — e gero PDF customizado.'
  else if (/cadastr|registr|salvar|produto novo|novo produto/.test(n)) dica = 'Para cadastros: pergunte "o CNPJ X está cadastrado?" (verifico e ofereço cadastrar) ou diga "quero cadastrar um produto" (conduzo empresa → SKU → nome → NCM → trib. antiga CFOP/CST/PIS/COFINS → conferência, e só gravo após o SIM).'
  else if (/lc\s*214|lei complementar|artigo|art\.|legisla/.test(n)) dica = 'Para a LC 214/2025: pergunte pelo número ("explica o art. 128") ou pelo tema ("onde a lei fala de diferimento?"). Pesquiso no corpus offline e explico no molde claro + técnico, com link da íntegra no Planalto. A tela Legislação abre a lei completa.'
  else if (/relatorio|relatório|export|pdf|csv/.test(n)) dica = 'Para relatório: peça "gera um relatório dessa conversa" e escolha PDF, CSV, JSON ou TXT. O PDF sai timbrado; o analítico do Simples sai no módulo dono.'
  return {
    texto: `Sou a Aurum AI. ${dica}`,
    confianca: 1,
    nivel: 'alta',
    fontes: [],
    sugestoes: ['O que você pode fazer?', 'Tem algum NCM de banana?'],
    botoes: botoesCapacidades().slice(0, 4),
    pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Orientação: ajuda → navegarPara'),
  }
}

function responderNavegar(analise: AnaliseChat): RespostaChat {
  const alvo = VIEWS_AURUM_AI.find((v) => v.view === analise.destino)
  if (!alvo) {
    return {
      texto: `Para qual tela devo te levar? Posso abrir: Consulta NCM, Serviços (NBS), Calculadora, Simples Nacional, Lote, Notas Fiscais, Produtos, Tabelas auxiliares ou Legislação.`,
      confianca: 1,
      nivel: 'alta',
      fontes: [],
      botoes: botoesCapacidades().slice(0, 4),
      pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Orientação: navegar sem destino claro'),
    }
  }
  return {
    texto: `Te levo até **${alvo.rotulo}**: ${alvo.descricao}\n\nToque no botão abaixo para ir (seus dados continuam intactos — o chat nunca altera nada).`,
    confianca: 1,
    nivel: 'alta',
    fontes: [],
    botoes: [{ rotulo: `Ir para ${alvo.rotulo}`, acao: 'navegar', alvo: alvo.view }],
    pensamento: pensar([PENSAR.entender, PENSAR.validar], `Orientação: navegar → ${alvo.view}`),
  }
}

function responderStatus(): RespostaChat {
  return {
    texto:
      `Base oficial embutida no app (nomenclatura TEC vigente + vínculos CST × cClassTrib da Reforma + capítulos + vigência). ` +
      `Para contagens e sincronização, abra Tabelas auxiliares → aba "Referência oficial".`,
    confianca: 1,
    nivel: 'alta',
    fontes: ['Nomenclatura vigente (TEC)', 'Vínculos oficiais da Reforma (CST × cClassTrib)'],
    botoes: [{ rotulo: 'Abrir Tabelas auxiliares', acao: 'navegar', alvo: 'auxiliares' }],
    pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Orientação: status da base'),
  }
}

function responderConversaLeve(pergunta: string, perfil?: PerfilMemoria | null): RespostaChat {
  const voc = perfil && primeiroNome(perfil) ? `, ${primeiroNome(perfil)}` : ''
  const n = pergunta.toLowerCase()
  if (/obrigad|valeu|brigad/.test(n)) {
    const textos = [
      `Por nada${voc}! Se precisar, classifico NCM/NBS, calculo IBS/CBS e Simples ou gero um relatório — é só pedir.`,
      `Por nada${voc}, foi um prazer! Quando quiser, tem NCM, NBS, cálculo de IBS/CBS e Simples por aqui.`,
      `Por nada${voc}! Fico por aqui — se surgir uma dúvida fiscal (classificar, calcular, relatar), me chama.`,
    ] as const
    return {
      texto: variar('leve-obrigado', textos),
      confianca: 1, nivel: 'alta', fontes: [],
      sugestoes: variar('leve-obrigado-sug', [
        ['Tem algum NCM de banana?', 'O que é Fator R?'],
        ['Qual o NBS para aula de inglês?', 'Quanto fica R$ 1.000 no NCM 0803.10.00?'],
      ]),
      botoes: botoesCapacidades().slice(0, 4),
      pensamento: pensar([PENSAR.entender], 'Conversa leve: agradecimento + ponte'),
    }
  }
  if (/tchau|ate mais|ate logo|ate breve/.test(n)) {
    const textos = [
      `Até mais${voc}! Deixo o chat aberto — quando voltar, posso retomar cálculos e relatórios de onde paramos.`,
      `Tchau${voc}, até já! Sua conversa fica salva aqui — na volta a gente continua de onde parou.`,
      `Até logo${voc}! Se precisar classificar, calcular ou gerar relatório depois, é só chamar.`,
    ] as const
    return {
      texto: variar('leve-tchau', textos),
      confianca: 1, nivel: 'alta', fontes: [],
      botoes: botoesCapacidades().slice(0, 4),
      pensamento: pensar([PENSAR.entender], 'Conversa leve: despedida'),
    }
  }
  // social ("como você está?", "tudo bem?") — responde como gente, com limite,
  // e devolve para o sistema sem virar aula fiscal.
  if (/como voce esta|como vai|tudo bem|tudo certo|e voce/.test(n)) {
    const textos = [
      `Tudo bem por aqui, obrigado por perguntar! Sou a Aurum AI e meu forte é o fiscal do sistema (NCM/NBS, IBS/CBS, Simples). Quer classificar algo, simular um cálculo ou entender um conceito simples?`,
      `Tudo bem, e com você? Por aqui sigo afiando o faro fiscal — NCM, NBS, IBS/CBS e Simples. O que vamos fazer agora?`,
      `Tudo certo por aqui! Que bom trocar essa ideia — mas onde eu brilho mesmo é no fiscal do sistema. Bora classificar, calcular ou gerar um relatório?`,
    ] as const
    return {
      texto: variar('leve-social', textos),
      confianca: 1, nivel: 'alta', fontes: [],
      sugestoes: variar('leve-social-sug', [
        ['O que você pode fazer?', 'Tem algum NCM de banana?', 'O que é Fator R?'],
        ['Tem algum NCM de banana?', 'Quanto fica R$ 1.000 no NCM 0803.10.00?', 'Qual o NBS para aula de inglês?'],
      ]),
      botoes: botoesCapacidades().slice(0, 4),
      pensamento: pensar([PENSAR.entender], 'Conversa leve: social + ponte para o sistema'),
    }
  }
  // cumprimento ("bom dia, tudo bem?") — breve + ponte, sem aula fiscal.
  const apelidoTxt = contemApelido(pergunta) ? ` (pode me chamar de ${NOME_MASCOTE}! ✨)` : ''
  const textos = [
    `Olá${voc}! Tudo bem por aqui. Sou a Aurum AI${apelidoTxt} — posso classificar NCM/NBS, calcular IBS/CBS e Simples ou explicar um conceito simples (ex.: "o que é Fator R?"). O que você quer fazer?`,
    `${prefixoTemporal()}${voc}! Tudo bem por aqui. Sou a Aurum AI${apelidoTxt} — classifico, calculo e gero relatórios sem sair do chat. Qual a missão de agora?`,
    `Oi${voc}, que bom te ver! Sou a Aurum AI${apelidoTxt} — NCM/NBS, IBS/CBS, Simples e relatórios, tudo com a base oficial. O que vamos resolver?`,
  ] as const
  return {
    texto: variar('leve-cumprimento', textos),
    confianca: 1, nivel: 'alta', fontes: [],
    sugestoes: variar('leve-cumprimento-sug', [
      ['O que você pode fazer?', 'Tem algum NCM de banana?', 'O que é Fator R?'],
      ['Tem algum NCM de banana?', 'Qual o NBS para aula de inglês?', 'O que é sublimite?'],
    ]),
    botoes: botoesCapacidades().slice(0, 4),
    pensamento: pensar([PENSAR.entender], 'Conversa leve: cumprimento + ponte'),
  }
}

function responderConceito(pergunta: string, perfil?: PerfilMemoria | null): RespostaChat {
  const verbete = encontrarConceito(pergunta)
  if (!verbete) return responderGenerico(pergunta, perfil)
  return {
    texto: `${textoConceito(verbete)}\n\nSe quiser, peço um cálculo ou te levo até a tela — é só dizer.`,
    confianca: 0.9,
    nivel: 'alta',
    fontes: ['Base do sistema (TEC + LC 214/2025 + tabelas do Simples)', 'Verbetes curados do app'],
    sugestoes: ['O que você pode fazer?', 'Qual melhor: Anexo III ou V?'],
    botoes: [
      { rotulo: 'O que você pode fazer?', acao: 'perguntar', alvo: 'O que você pode fazer?' },
      { rotulo: 'Abrir Simples Nacional', acao: 'navegar', alvo: 'simples' },
    ],
    pensamento: pensar([PENSAR.entender, PENSAR.validar], `Conceito: ${verbete.chave}`),
  }
}

function responderComparativo(pergunta: string, historico: MensagemHistorico[] = []): RespostaChat {
  const n = pergunta.toLowerCase()
  // v8 — normaliza acentos para os gates ("híbrido" com í deve casar).
  const nn = n.normalize('NFD').replace(/[̀-ͯ]/g, '')
  const ctx = contextoBaseDoTurno(historico)
  const falasUser = historico.filter((m) => m.papel === 'user').map((m) => m.texto)
  const temNumeros = ctx.ultimoRbt12 != null || ctx.ultimaReceita != null || ctx.ultimaFolha != null
  const falaIII_V = /iii| v\b|anexo/.test(nn)
  const falaHib = /hibrido|convencional|conv|hib/.test(nn)
  // v8 — pedido de híbrido COM números: calcula e entrega as 2 guias (sob
  // demanda: clique ou pergunta explícita). Sem isso, o híbrido nunca aparece.
  if (falaHib) {
    const slotsQ = extrairSlotsSimples(pergunta)
    const anexoQ = slotsQ.anexo ?? ctx.ultimoAnexo ?? null
    const rbtQ = slotsQ.rbt12 ?? ctx.ultimoRbt12 ?? null
    const recQ = slotsQ.receitaMes ?? ctx.ultimaReceita ?? null
    if (anexoQ != null && rbtQ != null && recQ != null) {
      const cbsRefQ = extrairCbsRef([...falasUser, pergunta].join('\n')) ?? CBS_REF_PADRAO
      const despesasQ = acumularDespesas([...falasUser, pergunta])
      const detDebQ = detectarRegraDebitoReceita([...falasUser, pergunta].join('\n'))
      return responderHibridoAnexo({
        anexo: anexoQ as AnexoSimplesId, rbt12: rbtQ, receita: recQ,
        cbsRef: cbsRefQ, despesas: despesasQ, origem: 'comparativo:hibrido',
        regraDebito: detDebQ.regra ?? 'cheia', debitoIncerto: detDebQ.incerta && detDebQ.regra == null,
      })
    }
    const faltamQ: string[] = []
    if (anexoQ == null) faltamQ.push('o anexo')
    if (rbtQ == null) faltamQ.push('o RBT12 (faturamento dos últimos 12 meses)')
    if (recQ == null) faltamQ.push('a receita do mês')
    return {
      texto:
        `Para o híbrido preciso de ${faltamQ.join(', ')}.\n` +
        `Me diga — ex.: "Anexo III, RBT12 500 mil, receita 40 mil no híbrido".`,
      confianca: 0.9, nivel: 'alta',
      fontes: ['Tabela Simples Nacional — Anexos I–V + Reforma (CBS/IBS)'],
      sugestoes: ['Anexo III, RBT12 500 mil, receita 40 mil no híbrido'],
      botoes: [{ rotulo: 'Abrir Simples Nacional', acao: 'navegar', alvo: 'simples' }],
      pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Comparativo híbrido sem números — perguntar'),
    }
  }
  // Com contexto numérico, o comparativo III×V roda em 1 clique (sem nada
  // automático: o híbrido continua atrás do próprio botão).
  if (temNumeros && (falaIII_V || falaHib)) {
    const temTudo = ctx.ultimoAnexo != null && ctx.ultimoRbt12 != null && ctx.ultimaReceita != null
    return {
      texto:
        `Boa — já tenho números da nossa conversa (RBT12 ${ctx.ultimoRbt12 != null ? fmtMoeda(ctx.ultimoRbt12) : '—'}, ` +
        `receita ${ctx.ultimaReceita != null ? fmtMoeda(ctx.ultimaReceita) : '—'}${ctx.ultimaFolha != null ? `, folha ${fmtMoeda(ctx.ultimaFolha)}` : ''}). ` +
        `Para comparar de verdade, rode o relatório analítico no **Simples Nacional**: ele calcula III×V e Convencional×Híbrido com o motor determinístico e mostra o veredito de menor carga.\n\n` +
        `Regra rápida: Anexo III vence quando o Fator R ≥ 28%; Híbrido vence quando os créditos de CBS superam a CBS embutida no DAS.`,
      confianca: 0.85, nivel: 'alta',
      fontes: ['Tabela Simples Nacional — Anexos I–V + Reforma (CBS/IBS)', 'Fator R (folha/RBT12 ≥ 28% → III)'],
      botoes: [
        ...(temTudo
          ? [{
              rotulo: '⚖️ Comparar anexos I–V',
              acao: 'perguntar' as const,
              alvo: `__COMPARAR_ANEXOS__ RBT12=${ctx.ultimoRbt12 as number} RECEITA=${ctx.ultimaReceita as number} FOLHA=${ctx.ultimaFolha ?? 0} ANEXO_ATUAL=${ctx.ultimoAnexo as string}`,
            }]
          : []),
        { rotulo: 'Abrir Simples Nacional', acao: 'navegar', alvo: 'simples' },
      ],
      pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Comparativo com contexto → módulo Simples'),
    }
  }
  return {
    texto:
      `Comparo pelos dois eixos do sistema:\n` +
      `• **Anexo III × V:** III é mais barato e exige Fator R ≥ 28% (folha ÷ RBT12); abaixo disso vale o V. O gap de folha aparece no card Fator R.\n` +
      `• **Convencional × Híbrido:** convencional = DAS com CBS dentro; híbrido = DAS reduzido + CBS por fora (débitos − créditos). Híbrido compensa com créditos grandes.\n\n` +
      `Me diga RBT12 + receita (+ folha, se for serviço) que eu projeto, ou abra o Simples Nacional para o relatório completo com veredito.`,
    confianca: 0.9, nivel: 'alta',
    fontes: ['Tabela Simples Nacional — Anexos I–V + Reforma (CBS/IBS)', 'Fator R (folha/RBT12 ≥ 28% → III)'],
    sugestoes: ['Meu DAS no Anexo III com RBT12 500 mil e receita 40 mil', 'O que é Fator R?'],
    botoes: [{ rotulo: 'Abrir Simples Nacional', acao: 'navegar', alvo: 'simples' }],
    pensamento: pensar([PENSAR.entender], 'Comparativo — regra geral, sem números inventados'),
  }
}

function parsePayloadComparar(texto: string): { rbt12: number; receita: number; folha: number; anexo: string; cbsRef: number } | null {
  const num = (rx: RegExp): number | null => {
    const m = texto.match(rx)
    if (!m) return null
    const v = Number(m[1])
    return Number.isFinite(v) && v > 0 ? v : null
  }
  const rbt12 = num(/RBT12=(\d+(?:\.\d+)?)/)
  const receita = num(/RECEITA=(\d+(?:\.\d+)?)/)
  const folhaM = texto.match(/FOLHA=(\d+(?:\.\d+)?)/)
  const folha = folhaM ? Number(folhaM[1]) : 0
  const anexoM = texto.match(/ANEXO(?:_ATUAL)?=([I,V]{1,4})/)
  const anexo = anexoM?.[1] ?? null
  const cbsM = texto.match(/CBSREF=(\d+(?:\.\d+)?)/)
  const cbsRef = cbsM ? Number(cbsM[1]) : CBS_REF_PADRAO
  if (rbt12 == null || receita == null || !anexo) return null
  return { rbt12, receita, folha: Number.isFinite(folha) && folha >= 0 ? folha : 0, anexo, cbsRef: cbsRef > 0 && cbsRef < 1 ? cbsRef : CBS_REF_PADRAO }
}

/* v8 — entrega padrão do híbrido em 2 guias (só sob demanda) --------------- */

/**
 * Bloco de entrega do híbrido: as 2 guias que o usuário recolhe.
 * - Guia DAS (sem CBS) = DAS convencional − CBS embutida;
 * - Guia DARF (CBS por fora) = débitos (receita × CBS ref) − créditos.
 * Puro: só formata números do motor.
 */
function blocoGuiasHibrido(conv: ResultadoConvencional, hib: ResultadoHibrido, debitos: number, creditos: number): string {
  return (
    `• Guia DAS (sem CBS): **${fmtMoeda(hib.dasReduzido)}**\n` +
    `• Guia DARF (CBS por fora): **${fmtMoeda(hib.cbsFora)}** (débitos ${fmtMoeda(debitos)} − créditos ${fmtMoeda(creditos)})\n` +
    `• Total no híbrido: **${fmtMoeda(hib.total)}**/mês (convencional: ${fmtMoeda(conv.das)})`
  )
}

/**
 * Calcula o híbrido de UM anexo e entrega as 2 guias.
 * - Sem despesas: entrega pessimista (CBS fora cheia) + STEP-BY-STEP da
 *   referência ("usar referência" ou "aluguel 2000").
 * - Com despesas: entrega com débitos − créditos + convite de ajuste.
 * Única porta de saída do híbrido no chat (payload, pedido explícito ou
 * refino de despesas em thread híbrida).
 */
function responderHibridoAnexo(args: {
  anexo: AnexoSimplesId
  rbt12: number
  receita: number
  cbsRef: number
  despesas: DespesaChat[]
  origem: string
  /** v9 — redução sobre a receita (débito com alíquota reduzida). */
  regraDebito?: RegraDebitoCBS
  /** v9 — receita cita redução sem %: pergunta qual porcentagem. */
  debitoIncerto?: boolean
}): RespostaChat {
  const t0 = Date.now()
  const { anexo, rbt12, receita, cbsRef, despesas } = args
  const regraDebito: RegraDebitoCBS = args.regraDebito ?? 'cheia'
  const conv = calcularConvencional({ anexoId: anexo, rbt12, receitaMes: receita })
  const debitos = debitoCBS(receita, regraDebito, cbsRef)
  const creditos = totalCreditosChat(despesas, cbsRef)
  const hib = calcularHibrido({ convencional: conv, debitosCBS: debitos, creditosCBS: creditos })
  const veredito = hib.melhor === 'empate' ? 'Empate técnico' : hib.melhor === 'hibrido' ? 'Híbrido vence' : 'Convencional vence'
  const pedidoHib = detectarPedidoGrafico(`${args.origem} ${anexo} ${rbt12} ${receita}`)
  const graficoHib: GraficoChat | null = graficoConvXHibrido({
    anexo, dasConv: conv.das, dasReduzido: hib.dasReduzido,
    cbsFora: hib.cbsFora, totalHib: hib.total, economia: hib.economiaVsConvencional,
  })
  const graficoFinal = pedidoHib.tipo ? aplicarTipoPreferido(graficoHib, pedidoHib.tipo) : graficoHib
  const sugHib = sugestaoGrafico(
    `Mostra em gráfico a comparação Convencional × Híbrido: Anexo ${anexo}, RBT12 ${rbt12}, receita ${receita}`,
    `Mostra em tabela a comparação Convencional × Híbrido: Anexo ${anexo}, RBT12 ${rbt12}, receita ${receita}`,
  )
  const cabecalho =
    `Híbrido — Anexo ${anexo} (RBT12 ${fmtMoeda(rbt12)} · receita ${fmtMoeda(receita)} · CBS ref ${(cbsRef * 100).toFixed(2).replace('.', ',')}%${regraDebito !== 'cheia' ? ` · receita com ${rotuloRegraDebito(regraDebito)}` : ''}):\n` +
    `${blocoGuiasHibrido(conv, hib, debitos, creditos)} → **${veredito}**`
  // v9 — perguntas de redução (uma por resposta): receita sem % e a primeira
  // despesa com regra assumida. O resultado acima já é a análise completa com
  // as regras assumidas sinalizadas — confirmar refina na hora.
  let blocoPerguntas = ''
  const botoesPergunta: BotaoChat[] = []
  if (args.debitoIncerto) {
    blocoPerguntas +=
      `\n\n❓ Sua receita tem redução — **qual porcentagem?**\n` +
      `• Clique ou diga: "receita com redução de 30%" · "...de 60%" · "receita com alíquota zero" · "receita sem redução".`
    botoesPergunta.push(
      { rotulo: 'Redução de 30%', acao: 'perguntar', alvo: 'receita com redução de 30%' },
      { rotulo: 'Redução de 60%', acao: 'perguntar', alvo: 'receita com redução de 60%' },
      { rotulo: 'Alíquota zero', acao: 'perguntar', alvo: 'receita com alíquota zero' },
      { rotulo: 'Sem redução', acao: 'perguntar', alvo: 'receita sem redução' },
    )
  }
  const incerta = despesas.find((d) => !d.regraExplicita && !ehReducaoPorTipo(d.rotulo))
  if (incerta) {
    const rot = incerta.rotulo
    const val = incerta.valor
    blocoPerguntas +=
      `\n\n❓ Sobre **${rot} (${fmtMoeda(val)})**: tem redução? Assumi **${rotuloRegraCredito(incerta.regra)}** — confirme ou corrija:`
    botoesPergunta.push(
      { rotulo: '✅ Integral', acao: 'perguntar', alvo: `${rot} ${val} integral` },
      { rotulo: '➖ Redução de 30%', acao: 'perguntar', alvo: `${rot} ${val} com redução de 30%` },
      { rotulo: '➖ Redução de 60%', acao: 'perguntar', alvo: `${rot} ${val} com redução de 60%` },
      { rotulo: '🚫 Sem crédito', acao: 'perguntar', alvo: `${rot} ${val} sem crédito` },
    )
  }
  if (!despesas.length) {
    // STEP-BY-STEP do híbrido: mostra a referência e pede confirmação/ajuste.
    const ref = DESPESAS_REFERENCIA.map((d) => {
      const c = Math.round(d.valor * cbsRef * (d.rotulo === 'Aluguel' ? 0.3 : 1) * 100) / 100
      return `• ${d.rotulo}: ${fmtMoeda(d.valor)} → crédito ${fmtMoeda(c)}`
    }).join('\n')
    const totalRef = totalCreditosChat([...DESPESAS_REFERENCIA], cbsRef)
    const debitosRef = debitoCBS(receita, regraDebito, cbsRef)
    return {
      texto:
        `${cabecalho} (pessimista, sem despesas)\n\n` +
        `## Para refinar o híbrido, confirme as despesas\n` +
        `Débitos de CBS sobre a receita: **${fmtMoeda(debitosRef)}** (${(cbsRef * 100).toFixed(2).replace('.', ',')}% de ${fmtMoeda(receita)}).\n` +
        `Valores de referência que posso usar:\n${ref}\n` +
        `Total de créditos (referência): **${fmtMoeda(totalRef)}**\n\n` +
        `• Diga "usar referência" para recalcular com esses valores\n` +
        `• Ou ajuste: "aluguel 2000, energia 350" · "adicionar contador 800 integral"` +
        `${blocoPerguntas}\n\n${sugHib.frase}`,
      confianca: 0.9, nivel: 'alta',
      fontes: ['Tabela Simples Nacional — Anexos I–V + Reforma (CBS/IBS)'],
      grafico: graficoFinal,
      sugestoes: ['Usar referência', ...sugHib.sugestoes],
      botoes: [
        { rotulo: '✅ Usar referência', acao: 'perguntar', alvo: `Usar referência: aluguel 1500, energia 300, telefone 150, água 50, material 300. Comparar híbrido Anexo ${anexo}, RBT12 ${rbt12}, receita ${receita}` },
        ...botoesPergunta,
        ...sugHib.botoes,
        { rotulo: 'Abrir Simples Nacional', acao: 'navegar', alvo: 'simples' },
      ],
      pensamento: pensar([PENSAR.entender, PENSAR.validar, PENSAR.calcularDas], `Híbrido Anexo ${anexo} (sem despesas → pedir referência) · ${args.origem}`, Date.now() - t0),
    }
  }
  const linhaRegras =
    `\nRegras aplicadas: ${despesas.map((d) => `${d.rotulo} ${ehReducaoPorTipo(d.rotulo) ? '30% da alíquota (padrão da categoria)' : `${rotuloRegraCredito(d.regra)}${d.regraExplicita ? '' : ' (assumido — confirme)'}`}`).join(' · ')}.`
  const detalheDespesas =
    `\nDespesas consideradas:\n${despesas.map((d) => `• ${d.rotulo}: ${fmtMoeda(d.valor)} → crédito ${fmtMoeda(Math.round(d.valor * cbsRef * (d.rotulo.toLowerCase().includes('aluguel') ? 0.3 : d.regra === 'integral' ? 1 : d.regra === 'red30' ? 0.7 : d.regra === 'red60' ? 0.4 : 0) * 100) / 100)}`).join('\n')}`
  return {
    texto:
      `${cabecalho}\n${detalheDespesas}${linhaRegras}\n\n` +
      `Ajuste com "aluguel 2000" ou "adicionar contador 800" que recalculo na hora.` +
      `${blocoPerguntas}\n\n${sugHib.frase}`,
    confianca: 0.9, nivel: 'alta',
    fontes: ['Tabela Simples Nacional — Anexos I–V + Reforma (CBS/IBS)'],
    grafico: graficoFinal,
    sugestoes: [...sugHib.sugestoes],
    botoes: [...botoesPergunta, ...sugHib.botoes, { rotulo: 'Abrir Simples Nacional', acao: 'navegar', alvo: 'simples' }],
    pensamento: pensar([PENSAR.entender, PENSAR.validar, PENSAR.calcularDas], `Híbrido Anexo ${anexo} (com despesas) · ${args.origem}`, Date.now() - t0),
  }
}

function responderComparativoMatriz(texto: string, historico: MensagemHistorico[] = []): RespostaChat {
  const t0 = Date.now()
  const args = parsePayloadComparar(texto)
  if (!args) {
    return {
      texto: `Para comparar preciso de RBT12 + receita (+ folha se for serviço). Me diga — ex.: "Anexo III, RBT12 500 mil, receita 40 mil".`,
      confianca: 0.9, nivel: 'alta',
      fontes: ['Tabela Simples Nacional — Anexos I–V + Reforma (CBS/IBS)'],
      sugestoes: ['DAS Anexo III, RBT12 500 mil, receita 40 mil'],
      botoes: [{ rotulo: 'Abrir Simples Nacional', acao: 'navegar', alvo: 'simples' }],
      pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Comparativo matriz sem valores — perguntar'),
    }
  }
  // Rota pelo orquestrador exploratório (mesmo motor, 5 anexos + híbrido).
  const falasUser = historico.filter((m) => m.papel === 'user').map((m) => m.texto)
  const despesas = acumularDespesas([...falasUser, texto])
  const listaDespesas = despesas.length ? despesas : [...DESPESAS_REFERENCIA]
  const cbsRef = extrairCbsRef([...falasUser, texto].join('\n')) ?? args.cbsRef
  const entrada = { rbt12: args.rbt12, receitaMes: args.receita, folha12: args.folha > 0 ? args.folha : null, cbsRef, despesas: listaDespesas }
  const r = orquestrarTodosAnexos(entrada)
  const ids = ['I', 'II', 'III', 'IV', 'V'] as const
  const porAnexo = new Map(r.linhas.map((l) => [l.anexo, l]))
  const tabela = ids.map((id) => {
    const l = porAnexo.get(id)!
    const marca = l.anexo === r.vencedorConvId ? ' **← menor carga**' : ''
    return `• Anexo ${l.anexo} · ${l.faixa}ª faixa · ${((l.aliquotaEfetiva) * 100).toFixed(4).replace('.', ',')}% → DAS ${fmtMoeda(l.das)} (CBS ${fmtMoeda(l.cbsDentroDAS)})${marca}`
  }).join('\n')
  const notaServico = args.anexo === 'I' || args.anexo === 'II' || args.anexo === 'IV'
    ? `\nNota: III×V só faz sentido para serviços — seu anexo atual é ${args.anexo} (Fator R não se aplica).`
    : ''
  const pedido = detectarPedidoGrafico(texto)
  let grafico: GraficoChat | null = graficoComparativoAnexos(
    r.linhas.map((l) => ({ id: l.anexo, das: l.das })),
    args.rbt12,
    args.receita,
  )
  if (pedido.tipo) grafico = aplicarTipoPreferido(grafico, pedido.tipo)
  const sug = sugestaoGrafico(
    alvoGraficoSimplesTodos(args.rbt12, args.receita, args.folha > 0 ? args.folha : null),
    `Mostra em tabela o comparativo dos anexos: RBT12 ${args.rbt12}, receita ${args.receita}`,
  )
  const dadosSimples: DadosSimplesChat = {
    titulo: `Aurum AI — comparativo Simples I–V (RBT12 ${args.rbt12}, receita ${args.receita})`,
    pergunta: texto.slice(0, 300),
    geradoEm: new Date().toLocaleString('pt-BR'),
    entrada,
    resultado: r,
  }
  return {
    texto:
      `Comparativo com seus valores (RBT12 ${fmtMoeda(args.rbt12)} · receita ${fmtMoeda(args.receita)}${args.folha ? ` · folha ${fmtMoeda(args.folha)}` : ''}):\n` +
      `${tabela}\n\n**Menor carga: Anexo ${r.vencedorConvId} (${fmtMoeda(r.vencedorConvValor)})**${notaServico}\n\n` +
      `Quer o duelo com o **regime híbrido**? Ele precisa das despesas (débitos − créditos) — diga "comparar com híbrido" que eu mostro a referência e deixo você ajustar.\n\n${sug.frase}`,
    confianca: 0.9, nivel: 'alta',
    fontes: ['Tabela Simples Nacional — Anexos I–V + Reforma (CBS/IBS)'],
    grafico,
    sugestoes: ['Comparar com regime híbrido', 'Gera relatório dessa simulação', ...sug.sugestoes],
    botoes: [
      { rotulo: '🔀 Comparar com regime híbrido', acao: 'perguntar', alvo: `__COMPARAR_HIBRIDO__ RBT12=${args.rbt12} RECEITA=${args.receita} FOLHA=${args.folha} ANEXO=${args.anexo} CBSREF=${cbsRef}` },
      ...sug.botoes,
      { rotulo: 'Abrir Simples Nacional', acao: 'navegar', alvo: 'simples' },
    ],
    relatorioOpcoes: { base: 'simples', dados: dadosSimples },
    pensamento: pensar([PENSAR.entender, PENSAR.validar, PENSAR.calcularDas], `Matriz I–V · RBT12 ${fmtMoeda(args.rbt12)}`, Date.now() - t0),
  }
}

function responderComparativoHibrido(texto: string, historico: MensagemHistorico[] = []): RespostaChat {
  const args = parsePayloadComparar(texto)
  if (!args) {
    return {
      texto: `Para comparar Conv×Híb preciso de anexo + RBT12 + receita. Me diga — ex.: "Anexo III, RBT12 500 mil, receita 40 mil".`,
      confianca: 0.9, nivel: 'alta',
      fontes: ['Tabela Simples Nacional — Anexos I–V + Reforma (CBS/IBS)'],
      botoes: [{ rotulo: 'Abrir Simples Nacional', acao: 'navegar', alvo: 'simples' }],
      pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Comparativo híbrido sem valores — perguntar'),
    }
  }
  // Despesas: acumuladas da conversa (referência editável + novas) ou payload.
  const falasUser = historico.filter((m) => m.papel === 'user').map((m) => m.texto)
  const combinadas = [...falasUser, texto].join('\n')
  const cbsRef = extrairCbsRef(combinadas) ?? args.cbsRef
  let despesas = acumularDespesas([...falasUser, texto])
  const despM = texto.match(/DESPESA=(\d+(?:\.\d+)?)/)
  const despesaPayload = despM ? Number(despM[1]) : 0
  if (despesaPayload > 0 && !despesas.length) {
    despesas = [{ rotulo: 'Despesa informada', valor: despesaPayload, regra: 'integral' }]
  }
  return responderHibridoAnexo({
    anexo: args.anexo as AnexoSimplesId, rbt12: args.rbt12, receita: args.receita,
    cbsRef, despesas, origem: 'comparativo:hibrido-payload',
  })
}

/* -------------------------------------------------- legislação LC 214 --
 * Fine-tuning v3: a IA LÊ a LC 214 do corpus offline embarcado (`lc214.ts`,
 * 100% sem rede) e explica no molde claro + técnico + link da íntegra.
 * Pesquisa por número ("art. 128") ou por tema ("cesta básica").
 */

function responderLegislacao(pergunta: string): RespostaChat {
  const t0 = Date.now()
  const num = extrairNumeroArtigoLC214(pergunta)
  if (num) {
    const artigo = buscarArtigoLC214(num)
    if (artigo) {
      return {
        texto: explicarArtigoLC214(artigo.numero),
        confianca: 0.95,
        nivel: 'alta',
        fontes: ['LC 214/2025 — corpus curado offline (resumo) + íntegra no Planalto'],
        sugestoes: ['O que diz a LC 214 sobre cesta básica?', 'Explica o art. 138', 'O que você pode fazer?'],
        botoes: [
          { rotulo: 'Abrir Legislação', acao: 'navegar', alvo: 'legislacao' },
          { rotulo: 'O que diz sobre cesta básica?', acao: 'perguntar', alvo: 'O que diz a LC 214 sobre cesta básica?' },
        ],
        pensamento: pensar([PENSAR.entender, PENSAR.consultar(1), PENSAR.validar], `LC 214 offline → art. ${artigo.numero}`, Date.now() - t0),
      }
    }
    // Artigo citado fora da cobertura curada → honesto + íntegra.
    const disp = disponibilidadeLC214()
    return {
      texto:
        `O art. ${num} ainda não está no meu resumo curado offline (cobertura atual: ${disp.totalArtigos} artigos-guia em ${disp.temas.join(', ')}).\n\n` +
        `Leia a redação literal vigente na íntegra oficial: ${disp.fonteOficial}#art${num}\n\n` +
        `Se preferir, pergunte por tema — ex.: "onde a lei fala de diferimento?" — que eu pesquiso no corpus e explico no molde claro + técnico.`,
      confianca: 0.9,
      nivel: 'alta',
      fontes: ['LC 214/2025 — íntegra oficial (Planalto)'],
      sugestoes: ['Onde a lei fala de diferimento?', 'Explica o art. 128'],
      botoes: [{ rotulo: 'Abrir Legislação', acao: 'navegar', alvo: 'legislacao' }],
      pensamento: pensar([PENSAR.entender, PENSAR.validar], `LC 214: art. ${num} fora do corpus → íntegra`, Date.now() - t0),
    }
  }
  const achados = pesquisarLC214(pergunta, 3)
  if (achados.length && achados[0].score >= 3) {
    const principal = achados[0].artigo
    const outros = achados.slice(1).map((r) => `• Art. ${r.artigo.numero} — ${r.artigo.titulo.replace(/^Art\. \d+º? — /, '')}`).join('\n')
    return {
      texto:
        `${explicarArtigoLC214(principal.numero)}` +
        (outros ? `\n\n**Também relacionado:**\n${outros}` : ''),
      confianca: 0.9,
      nivel: 'alta',
      fontes: ['LC 214/2025 — corpus curado offline (resumo) + íntegra no Planalto'],
      sugestoes: [`Explica o art. ${principal.numero}`, 'Onde a lei fala de transição?'],
      botoes: [
        { rotulo: 'Abrir Legislação', acao: 'navegar', alvo: 'legislacao' },
        { rotulo: `Explicar art. ${principal.numero}`, acao: 'perguntar', alvo: `Explica o art. ${principal.numero}` },
      ],
      pensamento: pensar([PENSAR.entender, PENSAR.consultar(achados.length), PENSAR.validar], `LC 214 offline → pesquisa temática (${achados.map((a) => `art. ${a.artigo.numero}`).join(', ')})`, Date.now() - t0),
    }
  }
  const disp = disponibilidadeLC214()
  return {
    texto:
      `Pesquiso a **LC 214/2025 no corpus offline** (sem rede, sempre disponível — ${disp.totalArtigos} artigos-guia) e explico no molde claro + técnico, com link da íntegra.\n\n` +
      `Tente pelo número ("explica o art. 128") ou pelo tema ("onde a lei fala de cesta básica?"). Cobertura: ${disp.temas.join(', ')}.`,
    confianca: 0.9,
    nivel: 'alta',
    fontes: ['LC 214/2025 — corpus curado offline'],
    sugestoes: ['Explica o art. 128', 'Onde a lei fala de diferimento?', 'O que diz a LC 214 sobre cesta básica?'],
    botoes: [
      { rotulo: 'Abrir Legislação', acao: 'navegar', alvo: 'legislacao' },
      { rotulo: 'Explicar art. 128', acao: 'perguntar', alvo: 'Explica o art. 128 da LC 214' },
    ],
    pensamento: pensar([PENSAR.entender, PENSAR.validar], 'LC 214: sem match → orientar pesquisa', Date.now() - t0),
  }
}

/* -------------------------------------------- básico: tempo + conta --
 * Recursos nativos do chat (fluxo simples, sem RAG, sem rede):
 * - tempo: relógio/calendário local ("que horas são?", "que dia é hoje?");
 * - conta: matemática PT-BR determinística (soma, subtração, multiplicação,
 *   divisão, porcentagem, resto) com follow-up ("e mais 5?").
 * Ambos usam os gatilhos do sistema (detector → tool → fluxo simples) e a
 * memória de melhor amigo (vocativo + padrão de conversa + contexto).
 */

function responderTempo(pergunta: string, perfil?: PerfilMemoria | null): RespostaChat {
  const t0 = Date.now()
  const tipo = detectarTempo(pergunta) ?? 'ambos'
  const agora = new Date()
  const hora = formatarHora(agora)
  const { curta, longa, diaSemana } = formatarData(agora)
  const nome = primeiroNome(perfil)
  const voc = nome ? `, ${nome}` : ''
  const chamouApelido = contemApelido(pergunta)
  const assinatura = chamouApelido ? ` (aqui é a ${NOME_MASCOTE} ✨)` : ''
  let corpo: string
  if (tipo === 'hora') {
    corpo = `Agora são **${hora}**${voc}!${assinatura}`
  } else if (tipo === 'data') {
    corpo = `Hoje é **${curta}** (${diaSemana}, ${longa})${voc}!${assinatura}`
  } else {
    corpo = `Agora são **${hora}** — hoje é **${curta}** (${diaSemana}, ${longa})${voc}!${assinatura}`
  }
  return {
    texto:
      `${corpo}\n\n` +
      `Se precisar, classifico NCM/NBS, calculo IBS/CBS e Simples ou faço outra conta — é só pedir.`,
    confianca: 1,
    nivel: 'alta',
    fontes: ['Relógio local do sistema'],
    sugestoes: ['Quanto é 10% de 500?', 'Tem algum NCM de banana?', 'O que você pode fazer?'],
    botoes: botoesCapacidades().slice(0, 4),
    pensamento: pensar([PENSAR.entender, PENSAR.validar], `Tempo local → ${tipo}`, Date.now() - t0),
  }
}

function responderContaBasica(
  pergunta: string,
  historico: MensagemHistorico[] = [],
  perfil?: PerfilMemoria | null,
): RespostaChat {
  const t0 = Date.now()
  const nome = primeiroNome(perfil)
  const voc = nome ? `, ${nome}` : ''
  const chamouApelido = contemApelido(pergunta)
  const assinatura = chamouApelido ? ` — aqui é a ${NOME_MASCOTE}! ✨` : ''
  // 1) Expressão completa na frase ("quanto é 2+3?", "10% de 500").
  // 2) Follow-up curto ("e mais 5?", "e 10% disso?") com o último resultado.
  const conta = detectarConta(pergunta) ?? detectarContaFollowUp(pergunta, historico)
  if (!conta) {
    // Conta incompleta ("quanto é 10%?", "e mais?"): pede o que falta sem chutar.
    const n = pergunta.toLowerCase()
    if (/perc|por cento|%/.test(n)) {
      return {
        texto:
          `Para a porcentagem preciso dos dois: **percentual + base** — ex.: "10% de 500"${voc}${assinatura}.\n\n` +
          `Me diga assim que calculo na hora.`,
        confianca: 1, nivel: 'alta', fontes: [],
        sugestoes: ['Quanto é 10% de 500?', 'Quanto é 20% de 1.200?'],
        botoes: botoesCapacidades().slice(0, 4),
        pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Conta: porcentagem sem base → pedir', Date.now() - t0),
      }
    }
    if (/resto|mod\b/.test(n)) {
      return {
        texto:
          `Para o resto preciso de **dividendo + divisor** — ex.: "resto de 10 por 3"${voc}${assinatura}.\n\n` +
          `Me diga os dois que calculo na hora.`,
        confianca: 1, nivel: 'alta', fontes: [],
        sugestoes: ['Qual o resto de 10 por 3?', 'Quanto é 7 + 5?'],
        botoes: botoesCapacidades().slice(0, 4),
        pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Conta: resto sem 2 operandos → pedir', Date.now() - t0),
      }
    }
    return {
      texto:
        `Posso fazer a conta${voc}${assinatura}! Me diga os dois números e a operação — soma, subtração, multiplicação, divisão, porcentagem ou resto.\n\n` +
        `Ex.: "quanto é 12 × 8?", "10% de 500" ou "resto de 10 por 3".`,
      confianca: 1, nivel: 'alta', fontes: [],
      sugestoes: ['Quanto é 12 × 8?', 'Quanto é 10% de 500?', 'Qual o resto de 10 por 3?'],
      botoes: botoesCapacidades().slice(0, 4),
      pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Conta: sem 2 operandos → pedir', Date.now() - t0),
    }
  }
  const resultado = calcularConta(conta)
  if (resultado == null) {
    return {
      texto:
        `Não dá para dividir por zero${voc} — me dá um divisor diferente de 0 que calculo na hora${assinatura}.`,
      confianca: 1, nivel: 'alta', fontes: [],
      sugestoes: ['Quanto é 10 ÷ 2?', 'Quanto é 7 + 5?'],
      botoes: botoesCapacidades().slice(0, 4),
      pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Conta: divisão por zero → aviso honesto', Date.now() - t0),
    }
  }
  // Normaliza -0 → 0 e ruído de ponto flutuante (0.1+0.2).
  const limpo = Object.is(resultado, -0) ? 0 : Math.round(resultado * 10000) / 10000
  const expressao = expressaoConta(conta, limpo)
  return {
    texto:
      `🧮 ${expressao}${voc}!${assinatura}\n\n` +
      `**Resultado: ${formatarNumeroConta(limpo)}**\n\n` +
      `Posso continuar de onde paramos ("e mais 5?", "e 10% disso?") ou classificar/calcular o fiscal — é só pedir.`,
    confianca: 1,
    nivel: 'alta',
    fontes: ['Cálculo local determinístico'],
    sugestoes: ['E mais 5?', 'Quanto é 10% de 500?', 'Tem algum NCM de banana?'],
    botoes: botoesCapacidades().slice(0, 4),
    pensamento: pensar([PENSAR.entender, PENSAR.validar], `Conta básica → ${expressao}`, Date.now() - t0),
  }
}

function responderGenerico(pergunta = '', perfil?: PerfilMemoria | null): RespostaChat {
  // Rede de segurança: pedido claramente de outra área (saúde, direito,
  // engenharia, receita culinária, código...) sem nenhum lastro do sistema
  // → recusa com profissional da área, em vez de "não entendi".
  if (parecePedidoExterno(pergunta)) {
    return {
      texto: MENSAGEM_FORA_DE_ESCOPO_CHAT,
      confianca: 1, nivel: 'alta', fontes: [],
      pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Barreira: outra área, sem lastro do sistema'),
    }
  }
  const nome = primeiroNome(perfil)
  const aberturaNome = nome ? `, ${nome}` : ''
  return {
    texto:
      `${variar('generico-abertura', [
        `Sou a Aurum AI. Não entendi bem${aberturaNome} — mas posso ajudar com o sistema: `,
        `Sou a Aurum AI e quero te ajudar${aberturaNome} — meu terreno é o sistema: `,
        `Hmm${aberturaNome}, não peguei a sua intenção — mas olha onde eu mando bem aqui no sistema: `,
      ])}classificar NCM/NBS, calcular IBS/CBS e Simples, consultar seus dados (clientes, XMLs, fornecedores, produtos) ou gerar relatórios — é só pedir.\n\n` +
      `Tente por exemplo: "tem algum ncm de banana?", "tem XML de algum cliente?" ou "o que você pode fazer?".`,
    confianca: 1,
    nivel: 'alta',
    fontes: [],
    // Padrão aprendido (v5): com 3+ turnos no mesmo tema, as sugestões
    // acompanham o hábito — sem consultas, só o perfil. Perfil novo mantém
    // o rodízio padrão (nenhum teste existente muda).
    sugestoes: sugestoesParaPadrao(perfil) ?? variar('generico-sug', [
      ['O que você pode fazer?', 'Tem algum NCM de banana?', 'Qual o NBS para aula de inglês?'],
      ['Tem algum NCM de banana?', 'O que é Fator R?', 'Quanto fica R$ 1.000 no NCM 0803.10.00?'],
    ]),
    botoes: botoesCapacidades().slice(0, 4),
    pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Sem intenção clara → orientação'),
  }
}

/* ------------------------------------------------- memória (perfil) -- */

/** Resposta a "qual meu nome?" / "o que você sabe sobre mim?". */
function responderPerguntaMemoria(perfil: PerfilMemoria): RespostaChat {
  const nome = primeiroNome(perfil)
  if (nome) {
    return {
      texto:
        `Claro que lembro, ${nome}! Você me disse seu nome e eu guardei aqui no sistema — vale para todas as conversas e seções, mesmo depois de fechar o app.\n\n` +
        `Também lembro do nosso histórico (últimas classificações, cálculos e relatórios) e vou ficando mais afiada a cada conversa: acertos reforçam, correções me ensinam a não repetir o erro.\n\n` +
        `Quer que eu te chame de outro jeito? É só dizer "me chama de ...".`,
      confianca: 1,
      nivel: 'alta',
      fontes: ['Memória local da Aurum AI (perfil + conversas do emitente)'],
      sugestoes: ['Tem algum NCM de banana?', 'O que você pode fazer?'],
      botoes: botoesCapacidades().slice(0, 4),
      pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Memória: pergunta sobre o perfil → responder com o nome'),
    }
  }
  return {
    texto:
      `Ainda não sei seu nome — me diga uma vez ("meu nome é ...") que eu guardo e passo a te chamar assim em todas as conversas.\n\n` +
      `Também guardo nosso histórico (classificações, cálculos, relatórios) para retomar de onde paramos e aprender com acertos e correções.`,
    confianca: 1,
    nivel: 'alta',
    fontes: [],
    sugestoes: ['O que você pode fazer?', 'Tem algum NCM de banana?'],
    botoes: botoesCapacidades().slice(0, 4),
    pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Memória: sem nome ainda → pedir declaração'),
  }
}

/** Confirmação cordial após "meu nome é ...". */
function responderNomeDeclarado(nome: string): RespostaChat {
  const primeiro = nome.split(' ')[0]
  return {
    texto:
      `Prazer, ${primeiro}! Que bom te conhecer — já guardei seu nome e vou lembrar nas próximas conversas, mesmo em outras seções ou depois de fechar o app.\n\n` +
      `Sou a Aurum AI, sua assistente fiscal: classifico NCM/NBS, calculo IBS/CBS e Simples, consulto seus dados e gero relatórios. O que vamos fazer agora?`,
    confianca: 1,
    nivel: 'alta',
    fontes: ['Memória local da Aurum AI (perfil + conversas do emitente)'],
    sugestoes: ['Tem algum NCM de banana?', 'O que você pode fazer?', 'Qual o NBS para aula de inglês?'],
    botoes: botoesCapacidades().slice(0, 4),
    pensamento: pensar([PENSAR.entender, PENSAR.validar], `Memória: nome declarado → ${primeiro}`),
  }
}

/**
 * Outra área sem lastro do sistema (saúde, cirurgia, direito, culinária,
 * código, conteúdo explícito...). Puro e testável. Exige ausência de sinal
 * fiscal/sistema — com lastro, o fluxo fiscal decide (nunca a recusa).
 */
function parecePedidoExterno(texto: string): boolean {
  const n = String(texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
  if (!n.trim()) return false
  if (/ibs|cbs|\bncm\b|\bnbs\b|simples|\bdas\b|anexo|tribut|fiscal|cst|cclasstrib|rbt|folha|sublimite/.test(n)) return false
  if (/\d{8,9}/.test(texto)) return false
  return (
    /como fa(z|c)er (uma |um |a |o )?(cirurgia|operacao|receita|bolo|torta|pao|remedio|medicamento)/.test(n) ||
    /\bcirurgia\b|\boperacao medica\b|\bdiagnostico\b|\btratamento medico\b|\breceita medica\b|\bbula\b/.test(n) ||
    /\bprocesso judicial\b|\bpeticao\b|\bcontrato de aluguel\b|\bdireito penal\b|\badvocacia\b/.test(n) && !/cnae|nbs/.test(n) ||
    /escreva (um |uma )?(codigo|texto|redacao|poema|conto)/.test(n) ||
    /codigo (em |de )?(python|javascript|java|c\+\+|php)/.test(n) ||
    /previsao do tempo|resultado do jogo|tabela do brasileirao|horoscopo/.test(n) ||
    /porn|sexo explicito|conteudo adulto/.test(n)
  )
}

function saudacao(historico: MensagemHistorico[] = [], perfil?: PerfilMemoria | null, memoria?: MemoriaSistema | null, pergunta = ''): RespostaChat {
  const temConversa = historico.some((m) => m.papel === 'user')
  const boasVindas = temConversa ? 'bom te ver de novo' : prefixoTemporal().toLowerCase()
  const nome = primeiroNome(perfil)
  const voc = nome ? ` ${nome}` : ''
  const chamouApelido = contemApelido(pergunta)
  // Chat novo com sessão anterior: o artefato-resumo retoma de onde paramos.
  const retomada = !temConversa && memoria?.assunto
    ? `\n\n📌 Na última vez você viu **${memoria.assunto}**${memoria.codigoNcm ? ` (NCM ${fmtNcm(memoria.codigoNcm)})` : memoria.codigoNbs ? ` (NBS ${memoria.codigoNbs})` : ''} — posso continuar de onde paramos (opções, cálculo, relatório).`
    : ''
  // Melhor amigo: com padrão estabelecido, a saudação reconhece o hábito.
  const habito = (() => {
    try {
      const dom = sugestoesParaPadrao(perfil)
      void dom
      return null
    } catch {
      return null
    }
  })()
  void habito
  const aberturas = [
    `Olá${voc}! Sou a Aurum AI${chamouApelido ? ` (pode me chamar de ${NOME_MASCOTE}! ✨)` : ''}, sua assistente fiscal. Posso ajudar com:\n`,
    `Opa${voc}! ${temConversa ? 'Que bom te ver de novo — ' : ''}sou a Aurum AI${chamouApelido ? `, a ${NOME_MASCOTE}` : ''}, sua assistente fiscal. Olha o que faço:\n`,
    `${prefixoTemporal()}${voc}! Sou a Aurum AI${chamouApelido ? ` (${NOME_MASCOTE} às ordens!)` : ''} (${boasVindas}!) — seu apoio fiscal aqui no sistema:\n`,
    `Oi${voc}! Sou a Aurum AI${chamouApelido ? ` — isso, a ${NOME_MASCOTE}!` : ''}. Que bom falar com você — posso ajudar com:\n`,
  ] as const
  const abertura = variar('saudacao', aberturas)
  const fechos = [
    `\nO que você quer consultar?`,
    `\nPor onde começamos?`,
    `\nMe diga o que precisa — ou toque num botão.`,
  ] as const
  return {
    texto:
      `${abertura}` +
      `• NCM de produtos (ex.: "tem algum ncm de banana?")\n` +
      `• NBS de serviços (ex.: "qual o nbs para aula de yoga?")\n` +
      `• Cálculos de IBS/CBS (ex.: "quanto fica R$ 1.000 no NCM 0803.10.00?")\n` +
      `• Simples Nacional (ex.: "meu DAS no Anexo III com RBT12 500 mil?")\n` +
      `• Conta rápida e hora/data (ex.: "quanto é 10% de 500?", "que horas são?")\n` +
      `• Seus dados: clientes, XMLs, fornecedores, produtos, diferidos, reduções (ex.: "tem XML de algum cliente?")\n` +
      `• Relatórios (ex.: "gera um relatório dessa conversa" ou "gera um PDF disso")` +
      `${retomada}` +
      `${variar('saudacao-fecho', fechos)}`,
    confianca: 1,
    nivel: 'alta',
    fontes: retomada ? ['Memória local da Aurum AI (artefato-resumo da sessão anterior)'] : [],
    sugestoes: variar('saudacao-sug', [
      ['Tem algum NCM de banana?', 'Qual o NBS para aula de inglês?', 'Quanto fica R$ 1.000 no NCM 0803.10.00?'],
      ['Qual o NBS para aula de inglês?', 'O que é Fator R?', 'Tem algum NCM de banana?'],
      ['O que é Fator R?', 'Tem algum NCM de banana?', 'Meu DAS no Anexo III com RBT12 500 mil?'],
    ]),
    botoes: botoesCapacidades().slice(0, 4),
    pensamento: pensar([PENSAR.entender], 'Saudação: apresentar recursos'),
  }
}

/** Remove marcação HTML da base TEC (`<i>`, `<b>`…) — o chat é texto puro. */
function descricaoLimpa(s: string): string {
  return String(s ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A conversa já trouxe uma classificação? (follow-up → resposta compacta). */
function houveClassificacaoAntes(historico: MensagemHistorico[]): boolean {
  return historico.some((m) => m.papel === 'assistant' && /Classificação sugerida/.test(m.texto))
}

/**
 * Pergunta sobre QUANTIDADE/opções ("só tem um?", "tem mais algum?",
 * "quais NCMs para X?", "lista todos"). Não é nova classificação —
 * é pedido para listar os enquadramentos do NCM + NCMs próximos.
 */
function ehPerguntaOpcoes(pergunta: string): boolean {
  const n = String(pergunta ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
  return (
    /quais\b.*\bncms?\b/.test(n) ||
    /lista|todos?\b.*\bncms?\b|opç|alternativ|possibilidades/.test(n) ||
    /s[oó]\s+tem\s+(um|uma|esse|essa|isso)\b/.test(n) ||
    /tem\s+mais\s+(algum|alguma|outro|outra|op)/.test(n) ||
    /outr[oa]s?\s+(ncm|opç|possibil|codigos?)/.test(n) ||
    /quantos?\s+(ncm|codigos?|existem|opç)/.test(n)
  )
}

function semLastro(termo?: string, bases?: string[]): RespostaChat {
  const vasculhei = termo && bases?.length ? `Vasculhei ${bases.join(' e ')} por "${termo}" e não achei referência. ` : ''
  return {
    texto:
      `${vasculhei}${vasculhei ? 'Me dê' : 'Não encontrei referência na base oficial. Me dê'} 1–2 detalhes (material, uso, estado — ex.: "banana fresca para consumo") ou use a Consulta NCM com sinônimos do vocabulário oficial.`,
    confianca: 0,
    nivel: 'baixa',
    exato: false,
    fontes: ['Nomenclatura vigente (TEC)', 'Vínculos oficiais da Reforma (CST × cClassTrib)'],
    sugestoes: ['O que você pode fazer?', 'Tentar com mais detalhes'],
    botoes: [{ rotulo: 'Abrir Consulta NCM', acao: 'navegar', alvo: 'consulta' }],
    pensamento: pensar(
      [PENSAR.entender, PENSAR.consultar(0)],
      vasculhei ? `Raciocínio: ${bases?.join(' → ')} sem lastro para "${termo}"` : 'Sem lastro na TEC',
    ),
  }
}

/**
 * Sem-lastro específico de SERVIÇOS: funil por tipo/tomador/local, nunca por
 * material/uso/estado (esses são de produto e soavam "sem nexo" no NBS).
 */
function semLastroNbs(termo?: string): RespostaChat {
  const vasculhei = termo ? `Vasculhei NBS e NCM por "${termo}" e não achei referência. ` : ''
  return {
    texto:
      `${vasculhei}Me diga para eu funilar e orientar:\n` +
      `• tipo de serviço (ex.: "aula de inglês", "manutenção de ar-condicionado", "consultoria empresarial")\n` +
      `• tomador (empresa ou pessoa física?)\n` +
      `• local da prestação (município/UF)\n\n` +
      `Ex.: "qual o NBS para aula de inglês?" — aí cruzo na base oficial (NBS × CST × cClassTrib) na hora. ` +
      `Se souber o CNPJ, diga "quais atividades o CNPJ ... tem?" que puxo CNAEs + Anexo do Simples.`,
    confianca: 0,
    nivel: 'baixa',
    exato: false,
    fontes: ['Vínculos NBS × CST × cClassTrib (LC 214/2025)'],
    sugestoes: ['Qual o NBS para aula de inglês?', 'O que você pode fazer?'],
    botoes: [{ rotulo: 'Abrir Serviços (NBS)', acao: 'navegar', alvo: 'servicos' }],
    pensamento: pensar(
      [PENSAR.entender, PENSAR.consultar(0)],
      vasculhei ? `Raciocínio: NBS → NCM sem lastro para "${termo}"` : 'Sem lastro NBS',
    ),
  }
}

/**
 * Funil para código exato que NÃO existe na base (NCM 8 / NBS 9 / CNAE 7).
 *
 * Dado exato não tem "nível de confiança" — ou existe ou não existe. Quando
 * não existe, a IA confronta as tabelas que verificou e pergunta DO QUE SE
 * TRATA, refinando com perguntas por tipo para orientar da melhor maneira:
 * - NCM: material/composição, uso, estado;
 * - NBS: tipo de serviço, tomador, local da prestação;
 * - CNAE: o que a empresa faz (para inferir o Anexo do Simples).
 */
function responderCodigoNaoEncontrado(
  tipo: 'ncm' | 'nbs' | 'cnae',
  codigo: string,
  t0: number,
): RespostaChat {
  const digitos = String(codigo ?? '').replace(/\D+/g, '')
  const ms = Date.now() - t0
  if (tipo === 'ncm') {
    return {
      texto:
        `Não encontrei o NCM ${fmtNcm(digitos)} na base vigente — verifiquei a nomenclatura TEC e os vínculos oficiais da Reforma (CST × cClassTrib), e esse código não existe lá.\n\n` +
        `Do que se trata? Me diga o produto com 1–2 detalhes para eu funilar e orientar:\n` +
        `• material/composição (ex.: "100% algodão", "aço inox")\n` +
        `• uso (ex.: "para revenda", "para consumo")\n` +
        `• estado (ex.: "fresco", "congelado", "industrializado")\n\n` +
        `Ex.: "camiseta 100% algodão para revenda" — aí consulto a base oficial na hora.`,
      codigo: digitos,
      tipoCodigo: 'ncm',
      confianca: 0,
      nivel: 'baixa',
      exato: false,
      fontes: ['Nomenclatura vigente (TEC)', 'Vínculos oficiais da Reforma (CST × cClassTrib)'],
      sugestoes: ['O que você pode fazer?', 'Tem algum NCM de banana?'],
      botoes: [{ rotulo: 'Abrir Consulta NCM', acao: 'navegar', alvo: 'consulta' }],
      pensamento: pensar([PENSAR.entender, PENSAR.consultar(0), PENSAR.validar], `Código NCM ${digitos} inexistente → funil`, ms),
    }
  }
  if (tipo === 'nbs') {
    return {
      texto:
        `Não encontrei o NBS ${fmtNbs(digitos)} na base vigente — verifiquei os vínculos NBS × CST × cClassTrib (LC 214/2025), e esse código não existe lá.\n\n` +
        `Do que se trata esse serviço? Me diga para eu funilar e orientar:\n` +
        `• tipo de serviço (ex.: "aula de inglês", "manutenção de ar-condicionado")\n` +
        `• tomador (empresa ou pessoa física?)\n` +
        `• local da prestação (município/UF)\n\n` +
        `Ex.: "qual o NBS para aula de inglês?" — aí cruzo na base oficial na hora.`,
      codigo: digitos,
      tipoCodigo: 'nbs',
      confianca: 0,
      nivel: 'baixa',
      exato: false,
      fontes: ['Vínculos NBS × CST × cClassTrib (LC 214/2025)'],
      sugestoes: ['Qual o NBS para aula de inglês?', 'O que você pode fazer?'],
      botoes: [{ rotulo: 'Abrir Serviços (NBS)', acao: 'navegar', alvo: 'servicos' }],
      pensamento: pensar([PENSAR.entender, PENSAR.consultar(0), PENSAR.validar], `Código NBS ${digitos} inexistente → funil`, ms),
    }
  }
  return {
    texto:
      `Não encontrei o CNAE ${fmtCnae(digitos)} na tabela viva — verifiquei CNAE × Anexo Simples + Fator R (1.090 CNAEs), e esse código não existe lá.\n\n` +
      `Do que se trata essa atividade? Me descreva o que a empresa faz para eu funilar e orientar:\n` +
      `• ramo (comércio, indústria ou serviço?)\n` +
      `• atividade (ex.: "venda de roupas", "manutenção elétrica", "consultoria")\n\n` +
      `Ex.: "sou comércio de roupas" ou "CNAE 6201-5/01 qual anexo?" — aí digo o Anexo do Simples na hora.`,
    codigo: digitos,
    tipoCodigo: 'cnae',
    confianca: 0,
    nivel: 'baixa',
    exato: false,
    fontes: ['Tabela CNAE × Anexo Simples + Fator R'],
    sugestoes: ['Sou comércio de roupas, qual anexo?', 'O que você pode fazer?'],
    botoes: [
      { rotulo: 'Abrir Simples Nacional', acao: 'navegar', alvo: 'simples' },
      { rotulo: 'Consultar por CNPJ', acao: 'perguntar', alvo: 'Quais atividades o CNPJ 53.795.990/0001-68 tem?' },
    ],
    pensamento: pensar([PENSAR.entender, PENSAR.consultar(0), PENSAR.validar], `CNAE ${digitos} inexistente → funil`, ms),
  }
}

/**
 * CNAE direto → Anexo do Simples Nacional (tabela viva).
 *
 * Dado exato: 100% match não mostra "nível de confiança". Inexistente cai no
 * funil (`responderCodigoNaoEncontrado`). "Depende da atividade" existe na
 * base, mas o anexo só sai com o contexto — então pergunta o refinamento.
 */
async function responderCnae(
  pergunta: string,
  analise: AnaliseChat,
  historico: MensagemHistorico[] = [],
): Promise<RespostaChat> {
  const t0 = Date.now()
  const ctx = contextoBaseDoTurno(historico)
  const cnae7 = (analise.cnae ?? extrairCnae(pergunta) ?? ctx.ultimoCnae ?? '').replace(/\D+/g, '')
  if (!cnae7 || cnae7.length !== 7) {
    return {
      texto:
        `Para dizer o Anexo do Simples preciso do CNAE (7 dígitos — ex.: 6201-5/01).\n\n` +
        `Me diga o CNAE ou descreva a atividade (ex.: "sou comércio de roupas", "consultoria empresarial") que eu funilo e oriento.`,
      codigo: null,
      tipoCodigo: 'cnae',
      confianca: 0.9,
      nivel: 'alta',
      exato: false,
      fontes: ['Tabela CNAE × Anexo Simples + Fator R'],
      sugestoes: ['CNAE 6201-5/01 qual anexo?', 'Sou comércio de roupas, qual anexo?'],
      botoes: [
        { rotulo: 'Abrir Simples Nacional', acao: 'navegar', alvo: 'simples' },
        { rotulo: 'Consultar por CNPJ', acao: 'perguntar', alvo: 'Quais atividades o CNPJ 53.795.990/0001-68 tem?' },
      ],
      pensamento: pensar([PENSAR.entender, PENSAR.validar], 'CNAE ausente — pedir o código ou a atividade'),
    }
  }
  let registro: import('@/domain/entities').CnaeAnexo | null = null
  try {
    const { db } = await import('@/infrastructure/db/schema')
    registro = (await db.cnae.get(codigo7De(cnae7))) ?? null
  } catch {
    registro = null
  }
  if (!registro) return responderCodigoNaoEncontrado('cnae', cnae7, t0)
  const anexos = Array.isArray(registro.anexos) ? registro.anexos : []
  const rotuloAnexo = rotuloAnexoSimples(anexos)
  const fatorTxt = registro.fatorR || exigePerguntaFatorR(registro)
    ? `\n**Fator R:** a folha de salários (incluindo pró-labore) dos últimos 12 meses representa 28% ou mais do faturamento? Se sim, tende ao Anexo Simples III; se não, ao V.`
    : ''
  const dependeTxt = registro.situacao === 'Depende da atividade'
    ? `\n**Atenção:** a situação é "Depende da atividade" — o CNAE existe, mas o anexo só fecha com o contexto. Me diga o que a empresa faz (comércio/indústria/serviço + atividade) que eu funilo.`
    : registro.situacao === 'Permitido com ressalvas'
      ? `\n**Atenção:** situação "Permitido com ressalvas" — confira as ressalvas do CNAE antes de escriturar.`
      : ''
  void ctx
  return {
    texto:
      `**CNAE ${registro.codigoFormatado} — ${registro.descricao}**\n` +
      `**${rotuloAnexo}**${registro.fatorR ? ' (Fator R)' : ''} · Situação: ${registro.situacao}${fatorTxt}${dependeTxt}\n` +
      `**Base:** tabela viva CNAE × Anexo Simples + Fator R (1.090 CNAEs).\n` +
      `**Próximo passo sugerido:** quer simular o DAS? Me diga RBT12 + receita${registro.fatorR || anexos.includes('V') ? ' (+ folha 12m para o Fator R)' : ''} — ou diga "comparar anexos" que mostro todos.`,
    codigo: codigo7De(cnae7),
    tipoCodigo: 'cnae',
    confianca: 0.95,
    nivel: 'alta',
    exato: true,
    fontes: ['Tabela CNAE × Anexo Simples + Fator R'],
    sugestoes: ['Meu DAS no Anexo III com RBT12 500 mil e receita 40 mil', 'Qual melhor: Anexo III ou V?'],
    botoes: [
      { rotulo: 'Abrir Simples Nacional', acao: 'navegar', alvo: 'simples' },
      { rotulo: 'Consultar por CNPJ', acao: 'perguntar', alvo: 'Quais atividades o CNPJ 53.795.990/0001-68 tem?' },
    ],
    pensamento: pensar([PENSAR.entender, PENSAR.consultar(1), PENSAR.validar], `CNAE ${registro.codigoFormatado} → ${rotuloAnexo} (exato, sem confiança)`, Date.now() - t0),
  }
}

/**
 * Raciocínio em camadas (fine-tuning §5): responde NCM a partir de um gate
 * já validado. `notaDominio` registra quando o item chegou pelo cruzamento
 * (ex.: pergunta genérica "tributação de X" que caiu no NBS primeiro).
 * Retorna `null` quando o gate não ancora em nomenclatura vigente.
 */
async function montarRespostaNcm(
  gate: ResultadoGateIa,
  t0: number,
  extra: {
    composicao: string | null
    destinacao: string | null
    uso: string | null
    termoCurto?: boolean
    notaDominio?: string
    trilha?: string
    /** Follow-up (já classificou antes): fecho curto, sem repetir o agregado. */
    compacto?: boolean
    /** Pergunta plural ("quais NCMs?"): lista NCMs próximos após a sugestão. */
    alternativas?: { codigo: string; descricao: string }[]
  },
): Promise<RespostaChat | null> {
  if (!gate.codigoEscolhido || !gate.ncmValidado) return null
  const resolvido = await resolverClassificacoes(gate.ncmValidado)
  const decisao = resolvido.lista[0]
  if (!decisao || !resolvido.nomenclatura) return null
  const descricao = descricaoLimpa(resolvido.nomenclatura.descricao)
  const compacto = extra.compacto === true
  const conf = gate.confiancaIa > 0 ? gate.confiancaIa : calibrarConfiancaFinal({ baseTexto: 0.6, temVinculo: !resolvido.regraGeral, tokens: 2 })
  const nivel = nivelDeConfianca(conf)
  const calc = calcularTributos(1000, Number(decisao.resumo?.percentualReducaoIBS) || 0, Number(decisao.resumo?.percentualReducaoCBS) || 0, REF_DEFAULT.IBS, REF_DEFAULT.CBS)
  const hipotese = gate.veredito?.exigeVerificacao ? `Hipótese a verificar: ${gate.veredito.mensagemHipotese ?? ''} O cálculo usa a alíquota cheia.` : ''
  const composicaoLinha = extra.composicao ? `Composição informada: ${extra.composicao}${extra.destinacao ? ` · destinação: ${extra.destinacao}` : ''}${extra.uso ? ` · uso: ${extra.uso}` : ''}\n` : ''
  const vaga = extra.termoCurto && !extra.composicao
    ? `\nDescrição curta — projetei o mais próximo do contexto. Detalhe material/composição + uso para afunilar.`
    : ''
  const baseLegalLinha = (decisao as { baseLegal?: string }).baseLegal ?? `TEC vigente + LC 214/2025 (CST ${decisao.cst} · cClassTrib ${decisao.cClassTrib})`
  const atencao = hipotese
    ? `\n**Pontos de atenção:** ${hipotese}`
    : compacto
      ? ``
      : `\n**Pontos de atenção:** confirme estado (in natura × processado), destino e regime; na transição 2026–2033 o tratamento pode diferir por vigência`
  const fecho = compacto
    ? `**Quer detalhar?** Diga o valor da operação, "tem mais algum?" para ver as opções, ou confirme na Consulta NCM.`
    : `**Próximo passo sugerido:** quer a tributação detalhada deste NCM? Me diga o valor da operação que calculo IBS/CBS na hora — ou valide na Consulta NCM antes de escriturar.`
  const blocoAlternativas = extra.alternativas?.length
    ? `\n**Outras possibilidades:**\n${extra.alternativas.map((a) => `• NCM ${fmtNcm(a.codigo)} — ${descricaoLimpa(a.descricao).slice(0, 90)}`).join('\n')}`
    : ''
  const multiAviso = !resolvido.regraGeral && resolvido.lista.length > 1 && !extra.alternativas?.length
    ? `\nEste NCM tem ${resolvido.lista.length} enquadramentos oficiais — diga "só tem esse?" para ver todos.`
    : ''
  return {
    texto:
      `${extra.notaDominio ? `${extra.notaDominio}\n` : ''}` +
      `**Classificação sugerida: NCM ${fmtNcm(gate.ncmValidado)} — ${descricao}**\n` +
      `${composicaoLinha}` +
      `**Justificativa técnica:** ${gate.sugestao?.justificativa ?? `cruzamento da descrição${extra.composicao ? ' + composição' : ''} com a nomenclatura TEC e as regras gerais de interpretação (RGI 1 + RGI 6)`} ` +
      `Enquadramento CST ${decisao.cst} · cClassTrib ${decisao.cClassTrib}.\n` +
      `**Base legal:** ${baseLegalLinha}\n` +
      `**Nível de confiança: ${rotuloNivel(nivel, conf)}**\n` +
      `**Simulação de referência (R$ 1.000,00):** IBS ${fmtMoeda(calc.vIBS)} + CBS ${fmtMoeda(calc.vCBS)} = ${fmtMoeda(calc.total)}` +
      `${atencao ? `${atencao}` : ''}${vaga}${multiAviso}${blocoAlternativas}\n` +
      `${fecho}`,
    codigo: gate.ncmValidado,
    tipoCodigo: 'ncm',
    confianca: conf,
    nivel,
    fontes: gate.fontes?.length ? gate.fontes : ['Nomenclatura vigente (TEC)', 'Vínculos oficiais da Reforma (CST × cClassTrib)'],
    sugestoes: compacto ? [`Quanto fica R$ 1.000 no NCM ${fmtNcm(gate.ncmValidado)}?`] : [`Quanto fica R$ 1.000 no NCM ${fmtNcm(gate.ncmValidado)}?`, 'Gera um relatório desse cálculo'],
    botoes: compacto
      ? [
        { rotulo: 'Classificar oficialmente', acao: 'navegar', alvo: 'consulta' },
        { rotulo: `Quanto fica R$ 1.000?`, acao: 'perguntar', alvo: `Quanto fica R$ 1.000 no NCM ${fmtNcm(gate.ncmValidado)}?` },
      ]
      : [
        { rotulo: 'Classificar oficialmente', acao: 'navegar', alvo: 'consulta' },
        { rotulo: `Quanto fica R$ 1.000?`, acao: 'perguntar', alvo: `Quanto fica R$ 1.000 no NCM ${fmtNcm(gate.ncmValidado)}?` },
        { rotulo: 'Baixar relatório', acao: 'baixar', alvo: 'relatorio' },
      ],
    pensamento: pensar(
      [PENSAR.entender, PENSAR.consultar(gate.candidatos.length), PENSAR.analisar, PENSAR.validar],
      `Base oficial → NCM ${fmtNcm(gate.ncmValidado)} · ${gate.ms}ms${extra.composicao ? ` · composição: ${extra.composicao}` : ''}${extra.trilha ? ` · ${extra.trilha}` : ''}${compacto ? ' · follow-up compacto' : ''}`,
      Date.now() - t0,
    ),
  }
}

/**
 * Resposta direta à pergunta sobre OPÇÕES ("só tem um?", "quais NCMs?"):
 * lista os enquadramentos oficiais do NCM + NCMs próximos, sem refazer
 * a classificação inteira nem repetir o agregado da primeira resposta.
 */
async function responderOpcoesNcm(
  codigo: string,
  assunto: string | null,
  candidatos: { codigo: string; descricao: string }[],
  t0: number,
): Promise<RespostaChat> {
  const r = await resolverClassificacoes(codigo)
  if (!r.lista.length || !r.nomenclatura) return semLastro()
  const nome = assunto ? ` para "${assunto}"` : ''
  const linhas = r.lista.map((cl, i) => {
    const red = `${cl.resumo?.percentualReducaoIBS ?? 0}% IBS / ${cl.resumo?.percentualReducaoCBS ?? 0}% CBS`
    return `${i + 1}. CST ${cl.cst} · cClassTrib ${cl.cClassTrib} — red. ${red}`
  }).join('\n')
  const vereditoQtd = r.lista.length > 1
    ? `Não — o NCM ${fmtNcm(codigo)}${nome} tem **${r.lista.length} enquadramentos oficiais**:`
    : `Sim — o NCM ${fmtNcm(codigo)}${nome} tem **1 enquadramento oficial**:`
  const outros = (candidatos ?? []).filter((c) => norm(c.codigo) !== norm(codigo)).slice(0, 4)
  const blocoOutros = outros.length
    ? `\n**NCMs próximos (outras possibilidades):**\n${outros.map((c) => `• NCM ${fmtNcm(c.codigo)} — ${descricaoLimpa(c.descricao).slice(0, 90)}`).join('\n')}`
    : ''
  return {
    texto:
      `${vereditoQtd}\n${linhas}${blocoOutros}\n` +
      `**Quer detalhar?** Diga o número da opção ou "quanto fica R$ 1.000 no NCM ${fmtNcm(codigo)}?".`,
    codigo,
    tipoCodigo: 'ncm',
    confianca: 0.9,
    nivel: 'alta',
    fontes: ['Nomenclatura vigente (TEC)', 'Vínculos oficiais da Reforma (CST × cClassTrib)'],
    sugestoes: [`Quanto fica R$ 1.000 no NCM ${fmtNcm(codigo)}?`],
    botoes: [
      { rotulo: 'Classificar oficialmente', acao: 'navegar', alvo: 'consulta' },
      { rotulo: `Quanto fica R$ 1.000?`, acao: 'perguntar', alvo: `Quanto fica R$ 1.000 no NCM ${fmtNcm(codigo)}?` },
    ],
    pensamento: pensar([PENSAR.entender, PENSAR.validar], `Opções do NCM ${fmtNcm(codigo)} → ${r.lista.length} enquadramento(s) + ${outros.length} próximos`, Date.now() - t0),
  }
}

/** Resposta NBS a partir de um gate validado (o cross NBS→NCM usa `montarRespostaNcm`). */
function montarRespostaNbs(gate: ResultadoGateIaServicos, t0: number, notaDominio?: string, compacto = false): RespostaChat | null {
  if (!gate.codigoEscolhido || !gate.nbsValidado) return null
  const conf = gate.confiancaIa > 0 ? gate.confiancaIa : 0.4
  const nivel = nivelDeConfianca(conf)
  const ficha = gate.ficha
  const titulo = descricaoLimpa(ficha?.titulo ?? gate.sugestao?.justificativa ?? 'serviço classificado')
  const fecho = compacto
    ? `**Quer detalhar?** Me diga o valor, o CNPJ ou "tem mais algum?" para ver as opções.`
    : `**Próximo passo sugerido:** quer a tributação deste NBS ou simular no Simples? Me diga o valor/CNPJ — e se for empresa, posso listar as atividades pelo CNPJ.`
  return {
    texto:
      `${notaDominio ? `${notaDominio}\n` : ''}` +
      `**Classificação sugerida: NBS ${fmtNbs(gate.nbsValidado)} — ${titulo}**\n` +
      `**Justificativa técnica:** ${gate.sugestao?.justificativa ?? 'cruzamento da descrição do serviço com a base NBS × CST × cClassTrib'} ` +
      `${ficha ? `Enquadramento CST ${ficha.cst} · cClassTrib ${ficha.cClassTrib}${ficha.anexo ? ` · Anexo LC 214 ${ficha.anexo}` : ''}.` : ''}\n` +
      `**Base legal:** LC 214/2025${ficha ? ` (CST ${ficha.cst} · cClassTrib ${ficha.cClassTrib})` : ''} + LC 116/2003 (ISS municipal, conforme o serviço)\n` +
      `**Nível de confiança: ${rotuloNivel(nivel, conf)}**\n` +
      `${compacto ? '' : `**Pontos de atenção:** confirme tomador, local da prestação e vigência (transição 2026–2033); ISS varia por município.\n`}` +
      `${fecho}`,
    codigo: gate.nbsValidado,
    tipoCodigo: 'nbs',
    confianca: conf,
    nivel,
    fontes: gate.fontes?.length ? gate.fontes : ['Vínculos NBS × CST × cClassTrib (LC 214/2025)', 'LC 116/2003 (serviços)'],
    sugestoes: compacto ? ['Qual melhor: Anexo III ou V?'] : ['Quais atividades o CNPJ 53.795.990/0001-68 tem?', 'Qual melhor: Anexo III ou V?'],
    botoes: compacto
      ? [
        { rotulo: 'Abrir Serviços (NBS)', acao: 'navegar', alvo: 'servicos' },
        { rotulo: 'Consultar por CNPJ', acao: 'perguntar', alvo: 'Quais atividades o CNPJ 53.795.990/0001-68 tem?' },
      ]
      : [
        { rotulo: 'Abrir Serviços (NBS)', acao: 'navegar', alvo: 'servicos' },
        { rotulo: 'Consultar por CNPJ', acao: 'perguntar', alvo: 'Quais atividades o CNPJ 53.795.990/0001-68 tem?' },
        { rotulo: 'Baixar relatório', acao: 'baixar', alvo: 'relatorio' },
      ],
    pensamento: pensar(
      [PENSAR.entender, PENSAR.consultar(gate.candidatos.length), PENSAR.analisar, PENSAR.validar],
      `Base oficial → NBS ${fmtNbs(gate.nbsValidado)} · ${gate.ms}ms${notaDominio ? ` · ${notaDominio.replace(/\*\*/g, '')}` : ''}${compacto ? ' · follow-up compacto' : ''}`,
      Date.now() - t0,
    ),
  }
}

/**
 * Opções do NBS ("só tem um?"): lista os enquadramentos oficiais.
 */
async function responderOpcoesNbs(codigo: string, t0: number): Promise<RespostaChat> {
  const r = await resolverClassificacoesNbs(codigo)
  if (!r.lista.length) return semLastro()
  const linhas = r.lista.map((cl, i) => {
    const red = `${cl.resumo?.percentualReducaoIBS ?? 0}% IBS / ${cl.resumo?.percentualReducaoCBS ?? 0}% CBS`
    return `${i + 1}. CST ${cl.cst} · cClassTrib ${cl.cClassTrib} — red. ${red}`
  }).join('\n')
  const vereditoQtd = r.lista.length > 1
    ? `Não — o NBS ${fmtNbs(codigo)} tem **${r.lista.length} enquadramentos oficiais**:`
    : `Sim — o NBS ${fmtNbs(codigo)} tem **1 enquadramento oficial**:`
  return {
    texto: `${vereditoQtd}\n${linhas}\n**Quer detalhar?** Diga o número da opção ou me passe o CNPJ para simular no Simples.`,
    codigo,
    tipoCodigo: 'nbs',
    confianca: 0.9,
    nivel: 'alta',
    fontes: ['Vínculos NBS × CST × cClassTrib (LC 214/2025)'],
    sugestoes: ['Qual melhor: Anexo III ou V?'],
    botoes: [{ rotulo: 'Abrir Serviços (NBS)', acao: 'navegar', alvo: 'servicos' }],
    pensamento: pensar([PENSAR.entender, PENSAR.validar], `Opções do NBS ${fmtNbs(codigo)} → ${r.lista.length} enquadramento(s)`, Date.now() - t0),
  }
}

/* --------------------------------- fine-tuning fiscal (template) --
 * Template fixo §6 do estudo: toda classificação segue
 * Classificação sugerida → Justificativa → Base legal → Confiança →
 * Pontos de atenção → Próximo passo. O modelo SUGERE, nunca decide —
 * a decisão final é humana (contador/contribuinte).
 */

function rotuloNivel(nivel: 'alta' | 'media' | 'baixa', conf: number): string {
  const pct = fmtConfiancaAurumAI(conf)
  if (nivel === 'alta') return `Alta (${pct}) — classificação homologada na base interna ou norma inequívoca`
  if (nivel === 'media') return `Média (${pct}) — hipótese provisória com lastro oficial, a verificar com 1–2 detalhes`
  return `Baixa (${pct}) — inferência com lastro parcial, requer validação humana`
}

/** TI genérico? (programação/dev/software/SaaS/suporte — sem termo de segurança). */
function ehTiGenerico(texto: string): boolean {
  const n = String(texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
  if (/cibersegur|firewall|pentest|antivirus|criptografia|lgpd|backup|nuvem|cloud|socia?o.*brasileir|20%/.test(n)) return false
  return /programa[cç][aã]o|desenvolv\w*\s+(de\s+)?(software|sistema|aplicativo|app|programa)|software|saas|licenciamento|suporte\s+(tecnico|helpdesk)|computador(es)?\s+(program|desenv)|dev\b|web\s*design|consultoria\s+em\s+ti|tecnologia\s+da\s+informa/.test(n)
}

/** Texto curado TI: CNAEs 6201–6209 + LC 116 item 1 + LC 214 (regra geral). */
function textoTiGenerico(): { texto: string; sugestoes: string[]; botoes: BotaoChat[] } {
  return {
    texto:
      `**Classificação sugerida: regra geral — tributação integral (CST 000 · cClassTrib 000001)**\n` +
      `Programação/desenvolvimento genérico não tem NBS com benefício na base vigente (112 NBS) — cai na regra geral.\n` +
      `**Justificativa técnica:** o termo mapeia para serviços genéricos, não para cibersegurança do Anexo XI (exige sócio BR ≥ 20%).\n` +
      `**Base legal:** LC 116/2003 item 1 (informática — ISS municipal) · LC 214/2025 regra geral · CNAEs 6201-5/01, 6202-3/00, 6203-1/00, 6204-0/00, 6209-1/00 (Simples III/V via Fator R).\n` +
      `**Confiança: Média** — ausência de benefício é inequívoca; o enquadramento exato depende do modelo de negócio.\n` +
      `**Atenção:**\n` +
      `• Encomenda × licenciamento × SaaS × suporte têm CNAE/Anexo distintos (III/V via Fator R ≥ 28%)\n` +
      `• Segurança da informação com sócio BR ≥ 20% (Anexo XI) tem redução — me diga que reavalio\n` +
      `**Próximo passo:** me diga o modelo (encomenda, licenciamento, SaaS, suporte, segurança?) ou o CNPJ — puxo as atividades e simulo o Simples.`,
    sugestoes: [
      'Quais atividades o CNPJ 53.795.990/0001-68 tem?',
      'Meu DAS no Anexo III com RBT12 500 mil e receita 40 mil',
      'Qual melhor: Anexo III ou V?',
    ],
    botoes: [
      { rotulo: 'Abrir Serviços (NBS)', acao: 'navegar', alvo: 'servicos' },
      { rotulo: 'Consultar por CNPJ', acao: 'perguntar', alvo: 'Quais atividades o CNPJ 53.795.990/0001-68 tem?' },
      { rotulo: 'Abrir Simples Nacional', acao: 'navegar', alvo: 'simples' },
    ],
  }
}

/* ------------------------------------------------------------- NCM -- */

async function responderNcm(pergunta: string, analise: AnaliseChat, historico: MensagemHistorico[] = [], memoria?: MemoriaSistema | null): Promise<RespostaChat> {
  const t0 = Date.now()
  const perguntaOpcoes = ehPerguntaOpcoes(pergunta)
  const compacto = houveClassificacaoAntes(historico)
  // Contexto = histórico + artefato-resumo cifrado (chat novo). O presente
  // vence o passado: o artefato só preenche o que o histórico não diz.
  const ctxMem = mesclarContextoComArtefato(contextoBaseDoTurno(historico), memoria)
  // Em chat novo o artefato também autoriza o re-ancoramento (sem ele, o
  // andaime "só tem esse?" sem histórico classificaria o andaime).
  const reancorar = compacto || !!memoria?.assunto
  // Follow-up sobre opções sem código na frase ("só tem um?") → usa o código
  // do contexto direto (determinístico, sem RAG): lista os enquadramentos.
  // O contexto inclui o código classificado pela assistente (formatado
  // `0403.20.00`), então "só tem esse?" após "ncm de danone" cai aqui.
  if (perguntaOpcoes && (compacto || ctxMem.ultimoCodigoNcm) && !/\d{8}/.test(pergunta)) {
    const ctxOp = ctxMem
    const codCtx = ctxOp.ultimoCodigoNcm ?? ultimoCodigoHistorico(historico)
    if (codCtx && codCtx.length === 8) {
      let proximos: { codigo: string; descricao: string }[] = []
      try {
        if (ctxOp.ultimoAssunto) {
          const { buscarNomenclaturaPorTexto } = await import('@/infrastructure/base/classificacao-repo')
          const achados = await buscarNomenclaturaPorTexto(ctxOp.ultimoAssunto, 5).catch(() => [])
          proximos = (achados ?? [])
            .filter((a) => String(a.codigo).replace(/\D+/g, '') !== codCtx)
            .slice(0, 4)
            .map((a) => ({ codigo: String(a.codigo).replace(/\D+/g, ''), descricao: a.descricao }))
        }
      } catch {
        proximos = []
      }
      return responderOpcoesNcm(codCtx, ctxOp.ultimoAssunto, proximos, t0)
    }
  }
  if (analise.codigoDigitos?.length === 8) {
    // "só tem esse (NCM)?" com código direto → lista os enquadramentos.
    if (perguntaOpcoes) {
      return responderOpcoesNcm(analise.codigoDigitos, null, [], t0)
    }
    const r = await resolverClassificacoes(analise.codigoDigitos)
    if (r.lista.length && r.nomenclatura) {
      const cl = r.lista[0]
      const calc = calcularTributos(1000, Number(cl.resumo?.percentualReducaoIBS) || 0, Number(cl.resumo?.percentualReducaoCBS) || 0, REF_DEFAULT.IBS, REF_DEFAULT.CBS)
      const multi = !r.regraGeral && r.lista.length > 1 ? `Este NCM possui ${r.lista.length} classificações possíveis — confira na Consulta NCM antes de escriturar. ` : ''
      const baseLegalDir = (cl as { baseLegal?: string }).baseLegal ?? `TEC vigente + LC 214/2025 (CST ${cl.cst} · cClassTrib ${cl.cClassTrib})`
      // Dado exato (100% match na base): sem "nível de confiança" — ou existe ou não existe.
      return {
        texto:
          `**NCM ${fmtNcm(r.nomenclatura.codigoOriginal)} — ${descricaoLimpa(r.nomenclatura.descricao)}**\n` +
          `Código confirmado na base vigente (TEC + vínculos oficiais da Reforma). Enquadramento CST ${cl.cst} · cClassTrib ${cl.cClassTrib}.\n` +
          `**Base legal:** ${baseLegalDir}\n` +
          `**Redução vigente:** ${cl.resumo?.percentualReducaoIBS ?? 0}% IBS / ${cl.resumo?.percentualReducaoCBS ?? 0}% CBS\n` +
          `**Simulação de referência (R$ 1.000,00):** IBS ${fmtMoeda(calc.vIBS)} + CBS ${fmtMoeda(calc.vCBS)} = ${fmtMoeda(calc.total)}\n` +
          `**Pontos de atenção:** ${multi}confirme vigência (NCM extinto/cClassTrib revogado) e o regime na transição 2026–2033.\n` +
          `**Próximo passo sugerido:** quer a tributação detalhada? Me diga o valor da operação que calculo IBS/CBS — ou valide na Consulta NCM antes de escriturar.`,
        codigo: norm(analise.codigoDigitos),
        tipoCodigo: 'ncm',
        confianca: 0.95,
        nivel: 'alta',
        exato: true,
        fontes: ['Nomenclatura vigente (TEC)', 'Vínculos oficiais da Reforma (CST × cClassTrib)', 'Vigência (NCM extinto · cClassTrib · revogação CFF)'],
        sugestoes: [`Quanto fica R$ 1.000 no NCM ${fmtNcm(analise.codigoDigitos)}?`, 'Gera um relatório desse cálculo'],
        botoes: [
          { rotulo: 'Classificar oficialmente', acao: 'navegar', alvo: 'consulta' },
          { rotulo: 'Quanto fica R$ 1.000?', acao: 'perguntar', alvo: `Quanto fica R$ 1.000 no NCM ${fmtNcm(analise.codigoDigitos)}?` },
          { rotulo: 'Baixar relatório', acao: 'baixar', alvo: 'relatorio' },
        ],
        pensamento: pensar([PENSAR.entender, PENSAR.validar, PENSAR.calcular], 'Código direto validado no resolvedor (exato, sem confiança)', Date.now() - t0),
      }
    }
    // Código exato que NÃO existe na base: funil ("do que se trata?"), sem confiança.
    return responderCodigoNaoEncontrado('ncm', analise.codigoDigitos, t0)
  }
  // Núcleo da pergunta ("Tem no sistema alguma tributação para abacate?"
  // → "abacate"): a pergunta inteira NUNCA vira termo de busca. O modelo é
  // multilíngue nativo — sem camada de tradução, o núcleo vai puro ao RAG.
  const nucleo = extrairNucleoBusca(pergunta)
  const termo = (nucleo ?? analise.termoBusca).trim() || analise.termoBusca
  // Composição/destinação/uso em linguagem natural ("composição: ...",
  // "composto por...", "100% algodão", "para revenda") — antes o chat
  // descartava e classificava só pela descrição curta.
  const slots = extrairSlotsProduto(pergunta)
  // Follow-up sem conteúdo classificável ("só tem um?", "tem mais algum?",
  // "lista todos") → reancora no assunto anterior em vez de classificar o
  // andaime ("só tem um" não é produto).
  let termoEfetivo = termo
  let slotsEfetivos = slots
  if (reancorar) {
    const assuntoCtx = ctxMem.ultimoAssunto
    if (assuntoCtx && assuntosDiferem(assuntoCtx, termo)) {
      const resto = termo
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\b(s[oó]|tem|um|uma|esse|essa|isso|mais|algum|alguma|outro|outra|outros|outras|opcoes|opcao|alternativas|alternativa|lista|todos|todas|quais|quantos|ncm|ncms|nbs|codigo|codigos|para|de|do|da|e|o|a)\b/g, '')
        .replace(/\W+/g, '')
      if (resto.length < 3) {
        termoEfetivo = assuntoCtx
        slotsEfetivos = extrairSlotsProduto(assuntoCtx)
      }
    }
  }
  // Aprendizado contínuo: termo já confirmado antes (peso ≥ 2) vira atalho
  // validado pelo resolvedor — mais rápido (sem RAG) e mais assertivo.
  try {
    const fato = await fatoAprendidoPara(termoEfetivo).catch(() => null)
    if (fato && fato.peso >= 2 && fato.tipo === 'ncm' && fato.codigo.length === 8) {
      const rv = await resolverClassificacoes(fato.codigo).catch(() => null)
      if (rv && rv.lista.length && rv.nomenclatura) {
        const gateAtalho = {
          via: 'ia' as const,
          sugestao: {
            ncm_provavel: fato.codigo,
            descricao_ncm: null,
            excecao_enquadravel: false,
            tipo_excecao: null,
            justificativa: `Aprendizado da conversa: "${termoEfetivo}" confirmado para este NCM em interações anteriores.`,
            confianca: 'alta' as const,
            alternativas: [],
            cst: null,
            cClassTrib: null,
            anexo: null,
            baseLegal: null,
            urlLegislacao: null,
            perguntasComplementares: [],
            trilha: [],
          },
          candidatos: [],
          codigoEscolhido: fato.codigo,
          confiancaIa: 0.85,
          motivo: 'aprendizado-conversa-confirmado',
          mock: false,
          ncmValidado: fato.codigo,
          regraGeral: rv.regraGeral,
          ms: Date.now() - t0,
          ficha: null,
          veredito: null,
          fontes: ['Nomenclatura vigente (TEC)', 'Vínculos oficiais da Reforma (CST × cClassTrib)', 'Memória local da Aurum AI (aprendizado confirmado)'],
        }
        const respAtalho = await montarRespostaNcm(gateAtalho, t0, {
          composicao: slotsEfetivos.composicao,
          destinacao: slotsEfetivos.destinacao,
          uso: slotsEfetivos.uso,
          termoCurto: termoEfetivo.trim().split(/\s+/).length <= 2,
          trilha: `atalho de aprendizado ("${termoEfetivo}")`,
          compacto,
        })
        if (respAtalho) return respAtalho
      }
    }
  } catch {
    /* atalho é best-effort — segue para o gate normal */
  }
  // Domínio primeiro: serviço explícito no núcleo → NBS antes do NCM.
  const dominio = classificarDominio(termoEfetivo)
  if (dominio === 'servico') {
    const gateNbsDom = await classificarComIaServicos({ descricao: termoEfetivo })
    const respNbsDom = montarRespostaNbs(
      gateNbsDom,
      t0,
      `Identifiquei como **serviço** — consultei a base NBS primeiro.`,
      compacto,
    )
    if (respNbsDom) return respNbsDom
  }
  const gate = await classificarComIa({
    descricao: termoEfetivo,
    composicao: slotsEfetivos.composicao ?? undefined,
    destinacao: slotsEfetivos.destinacao ?? undefined,
    uso: slotsEfetivos.uso ?? undefined,
  })
  // Follow-up sobre opções ("só tem um?") → lista enquadramentos + próximos,
  // sem refazer a classificação nem repetir o agregado.
  if (perguntaOpcoes && compacto && gate.ncmValidado) {
    return responderOpcoesNcm(gate.ncmValidado, termoEfetivo, gate.candidatos ?? [], t0)
  }
  const alternativas = perguntaOpcoes
    ? (gate.candidatos ?? []).filter((c) => norm(c.codigo) !== norm(gate.ncmValidado ?? '')).slice(0, 4)
    : undefined
  let respNcm = await montarRespostaNcm(gate, t0, {
    composicao: slotsEfetivos.composicao,
    destinacao: slotsEfetivos.destinacao,
    uso: slotsEfetivos.uso,
    termoCurto: termoEfetivo.trim().split(/\s+/).length <= 2,
    trilha: nucleo ? `núcleo "${nucleo}"` : undefined,
    compacto,
    alternativas,
  })
  if (!respNcm) {
    // Camada 1b: refino com o assunto da conversa ("camiseta" + "100%
    // algodão"): o assunto ancora, os detalhes saem da frase atual.
    const assunto = ctxMem.ultimoAssunto
    if (assunto && assuntosDiferem(assunto, termo)) {
      const slotsAssunto = extrairSlotsProduto(`${assunto} ${pergunta}`)
      const gateAssunto = await classificarComIa({
        descricao: assunto,
        composicao: slotsAssunto.composicao ?? undefined,
        destinacao: slotsAssunto.destinacao ?? undefined,
        uso: slotsAssunto.uso ?? undefined,
      })
      respNcm = await montarRespostaNcm(gateAssunto, t0, {
        composicao: slotsAssunto.composicao,
        destinacao: slotsAssunto.destinacao,
        uso: slotsAssunto.uso,
        trilha: `refino de "${assunto}"`,
        compacto: true,
      })
    }
  }
  if (respNcm) return respNcm
  // Camada 2 do raciocínio: não é produto? Cruza na base de SERVIÇOS com o
  // mesmo núcleo antes de desistir ("tributação de X" pode ser serviço).
  const gateNbs = await classificarComIaServicos({ descricao: termo })
  const respNbs = montarRespostaNbs(
    gateNbs,
    t0,
    `Pelo contexto entendi que pode ser um serviço — cruzei na base NBS.`,
  )
  if (respNbs) return respNbs
  return semLastro(nucleo ?? termo, ['NCM', 'NBS'])
}

/* ------------------------------------------------------------- NBS -- */

async function responderNbs(pergunta: string, analise: AnaliseChat, historico: MensagemHistorico[] = [], memoria?: MemoriaSistema | null): Promise<RespostaChat> {
  const t0 = Date.now()
  const ctxMemNbs = mesclarContextoComArtefato(contextoBaseDoTurno(historico), memoria)
  const reancorarNbs = houveClassificacaoAntes(historico) || !!memoria?.assunto
  if (analise.codigoDigitos?.length === 9) {
    // "só tem esse (NBS)?" com código direto → lista os enquadramentos.
    if (ehPerguntaOpcoes(pergunta)) {
      return responderOpcoesNbs(analise.codigoDigitos, t0)
    }
    const r = await resolverClassificacoesNbs(analise.codigoDigitos)
    // Exato = vínculo real na base. Regra geral (sem vínculo) = código
    // inexistente → funil, sem confiança.
    if (!r.regraGeral && r.lista.length) {
      const cl = r.lista[0]
      // Dado exato (100% match na base): sem "nível de confiança" — ou existe ou não existe.
      return {
        texto:
          `**NBS ${fmtNbs(analise.codigoDigitos)} — ${cl.resumo?.descricaoCClassTrib || cl.descricao}**\n` +
          `Código confirmado na base vigente (NBS × CST × cClassTrib).\n` +
          `**Base legal:** LC 214/2025 (CST ${cl.cst} · cClassTrib ${cl.cClassTrib})\n` +
          `**Redução vigente:** ${cl.resumo?.percentualReducaoIBS ?? 0}% IBS / ${cl.resumo?.percentualReducaoCBS ?? 0}% CBS\n` +
          `**Pontos de atenção:** confirme o Anexo da LC 214 e a vigência na transição 2026–2033.\n` +
          `**Próximo passo sugerido:** quer simular a tributação ou o Simples para esta atividade? Me diga o valor/CNPJ que projeto.`,
        codigo: norm(analise.codigoDigitos),
        tipoCodigo: 'nbs',
        confianca: 0.95,
        nivel: 'alta',
        exato: true,
        fontes: ['Vínculos NBS × CST × cClassTrib (LC 214/2025)'],
        sugestoes: ['Quais atividades o CNPJ 53.795.990/0001-68 tem?', 'Qual melhor: Anexo III ou V?'],
        botoes: [
          { rotulo: 'Abrir Serviços (NBS)', acao: 'navegar', alvo: 'servicos' },
          { rotulo: 'Simular no Simples', acao: 'navegar', alvo: 'simples' },
        ],
        pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Código direto validado no resolvedor (exato, sem confiança)', Date.now() - t0),
      }
    }
    // Código exato que NÃO existe na base: funil ("do que se trata?"), sem confiança.
    return responderCodigoNaoEncontrado('nbs', analise.codigoDigitos, t0)
  }
  // TI genérico (programação de computadores, dev, SaaS, suporte): resposta
  // proativa curada — regra geral + CNAEs + LC 116 + Fator R + upsell CNPJ.
  // Antes caía no "sem lastro"/regra geral seca e o usuário ficava sem rumo.
  if (ehTiGenerico(`${pergunta} ${analise.termoBusca}`)) {
    const curado = textoTiGenerico()
    return {
      texto: curado.texto,
      codigo: null,
      tipoCodigo: 'nbs',
      confianca: 0.6,
      nivel: 'media',
      fontes: ['Vínculos NBS × CST × cClassTrib (LC 214/2025)', 'LC 116/2003 item 1 (serviços de informática)', 'Tabela CNAE × Anexo Simples + Fator R'],
      sugestoes: curado.sugestoes,
      botoes: curado.botoes,
      pensamento: pensar([PENSAR.entender, PENSAR.validar], 'TI genérico → regra geral + desambiguação CNAE/LC116', Date.now() - t0),
    }
  }
  // Núcleo da pergunta (mesmo raciocínio do NCM: andaime quebra o AND).
  const nucleo = extrairNucleoBusca(pergunta)
  const termo = (nucleo ?? analise.termoBusca).trim() || analise.termoBusca
  const perguntaOpcoes = ehPerguntaOpcoes(pergunta)
  const compacto = houveClassificacaoAntes(historico)
  // Follow-up sobre opções sem código ("só tem um?") → código do contexto.
  if (perguntaOpcoes && (compacto || ctxMemNbs.ultimoCodigoNbs) && !/\d{9}/.test(pergunta)) {
    const codCtx = ctxMemNbs.ultimoCodigoNbs
    if (codCtx && codCtx.length === 9) {
      return responderOpcoesNbs(codCtx, t0)
    }
  }
  // Follow-up sem conteúdo ("só tem um?") → reancora no assunto anterior.
  let termoEfetivo = termo
  if (reancorarNbs) {
    const assuntoCtx = ctxMemNbs.ultimoAssunto
    if (assuntoCtx && assuntosDiferem(assuntoCtx, termo)) {
      const resto = termo
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\b(s[oó]|tem|um|uma|esse|essa|isso|mais|algum|alguma|outro|outra|outros|outras|opcoes|opcao|alternativas|alternativa|lista|todos|todas|quais|quantos|ncm|ncms|nbs|codigo|codigos|para|de|do|da|e|o|a)\b/g, '')
        .replace(/\W+/g, '')
      if (resto.length < 3) termoEfetivo = assuntoCtx
    }
  }
  // Domínio primeiro: produto explícito no núcleo → NCM antes do NBS.
  if (classificarDominio(termoEfetivo) === 'produto') {
    const gateNcmDom = await classificarComIa({ descricao: termoEfetivo })
    const respNcmDom = await montarRespostaNcm(gateNcmDom, t0, {
      composicao: null,
      destinacao: null,
      uso: null,
      termoCurto: termoEfetivo.trim().split(/\s+/).length <= 2,
      notaDominio: `Identifiquei como **produto** — consultei a base NCM primeiro.`,
      trilha: 'domínio: produto',
      compacto,
    })
    if (respNcmDom) return respNcmDom
  }
  const gate = await classificarComIaServicos({ descricao: termoEfetivo })
  // Follow-up sobre opções ("só tem um?") → lista os enquadramentos do NBS.
  if (perguntaOpcoes && compacto && gate.nbsValidado) {
    return responderOpcoesNbs(gate.nbsValidado, t0)
  }
  let respNbs = montarRespostaNbs(gate, t0, undefined, compacto)
  if (!respNbs) {
    // Refino com o assunto da conversa (espelho do NCM).
    const assunto = ctxMemNbs.ultimoAssunto
    if (assunto && assuntosDiferem(assunto, termo)) {
      const gateAssunto = await classificarComIaServicos({ descricao: assunto })
      respNbs = montarRespostaNbs(gateAssunto, t0, `Refinei com "${assunto}" da nossa conversa.`, true)
    }
  }
  if (respNbs) return respNbs
  // Sem NBS ancorado, mas o determinístico já explicou (setor/regra geral/
  // hipótese de benefício em `sugestao.justificativa`): surface a explicação
  // honesta em vez de cair no funil genérico de produto. É o caso de serviços
  // sem benefício mapeado (ex.: "consultoria") — regra geral, não "não achei".
  const justDet = gate.sugestao?.justificativa?.trim()
  if (justDet && !gate.sugestao?.foraDeEscopo && justDet.length >= 20) {
    return {
      texto:
        `${justDet}\n\n` +
        `**Base:** vínculos NBS × CST × cClassTrib (LC 214/2025) + LC 116/2003 (ISS municipal).\n` +
        `**Próximo passo sugerido:** me diga o tomador (empresa ou pessoa física?), o local da prestação ou o CNPJ — puxo CNAEs + Anexo do Simples e simulo o DAS.`,
      codigo: null,
      tipoCodigo: 'nbs',
      confianca: 0.4,
      nivel: 'media',
      fontes: ['Vínculos NBS × CST × cClassTrib (LC 214/2025)', 'LC 116/2003 (serviços)'],
      sugestoes: ['Quais atividades o CNPJ 53.795.990/0001-68 tem?', 'Qual melhor: Anexo III ou V?'],
      botoes: [
        { rotulo: 'Abrir Serviços (NBS)', acao: 'navegar', alvo: 'servicos' },
        { rotulo: 'Consultar por CNPJ', acao: 'perguntar', alvo: 'Quais atividades o CNPJ 53.795.990/0001-68 tem?' },
      ],
      pensamento: pensar(
        [PENSAR.entender, PENSAR.consultar(gate.candidatos.length), PENSAR.validar],
        `NBS sem vínculo ancorado → explicação honesta do determinístico ("${termoEfetivo}")`,
        Date.now() - t0,
      ),
    }
  }
  // Camada 2 do raciocínio: não é serviço? Cruza na base de PRODUTOS (NCM)
  // com o mesmo núcleo antes de desistir.
  const gateNcm = await classificarComIa({ descricao: termoEfetivo })
  const respNcm = await montarRespostaNcm(gateNcm, t0, {
    composicao: null,
    destinacao: null,
    uso: null,
    termoCurto: termoEfetivo.trim().split(/\s+/).length <= 2,
    notaDominio: `Pelo contexto entendi que pode ser um produto — cruzei na base NCM.`,
    trilha: 'cruzamento NBS→NCM',
    compacto,
  })
  if (respNcm) return respNcm
  return semLastroNbs(nucleo ?? termo)
}

/* ------------------------------------------------------------ CNPJ --
 * Fine-tuning §1–§7: CNPJ com ou sem formatação → BrasilAPI → atividades
 * (CNAE + Anexo Simples + Fator R + NBS/hipóteses) + upsell proativo
 * (simular no Simples, comparar Convencional × Híbrido) + oferta de salvar
 * como cliente/emissor (ato assistido, idempotente).
 */

async function responderCnpj(pergunta: string, analise: AnaliseChat, historico: MensagemHistorico[] = []): Promise<RespostaChat> {
  const t0 = Date.now()
  const ctx = contextoBaseDoTurno(historico)
  const cnpjBruto = analise.cnpj ?? ctx.ultimoCnpj ?? null
  const cad = await import('./aurum-ai-cadastro')
  const querStatus = cad.ehPerguntaCadastroCnpj(pergunta)
  const comandoDireto = cad.ehComandoCadastrarCnpj(pergunta)
  const ofertaPendente = cad.ofertaCadastroCnpjPendente(historico)
  const confirma = cad.ehConfirmacao(pergunta) && ofertaPendente
  const nega = cad.ehNegacao(pergunta) && ofertaPendente

  if (!cnpjBruto) {
    return {
      texto:
        `Para listar as atividades preciso do CNPJ (com ou sem formatação — ex.: 53.795.990/0001-68).\n\n` +
        `Me diga o CNPJ que consulto na BrasilAPI e já trago CNAEs + Anexo do Simples + NBS/hipóteses.`,
      confianca: 0.9,
      nivel: 'alta',
      fontes: [],
      sugestoes: ['Quais atividades o CNPJ 53.795.990/0001-68 tem?'],
      botoes: [{ rotulo: 'Abrir Serviços (NBS)', acao: 'navegar', alvo: 'servicos' }],
      pensamento: pensar([PENSAR.entender, PENSAR.validar], 'CNPJ ausente — pedir o número', Date.now() - t0),
    }
  }

  const validado = validarCnpj(cnpjBruto)
  if (!validado.ok) {
    return {
      texto:
        `${mensagemCnpjInvalido(validado.motivo ?? 'cnpj-tamanho')} ` +
        `Confira os 14 dígitos (vale com ou sem pontos/barra/traço — ex.: 53.795.990/0001-68) e me reenvie.`,
      confianca: 1,
      nivel: 'alta',
      fontes: [],
      sugestoes: ['Quais atividades o CNPJ 53.795.990/0001-68 tem?'],
      pensamento: pensar([PENSAR.entender, PENSAR.validar], 'CNPJ inválido — pedir correção', Date.now() - t0),
    }
  }
  const cnpj = validado.cnpj

  // "Não" após a oferta → cancela sem gravar nada (P3 — escrita assistida).
  if (nega) {
    return {
      texto:
        `Tudo bem — **não cadastrei nada**. O CNPJ ${fmtCnpj(cnpj)} continua fora do sistema.\n\n` +
        `Se mudar de ideia, diga "cadastra o CNPJ ${fmtCnpj(cnpj)}" que eu cadastro na hora.`,
      confianca: 1,
      nivel: 'alta',
      fontes: [],
      sugestoes: [`Quais atividades o CNPJ ${fmtCnpj(cnpj)} tem?`, 'O que você pode fazer?'],
      botoes: [{ rotulo: 'Ver atividades na Receita', acao: 'perguntar', alvo: `Quais atividades o CNPJ ${fmtCnpj(cnpj)} tem?` }],
      pensamento: pensar([PENSAR.entender, PENSAR.validar], `CNPJ ${fmtCnpj(cnpj)}: oferta recusada → nada gravado`, Date.now() - t0),
    }
  }

  // "O CNPJ X tá cadastrado?" → verifica no banco local antes de qualquer rede.
  if (querStatus && !comandoDireto && !confirma) {
    try {
      const existente = await cad.verificarEmpresaPorCnpj(cnpj)
      if (existente) {
        const nome = existente.fantasia && existente.fantasia !== existente.razaoSocial
          ? `${existente.razaoSocial} (${existente.fantasia})`
          : existente.razaoSocial
        return {
          texto:
            `Sim — o CNPJ ${fmtCnpj(cnpj)} **está cadastrado**: **${nome}**${existente.uf ? `/${existente.uf}` : ''}.\n\n` +
            `Quer ver as atividades (CNAEs + Anexo do Simples + NBS) ou simular o Simples para ela?`,
          confianca: 0.95,
          nivel: 'alta',
          fontes: ['Base de empresas do sistema'],
          sugestoes: [`Quais atividades o CNPJ ${fmtCnpj(cnpj)} tem?`, 'Qual fornecedor me dá mais crédito?'],
          botoes: [
            { rotulo: 'Ver atividades', acao: 'perguntar', alvo: `Quais atividades o CNPJ ${fmtCnpj(cnpj)} tem?` },
            { rotulo: 'Abrir Simples Nacional', acao: 'navegar', alvo: 'simples' },
          ],
          pensamento: pensar([PENSAR.entender, PENSAR.validar], `CNPJ ${fmtCnpj(cnpj)} cadastrado → ${nome}`, Date.now() - t0),
        }
      }
      return {
        texto:
          `O CNPJ ${fmtCnpj(cnpj)} **não está cadastrado** no sistema.\n\n` +
          `Quer que eu **cadastre agora**? Busco os dados na Receita (BrasilAPI) e já deixo disponível em Empresas — sem duplicar se já existir.`,
        confianca: 0.95,
        nivel: 'alta',
        fontes: ['Base de empresas do sistema'],
        sugestoes: [`Sim, cadastra o CNPJ ${fmtCnpj(cnpj)}`, `Quais atividades o CNPJ ${fmtCnpj(cnpj)} tem?`],
        botoes: [
          { rotulo: 'Sim, cadastra', acao: 'perguntar', alvo: `Sim, cadastra o CNPJ ${fmtCnpj(cnpj)}` },
          { rotulo: 'Ver atividades na Receita', acao: 'perguntar', alvo: `Quais atividades o CNPJ ${fmtCnpj(cnpj)} tem?` },
        ],
        pensamento: pensar([PENSAR.entender, PENSAR.validar], `CNPJ ${fmtCnpj(cnpj)} ausente → oferta de cadastro`, Date.now() - t0),
      }
    } catch {
      /* verificação é best-effort — segue para o fluxo de atividades */
    }
  }

  // "Cadastra esse CNPJ" (comando direto) ou "sim" após a oferta — ato
  // assistido: idempotente por CNPJ, nunca duplica.
  if (comandoDireto || confirma) {
    try {
      const { cadastrarEmpresaPorCnpj } = await import('./empresas')
      const r = await cadastrarEmpresaPorCnpj(cnpj)
      if (r.ok && r.empresa) {
        return {
          texto:
            `**Empresa salva como cliente:** ${r.empresa.razaoSocial} (${fmtCnpj(cnpj)})${r.atualizada ? ' — já existia e foi atualizada (idempotente, sem duplicar)' : ''}.\n` +
            `Ela já está disponível em Empresas/emissor e as notas órfãs do CNPJ foram adotadas.\n\n` +
            `**Próximo passo sugerido:** quer simular alguma dessas atividades no Simples Nacional? ` +
            `Ou comparar o Simples convencional com o híbrido para esta empresa?`,
          confianca: 0.95,
          nivel: 'alta',
          fontes: ['BrasilAPI (dados cadastrais)', 'Base de empresas do sistema'],
          sugestoes: ['Qual melhor: Anexo III ou V?', 'Meu DAS no Anexo III com RBT12 500 mil e receita 40 mil'],
          botoes: [
            { rotulo: 'Abrir Simples Nacional', acao: 'navegar', alvo: 'simples' },
            { rotulo: 'Abrir Serviços (NBS)', acao: 'navegar', alvo: 'servicos' },
          ],
          pensamento: pensar([PENSAR.entender, PENSAR.validar], `Salvar empresa assistido → ${fmtCnpj(cnpj)}`, Date.now() - t0),
        }
      }
      return {
        texto: `Não consegui salvar agora (${r.motivo ?? 'falha ao gravar'}). Tente em Empresas → cadastrar pelo CNPJ ${fmtCnpj(cnpj)}.`,
        confianca: 0.7, nivel: 'media', fontes: [],
        pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Falha ao salvar empresa', Date.now() - t0),
      }
    } catch (e) {
      return {
        texto:
          `Não consegui salvar automaticamente (${e instanceof Error ? e.message : 'erro interno'}). ` +
          `Vá em Empresas → cadastrar pelo CNPJ ${fmtCnpj(cnpj)} que o sistema puxa da BrasilAPI.`,
        confianca: 0.7, nivel: 'media', fontes: [],
        pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Exceção ao salvar empresa', Date.now() - t0),
      }
    }
  }

  // Fluxo principal: BrasilAPI → CNAEs → atividades.
  try {
    const { consultarPorCnpj } = await import('./consultar-por-cnpj')
    const v = await consultarPorCnpj(cnpj)
    if (!v.atividades.length) {
      return {
        texto:
          `Consultei o CNPJ ${fmtCnpj(cnpj)} — ${v.razaoSocial || 'sem razão social retornada'} — mas a BrasilAPI não devolveu CNAEs.\n\n` +
          `Confira na tela Serviços (NBS) → consulta por CNPJ ou me diga a atividade (ex.: "programação de computadores") que classifico direto.`,
        confianca: 0.7, nivel: 'media',
        fontes: ['BrasilAPI (CNPJ)'],
        botoes: [{ rotulo: 'Abrir Serviços (NBS)', acao: 'navegar', alvo: 'servicos' }],
        pensamento: pensar([PENSAR.entender, PENSAR.consultar(0), PENSAR.validar], `CNPJ ${fmtCnpj(cnpj)} sem CNAEs`, Date.now() - t0),
      }
    }
    const linhas = v.atividades.slice(0, 8).map((a) => {
      const anexo = a.cnaeTabela ? ` · Anexo ${a.cnaeTabela.anexos}${a.cnaeTabela.fatorR ? ' (Fator R)' : ''}` : ''
      const nbs = a.resultado?.codigoEscolhido ? ` → NBS ${a.resultado.codigoEscolhido}` : (a.hipoteses[0] ? ` · hipótese a verificar` : ' · integral')
      return `• **${a.codigoFormatado}** — ${a.descricao}${a.principal ? ' (principal)' : ''}${anexo}${nbs}`
    }).join('\n')
    const extras = v.atividades.length > 8 ? `\n…e mais ${v.atividades.length - 8} — veja todas em Serviços (NBS) → consulta por CNPJ.` : ''
    const simplesLinha = v.opcaoSimples != null ? `\nSimples: ${v.opcaoSimples ? 'sim' : 'não'} · Porte: ${v.porte ?? '—'} · ${v.situacao ?? '—'}` : ''
    return {
      texto:
        `**CNPJ ${fmtCnpj(cnpj)} — ${v.razaoSocial || 'razão social não informada'}${v.fantasia ? ` (${v.fantasia})` : ''}**${simplesLinha}\n` +
        `**Atividades (${v.atividades.length}):**\n${linhas}${extras}\n` +
        `**Base:** BrasilAPI + CNAE × Anexo Simples + NBS × CST × cClassTrib (LC 214/2025)\n` +
        `**Confiança: Alta** — CNAEs oficiais; sem NBS vinculado = regra geral.\n` +
        `**Atenção:** "Depende da atividade" exige modo manual · III/V via Fator R (folha ÷ RBT12 ≥ 28% → III).\n` +
        `**Próximo passo:**\n` +
        `• Simular no Simples? Diga anexo + RBT12 + receita (+ folha)\n` +
        `• Comparar convencional × híbrido? O relatório analítico dá o veredito\n` +
        `• Salvar como cliente do emissor? Diga "salvar essa empresa"`,
      confianca: 0.9,
      nivel: 'alta',
      fontes: ['BrasilAPI (CNPJ + CNAEs)', 'Tabela CNAE × Anexo Simples + Fator R', 'Vínculos NBS × CST × cClassTrib (LC 214/2025)'],
      sugestoes: [
        'Salvar essa empresa como cliente',
        'Meu DAS no Anexo III com RBT12 500 mil e receita 40 mil',
        'Qual melhor: Anexo III ou V?',
      ],
      botoes: [
        { rotulo: 'Salvar como cliente', acao: 'perguntar', alvo: `Salvar a empresa do CNPJ ${fmtCnpj(cnpj)} como cliente` },
        { rotulo: 'Abrir Simples Nacional', acao: 'navegar', alvo: 'simples' },
        { rotulo: 'Abrir Serviços (NBS)', acao: 'navegar', alvo: 'servicos' },
      ],
      pensamento: pensar([PENSAR.entender, PENSAR.consultar(v.atividades.length), PENSAR.validar], `CNPJ ${fmtCnpj(cnpj)} → ${v.atividades.length} atividades`, Date.now() - t0),
    }
  } catch (e) {
    return {
      texto:
        `Não consegui consultar o CNPJ ${fmtCnpj(cnpj)} agora (${e instanceof Error ? e.message : 'falha na BrasilAPI'}).\n\n` +
        `Verifique a internet e tente de novo — ou use Serviços (NBS) → consulta por CNPJ. Se souber a atividade (ex.: "programação de computadores"), me diga que classifico direto.`,
      confianca: 0.6,
      nivel: 'media',
      fontes: ['BrasilAPI (CNPJ)'],
      botoes: [{ rotulo: 'Abrir Serviços (NBS)', acao: 'navegar', alvo: 'servicos' }],
      pensamento: pensar([PENSAR.entender, PENSAR.validar], `Falha BrasilAPI CNPJ ${fmtCnpj(cnpj)}`, Date.now() - t0),
    }
  }
}

/* --------------------------------------------------------- cálculo -- */

/* ------------------------------------------- cadastro de produto (IA) --
 * Fine-tuning v4: cadastro assistido em turnos com conferência obrigatória.
 * Portão 1 (gravação): "SIM PARA SALVAR" só vale após o resumo com o MESMO
 * SKU. Portão 2 (sobrescrita): SKU existente exige "SIM ATUALIZAR" após o
 * aviso. "Não"/cancelar nunca grava. Empresa inexistente não grava.
 */

async function responderCadastroProduto(pergunta: string, analise: AnaliseChat, historico: MensagemHistorico[] = []): Promise<RespostaChat> {
  const t0 = Date.now()
  void analise
  const cad = await import('./aurum-ai-cadastro')
  const msgsUsuario = historico.filter((m) => m.papel === 'user').map((m) => m.texto)
  // Escolha de empresa em lista numerada ("o 1", "Pão Dourado") vira slot.
  const escolha = cad.resolverEscolhaLista(historico, pergunta)
  const msgsEfetivas = escolha ? [...msgsUsuario, `empresa ${escolha}`, pergunta] : [...msgsUsuario, pergunta]

  // Cancelamento explícito com fluxo em andamento → nada gravado.
  if (cad.ehNegacao(pergunta) && (cad.resumoProdutoPendente(historico) || cad.ofertaAtualizarSkuPendente(historico) || cad.fluxoCadastroEmAndamento(historico))) {
    return {
      texto:
        `Tudo bem — **não cadastrei nada**.\n\n` +
        `Quando quiser, diga "quero cadastrar um produto" que eu conduzo de novo (empresa → SKU → nome → NCM → conferência).`,
      confianca: 1, nivel: 'alta', fontes: [],
      sugestoes: ['O que você pode fazer?', 'Tem algum NCM de banana?'],
      botoes: botoesCapacidades().slice(0, 4),
      pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Cadastro produto: cancelado → nada gravado', Date.now() - t0),
    }
  }

  const r = cad.extrairRascunhoProduto(msgsEfetivas)
  const skuResumo = cad.resumoProdutoPendente(historico)
  const skuAtualizar = cad.ofertaAtualizarSkuPendente(historico)
  // "Quero cadastrar (outro) produto" recomeça — nunca é confirmação.
  const reinicia = /^(quero|vou|vamos)\b|(outro|novo) produto\b/i.test(pergunta.trim())
  const confirma = cad.ehConfirmacao(pergunta) && !reinicia
  // Resposta curta ao slot pedido ("Pão Dourado", "QM-01") sem rótulo:
  // atribui ao slot quando nada novo foi extraído neste turno.
  if (!reinicia && !confirma) {
    const antes = cad.extrairRascunhoProduto(msgsUsuario)
    const rendeu = JSON.stringify({ ...r, pularTribAntiga: false }) !== JSON.stringify({ ...antes, pularTribAntiga: false })
    const pedido = cad.slotPedidoPendente(historico)
    const curta = pergunta.trim()
    if (!rendeu && pedido && curta.length >= 2 && curta.length <= 60 && !/^(sim|não|nao|pular)\b/i.test(curta)) {
      if (pedido === 'empresa' && !/\d/.test(curta)) r.empresaTexto = curta.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim() || r.empresaTexto
      else if (pedido === 'sku') {
        const tok = curta.split(/\s+/)[0].replace(/[.,;]+$/g, '')
        if (/^[A-Za-z0-9._\-/]{1,30}$/.test(tok)) r.sku = tok
      } else if (pedido === 'nome') {
        r.nome = curta.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim() || r.nome
      }
    }
  }

  // PORTÃO 1 — gravação (novo) ou PORTÃO 2 — sobrescrita (SKU existente).
  if (confirma && (skuResumo || skuAtualizar)) {
    const skuConf = String(skuResumo ?? skuAtualizar)
    const falt = cad.faltantesObrigatorios(r)
    if (falt.length || norm(r.sku ?? '') !== norm(skuConf)) {
      return {
        texto:
          `Antes de salvar, preciso fechar a conferência: ${falt.length ? `falta ${falt.join(', ')}` : `o SKU mudou (era ${skuConf})`}. ` +
          `Diga os dados que faltam ou recomece com "quero cadastrar um produto".`,
        confianca: 0.9, nivel: 'alta', fontes: [],
        pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Cadastro produto: confirmação sem conferência válida', Date.now() - t0),
      }
    }
    return finalizarCadastroProduto(r, { sobrescrever: !!skuAtualizar }, t0)
  }

  // NCM por descrição? ("é um queijo minas" em vez dos 8 dígitos) — tenta
  // classificar uma vez; sem lastro, pede os dígitos.
  if (!r.ncm) {
    const tentativa = await tentarNcmPorDescricao(pergunta)
    if (tentativa) {
      r.ncm = tentativa
      r.pularTribAntiga = r.pularTribAntiga
    }
  }

  const falt = cad.faltantesObrigatorios(r)
  if (falt.length) {
    return perguntarSlotProduto(r, falt[0], t0)
  }
  // Obrigatórios ok → tributação antiga (opcional, digitada pelo usuário).
  if (!cad.temTribAntiga(r) && !r.pularTribAntiga && !/pular/i.test(pergunta)) {
    return {
      texto:
        `Tenho empresa, SKU, nome e NCM. Falta só a **tributação antiga** (opcional — vale o que você digitar): **CFOP, CST do ICMS, PIS e COFINS**.\n\n` +
        `Ex.: "cfop 5102, cst 00, pis 01, cofins 01" — ou diga **PULAR**.`,
      confianca: 0.95, nivel: 'alta',
      fontes: [],
      sugestoes: ['cfop 5102, cst 00, pis 01, cofins 01', 'PULAR'],
      pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Cadastro produto: pede trib. antiga', Date.now() - t0),
    }
  }
  return conferirRascunhoProduto(r, t0)
}

function rotuloSlotProduto(slot: 'empresa' | 'sku' | 'nome' | 'ncm'): string {
  switch (slot) {
    case 'empresa': return 'a **empresa** (nome ou CNPJ — ex.: "Padaria Pão Dourado" ou 11.222.333/0001-81)'
    case 'sku': return 'o **SKU** (código interno — ex.: QMINAS-01)'
    case 'nome': return 'o **nome do produto** (ex.: "Queijo Minas frescal")'
    case 'ncm': return 'o **NCM (8 dígitos)** — ou só a descrição que eu classifico (ex.: "queijo minas")'
  }
}

function resumoParcialProduto(r: import('./aurum-ai-cadastro').RascunhoProduto): string {
  const partes: string[] = []
  if (r.cnpjEmpresa || r.empresaTexto) partes.push(`Empresa: ${r.cnpjEmpresa ?? r.empresaTexto}`)
  if (r.sku) partes.push(`SKU: ${r.sku}`)
  if (r.nome) partes.push(`Nome: ${r.nome}`)
  if (r.ncm) partes.push(`NCM: ${r.ncm}`)
  return partes.length ? `Já tenho: ${partes.join(' · ')}.\n` : ''
}

function perguntarSlotProduto(
  r: import('./aurum-ai-cadastro').RascunhoProduto,
  slot: 'empresa' | 'sku' | 'nome' | 'ncm',
  t0: number,
): RespostaChat {
  return {
    texto:
      `Vamos cadastrar o produto. ${resumoParcialProduto(r)}` +
      `Falta ${rotuloSlotProduto(slot)}.`,
    confianca: 0.95, nivel: 'alta',
    fontes: [],
    sugestoes: slot === 'empresa' ? ['Quais meus clientes?'] : slot === 'ncm' ? ['Tem algum NCM de queijo minas?'] : [],
    botoes: slot === 'empresa' ? [{ rotulo: 'Ver meus clientes', acao: 'perguntar', alvo: 'Quais meus clientes?' }] : [],
    pensamento: pensar([PENSAR.entender, PENSAR.validar], `Cadastro produto: pede ${slot}`, Date.now() - t0),
  }
}

/** Uma tentativa de NCM por descrição livre (best-effort, sem chute). */
async function tentarNcmPorDescricao(pergunta: string): Promise<string | null> {
  const texto = String(pergunta ?? '').trim()
  if (/\d{8}|\d{4}\.\d{2}\.\d{2}/.test(texto)) return null
  if (texto.replace(/\W+/g, '').length < 3) return null
  try {
    const { classificarComIa } = await import('./classificacao-ia')
    const gate = await classificarComIa({ descricao: texto })
    if (gate.codigoEscolhido && gate.ncmValidado) {
      const { resolverClassificacoes } = await import('@/infrastructure/base/classificacao-repo')
      const resolvido = await resolverClassificacoes(gate.ncmValidado)
      if (resolvido.lista.length && resolvido.nomenclatura) return gate.ncmValidado
    }
  } catch {
    /* sem lastro — pede os dígitos */
  }
  return null
}

/**
 * Conferência do rascunho completo: resolve empresa + NCM, checa SKU e exibe
 * o resumo com o portão ("SIM PARA SALVAR" ou "SIM ATUALIZAR").
 */
async function conferirRascunhoProduto(
  r: import('./aurum-ai-cadastro').RascunhoProduto,
  t0: number,
): Promise<RespostaChat> {
  const cad = await import('./aurum-ai-cadastro')
  // Empresa: CNPJ direto ou resolução por nome.
  let empresaId: number | null = null
  let empresaRotulo = ''
  if (r.cnpjEmpresa) {
    const e = await cad.verificarEmpresaPorCnpj(r.cnpjEmpresa).catch(() => null)
    if (!e || e.id == null) {
      return {
        texto:
          `A empresa do CNPJ ${r.cnpjEmpresa} **não está cadastrada** — não salvo produto sem empresa válida.\n\n` +
          `Diga "cadastra o CNPJ ${r.cnpjEmpresa}" que eu cadastro primeiro, depois retomamos o produto (SKU ${r.sku}).`,
        confianca: 0.9, nivel: 'alta',
        fontes: ['Base de empresas do sistema'],
        sugestoes: [`Cadastra o CNPJ ${r.cnpjEmpresa}`],
        botoes: [{ rotulo: 'Cadastrar empresa', acao: 'perguntar', alvo: `Cadastra o CNPJ ${r.cnpjEmpresa}` }],
        pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Cadastro produto: empresa inexistente → não grava', Date.now() - t0),
      }
    }
    empresaId = e.id
    empresaRotulo = e.fantasia && e.fantasia !== e.razaoSocial ? `${e.razaoSocial} (${e.fantasia})` : e.razaoSocial
  } else {
    const { listarEmpresas } = await import('./empresas')
    const { resolverEmpresaAlvo, nomeEmpresa, textoDesambiguacaoEmpresa } = await import('./aurum-ai-empresa')
    const todas = await listarEmpresas().catch(() => [])
    const res = resolverEmpresaAlvo(r.empresaTexto, todas.map((e) => ({ id: e.id ?? null, razaoSocial: e.razaoSocial, fantasia: e.fantasia, cnpj: e.cnpj })), null)
    if (res.tipo === 'ambigua') {
      return {
        texto: `${textoDesambiguacaoEmpresa(res)}\n\nResponda com o número ou o nome exato para eu concluir o cadastro do SKU ${r.sku}.`,
        confianca: 0.9, nivel: 'alta',
        fontes: ['Base de empresas do sistema'],
        pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Cadastro produto: empresa ambígua', Date.now() - t0),
      }
    }
    if (res.tipo !== 'unica') {
      return {
        texto:
          `Não encontrei a empresa "${r.empresaTexto}" no cadastro — não salvo produto sem empresa válida.\n\n` +
          `Confira o nome ou cadastre pelo CNPJ ("cadastra o CNPJ ...") e retomamos o produto (SKU ${r.sku}).`,
        confianca: 0.9, nivel: 'alta',
        fontes: ['Base de empresas do sistema'],
        sugestoes: ['Quais meus clientes?'],
        botoes: [{ rotulo: 'Ver meus clientes', acao: 'perguntar', alvo: 'Quais meus clientes?' }],
        pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Cadastro produto: empresa não encontrada', Date.now() - t0),
      }
    }
    empresaId = res.candidatas[0].id
    empresaRotulo = nomeEmpresa(res.candidatas[0])
  }

  const montada = await cad.montarEntradaProduto(r, empresaId)
  if (!montada.ok) {
    return {
      texto: `${montada.erro} Me diga o NCM correto (8 dígitos) ou a descrição que eu classifico.`,
      confianca: 0.9, nivel: 'alta',
      fontes: ['Nomenclatura vigente (TEC)'],
      pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Cadastro produto: NCM sem lastro', Date.now() - t0),
    }
  }
  const avisos = cad.validarTribAntiga(r)
  const tribAntiga = cad.temTribAntiga(r)
    ? `CFOP ${r.cfop ?? '—'} · CST-ICMS ${r.cstIcms ?? '—'} · PIS ${r.pis ?? '—'} · COFINS ${r.cofins ?? '—'}`
    : 'não informada'
  const corpo =
    `**Conferência — cadastro de produto**\n` +
    `• Empresa: ${empresaRotulo}\n` +
    `• SKU ${r.sku} · Nome: ${r.nome}\n` +
    `• NCM ${fmtNcm(r.ncm as string)} — ${montada.pronta.descricaoNcm.slice(0, 90)} (CST ${montada.pronta.entrada.classificacao.cst} · cClassTrib ${montada.pronta.entrada.classificacao.cClassTrib})\n` +
    `• Tributação antiga (digitada por você): ${tribAntiga}` +
    (r.quantidade != null || r.valorUnitario != null ? `\n• Qtd ${r.quantidade ?? 0} · Valor ${fmtMoeda(r.valorUnitario ?? 0)}` : '') +
    (avisos.length ? `\n\n**Atenção:** ${avisos.join(' ')} Confira antes de confirmar.` : '')

  const existe = await cad.skuJaExiste(empresaId, r.sku as string).catch(() => false)
  if (existe) {
    return {
      texto:
        `${corpo}\n\n**Este SKU já existe nesta empresa.** Quer **ATUALIZAR o SKU ${r.sku}** com estes dados?\n` +
        `Responda **SIM ATUALIZAR** para sobrescrever, ou diga outro SKU / o que corrigir.`,
      confianca: 0.9, nivel: 'alta',
      fontes: ['Base de produtos do sistema', 'Vínculos oficiais da Reforma (CST × cClassTrib)'],
      sugestoes: [`Sim, atualiza o produto SKU ${r.sku}`],
      botoes: [{ rotulo: 'Sim, atualizar', acao: 'perguntar', alvo: `Sim, atualiza o produto SKU ${r.sku}` }],
      pensamento: pensar([PENSAR.entender, PENSAR.validar], `Cadastro produto: SKU ${r.sku} existe → portão 2`, Date.now() - t0),
    }
  }
  return {
    texto:
      `${corpo}\n\n**Confirma o cadastro? (SKU ${r.sku})** Responda **SIM PARA SALVAR** ou diga o que corrigir (ex.: "o cfop é 6102"). Nada foi gravado ainda.`,
    confianca: 0.9, nivel: 'alta',
    fontes: ['Base de produtos do sistema', 'Vínculos oficiais da Reforma (CST × cClassTrib)'],
    sugestoes: [`Sim, salva o produto SKU ${r.sku}`],
    botoes: [{ rotulo: 'Sim, salvar produto', acao: 'perguntar', alvo: `Sim, salva o produto SKU ${r.sku}` }],
    pensamento: pensar([PENSAR.entender, PENSAR.validar], `Cadastro produto: conferência SKU ${r.sku} → portão 1`, Date.now() - t0),
  }
}

/** Gravação após confirmação vinculada (portão 1 ou 2). */
async function finalizarCadastroProduto(
  r: import('./aurum-ai-cadastro').RascunhoProduto,
  opts: { sobrescrever: boolean },
  t0: number,
): Promise<RespostaChat> {
  const cad = await import('./aurum-ai-cadastro')
  // Re-resolve a empresa no ato (idempotente, sem confiar em texto antigo).
  let empresaId: number | null = null
  let empresaRotulo = r.empresaTexto ?? r.cnpjEmpresa ?? ''
  if (r.cnpjEmpresa) {
    const e = await cad.verificarEmpresaPorCnpj(r.cnpjEmpresa).catch(() => null)
    if (!e || e.id == null) {
      return {
        texto: `A empresa do CNPJ ${r.cnpjEmpresa} não está mais no cadastro — nada foi gravado. Cadastre-a e confirme de novo.`,
        confianca: 0.9, nivel: 'alta', fontes: [],
        pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Cadastro produto: empresa sumiu → aborta', Date.now() - t0),
      }
    }
    empresaId = e.id
    empresaRotulo = e.razaoSocial
  } else {
    const { listarEmpresas } = await import('./empresas')
    const { resolverEmpresaAlvo, nomeEmpresa } = await import('./aurum-ai-empresa')
    const todas = await listarEmpresas().catch(() => [])
    const res = resolverEmpresaAlvo(r.empresaTexto, todas.map((e) => ({ id: e.id ?? null, razaoSocial: e.razaoSocial, fantasia: e.fantasia, cnpj: e.cnpj })), null)
    if (res.tipo !== 'unica') {
      return {
        texto: `Não consegui confirmar a empresa ("${r.empresaTexto}") — nada foi gravado. Diga o nome exato ou o CNPJ e confirme de novo.`,
        confianca: 0.9, nivel: 'alta', fontes: [],
        pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Cadastro produto: empresa incerta → aborta', Date.now() - t0),
      }
    }
    empresaId = res.candidatas[0].id
    empresaRotulo = nomeEmpresa(res.candidatas[0])
  }
  const montada = await cad.montarEntradaProduto(r, empresaId)
  if (!montada.ok) {
    return {
      texto: `${montada.erro} Nada foi gravado.`,
      confianca: 0.9, nivel: 'alta', fontes: [],
      pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Cadastro produto: NCM falhou no ato → aborta', Date.now() - t0),
    }
  }
  const grav = await cad.executarCadastroProdutoAssistido(montada.pronta.entrada, opts.sobrescrever).catch((e: unknown) => ({
    ok: false as const,
    motivo: e instanceof Error ? e.message : 'erro interno',
  }))
  if (!grav.ok) {
    return {
      texto: `Não consegui gravar (${grav.motivo}). Nada foi alterado — confira na tela Produtos.`,
      confianca: 0.7, nivel: 'media', fontes: [],
      botoes: [{ rotulo: 'Abrir Produtos', acao: 'navegar', alvo: 'produtos' }],
      pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Cadastro produto: falha de gravação', Date.now() - t0),
    }
  }
  return {
    texto:
      `**Produto ${grav.status === 'atualizado' ? 'atualizado' : 'cadastrado'}:** ${r.sku} — ${r.nome}\n` +
      `• Empresa: ${empresaRotulo} · NCM ${fmtNcm(r.ncm as string)} (CST ${montada.pronta.entrada.classificacao.cst} · cClassTrib ${montada.pronta.entrada.classificacao.cClassTrib})\n` +
      `• Tributação antiga: CFOP ${r.cfop ?? '—'} · CST-ICMS ${r.cstIcms ?? '—'} · PIS ${r.pis ?? '—'} · COFINS ${r.cofins ?? '—'}\n\n` +
      `Já está disponível em Produtos. Quer cadastrar outro ou simular o IBS/CBS dele na Calculadora?`,
    confianca: 0.95, nivel: 'alta',
    fontes: ['Base de produtos do sistema', 'Vínculos oficiais da Reforma (CST × cClassTrib)'],
    sugestoes: ['Quero cadastrar um produto', `Quanto fica R$ 1.000 no NCM ${fmtNcm(r.ncm as string)}?`],
    botoes: [
      { rotulo: 'Abrir Produtos', acao: 'navegar', alvo: 'produtos' },
      { rotulo: 'Abrir Calculadora', acao: 'navegar', alvo: 'calculadora' },
    ],
    pensamento: pensar([PENSAR.entender, PENSAR.validar], `Cadastro produto: SKU ${r.sku} ${grav.status}`, Date.now() - t0),
  }
}

async function responderCalculo(pergunta: string, analise: AnaliseChat, historico: MensagemHistorico[] = [], memoria?: MemoriaSistema | null): Promise<RespostaChat> {
  const t0 = Date.now()
  // Contexto: "e para 2 mil?" herda o NCM; "e no NCM X?" herda o valor.
  // Em chat novo, o artefato-resumo fornece o último NCM da sessão anterior.
  const ctx = mesclarContextoComArtefato(contextoBaseDoTurno(historico), memoria)
  let codigo = analise.codigoDigitos?.length === 8 ? analise.codigoDigitos : (ultimoCodigoHistorico(historico) ?? ctx.ultimoCodigoNcm)
  const valorAtual = analise.valorBase ?? extrairTodosValores(pergunta).pop()?.valor ?? null
  const valorCtx = valorAtual ?? ctx.ultimoValorBase ?? null
  const slotValor = resolverSlot(valorCtx, 1000, 'o valor base', 'R$ 1.000,00')
  const valor = slotValor.valor
  // Se o valor veio do contexto (não da pergunta atual), não é "assumido".
  const valorHerdado = valorAtual == null && ctx.ultimoValorBase != null
  // Fine-tuning v3 — cálculo ancorado em produto DA EMPRESA ("quanto fica esse
  // queijo da Padaria Y?"): sem código na frase mas com produto mencionado,
  // localiza o produto nos XMLs do escopo e usa o NCM real dele — nunca chuta.
  let prefixoEmpresaCalc = ''
  let notaAncoragem = ''
  try {
    const dadosMod = await import('./aurum-ai-dados')
    const filtroCalc = dadosMod.extrairFiltrosDados(pergunta)
    const mencaoProdutoCalc = filtroCalc.produto ?? analise.produtoMencionado ?? ctx.ultimoProdutoMencionado ?? null
    const mencaoEmpresaCalc = filtroCalc.clienteTexto ?? analise.empresaMencionada ?? ctx.ultimaEmpresaMencionada ?? null
    if (mencaoEmpresaCalc && !prefixoEmpresaCalc) prefixoEmpresaCalc = `**Empresa:** ${mencaoEmpresaCalc}\n\n`
    if ((!codigo || codigo.length !== 8) && mencaoProdutoCalc) {
      const escopoCalc = await dadosMod.notasDoEscopo({ ...filtroCalc, clienteTexto: mencaoEmpresaCalc ?? filtroCalc.clienteTexto }).catch(() => null)
      const itensCalc = (escopoCalc?.notas ?? []).flatMap((nn) => nn.itensAnalisados ?? [])
      if (itensCalc.length) {
        const { localizarProdutoEmNotas } = await import('./aurum-ai-empresa')
        const achados = localizarProdutoEmNotas(
          mencaoProdutoCalc,
          itensCalc.map((it) => ({ descricao: String(it.descricao ?? ''), codProd: String(it.codProd ?? ''), ncm: String(it.ncm ?? '').replace(/\D+/g, '') })),
          3,
        )
        const ncmAchado = (achados[0]?.ncm ?? '').replace(/\D+/g, '')
        if (ncmAchado.length === 8) {
          codigo = ncmAchado
          notaAncoragem = ` (produto "${mencaoProdutoCalc}" localizado nos XMLs${mencaoEmpresaCalc ? ` de ${mencaoEmpresaCalc}` : ''} — NCM ${fmtNcm(ncmAchado)})`
        }
      }
    }
  } catch {
    /* ancoragem é best-effort — segue o fluxo padrão */
  }
  if (!codigo || codigo.length !== 8) {
    // Multi-intenção ("ncm de banana e quanto fica 2 mil"): com valor na
    // frase, classifica primeiro e já calcula — sem pedir o que já foi dito.
    if (valorAtual != null) {
      const base = await responderNcm(pergunta, analise, historico, memoria)
      if (base.codigo && base.codigo.length === 8) {
        const rr = await resolverClassificacoes(base.codigo)
        if (rr.lista.length) {
          const clc = rr.lista[0]
          const calcc = calcularTributos(valorAtual, Number(clc.resumo?.percentualReducaoIBS) || 0, Number(clc.resumo?.percentualReducaoCBS) || 0, REF_DEFAULT.IBS, REF_DEFAULT.CBS)
          return {
            texto:
              `${prefixoEmpresaCalc}` +
              `Classifiquei como **NCM ${fmtNcm(base.codigo)}**${notaAncoragem} — cálculo sobre base ${fmtMoeda(valorAtual)}\n` +
              `• Redução: ${clc.resumo?.percentualReducaoIBS ?? 0}% IBS / ${clc.resumo?.percentualReducaoCBS ?? 0}% CBS (ref. IBS ${REF_DEFAULT.IBS}% · CBS ${REF_DEFAULT.CBS}%)\n` +
              `• IBS ${fmtMoeda(calcc.vIBS)} + CBS ${fmtMoeda(calcc.vCBS)} = **${fmtMoeda(calcc.total)}** · Total com tributos ${fmtMoeda(calcc.base + calcc.total)}`,
            codigo: base.codigo,
            tipoCodigo: 'ncm',
            confianca: 0.85,
            nivel: 'alta',
            fontes: ['Nomenclatura vigente (TEC)', 'Vínculos oficiais da Reforma (CST × cClassTrib)', 'Alíquotas de referência (IBS/CBS)'],
            sugestoes: ['Gera um relatório desse cálculo'],
            botoes: [
              { rotulo: 'Baixar relatório', acao: 'baixar', alvo: 'relatorio' },
              { rotulo: 'Abrir Calculadora', acao: 'navegar', alvo: 'calculadora' },
            ],
            relatorioOpcoes: {
              base: 'calculo',
              dados: { codigo: base.codigo, base: valorAtual, ibs: calcc.vIBS, cbs: calcc.vCBS, total: calcc.total },
            },
            pensamento: pensar([PENSAR.entender, PENSAR.validar, PENSAR.calcular], `Multi-intenção: NCM ${fmtNcm(base.codigo)} + base ${fmtMoeda(valorAtual)}`, Date.now() - t0),
          }
        }
      }
    }
    const base = await responderNcm(pergunta, analise, historico, memoria)
    const avisoCodigo = `Faltou o NCM exato — projetei a hipótese mais próxima do contexto${base.codigo ? ` (${fmtNcm(base.codigo)})` : ''}. Confirme com o código de 8 dígitos se tiver.`
    return {
      ...base,
      texto: `${slotValor.aviso && !valorHerdado ? `${slotValor.aviso}\n` : ''}${avisoCodigo}\n\n${base.texto}`,
      sugestoes: ['O que você pode fazer?'],
    }
  }
  const r = await resolverClassificacoes(codigo)
  if (!r.lista.length) return semLastro()
  const cl = r.lista[0]
  const calc = calcularTributos(valor, Number(cl.resumo?.percentualReducaoIBS) || 0, Number(cl.resumo?.percentualReducaoCBS) || 0, REF_DEFAULT.IBS, REF_DEFAULT.CBS)
  const prefixo = slotValor.aviso && !valorHerdado ? `${slotValor.aviso}\n\n` : ''
  const usouContextoCodigo = !analise.codigoDigitos && !!codigo
  const usouContextoValor = valorHerdado
  const ctxNota = usouContextoCodigo || usouContextoValor
    ? ` (do contexto da conversa${usouContextoCodigo && usouContextoValor ? ': código + valor' : usouContextoCodigo ? ': código' : ': valor'})`
    : ''
  // Visual preditivo: todo cálculo com números gera o artefato IBS×CBS
  // automaticamente (pizza/barras/tabela alternáveis no cartão). O pedido
  // explícito ("em pizza") só escolhe o modelo inicial.
  const pedidoCalc = analise.querGrafico ? { quer: true, tipo: analise.tipoGrafico ?? null } : detectarPedidoGrafico(pergunta)
  let graficoCalc: GraficoChat | null = null
  try {
    graficoCalc = graficoCalculoIBS(fmtNcm(codigo), calc.vIBS, calc.vCBS, valor)
    if (pedidoCalc.tipo) graficoCalc = aplicarTipoPreferido(graficoCalc, pedidoCalc.tipo)
  } catch {
    graficoCalc = null
  }
  const sugCalc = sugestaoGrafico(alvoGraficoCalculo(codigo, valor))
  return {
    texto:
      `${prefixoEmpresaCalc}${prefixo}` +
      `**NCM ${fmtNcm(codigo)}**${notaAncoragem}${ctxNota} sobre base ${fmtMoeda(valor)}\n` +
      `• Redução: ${cl.resumo?.percentualReducaoIBS ?? 0}% IBS / ${cl.resumo?.percentualReducaoCBS ?? 0}% CBS (ref. IBS ${REF_DEFAULT.IBS}% · CBS ${REF_DEFAULT.CBS}%)\n` +
      `• IBS ${fmtMoeda(calc.vIBS)} + CBS ${fmtMoeda(calc.vCBS)} = **${fmtMoeda(calc.total)}** · Total com tributos ${fmtMoeda(calc.base + calc.total)}` +
      `${graficoCalc ? `\n\n📊 Gráfico **${graficoCalc.titulo}** gerado abaixo (altere o modelo no cartão).` : `\n\n${sugCalc.frase}`}`,
    codigo,
    tipoCodigo: 'ncm',
    confianca: slotValor.assumido && !valorHerdado ? 0.7 : 0.9,
    nivel: slotValor.assumido && !valorHerdado ? 'media' : 'alta',
    fontes: ['Nomenclatura vigente (TEC)', 'Vínculos oficiais da Reforma (CST × cClassTrib)', 'Alíquotas de referência (IBS/CBS)'],
    grafico: graficoCalc,
    sugestoes: ['Gera um relatório desse cálculo', ...sugCalc.sugestoes],
    botoes: [
      { rotulo: 'Baixar relatório', acao: 'baixar', alvo: 'relatorio' },
      ...sugCalc.botoes,
      { rotulo: 'Abrir Calculadora', acao: 'navegar', alvo: 'calculadora' },
    ],
    relatorioOpcoes: {
      base: 'calculo',
      dados: { codigo, base: valor, ibs: calc.vIBS, cbs: calc.vCBS, total: calc.total },
    },
    pensamento: pensar([PENSAR.entender, PENSAR.validar, PENSAR.calcular], `NCM ${fmtNcm(codigo)} · base ${fmtMoeda(valor)}`, Date.now() - t0),
  }
}

/* ---------------------------------------------------------- simples -- */

async function responderSimples(pergunta: string, historico: MensagemHistorico[] = []): Promise<RespostaChat> {
  const t0 = Date.now()
  // Contexto SÓ do domínio Simples ("e com folha 200 mil?" herda anexo/RBT12/
  // receita da conversa; base R$ 1.000 de um cálculo IBS nunca vira receita).
  const ctx = contextoBaseDoTurno(historico)
  const slots = extrairSlotsSimples(pergunta)
  // Payloads de botão: refazem o cálculo com a folha sugerida/alterada,
  // herdando RBT12/receita/anexo da conversa (fine-tuning v6 — Fator R).
  // Formato: `__RECALCULAR_FATOR_R__ RBT12=.. RECEITA=.. FOLHA=.. ANEXO_ATUAL=..`
  if (/^__RECALCULAR_FATOR_R__/.test(String(pergunta ?? '').trim())) {
    const nums = Object.fromEntries(
      [...String(pergunta).matchAll(/(RBT12|RECEITA|FOLHA|ANEXO_ATUAL)\s*=\s*([^\s]+)/gi)].map((m) => [m[1].toUpperCase(), m[2]]),
    ) as Record<string, string>
    const rbtP = Number(String(nums.RBT12 ?? '').replace(',', '.')) || ctx.ultimoRbt12 || slots.rbt12
    const recP = Number(String(nums.RECEITA ?? '').replace(',', '.')) || ctx.ultimaReceita || slots.receitaMes
    const folhaP = Number(String(nums.FOLHA ?? '').replace(',', '.')) || ctx.ultimaFolha || slots.folha12
    const anexoP = (String(nums.ANEXO_ATUAL ?? '').toUpperCase() || ctx.ultimoAnexo || slots.anexo || 'III') as AnexoSimplesId
    if (rbtP != null && recP != null && folhaP != null) {
      const frase = `Anexo ${anexoP}, RBT12 ${rbtP}, receita ${recP}, folha ${folhaP}`
      const r = await responderSimples(frase, [])
      const marca = `🔁 Recálculo com folha sugerida (${fmtMoeda(folhaP)}).\n`
      return { ...r, texto: marca + r.texto }
    }
  }
  // 08-01: MEI orienta, nunca calcula (DAS-MEI fixo, fora dos Anexos I–V).
  if (/\bmei\b/i.test(pergunta)) {
    return {
      texto:
        `Você mencionou MEI — o MEI recolhe o DAS-MEI em valor fixo mensal, fora dos Anexos I–V do Simples Nacional (sem Fator R e sem RBT12/faixa).\n\n` +
        `Se você é MEI, consulte o DAS-MEI no Portal do Simples. Se a empresa estourar o teto do MEI, me diga o anexo + RBT12 + receita que simulo no Simples.`,
      confianca: 0.9,
      nivel: 'alta',
      fontes: ['Tabela Simples Nacional — Anexos I–V + Reforma (CBS/IBS)'],
      sugestoes: ['O que é Fator R?', 'DAS Anexo III, RBT12 500 mil, receita 40 mil'],
      botoes: [
        { rotulo: 'Abrir Simples Nacional', acao: 'navegar', alvo: 'simples' },
        { rotulo: 'O que é Fator R?', acao: 'perguntar', alvo: 'O que é Fator R?' },
      ],
      pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Simples: MEI → orientar, sem cálculo', Date.now() - t0),
    }
  }
  // 08-01: frase atual vence herança — explícito > inferido > contexto.
  // Fine-tuning v6: mescla anti-"RBT fantasma" via `aplicarEdicaoSimples`
  // ("e com 200 mil?" após RBT+receita vira FOLHA, nunca RBT).
  // v7: pilha em ordem cronológica — "primeiro/anterior/volta/outro/mesmos
  // valores" resolvem contra o histórico, e a intenção é observada sempre.
  const inferencia = slots.anexo == null ? inferirAnexoPorAtividade(pergunta) : null
  const falasUserPre = historico.filter((m) => m.papel === 'user').map((m) => m.texto)
  const pilhaSimples = historicoSlotsSimples(falasUserPre)
  const edicao = aplicarEdicaoSimples(
    pergunta,
    slots,
    { ultimoAnexo: ctx.ultimoAnexo, ultimoRbt12: ctx.ultimoRbt12, ultimaReceita: ctx.ultimaReceita, ultimaFolha: ctx.ultimaFolha },
    pilhaSimples,
  )
  // v7 — "e no outro anexo?" sem nome e sem 2 candidatos: pergunta em vez de chutar.
  if (edicao.ambiguo && ehPedidoOutroAnexoAmbiguo(pergunta, slots.anexo)) {
    const distintos = [...new Set(pilhaSimples.turnos.map((t) => t.anexo).filter((v): v is NonNullable<typeof v> => v != null))]
    const sugestao = distintos.length === 1 && distintos[0] !== ctx.ultimoAnexo ? distintos[0] : null
    void resolverAnexoPorReferencia
    void observarIntencaoSimples
    return {
      texto:
        `Você quer ir para qual anexo?\n` +
        `Contexto atual: ${ctx.ultimoAnexo ? `Anexo ${ctx.ultimoAnexo} · ` : ''}${ctx.ultimoRbt12 ? `RBT12 ${fmtMoeda(ctx.ultimoRbt12)} · ` : ''}${ctx.ultimaReceita ? `receita ${fmtMoeda(ctx.ultimaReceita)}` : ''}\n\n` +
        (distintos.length >= 1 ? `Anexos já usados: ${distintos.map((a) => `Anexo ${a}`).join(', ')}.\n` : '') +
        `Diga "Anexo V com os mesmos valores" ou "calcula no III mantendo tudo".`,
      confianca: 0.9,
      nivel: 'alta',
      fontes: ['Tabela Simples Nacional — Anexos I–V + Reforma (CBS/IBS)'],
      sugestoes: ['Anexo V com os mesmos valores', 'Calcula no III mantendo tudo'],
      botoes: [
        { rotulo: `Ir para Anexo V`, acao: 'perguntar', alvo: `Anexo V com os mesmos valores (RBT12 ${ctx.ultimoRbt12 ?? ''}, receita ${ctx.ultimaReceita ?? ''})` },
        ...(sugestao ? [{ rotulo: `Ir para Anexo ${sugestao}`, acao: 'perguntar' as const, alvo: `Anexo ${sugestao} com os mesmos valores` }] : []),
      ],
      pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Simples: outro anexo ambíguo → perguntar destino', Date.now() - t0),
    }
  }
  // Valor avulso totalmente ambíguo ("e para 5 mil?" sem pista): pergunta qual slot.
  if (edicao.ambiguo) {
    const unico = extrairTodosValores(pergunta)[0]?.valor ?? null
    return {
      texto:
        `Entendi ${unico != null ? fmtMoeda(unico) : 'o valor'} — mas preciso saber onde aplicar.\n` +
        `É **RBT12**, **receita do mês** ou **folha 12m**?\n` +
        `Contexto atual: ${ctx.ultimoAnexo ? `Anexo ${ctx.ultimoAnexo} · ` : ''}${ctx.ultimoRbt12 ? `RBT12 ${fmtMoeda(ctx.ultimoRbt12)} · ` : ''}${ctx.ultimaReceita ? `receita ${fmtMoeda(ctx.ultimaReceita)}` : ''}\n\n` +
        `Ex.: "é a folha", "muda a receita para ${unico != null ? fmtMoeda(unico) : 'X'}" ou "corrige o RBT12 para ${unico != null ? fmtMoeda(unico) : 'X'}".`,
      confianca: 0.9,
      nivel: 'alta',
      fontes: ['Tabela Simples Nacional — Anexos I–V + Reforma (CBS/IBS)'],
      sugestoes: ['É a folha', 'É a receita', 'É o RBT12'],
      botoes: [
        { rotulo: 'É a folha', acao: 'perguntar', alvo: `folha ${unico ?? ''} (RBT12 ${ctx.ultimoRbt12 ?? ''}, receita ${ctx.ultimaReceita ?? ''})` },
        { rotulo: 'É a receita', acao: 'perguntar', alvo: `receita ${unico ?? ''} (RBT12 ${ctx.ultimoRbt12 ?? ''})` },
        { rotulo: 'É o RBT12', acao: 'perguntar', alvo: `RBT12 ${unico ?? ''}` },
      ],
      pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Simples: valor avulso ambíguo → perguntar slot', Date.now() - t0),
    }
  }
  const anexoId = edicao.anexo ?? inferencia?.anexo ?? ctx.ultimoAnexo ?? null
  const anexoInferidoV = slots.anexo == null && inferencia?.anexo === 'V'
  const rbt12 = edicao.rbt12 ?? ctx.ultimoRbt12 ?? null
  const receita = edicao.receitaMes ?? ctx.ultimaReceita ?? null
  // Folha percentual ("30% do RBT") resolve contra o RBT final.
  let folhaCtx = edicao.folha12 ?? ctx.ultimaFolha ?? null
  const folhaPct = resolverFolhaPercentual(pergunta, rbt12)
  if (folhaPct != null) folhaCtx = folhaPct
  const falasUser = historico.filter((m) => m.papel === 'user').map((m) => m.texto)
  const combinado = [...falasUser, pergunta].join('\n')
  const semEmpresa = detectarSemEmpresa(pergunta) || detectarSemEmpresa(falasUser.slice(-3).join('\n'))
  const querTodos = detectarQuerTodosAnexos(pergunta) || (anexoId == null && semEmpresa)
  const querHibridoCtx = detectarQuerHibrido(combinado)
  const exploratorio = detectarModoExploratorio(pergunta, anexoId) || (anexoId == null && (semEmpresa || querTodos))

  /* ---------------- exploratório sem empresa: todos os anexos --------- */
  if (exploratorio) {
    const estado = reconstruirEstadoColeta(pergunta, falasUser)
    // STEP-BY-STEP proativo: nunca projeta número inventado.
    if (!(estado.rbt12 != null && estado.rbt12 > 0)) {
      const sugEx = sugestaoGrafico('exemplo RBT12 500 mil', 'exemplo em tabela')
      void sugEx
      return {
        texto:
          textoColetaEtapa('rbt12', estado, 1, 4) +
          (semEmpresa ? `\n\nSem empresa? Sem problema — comparo **todos os anexos (I–V)** com os mesmos números.` : ''),
        confianca: 0.9, nivel: 'alta',
        fontes: ['Tabela Simples Nacional — Anexos I–V + Reforma (CBS/IBS)'],
        sugestoes: ['RBT12 500 mil', 'RBT12 1,2 milhão', 'O que é RBT12?'],
        botoes: [
          { rotulo: 'Ex.: RBT12 500 mil', acao: 'perguntar', alvo: 'RBT12 500 mil' },
          { rotulo: 'Ex.: RBT12 1,2 milhão', acao: 'perguntar', alvo: 'RBT12 1,2 milhão' },
          { rotulo: 'Abrir Simples Nacional', acao: 'navegar', alvo: 'simples' },
        ],
        pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Simples exploratório: passo 1/4 (RBT12)', Date.now() - t0),
      }
    }
    if (!(estado.receita != null && estado.receita > 0)) {
      return {
        texto: textoColetaEtapa('receita', estado, 2, 4),
        confianca: 0.9, nivel: 'alta',
        fontes: ['Tabela Simples Nacional — Anexos I–V + Reforma (CBS/IBS)'],
        sugestoes: ['Receita 40 mil', 'Receita R$ 36.000'],
        botoes: [
          { rotulo: 'Ex.: receita 40 mil', acao: 'perguntar', alvo: `RBT12 ${estado.rbt12} e receita 40 mil` },
          { rotulo: 'Abrir Simples Nacional', acao: 'navegar', alvo: 'simples' },
        ],
        pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Simples exploratório: passo 2/4 (receita)', Date.now() - t0),
      }
    }
    // Tem base: matriz completa (folha opcional, despesas p/ híbrido).
    const cbsRef = estado.cbsRef
    const despesasCalc = estado.despesas
    const temDespesa = despesasCalc.length > 0
    const entrada = {
      rbt12: estado.rbt12 as number,
      receitaMes: estado.receita as number,
      folha12: estado.folha,
      cbsRef,
      despesas: temDespesa ? despesasCalc : [],
    }
    const res = orquestrarTodosAnexos(entrada)
    const alertaReceita = (estado.receita as number) > (estado.rbt12 as number) ? `\n\nReceita mensal maior que o RBT12 — confirma os valores?` : ''
    // v8 — duelo com o híbrido SÓ sob demanda (clique em "Comparar com regime
    // híbrido", pedido explícito ou despesas já informadas). Sem isso, a matriz
    // mostra só o convencional + convite com botão.
    const mostrarHibrido = querHibridoCtx || temDespesa
    const texto = textoExploratorioCompleto(entrada, res, { mostrarHibrido }) + alertaReceita
    const pedido = detectarPedidoGrafico(pergunta)
    let grafico: GraficoChat | null = null
    try {
      grafico = mostrarHibrido
        ? graficoConvHibTodosAnexos(res.linhas.map((l) => ({ id: l.anexo, conv: l.das, hib: l.totalHibrido })))
        : graficoComparativoAnexos(
            res.linhas.map((l) => ({ id: l.anexo, das: l.das })),
            estado.rbt12 as number,
            estado.receita as number,
          )
      if (pedido.tipo) grafico = aplicarTipoPreferido(grafico, pedido.tipo)
    } catch {
      grafico = null
    }
    const sug = sugestaoGrafico(
      alvoGraficoSimplesTodos(estado.rbt12 as number, estado.receita as number, estado.folha),
      `Mostra em tabela o comparativo dos anexos: RBT12 ${estado.rbt12}, receita ${estado.receita}`,
    )
    const dadosSimples: DadosSimplesChat = {
      titulo: `Aurum AI — Simples exploratório I–V (RBT12 ${estado.rbt12}, receita ${estado.receita})`,
      pergunta: pergunta.slice(0, 300),
      geradoEm: new Date().toLocaleString('pt-BR'),
      entrada,
      resultado: res,
    }
    const botoes: BotaoChat[] = []
    if (estado.folha == null) {
      botoes.push({ rotulo: '📊 Informar folha (III × V)', acao: 'perguntar', alvo: `Folha 200 mil (RBT12 ${estado.rbt12}, receita ${estado.receita})` })
    }
    if (!temDespesa) {
      botoes.push({
        rotulo: mostrarHibrido ? '🧾 Refinar híbrido (despesas)' : '🔀 Comparar com regime híbrido',
        acao: 'perguntar',
        alvo: `Comparar com híbrido: RBT12 ${estado.rbt12}, receita ${estado.receita}${estado.folha ? `, folha ${estado.folha}` : ''}. Usar referência`,
      })
    } else {
      botoes.push({ rotulo: '🧾 Ajustar despesas', acao: 'perguntar', alvo: `Ajustar despesas do híbrido (RBT12 ${estado.rbt12}, receita ${estado.receita}): aluguel, energia, telefone, água, material` })
    }
    return {
      texto: `${texto}\n\n${mostrarHibrido
        ? (temDespesa ? '' : '🧾 **Híbrido acima sem créditos (pessimista).** Para refinar, diga "usar referência" ou informe despesas ("aluguel 2000").\n\n')
        : '🔀 O duelo com o **regime híbrido** (DAS sem CBS + DARF da CBS) só aparece se você pedir — clique em "Comparar com regime híbrido" ou diga "comparar com híbrido".\n\n'}${sug.frase}`,
      confianca: 0.9, nivel: 'alta',
      fontes: mostrarHibrido
        ? ['Tabela Simples Nacional — Anexos I–V + Reforma (CBS/IBS)', 'Fator R (folha/RBT12 ≥ 28% → III)']
        : ['Tabela Simples Nacional — Anexos I–V + Reforma (CBS/IBS)'],
      grafico,
      sugestoes: mostrarHibrido
        ? ['Usar referência', 'Gera relatório dessa simulação', ...sug.sugestoes]
        : ['Comparar com regime híbrido', 'Gera relatório dessa simulação', ...sug.sugestoes],
      botoes: [
        ...botoes,
        { rotulo: '📕 Gerar relatório', acao: 'perguntar', alvo: 'Gera relatório dessa simulação do Simples' },
        ...sug.botoes,
        { rotulo: 'Abrir Simples Nacional', acao: 'navegar', alvo: 'simples' },
      ],
      relatorioOpcoes: { base: 'simples', dados: dadosSimples },
      pensamento: pensar([PENSAR.entender, PENSAR.validar, PENSAR.calcularDas], `Simples exploratório I–V · RBT12 ${fmtMoeda(estado.rbt12 as number)}`, Date.now() - t0),
    }
  }
  // Sem os 3 obrigatórios não há cálculo honesto: PERGUNTA em vez de projetar
  // exemplo (projetar DAS com número inventado induz ao erro — ver print).
  const faltando: string[] = []
  if (anexoId == null) faltando.push('o anexo (I, II, III, IV ou V)')
  if (rbt12 == null) faltando.push('o RBT12 (faturamento dos últimos 12 meses)')
  if (receita == null) faltando.push('a receita do mês')
  if (faltando.length > 0) {
    const entendi: string[] = []
    if (anexoId != null) entendi.push(`Anexo ${anexoId}`)
    if (rbt12 != null) entendi.push(`RBT12 ${fmtMoeda(rbt12)}`)
    if (receita != null) entendi.push(`receita ${fmtMoeda(receita)}`)
    if (folhaCtx != null) entendi.push(`folha ${fmtMoeda(folhaCtx)}`)
    return {
      texto:
        `Para calcular seu DAS no Simples, preciso de ${faltando.join(', ')}.\n` +
        (entendi.length ? `Já entendi: ${entendi.join(' · ')}.\n` : '') +
        `Me diga os que faltam — ex.: "Anexo III, RBT12 500 mil, receita 40 mil" (folha 12m opcional, decide III × V).\n` +
        (mencionaReducaoReceita(pergunta) || /redu[cç][aã]o|despesa|cr[eé]dito/i.test(pergunta)
          ? `Se a receita ou alguma despesa tem redução, diga qual % (ex.: "receita com redução de 30%", "energia 300 com redução de 60%") — aplico no híbrido.\n`
          : '') +
        `\n` +
        `Se preferir, abra o Simples Nacional e simule com o relatório analítico completo.`,
      confianca: 0.9,
      nivel: 'alta',
      fontes: ['Tabela Simples Nacional — Anexos I–V + Reforma (CBS/IBS)'],
      sugestoes: ['DAS Anexo III, RBT12 500 mil, receita 40 mil', 'O que é Fator R?'],
      botoes: [
        { rotulo: 'Abrir Simples Nacional', acao: 'navegar', alvo: 'simples' },
        { rotulo: 'O que é Fator R?', acao: 'perguntar', alvo: 'O que é Fator R?' },
      ],
      pensamento: pensar(
        [PENSAR.entender, PENSAR.validar],
        `Simples incompleto — faltando: ${faltando.join(', ')} (perguntar, não projetar)`,
        Date.now() - t0,
      ),
    }
  }
  const anexo = ANEXOS_SIMPLES[anexoId as AnexoSimplesId]
  if (!anexo) return semLastro()
  // v8 — híbrido sob demanda no cálculo individual: pedido explícito ("no
  // híbrido", "comparar com híbrido"), refino de despesas em thread híbrida
  // ("aluguel 2000", "usar referência") ou receita com redução ("receita com
  // redução de 30%"). Entrega as 2 guias; o duelo Conv×Híb nunca aparece sem
  // clique/pedido.
  const pediuHibridoAgora = detectarQuerHibrido(pergunta)
  const temDespesaAgora =
    extrairDespesasDoTexto(pergunta).length > 0 || /usar refer[eê]ncia/i.test(pergunta)
  const reducaoReceitaAgora = mencionaReducaoReceita(pergunta)
  if (pediuHibridoAgora || reducaoReceitaAgora || (temDespesaAgora && contextoHibridoAtivo([...falasUser, pergunta]))) {
    const cbsRefH = extrairCbsRef([...falasUser, pergunta].join('\n')) ?? CBS_REF_PADRAO
    const despesasH = acumularDespesas([...falasUser, pergunta])
    const detDebH = detectarRegraDebitoReceita([...falasUser, pergunta].join('\n'))
    return responderHibridoAnexo({
      anexo: anexoId as AnexoSimplesId, rbt12: rbt12 as number, receita: receita as number,
      cbsRef: cbsRefH, despesas: despesasH, origem: 'simples:hibrido-sob-demanda',
      regraDebito: detDebH.regra ?? 'cheia', debitoIncerto: detDebH.incerta && detDebH.regra == null,
    })
  }
  // Fator R só existe para serviços III/V (LC 123, art. 18 §5º-C … §5º-I):
  // I/II/IV nunca exibem linha Fator R, fonte Fator R, nem pedido de folha III×V.
  const USA_FATOR_R = anexoId === 'III' || anexoId === 'V'
  const conv = calcularConvencional({ anexoId: anexoId as AnexoSimplesId, rbt12: rbt12 as number, receitaMes: receita as number })
  const fr = USA_FATOR_R ? fatorR(folhaCtx ?? 0, rbt12 as number) : null
  // Só herdados do DOMÍNIO Simples (nunca do IBS) — e sem avisos de exemplo.
  // Fine-tuning v6: eco explícito da edição ("Alterado: folha X → Y, mantidos ...").
  // v7: troca de anexo só carrega o que o destino exige — folha para I/II/IV é
  // arquivada (some do eco e do contexto exibido, mas segue na pilha p/ a volta).
  const MOSTRAR_FOLHA = anexoExigeFolha(anexoId as never)
  if (!MOSTRAR_FOLHA) folhaCtx = null
  const herdados: string[] = []
  if (slots.anexo == null && ctx.ultimoAnexo != null) herdados.push(`Anexo ${ctx.ultimoAnexo} (da conversa)`)
  if (slots.rbt12 == null && ctx.ultimoRbt12 != null) herdados.push(`RBT12 ${fmtMoeda(ctx.ultimoRbt12)} (da conversa)`)
  if (slots.receitaMes == null && ctx.ultimaReceita != null) herdados.push(`receita ${fmtMoeda(ctx.ultimaReceita)} (da conversa)`)
  if (MOSTRAR_FOLHA && slots.folha12 == null && ctx.ultimaFolha != null && edicao.slotAlterado !== 'folha12') herdados.push(`folha ${fmtMoeda(ctx.ultimaFolha)} (da conversa)`)
  const prefixoTroca = edicao.slotAlterado === 'anexo' && (edicao as { observacao?: string | null }).observacao === 'mesmos_valores'
    ? `Indo para o Anexo ${anexoId} com os mesmos valores.\n`
    : (edicao as { observacao?: string | null }).observacao === 'volta'
      ? `Voltado para o valor anterior.\n`
      : (edicao as { observacao?: string | null }).observacao === 'primeiro'
        ? `Usando o primeiro valor informado.\n`
        : (edicao as { observacao?: string | null }).observacao === 'folha_arquivada'
          ? `Indo para o Anexo ${anexoId} com os mesmos valores (folha arquivada — Anexo ${anexoId} não usa folha 12m).\n`
          : ''
  const ecoEdicao = edicao.slotAlterado != null && historico.length > 0
    ? (() => {
        const nomeSlot = edicao.slotAlterado === 'rbt12' ? 'RBT12' : edicao.slotAlterado === 'receitaMes' ? 'receita' : edicao.slotAlterado === 'folha12' ? 'folha' : 'Anexo'
        const novoVal = edicao.slotAlterado === 'rbt12' ? fmtMoeda(rbt12 as number) : edicao.slotAlterado === 'receitaMes' ? fmtMoeda(receita as number) : edicao.slotAlterado === 'folha12' ? fmtMoeda(folhaCtx as number) : `Anexo ${anexoId}`
        const antigoVal = edicao.slotAlterado === 'rbt12' && ctx.ultimoRbt12 != null ? ` (${fmtMoeda(ctx.ultimoRbt12)} → ${novoVal})` : edicao.slotAlterado === 'receitaMes' && ctx.ultimaReceita != null ? ` (${fmtMoeda(ctx.ultimaReceita)} → ${novoVal})` : edicao.slotAlterado === 'folha12' && ctx.ultimaFolha != null ? ` (${fmtMoeda(ctx.ultimaFolha)} → ${novoVal})` : `: ${novoVal}`
        const mantidos: string[] = []
        if (edicao.slotAlterado !== 'rbt12') mantidos.push(`RBT12 ${fmtMoeda(rbt12 as number)}`)
        if (edicao.slotAlterado !== 'receitaMes') mantidos.push(`receita ${fmtMoeda(receita as number)}`)
        if (MOSTRAR_FOLHA && edicao.slotAlterado !== 'folha12' && folhaCtx != null) mantidos.push(`folha ${fmtMoeda(folhaCtx)}`)
        if (edicao.slotAlterado !== 'anexo') mantidos.push(`Anexo ${anexoId}`)
        return `${prefixoTroca}Alterado: ${nomeSlot}${antigoVal}, mantidos ${mantidos.join(' · ')}.\n`
      })()
    : (prefixoTroca || '')
  // Sanidade sem autocorreção: receita maior que RBT12 merece confirmação.
  const alertaReceita = (receita as number) > (rbt12 as number) ? `\n\nReceita mensal maior que o RBT12 — confirma os valores?` : ''
  const ctxLinha = herdados.length || ecoEdicao ? `${ecoEdicao}${herdados.length ? `Contexto usado: ${herdados.join(' · ')}.\n` : ''}` : ''
  const folhaAviso = USA_FATOR_R && folhaCtx == null ? ` — informe a folha 12m para confirmar III × V` : ''
  const avisoInferidoV = anexoInferidoV && folhaCtx == null ? `\nAtividade sugere Anexo V — informe a folha 12m para confirmar III × V.` : ''
  // Bloco Fator R (fine-tuning v6): <28% explica que NÃO é III + quantifica
  // a folha mínima + comparativo III×V + botão de refazer com a folha sugerida.
  let linhaFatorR = ''
  let blocoFatorBaixo = ''
  let botaoRefazerFolha: BotaoChat | null = null
  if (USA_FATOR_R && fr) {
    const pctFR = `${(fr.indice * 100).toFixed(2).replace('.', ',')}%`
    if (folhaCtx == null) {
      linhaFatorR = `\n• Fator R: não calculado (sem folha)${folhaAviso}.`
    } else if (fr.indice >= 0.28) {
      linhaFatorR = `\n• Fator R: ${pctFR} (folha ${fmtMoeda(folhaCtx)} / RBT12 ${fmtMoeda(rbt12 as number)}) — enquadrado (≥ 28%), sustenta o Anexo III. Monitore todo mês.`
    } else {
      const folhaMinima = Math.round((Number(rbt12) || 0) * 0.28 * 100) / 100
      const gap = Math.max(0, Math.round((folhaMinima - (Number(folhaCtx) || 0)) * 100) / 100)
      const gapMensal = Math.round((gap / 12) * 100) / 100
      const dasIII = calcularConvencional({ anexoId: 'III', rbt12: rbt12 as number, receitaMes: receita as number })
      const dasV = calcularConvencional({ anexoId: 'V', rbt12: rbt12 as number, receitaMes: receita as number })
      const economiaMes = Math.round((dasV.das - dasIII.das) * 100) / 100
      linhaFatorR = `\n• Fator R: ${pctFR} (folha ${fmtMoeda(folhaCtx)} / RBT12 ${fmtMoeda(rbt12 as number)}) — sugere Anexo ${fr.anexo}.`
      blocoFatorBaixo =
        `\n⚠️ Com Fator R abaixo de 28%, sua empresa **não é tributada pelo Anexo III** — ela se enquadra no **Anexo V** (LC 123, art. 18 §§5º-C a 5º-I). O DAS acima foi simulado no Anexo ${anexoId}; compare abaixo.` +
        `\n• Para enquadrar no III: folha mínima de 12 meses = **${fmtMoeda(folhaMinima)}** (28% × ${fmtMoeda(rbt12 as number)}). Faltam **${fmtMoeda(gap)}** (~${fmtMoeda(gapMensal)}/mês).` +
        `\n• Comparativo no seu número: DAS III ${fmtMoeda(dasIII.das)} × DAS V ${fmtMoeda(dasV.das)} → ` +
        (economiaMes >= 0
          ? `economia de **${fmtMoeda(economiaMes)}/mês** se migrar para o III.`
          : `o III sairia **${fmtMoeda(Math.abs(economiaMes))}/mês mais caro** neste RBT12/receita — subir a folha só pelo DAS não se paga aqui.`) +
        `\n• Aumente sua folha de pagamento para **${fmtMoeda(folhaMinima)}** (12m) para migrar para o Anexo III.` +
        (economiaMes > 0 && gapMensal > 0
          ? ` O acréscimo mensal (~${fmtMoeda(gapMensal)}) se paga com a economia no DAS — avalie com seu contador antes de contratar/aumentar pró-labore.`
          : ` Atenção: o custo extra de folha pode superar a economia no DAS — confirme com seu contador antes de decidir.`)
      botaoRefazerFolha = {
        rotulo: `🔁 Refazer cálculo com folha ${fmtMoeda(folhaMinima)}`,
        acao: 'perguntar',
        alvo: `__RECALCULAR_FATOR_R__ RBT12=${rbt12 as number} RECEITA=${receita as number} FOLHA=${folhaMinima} ANEXO_ATUAL=${anexoId}`,
      }
    }
  }
  // Fecho sem "III×V" fora de III/V (evita sugerir Anexo V a quem é I/II/IV).
  const fechoComparativo = USA_FATOR_R
    ? `\n\nPara o comparativo completo (III×V, Conv×Híb) abra o Simples Nacional e gere o relatório analítico.`
    : `\n\nPara o comparativo completo abra o Simples Nacional e gere o relatório analítico.`
  // Payloads serializados com os valores da conversa (handlers em 08-02).
  const payloadAnexos = `__COMPARAR_ANEXOS__ RBT12=${rbt12 as number} RECEITA=${receita as number} FOLHA=${folhaCtx ?? 0} ANEXO_ATUAL=${anexoId}`
  const payloadHibrido = `__COMPARAR_HIBRIDO__ RBT12=${rbt12 as number} RECEITA=${receita as number} FOLHA=${folhaCtx ?? 0} ANEXO=${anexoId} DESPESA=0`
  // Visual preditivo: todo DAS calculado gera a pizza da repartição
  // automaticamente. O pedido explícito só escolhe o modelo inicial.
  const pedidoSimples = detectarPedidoGrafico(pergunta)
  let graficoSimples: GraficoChat | null = null
  try {
    graficoSimples = graficoReparticaoDAS(conv.reparticao, String(anexoId))
    if (pedidoSimples.tipo) graficoSimples = aplicarTipoPreferido(graficoSimples, pedidoSimples.tipo)
  } catch {
    graficoSimples = null
  }
  const sugSimples = sugestaoGrafico(alvoGraficoSimples(String(anexoId), rbt12 as number, receita as number, folhaCtx))
  const botoesSimples: BotaoChat[] = [
    ...(botaoRefazerFolha ? [botaoRefazerFolha] : []),
    { rotulo: '⚖️ Comparar com outros anexos', acao: 'perguntar', alvo: payloadAnexos },
    { rotulo: '🔀 Comparar com regime híbrido', acao: 'perguntar', alvo: payloadHibrido },
    ...sugSimples.botoes,
    { rotulo: 'Abrir Simples Nacional', acao: 'navegar', alvo: 'simples' },
  ]
  return {
    texto:
      `${ctxLinha}` +
      `• Anexo ${anexoId} · ${conv.faixa}ª faixa · RBT12 ${fmtMoeda(rbt12 as number)} · receita ${fmtMoeda(receita as number)}\n` +
      `• Alíquota efetiva ${(conv.aliquotaEfetiva * 100).toFixed(4)}% → DAS **${fmtMoeda(conv.das)}** (CBS dentro do DAS: ${fmtMoeda(conv.cbsDentroDAS)})` +
      `${linhaFatorR}${blocoFatorBaixo}${avisoInferidoV}${alertaReceita}` +
      `${fechoComparativo}` +
      `${graficoSimples ? `\n\n📊 Gráfico **${graficoSimples.titulo}** gerado abaixo (altere o modelo no cartão).` : `\n\n${sugSimples.frase}`}`,
    confianca: herdados.length ? 0.8 : 0.9,
    nivel: 'alta',
    fontes: USA_FATOR_R
      ? ['Tabela Simples Nacional — Anexos I–V + Reforma (CBS/IBS)', 'Fator R (folha/RBT12 ≥ 28% → III)']
      : ['Tabela Simples Nacional — Anexos I–V + Reforma (CBS/IBS)'],
    grafico: graficoSimples,
    sugestoes: [...(botaoRefazerFolha ? ['Refazer com folha sugerida'] : []), 'Gera um relatório dessa conversa', ...sugSimples.sugestoes],
    botoes: botoesSimples,
    pensamento: pensar([PENSAR.entender, PENSAR.validar, PENSAR.calcularDas], `Anexo ${anexoId} · RBT12 ${fmtMoeda(rbt12 as number)}${herdados.length ? ' (com contexto)' : ''}`, Date.now() - t0),
  }
}

/* --------------------------------------------- clientes + dados (XML) -- */

function botoesDados(): BotaoChat[] {
  return [
    { rotulo: 'Ir para Notas Fiscais', acao: 'navegar', alvo: 'nfe' },
    { rotulo: 'Ir para Produtos', acao: 'navegar', alvo: 'produtos' },
  ]
}

/** Rótulo curto do motor de ações (para o "ver raciocínio" honesto). */
function acaoRotuloCurto(acao: string): string {
  const mapa: Record<string, string> = {
    inventario: 'inventário',
    ranking_fornecedores: 'rank-fornecedores',
    ranking_produtos_geral: 'rank-produtos',
    ranking_produtos_credito: 'prod-credito',
    ranking_produtos_debito: 'prod-debito',
    listar_produtos: 'listar-produtos',
    diferidos: 'diferidos',
    reducoes: 'reduções',
    tributacao_ncm: 'trib-ncm',
    apuracao: 'apuração',
    filtros: 'filtros',
    panorama: 'panorama',
  }
  return mapa[acao] ?? acao
}

/**
 * Intenção `clientes`: inventário do CADASTRO (quem são, quantos, com/sem XML).
 * Vice-versa com XML: para cada cliente mostra se há notas e quantas.
 */
async function responderClientes(pergunta: string): Promise<RespostaChat> {
  const t0 = Date.now()
  try {
    const { listarClientesComMovimento } = await import('./aurum-ai-dados')
    const clientes = await listarClientesComMovimento()
    if (!clientes.length) {
      return {
        texto:
          `Ainda não há **nenhum cliente (empresa) cadastrado** no sistema — por isso não tenho XMLs para mostrar.\n\n` +
          `**Como resolver:** cadastre pelo CNPJ em Empresas (puxa da BrasilAPI em 1 clique) e importe os XMLs em Notas Fiscais. Depois me pergunte de novo — ex.: "tem XML de algum cliente?".`,
        confianca: 1, nivel: 'alta',
        fontes: ['Base de empresas do sistema'],
        sugestoes: ['O que você pode fazer?', 'Quais atividades o CNPJ 53.795.990/0001-68 tem?'],
        botoes: [
          { rotulo: 'Qual fornecedor me dá mais crédito?', acao: 'perguntar', alvo: 'Qual fornecedor me dá mais crédito?' },
          ...botoesDados(),
        ],
        pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Clientes: nenhum cadastro', Date.now() - t0),
      }
    }
    const comNotas = clientes.filter((c) => c.qtdNotas > 0)
    const semNotas = clientes.filter((c) => c.qtdNotas === 0)
    const linhas = clientes.slice(0, 10).map((c, i) => {
      const nome = c.fantasia && c.fantasia !== c.razaoSocial ? `${c.razaoSocial} (${c.fantasia})` : c.razaoSocial
      const xml = c.qtdNotas > 0
        ? `${c.qtdNotas} nota(s) · base ${fmtMoeda(c.base)}`
        : 'sem XML importado'
      return `${i + 1}. **${nome}**${c.uf ? `/${c.uf}` : ''} — ${xml}`
    }).join('\n')
    const extras = clientes.length > 10 ? `\n…e mais ${clientes.length - 10} — veja todos em Empresas.` : ''
    const avisoSem = semNotas.length
      ? `\n\nSem XML: ${semNotas.slice(0, 3).map((c) => c.razaoSocial).join(', ')}${semNotas.length > 3 ? ` (+${semNotas.length - 3})` : ''} — importe em Notas Fiscais.`
      : ''
    void pergunta
    // Visual preditivo: inventário com movimento gera a barra por base
    // automaticamente (reativo ao cadastro: muda o cadastro, muda o gráfico).
    const pedidoCli = detectarPedidoGrafico(pergunta)
    let graficoCli: GraficoChat | null = null
    try {
      graficoCli = graficoClientes(clientes.map((c) => ({ razaoSocial: c.razaoSocial, fantasia: c.fantasia, base: c.base, qtdNotas: c.qtdNotas })))
      if (graficoCli && pedidoCli.tipo) graficoCli = aplicarTipoPreferido(graficoCli, pedidoCli.tipo)
    } catch {
      graficoCli = null
    }
    const sugCli = sugestaoGrafico('Mostra em gráfico os meus clientes por movimento', 'Mostra em tabela os meus clientes por movimento')
    return {
      texto:
        `Você tem **${clientes.length} cliente(s) cadastrado(s)** — **${comNotas.length} com XML**, ${semNotas.length} sem XML:\n${linhas}${extras}${avisoSem}\n\n` +
        `**Próximo passo:** pergunte pelo movimento — ex.: "tem XML do cliente ${comNotas[0]?.razaoSocial ?? clientes[0].razaoSocial}?", "qual fornecedor me dá mais crédito?" ou "quais reduções nas notas?".` +
        `${graficoCli ? `\n\n📊 Gráfico **${graficoCli.titulo}** gerado abaixo (altere o modelo no cartão).` : `\n\n${sugCli.frase}`}`,
      confianca: 1, nivel: 'alta',
      fontes: ['Base de empresas do sistema', 'XMLs importados (NF-e/NFC-e)'],
      grafico: graficoCli,
      sugestoes: ['Tem XML de algum cliente?', 'Qual fornecedor me dá mais crédito?', 'Existe algum produto diferido?', ...sugCli.sugestoes],
      botoes: [
        { rotulo: 'Tem XML de algum cliente?', acao: 'perguntar', alvo: 'Tem XML de algum cliente?' },
        { rotulo: 'Qual fornecedor me dá mais crédito?', acao: 'perguntar', alvo: 'Qual fornecedor me dá mais crédito?' },
        ...sugCli.botoes,
        ...botoesDados(),
      ],
      pensamento: pensar([PENSAR.entender, PENSAR.consultar(clientes.length), PENSAR.validar], `Clientes: ${clientes.length} (${comNotas.length} com XML)`, Date.now() - t0),
    }
  } catch (e) {
    return {
      texto: `Não consegui ler os clientes agora (${e instanceof Error ? e.message : 'erro interno'}). Abra Empresas para ver o cadastro.`,
      confianca: 0.6, nivel: 'media', fontes: [],
      pensamento: pensar([PENSAR.entender], 'Falha ao ler clientes', Date.now() - t0),
    }
  }
}

/**
 * Intenção `dados`: a IA consulta os XMLs e entende vice-versa
 * (cliente → notas, fornecedor/nota → dono). Cobre, com números do motor:
 * - inventário ("tem XML de algum cliente?");
 * - fornecedor que mais dá crédito (entradas, badge Simples/sem-crédito);
 * - produto que gera débito (saídas) / crédito (entradas);
 * - filtros diversos (cliente, fornecedor, produto, NCM, CFOP, CST,
 *   cClassTrib, redução, anexo, direção, período, top N);
 * - diferidos (efetivos 510/515 + condicionais Anexo IX);
 * - reduções encontradas (faixas IBS/CBS com base nas notas);
 * - tributação por NCM (CST, cClassTrib, anexo, reduções).
 * Termina propondo a estrutura do PDF customizado (blocos) + botões.
 */
async function responderDados(pergunta: string, historico: MensagemHistorico[] = []): Promise<RespostaChat> {
  const t0 = Date.now()
  const n = pergunta.toLowerCase()
  try {
    const dados = await import('./aurum-ai-dados')
    const { avaliarAcoesDados } = await import('@/domain/services/acoes-dados')
    const ctx = contextoBaseDoTurno(historico)
    // Motor determinístico: todas as ações possíveis + probabilidade real
    // dado o histórico (ex.: após panorama, "top produtos" → ranking 0.9).
    const rankingAcoes = avaliarAcoesDados(pergunta, { houveDados: ctx.houveDados })
    const topAcao = rankingAcoes[0]
    const trilhaAcoes = rankingAcoes.slice(0, 3).map((a) => `${acaoRotuloCurto(a.acao)} ${a.score.toFixed(2)}`).join(' > ')
    // Follow-up herda o último escopo de dados ("e desse cliente?", "só as entradas",
    // "quais top produtos desse cliente?"). Frases curtas concatenam; frases com
    // anáfora herdam os filtros estruturados (cliente/CNPJ/fornecedor/período).
    const ehCurto = pergunta.trim().split(/\s+/).length <= 8
    const perguntaEfetiva = ctx.houveDados && ctx.ultimoFiltroDados && ehCurto
      ? `${ctx.ultimoFiltroDados} ${pergunta}`
      : pergunta
    let filtro = dados.extrairFiltrosDados(perguntaEfetiva)
    if (ctx.houveDados && ctx.ultimoFiltroDados && dados.temAnaforaFiltro(pergunta) && (filtro.clienteTexto == null || filtro.cnpj == null)) {
      try {
        const anterior = dados.extrairFiltrosDados(ctx.ultimoFiltroDados)
        filtro = dados.mesclarFiltrosComContexto(filtro, anterior)
      } catch {
        /* herança é best-effort */
      }
    }
    // Fine-tuning v3 — DE QUAL EMPRESA? Resolve a menção contra o cadastro
    // ANTES do escopo: única ancora (filtra por ela), ambígua pergunta qual,
    // não encontrada orienta com quem existe. Sem menção, o escopo segue a
    // regra vigente (ativa ou todas) e a resposta avisa o recorte.
    let prefixoEmpresa = ''
    try {
      const mencaoEmpresa = filtro.clienteTexto ?? ctx.ultimaEmpresaMencionada ?? null
      if (mencaoEmpresa) {
        const { resolverEmpresaAlvo, nomeEmpresa, textoDesambiguacaoEmpresa } = await import('./aurum-ai-empresa')
        const clientes = await dados.listarClientesComMovimento().catch(() => [])
        let ativaId: number | null = null
        try {
          const v = typeof localStorage !== 'undefined' ? localStorage.getItem('aurum_empresa_ativa_id') : null
          const idNum = v != null ? Number(v) : NaN
          ativaId = Number.isFinite(idNum) ? idNum : null
        } catch { ativaId = null }
        const res = resolverEmpresaAlvo(mencaoEmpresa, clientes.map((c) => ({ id: c.id, razaoSocial: c.razaoSocial, fantasia: c.fantasia, cnpj: c.cnpj })), ativaId)
        if (res.tipo === 'ambigua') {
          return {
            texto: `${textoDesambiguacaoEmpresa(res)}\n\nDica: mencione o produto junto ("o produto X da empresa 1") ou peça o cálculo ("quanto fica ...?") — eu já prossigo no escopo certo.`,
            confianca: 0.9, nivel: 'alta',
            fontes: ['Base de empresas do sistema'],
            sugestoes: res.candidatas.map((c) => `Da empresa ${nomeEmpresa(c)}: qual fornecedor dá mais crédito?`).slice(0, 3),
            botoes: botoesDados(),
            pensamento: pensar([PENSAR.entender, PENSAR.validar], `Dados: empresa ambígua "${mencaoEmpresa}" → desambiguar`, Date.now() - t0),
          }
        }
        if (res.tipo === 'unica') {
          filtro.clienteTexto = res.candidatas[0].razaoSocial
          prefixoEmpresa = `**Empresa:** ${nomeEmpresa(res.candidatas[0])}\n\n`
        } else if (res.tipo === 'nao_encontrada') {
          const quemTem = clientes.filter((c) => c.qtdNotas > 0).slice(0, 5)
          return {
            texto:
              `Não encontrei nenhuma empresa para "${mencaoEmpresa}" no cadastro.\n\n` +
              (quemTem.length ? `**Quem TEM XML:** ${quemTem.map((c) => c.razaoSocial).join(', ')}.\n\n` : '') +
              `Confira o nome (vale parcial — ex.: "Pão Dourado") ou o CNPJ, ou cadastre em Empresas pelo CNPJ. Depois pergunte de novo — ex.: "produtos da <empresa>?".`,
            confianca: 0.9, nivel: 'alta',
            fontes: ['Base de empresas do sistema'],
            sugestoes: ['Quais meus clientes?', 'Tem XML de algum cliente?'],
            botoes: botoesDados(),
            pensamento: pensar([PENSAR.entender, PENSAR.validar], `Dados: empresa "${mencaoEmpresa}" não encontrada`, Date.now() - t0),
          }
        }
      }
    } catch {
      /* resolução de empresa é best-effort — segue o escopo padrão */
    }
    const querFiltros = /quais filtros|que filtros|como filtr|filtrar por|opcoes de filtro|opções de filtro/.test(n)

    const escopo = await dados.notasDoEscopo(filtro)
    const recorte = dados.rotuloFiltros(filtro)

    // Situação adversa 1: nenhum cliente cadastrado.
    if (escopo.totalClientes === 0) {
      return {
        texto:
          `Não há **nenhum cliente cadastrado e nenhum XML importado** — não tenho o que consultar.\n\n` +
          `**Para começar:** 1) cadastre a empresa pelo CNPJ em Empresas; 2) importe os XMLs em Notas Fiscais. Depois pergunte — ex.: "qual fornecedor me dá mais crédito?".`,
        confianca: 1, nivel: 'alta',
        fontes: ['Base de empresas do sistema'],
        sugestoes: ['O que você pode fazer?', 'Quais atividades o CNPJ 53.795.990/0001-68 tem?'],
        botoes: botoesDados(),
        pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Dados: zero clientes, zero notas', Date.now() - t0),
      }
    }
    // Situação adversa 2: clientes existem, mas zero notas no escopo geral.
    if (escopo.notas.length === 0 && !querFiltros) {
      const todos = await dados.listarClientesComMovimento().catch(() => [])
      const semNada = todos.every((c) => c.qtdNotas === 0)
      if (semNada) {
        return {
          texto:
            `Você tem **${escopo.totalClientes} cliente(s)**, mas **nenhum XML importado** ainda — não há movimento para analisar.\n\n` +
            `Importe os XMLs em Notas Fiscais (o sistema apura IBS/CBS na hora). Depois pergunte — ex.: "tem XML de algum cliente?", "qual produto gera mais débito?".`,
          confianca: 1, nivel: 'alta',
          fontes: ['Base de empresas do sistema', 'XMLs importados (NF-e/NFC-e)'],
          botoes: botoesDados(),
          pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Dados: clientes sem notas', Date.now() - t0),
        }
      }
      // Cliente específico sem notas (vice-versa responde quem TEM).
      const comNotas = todos.filter((c) => c.qtdNotas > 0).slice(0, 5)
      return {
        texto:
          `No recorte **${recorte}** não encontrei notas — ${escopo.clienteAlvo ? `o cliente citado não tem XML nesse recorte.` : 'nada casa com esses filtros.'}\n\n` +
          (comNotas.length ? `**Quem TEM XML:** ${comNotas.map((c) => `${c.razaoSocial} (${c.qtdNotas})`).join(', ')}.\n\n` : '') +
          `Tente ampliar (tirar o período, trocar o nome) ou veja os filtros que entendo: cliente, fornecedor, produto, NCM, CFOP, CST, cClassTrib, redução, anexo, direção, período, diferidos.`,
        confianca: 0.9, nivel: 'alta',
        fontes: ['XMLs importados (NF-e/NFC-e)', 'Base de empresas do sistema'],
        sugestoes: ['Tem XML de algum cliente?', 'Quais filtros posso usar?'],
        botoes: [
          { rotulo: 'Tem XML de algum cliente?', acao: 'perguntar', alvo: 'Tem XML de algum cliente?' },
          ...botoesDados(),
        ],
        pensamento: pensar([PENSAR.entender, PENSAR.validar], `Dados: escopo vazio (${recorte})`, Date.now() - t0),
      }
    }

    // "quais filtros posso usar?" — lista as possibilidades.
    if (querFiltros) {
      return {
        texto:
          `Entendo **todos estes filtros** (podem combinar — ex.: "entradas do fornecedor ACME em janeiro/2026 com redução de 60%"):\n` +
          dados.FILTROS_SUPORTADOS.map((f) => `• ${f}`).join('\n') +
          `\n\nNo momento há **${escopo.notas.length} nota(s)** no recorte ${recorte}. Pergunte — ex.: "qual fornecedor me dá mais crédito?" — ou peça o PDF.`,
        confianca: 1, nivel: 'alta',
        fontes: ['XMLs importados (NF-e/NFC-e)'],
        sugestoes: ['Qual fornecedor me dá mais crédito?', 'Existe algum produto diferido?', 'Quais reduções nas notas?'],
        botoes: [
          { rotulo: 'Qual fornecedor me dá mais crédito?', acao: 'perguntar', alvo: 'Qual fornecedor me dá mais crédito?' },
          { rotulo: 'Gerar PDF disso', acao: 'perguntar', alvo: `Gera um PDF com ${recorte || 'todo o movimento'}` },
        ],
        pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Dados: lista de filtros', Date.now() - t0),
      }
    }

    // Agregações do escopo (números do motor).
    const resumo = dados.resumirEscopo(escopo.notas)
    const fornecedores = dados.agregarFornecedores(escopo.notas, filtro.topN)
    const produtosCred = dados.agregarProdutos(escopo.notas, 'entrada', 5)
    const produtosDeb = dados.agregarProdutos(escopo.notas, 'saida', 5)
    const reducoes = dados.agregarReducoes(escopo.notas)
    const dif = dados.agregarDiferidos(escopo.notas)
    const ncms = dados.agregarNcm(escopo.notas, 8)

    const partes: string[] = []
    partes.push(`**${escopo.notas.length} nota(s)** no recorte **${recorte}**${escopo.empresaNomes.length === 1 ? ` — ${escopo.empresaNomes[0]}` : ''} (crédito ${fmtMoeda(resumo.credito)} · débito ${fmtMoeda(resumo.debito)} · **saldo ${fmtMoeda(resumo.saldo)} ${resumo.resultado}**).`)

    // Pergunta específica: fornecedor-crédito.
    if (/fornecedor|credito|crédito|comprou de|quem.*(da|gera)/.test(n)) {
      if (!fornecedores.length) {
        partes.push(`Sem entradas nesse recorte — crédito só se forma em **compras (entradas)**. Tente sem o filtro de vendas.`)
      } else {
        const top = fornecedores[0]
        const linhas = fornecedores.slice(0, 5).map((f, i) =>
          `${i + 1}. **${f.nome}** — ${f.qtdNotas} nota(s) · base ${fmtMoeda(f.base)} · crédito **${f.simples ? '— (Simples/MEI: sem crédito)' : fmtMoeda(f.creditoTotal)}**`,
        ).join('\n')
        partes.push(`**Quem mais te dá crédito:** ${top.simples ? `**${top.nome}** aparece no topo por volume, mas é Simples/MEI — **não transfere crédito**. O maior crédito apropriável é de outro fornecedor abaixo.` : `**${top.nome}** com ${fmtMoeda(top.creditoTotal)}.`}\n${linhas}`)
      }
    }
    // Pergunta específica: produto débito/crédito.
    // Cobre todas as formas: "top produtos", "mais vendidos/comprados",
    // "geraram crédito/débito", "lista os produtos vendidos", "ranking".
    const vocabProduto = /produto|debito|débito|vendi|vendeu|vendidos?|comprei|comprou|comprados?|top|ranking|lista/.test(n)
    const motorQuerProduto =
      topAcao.acao === 'ranking_produtos_geral' ||
      topAcao.acao === 'ranking_produtos_credito' ||
      topAcao.acao === 'ranking_produtos_debito' ||
      topAcao.acao === 'listar_produtos'
    if ((vocabProduto || motorQuerProduto) && !/fornecedor|credito.*fornecedor/.test(n)) {
      const bloco = (titulo: string, lista: typeof produtosDeb): string =>
        lista.length
          ? `${titulo}:\n${lista.slice(0, 5).map((p, i) => `${i + 1}. **${p.nome.slice(0, 44)}** (${p.direcao === 'entrada' ? 'compra' : 'venda'}${p.ncm ? ` · NCM ${p.ncm}` : ''}) — base ${fmtMoeda(p.base)} · IBS+CBS **${fmtMoeda(p.trib)}**`).join('\n')}`
          : `${titulo}: — (sem movimento nesse recorte).`
      if (filtro.direcao !== 'saida') partes.push(bloco('**Produtos que geram crédito (compras)**', produtosCred))
      if (filtro.direcao !== 'entrada') partes.push(bloco('**Produtos que geram débito (vendas)**', produtosDeb))
    }
    // Pergunta específica: diferidos.
    if (/diferid/.test(n)) {
      if (!dif.efetivos.length && !dif.condicionais.length) {
        partes.push(`**Nenhum produto diferido** nesse recorte — tudo é tributação normal ou com redução (diferimento efetivo = CST 510/515).`)
      } else {
        if (dif.efetivos.length) {
          partes.push(`**Diferidos efetivos (${dif.efetivos.length}):**\n${dif.efetivos.slice(0, 5).map((x) => `• **${x.nome.slice(0, 40)}** (NCM ${x.ncm || '—'} · CST ${x.cst}/${x.cct}) — base ${fmtMoeda(x.base)}`).join('\n')}`)
        }
        if (dif.condicionais.length) {
          partes.push(`**Anexo IX condicional (${dif.condicionais.length} — diferimento só se a operação se enquadrar, art. 138 §2º):**\n${dif.condicionais.slice(0, 3).map((x) => `• ${x.nome.slice(0, 40)} (CST ${x.cst}/${x.cct})`).join('\n')}`)
        }
      }
    }
    // Pergunta específica: reduções.
    if (/reducao|redução|isento|beneficio|anexo/.test(n) && !/fornecedor|diferid/.test(n)) {
      partes.push(`**Reduções encontradas (com base nas notas):**\n${reducoes.slice(0, 6).map((r) => `• ${r.rotulo} — ${r.itens} item(ns) · base ${fmtMoeda(r.base)}`).join('\n') || '—'}`)
    }
    // Pergunta genérica/inventário ("tem XML de algum cliente?"): panorama.
    const ehPanorama = /tem .*xml|algum cliente|alguma nota|quantas notas|quais clientes.*(tem|com)|panorama|resumo|tudo|geral/.test(n) && !/fornecedor|produto|diferid|reducao|redução|ncm|cst|cfop/.test(n)
    if (ehPanorama || (!/fornecedor|produto|diferid|reducao|redução|ncm|cst|cfop|debito|débito|credito|crédito/.test(n))) {
      if (fornecedores.length) {
        const top = fornecedores[0]
        partes.push(`**Top crédito:** ${top.nome} — ${top.simples ? 'Simples (sem crédito)' : fmtMoeda(top.creditoTotal)}.`)
      }
      const topDeb = produtosDeb[0]
      const topCred = produtosCred[0]
      if (topCred) partes.push(`**Top compra (crédito):** ${topCred.nome.slice(0, 40)} — ${fmtMoeda(topCred.trib)}.`)
      if (topDeb) partes.push(`**Top venda (débito):** ${topDeb.nome.slice(0, 40)} — ${fmtMoeda(topDeb.trib)}.`)
      if (reducoes.length) partes.push(`**Reduções:** ${reducoes.slice(0, 3).map((r) => r.rotulo).join(' · ')}.`)
      if (dif.efetivos.length) partes.push(`**Diferidos:** sim — ${dif.efetivos.length} NCM(s) com diferimento efetivo. Pergunte "quais produtos diferidos?" para a lista.`)
      if (ncms.length) partes.push(`**NCMs no recorte:** ${ncms.length} distinto(s), maior base ${ncms[0].ncm} (CST ${ncms[0].cst}/${ncms[0].cct}).`)
    }
    // NCM/CST/CFOP explícitos: detalha a tributação do recorte.
    if (/ncm|cst|cclasstrib|cct|cfop|tributacao por/.test(n) && ncms.length) {
      partes.push(`**Tributação por NCM (top):**\n${ncms.slice(0, 5).map((x) => `• NCM ${x.ncm} (${x.exemplo.slice(0, 30)}) — CST ${x.cst}/${x.cct} · red. ${x.redIBS}%/${x.redCBS}% · base ${fmtMoeda(x.base)}`).join('\n')}`)
    }

    // Proposta de PDF customizado (estrutura programada no padrão do sistema).
    const { blocosParaPergunta, descreverEstrutura } = await import('./aurum-ai-dados-pdf')
    const blocos = blocosParaPergunta(pergunta, filtro)
    const estrutura = descreverEstrutura(blocos)
    partes.push(`**Posso gerar um PDF customizado disso** (layout do sistema: timbrado + KPIs + veredito):\n${estrutura.map((s, i) => `${i + 1}. ${s}`).join('\n')}\nDiga "gera um PDF disso" e escolha o formato.`)

    // Congela o escopo para o turno 2 (números do motor, não da conversa).
    const { FILTRO_DADOS_VAZIO: _v } = dados
    void _v
    const payload = {
      titulo: `Aurum AI — dados (${recorte.slice(0, 60) || 'movimento'})`,
      escopo: recorte,
      empresaNome: escopo.empresaNomes.length === 1 ? escopo.empresaNomes[0] : `${escopo.empresaNomes.length} empresas`,
      qtdNotas: escopo.notas.length,
      filtro,
      resumo,
      fornecedores,
      produtos: [...produtosCred, ...produtosDeb].sort((a, b) => b.trib - a.trib).slice(0, 10),
      reducoes,
      diferidosEfetivos: dif.efetivos,
      diferidosCondicionais: dif.condicionais,
      ncms,
      blocos,
      geradoEm: new Date().toLocaleString('pt-BR'),
    }

    // Visual preditivo e reativo: toda consulta de dados com escopo gera o
    // artefato do recorte automaticamente (fornecedor/produto/diferido/
    // redução/NCM/evolução/confronto/panorama), a partir dos números do
    // motor. O pedido explícito ("em pizza", "em tabela") só escolhe o
    // modelo inicial; sem pedido, o roteador escolhe o recorte da pergunta.
    const pedidoDados = detectarPedidoGrafico(perguntaEfetiva)
    let graficoDados: GraficoChat | null = null
    try {
      // Evolução/confronto precisam de agregações temporais sobre as notas.
      let evolucao: Array<{ rotulo: string; baseEntradas: number; baseSaidas: number }> | undefined
      let confronto: { antigo: number; novo: number; icms: number; pisCofins: number; ibs: number; cbs: number } | undefined
      const nEfetiva = perguntaEfetiva.toLowerCase()
      if (/evolucao|evolução|mensal|ao longo|tendencia/.test(nEfetiva)) {
        try {
          const { evolucaoMensal } = await import('@/application/nfe-insights')
          evolucao = evolucaoMensal(escopo.notas as never, 12) as unknown as NonNullable<typeof evolucao>
        } catch {
          evolucao = undefined
        }
      }
      if (/confronto|antigo.*novo|regime antigo/.test(nEfetiva)) {
        try {
          const { confrontoRegimes } = await import('@/application/nfe-insights')
          confronto = confrontoRegimes(escopo.notas as never) as unknown as NonNullable<typeof confronto>
        } catch {
          confronto = undefined
        }
      }
      graficoDados = planejarGraficoDados(
        perguntaEfetiva,
        {
          fornecedores,
          produtosCred,
          produtosDeb,
          reducoes,
          diferidosEfetivos: dif.efetivos,
          diferidosCondicionais: dif.condicionais,
          ncms,
          resumo,
          evolucao,
          confronto,
        },
        pedidoDados.tipo,
      )
    } catch {
      graficoDados = null
    }
    const sugDados = sugestaoGrafico(alvoGraficoDados(recorte))
    if (graficoDados) {
      partes.push(`📊 Gráfico **${graficoDados.titulo}** gerado abaixo (altere pizza/barras/linha/tabela no cartão).`)
    } else {
      partes.push(sugDados.frase)
    }

    return {
      texto: `${prefixoEmpresa}${partes.join('\n\n')}`,
      confianca: 0.95, nivel: 'alta',
      fontes: ['XMLs importados (NF-e/NFC-e)', 'Vínculos oficiais da Reforma (CST × cClassTrib)', 'Base de empresas do sistema'],
      grafico: graficoDados,
      sugestoes: ['Gera um PDF disso', 'Existe algum produto diferido?', 'Quais reduções nas notas?', ...sugDados.sugestoes],
      botoes: [
        { rotulo: 'Gerar PDF disso', acao: 'perguntar', alvo: `Gera um PDF com ${recorte || 'todo o movimento'}` },
        { rotulo: 'Quais filtros posso usar?', acao: 'perguntar', alvo: 'Quais filtros posso usar?' },
        ...sugDados.botoes,
        ...botoesDados(),
      ],
      relatorioOpcoes: {
        base: 'dados',
        dados: { titulo: payload.titulo, pergunta, escopo: recorte, geradoEm: payload.geradoEm, payload },
      },
      pensamento: pensar(
        [PENSAR.entender, PENSAR.consultar(escopo.notas.length), PENSAR.analisar, PENSAR.validar],
        `Dados reais → ${escopo.notas.length} nota(s) · ${recorte} · ações: ${trilhaAcoes}`,
        Date.now() - t0,
      ),
    }
  } catch (e) {
    return {
      texto: `Não consegui consultar seus dados agora (${e instanceof Error ? e.message : 'erro interno'}). Abra Notas Fiscais para ver as notas importadas.`,
      confianca: 0.6, nivel: 'media', fontes: [],
      botoes: botoesDados(),
      pensamento: pensar([PENSAR.entender], 'Falha ao consultar dados', Date.now() - t0),
    }
  }
}

/* -------------------------------------------------------- relatórios -- */

function botoesFormato(): BotaoChat[] {
  return [
    { rotulo: 'PDF (.pdf) — timbrado', acao: 'formato', alvo: 'pdf' },
    { rotulo: 'CSV (.csv) — Excel', acao: 'formato', alvo: 'csv' },
    { rotulo: 'JSON (.json)', acao: 'formato', alvo: 'json' },
    { rotulo: 'TXT (.txt)', acao: 'formato', alvo: 'txt' },
  ]
}

export function montarRelatorioConversa(d: DadosConversa, formato: FormatoRelatorio): RelatorioChat {
  const geradoEm = d.geradoEm || new Date().toLocaleString('pt-BR')
  const nomeBase = `aurum-ai-conversa-${new Date().toISOString().slice(0, 10)}`
  if (formato === 'pdf') {
    // PDF sai pelo motor pdfMake (ver `exportarRelatorioChatPDF` em
    // `aurum-ai-chat-pdf.ts`): aqui só o nome/mime para a UI.
    return { nome: `${nomeBase}.pdf`, conteudo: '', mime: 'application/pdf', tamanho: 0 }
  }
  if (formato === 'json') {
    const payload = {
      geradoEm, geradoPor: 'Aurum AI', base: 'conversa' as const,
      pergunta: d.pergunta,
      mensagens: d.historico.slice(-20),
      fontes: ['Nomenclatura vigente (TEC)', 'Vínculos oficiais da Reforma (CST × cClassTrib)', 'LC 214/2025'],
      aviso: 'Conteúdo informativo — confirme com o contador antes de escriturar.',
    }
    const conteudo = JSON.stringify(payload, null, 2)
    return { nome: `${nomeBase}.json`, conteudo, mime: 'application/json', tamanho: conteudo.length }
  }
  if (formato === 'txt') {
    const linhas = [
      `Aurum AI — relatório da conversa`,
      `Gerado em ${geradoEm}`,
      ``,
      ...d.historico.slice(-20).map((m) => `${m.papel === 'user' ? 'Você' : 'Aurum AI'}: ${m.texto.replace(/\s+/g, ' ').slice(0, 500)}`),
      ``,
      `Pedido atual: ${d.pergunta}`,
      `Fontes: Nomenclatura vigente (TEC) · Vínculos oficiais (CST × cClassTrib) · LC 214/2025`,
      `Aviso: conteúdo informativo — confirme com o contador antes de escriturar.`,
    ]
    const conteudo = linhas.join('\n')
    return { nome: `${nomeBase}.txt`, conteudo, mime: 'text/plain;charset=utf-8', tamanho: conteudo.length }
  }
  const linhas: string[][] = [
    ['Aurum AI — relatório da conversa', geradoEm],
    [],
    ['Quem', 'Mensagem'],
    ...d.historico.slice(-20).map((m) => [m.papel === 'user' ? 'Você' : 'Aurum AI', m.texto.replace(/\s+/g, ' ').slice(0, 500)]),
    [],
    ['Pedido atual', d.pergunta],
    ['Fontes', 'Nomenclatura vigente (TEC) · Vínculos oficiais da Reforma (CST × cClassTrib) · LC 214/2025'],
    ['Aviso', 'Conteúdo informativo — confirme com o contador antes de escriturar.'],
  ]
  const conteudo = montarCSV(linhas)
  return { nome: `${nomeBase}.csv`, conteudo, mime: 'text/csv;charset=utf-8', tamanho: conteudo.length }
}

export function montarRelatorioCalculo(d: DadosCalculo, formato: FormatoRelatorio): RelatorioChat {
  const nomeBase = `aurum-ai-calculo-${new Date().toISOString().slice(0, 10)}`
  if (formato === 'pdf') {
    // PDF sai pelo motor pdfMake (ver `exportarRelatorioChatPDF` em
    // `aurum-ai-chat-pdf.ts`): aqui só o nome/mime para a UI.
    return { nome: `${nomeBase}.pdf`, conteudo: '', mime: 'application/pdf', tamanho: 0 }
  }
  if (formato === 'json') {
    const conteudo = JSON.stringify({ geradoEm: new Date().toISOString(), geradoPor: 'Aurum AI', tipo: 'calculo' as const, ...d, aviso: 'Conteúdo informativo — confirme com o contador.' }, null, 2)
    return { nome: `${nomeBase}.json`, conteudo, mime: 'application/json', tamanho: conteudo.length }
  }
  if (formato === 'txt') {
    const conteudo = [
      `Aurum AI — relatório de cálculo`,
      `NCM ${fmtNcm(d.codigo)} · base ${fmtMoeda(d.base)}`,
      `IBS ${fmtMoeda(d.ibs)} + CBS ${fmtMoeda(d.cbs)} = ${fmtMoeda(d.total)}`,
      `Aviso: conteúdo informativo — confirme com o contador.`,
    ].join('\n')
    return { nome: `${nomeBase}.txt`, conteudo, mime: 'text/plain;charset=utf-8', tamanho: conteudo.length }
  }
  const conteudo = montarCSV([
    ['Aurum AI — relatório de cálculo', new Date().toLocaleString('pt-BR')],
    ['NCM', 'Base', 'IBS', 'CBS', 'Total tributos'],
    [fmtNcm(d.codigo), d.base.toFixed(2), d.ibs.toFixed(2), d.cbs.toFixed(2), d.total.toFixed(2)],
    ['Aviso', 'Conteúdo informativo — confirme com o contador antes de escriturar.'],
  ])
  return { nome: `${nomeBase}.csv`, conteudo, mime: 'text/csv;charset=utf-8', tamanho: conteudo.length }
}

/**
 * Builders do relatório de DADOS (turno 2 — a partir do escopo congelado).
 * PDF sai pelo motor pdfMake (`exportarRelatorioDadosPDF` em
 * `aurum-ai-dados-pdf.ts`); aqui CSV/JSON/TXT em memória + nome do PDF.
 */
export function montarRelatorioDados(d: DadosConsulta, formato: FormatoRelatorio): RelatorioChat {
  const dia = new Date().toISOString().slice(0, 10)
  const nomeBase = `aurum-ai-dados-${dia}`
  if (formato === 'pdf') {
    return { nome: `${nomeBase}.pdf`, conteudo: '', mime: 'application/pdf', tamanho: 0 }
  }
  if (formato === 'json') {
    const conteudo = JSON.stringify(
      {
        geradoEm: d.geradoEm, geradoPor: 'Aurum AI', tipo: 'dados' as const,
        titulo: d.titulo, pergunta: d.pergunta, escopo: d.escopo,
        resumo: d.payload.resumo,
        fornecedores: d.payload.fornecedores,
        produtos: d.payload.produtos,
        reducoes: d.payload.reducoes,
        diferidosEfetivos: d.payload.diferidosEfetivos,
        diferidosCondicionais: d.payload.diferidosCondicionais,
        ncms: d.payload.ncms,
        blocos: d.payload.blocos,
        aviso: 'Valores estimados a partir dos XMLs importados — confirme com o contador.',
      },
      null, 2,
    )
    return { nome: `${nomeBase}.json`, conteudo, mime: 'application/json', tamanho: conteudo.length }
  }
  if (formato === 'txt') {
    const p = d.payload
    const linhas = [
      d.titulo,
      `Escopo: ${d.escopo} · ${p.qtdNotas} nota(s) · Gerado em ${d.geradoEm}`,
      ``,
      `Crédito (entradas): ${fmtMoeda(p.resumo.credito)} · Débito (saídas): ${fmtMoeda(p.resumo.debito)} · Saldo: ${fmtMoeda(p.resumo.saldo)} (${p.resumo.resultado})`,
      ...(p.fornecedores.length ? [``, `Fornecedores por crédito:`, ...p.fornecedores.slice(0, 8).map((f) => `- ${f.nome}${f.simples ? ' [Simples · sem crédito]' : ''}: ${fmtMoeda(f.creditoTotal)} (${f.qtdNotas} notas)`)] : []),
      ...(p.produtos.length ? [``, `Produtos:`, ...p.produtos.slice(0, 10).map((x) => `- ${x.nome} (${x.direcao === 'entrada' ? 'compra' : 'venda'}): ${fmtMoeda(x.trib)}`)] : []),
      ...(p.reducoes.length ? [``, `Reduções:`, ...p.reducoes.map((r) => `- ${r.rotulo}: base ${fmtMoeda(r.base)}`)] : []),
      `Aviso: valores estimados — confirme com o contador.`,
    ]
    const conteudo = linhas.join('\n')
    return { nome: `${nomeBase}.txt`, conteudo, mime: 'text/plain;charset=utf-8', tamanho: conteudo.length }
  }
  const p = d.payload
  const linhas: string[][] = [
    [d.titulo, d.escopo, d.geradoEm],
    [],
    ['Bloco', 'Linha', 'Valor (R$)'],
    ['Apuração', `Crédito (${p.resumo.entradas} entradas)`, p.resumo.credito.toFixed(2)],
    ['Apuração', `Débito (${p.resumo.saidas} saídas)`, p.resumo.debito.toFixed(2)],
    ['Apuração', `Saldo (${p.resumo.resultado})`, p.resumo.saldo.toFixed(2)],
    ...p.fornecedores.slice(0, 8).map((f): string[] => ['Fornecedor', `${f.nome}${f.simples ? ' [Simples]' : ''}`, f.creditoTotal.toFixed(2)]),
    ...p.produtos.slice(0, 10).map((x): string[] => ['Produto', `${x.nome} (${x.direcao})`, x.trib.toFixed(2)]),
    ...p.reducoes.map((r): string[] => ['Redução', r.rotulo, r.base.toFixed(2)]),
  ]
  const conteudo = montarCSV(linhas)
  return { nome: `${nomeBase}.csv`, conteudo, mime: 'text/csv;charset=utf-8', tamanho: conteudo.length }
}

/**
 * Turno 1 do relatório: entende QUAL relatório (conversa/cálculo/Simples/
 * NF-e/produtos/DADOS) pelo texto + contexto, congela os dados e pergunta o
 * formato (sem payload). O clique resolve síncrono na UI (turno 2).
 *
 * Novidade: pedido SOBRE o movimento ("relatório dos XMLs", "PDF disso",
 * "relatório dos fornecedores/produtos") consulta os dados reais via
 * `responderDados` — o PDF customizado sai no padrão do sistema.
 */
async function responderRelatorio(pergunta: string, historico: MensagemHistorico[]): Promise<RespostaChat> {
  const n = pergunta.toLowerCase()
  const ctx = contextoBaseDoTurno(historico)
  const querCalculo = /desse calculo|dessa simul|desse ibs|desse cbs|desse ncm|do calculo|desse valor/.test(n)
  const querConversa = /conversa|chat|historico|dessa conversa|desse chat/.test(n)
  const falaDeDados = /xml|nota fiscal|\bnfe\b|fornecedor|diferid|reducao|redução|filtro|disso|desses dados|desse levantamento|dessa consulta/.test(n)
  // "gera PDF disso / com ..." após consulta de dados → relatório dos DADOS.
  if ((/pdf|relatorio|relatório|csv|json/.test(n) && (falaDeDados || ctx.houveDados) && !querCalculo && !querConversa)) {
    return responderDados(pergunta, historico)
  }
  if (/produto|estoque|cadastro/.test(n) && !ctx.houveDados) {
    return {
      texto: `O relatório de produtos sai no módulo **Produtos** (CSV/JSON/PDF com seus dados reais) — aqui não tenho o cadastro para não inventar números.\n\nToque abaixo para ir até lá: Produtos → Exportar.`,
      confianca: 1, nivel: 'alta', fontes: [],
      botoes: [{ rotulo: 'Ir para Produtos', acao: 'navegar', alvo: 'produtos' }],
      pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Relatório: módulo dono (Produtos)'),
    }
  }
  if (/sped|efd/.test(n)) {
    return {
      texto: `O relatório do SPED sai no módulo de origem com seus arquivos reais. Aqui gero só conversa e cálculos.`,
      confianca: 1, nivel: 'alta', fontes: [],
      botoes: [{ rotulo: 'Ir para Lote', acao: 'navegar', alvo: 'lote' }],
      pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Relatório: módulo dono (SPED)'),
    }
  }
  if (/nfe|nfc|xml|nota fiscal/.test(n) && !falaDeDados && !ctx.houveDados) {
    return {
      texto: `O relatório de notas sai em **Notas Fiscais (XML)** (PDF/CSV com apuração real). Aqui gero conversa e cálculos.`,
      confianca: 1, nivel: 'alta', fontes: [],
      botoes: [{ rotulo: 'Ir para Notas Fiscais', acao: 'navegar', alvo: 'nfe' }],
      pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Relatório: módulo dono (NF-e)'),
    }
  }
  if (/nfe|nfc|xml|nota fiscal/.test(n)) {
    return responderDados(pergunta, historico)
  }
  if (/das|simples|anexo|dessa simula/.test(n) && !querConversa) {
    // "dessa simulação (do Simples)" + contexto numérico → relatório customizado
    // do Simples exploratório (CSV/JSON/TXT com os 5 anexos + híbrido).
    const querSimples = /dessa simula|desse comparativo|desses anexos|do simples/.test(n)
    if ((querSimples || querCalculo) && ctx.ultimoRbt12 != null && ctx.ultimaReceita != null) {
      const falasUser = historico.filter((m) => m.papel === 'user').map((m) => m.texto)
      const combinado = [...falasUser, pergunta].join('\n')
      const estado = reconstruirEstadoColeta(pergunta, falasUser)
      if (estado.rbt12 != null && estado.receita != null) {
        const cbsRef = estado.cbsRef
        const despesas = estado.despesas.length ? estado.despesas : []
        const entrada = { rbt12: estado.rbt12, receitaMes: estado.receita, folha12: estado.folha, cbsRef, despesas }
        const resultado = orquestrarTodosAnexos(entrada)
        const dadosSimples: DadosSimplesChat = {
          titulo: `Aurum AI — Simples exploratório I–V (RBT12 ${estado.rbt12}, receita ${estado.receita})`,
          pergunta: pergunta.slice(0, 300),
          geradoEm: new Date().toLocaleString('pt-BR'),
          entrada,
          resultado,
        }
        void combinado
        return {
          texto: `Preparei o relatório da simulação do Simples (5 anexos · Convencional × Híbrido · RBT12 ${fmtMoeda(estado.rbt12)} · receita ${fmtMoeda(estado.receita)}) — em qual formato quer baixar?\n\nO analítico premium (PDF Executive Editorial) sai no módulo **Simples Nacional** com os mesmos números.`,
          confianca: 1, nivel: 'alta',
          fontes: ['Tabela Simples Nacional — Anexos I–V + Reforma (CBS/IBS)'],
          relatorioOpcoes: { base: 'simples', dados: dadosSimples },
          botoes: botoesFormato(),
        }
      }
    }
    return {
      texto: `O relatório completo do Simples (analítico PDF/CSV com matriz III×V, Fator R e insights) sai no módulo **Simples Nacional** com seus números reais.\n\nAqui gero o relatório da conversa — quer que eu prepare ele, ou prefere ir ao Simples?`,
      confianca: 1, nivel: 'alta', fontes: [],
      botoes: [
        { rotulo: 'Ir para Simples Nacional', acao: 'navegar', alvo: 'simples' },
        { rotulo: 'Gerar da conversa', acao: 'perguntar', alvo: 'gera um relatório dessa conversa' },
      ],
      pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Relatório: módulo dono (Simples)'),
    }
  }
  // "desse cálculo" (ou cálculo recente no contexto) → relatório do cálculo.
  if (querCalculo || (/calc|ibs|cbs|simula/.test(n) && (ctx.ultimoCodigoNcm || ctx.houveCalculo))) {
    const cod = ultimoCodigoHistorico(historico) ?? ctx.ultimoCodigoNcm
    if (cod) {
      return {
        texto: `Preparei o cálculo ${fmtNcm(cod)}${ctx.ultimoValorBase != null ? ` sobre ${fmtMoeda(ctx.ultimoValorBase)}` : ''} — em qual formato quer baixar?`,
        confianca: 1, nivel: 'alta',
        fontes: ['Nomenclatura vigente (TEC)', 'Vínculos oficiais da Reforma (CST × cClassTrib)'],
        relatorioOpcoes: {
          base: 'conversa',
          dados: { historico, pergunta, geradoEm: new Date().toLocaleString('pt-BR') },
        },
        botoes: botoesFormato(),
      }
    }
  }
  return {
    texto: `Preparei o relatório da conversa (${historico.length} mensagens) — em qual formato quer baixar?`,
    confianca: 1,
    nivel: 'alta',
    fontes: ['Histórico da conversa', 'Nomenclatura vigente (TEC)', 'Vínculos oficiais da Reforma (CST × cClassTrib)'],
    relatorioOpcoes: {
      base: 'conversa',
      dados: { historico, pergunta, geradoEm: new Date().toLocaleString('pt-BR') },
    },
    botoes: botoesFormato(),
  }
}

/* ------------------------------------------------------ orquestrador -- */

/**
 * Responde a uma mensagem do chat. Nunca rejeita: falha interna vira
 * resposta honesta (sem alucinação). Guardrail: só tools read-only.
 */
export async function responderChat(pergunta: string, historico: MensagemHistorico[] = []): Promise<RespostaChat> {
  const texto = String(pergunta ?? '').trim()
  if (!texto) {
    return { texto: `Sou a Aurum AI. Digite sua dúvida fiscal — ex.: "tem algum ncm de banana?"`, confianca: 1, nivel: 'alta', fontes: [], botoes: botoesCapacidades().slice(0, 4) }
  }
  if (texto.startsWith('__COMPARAR_ANEXOS__')) return responderComparativoMatriz(texto, historico)
  if (texto.startsWith('__COMPARAR_HIBRIDO__')) return responderComparativoHibrido(texto, historico)
  // Fine-tuning v6: botão "Refazer cálculo com folha sugerida" — rota direta
  // ao Simples (o payload já traz RBT12/RECEITA/FOLHA; ver `responderSimples`).
  if (texto.startsWith('__RECALCULAR_FATOR_R__')) return responderSimples(texto, historico)
  // Detector primeiro (puro, sem I/O) + refino com contexto memoizado (puro):
  // rotina vai pelo fluxo simples (recursos nativos, 1 leitura de perfil),
  // o resto pelo caminho completo.
  const detectada = detectarIntencaoChat(texto)
  const refinadaGate = anexarPedidoGrafico(refinarIntencaoComContexto(detectada, texto, historico, null), texto)
  if (!precisaCaminhoCompleto(texto, detectada.intencao, refinadaGate.intencao, historico)) {
    return responderFluxoSimples(texto, refinadaGate, historico)
  }
  return responderChatFull(texto, historico, detectada)
}

/**
 * Fluxo simples (fine-tuning v5): rotina com recursos nativos — nenhuma
 * consulta a RAG/Dexie de dados, nenhum contexto pesado, nenhuma escrita de
 * negócio. Custa 1 leitura de perfil (para o vocativo e os padrões) + 1
 * escrita em lote do aprendizado de turno. Nome declarado e pergunta sobre
 * a memória passam aqui (perfil puro).
 */
/**
 * IA-07 (agente): o modelo responde diretamente, herdando tudo do motor.
 *
 * Controle via RAG (sem vazamento):
 * - Papo leve: o modelo recebe SÓ a pergunta + 2 últimas falas do usuário (sem
 *   exemplos fiscais do boas-vindas/templates). Fato vazio = nenhum número.
 * - Fiscal: o modelo escreve SÓ 1 linha de abertura (sem números); os
 *   números/códigos vêm 100% do template do motor, verbatim, concatenados em
 *   código (nunca pelo modelo). Nenhum `base.texto` vai ao prompt — foi esse
 *   envio que fez o 0.6B ecoar "--- Fatos do motor para verbalizar".
 */
const INTENCOES_LEVES_AGENTE = new Set(['saudacao', 'conversa_leve', 'generico', 'capacidades', 'ajuda', 'fora-escopo'])

function historicoSeguroLeve(historico: MensagemHistorico[] = []): MensagemHistorico[] {
  return historico
    .filter((m) => m.papel === 'user')
    .slice(-2)
    .map((m) => ({ papel: m.papel, texto: String(m.texto).slice(0, 200) }))
}

async function responderViaModelo(
  base: RespostaChat,
  pergunta: string,
  historico: MensagemHistorico[] = [],
  perfil?: PerfilMemoria | null,
  intencao = 'generico',
): Promise<RespostaChat> {
  try {
    const nome = perfil ? primeiroNome(perfil) : null
    // --- Papo leve: resposta integral do modelo, sem números ---
    if (INTENCOES_LEVES_AGENTE.has(intencao)) {
      const livre = await conversarLivre({
        pergunta: String(pergunta).slice(0, 300),
        historico: historicoSeguroLeve(historico),
        sistema:
          `Você é a Aurinha, a Aurum AI. Responda em português, curto (1-3 linhas), simpático.${nome ? ` Usuário: ${nome}.` : ''}\n` +
          `Não cite códigos, valores ou artigos. Se pedirem fiscal, peça 1 detalhe.`,
        think: false,
        fatos: { codigos: [], valores: [] },
      })
      if (!livre) return { ...base, viaModelo: false }
      return {
        ...base,
        texto: livre.texto,
        viaModelo: true,
        pensamento: pensar(
          [...(base.pensamento?.etapas ?? [PENSAR.entender]), `Aurum AI responde (${livre.motivo})`],
          base.pensamento?.detalhe,
        ),
      }
    }
    // --- Fiscal: abertura do modelo + corpo 100% motor (RAG manda) ---
    const abertura = await conversarLivre({
      pergunta: `Escreva UMA linha simpática abrindo a resposta sobre "${intencao}" para: "${String(pergunta).slice(0, 200)}". Sem números, códigos ou valores.`,
      historico: [],
      sistema:
        `Você é a Aurinha, a Aurum AI. Escreva só 1 frase de abertura em português.${nome ? ` Usuário: ${nome}.` : ''}\n` +
        `Proibido: números, códigos NCM/NBS, valores R$, artigos de lei.`,
      think: false,
      fatos: { codigos: [], valores: [] },
    })
    if (!abertura) return { ...base, viaModelo: false }
    const { sanitizarAbertura } = await import('./aurum-ai-livre')
    const intro = sanitizarAbertura(abertura.texto)
    if (!intro) return { ...base, viaModelo: false }
    return {
      ...base,
      texto: `${intro}\n\n${base.texto}`,
      viaModelo: true,
      pensamento: pensar(
        [...(base.pensamento?.etapas ?? [PENSAR.entender]), `Aurum AI responde (${abertura.motivo})`],
        base.pensamento?.detalhe,
      ),
    }
  } catch {
    return { ...base, viaModelo: false }
  }
}

/** Mantido como alias: polimento e papo simples agora passam pelo agente único. */
async function polirComLivre(
  base: RespostaChat,
  pergunta: string,
  historico: MensagemHistorico[] = [],
  perfil?: PerfilMemoria | null,
  modo = 'leve',
  think = false,
): Promise<RespostaChat> {
  void modo
  void think
  return responderViaModelo(base, pergunta, historico, perfil, 'conversa_leve')
}

/** Mantido como alias: sem concatenação base+livre (causa da duplicação). */
async function responderLivreOuBase(
  base: RespostaChat,
  pergunta: string,
  historico: MensagemHistorico[] = [],
  perfil?: PerfilMemoria | null,
  modo = 'leve',
): Promise<RespostaChat> {
  return responderViaModelo(base, pergunta, historico, perfil, modo === 'leve' ? 'conversa_leve' : modo)
}
async function responderFluxoSimples(
  texto: string,
  detectada: AnaliseChat,
  historico: MensagemHistorico[] = [],
): Promise<RespostaChat> {
  let perfil: PerfilMemoria | null = null
  try {
    perfil = await carregarPerfilMemoria()
  } catch {
    perfil = null
  }
  // Nome declarado ("meu nome é ...") — única escrita do fluxo simples,
  // porque o próprio usuário pediu explicitamente.
  try {
    const nomeResp = await tentarDeclaracaoNome(texto, historico)
    if (nomeResp) {
      void registrarTurnoMemoria('saudacao').catch(() => null)
      return nomeResp
    }
    if (ehPerguntaMemoria(texto)) {
      const resp: RespostaChat = responderPerguntaMemoria(perfil ?? { nome: null, comoChamar: null, interacoes: 0, atualizadoEm: null, padroes: null })
      void registrarTurnoMemoria('saudacao').catch(() => null)
      return resp
    }
  } catch {
    /* segue o fluxo */
  }
  let resp: RespostaChat
  switch (detectada.intencao) {
    case 'capacidades': resp = await responderViaModelo(responderCapacidades(texto), texto, historico, perfil, 'capacidades'); break
    case 'ajuda': resp = await responderViaModelo(responderAjuda(texto), texto, historico, perfil, 'ajuda'); break
    case 'navegar': resp = responderNavegar(detectada); break
    case 'status': resp = responderStatus(); break
    case 'tempo': resp = await responderViaModelo(responderTempo(texto, perfil), texto, historico, perfil, 'tempo'); break
    case 'conta': resp = await responderViaModelo(responderContaBasica(texto, historico, perfil), texto, historico, perfil, 'conta'); break
    case 'conversa_leve': resp = await responderLivreOuBase(responderConversaLeve(texto, perfil), texto, historico, perfil, 'leve'); break
    case 'conceito': resp = await responderViaModelo(responderConceito(texto, perfil), texto, historico, perfil, 'conceito'); break
    case 'legislacao': resp = await responderViaModelo(responderLegislacao(texto), texto, historico, perfil, 'legislacao'); break
    default:
      if (ehConversaLeve(texto)) resp = await responderLivreOuBase(responderConversaLeve(texto, perfil), texto, historico, perfil, 'leve')
      else if (detectarForaDeEscopo(texto)) {
        const baseFora: RespostaChat = { texto: MENSAGEM_FORA_DE_ESCOPO_CHAT, confianca: 1, nivel: 'alta', fontes: [], pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Barreira de escopo: fora do sistema') }
        resp = await polirComLivre(baseFora, texto, historico, perfil, 'fora-escopo')
      } else resp = await responderLivreOuBase(responderGenerico(texto, perfil), texto, historico, perfil, 'generico')
  }
  // Aprende o padrão do turno em lote (1 escrita, fire-and-forget).
  void registrarTurnoMemoria(detectada.intencao).catch(() => null)
  return resp
}

/**
 * Declaração de nome ("meu nome é David" ou resposta curta após a pergunta).
 * Extração do bloco original do orquestrador para reuso nos dois caminhos.
 */
async function tentarDeclaracaoNome(texto: string, historico: MensagemHistorico[] = []): Promise<RespostaChat | null> {
  try {
    let nomeNovo = extrairNomeDeTexto(texto)
    if (!nomeNovo) {
      const ultimoAssistant = [...historico].reverse().find((m) => m.papel === 'assistant')?.texto ?? ''
      if (/qual (o )?seu nome|como posso te chamar|me diga seu nome|como devo te chamar/i.test(ultimoAssistant)) {
        const cand = texto.trim().replace(/[.!,?;:\s]+$/, '')
        if (
          cand.length >= 2 && cand.length <= 40 &&
          /^[A-Za-zÀ-ú][A-Za-zÀ-ú'´`-]*(\s+[A-Za-zÀ-ú][A-Za-zÀ-ú'´`-]*)*$/.test(cand) &&
          !temSinalFiscal(cand) &&
          cand.trim().split(/\s+/).length <= 3
        ) {
          nomeNovo = cand.trim().split(/\s+/).map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ')
        }
      }
    }
    if (nomeNovo) {
      await declararNomeMemoria(`meu nome é ${nomeNovo}`).catch(() => null)
      return responderNomeDeclarado(nomeNovo)
    }
  } catch {
    /* segue o fluxo */
  }
  return null
}

async function responderChatFull(texto: string, historico: MensagemHistorico[] = [], detectadaPrevia?: AnaliseChat): Promise<RespostaChat> {
  // Memória persistente (perfil por emitente, best-effort — nunca trava o chat).
  let perfil: PerfilMemoria | null = null
  let memoria: MemoriaSistema | null = null
  try {
    perfil = await carregarPerfilMemoria()
  } catch {
    perfil = null
  }
  // Artefato-resumo cifrado: só a IA descriptografa, e só aqui. Em chat novo
  // (sem histórico) ele devolve o último assunto/códigos da sessão anterior.
  try {
    memoria = await carregarMemoriaSistema()
  } catch {
    memoria = null
  }
  // 1) Declaração de nome ("meu nome é David") — aprende na hora, com cordialidade.
  // Também aceita resposta curta ("David") quando a IA acabou de perguntar o nome.
  try {
    const nomeResp = await tentarDeclaracaoNome(texto, historico)
    if (nomeResp) return nomeResp
  } catch {
    /* segue o fluxo */
  }
  // 2) Pergunta sobre a memória ("qual meu nome?", "o que sabe sobre mim?").
  try {
    if (ehPerguntaMemoria(texto)) {
      return responderPerguntaMemoria(perfil ?? { nome: null, comoChamar: null, interacoes: 0, atualizadoEm: null, padroes: null })
    }
  } catch {
    /* segue o fluxo */
  }
  // 3) Sinal de aprendizado ("não é esse" / "isso mesmo") — reforço simples
  // com o contexto (último assunto + último código). Fire-and-forget.
  // Mensagem curta e puramente sinal ("não é esse", "isso mesmo") responde
  // cordial sem repetir o RAG: correção pede 1–2 detalhes, confirmação
  // celebra e reforça. Com conteúdo junto ("não é esse, é o grego"), segue
  // o fluxo normal (o detalhe entra na classificação).
  try {
    const sinal = extrairSinalAprendizado(texto)
    if (sinal) {
      const ctxApr = mesclarContextoComArtefato(contextoBaseDoTurno(historico), memoria)
      const termoApr = ctxApr.ultimoAssunto
      const codNcm = ctxApr.ultimoCodigoNcm
      const codNbs = ctxApr.ultimoCodigoNbs
      const codApr = codNcm ?? codNbs
      if (termoApr && codApr) {
        void registrarAprendizadoTermo(termoApr, codApr, codNcm ? 'ncm' : 'nbs', sinal).catch(() => null)
      }
      const curto = texto.trim().split(/\s+/).length <= 8
      const nomeVoc = perfil && primeiroNome(perfil) ? `, ${primeiroNome(perfil)}` : ''
      if (curto && termoApr && codApr) {
        if (sinal === 'confirmacao') {
          return {
            texto:
              `Que bom que acertei${nomeVoc}! Guardei essa confirmação — na próxima vez que perguntarem "${termoApr}", chego mais rápido e mais certeira.\n\n` +
              `Se quiser, detalho a tributação, simulo um valor ou gero o relatório.`,
            confianca: 1,
            nivel: 'alta',
            fontes: ['Memória local da Aurum AI (aprendizado confirmado)'],
            sugestoes: [`Quanto fica R$ 1.000 no NCM ${fmtNcm(codApr)}?`, 'Gera um relatório dessa conversa'],
            botoes: [
              { rotulo: `Quanto fica R$ 1.000?`, acao: 'perguntar', alvo: `Quanto fica R$ 1.000 no NCM ${fmtNcm(codApr)}?` },
              { rotulo: 'Classificar oficialmente', acao: 'navegar', alvo: 'consulta' },
            ],
            pensamento: pensar([PENSAR.entender, PENSAR.validar], `Aprendizado: confirmação de "${termoApr}" → reforço`),
          }
        }
        return {
          texto:
            `Entendido${nomeVoc} — anotei que ${fmtNcm(codApr)} não era o que você esperava para "${termoApr}", e não vou repetir esse caminho.\n\n` +
            `Me dá 1–2 detalhes (material/composição, uso, estado — ex.: "${termoApr} 100% algodão para revenda") que eu reclassifico na hora pela base oficial.`,
          confianca: 0.9,
          nivel: 'alta',
          fontes: ['Memória local da Aurum AI (correção registrada)'],
          sugestoes: ['O que você pode fazer?', `Tem algum NCM de ${termoApr}?`],
          botoes: [{ rotulo: 'Classificar oficialmente', acao: 'navegar', alvo: 'consulta' }],
          pensamento: pensar([PENSAR.entender, PENSAR.validar], `Aprendizado: correção de "${termoApr}" → demote + pedir detalhes`),
        }
      }
    }
  } catch {
    /* aprendizado nunca trava */
  }
  try {
    const detectada = detectadaPrevia ?? detectarIntencaoChat(texto)
    // Follow-ups ("e para 5 mil?", "e com folha maior?") herdam o contexto —
    // do histórico ou, em chat novo, do artefato-resumo cifrado.
    // Na sequência, o modificador visual preenche `querGrafico/tipoGrafico`
    // (fluxo agêntico de gráficos — não muda a intenção fiscal).
    const analise = anexarPedidoGrafico(refinarIntencaoComContexto(detectada, texto, historico, memoria), texto)
    // Aprendizado de turno em lote (1 escrita: interações + padrão de
    // conversa) — fire-and-forget, antes das respostas pesadas.
    void registrarTurnoMemoria(analise.intencao).catch(() => null)
    if (INTENCOES_ORIENTACAO.has(analise.intencao)) {
      switch (analise.intencao) {
        case 'capacidades': return responderViaModelo(responderCapacidades(texto), texto, historico, perfil, 'capacidades')
        case 'ajuda': return responderViaModelo(responderAjuda(texto), texto, historico, perfil, 'ajuda')
        case 'navegar': return responderNavegar(analise)
        case 'status': return responderStatus()
        case 'tempo': return responderViaModelo(responderTempo(texto, perfil), texto, historico, perfil, 'tempo')
        case 'conta': return responderViaModelo(responderContaBasica(texto, historico, perfil), texto, historico, perfil, 'conta')
        case 'saudacao': return polirComLivre(saudacao(historico, perfil, memoria, texto), texto, historico, perfil, 'leve')
        case 'conversa_leve': return responderLivreOuBase(responderConversaLeve(texto, perfil), texto, historico, perfil, 'leve')
        case 'conceito': return responderViaModelo(responderConceito(texto, perfil), texto, historico, perfil, 'conceito')
        case 'comparativo': return responderViaModelo(responderComparativo(texto, historico), texto, historico, perfil, 'comparativo')
        case 'legislacao': return responderViaModelo(responderLegislacao(texto), texto, historico, perfil, 'legislacao')
      }
    }
    // Conversa leve curta também bypassa a barreira (ex.: "bom dia!" com "bom").
    if (ehConversaLeve(texto)) return responderLivreOuBase(responderConversaLeve(texto, perfil), texto, historico, perfil, 'leve')
    if (detectarForaDeEscopo(texto)) {
      const baseFora: RespostaChat = { texto: MENSAGEM_FORA_DE_ESCOPO_CHAT, confianca: 1, nivel: 'alta', fontes: [], pensamento: pensar([PENSAR.entender, PENSAR.validar], 'Barreira de escopo: fora do sistema') }
      return polirComLivre(baseFora, texto, historico, perfil, 'fora-escopo')
    }
    switch (analise.intencao) {
      case 'tempo':
        return responderViaModelo(responderTempo(texto, perfil), texto, historico, perfil, 'tempo')
      case 'conta':
        return responderViaModelo(responderContaBasica(texto, historico, perfil), texto, historico, perfil, 'conta')
      case 'relatorio':
        return responderViaModelo(await responderRelatorio(texto, historico), texto, historico, perfil, 'relatorio')
      case 'clientes':
        return responderViaModelo(await responderClientes(texto), texto, historico, perfil, 'clientes')
      case 'dados':
        return responderViaModelo(await responderDados(texto, historico), texto, historico, perfil, 'dados')
      case 'simples':
        return responderViaModelo(await responderSimples(texto, historico), texto, historico, perfil, 'simples')
      case 'calculo':
        return responderViaModelo(await responderCalculo(texto, analise, historico, memoria), texto, historico, perfil, 'calculo')
      case 'cnpj':
        return responderViaModelo(await responderCnpj(texto, analise, historico), texto, historico, perfil, 'cnpj')
      case 'cnae':
        return responderViaModelo(await responderCnae(texto, analise, historico), texto, historico, perfil, 'cnae')
      case 'cadastrar_produto':
        return responderCadastroProduto(texto, analise, historico)
      case 'nbs':
        return responderViaModelo(await responderNbs(texto, analise, historico, memoria), texto, historico, perfil, 'nbs')
      case 'ncm':
        return responderViaModelo(await responderNcm(texto, analise, historico, memoria), texto, historico, perfil, 'ncm')
      case 'generico':
      default:
        return responderLivreOuBase(responderGenerico(texto, perfil), texto, historico, perfil, 'generico')
    }
  } catch (e) {
    return {
      texto: `Tive uma falha momentânea ao consultar a base (${e instanceof Error ? e.message : 'erro interno'}). Reformule com 1–2 detalhes do produto ou use a Consulta NCM.`,
      confianca: 0,
      nivel: 'baixa',
      fontes: [],
      pensamento: pensar([PENSAR.entender], 'Falha interna — resposta honesta'),
    }
  }
}
