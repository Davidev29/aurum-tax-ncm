/**
 * Escopo da Aurum AI — barreira anti-alucinação (pura, sem I/O).
 *
 * Política em 3 níveis (fine-tuning v2):
 * - NÍVEL 1 — DENTRO DO SISTEMA: NCM/NBS, IBS/CBS, Simples/DAS/Fator R,
 *   NF-e/XML, lote, produtos, tabelas, legislação do app, conceitos fiscais
 *   simples (o que é IBS, diferença III×V, sublimite…). Responde com tools
 *   read-only + motor determinístico. NUNCA inventa número.
 * - NÍVEL 2 — CONVERSA LEVE: cumprimento, agradecimento, despedida,
 *   confirmação curta ("ok", "obrigado", "bom dia"). Responde breve e
 *   redireciona para os recursos — NÃO é fora-de-escopo.
 * - NÍVEL 3 — FORA DO SISTEMA: conhecimento geral não-fiscal, tarefas de
 *   escrita/código, conselhos não-tributários, previsão, esportes, piada,
 *   jailbreak/prompt-injection, ofensas. NÃO responde — mensagem fixa.
 *
 * Regra: `fora-de-escopo = temMarcadorExterno && !temSinalFiscal && !ehConversaLeve`.
 * O `!temSinalFiscal` protege termos ambíguos ("bens de capital",
 * "burro vivo", "tempo de cozimento"): com lastro fiscal/sistema, o fluxo normal
 * decide (nunca a recusa).
 */

import { normalizarBusca, STOPWORDS_BUSCA } from './busca-texto'
import { SINONIMOS_FISCAIS } from './vocabulario'
import { DICIONARIO_COMERCIAL } from '@/domain/constants/dicionario-comercial'
import { extrairSinais } from './classificador-descricao'
import { detectarConta, detectarTempo } from './basico-chat'

/**
 * Mensagem fixa de escopo — a ÚNICA resposta para pedidos externos ao
 * sistema. Texto exato, sem variação (auditoria + consistência).
 */
export const MENSAGEM_FORA_DE_ESCOPO =
  'Caro usuário, fui treinada e projetada para lhe atender no âmbito de classificação de NCM, porém coisas externas ao sistema não tenho permissão e nem suporte para responder. Obrigado pela atenção.'

/** Frases/marcas normalizadas que indicam pedido externo (match por substring).
 * NOTA v2: cumprimentos simples (bom dia, tudo bem, quem é você) SAÍRAM daqui —
 * são NÍVEL 2 (conversa leve) e têm resposta própria. Aqui fica só o que o
 * sistema NÃO contempla: conhecimento geral, tarefas externas, jailbreak.
 */
