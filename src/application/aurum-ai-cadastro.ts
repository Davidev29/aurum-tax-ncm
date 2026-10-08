/**
 * Aurum AI — fluxos assistidos de CADASTRO (fine-tuning v4).
 *
 * Cobre dois pedidos do usuário:
 * 1. **CNPJ cadastrado?** ("o cnpj X tá cadastrado?") → verifica no banco
 *    local; se não está, PERGUNTA se quer cadastrar; só cadastra após
 *    confirmação explícita (ou comando direto "cadastra esse cnpj").
 * 2. **Cadastrar produto pela IA** → coleta os slots em turnos (empresa, SKU,
 *    nome, NCM + tributação antiga opcional CFOP/CST-ICMS/PIS/COFINS digitada
 *    pelo usuário), mostra conferência e SÓ GRAVA após "SIM PARA SALVAR".
 *    SKU existente abre segundo portão ("SIM ATUALIZAR").
 *
 * Regra de ouro (P3 — escrita assistida): nenhuma função aqui escreve sem que
 * o orquestrador tenha detectado confirmação explícita vinculada a uma oferta
 * pendente no histórico (`ofertaCadastroCnpjPendente`,
 * `resumoProdutoPendente`, `ofertaAtualizarSkuPendente`). "Sim" sozinho, sem
 * oferta anterior, nunca grava nada.
 *
 * Tudo que é decisão de texto é puro e testável; o I/O (SQLite/BrasilAPI) vai
 * em funções separadas com import dinâmico.
 */

import { norm } from '@/domain/services/format'
import { extrairMencaoEmpresa } from './aurum-ai-empresa'

