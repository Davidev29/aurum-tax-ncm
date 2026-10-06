/**
 * Aurum AI — subagente de decisão (tool calling via grafo).
 *
 * Pedido do usuário: "o grafo deverá resolver o tool calling, a IA deverá saber
 * quais ferramentas usar dependendo do que está sendo solicitado, onde um filtro
 * de escolhas deve ser planejado para auxiliar a IA na tomada de decisão. Se tiver
 * como gerar um subagente para a tomada de decisão ficaria ainda melhor."
 *
 * Arquitetura multiagente:
 * - Agente-roteador (este arquivo): recebe pergunta + análise do detector +
 *   contexto da conversa + sinais do grafo, e devolve UMA tool + motivo auditável.
 * - O orquestrador (`aurum-ai-chat.ts`) continua dono da execução; este módulo
 *   só DECIDE (não executa, não escreve — read-only).
 * - O grafo é a fonte de desempate: candidatos NCM/NBS/CNAE com caminho +
 *   proveniência votam no domínio; sem grafo, vale o detector puro.
 *
 * Filtro de escolhas (ordem):
 * 1. Código explícito (8/9/7/14 dígitos) — vence tudo.
 * 2. Valor + código/contexto → calculo/simples.
 * 3. Grafo: domínio com mais candidatos com proveniência vence.
 * 4. Detector puro (fallback).
 */

import type { AnaliseChat } from '@/domain/services/detector-chat'
import type { ToolName } from './aurum-ai-tools'
import { toolParaIntencao } from './aurum-ai-tools'

export interface SinalGrafoDecisao {
  dominio: 'ncm' | 'nbs' | 'cnae' | null
  candidatosNcm: number
  candidatosNbs: number
  candidatosCnae: number
  temProveniencia: boolean
  cypher?: string | null
}

export interface DecisaoTool {
  tool: ToolName
  intencao: AnaliseChat['intencao']
  motivo: string
  viaGrafo: boolean
  alternativas: Array<{ tool: ToolName; porQueNao: string }>
}

/**
 * Filtro de escolhas: elimina tools impossíveis antes de ranquear.
 * Puro e testável.
 */
export function filtrarToolsPossiveis(
  analise: AnaliseChat,
  texto: string,
): { possiveis: ToolName[]; eliminadas: Array<{ tool: ToolName; porQueNao: string }> } {
  const t = String(texto ?? '').toLowerCase()
  const eliminadas: Array<{ tool: ToolName; porQueNao: string }> = []
  const todas: ToolName[] = [
    'consultarNCM', 'consultarNBS', 'consultarCNAE', 'consultarCNPJ',
    'grafoConsultar', 'calcularIBSCBS', 'calcularSimples', 'explicarArtigoLC214',
    'explicarConceito', 'consultarDadosXml', 'consultarClientes',
  ]
  const possiveis = todas.filter((tool) => {
    // CNPJ sem 14 dígitos: elimina consultarCNPJ.
    if (tool === 'consultarCNPJ' && !analise.cnpj && (texto.replace(/\D+/g, '').length < 11 || !/cnpj|empresa|estabelecimento/i.test(t))) {
      eliminadas.push({ tool, porQueNao: 'sem CNPJ na mensagem' })
      return false
    }
    // Cálculo sem valor e sem código/contexto: elimina.
    if (tool === 'calcularIBSCBS' && analise.valorBase == null && !analise.codigoDigitos && !/quanto fica|calcula|ibs|cbs/i.test(t)) {
      eliminadas.push({ tool, porQueNao: 'sem valor/código de cálculo' })
      return false
    }
    // Simples sem vocabulário: elimina.
    if (tool === 'calcularSimples' && !/anexo|rbt|receita|folha|das|simples|fator/i.test(t) && analise.intencao !== 'simples') {
      eliminadas.push({ tool, porQueNao: 'sem vocabulário do Simples' })
      return false
    }
    return true
  })
  return { possiveis, eliminadas }
}

/**
 * Subagente de decisão: grafo vota, filtro elimina, detector desempatia.
 * Nunca lança; sem grafo, devolve o mapeamento direto intenção→tool.
 */
export function decidirToolComGrafo(
  analise: AnaliseChat,
  texto: string,
  sinalGrafo?: SinalGrafoDecisao | null,
): DecisaoTool {
  const base = toolParaIntencao(analise.intencao)
  const { eliminadas } = filtrarToolsPossiveis(analise, texto)

  // Sem sinal do grafo: decisão direta do detector (auditável).
  if (!sinalGrafo || (!sinalGrafo.temProveniencia && sinalGrafo.dominio == null)) {
    return {
      tool: base,
      intencao: analise.intencao,
      motivo: `detector:${analise.intencao}→${base} (sem grafo; filtro eliminou ${eliminadas.length})`,
      viaGrafo: false,
      alternativas: eliminadas.slice(0, 4).map((e) => ({ tool: e.tool, porQueNao: e.porQueNao })),
    }
  }

  // Grafo com proveniência: domínio do grafo pode corrigir o detector.
  // Ex.: "frango vivo" com candidatos 0105 (vivo) × 3002 (vírus vivo) — o
  // caminho com capítulo 01 + destinação vence; 3002 sem "vacina" na query perde.
  const dom = sinalGrafo.dominio
  if (dom === 'ncm' && analise.intencao !== 'ncm' && sinalGrafo.candidatosNcm > 0) {
    return {
      tool: 'consultarNCM',
      intencao: 'ncm',
      motivo: `grafo:NCM (${sinalGrafo.candidatosNcm} candidatos com proveniência) corrigiu detector:${analise.intencao}`,
      viaGrafo: true,
      alternativas: [{ tool: base, porQueNao: `detector disse ${analise.intencao}, grafo votou NCM` }],
    }
  }
  if (dom === 'nbs' && analise.intencao !== 'nbs' && sinalGrafo.candidatosNbs > 0) {
    return {
      tool: 'consultarNBS',
      intencao: 'nbs',
      motivo: `grafo:NBS (${sinalGrafo.candidatosNbs} candidatos com proveniência) corrigiu detector:${analise.intencao}`,
      viaGrafo: true,
      alternativas: [{ tool: base, porQueNao: `detector disse ${analise.intencao}, grafo votou NBS` }],
    }
  }
  if (dom === 'cnae' && analise.intencao !== 'cnae' && sinalGrafo.candidatosCnae > 0) {
    return {
      tool: 'consultarCnaeNbs',
      intencao: 'cnae',
      motivo: `grafo:CNAE (${sinalGrafo.candidatosCnae} candidatos com proveniência) corrigiu detector:${analise.intencao}`,
      viaGrafo: true,
      alternativas: [{ tool: base, porQueNao: `detector disse ${analise.intencao}, grafo votou CNAE` }],
    }
  }

  // Grafo confirma o detector: reforça a decisão.
  return {
    tool: base,
    intencao: analise.intencao,
    motivo: `grafo+detector: ${analise.intencao}→${base} (grafo: ${sinalGrafo.candidatosNcm} NCM / ${sinalGrafo.candidatosNbs} NBS / ${sinalGrafo.candidatosCnae} CNAE, proveniência: ${sinalGrafo.temProveniencia ? 'sim' : 'não'})`,
    viaGrafo: true,
    alternativas: eliminadas.slice(0, 4).map((e) => ({ tool: e.tool, porQueNao: e.porQueNao })),
  }
}
