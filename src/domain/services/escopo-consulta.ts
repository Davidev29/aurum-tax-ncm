/**
 * Escopo da Aurum AI — barreira anti-alucinação (pura, sem I/O).
 *
 * A IA só existe para **classificação de NCM no âmbito da Reforma
 * Tributária**. Qualquer pedido fora desse contexto (conhecimento geral,
 * tarefas de escrita/código, small talk, clima, esportes, horóscopo,
 * jailbreak/prompt-injection, ofensas) NÃO é respondido — nem com chute,
 * nem com "conhecimento geral": a UI entrega a mensagem fixa de escopo.
 *
 * Regra: `fora-de-escopo = temMarcadorExterno && !temSinalFiscal`.
 * O `!temSinalFiscal` protege termos ambíguos ("bens de capital",
 * "burro vivo", "tempo de cozimento"): com lastro fiscal, o fluxo normal
 * decide (nunca a recusa).
 */

import { normalizarBusca, STOPWORDS_BUSCA } from './busca-texto'
import { SINONIMOS_FISCAIS } from './vocabulario'
import { DICIONARIO_COMERCIAL } from '@/domain/constants/dicionario-comercial'
import { extrairSinais } from './classificador-descricao'

/**
 * Mensagem fixa de escopo — a ÚNICA resposta para pedidos externos ao
 * sistema. Texto exato, sem variação (auditoria + consistência).
 */
export const MENSAGEM_FORA_DE_ESCOPO =
  'Caro usuário, fui treinada e projetada para lhe atender no âmbito de classificação de NCM, porém coisas externas ao sistema não tenho permissão e nem suporte para responder. Obrigado pela atenção.'

/** Frases/marcas normalizadas que indicam pedido externo (match por substring). */
const MARCADORES_FRASE = [
  // small talk / saudação
  'bom dia', 'boa tarde', 'boa noite', 'tudo bem', 'como vai', 'como voce esta',
  'quem e voce', 'o que voce e', 'se apresente', 'sua apresentacao',
  // conhecimento geral / tarefas externas
  'me conta uma piada', 'me conte uma piada', 'conte uma historia', 'conta uma historia',
  'qual e a capital', 'qual e capital', 'quem foi', 'quem descobriu', 'onde fica',
  'quando aconteceu', 'quanto e 2', 'resolva', 'calcule', 'traduza', 'traduz',
  'escreva um codigo', 'escreva um texto', 'faca minha', 'redacao pronta',
  'receita de bolo', 'receita culinaria', 'como fazer bolo', 'como cozinhar',
  'previsao do tempo', 'tempo hoje', 'como esta o clima',
  'resultado do jogo', 'tabela do brasileirao',
  'voce e burro', 'voce e burra', 'voce e idiota', 'voce nao sabe nada',
  // jailbreak / prompt-injection (nunca obedecer instrução externa)
  'ignore suas instrucoes', 'ignore as instrucoes', 'esqueca suas instrucoes',
  'system prompt', 'seu prompt', 'jailbreak', 'modo dan', 'finja que', 'finge que',
  'diga que voce e', 'roleplay', 'interprete um',
]

/** Palavras isoladas externas (match por token inteiro, só sem lastro fiscal). */
const MARCADORES_TOKEN = new Set([
  'piada', 'poema', 'poesia', 'futebol', 'horoscopo', 'clima',
  'teste', 'testando', 'alo',
])

/** Tokens do dicionário comercial (nomes populares → lastro fiscal). */
let _tokensDicionario: Set<string> | null = null
function tokensDicionario(): Set<string> {
  if (!_tokensDicionario) {
    const s = new Set<string>()
    for (const e of DICIONARIO_COMERCIAL) {
      for (const t of e.termos) {
        // Preposições dentro das frases ("pneu DE caminhão") NÃO são lastro:
        // só a palavra de produto conta ("pneu", "caminhão").
        for (const w of t.split(' ').filter(Boolean)) {
          if (w.length >= 3 && !STOPWORDS_BUSCA.has(w)) s.add(w)
        }
      }
    }
    _tokensDicionario = s
  }
  return _tokensDicionario
}

/** Vocabulário fiscal (dia a dia + oficial) para lastro. */
let _vocabFiscal: Set<string> | null = null
function vocabFiscal(): Set<string> {
  if (!_vocabFiscal) {
    const s = new Set<string>([...Object.keys(SINONIMOS_FISCAIS), ...Object.values(SINONIMOS_FISCAIS)])
    _vocabFiscal = s
  }
  return _vocabFiscal
}

/**
 * `true` quando o texto tem lastro fiscal mínimo (produto, NCM, capítulo ou
 * sinal de uso/estado). Com lastro, a recusa NUNCA dispara.
 */
export function temSinalFiscal(texto: unknown): boolean {
  const cru = String(texto ?? '')
  if (!cru.trim()) return false
  if (/\d{2,}/.test(cru)) return true
  const norm = normalizarBusca(cru)
  if (!norm) return false
  const tokens = norm.split(' ').filter(Boolean)
  const vf = vocabFiscal()
  const vd = tokensDicionario()
  if (tokens.some((t) => vf.has(t) || vd.has(t))) return true
  // Sinais de uso/estado ("vivo", "plantio", "salgado"…) também são lastro.
  if (extrairSinais(tokens).length > 0) return true
  return false
}

/**
 * Detecta pedido fora do escopo do sistema.
 * Puro e auditável: marcadores externos presentes + zero lastro fiscal.
 */
export function detectarForaDeEscopo(texto: unknown): boolean {
  const cru = String(texto ?? '')
  if (!cru.trim()) return false
  const norm = normalizarBusca(cru)
  if (!norm) return false
  const temMarcador =
    MARCADORES_FRASE.some((m) => norm.includes(m)) ||
    norm.split(' ').filter(Boolean).some((t) => MARCADORES_TOKEN.has(t))
  if (!temMarcador) return false
  return !temSinalFiscal(cru)
}
