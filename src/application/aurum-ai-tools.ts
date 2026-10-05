/**
 * Aurum AI — plano de tool calling (fine-tuning v2).
 *
 * Single-source de COMO a IA usa os recursos do sistema: cada intenção do
 * detector vira UMA tool read-only, com quando-usar, inputs, contexto e
 * guardrails. O orquestrador (`aurum-ai-chat.ts`) só chama o que está aqui —
 * nada escreve no sistema.
 *
 * Princípios:
 * - P1 — Determinismo: todo número vem do motor (calculo.ts / simples/calculo.ts).
 *   A IA formata, nunca recalcula.
 * - P2 — Contexto: cálculo e relatório herdam a conversa (último NCM, valores,
 *   anexo, RBT12...). "e para 2 mil?" continua o cálculo anterior.
 * - P3 — Escrita proibida: salvar/editar/importar é ato humano via botão navegar.
 */

import type { AnaliseChat } from '@/domain/services/detector-chat';
import { extrairNucleoBusca, ehPedidoProjecaoDividida } from '@/domain/services/detector-chat';
import { ehProvavelDados } from '@/domain/services/acoes-dados';
import { temSinalFiscal } from '@/domain/services/escopo-consulta';
import { extrairSlotsSimples, extrairTodosValores, historicoSlotsSimples, detectarPerguntaAliquota } from '@/domain/services/valores-chat';
import {
  ehConfirmacao,
  ehNegacao,
  fluxoCadastroEmAndamento,
  ofertaAtualizarSkuPendente,
  ofertaCadastroCnpjPendente,
  resumoProdutoPendente,
} from './aurum-ai-cadastro';
import type { MemoriaSistema } from './aurum-ai-artefatos';
import { detectarPedidoGrafico, ehPedidoVisualPuro } from './aurum-ai-graficos';
import { extrairDespesasDoTexto } from './aurum-ai-simples-exploratorio';
import { detectarContaFollowUp } from '@/domain/services/basico-chat';

export type ToolName =
  | 'consultarNCM'
  | 'consultarNBS'
  | 'consultarCNAE'
  | 'consultarCnaeNbs'
  | 'consultarCNPJ'
  | 'verificarCadastroCnpj'
  | 'cadastrarProdutoAssistido'
  | 'consultarClientes'
  | 'consultarDadosXml'
  | 'explicarArtigoLC214'
  | 'gerarRelatorioDados'
  | 'gerarGrafico'
  | 'salvarEmpresa'
  | 'detalharCodigo'
  | 'calcularIBSCBS'
  | 'calcularContaBasica'
  | 'responderTempo'
  | 'calcularSimples'
  | 'simularComparativo'
  | 'simularCenarioDividido'
  | 'explicarConceito'
  | 'gerarRelatorio'
  | 'navegarPara'
  | 'responderLeve'
  | 'recusarForaDeEscopo';

export interface ToolSpec {
  tool: ToolName;
  quandoUsar: string;
  inputs: string[];
  exemplo: string[];
  guardrail: string;
  escreveNoSistema: false;
}

