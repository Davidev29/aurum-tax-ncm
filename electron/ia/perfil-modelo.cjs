'use strict'

/**
 * perfil-modelo.cjs — CAMADA DE COMPATIBILIDADE do modelo IA embarcado.
 *
 * Contrato: o sistema NUNCA fala de um modelo específico (Qwen/Llama/Mistral).
 * Ele consome um PERFIL: { familia, templateChat, contextSize, params, prompts }.
 * Trocar de modelo = trocar o arquivo `*.gguf` em `recursos-ia/modelo/` (+
 * opcional `modelo.json` com ajustes). Nenhum código precisa mudar.
 *
 * Layout suportado em `recursos-ia/modelo/`:
 *   - `<qualquer-nome>.gguf` .......... modelo efetivo (descoberta automática)
 *   - `modelo.json` (opcional) ......... manifesto com overrides do perfil
 *
 * Descoberta (ordem):
 *   1. `modelo.json` → campo `arquivo` (quando existir e o .gguf existir);
 *   2. env `AURUM_IA_MODEL` (caminho explícito, dev/teste);
 *   3. legado `Qwen3-0.6B-Q8_0.gguf` (compatibilidade);
 *   4. qualquer `*.gguf` no diretório (maior arquivo vence — heurística de
 *      "modelo real" vs placeholder); empate → ordem alfabética.
 *
 * Detecção de família (heurística por nome + manifesto):
 *   qwen3 | qwen | llama | mistral | phi | gemma | generico
 * Cada família define: template de chat, tag de thinking, parâmetros seguros
 * de classificação (gramática) e de conversa, e sanitização.
 *
 * Sem dependências além de `node:fs`/`node:path`. Funciona bundlado (main),
 * copiado (worker) e em scripts Node puros.
 */

const fs = require('node:fs')
const path = require('node:path')

const NOME_LEGADO = 'Qwen3-0.6B-Q8_0.gguf'
const NOME_MANIFESTO = 'modelo.json'
const ENV_MODELO = 'AURUM_IA_MODEL'

/** Perfil padrão — seguro para QUALQUER GGUF desconhecido. */
const PERFIL_GENERICO = Object.freeze({
  familia: 'generico',
  templateChat: 'generico',
  contextSize: 4096,
  thinkTag: null,
  suportaGramatica: true,
  classificacao: Object.freeze({ maxTokens: 8, temperature: 0, topP: 1 }),
  conversa: Object.freeze({ maxTokensPadrao: 320, maxTokensThink: 512, temperature: 0.4, topP: 0.9, topK: 40, repeatPenalty: 1.15 }),
})

const PERFIS_POR_FAMILIA = {
  qwen3: {
    familia: 'qwen3',
    templateChat: 'chatml-qwen',
    contextSize: 2048,
    thinkTag: 'think',
    suportaGramatica: true,
    classificacao: { maxTokens: 4, temperature: 0, topP: 1 },
    conversa: { maxTokensPadrao: 280, maxTokensThink: 448, temperature: 0.35, topP: 0.85, topK: 40, repeatPenalty: 1.18 },
  },
  qwen: {
    familia: 'qwen',
    templateChat: 'chatml-qwen',
    contextSize: 2048,
    thinkTag: 'think',
    suportaGramatica: true,
    classificacao: { maxTokens: 4, temperature: 0, topP: 1 },
    conversa: { maxTokensPadrao: 300, maxTokensThink: 480, temperature: 0.4, topP: 0.85, topK: 40, repeatPenalty: 1.15 },
  },
  llama: {
    familia: 'llama',
    templateChat: 'llama3',
    contextSize: 4096,
    thinkTag: null,
    suportaGramatica: true,
    classificacao: { maxTokens: 8, temperature: 0, topP: 1 },
    conversa: { maxTokensPadrao: 320, maxTokensThink: 512, temperature: 0.5, topP: 0.9, topK: 40, repeatPenalty: 1.1 },
  },
  mistral: {
    familia: 'mistral',
    templateChat: 'mistral',
    contextSize: 4096,
    thinkTag: null,
    suportaGramatica: true,
    classificacao: { maxTokens: 8, temperature: 0, topP: 1 },
    conversa: { maxTokensPadrao: 320, maxTokensThink: 512, temperature: 0.5, topP: 0.9, topK: 40, repeatPenalty: 1.1 },
  },
  phi: {
    familia: 'phi',
    templateChat: 'phi',
    contextSize: 4096,
    thinkTag: null,
    suportaGramatica: true,
    classificacao: { maxTokens: 8, temperature: 0, topP: 1 },
    conversa: { maxTokensPadrao: 320, maxTokensThink: 512, temperature: 0.5, topP: 0.9, topK: 40, repeatPenalty: 1.1 },
  },
  gemma: {
    familia: 'gemma',
    templateChat: 'gemma',
    contextSize: 4096,
    thinkTag: null,
    suportaGramatica: true,
    classificacao: { maxTokens: 8, temperature: 0, topP: 1 },
    conversa: { maxTokensPadrao: 320, maxTokensThink: 512, temperature: 0.5, topP: 0.9, topK: 40, repeatPenalty: 1.1 },
  },
}