const MARCADORES_FRASE = [
  // conhecimento geral / tarefas externas
  'me conta uma piada', 'me conte uma piada', 'conte uma historia', 'conta uma historia',
  'qual e a capital', 'qual e capital', 'quem foi', 'quem descobriu', 'onde fica',
  'quando aconteceu', 'quanto e 2', 'resolva', 'traduza', 'traduz',
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

/** Termos do SISTEMA (vão além do produto): com qualquer um deles há lastro,
 * mesmo sem NCM. É o que permite "o que é IBS?", "diferença III e V", etc.
 * sem cair em fora-de-escopo. */
const SINAIS_SISTEMA = new Set([
  'ibs', 'cbs', 'ncm', 'nbs', 'cst', 'cclasstrib', 'cfop', 'cest',
  'das', 'simples', 'anexo', 'fator', 'sublimite', 'rbt', 'rba',
  'folha', 'prolabore', 'pro-labore', 'receita', 'faturamento',
  'tributo', 'tributario', 'tributaria', 'imposto', 'fiscal',
  'reforma', '214', '123', 'calculadora', 'calculo', 'simulacao',
  'relatorio', 'lote', 'xml', 'nfe', 'nfce', 'sped', 'efd',
  'cnpj', 'cnae', 'produto', 'servico', 'consulta', 'tabela',
  'legislacao', 'lei', 'aliquota', 'reducao', 'credito', 'debito',
  'cliente', 'clientes', 'fornecedor', 'fornecedores', 'diferido', 'diferimento',
  'hibrido', 'convencional', 'dare', ' darf',
])

/** Conversa leve (NÍVEL 2): nunca é fora-de-escopo. Resposta breve + ponte. */
const CONVERSA_LEVE_EXATA = new Set([
  'oi', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'opa', 'eai', 'e ai',
  'tudo bem', 'como vai', 'obrigado', 'obrigada', 'valeu', 'brigado',
  'tchau', 'ate mais', 'ate logo', 'ok', 'beleza', 'entendi', 'show',
  'bom', 'legal',
])

/**
 * `true` quando o texto tem lastro fiscal/sistema mínimo (produto, NCM,
 * capítulo, sinal de uso/estado OU termo do sistema). Com lastro, a recusa
 * NUNCA dispara.
 */
export function temSinalFiscal(texto: unknown): boolean {
  const cru = String(texto ?? '')
  if (!cru.trim()) return false
  if (/\d{2,}/.test(cru)) return true
  const norm = normalizarBusca(cru)
  if (!norm) return false
  const tokens = norm.split(' ').filter(Boolean)
  if (tokens.some((t) => SINAIS_SISTEMA.has(t))) return true
  const vf = vocabFiscal()
  const vd = tokensDicionario()
  if (tokens.some((t) => vf.has(t) || vd.has(t))) return true
  // Sinais de uso/estado ("vivo", "plantio", "salgado"…) também são lastro.
  if (extrairSinais(tokens).length > 0) return true
  return false
}

/** `true` para conversa leve (cumprimento/agradecimento/despedida curta). */
export function ehConversaLeve(texto: unknown): boolean {
  const norm = normalizarBusca(String(texto ?? ''))
  if (!norm) return false
  if (CONVERSA_LEVE_EXATA.has(norm.trim())) return true
  // "bom dia, tudo bem?" — curto (<=4 tokens) + contém cumprimento
  const toks = norm.split(' ').filter(Boolean)
  if (toks.length <= 5 && ['bom', 'boa', 'oi', 'ola', 'obrigado', 'obrigada', 'valeu', 'tchau'].some((g) => toks.includes(g))) {
    // Só é leve se NÃO tiver lastro fiscal/sistema junto
    if (!temSinalFiscal(texto)) return true
  }
  return false
}

/** `true` quando há marcador de pedido externo (small talk, tarefa externa, jailbreak). */
export function temMarcadorExterno(texto: unknown): boolean {
  const cru = String(texto ?? '')
  if (!cru.trim()) return false
  const norm = normalizarBusca(cru)
  if (!norm) return false
  return (
    MARCADORES_FRASE.some((m) => norm.includes(m)) ||
    norm.split(' ').filter(Boolean).some((t) => MARCADORES_TOKEN.has(t))
  )
}

/**
 * Detecta pedido fora do escopo do sistema.
 * Puro e auditável: marcadores externos presentes + zero lastro fiscal/sistema
 * + não é conversa leve. Cumprimentos, conceitos simples, hora/data e contas
 * básicas NUNCA caem aqui (são recursos nativos do chat).
 */
export function detectarForaDeEscopo(texto: unknown): boolean {
  if (ehConversaLeve(texto)) return false
  // Básico do chat (tempo + conta) tem precedência sobre o marcador
  // genérico "quanto e 2" — "quanto é 2+3?" é conta, não tarefa externa.
  try {
    if (detectarTempo(texto)) return false
    if (detectarConta(texto)) return false
  } catch {
    /* sem o módulo básico, segue a regra padrão */
  }
  if (!temMarcadorExterno(texto)) return false
  return !temSinalFiscal(texto)
}