export const PLANO_TOOL_CALLING: ToolSpec[] = [
  {
    tool: 'consultarNCM',
    quandoUsar: 'intenção ncm: produto descrito ou NCM de 8 dígitos, sem valor monetário. MENÇÃO EXPLÍCITA a "NCM" (ou 8 dígitos) vence a heurística do Simples.',
    inputs: ['termoBusca (texto limpo)'],
    exemplo: ['"tem algum ncm de banana?" → consultarNCM("banana")'],
    guardrail: 'RAG + resolvedor oficial; sem lastro → NÃO SEI instrutivo, nunca chute.',
    escreveNoSistema: false,
  },
  {
    tool: 'consultarNBS',
    quandoUsar: 'intenção nbs: serviço descrito ou NBS de 9 dígitos. MENÇÃO EXPLÍCITA a "NBS" (ou 9 dígitos) vence a heurística do Simples — ex.: "quais seriam os NBS para consultoria?" é SEMPRE nbs, nunca simples, mesmo contendo "consultoria/advocacia/software" (sinais do Simples). TI genérico (programação/dev/SaaS) responde com desambiguação + CNAEs 6201–6209 + LC 116 item 1.',
    inputs: ['termoBusca', 'composicao? (não se aplica a serviços; usa tomador/local quando houver)'],
    exemplo: ['"nbs para aula de yoga?" → consultarNBS("aula de yoga")', '"NBS para programação de computadores?" → desambiguar TI + regra geral + CNAE/Fator R'],
    guardrail: 'Base NBS × CST × cClassTrib; sem lastro → explicação honesta do determinístico (regra geral/setor) + funil serviço (tipo/tomador/local), nunca funil de produto nem chute. Programação genérica = regra geral (tributação integral), nunca NBS inventado.',
    escreveNoSistema: false,
  },
  {
    tool: 'consultarCNAE',
    quandoUsar: 'intenção cnae: CNAE de 7 dígitos (`XXXX-X/XX`) para saber o Anexo do Simples. Dado exato da tabela viva — 100% match não mostra confiança.',
    inputs: ['cnae (7 dígitos normalizados)'],
    exemplo: ['"qual anexo do CNAE 6201-5/01?" → consultarCNAE("6201501") + Anexo Simples III/V + Fator R'],
    guardrail: 'Lookup direto na tabela viva CNAE × Anexo Simples; inexistente → funil ("do que se trata?") sem chutar anexo. Sem confiança quando exato.',
    escreveNoSistema: false,
  },
  {
    tool: 'consultarCnaeNbs',
    quandoUsar: 'intenção cnae COM pergunta sobre NBS/benefício/Reforma ("CNAE 0161-0/01 quais NBS e benefícios?", "meu cnae tem benefício?"): regra do Simples (sempre, 1.090) + NBS vinculadas com benefício/tributação especial no ano de referência.',
    inputs: ['cnae (7 dígitos normalizados)', 'anoReferencia? (2026 | 2027 | 2033; padrão 2033)'],
    exemplo: ['"CNAE 0161-0/01 quais NBS e benefícios?" → consultarCnaeNbs("0161001", 2033) + Anexo Simples III + 1 NBS + veredito com ano'],
    guardrail: 'Regra (anexo/situação/Fator R/vedação) SEMPRE dos 1.090; NBS/benefício SÓ com link CNAE→NBS + resolvedor oficial + ano explícito; bens→NCM (sem NBS aplicável); sem lastro → `sem-mapeamento` honesto, NUNCA inventar NBS/benefício.',
    escreveNoSistema: false,
  },
  {
    tool: 'consultarCNPJ',
    quandoUsar: 'intenção cnpj: mensagem cita CNPJ com ou sem formatação ("Quais atividades o CNPJ 53.795.990/0001-68 tem?").',
    inputs: ['cnpj (14 dígitos normalizados, com ou sem máscara)'],
    exemplo: ['"Quais atividades o CNPJ 53795990000168 tem?" → consultarCNPJ("53795990000168") + upsell Simples/Híbrido + oferta de salvar'],
    guardrail: 'BrasilAPI (única rede do chat) + cache 30d; DV inválido → pede correção, nunca consulta. Lista CNAEs + NBS + Anexo Simples + Fator R e sugere próximo passo.',
    escreveNoSistema: false,
  },
  {
    tool: 'verificarCadastroCnpj',
    quandoUsar: 'pergunta sobre cadastro ("o cnpj X tá cadastrado?"): verifica no banco local; se não está, OFERECE o cadastro e só executa após confirmação explícita (ou comando direto "cadastra esse cnpj").',
    inputs: ['cnpj (14 dígitos)'],
    exemplo: ['"o cnpj 11222333000181 tá cadastrado?" → verificarCadastroCnpj + oferta', '"sim, cadastra" (após oferta) → salvarEmpresa idempotente'],
    guardrail: 'Sem oferta anterior, "sim" sozinho nunca grava. Registro via BrasilAPI + idempotência por CNPJ.',
    escreveNoSistema: false,
  },
  {
    tool: 'cadastrarProdutoAssistido',
    quandoUsar: 'intenção cadastrar_produto: coleta empresa/SKU/nome/NCM (+ CFOP/CST-ICMS/PIS/COFINS opcional digitado) em turnos, mostra conferência e GRAVA só após "SIM PARA SALVAR". SKU existente abre 2º portão ("SIM ATUALIZAR").',
    inputs: ['rascunho reconstruído do histórico (slots) + confirmação vinculada ao resumo'],
    exemplo: ['"quero cadastrar um produto" → pede empresa → SKU → nome → NCM → trib. antiga → conferência → salva'],
    guardrail: 'Sem resumo anterior com o mesmo SKU, confirmação não grava. NCM sem lastro não grava. Empresa inexistente não grava (orienta cadastrar a empresa).',
    escreveNoSistema: false,
  },
  {
    tool: 'consultarClientes',
    quandoUsar: 'intenção clientes: inventário do CADASTRO ("quais meus clientes?", "quantos clientes tenho?"). Lê Dexie empresas + movimento (qtd notas, base).',
    inputs: ['sem inputs (lista tudo) ou nome/CNPJ quando citado'],
    exemplo: ['"quais meus clientes?" → consultarClientes() + qtd notas por cliente', '"tem XML do cliente Padaria?" → delega a consultarDadosXml com filtro de cliente'],
    guardrail: 'READ-ONLY Dexie; sem cadastro → orienta cadastrar via CNPJ + botão Empresas; nunca inventa cliente.',
    escreveNoSistema: false,
  },
  {
    tool: 'consultarDadosXml',
    quandoUsar: 'intenção dados: pergunta sobre o MOVIMENTO importado (fornecedor que dá crédito, produto de débito/crédito, diferidos, reduções, NCM/CFOP/CST nas notas, período, filtros). Entende cliente ↔ XML nos dois sentidos.',
    inputs: ['filtros extraídos (cliente, fornecedor, produto, NCM, CFOP, CST, cClassTrib, redução, anexo, direção compra/venda, período, diferido, top N)'],
    exemplo: ['"qual fornecedor me dá mais crédito?" → ranking entradas', '"existe produto diferido?" → diferidos efetivos + condicionais Anexo IX', '"quais reduções?" → faixas IBS/CBS encontradas'],
    guardrail: 'Todo número vem das agregações sobre NotaXml (motor); vazio → orientação honesta (importar XML) + lista filtros suportados; nunca projeta nem mistura conversa com dado.',
    escreveNoSistema: false,
  },
  {
    tool: 'explicarArtigoLC214',
    quandoUsar: 'intenção legislacao: explicar/pesquisar a LC 214 ("explica o art. 128", "o que diz a lei sobre cesta básica?"). Lê o corpus offline embarcado (lc214.ts, 100% sem rede) no molde claro + técnico + link da íntegra no Planalto.',
    inputs: ['numero do artigo (quando citado) ou tema livre (quando pesquisa temática)'],
    exemplo: ['"explica o art. 128" → explicarArtigoLC214("128")', '"onde a lei fala de diferimento?" → pesquisarLC214("diferimento") + explicar o top-1'],
    guardrail: 'Só o corpus curado; fora da cobertura → lista temas + íntegra, nunca recita texto legal inventado nem afirma redação literal.',
    escreveNoSistema: false,
  },
  {
    tool: 'gerarRelatorioDados',
    quandoUsar: 'pedido de relatório SOBRE os dados ("gera PDF disso", "relatório desses fornecedores"). A IA propõe a estrutura (blocos) e programa o PDF no padrão do sistema.',
    inputs: ['escopo já consultado (notas filtradas + agregações) + blocos escolhidos (fornecedores/produtos/reduções/diferidos/ncm/apuração)'],
    exemplo: ['"gera um PDF disso" → congela escopo + pergunta/confirma blocos + botões PDF/CSV/JSON'],
    guardrail: 'Layout = timbrado + KPIs + blocos com dado (sem seção vazia); turno 1 propõe estrutura, turno 2 baixa. Números = subconjunto do escopo.',
    escreveNoSistema: false,
  },
  {
    tool: 'gerarGrafico',
    quandoUsar: 'PREDITIVO sobre dados/simples/calculo/clientes: todo número do motor já gera o artefato automaticamente (principal + alternativas + insight), sem esperar pedido. "mostra em gráfico pizza/barras/linha/tabela" só escolhe o modelo inicial; sem pedido, o roteador escolhe pelo recorte. Sem dado numérico, sugere em vez de anexar.',
    inputs: ['mesmo escopo da tool base (notas filtradas / conv+hibrido / codigo+base) + tipo preferido (barra|pizza|linha|tabela)'],
    exemplo: ['"qual fornecedor me dá mais crédito?" → consultarDadosXml + gerarGrafico(barra auto)', '"mostra em gráfico pizza os fornecedores" → consultarDadosXml + gerarGrafico(pizza)', '"mostra a repartição em tabela" → calcularSimples + gerarGrafico(tabela)'],
    guardrail: 'Todo número vem do motor (P1); sem sinal (tudo zerado) força tabela com aviso em vez de canvas vazio; pizza multi-série usa a 1ª e avisa; linha exige ≥2 pontos; vazio → orientação, nunca gráfico inventado.',
    escreveNoSistema: false,
  },
  {
    tool: 'salvarEmpresa',
    quandoUsar: 'pedido explícito de salvar/cadastrar a empresa do CNPJ como cliente/emissor ("salvar essa empresa", "salvar como cliente do emissor"). Só após consultarCNPJ bem-sucedido e confirmação do usuário.',
    inputs: ['cnpj (14 dígitos já consultado nesta conversa)'],
    exemplo: ['"salvar essa empresa como cliente" → salvarEmpresa("53795990000168") via cadastrarEmpresaPorCnpj (idempotente)'],
    guardrail: 'Ato assistido: idempotente por CNPJ, nunca duplica; falha de rede vira orientação para Empresas. Demais escritas continuam proibidas.',
    escreveNoSistema: false,
  },
  {
    tool: 'detalharCodigo',
    quandoUsar: 'código direto (8/9 dígitos) já validado no resolvedor.',
    inputs: ['codigoDigitos'],
    exemplo: ['"08031000" → detalharCodigo + simulação R$ 1.000 de referência'],
    guardrail: 'Só código homologado na TEC; extinto → aviso, sem cálculo cheio.',
    escreveNoSistema: false,
  },
  {
    tool: 'calcularIBSCBS',
    quandoUsar: 'intenção calculo: código + base. Herda contexto (último NCM/valor).',
    inputs: ['codigo (atual ou do histórico)', 'valorBase (atual ou do histórico; sem valor → simula R$ 1.000 como referência e avisa)'],
    exemplo: ['"quanto fica R$ 2.500 no NCM 08031000?"', '"e para 5 mil?" (herda o NCM)'],
    guardrail: 'Motor calcularTributos; sem código → pergunta/ancora no RAG, nunca chuta NCM.',
    escreveNoSistema: false,
  },
  {
    tool: 'calcularContaBasica',
    quandoUsar: 'intenção conta: matemática básica PT-BR sem NCM (soma, subtração, multiplicação, divisão, porcentagem, resto). Herda o último resultado ("e mais 5?").',
    inputs: ['expressão atual (2 operandos) ou follow-up curto + último resultado do histórico'],
    exemplo: ['"quanto é 2+3?" → 5', '"10% de 500" → 50', '"resto de 10 por 3" → 1', '"e mais 5?" (após conta) → anterior + 5'],
    guardrail: 'Parser determinístico (basico-chat.ts); divisão/resto por zero → aviso honesto, sem número. Com NCM/CNPJ na frase, o fluxo fiscal decide.',
    escreveNoSistema: false,
  },
  {
    tool: 'responderTempo',
    quandoUsar: 'intenção tempo: "que horas são?", "que dia/mês/ano é hoje?". Responde com o relógio local (sem rede).',
    inputs: ['tipo (hora | data | ambos) detectado na frase'],
    exemplo: ['"que horas são?" → "Agora são 14:32"', '"que dia é hoje?" → "Hoje é 04/10/2026 (sábado)"'],
    guardrail: 'Só relógio/calendário local; nunca inventa compromisso nem fuso. "bom dia" puro continua saudação.',
    escreveNoSistema: false,
  },
  {
    tool: 'calcularSimples',
    quandoUsar: 'intenção simples: anexo + RBT12 + receita (+folha opcional). Herda SÓ do domínio Simples. Follow-up de edição ("troca/muda/corrige/bota/aumenta/refaz", "e com 200 mil?", "30% do RBT", "paus/conto/pila/k/mi") altera só o slot citado e refaz o DAS. Troca de anexo ("troca para o V com os mesmos valores", "e no III?") mantém RBT/receita e só carrega a folha se o destino exige (III/V); para I/II/IV a folha é arquivada e some do eco. Referências ("primeiro/anterior/volta/o outro/aquele") resolvem contra a pilha em ordem cronológica; "o outro anexo" sem 2 candidatos PERGUNTA em vez de chutar. Fator R <28% explica que NÃO é Anexo III (vai para V) + sugere folha mínima 28%×RBT12 + botão __RECALCULAR_FATOR_R__.',
    inputs: ['anexo', 'rbt12', 'receitaMes', 'folha12?'],
    exemplo: ['"DAS Anexo III, RBT12 500 mil, receita 40 mil"', '"e com folha 200 mil?" (herda anexo/RBT)', '"troca para o Anexo V com os mesmos valores" (só anexo muda)', '"volta para o RBT anterior" (penúltimo da pilha)', '"usa o primeiro RBT" (turnos[0])'],
    guardrail: 'Motor calcularConvencional + fatorR; faltou anexo/RBT/receita → PERGUNTA os valores, nunca projeta exemplo nem mistura contexto do IBS. Comparativo ("qual melhor III ou V?") nunca é edição.',
    escreveNoSistema: false,
  },
  {
    tool: 'simularComparativo',
    quandoUsar: 'intenção comparativo COM números + menção a híbrido ("comparar com híbrido", "no híbrido", "usar referência", "aluguel 2000" em thread híbrida): calcula e entrega as 2 guias — DAS sem CBS + DARF da CBS. Duelo Conv×Híb e matriz I–V SÓ sob demanda (clique no botão ou pedido explícito); sem isso, o convencional mostra só botões. Sem números, explica a regra + pede anexo/RBT12/receita, sem projetar exemplo.',
    inputs: ['anexo', 'rbt12', 'receitaMes', 'folha12?', 'despesas? (da conversa ou "usar referência")', 'cbsRef?'],
    exemplo: ['"comparar com híbrido ..." (com contexto) → 2 guias', '"Anexo III ... no híbrido" → 2 guias', '"aluguel 2000" (thread híbrida) → recalcula híbrido'],
    guardrail: 'Sem números → explica regra geral SEM simular; com números → usa o motor via responderHibridoAnexo (única saída do híbrido), nunca estima.',
    escreveNoSistema: false,
  },
  {
    tool: 'simularCenarioDividido',
    quandoUsar: 'intenção projecao: dividir o faturamento entre mãe e nova empresa ("dividir em duas empresas?", "vale a pena abrir uma nova empresa?", "30% na nova"). RBT12 deslizante + DAS do motor + economia + payback + alertas (sublimite 3,6M, 4,8M, Fator R, grupo econômico).',
    inputs: ['rbt12 (12m mãe)', 'receitaMes total/mês', 'percentualNova 0 < p < 1', 'anexoMae I–V', 'anexoNova I–V', 'folha12Mae? (Fator R)', 'custoMensalNova? (payback líquido)', 'mesInicio YYYY-MM (default próximo mês)', 'horizonte 12m'],
    exemplo: ['"RBT12 1,2M, receita 120 mil/mês, 30% na nova, mãe no III e nova no III" → simularCenarioDividido + veredito compensa/não compensa'],
    guardrail: 'Sem RBT12/receita/percentual/anexos → PERGUNTA os valores (passo 1-4), nunca simula com exemplo. Série honesta: histórico=RBT12/12, projeção=receita repetida 12m. Todo número do motor; grupo econômico exige contador.',
    escreveNoSistema: false,
  },
  {
    tool: 'explicarConceito',
    quandoUsar: 'intenção conceito: "o que é IBS/Fator R/sublimite...?" (verbo + termo do sistema).',
    inputs: ['termo (verbete de aurum-ai-conhecimento.ts)'],
    exemplo: ['"o que é Fator R?" → verbete + onde ver no sistema'],
    guardrail: 'Só verbetes curados; termo fora da lista → orientação, nunca definição inventada.',
    escreveNoSistema: false,
  },
  {
    tool: 'gerarRelatorio',
    quandoUsar: 'intenção relatorio: entende QUAL relatório (conversa/cálculo/Simples/NF-e/produtos).',
    inputs: ['alvo (conversa | calculo | simples | nfe | produtos | lote)', 'formato (turno 2)'],
    exemplo: ['"gera relatório desse cálculo" → congela último cálculo + pergunta CSV/JSON/TXT'],
    guardrail: 'Turno 1 congela dados e pergunta formato; turno 2 baixa. Módulo dono (Simples/NF-e) para dados reais.',
    escreveNoSistema: false,
  },
  {
    tool: 'navegarPara',
    quandoUsar: 'intenção navegar/capacidades/ajuda/status: sugere a view + botão.',
    inputs: ['destino (view)'],
    exemplo: ['"me leva para a calculadora" → botão Ir para Calculadora'],
    guardrail: 'Só sugere; a troca é ato do usuário no botão. Chat nunca altera dados.',
    escreveNoSistema: false,
  },
  {
    tool: 'responderLeve',
    quandoUsar: 'saudacao/conversa_leve: cumprimento, obrigado, tchau.',
    inputs: [],
    exemplo: ['"obrigado!" → "Por nada! ..." + 1 sugestão fiscal'],
    guardrail: 'Breve (≤2 linhas) + ponte para recurso; nunca vira aula fiscal.',
    escreveNoSistema: false,
  },
  {
    tool: 'recusarForaDeEscopo',
    quandoUsar: 'barreira detectarForaDeEscopo = true (tarefa externa, sem lastro fiscal/sistema).',
    inputs: [],
    exemplo: ['"me conta uma piada" → mensagem fixa + profissional da área'],
    guardrail: 'Texto exato MENSAGEM_FORA_DE_ESCOPO_CHAT; sem variação, sem worker.',
    escreveNoSistema: false,
  },
];

