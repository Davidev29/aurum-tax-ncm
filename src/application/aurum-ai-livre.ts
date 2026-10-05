/**
 * Aurum AI livre — conversa geral com as travas do motor determinístico (IA-06).
 *
 * Estável por construção:
 * - o motor continua fonte da verdade fiscal (NCM/NBS/valores/artigos);
 * - a IA livre só verbaliza papo leve/generico/capacidades/ajuda;
 * - sem modelo real (`bridge.ia.conversar` ausente ou `ok:false`) cai no
 *   template determinístico (fail-closed, nunca mock verbalizando);
 * - sanitização remove NCM/NBS/valores inventados e corta thinking vazado.
 */

import { bridge } from '@/infrastructure/bridge'
import type { MensagemHistorico } from './aurum-ai-tools'

/** Intenções liberadas para verbalização livre (nada fiscal com número). */
export const INTENCOES_LIVRES = new Set(['saudacao', 'conversa_leve', 'generico', 'capacidades', 'ajuda'])

export function intencaoLiberada(intencao: string): boolean {
  return INTENCOES_LIVRES.has(intencao)
}

/**
 * Modo teste (DebugIA → "mostrar bruto"): `localStorage.aurum_ia_teste_livre === '1'`
 * devolve o texto cru do seu GGUF sem a sanitização fail-closed, marcado com
 * `[TESTE]`. Só para você avaliar o modelo que tem aqui — o chat continua
 * sanitizado por padrão.
 */
export function modoTesteLivre(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('aurum_ia_teste_livre') === '1'
  } catch {
    return false
  }
}

/**
 * System prompt = finetuning com as regras travadas no motor, em versão
 * CURTA (qualquer modelo pequeno em CPU agradece: prompt longo faz modelo
 * fraco ecoar o sistema em markdown — aqui vão só identidade + 3 proibições).
 * As travas completas vivem na sanitização (`sanitizarLivre`, fail-closed)
 * e no motor determinístico, que continua dono de NCM/NBS/valores/artigos.
 * O envelope de chat (ChatML/Llama3/Mistral/...) é resolvido no worker pela
 * camada de compatibilidade (`electron/ia/perfil-modelo.cjs`) — aqui só o
 * CONTEÚDO do sistema, agnóstico ao modelo.
 */
export function montarSistemaLivre(args?: { nome?: string | null; modo?: string }): string {
  void args?.modo
  const nome = args?.nome ? ` O usuário é ${args.nome}.` : ''
  return (
    `Você é a Aurinha, assistente do Aurum Tax NCM. Responda em português, curto (1-3 linhas), simpático.${nome}\n` +
    `Nunca invente códigos, valores ou artigos de lei. Se pedirem fiscal, peça 1 detalhe.`
  )
}