/**
 * Heurística de família por nome de arquivo (+ dica do manifesto).
 * Nunca lança; desconhecido → 'generico'.
 */
function detectarFamilia(nomeArquivo, dica) {
  const d = String(dica || '').toLowerCase().trim()
  if (d && PERFIS_POR_FAMILIA[d]) return d
  if (d === 'qwen3') return 'qwen3'
  const n = String(nomeArquivo || '').toLowerCase()
  if (/qwen.*3|qwen3/.test(n)) return 'qwen3'
  if (/qwen/.test(n)) return 'qwen'
  if (/llama/.test(n)) return 'llama'
  if (/mistral|mixtral/.test(n)) return 'mistral'
  if (/phi/.test(n)) return 'phi'
  if (/gemma/.test(n)) return 'gemma'
  return 'generico'
}

/** Lê `modelo.json` quando existir. Nunca lança (retorna `{}`legível). */
function lerManifesto(dirModelo) {
  try {
    const p = path.join(dirModelo, NOME_MANIFESTO)
    if (!fs.existsSync(p)) return {}
    const j = JSON.parse(fs.readFileSync(p, 'utf8'))
    return j && typeof j === 'object' ? j : {}
  } catch (_) {
    return {}
  }
}

/** Lista `*.gguf` (não-recursivo) com tamanho. Nunca lança. */
function listarGgufs(dirModelo) {
  try {
    if (!dirModelo || !fs.existsSync(dirModelo)) return []
    return fs.readdirSync(dirModelo)
      .filter((f) => f.toLowerCase().endsWith('.gguf'))
      .map((f) => {
        const abs = path.join(dirModelo, f)
        let bytes = 0
        try { bytes = fs.statSync(abs).size } catch (_) { bytes = 0 }
        return { arquivo: f, caminho: abs, bytes }
      })
      .filter((e) => e.bytes > 0)
      .sort((a, b) => (b.bytes - a.bytes) || a.arquivo.localeCompare(b.arquivo))
  } catch (_) {
    return []
  }
}

/**
 * Descobre o GGUF efetivo em `dirModelo`.
 * Retorna `{ caminho, arquivo, origem }` ou `{ caminho: null, ... }`.
 * `origem`: 'manifesto' | 'env' | 'legado' | 'descoberta' | null.
 */
function descobrirModelo(dirModelo) {
  try {
    if (!dirModelo) return { caminho: null, arquivo: null, origem: null }
    // 1. manifesto explícito
    try {
      const m = lerManifesto(dirModelo)
      if (m && typeof m.arquivo === 'string' && m.arquivo.trim()) {
        const abs = path.join(dirModelo, m.arquivo.trim())
        if (fs.existsSync(abs)) {
          return { caminho: abs, arquivo: path.basename(abs), origem: 'manifesto' }
        }
      }
    } catch (_) { /* segue */ }
    // 2. env explícito
    try {
      const env = String(process.env[ENV_MODELO] || '').trim()
      if (env && fs.existsSync(env)) {
        return { caminho: env, arquivo: path.basename(env), origem: 'env' }
      }
    } catch (_) { /* segue */ }
    // 3. legado (compat)
    try {
      const leg = path.join(dirModelo, NOME_LEGADO)
      if (fs.existsSync(leg)) return { caminho: leg, arquivo: NOME_LEGADO, origem: 'legado' }
    } catch (_) { /* segue */ }
    // 4. qualquer *.gguf (maior vence)
    const lista = listarGgufs(dirModelo)
    if (lista.length) return { caminho: lista[0].caminho, arquivo: lista[0].arquivo, origem: 'descoberta' }
    return { caminho: null, arquivo: null, origem: null }
  } catch (_) {
    return { caminho: null, arquivo: null, origem: null }
  }
}

/**
 * Monta o perfil efetivo para um GGUF.
 * `override` = conteúdo de `modelo.json` (campos opcionais: familia,
 * templateChat, contextSize, thinkTag, suportaGramatica, classificacao,
 * conversa, systemPromptExtra, maxCandidatos).
 * Nunca lança; sempre devolve um perfil utilizável.
 */