export interface MensagemHistorico {
  papel: 'user' | 'assistant';
  texto: string;
}

/**
 * Memo de contexto por turno (fine-tuning v5 — fluxos simples).
 *
 * `extrairContextoConversa` varre até 20 mensagens com dezenas de regexes; o
 * orquestrador a chamava 2–3× por turno (refino + respondedores) com o MESMO
 * histórico. Este cache (chave = referência do array, válida só no turno)
 * calcula uma vez e compartilha — mesma resposta, sem consultas repetidas.
 */
const memoContextoTurno = new WeakMap<MensagemHistorico[], ContextoConversa>();

export function contextoBaseDoTurno(historico: MensagemHistorico[] = []): ContextoConversa {
  const h = historico ?? [];
  const achado = memoContextoTurno.get(h);
  if (achado) return achado;
  const ctx = extrairContextoConversa(h);
  memoContextoTurno.set(h, ctx);
  return ctx;
}

export interface ContextoConversa {
  ultimoCodigoNcm: string | null;
  ultimoCodigoNbs: string | null;
  ultimoCnpj: string | null;
  /** Último CNAE citado (7 dígitos) — para "e esse CNAE?" / funil de anexo. */
  ultimoCnae: string | null;
  /** Núcleo textual da última consulta classificatória ("tangerina"). */
  ultimoAssunto: string | null;
  /** Domínio do último assunto (para refinos "e para revenda?"). */
  ultimoDominio: 'ncm' | 'nbs' | null;
  ultimoValorBase: number | null;
  ultimoAnexo: 'I' | 'II' | 'III' | 'IV' | 'V' | null;
  ultimoRbt12: number | null;
  ultimaReceita: number | null;
  ultimaFolha: number | null;
  /** v7 — pilha em ordem cronológica (só falas user do domínio Simples). */
  historicoAnexos: Array<'I' | 'II' | 'III' | 'IV' | 'V'>;
  historicoRbt12: number[];
  historicoReceitas: number[];
  historicoFolhas: number[];
  houveCalculo: boolean;
  houveSimples: boolean;
  houveCnpj: boolean;
  /** Último filtro de dados citado (cliente/fornecedor/produto/período) — para "e desse cliente?", "só as entradas". */
  ultimoFiltroDados: string | null;
  houveDados: boolean;
  /** Última empresa mencionada ("Padaria Pão Dourado") — para "e desse cliente?". */
  ultimaEmpresaMencionada: string | null;
  /** Último produto específico mencionado ("queijo minas da Padaria Y"). */
  ultimoProdutoMencionado: string | null;
}

