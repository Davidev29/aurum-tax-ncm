/**
 * Aurum AI — fluxos simples (fine-tuning v5).
 *
 * Mapa das rotinas que o sistema resolve com recursos NATIVOS (templates
 * determinísticos + perfil em cache), sem RAG, sem Dexie de dados e sem
 * releituras: saudação, conversa leve, capacidades, ajuda, navegação,
 * status, conceito, legislação, genérico + barreira de escopo.
 *
 * Como funciona:
 * - `INTENCOES_FLUXO_SIMPLES`: intenções roteáveis sem contexto pesado.
 * - `precisaCaminhoCompleto()`: flags que ATIVAM os gatilhos do caminho
 *   completo — oferta/portão pendente no último turno ("sim" após oferta),
 *   rascunho de cadastro em andamento, ou sinal de aprendizado com resposta
 *   fiscal anterior. Tudo o mais rotineiro vai pelo fluxo simples.
 * - `sugestoesParaPadrao()`: personalização por padrão de conversa
 *   (intenção dominante com 3+ turnos) — sem consultas, só o perfil.
 *
 * Guardrails: o fluxo simples NUNCA escreve no banco de dados/negócio; a
 * única escrita é o aprendizado de turno (`registrarTurnoMemoria`, contagem
 * de padrões) e a declaração explícita de nome — ambas fora deste módulo,
 * no orquestrador.
 */

import type { IntencaoChat } from '@/domain/services/detector-chat'
import { ehConfirmacao, ehNegacao } from './aurum-ai-cadastro'
import { extrairSinalAprendizado, intencaoDominante, type PerfilMemoria } from './aurum-ai-memoria'

/** Intenções resolvidas pelo fluxo simples (recursos nativos, zero RAG). */
export const INTENCOES_FLUXO_SIMPLES: ReadonlySet<IntencaoChat> = new Set([
  'conversa_leve',
  'capacidades',
  'ajuda',
  'navegar',
  'status',
  'tempo',
  'conta',
  'conceito',
  'legislacao',
  'generico',
])
// NOTA: `saudacao` fica DE FORA de propósito — ela carrega a retomada da
// sessão anterior (artefato-resumo) e vai sempre pelo caminho completo.

export interface HistoricoMsg {
  papel: string
  texto: string
}

function ultimaRespostaAssistente(historico: HistoricoMsg[] = []): string | null {
  for (let i = historico.length - 1; i >= 0; i--) {
    if (historico[i]?.papel === 'assistant') return String(historico[i].texto ?? '')
  }
  return null
}

/**
 * `true` quando o turno EXIGE o caminho completo (com contexto, RAG e Dexie).
 *
 * O orquestrador calcula a intenção REFINADA (pura, com contexto memoizado,
 * sem I/O) e decide:
 * - refinada fora do mapa simples (ncm/nbs/cnpj/cadastro/cálculo/simples/
 *   dados/clientes/relatório/comparativo/saudacao) → completo;
 * - chat novo (`sem histórico`) com intenção bruta `generico` → completo
 *   (o artefato-resumo da sessão anterior pode promover a fiscal);
 * - pendência de escrita (oferta/portão/rascunho no último turno) ou
 *   aprendizado com resposta fiscal anterior → completo.
 * Todo o resto rotineiro vai pelo fluxo simples. Puro e testável.
 */
export function precisaCaminhoCompleto(
  texto: string,
  intencaoDetectada: IntencaoChat,
  intencaoRefinada: IntencaoChat,
  historico: HistoricoMsg[] = [],
): boolean {
  if (!INTENCOES_FLUXO_SIMPLES.has(intencaoRefinada)) return true
  // Chat novo com `generico` bruto vai ao completo (o artefato-resumo pode
  // promover a fiscal) — exceto "sim"/"não" isolados, que nunca promovem.
  if (!historico.length && intencaoDetectada === 'generico' && !ehConfirmacao(texto) && !ehNegacao(texto)) return true
  return temPendenciaDeEscrita(texto, historico)
}

/**
 * Flags que ATIVAM os gatilhos do caminho completo mesmo em intenção simples:
 * oferta/portão/rascunho pendente no último turno, ou sinal de aprendizado
 * ("isso mesmo", "não é esse") com resposta fiscal anterior.
 */
export function temPendenciaDeEscrita(texto: string, historico: HistoricoMsg[] = []): boolean {
  if (!historico.length) return false
  const ultima = ultimaRespostaAssistente(historico)
  if (!ultima) return false
  // Oferta, portão ou rascunho pendente → o contexto decide (confirmar,
  // corrigir, escolher empresa, informar slot).
  if (
    /Confirma o cadastro\?|ATUALIZAR o SKU|Quer que eu .*cadastre|posso cadastrar|deseja .*cadastre|Encontrei \*\*\d+ empresas\*\*|Falta:|tributação antiga|Vamos cadastrar|cadastrar o produto|Qual (o|a) (empresa|sku|nome|ncm)|Falta (o|a) \*\*/i.test(
      ultima,
    )
  ) {
    return true
  }
  // Aprendizado com lastro fiscal ("isso mesmo" após NCM) → caminho completo.
  try {
    const sinal = extrairSinalAprendizado(texto)
    if (sinal && /\d{8}|\bncm\b|\bnbs\b|cnpj/i.test(ultima)) return true
  } catch {
    /* aprendizado nunca trava a decisão */
  }
  return false
}

/**
 * Sugestões personalizadas pelo padrão de conversa (ou null = padrão).
 * Só personaliza com padrão estabelecido (dominante com 3+ turnos) para não
 * mudar o comportamento de quem chegou agora.
 */
export function sugestoesParaPadrao(perfil: PerfilMemoria | null | undefined): string[] | null {
  const dominante = intencaoDominante(perfil?.padroes)
  switch (dominante) {
    case 'ncm':
      return ['Tem algum NCM de banana?', 'Qual o NCM de queijo minas?', 'O que você pode fazer?']
    case 'nbs':
      return ['Qual o NBS para aula de inglês?', 'Quais atividades o CNPJ 53.795.990/0001-68 tem?', 'O que você pode fazer?']
    case 'calculo':
      return ['Quanto fica R$ 1.000 no NCM 0803.10.00?', 'Gera um relatório desse cálculo', 'O que você pode fazer?']
    case 'conta':
      return ['Quanto é 12 × 8?', 'Quanto é 10% de 500?', 'Qual o resto de 10 por 3?']
    case 'tempo':
      return ['Que horas são?', 'Que dia é hoje?', 'O que você pode fazer?']
    case 'simples':
      return ['Meu DAS no Anexo III com RBT12 500 mil e receita 40 mil', 'O que é Fator R?', 'Qual melhor: Anexo III ou V?']
    case 'projecao':
      return ['Vale a pena abrir uma nova empresa?', 'Dividir o faturamento em duas empresas?', 'RBT12 1,2M, receita 120 mil/mês, 30% na nova']
    case 'dados':
      return ['Qual fornecedor me dá mais crédito?', 'Existe algum produto diferido?', 'Tem XML de algum cliente?']
    case 'legislacao':
      return ['Explica o art. 128', 'Onde a lei fala de diferimento?', 'O que diz a LC 214 sobre cesta básica?']
    case 'cnpj':
      return ['Quais atividades o CNPJ 53.795.990/0001-68 tem?', 'O CNPJ 53.795.990/0001-68 está cadastrado?', 'O que você pode fazer?']
    case 'cadastrar_produto':
      return ['Quero cadastrar um produto', 'Quais meus clientes?', 'O que você pode fazer?']
    default:
      return null
  }
}