function perfilParaModelo(nomeArquivo, override) {
  const o = override && typeof override === 'object' ? override : {}
  const familia = detectarFamilia(nomeArquivo, o.familia)
  const base = PERFIS_POR_FAMILIA[familia] || PERFIL_GENERICO
  const num = (v, fb, min, max) => {
    const n = Number(v)
    if (!Number.isFinite(n)) return fb
    return Math.max(min, Math.min(max, n))
  }
  const contextSize = num(o.contextSize, base.contextSize, 512, 131072)
  const classificacao = {
    maxTokens: num(o.classificacao && o.classificacao.maxTokens, base.classificacao.maxTokens, 1, 64),
    temperature: num(o.classificacao && o.classificacao.temperature, base.classificacao.temperature, 0, 2),
    topP: num(o.classificacao && o.classificacao.topP, base.classificacao.topP, 0, 1),
  }
  const convBase = base.conversa
  const convOver = o.conversa && typeof o.conversa === 'object' ? o.conversa : {}
  const conversa = {
    maxTokensPadrao: num(convOver.maxTokensPadrao, convBase.maxTokensPadrao, 64, 4096),
    maxTokensThink: num(convOver.maxTokensThink, convBase.maxTokensThink, 64, 8192),
    temperature: num(convOver.temperature, convBase.temperature, 0, 2),
    topP: num(convOver.topP, convBase.topP, 0, 1),
    topK: num(convOver.topK, convBase.topK, 1, 200),
    repeatPenalty: num(convOver.repeatPenalty, convBase.repeatPenalty, 1, 2),
  }
  return {
    familia,
    templateChat: typeof o.templateChat === 'string' && o.templateChat ? o.templateChat : base.templateChat,
    contextSize,
    thinkTag: o.thinkTag === null || typeof o.thinkTag === 'string' ? o.thinkTag : (base.thinkTag ?? null),
    suportaGramatica: o.suportaGramatica === false ? false : true,
    classificacao,
    conversa,
    maxCandidatos: num(o.maxCandidatos, 6, 2, 20),
    systemPromptExtra: typeof o.systemPromptExtra === 'string' ? o.systemPromptExtra.slice(0, 500) : '',
    arquivo: nomeArquivo || null,
  }
}

/**
 * Perfil efetivo para um diretório `recursos-ia/modelo/`.
 * Retorna `{ gguf: {caminho, arquivo, origem} | null, perfil }`.
 */
function perfilEfetivo(dirModelo) {
  const gguf = descobrirModelo(dirModelo)
  let override = {}
  try { override = lerManifesto(dirModelo) } catch (_) { override = {} }
  const perfil = perfilParaModelo(gguf.arquivo, override)
  return { gguf: gguf.caminho ? gguf : null, perfil }
}

// ---------------------------------------------------------------------------
// Prompts agnósticos (o sistema chama estes — nunca um template de um modelo)
// ---------------------------------------------------------------------------

function limparEnvoltorio(s, n) {
  return String(s || '').replace(/\s+/g, ' ').replace(/<[^>]*>/g, '').trim().slice(0, n)
}

/**
 * Prompt rígido de classificação: "escolha 1 entre N ou 0".
 * `fichas`: [{ codigo, nome, extra }] já resolvidas pelo chamador.
 */
function montarPromptClassificacao(descricao, fichas, maxCandidatos) {
  const n = Math.max(2, Math.min(20, Number(maxCandidatos) || 6))
  const produto = limparEnvoltorio(descricao, 140)
  const lista = (Array.isArray(fichas) ? fichas : []).slice(0, n).map((f, i) => {
    const nome = limparEnvoltorio(f.nome, 80)
    const extra = f.extra ? ` [${limparEnvoltorio(f.extra, 60)}]` : ''
    return `${i + 1}. ${f.codigo} — ${nome}${extra}`
  }).join('\n')
  return (
    'Você é um classificador fiscal brasileiro (Reforma Tributária, LC 214/2025). ' +
    'Escolha EXATAMENTE UM número da lista para o produto, ou 0 se nenhum servir. ' +
    'Responda apenas com o número, sem explicações.\n' +
    `Produto: "${produto}"\n` +
    `Opções:\n${lista}\n` +
    'Resposta (somente o número):'
  )
}

/**
 * Envelope de conversa por template. `perfil.templateChat` decide o formato;
 * conteúdo (sistema/histórico/pergunta) é idêntico em todos.
 */