/**
 * Memória da conversa: varre o histórico (até 20 msgs) e extrai o último
 * NCM/NBS, valores, anexo e flags de cálculo/Simples. Puro e testável.
 * É o que permite "e para 2 mil?" ou "e com folha maior?" sem repetir tudo.
 *
 * Anti-poluição (v2.1): usa SÓ falas do usuário e separa por domínio —
 * - Simples (anexo/RBT/receita/folha) sai SÓ de falas com vocabulário do
 *   Simples; a base R$ 1.000 de um cálculo IBS/CBS NUNCA vira "receita".
 * - base IBS/CBS sai SÓ de falas de cálculo (código ou quanto-fica/calcula).
 * Antes, o combinado incluía respostas da assistente (DAS, IBS, totais) e
 * misturava tudo — ex.: receita R$ 1.000 do IBS virava receita do Simples.
 */
export function extrairContextoConversa(historico: MensagemHistorico[] = []): ContextoConversa {
  const ultimas = historico.slice(-20);
  // SÓ o usuário informa valores: respostas da assistente trazem DAS, IBS,
  // totais e faixas que poluiriam os slots se entrassem no combinado.
  const falasUsuario = ultimas.filter((m) => m.papel === 'user').map((m) => m.texto);
  const textoUsuario = falasUsuario.join('\n');
  // Domínio Simples: só falas que falam de Simples contribuem com anexo/RBT.
  const falasSimples = falasUsuario.filter((t) =>
    /anexo|rbt|receita|folha|\bdas\b|fator|sublimite|simples/i.test(t),
  );
  // Domínio cálculo IBS/CBS: só falas com código ou verbo de cálculo.
  const falasCalculo = falasUsuario.filter((t) =>
    /\d{8,9}|quanto fica|calcula|calcule|calculo|simula|\bibs\b|\bcbs\b|\bncm\b/i.test(t),
  );
  let ultimoCodigoNcm: string | null = null;
  let ultimoCodigoNbs: string | null = null;
  let ultimoCnpj: string | null = null;
  let ultimoCnae: string | null = null;
  /**
   * Extrai NCM (8 dígitos corridos ou `0000.00.00`) e NBS (9 dígitos ou
   * `000.000.000`) de um texto. A resposta da assistente sempre formata
   * (`NCM 0403.20.00`), então o contexto PRECISA ler o formato — antes só
   * `\b\d{8}\b` era aceito e "só tem esse?" perdia o código anterior.
   */
  const extrairCodigos = (texto: string): void => {
    const f8 = texto.match(/\b\d{4}\.\d{2}\.\d{2}\b/);
    const p8 = texto.match(/\b\d{8}\b/);
    const achou8 = (f8?.[0] ?? p8?.[0] ?? null);
    if (achou8) {
      const d = achou8.replace(/\D+/g, '');
      if (d.length === 8) ultimoCodigoNcm = d;
    }
    const f9 = texto.match(/\b\d{3}\.\d{3}\.\d{3}\b/);
    const p9 = texto.match(/\b\d{9}\b/);
    const achou9 = (f9?.[0] ?? p9?.[0] ?? null);
    if (achou9) {
      const d = achou9.replace(/\D+/g, '');
      if (d.length === 9) ultimoCodigoNbs = d;
    }
    const fcnae = texto.match(/\b\d{4}-\d\/\d{2}\b/);
    if (fcnae) {
      const d = fcnae[0].replace(/\D+/g, '');
      if (d.length === 7) ultimoCnae = d;
    } else if (/\bcnae\b|\banexo\b/i.test(texto)) {
      const p7 = texto.match(/\b\d{7}\b/);
      if (p7) ultimoCnae = p7[0];
    }
  };
  for (const item of ultimas) {
    const texto = item.texto;
    if (item.papel !== 'user') {
      // Assistente: só códigos (valores/DAS da resposta nunca viram contexto).
      extrairCodigos(texto);
      continue;
    }
    // CNPJ (14 dígitos com ou sem máscara) — antes do NCM/NBS para não fatiar.
    const maskCnpj = texto.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
    if (maskCnpj) ultimoCnpj = maskCnpj[0].replace(/\D+/g, '');
    else {
      const soDigitos = texto.replace(/\D+/g, '');
      if (soDigitos.length === 14 && /cnpj|empresa|estabelecimento|contribuinte|salvar|cadastrar|cliente|emissor/i.test(texto)) {
        ultimoCnpj = soDigitos;
      } else {
        for (const tok of String(texto).split(/[\s;,|]+/)) {
          if (tok.replace(/\D+/g, '').length === 14) { ultimoCnpj = tok.replace(/\D+/g, ''); break; }
        }
      }
    }
    // códigos aparecem formatados (0803.10.00) — extrai via regex por mensagem
    extrairCodigos(texto);
  }
  // CNPJ citado pela assistente ("CNPJ 53.795.990/0001-68 — ...") também vale
  // como contexto para "salvar essa empresa".
  if (!ultimoCnpj) {
    for (const m of ultimas.filter((x) => x.papel === 'assistant').map((x) => x.texto)) {
      const mask = m.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
      if (mask) { ultimoCnpj = mask[0].replace(/\D+/g, ''); break; }
    }
  }
  const slots = extrairSlotsSimples(falasSimples.join('\n'));
  // v7 — pilha por fala (não o `join` cego): preserva primeiro/anterior/último
  // para "volta para o RBT anterior", "usa o primeiro RBT", "o outro anexo".
  // O `ultimo*` continua sendo a view do topo (compat com v6).
  let historicoAnexos: Array<'I' | 'II' | 'III' | 'IV' | 'V'> = [];
  let historicoRbt12: number[] = [];
  let historicoReceitas: number[] = [];
  let historicoFolhas: number[] = [];
  try {
    const pilha = historicoSlotsSimples(falasSimples);
    historicoAnexos = pilha.turnos.map((t) => t.anexo).filter((v): v is 'I' | 'II' | 'III' | 'IV' | 'V' => v != null);
    historicoRbt12 = pilha.turnos.map((t) => t.rbt12).filter((v): v is number => v != null);
    historicoReceitas = pilha.turnos.map((t) => t.receitaMes).filter((v): v is number => v != null);
    historicoFolhas = pilha.turnos.map((t) => t.folha12).filter((v): v is number => v != null);
  } catch {
    /* pilha é best-effort */
  }
  // v7 — o `ultimoAnexo` sai do TOPO da pilha (última menção), não do `join`
  // (onde o `match` pegava a PRIMEIRA menção e congelava o passado).
  // RBT/receita/folha seguem do `join` (o fallback posicional precisa do blob).
  const ultimoAnexoPilha: 'I' | 'II' | 'III' | 'IV' | 'V' | null =
    historicoAnexos.length ? historicoAnexos[historicoAnexos.length - 1] : null
  const valoresCalculo = extrairTodosValores(falasCalculo.join('\n'));
  const ultimoValorBase = valoresCalculo.length ? valoresCalculo[valoresCalculo.length - 1].valor : null;
  const textoBaixo = textoUsuario.toLowerCase();
  // Assunto classificatório: última fala do usuário com núcleo aproveitável
  // ("tangerina" — para refinos como "e para revenda?", "100% algodão").
  let ultimoAssunto: string | null = null;
  let ultimoDominio: 'ncm' | 'nbs' | null = null;
  for (let i = falasUsuario.length - 1; i >= 0; i--) {
    const fala = falasUsuario[i];
    if (/\d{8,9}/.test(fala)) continue;
    const nuc = extrairNucleoBusca(fala);
    if (!nuc || nuc.length > 80) continue;
    if (!temSinalFiscal(fala)) continue;
    ultimoAssunto = nuc;
    const fl = fala.toLowerCase();
    ultimoDominio =
      /nbs|servi[cç]o|atividade|cnae|aula|curso/.test(fl) && !/ncm|produto|mercadoria/.test(fl)
        ? 'nbs'
        : 'ncm';
    break;
  }
  // Empresa/produto mencionados (fine-tuning v3): última menção explícita
  // ("da Padaria Y", "o queijo minas da...") para follow-ups ("e desse
  // cliente?", "quanto fica esse queijo?"). Regexes leves locais (puro).
  let ultimaEmpresaMencionada: string | null = null;
  let ultimoProdutoMencionado: string | null = null;
  for (let i = falasUsuario.length - 1; i >= 0; i--) {
    const fala = falasUsuario[i];
    if (!ultimaEmpresaMencionada) {
      const mExp = fala.match(/(?:empresa|cliente|companhia|loja)\s+(?:de\s+|da\s+|do\s+|chamad[ao]\s+)?([^,.;?]{2,60})/i)
        ?? fala.match(/\b(?:da|de|do)\s+([A-ZÀ-Ú][A-Za-zÀ-ú0-9&'.\-]{1,30}(?:\s+[A-ZÀ-Úa-zà-ú0-9&'.\-]{2,30}){0,4})/);
      if (mExp?.[1] && mExp[1].trim().length >= 2 && !/^(algum|alguma|todos|meus|desse|deste|receita|folha|rbt|anexo|das|nota|xml|lei|art|mes|ano|qual|que)\b/i.test(mExp[1].trim())) {
        ultimaEmpresaMencionada = mExp[1].trim();
      } else {
        const aspas = [...fala.matchAll(/["'“”‘’]([^"'“”‘’]{2,60})["'“”‘’]/g)].map((m) => m[1].trim());
        if (aspas.length) ultimaEmpresaMencionada = aspas[aspas.length - 1];
      }
    }
    if (!ultimoProdutoMencionado) {
      const mProd = fala.match(/produtos?\s+(?:de\s+|da\s+|do\s+|chamad[ao]\s+)?([^,.;?]{2,60})/i);
      if (mProd?.[1]) {
        const cand = mProd[1].trim().split(/\s+(da|de|do|desse|desta)\b/i)[0].trim();
        if (cand.length >= 2) ultimoProdutoMencionado = cand;
      }
    }
    if (ultimaEmpresaMencionada && ultimoProdutoMencionado) break;
  }
  return {
    ultimoCodigoNcm,
    ultimoCodigoNbs,
    ultimoCnpj,
    ultimoCnae,
    ultimoAssunto,
    ultimoDominio,
    ultimoValorBase,
    ultimoAnexo: ultimoAnexoPilha ?? slots.anexo,
    ultimoRbt12: slots.rbt12,
    ultimaReceita: slots.receitaMes,
    ultimaFolha: slots.folha12,
    historicoAnexos,
    historicoRbt12,
    historicoReceitas,
    historicoFolhas,
    houveCalculo: /ibs|quanto fica|calcula|calcule|calculo|simula|\bncm\b/i.test(textoBaixo),
    houveSimples: /das|anexo|rbt12|rbt|fator r|sublimite|simples/i.test(textoBaixo),
    houveCnpj: ultimoCnpj != null || /cnpj|consultar.*empresa|atividades.*cnpj/i.test(textoBaixo),
    ultimoFiltroDados: /xml|nota fiscal|nfe|fornecedor|cliente|diferid|reducao|redução|produto.*(credito|debito)|filtro/i.test(textoBaixo)
      ? falasUsuario.slice(-3).join(' ').slice(0, 300)
      : null,
    houveDados: /xml|nota fiscal|\bnfe\b|fornecedor|diferid|reducao|redução|\bcliente/.test(textoBaixo),
    ultimaEmpresaMencionada,
    ultimoProdutoMencionado,
  };
}