function normBaixo(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/* ------------------------------------------------ confirmação / negação -- */

/**
 * "Sim" explícito — só vale como confirmação quando há oferta pendente no
 * histórico (o orquestrador verifica). Inclui formas diretas ("cadastra",
 * "salva") para botões do tipo "Sim, cadastra o CNPJ X".
 */
export function ehConfirmacao(texto: string): boolean {
  const n = normBaixo(texto).trim().replace(/[!.,;]+$/g, '').replace(/\s+/g, ' ')
  if (/^(simular|simulacao|simples)\b/.test(n)) return false
  return /^(sim|s|isso|isso mesmo|e isso|pode|pode sim|pode cadastrar|pode salvar|pode ser|confirma|confirmo|confirmado|confirmar|quero|quero sim|ok|beleza|fechado|fechar|bora|manda|manda ver|vai|vai em frente|salva|salva sim|cadastra|cadastra sim|sim cadastra|sim salva|sim confirma|autorizo|autorizado|de acordo|confirmo o cadastro|pode gravar|grava)\b/.test(n)
}

/** "Não" explícito — cancela a oferta pendente sem gravar nada. */
export function ehNegacao(texto: string): boolean {
  const n = normBaixo(texto).trim().replace(/\s+/g, ' ')
  return /^(nao|n|agora nao|deixa|deixa pra la|deixa quieto|cancela|cancelar|cancelado|melhor nao|ainda nao|depois|esquece|melhor deixar|dispenso|nao quero)\b/.test(n)
}

/* ------------------------------------------------------- fluxo CNPJ -- */

/** "O CNPJ X tá cadastrado / já existe / tá no sistema?" (puro). */
export function ehPerguntaCadastroCnpj(texto: string): boolean {
  const n = normBaixo(texto)
  return /cadastrad|registrad|ja (tem|existe|cadastrei|cadastrou)|t[aá] no sistema|est[aá] no sistema|existe no|consta|foi cadastrado|e cadastrado|esta cadastrado/.test(n)
}

/**
 * Comando direto de cadastro ("cadastra esse cnpj", "salva como cliente").
 * Comando direto JÁ É confirmação explícita — executa na hora.
 */
export function ehComandoCadastrarCnpj(texto: string): boolean {
  const n = normBaixo(texto)
  return /(cadastra|cadastrar|salva|salvar|grava|gravar).{0,40}(cnpj|empresa|cliente|emissor)/.test(n) ||
    /(salvar|salva|cadastrar|cadastra).{0,20}(essa|esta|como)/.test(n)
}

/**
 * Há oferta de cadastro de CNPJ aguardando resposta? (puro — varre o
 * histórico). Exige a frase de oferta da assistente; o CNPJ vem do contexto.
 */
export function ofertaCadastroCnpjPendente(historico: Array<{ papel: string; texto: string }>): boolean {
  const msgs = (historico ?? []).filter((m) => m.papel === 'assistant').slice(-3)
  return msgs.some((m) => {
    // Ignora o negrito markdown ("que eu **cadastre**") na comparação.
    const t = String(m.texto ?? '').replace(/\*/g, '')
    return /quer (que eu )?cadastre|posso cadastrar|deseja (que eu )?cadastre|confirm.*cadastr|quero cadastrar\?|cadastro (dela|dessa empresa)\?/i.test(t)
  })
}

/* ----------------------------------------------------- fluxo produto -- */

export interface RascunhoProduto {
  empresaTexto: string | null
  cnpjEmpresa: string | null
  sku: string | null
  nome: string | null
  ncm: string | null
  cfop: string | null
  cstIcms: string | null
  pis: string | null
  cofins: string | null
  quantidade: number | null
  valorUnitario: number | null
  pularTribAntiga: boolean
}

export const RASCUNHO_PRODUTO_VAZIO: RascunhoProduto = {
  empresaTexto: null,
  cnpjEmpresa: null,
  sku: null,
  nome: null,
  ncm: null,
  cfop: null,
  cstIcms: null,
  pis: null,
  cofins: null,
  quantidade: null,
  valorUnitario: null,
  pularTribAntiga: false,
}

function soDigitos(s: string): string {
  return String(s ?? '').replace(/\D+/g, '')
}

function parseMoedaBruta(s: string): number | null {
  const t = String(s ?? '').trim()
  if (!t) return null
  const limpo = t.replace(/[^\d.,]/g, '')
  if (!limpo) return null
  // "1.234,56" → 1234.56 · "1234,56" → 1234.56 · "10.50" → 10.50
  const v = limpo.includes(',')
    ? Number(limpo.replace(/\./g, '').replace(',', '.'))
    : Number(limpo)
  return Number.isFinite(v) && v >= 0 ? v : null
}

/**
 * Extrai os slots do rascunho a partir das falas do usuário (ordem
 * cronológica — a ÚLTIMA menção de cada slot vence, permitindo correção:
 * "na verdade o sku é Y"). Puro e testável.
 */
export function extrairRascunhoProduto(mensagensUsuario: string[]): RascunhoProduto {
  const r: RascunhoProduto = { ...RASCUNHO_PRODUTO_VAZIO }
  for (const cru of mensagensUsuario ?? []) {
    const texto = String(cru ?? '')
    if (!texto.trim()) continue
    // CNPJ da empresa (14 dígitos) — vale em qualquer turno do fluxo.
    const mask = texto.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/)
    if (mask) r.cnpjEmpresa = mask[0].replace(/\D+/g, '')
    else {
      for (const tok of texto.split(/[\s;,|]+/)) {
        if (soDigitos(tok).length === 14) { r.cnpjEmpresa = soDigitos(tok); break }
      }
    }
    const mencao = extrairMencaoEmpresa(texto)
    if (mencao && !/^(algum|alguma)\b/i.test(mencao)) r.empresaTexto = mencao
    // NCM: 8 dígitos (remove CNPJ antes para não fatiar os 14 dígitos).
    const semCnpj = texto.replace(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g, ' ').replace(/\b\d{14}\b/g, ' ')
    const m8 = semCnpj.match(/\b\d{8}\b/) ?? semCnpj.match(/\b\d{4}\.\d{2}\.\d{2}\b/)
    if (m8) r.ncm = m8[0].replace(/\D+/g, '')
    // Segmentos por vírgula/ponto-e-vírgula para mensagens multi-slot.
    const segs = texto.split(/[,;]+/)
    for (const seg of segs) {
      let m = seg.match(/(?:\bsku\b|c[óo]digo(?: do produto)?)(?:\s+é(?=\s|$))?\s*[:=\-–]?\s*([A-Za-z0-9._\-/]{1,30})/i)
      if (m?.[1] && !/^(do|da|de|e|o|a)\b/i.test(m[1])) r.sku = m[1].replace(/[.]+$/g, '').trim() || r.sku
      m = seg.match(/(?:\bnome\b(?: do produto)?)\s*[:=\-–]?\s*(.+)/i)
      if (m?.[1]) {
        const nome = m[1].trim()
          .replace(/^(agora |e |é |corrija para |corrige para |muda para |mude para |troca para |troque para )/i, '')
          .replace(/^["'“”‘’]+|["'“”‘’.]+$/g, '').trim()
        if (nome.length >= 2) r.nome = nome
      }
      m = seg.match(/\bcfop\b\D{0,6}([1-9]\d{3})/i)
      if (m?.[1]) r.cfop = m[1]
      m = seg.match(/\bpis\b\D{0,6}(\d{2})/i)
      if (m?.[1]) r.pis = m[1]
      m = seg.match(/\bcofins\b\D{0,6}(\d{2})/i)
      if (m?.[1]) r.cofins = m[1]
      m = seg.match(/(?:\bcst\b(?:\s*(?:do)?\s*icms)?|\bcsosn\b)\D{0,6}(\d{2,3})/i)
      if (m?.[1]) r.cstIcms = m[1]
      m = seg.match(/(?:\bqtd\b|\bquantidade\b)\D{0,6}([\d.,]+)/i)
      if (m?.[1]) {
        const q = parseMoedaBruta(m[1])
        if (q != null) r.quantidade = q
      }
      m = seg.match(/(?:r\$\s*([\d.,]+)|\bvalor\b(?: unit[aá]rio)?\D{0,6}([\d.,]+))/i)
      if (m?.[1] ?? m?.[2]) {
        const v = parseMoedaBruta(m[1] ?? m[2])
        if (v != null) r.valorUnitario = v
      }
    }
    if (/^(pular|pula|sem|nenhum|nenhuma|n[aã]o tem|deixa em branco|nao precisa)\b/i.test(texto.trim())) r.pularTribAntiga = true
  }
  return r
}

/** Slots obrigatórios ainda vazios (ordem de pergunta). */
export function faltantesObrigatorios(r: RascunhoProduto): Array<'empresa' | 'sku' | 'nome' | 'ncm'> {
  const f: Array<'empresa' | 'sku' | 'nome' | 'ncm'> = []
  if (!r.empresaTexto && !r.cnpjEmpresa) f.push('empresa')
  if (!r.sku) f.push('sku')
  if (!r.nome) f.push('nome')
  if (!r.ncm) f.push('ncm')
  return f
}

/** Tributação antiga informada? (qualquer campo). */
export function temTribAntiga(r: RascunhoProduto): boolean {
  return !!(r.cfop || r.cstIcms || r.pis || r.cofins)
}

/** Avisos de validação da tributação antiga digitada (não bloqueiam). */
export function validarTribAntiga(r: RascunhoProduto): string[] {
  const avisos: string[] = []
  if (r.cfop && !/^[1-9]\d{3}$/.test(r.cfop)) avisos.push(`CFOP "${r.cfop}" fora do padrão (4 dígitos, ex.: 5102).`)
  if (r.cstIcms && !/^\d{2,3}$/.test(r.cstIcms)) avisos.push(`CST do ICMS "${r.cstIcms}" fora do padrão (2–3 dígitos, ex.: 00).`)
  if (r.pis && !/^\d{2}$/.test(r.pis)) avisos.push(`PIS "${r.pis}" fora do padrão (2 dígitos, ex.: 01).`)
  if (r.cofins && !/^\d{2}$/.test(r.cofins)) avisos.push(`COFINS "${r.cofins}" fora do padrão (2 dígitos, ex.: 01).`)
  return avisos
}

/**
 * Última mensagem da assistente foi a conferência de um rascunho? Retorna o
 * SKU conferido (ou null). É o portão da gravação: sem resumo anterior com o
 * MESMO SKU, "sim" não grava.
 */
export function resumoProdutoPendente(historico: Array<{ papel: string; texto: string }>): string | null {
  const msgs = (historico ?? []).filter((m) => m.papel === 'assistant')
  const ultima = msgs[msgs.length - 1]
  if (!ultima) return null
  const m = ultima.texto.match(/Confirma o cadastro\?[\s\S]{0,800}SKU ([A-Za-z0-9._\-/]{1,30})/i)
  return m?.[1] ?? null
}

/**
 * Última mensagem da assistente foi o portão de SOBRESCRITA de SKU? Retorna
 * o SKU (ou null). Segundo portão: "SIM ATUALIZAR" só vale após esta oferta.
 */
export function ofertaAtualizarSkuPendente(historico: Array<{ papel: string; texto: string }>): string | null {
  const msgs = (historico ?? []).filter((m) => m.papel === 'assistant')
  const ultima = msgs[msgs.length - 1]
  if (!ultima) return null
  const m = ultima.texto.match(/ATUALIZAR o SKU ([A-Za-z0-9._\-/]{1,30})/i)
  return m?.[1] ?? null
}

/**
 * Fluxo de cadastro em andamento? (puro) — a última fala da assistente pediu
 * slot, conferência ou atualização. Usado pelo refino para manter "08031000"
 * (só dígitos) dentro do fluxo em vez de rotear a NCM.
 */
export function fluxoCadastroEmAndamento(historico: Array<{ papel: string; texto: string }>): boolean {
  const msgs = (historico ?? []).filter((m) => m.papel === 'assistant')
  const ultima = msgs[msgs.length - 1]
  if (!ultima) return false
  return /Falta:|Confirma o cadastro\?|ATUALIZAR o SKU|tributação antiga|Vamos cadastrar|cadastrar o produto|Qual (o|a) (empresa|sku|nome|ncm)/i.test(ultima.texto)
}

/**
 * Qual slot a assistente pediu por último? ("Falta o **SKU**", "Qual o NCM").
 * Permite aceitar resposta curta sem rótulo ("Pão Dourado", "QM-01").
 */
export function slotPedidoPendente(historico: Array<{ papel: string; texto: string }>): 'empresa' | 'sku' | 'nome' | 'ncm' | null {
  const msgs = (historico ?? []).filter((m) => m.papel === 'assistant')
  const ultima = msgs[msgs.length - 1]
  if (!ultima) return null
  const m = ultima.texto.match(/Falta (?:a|o) \*\*(empresa|SKU|nome|NCM)\*\*|Qual (?:o|a) (empresa|sku|nome|ncm)/i)
  const slot = (m?.[1] ?? m?.[2] ?? '').toLowerCase()
  if (slot === 'empresa') return 'empresa'
  if (slot === 'sku') return 'sku'
  if (slot === 'nome') return 'nome'
  if (slot === 'ncm') return 'ncm'
  return null
}

/**
 * Escolha de empresa em lista numerada ("Encontrei **2 empresas**... 1. X").
 * Retorna o rótulo escolhido ou null. Puro.
 */
export function resolverEscolhaLista(historico: Array<{ papel: string; texto: string }>, resposta: string): string | null {
  const msgs = (historico ?? []).filter((m) => m.papel === 'assistant')
  const ultima = msgs[msgs.length - 1]
  if (!ultima || !/Encontrei \*\*\d+ empresas\*\*/i.test(ultima.texto)) return null
  const opcoes = [...ultima.texto.matchAll(/^\d+\.\s+\*\*(.+?)\*\*/gm)].map((m) => m[1].trim())
  if (!opcoes.length) return null
  const n = normBaixo(resposta).trim()
  const mNum = n.match(/^(?:o|a)?\s*(\d{1,2})\b|^(primeir|segund|terceir|quart|quint)[oa]/)
  if (mNum) {
    const idx = mNum[1] ? Number(mNum[1]) - 1 : ['primeir', 'segund', 'terceir', 'quart', 'quint'].indexOf(mNum[2])
    if (idx >= 0 && idx < opcoes.length) return opcoes[idx]
  }
  const achada = opcoes.find((o) => normBaixo(o).includes(n) || (n.length >= 3 && normBaixo(o).split(/\s+/).some((t) => t.startsWith(n))))
  return achada ?? null
}

/* ------------------------------------------------------------------ I/O -- */

export async function verificarEmpresaPorCnpj(cnpj14: string): Promise<import('@/domain/entities').Empresa | null> {
  const { buscarEmpresaPorCnpj } = await import('./empresas')
  return buscarEmpresaPorCnpj(cnpj14)
}

export async function executarCadastroCnpjAssistido(cnpj14: string): Promise<import('./empresas').ResultadoEmpresa> {
  const { cadastrarEmpresaPorCnpj } = await import('./empresas')
  return cadastrarEmpresaPorCnpj(cnpj14)
}

export interface EntradaProdutoPronta {
  entrada: import('./produtos').EntradaProduto
  descricaoNcm: string
}

/**
 * Monta a entrada de produto a partir do rascunho confirmado: resolve o NCM
 * no motor (1º vínculo vigente) e embute a tributação antiga digitada.
 * Retorna `erro` quando o NCM não tem lastro (sem chute).
 */
export async function montarEntradaProduto(
  r: RascunhoProduto,
  empresaId: number | null,
): Promise<{ ok: true; pronta: EntradaProdutoPronta } | { ok: false; erro: string }> {
  if (!r.sku || !r.nome || !r.ncm) return { ok: false, erro: 'Faltam SKU, nome ou NCM.' }
  if (norm(r.ncm).length !== 8) return { ok: false, erro: `NCM "${r.ncm}" precisa de 8 dígitos.` }
  const { resolverClassificacoes } = await import('@/infrastructure/base/classificacao-repo')
  let resolvido
  try {
    resolvido = await resolverClassificacoes(norm(r.ncm))
  } catch {
    return { ok: false, erro: 'Não consegui validar o NCM na base agora. Tente de novo.' }
  }
  if (!resolvido.lista.length || !resolvido.nomenclatura) {
    return { ok: false, erro: `NCM ${norm(r.ncm)} sem lastro na base vigente — confira os 8 dígitos na Consulta NCM.` }
  }
  const cl = resolvido.lista[0]
  const descricaoNcm = String(resolvido.nomenclatura.descricao ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
  return {
    ok: true,
    pronta: {
      descricaoNcm,
      entrada: {
        empresaId,
        codigo: r.sku.trim(),
        nome: r.nome.trim(),
        ncm: norm(r.ncm),
        cfop: r.cfop ?? '',
        cstIcms: r.cstIcms ?? '',
        pis: r.pis ?? '',
        cofins: r.cofins ?? '',
        quantidade: r.quantidade ?? 0,
        valorUnitario: r.valorUnitario ?? 0,
        classificacao: cl,
      },
    },
  }
}

export async function executarCadastroProdutoAssistido(
  entrada: import('./produtos').EntradaProduto,
  forcar: boolean,
): Promise<import('./produtos').ResultadoSalvar> {
  const { salvarProduto } = await import('./produtos')
  return salvarProduto(entrada, { forcar })
}

export async function skuJaExiste(empresaId: number | null, sku: string): Promise<boolean> {
  const { produtoPorSku } = await import('./produtos')
  return (await produtoPorSku(empresaId, sku)) != null
}