function montarPromptConversa(perfil, sistema, historico, pergunta, think) {
  const p = perfil || PERFIL_GENERICO
  const sys = String(sistema ?? '').slice(0, 1800)
  const hist = (Array.isArray(historico) ? historico : []).slice(-6).map((m) => ({
    papel: m && m.papel === 'assistant' ? 'assistant' : 'user',
    texto: String((m && m.texto) || '').replace(/\s+/g, ' ').trim().slice(0, 500),
  })).filter((m) => m.texto)
  const perg = String(pergunta ?? '').replace(/\s+/g, ' ').trim().slice(0, 800)
  const tpl = String(p.templateChat || 'generico')

  if (tpl === 'llama3') {
    let s = `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n${sys}<|eot_id|>\n`
    for (const m of hist) s += `<|start_header_id|>${m.papel}<|end_header_id|>\n${m.texto}<|eot_id|>\n`
    s += `<|start_header_id|>user<|end_header_id|>\n${perg}<|eot_id|>\n<|start_header_id|>assistant<|end_header_id|>\n`
    return s
  }
  if (tpl === 'mistral') {
    let s = ''
    if (sys) s += `<s>[INST] ${sys} [/INST]</s>`
    for (const m of hist) {
      if (m.papel === 'user') s += `<s>[INST] ${m.texto} [/INST]`
      else s += `${m.texto}</s>`
    }
    s += `<s>[INST] ${perg} [/INST]`
    return s
  }
  if (tpl === 'phi' || tpl === 'gemma' || tpl === 'generico') {
    let s = sys ? `System: ${sys}\n` : ''
    for (const m of hist) s += `${m.papel === 'assistant' ? 'Assistant' : 'User'}: ${m.texto}\n`
    s += `User: ${perg}\nAssistant:`
    return s
  }
  // padrão: ChatML (qwen / qwen3)
  const thinkTag = think ? '' : '/no_think\n'
  const direto = think ? '' : 'Responda direto em português, sem mostrar raciocínio, sem inglês, sem marcadores.\n'
  let s = `<|im_start|>system\n${thinkTag}${direto}${sys}<|im_end|>\n`
  for (const m of hist) s += `<|im_start|>${m.papel}\n${m.texto}<|im_end|>\n`
  s += `<|im_start|>user\n${perg}<|im_end|>\n<|im_start|>assistant\n`
  return s
}

/** Stops de geração por template (o worker usa como `stopGenerationTriggers`). */
function stopsParaTemplate(perfil) {
  const tpl = String((perfil && perfil.templateChat) || 'generico')
  if (tpl === 'llama3') return ['<|eot_id|>', '<|start_header_id|>', '\n\n\n']
  if (tpl === 'mistral') return ['</s>', '[INST]', '\n\n\n']
  if (tpl === 'phi' || tpl === 'gemma' || tpl === 'generico') return ['\nUser:', '\nSystem:', '\n\n\n']
  return ['<|im_end|>', '<|im_start|>', '\n\n\n']
}

/**
 * Limpeza agnóstica de texto livre: remove thinking (qualquer tag), restos de
 * template de qualquer família, repetições e estouros. Calibrada para não
 * depender de um modelo específico.
 */
function limparTextoLivreGenerico(bruto) {
  let s = String(bruto ?? '')
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, ' ')
  s = s.replace(/<\/?think>/gi, ' ')
  s = s.replace(/<\|im_(start|end)\|>/g, ' ')
  s = s.replace(/\|im_end\|/g, ' ')
  s = s.replace(/<\|(begin_of_text|start_header_id|end_header_id|eot_id)\|>/g, ' ')
  s = s.replace(/\[\/?INST\]/g, ' ')
  s = s.replace(/<\/?s>/g, ' ')
  s = s.replace(/\b(system|user|assistant)\s*:/gi, ' ')
  const cortes = ['(End of', '[End of', '</code>', '<code>', 'Okay, the user', 'translates to', 'I need to', 'I should respond']
  for (const c of cortes) {
    const i = s.indexOf(c)
    if (i >= 0) s = s.slice(0, i)
  }
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  const frases = s.split(/(?<=[.!?])\s+/)
  const unicas = []
  for (const f of frases) {
    const t = f.trim()
    if (!t) continue
    if (unicas.length && unicas[unicas.length - 1].toLowerCase() === t.toLowerCase()) continue
    unicas.push(t)
    if (unicas.length >= 6) break
  }
  s = unicas.join(' ')
  const palavras = s.split(/\s+/).filter(Boolean)
  if (palavras.length > 30) {
    const assinatura = palavras.slice(0, 5).join(' ').toLowerCase()
    let rep = 0
    for (let i = 5; i + 5 <= palavras.length; i += 5) {
      if (palavras.slice(i, i + 5).join(' ').toLowerCase() === assinatura) rep += 1
    }
    if (rep >= 2) s = palavras.slice(0, 30).join(' ')
  }
  if (s.length > 1200) s = s.slice(0, 1200).trimEnd() + '…'
  return s.trim()
}

module.exports = {
  NOME_LEGADO,
  NOME_MANIFESTO,
  ENV_MODELO,
  PERFIL_GENERICO,
  detectarFamilia,
  lerManifesto,
  listarGgufs,
  descobrirModelo,
  perfilParaModelo,
  perfilEfetivo,
  montarPromptClassificacao,
  montarPromptConversa,
  stopsParaTemplate,
  limparTextoLivreGenerico,
}