/** Roteamento intenção → tool (documenta o tool calling para auditoria). */
export function toolParaIntencao(intencao: AnaliseChat['intencao']): ToolName {
  switch (intencao) {
    case 'ncm': return 'consultarNCM';
    case 'nbs': return 'consultarNBS';
    case 'cnae': return 'consultarCnaeNbs';
    case 'cnpj': return 'consultarCNPJ';
    case 'cadastrar_produto': return 'cadastrarProdutoAssistido';
    case 'clientes': return 'consultarClientes';
    case 'dados': return 'consultarDadosXml';
    case 'calculo': return 'calcularIBSCBS';
    case 'conta': return 'calcularContaBasica';
    case 'tempo': return 'responderTempo';
    case 'simples': return 'calcularSimples';
    case 'comparativo': return 'simularComparativo';
    case 'projecao': return 'simularCenarioDividido';
    case 'conceito': return 'explicarConceito';
    case 'legislacao': return 'explicarArtigoLC214';
    case 'relatorio': return 'gerarRelatorio';
    case 'navegar': case 'capacidades': case 'ajuda': case 'status': return 'navegarPara';
    case 'saudacao': case 'conversa_leve': return 'responderLeve';
    default: return 'responderLeve';
  }
}

/**
 * Modificador visual (fluxo agêntico de gráficos): preenche
 * `analise.querGrafico/tipoGrafico` a partir do texto atual, sem tocar na
 * intenção fiscal. Chamado pelo orquestrador logo após
 * `refinarIntencaoComContexto`. Puro (só lê o texto).
 */