/** Remove vazamento de papéis do ChatML (`user`, `assistant`) ecoados pelo 0.6B. */
function semPapeis(s: string): string {
  return s
    .split('\n')
    .map((l) => {
      const t = l.trim()
      if (/^(user|assistant|system|usuário|usuario)\s*:?\s*$/i.test(t)) return ''
      return l.replace(/^(user|assistant|system|usuário|usuario)\s*:\s*/i, '')
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Remove invenção fiscal: código/valor que não estava nos fatos. */
export function sanitizarLivre(texto: string, fatos?: { codigos?: string[]; valores?: string[] }): string | null {
  let s = semPapeis(
    String(texto ?? '')
      .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
      .replace(/<\/?think>/gi, ' ')
      .replace(/<\|im_(start|end)\|>/g, ' ')
      .replace(/\|im_end\|/g, ' ')
      .trim(),
  )
  if (!s || s.length < 2) return null
  // Vazamento do prompt interno (IA-07): o 0.6B ecoa o separador — nunca vai à UI.
  if (/fatos do motor para verbalizar/i.test(s)) return null
  if (/^---\s*$/m.test(s) && /fatos/i.test(s)) return null
  // Thinking em inglês vazado ou degeneração: fail-closed (volta ao template).
  if (/okay,\s*the user|translates to|i need to|i should respond/i.test(s)) return null
  if (/(vamos começar com o que posso fazer\W*){3,}/i.test(s)) return null
  if (/(\bend of (response|conversation|message)\b.{0,10}){2,}/i.test(s)) return null
  // Loop típico do 0.6B com exemplos do histórico ("O valor do ncm é R$ 1.000" x4).
  const repetida = s.match(/(o valor do (ncm|produto)[^.]{0,40}?\.)/gi) ?? []
  if (repetida.length >= 2) return null
  if (/(tenho um problema com o ncm)/i.test(s)) return null
  // Eco do system prompt em markdown (0.6B fraco): "# Perfil", lista de regras.
  const linhasHash = s.split('\n').filter((l) => l.trim().startsWith('#')).length
  if (linhasHash >= 3) return null
  if (/perfil do (assistente|trabalhador|fiscal)/i.test(s)) return null
  if(/(# curiosidade\s*){3,}/i.test(s)) return null
  // NCM/NBS inventado: qualquer 8/9 dígitos que não estava nos fatos → descarta.
  const permitidos = new Set((fatos?.codigos ?? []).map((c) => String(c).replace(/\D+/g, '')))
  const achados = s.match(/\b\d{8,9}\b/g) ?? []
  for (const a of achados) {
    if (!permitidos.has(a.replace(/\D+/g, ''))) return null
  }
  // Papo leve (sem fatos): nenhum número fiscal — nem R$, nem 4+ dígitos.
  // Exemplos do template ("R$ 1.000", "0803.10.00") NÃO são fatos.
  if (!permitidos.size && !(fatos?.valores ?? []).length) {
    if (/R\$\s?[\d]/.test(s)) return null
    if (/\b\d{4,}\b/.test(s.replace(/[^\d\s]/g, (m) => (/\d/.test(m) ? m : ' ')))) {
      const digitos = s.replace(/\D+/g, '')
      if (digitos.length >= 4) return null
    }
  }
  // Artigo inventado em papo leve: "art. 999" sem lastro → descarta.
  // (Conceito/legislação continuam no motor; aqui só papo leve.)
  if (/\bart\.?\s*\d{1,3}\b/i.test(s)) return null
  if (s.length > 1200) s = s.slice(0, 1200).trimEnd() + '…'
  return s
}

/**
 * Sanitização da abertura fiscal (IA-07, controle via RAG): a intro do modelo
 * NUNCA carrega número — códigos/valores vêm 100% do motor, verbatim.
 */
export function sanitizarAbertura(texto: string): string | null {
  let s = semPapeis(
    String(texto ?? '')
      .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
      .replace(/<\/?think>/gi, ' ')
      .replace(/<\|im_(start|end)\|>/g, ' ')
      .replace(/\|im_end\|/g, ' ')
      .trim(),
  )
  if (!s || s.length < 2) return null
  if (/fatos do motor para verbalizar/i.test(s)) return null
  if (/okay,\s*the user|translates to|i need to|i should respond/i.test(s)) return null
  if (/\b\d{8,9}\b/.test(s)) return null
  if (/R\$\s?[\d]/.test(s)) return null
  if (/\bart\.?\s*\d{1,3}\b/i.test(s)) return null
  if (/\b\d{4,}\b/.test(s)) return null
  const primeira = s.split(/(?<=[.!?])\s+/)[0].trim()
  if (!primeira) return null
  if (primeira.length > 220) return null
  return primeira
}

/**
 * Tenta verbalizar com o modelo embarcado (qualquer GGUF via camada de
 * compatibilidade). Retorna `null` quando indisponível ou sanitização
 * barrou (o chamador usa o template determinístico).
 */
export async function conversarLivre(args: {
  pergunta: string
  historico?: MensagemHistorico[]
  sistema?: string
  think?: boolean
  fatos?: { codigos?: string[]; valores?: string[] }
  temperature?: number
}): Promise<{ texto: string; motivo: string } | null> {
  const conversar = bridge?.ia?.conversar
  if (typeof conversar !== 'function') return null
  try {
    const r = await conversar(args.pergunta, {
      sistema: args.sistema ?? montarSistemaLivre(),
      historico: (args.historico ?? []).slice(-6).map((m) => ({ papel: m.papel, texto: String(m.texto).slice(0, 500) })),
      think: args.think === true,
      maxTokens: args.think ? 448 : 280,
      temperature: args.temperature ?? 0.35,
    })
    if (!r || !r.ok || !r.texto) return null
    // Modo teste: mostra o cru do seu modelo (DebugIA), sem barreira.
    if (modoTesteLivre()) {
      const cru = String(r.texto).slice(0, 1200).trim()
      if (!cru) return null
      return { texto: `[TESTE] ${cru}`, motivo: `${r.motivo ?? 'llm-livre'}+bruto` }
    }
    const limpo = sanitizarLivre(r.texto, args.fatos)
    if (!limpo) return null
    return { texto: limpo, motivo: r.motivo ?? 'llm-livre' }
  } catch {
    return null
  }
}