export function anexarPedidoGrafico(analise: AnaliseChat, texto: string): AnaliseChat {
  try {
    const pedido = detectarPedidoGrafico(texto)
    if (!pedido.quer) return analise
    return { ...analise, querGrafico: true, tipoGrafico: pedido.tipo ?? analise.tipoGrafico ?? null }
  } catch {
    return analise
  }
}

/**
 * Continuação por contexto: o detector é puro (só a frase atual), então
 * "e para 5 mil?" ou "e com folha maior?" caem em `generico`. Aqui o
 * orquestrador promove para `calculo`/`simples`/`cnpj` quando há lastro:
 * - valor atual + NCM no histórico → `calculo` ("e para 5 mil?");
 * - código atual + valor no histórico → `calculo` ("e no NCM X?");
 * - menção a folha/RBT/receita/anexo OU histórico de Simples → `simples`.
 * - "salvar essa empresa" / "salvar como cliente" + CNPJ no contexto → `cnpj`.
 * Puro e testável. Retorna a intenção original quando não há contexto.
 */
export function refinarIntencaoComContexto(
  analise: AnaliseChat,
  texto: string,
  historico: MensagemHistorico[] = [],
  memoria?: MemoriaSistema | null,
): AnaliseChat {
  // Follow-up VISUAL puro ("mostra em tabela", "e em pizza?"): o detector
  // pode rotear ao RAG pelo lastro ("tabela" tem sinal fiscal) — mas sem
  // conteúdo próprio, o certo é herdar o DOMÍNIO da conversa (dados >
  // simples > calculo) para reconstruir o mesmo escopo com gráfico.
  // Vale para generico/ncm/nbs; intenção com conteúdo real nunca é roubada.
  if (analise.intencao === 'generico' || analise.intencao === 'ncm' || analise.intencao === 'nbs') {
    try {
      if (ehPedidoVisualPuro(texto)) {
        const ctxV = contextoBaseDoTurno(historico);
        if (ctxV.houveDados) return { ...analise, intencao: 'dados' };
        if (ctxV.houveSimples || ctxV.ultimoAnexo != null || ctxV.ultimoRbt12 != null) {
          return { ...analise, intencao: 'simples' };
        }
        if (ctxV.houveCalculo || ctxV.ultimoCodigoNcm != null || ctxV.ultimoValorBase != null) {
          return { ...analise, intencao: 'calculo' };
        }
      }
    } catch {
      /* visual nunca trava o refinamento */
    }
  }
  // Projeção mãe/nova por contexto: "e se eu abrir outra?" / "e dividindo?"
  // com conversa Simples ativa herda a projeção (o detector puro só vê a
  // frase atual). Follow-ups curtos ("e com 50% na nova?") herdam o histórico
  // de projeção. Checada antes do cadastro para não virar fluxo de produto.
  if (analise.intencao === 'generico') {
    try {
      if (ehPedidoProjecaoDividida(texto)) return { ...analise, intencao: 'projecao' };
      const ctxP = contextoBaseDoTurno(historico);
      const nP = String(texto ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const histUserP = historico.filter((m) => m.papel === 'user').map((m) => m.texto);
      const veioDeProjecao = histUserP.some((t) => {
        try {
          return ehPedidoProjecaoDividida(t);
        } catch {
          return false;
        }
      });
      if (!/bolo|culinaria|\bxml\b|nota fiscal|\bncm\b|\bnbs\b|boleto|segunda via/.test(nP) &&
        veioDeProjecao && /%|na nova|nesta nova|mae\b|anexo|custo|fatia|meio a meio|\d+\s*\/\s*\d+|terco|metade|rbt|receita|faturamento|folha/.test(nP)) {
        return { ...analise, intencao: 'projecao' };
      }
      if (
        (ctxP.houveSimples || ctxP.ultimoRbt12 != null || ctxP.ultimoAnexo != null) &&
        /abrir|divid|duas|nova empresa|segund|outra empresa|fatia|percentual|na nova|cnpj/.test(nP)
      ) {
        return { ...analise, intencao: 'projecao' };
      }
    } catch {
      /* projeção nunca trava o refinamento */
    }
  }
  // Fluxo de cadastro de produto em andamento (fine-tuning v4): precede o
  // guard de intenção — dígitos e slots ("10051000", "sku QM-01, ncm ...",
  // "cfop 5102") que o detector marcaria como ncm/calculo (valor casual em
  // "QM-01") continuam no fluxo. Pergunta real de cálculo ("quanto fica...?)
  // ou de NCM ("qual o ncm de...?") nunca é roubada.
  if ((analise.intencao === 'generico' || analise.intencao === 'ncm' || analise.intencao === 'calculo') && fluxoCadastroEmAndamento(historico)) {
    const nn = String(texto ?? '').toLowerCase()
    if (!/tem algum ncm|\bncm\b\s+(de|para)\b|qual.{0,24}\bncm\b|quanto fica|calcula|calcule|simula|\bibs\b|\bcbs\b/.test(nn)) {
      return { ...analise, intencao: 'cadastrar_produto' }
    }
  }
  if (analise.intencao !== 'generico') {
    // Follow-up de EMPRESA puro ("e desse cliente?", "e da Padaria Y?"): o
    // detector marca ncm/nbs pelo lastro ("cliente"), mas com histórico de
    // dados + anáfora o certo é herdar o escopo de dados da conversa.
    if (analise.intencao === 'ncm' || analise.intencao === 'nbs') {
      try {
        const ctxPre = contextoBaseDoTurno(historico)
        const nn = String(texto ?? '').toLowerCase()
        if (ctxPre.houveDados && /desse cliente|dessa empresa|deste cliente|dessa consulta|disso\b|nesse recorte|\bdessa\b|\bdeste\b/i.test(nn)) {
          return { ...analise, intencao: 'dados' }
        }
        // v7 — rede de segurança do Simples: frase com vocabulário de slot
        // ("anexo", "folha", "rbt", "receita", "fator r") + conversa de
        // Simples, sem código/CNAE/CNPJ/NBS explícito, é follow-up do Simples
        // ("e no outro anexo?", "e com folha maior?") — nunca RAG de NCM.
        const semCodigoExplicito =
          !/\bnbs\b|\bcnae\b|\bcnpj\b/.test(nn) &&
          !(analise.codigoDigitos?.length === 8 || analise.codigoDigitos?.length === 9) &&
          !analise.cnpj && !analise.cnae
        if (
          semCodigoExplicito &&
          (ctxPre.houveSimples || ctxPre.ultimoAnexo != null || ctxPre.ultimoRbt12 != null) &&
          /anexo|folha|flh\b|rbt|receita|fator\s*r|sublimite|\bdas\b/.test(nn)
        ) {
          return { ...analise, intencao: 'simples' }
        }
      } catch {
        /* segue o fluxo */
      }
    }
    // v9 — "receita tem redução" é do Simples, não dos XMLs: sem termo de
    // dados (xml/nota/fornecedor/cliente...) e sem movimento no histórico,
    // vocabulário de slot + conversa Simples volta ao Simples.
    if (analise.intencao === 'dados') {
      try {
        const ctxPre2 = contextoBaseDoTurno(historico)
        const nn2 = String(texto ?? '').toLowerCase()
        const temTermoDados =
          /xml|nota fiscal|\bnfe\b|nfce|fornecedor|cliente|diferid|cfop|\bcst\b|entradas?|saidas?|estoque|\btop\b|ranking|\bvendas?\b|\bcompras?\b/.test(nn2)
        const temVocabSimples =
          /anexo|\brbt\b|receita|folha|flh\b|\bdas\b|fator|sublimite|hibrido|despesa|aluguel|energia|reduc/.test(nn2)
        if (
          !temTermoDados &&
          temVocabSimples &&
          !ctxPre2.houveDados &&
          (ctxPre2.houveSimples || ctxPre2.ultimoRbt12 != null || ctxPre2.ultimoAnexo != null)
        ) {
          return { ...analise, intencao: 'simples' }
        }
      } catch {
        /* segue o fluxo */
      }
    }
    // v9b — pergunta de alíquota do último DAS ("qual a alíquota efetiva
    // desse cálculo?", "qual o percentual efetivo?"): com conversa Simples
    // ativa e sem código NCM/NBS/CNPJ/CNAE, é follow-up do Simples — nunca
    // cálculo IBS nem conceito isolado. Sem contexto Simples, mantém a rota
    // (conceito explica; cálculo IBS segue com o código).
    if ((analise.intencao === 'calculo' || analise.intencao === 'conceito') && detectarPerguntaAliquota(texto) != null) {
      try {
        const ctxAliq = contextoBaseDoTurno(historico)
        const nnAliq = String(texto ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        const semCodigoExplicito =
          !/\bncm\b|\bnbs\b|\bcnpj\b|\bcnae\b/.test(nnAliq) &&
          !(analise.codigoDigitos?.length === 8 || analise.codigoDigitos?.length === 9) &&
          !analise.cnpj && !analise.cnae
        if (
          semCodigoExplicito &&
          (ctxAliq.houveSimples || ctxAliq.ultimoAnexo != null || ctxAliq.ultimoRbt12 != null)
        ) {
          return { ...analise, intencao: 'simples' }
        }
      } catch {
        /* segue o fluxo */
      }
    }
    return analise
  }
  // Chat novo (sem histórico) ainda tem o artefato-resumo cifrado da IA.
  if (!historico.length && !memoria?.assunto && !memoria?.codigoNcm && !memoria?.codigoNbs) return analise;
  const ctxBase = contextoBaseDoTurno(historico);
  // O presente vence o passado: o artefato só preenche o que o histórico não diz.
  const ctx = {
    ...ctxBase,
    ultimoCodigoNcm: ctxBase.ultimoCodigoNcm ?? memoria?.codigoNcm ?? null,
    ultimoCodigoNbs: ctxBase.ultimoCodigoNbs ?? memoria?.codigoNbs ?? null,
    ultimoAssunto: ctxBase.ultimoAssunto ?? memoria?.assunto ?? null,
    ultimoDominio: ctxBase.ultimoDominio ?? memoria?.dominio ?? null,
  };
  const n = String(texto ?? '').toLowerCase();
  // Fine-tuning v4 — "sim"/"não" após oferta pendente de cadastro. "Sim"
  // sozinho SEM oferta continua generico (nunca grava). Com oferta de
  // produto → cadastrar_produto; com oferta de CNPJ → cnpj (herda o CNPJ).
  if (ehConfirmacao(texto) || ehNegacao(texto)) {
    if (resumoProdutoPendente(historico) || ofertaAtualizarSkuPendente(historico)) {
      return { ...analise, intencao: 'cadastrar_produto' };
    }
    if (ctx.ultimoCnpj && ofertaCadastroCnpjPendente(historico)) {
      return { ...analise, intencao: 'cnpj', cnpj: ctx.ultimoCnpj };
    }
  }
  // "Tá cadastrado?" sem dígitos, com CNPJ no contexto — herda o CNPJ.
  if (!analise.cnpj && ctx.ultimoCnpj && /cadastrad|registrad|no sistema|ja tem|ja existe|ja cadastrei|consta/i.test(n)) {
    return { ...analise, intencao: 'cnpj', cnpj: ctx.ultimoCnpj };
  }
  // "salvar essa empresa?" / "pode salvar como cliente?" — herda o CNPJ.
  if (/salvar|cadastrar|gravar|cliente|emissor|empres/i.test(n) && ctx.ultimoCnpj) {
    return { ...analise, intencao: 'cnpj', cnpj: ctx.ultimoCnpj };
  }
  // Follow-up de dados ("e desse cliente?", "só as entradas", "e em janeiro?",
  // "e os diferidos?", "quais top produtos desse cliente?", "lista os
  // produtos vendidos") — herda o escopo de dados da conversa.
  if (ctx.houveDados) {
    if (
      /desse cliente|dessa empresa|desse fornecedor|desse produto|deste cliente|dessa consulta|disso\b|nesse recorte/i.test(n) ||
      /^(e |mas |s[oó] |só |filtr|top |rank|lista|mostra)/i.test(n.trim()) && /entrada|saida|credito|debito|fornecedor|produto|diferid|reducao|ncm|cfop|cst|periodo|top|rank|lista|vend|compr|janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|\d{4}|desse|deste|disso/i.test(n) ||
      // Sem prefixo, mas com vocabulário de ranking de movimento.
      /top\s+\d*\s*produtos?|ranking.*produtos?|produtos?.*ranking|lista.*produtos?|produtos?\s+(mais\s+)?(vendidos?|comprados?)|quais?\b.{0,24}\bprodutos?\b|gerar[ao]m?\s+mais\s+(credito|debito)/i.test(n)
    ) {
      return { ...analise, intencao: 'dados' };
    }
    // Motor determinístico: mesmo sem prefixo clássico, se o ranking de
    // ações diz "provável dados" (ex.: detector marcou ncm por "produto"
    // mas o motor vê top/vendido/comprado + histórico), promove a dados.
    // Nunca rouba refino de classificação ("100% algodão", "para revenda").
    if (
      (analise.intencao === 'generico' || analise.intencao === 'ncm' || analise.intencao === 'nbs') &&
      !/composi|compost|feit[oa]\s+(de|em|com)|material|ingrediente|%\s*[a-z]|para\s+(revenda|consumo|plantio)/i.test(n) &&
      ehProvavelDados(texto, { houveDados: true })
    ) {
      return { ...analise, intencao: 'dados' };
    }
  }
  // "quais atividades tem?" após um CNPJ — herda o CNPJ.
  if (/atividad|cnae|essa empresa|dessa empresa|esse cnpj/i.test(n) && ctx.ultimoCnpj && !analise.cnpj) {
    return { ...analise, intencao: 'cnpj', cnpj: ctx.ultimoCnpj };
  }
  // Follow-up EMPRESA (fine-tuning v3): "e da Padaria Y?", "e esse produto na
  // empresa 2?" — com menção de empresa ou produto específico, herda o
  // domínio da conversa: cálculo com contexto vira cálculo ancorado; com
  // histórico de dados vira dados no escopo da empresa.
  if (analise.empresaMencionada || analise.produtoMencionado || ctx.ultimaEmpresaMencionada || ctx.ultimoProdutoMencionado) {
    const mencionaCalculo = /quanto fica|calcula|calcule|calculo|simula|ibs|cbs|r\$|mil|das\b/i.test(n);
    const temCodigoNaFrase = (analise.codigoDigitos?.length === 8 || analise.codigoDigitos?.length === 9);
    if (mencionaCalculo && (ctx.ultimoCodigoNcm || temCodigoNaFrase || ctx.ultimoProdutoMencionado || analise.produtoMencionado)) {
      return { ...analise, intencao: 'calculo' };
    }
    if (ctx.houveDados && /desse|desta|dessa|disso|nesse|neste|empresa|cliente|produto|fornecedor|xml|nota|entradas?|saidas?|credito|debito/i.test(n)) {
      return { ...analise, intencao: 'dados' };
    }
  }
  // Refino de classificação ("e para revenda?", "100% algodão", "esse mesmo"):
  // herda o assunto anterior; os detalhes saem da frase atual via slots.
  // v9 — nunca rouba follow-up do Simples/despesas ("energia 300 com redução
  // de 30%", "30% do RBT", "aluguel 2000"): com conversa Simples + valor ou
  // %, o Simples decide nos blocos abaixo.
  if (ctx.ultimoAssunto || ctx.ultimoCodigoNcm || ctx.ultimoCodigoNbs) {
    const pareceSimplesOuDespesa =
      /anexo|rbt|receita|folha|flh\b|\bdas\b|fator|sublimite|hibrido|despesa|aluguel|energia|reduc/.test(n);
    const rouboSimples =
      pareceSimplesOuDespesa &&
      /[%0-9]/.test(n) &&
      (ctx.houveSimples || ctx.ultimoRbt12 != null || ctx.ultimoAnexo != null);
    const ehOpcoes =
      !rouboSimples &&
      (/s[oó]\s+tem\s+(um|uma|esse|essa|isso)\b/.test(n) ||
      /tem\s+mais\s+(algum|alguma|outro|outra|op)/.test(n) ||
      /outr[oa]s?\s+(ncm|nbs|opç|possibil|codigos?)|^outr[oa]s?\b/.test(n) ||
      /quantos?\s+(ncm|nbs|codigos?|existem|opç)/.test(n) ||
      (/lista|todos?\b|alternativ|possibilidades|opç/.test(n) && !/relatorio|pdf|csv|json/.test(n)))
    // "tem mais crédito/débito?" é dados, não opções de NCM.
    if (ehOpcoes && !/credito|debito|fornecedor|cliente|xml|nota fiscal/.test(n)) {
      return { ...analise, intencao: ctx.ultimoDominio ?? 'ncm', termoBusca: ctx.ultimoAssunto ?? analise.termoBusca };
    }
    const ehRefino =
      !rouboSimples &&
      (/esse|essa|isso|desse|dessa|disso|dele|dela|mesm|dito|mencionad|acima/i.test(n) ||
      /composi|compost|feit[oa]\s+(de|em|com)|material|ingrediente|%/i.test(n) ||
      /para\s+(revenda|consumo|plantio|semeadura|abate|uso|industrial|exporta)/i.test(n) ||
      /uso\s+(em|para|proprio)/i.test(n));
    if (ehRefino && ctx.ultimoAssunto) {
      return { ...analise, intencao: ctx.ultimoDominio ?? 'ncm', termoBusca: ctx.ultimoAssunto };
    }
  }
  // "quer simular no simples?" após CNPJ — vai ao Simples (upsell do CNPJ).
  if (/simples|das|anexo|simular|comparar|hibrido|convencional/i.test(n) && ctx.houveCnpj) {
    return { ...analise, intencao: analise.intencao };
  }
  const temValorAtual = analise.valorBase != null;
  const temCodigoAtual = (analise.codigoDigitos?.length === 8 || analise.codigoDigitos?.length === 9);
  // "e para 5 mil?" — valor novo, código do contexto.
  if (temValorAtual && !temCodigoAtual && ctx.ultimoCodigoNcm) {
    return { ...analise, intencao: 'calculo' };
  }
  // "e no NCM 08031000?" — código novo (já seria calculo se tivesse valor,
  // mas sem valor explícito ainda herda o valor do contexto).
  if (temCodigoAtual && ctx.ultimoValorBase != null) {
    return { ...analise, intencao: 'calculo' };
  }
  // "e com folha maior?" — vocabulário do Simples ou conversa de Simples.
  // Fine-tuning v6: cobre dialetos (paus/conto/pila/mi/bi, verbos de edição,
  // "30% do RBT", "refaz/recalcula", "corrige/muda/troca/bota/aumenta").
  // v9b: pergunta de alíquota ("qual a alíquota efetiva?") também herda.
  if (/folha|rbt|receita|anexo|das|fator|sublimite|flh\b|salario|prolabore|colaborador|funcionario|troca|muda|corrige|altera|bota|coloca|aumenta|reduz|baixa|refaz|recalcula|e se|e com|mantem|folha minima|fator r|aliquota|aquiquota|alicota|percentual|efetiv/.test(n) || ctx.houveSimples) {
    // Só promove se há algo do Simples no ar (termo atual ou contexto).
    if (/folha|rbt|receita|anexo|das|fator|sublimite|mil|milh|mi\b|k\b|bi\b|pau|pila|conto|prata|r\$|\d|%|aliquota|efetiv|percentual/.test(n) && (ctx.ultimoRbt12 != null || ctx.ultimaReceita != null || ctx.ultimoAnexo != null || /folha|rbt|receita|anexo|das|troca|muda|corrige|altera|bota|aumenta|refaz|recalcula/.test(n))) {
      return { ...analise, intencao: 'simples' };
    }
  }
  // v8 — refino de despesas do híbrido ("aluguel 2000", "usar referência",
  // "adicionar contador 800"): com conversa Simples ativa é follow-up do
  // Simples, nunca RAG genérico. O orquestrador decide entre convencional e
  // híbrido pelo contexto (thread híbrida → 2 guias; senão, cálculo normal).
  if (analise.intencao === 'generico') {
    try {
      const temDespesa = extrairDespesasDoTexto(texto).length > 0 || /usar refer[eê]ncia|\bdespesa/i.test(texto)
      if (temDespesa && (ctx.houveSimples || ctx.ultimoAnexo != null || ctx.ultimoRbt12 != null)) {
        return { ...analise, intencao: 'simples' };
      }
    } catch {
      /* despesa nunca trava o refinamento */
    }
  }
  // Follow-up de CNAE ("e esse CNAE?", "qual anexo dele?"): herda o CNAE do
  // contexto para o funil de anexo. Antes do Simples para não virar DAS.
  if (analise.intencao === 'generico' && ctx.ultimoCnae && /cnae|anexo|desse|desta|disso|desse codigo|deste codigo|dele|dela/i.test(n)) {
    return { ...analise, intencao: 'cnae', cnae: ctx.ultimoCnae };
  }
  // Follow-up de conta básica ("e mais 5?", "e 10% disso?", "soma 5"): o
  // detector puro vê só 1 número (generico), mas com resultado anterior no
  // histórico o 1º operando é herdado. Tem precedência sobre o visual.
  try {
    if (analise.intencao === 'generico') {
      const follow = detectarContaFollowUp(texto, historico as never);
      if (follow) return { ...analise, intencao: 'conta' };
    }
  } catch {
    /* conta nunca trava o refinamento */
  }
  // Follow-up VISUAL ("mostra em gráfico", "e em pizza?", "tabela disso?"):
  // herda o domínio da conversa (dados > simples > calculo). O modificador
  // `querGrafico` é preenchido pelo orquestrador via `anexarPedidoGrafico`;
  // aqui só se resolve a INTENÇÃO base para reconstruir o mesmo escopo.
  try {
    const pedido = detectarPedidoGrafico(texto);
    if (pedido.quer) {
      if (ctx.houveDados) return { ...analise, intencao: 'dados' };
      if (ctx.houveSimples || ctx.ultimoAnexo != null || ctx.ultimoRbt12 != null) {
        return { ...analise, intencao: 'simples' };
      }
      if (ctx.houveCalculo || ctx.ultimoCodigoNcm != null || ctx.ultimoValorBase != null) {
        return { ...analise, intencao: 'calculo' };
      }
    }
  } catch {
    /* visual nunca trava o refinamento */
  }
  return analise;
}
