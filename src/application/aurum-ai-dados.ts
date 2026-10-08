/**
 * Aurum AI — camada de DADOS (clientes ↔ XML, vice-versa).
 *
 * A IA antes só conhecia NCM/NBS/CNPJ-BrasilAPI. Este módulo dá a ela
 * leitura real do banco local (SQLite), sempre READ-ONLY:
 * - `extrairFiltrosDados` (puro): entende a pergunta em PT livre e extrai
 *   cliente, fornecedor, produto, NCM, CFOP, CST, cClassTrib, redução, anexo,
 *   direção (compra/venda), período e flags (diferido, só-Simples).
 * - `listarClientesComMovimento` / `notasDoEscopo` (I/O): resolvem
 *   empresa ↔ notas nos dois sentidos ( cliente → XMLs, XML/fornecedor → dono).
 * - Agregações puras sobre `NotaXml[]`: fornecedores por crédito, produtos
 *   por débito/crédito, reduções encontradas, diferidos, NCM com CST/cClassTrib,
 *   CFOP, apuração. Todo número exibido no chat vem daqui (motor), a IA só
 *   formata — P1 Determinismo mantido.
 *
 * Guardrails: nunca escreve, nunca inventa número, vazio vira orientação
 * (cadastrar empresa / importar XML) em vez de chute.
 */

import { norm } from '@/domain/services/format'
import { ehDiferimento, ehDiferimentoCondicionalAnexoIX } from '@/domain/services/calculo'
import type { NotaXml } from '@/infrastructure/nfe/tipos'

/* ---------------------------------------------------------- filtros -- */

export type DirecaoDados = 'todas' | 'entrada' | 'saida'

export interface PeriodoDados {
  inicio: string | null
  fim: string | null
  rotulo: string | null
}

export interface FiltroDados {
  clienteTexto: string | null
  cnpj: string | null
  fornecedor: string | null
  produto: string | null
  ncm: string | null
  cfop: string | null
  cstIcms: string | null
  cstReforma: string | null
  cClassTrib: string | null
  reducao: string | null
  anexo: string | null
  direcao: DirecaoDados
  periodo: PeriodoDados
  soDiferidos: boolean
  soSimples: boolean
  topN: number
}

export const FILTRO_DADOS_VAZIO: FiltroDados = {
  clienteTexto: null,
  cnpj: null,
  fornecedor: null,
  produto: null,
  ncm: null,
  cfop: null,
  cstIcms: null,
  cstReforma: null,
  cClassTrib: null,
  reducao: null,
  anexo: null,
  direcao: 'todas',
  periodo: { inicio: null, fim: null, rotulo: null },
  soDiferidos: false,
  soSimples: false,
  topN: 8,
}

function normBaixo(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

function soDigitos(s: string): string {
  return String(s ?? '').replace(/\D+/g, '')
}

/**
 * Extrai filtros de uma pergunta em PT livre. Puro e testável.
 * Exemplos:
 * - "qual fornecedor tá me dando mais crédito?" → { direcao: entrada }
 * - "qual produto tá gerando mais débito?" → { direcao: saida }
 * - "existe algum produto diferido?" → { soDiferidos: true }
 * - "quais produtos têm redução?" → intenção de agregação por redução
 * - "do cliente Padaria Pão Dourado" → { clienteTexto }
 * - "do fornecedor ACME" → { fornecedor }
 * - "NCM 02011000" → { ncm }
 * - "CFOP 5102" → { cfop }
 * - "em janeiro/2026" / "de 01/01/2026 a 31/03/2026" → { periodo }
 */
export function extrairFiltrosDados(pergunta: string): FiltroDados {
  const cru = String(pergunta ?? '')
  const n = normBaixo(cru)
  const f: FiltroDados = {
    ...FILTRO_DADOS_VAZIO,
    periodo: { inicio: null, fim: null, rotulo: null },
  }

  // CNPJ (14 dígitos) — pode ser cliente ou fornecedor; o escopo resolve.
  const mCnpjMask = cru.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/)
  if (mCnpjMask) f.cnpj = mCnpjMask[0].replace(/\D+/g, '')
  else {
    const todos = soDigitos(cru)
    if (todos.length === 14) f.cnpj = todos
    else {
      for (const tok of cru.split(/[\s;,|]+/)) {
        if (soDigitos(tok).length === 14) {
          f.cnpj = soDigitos(tok)
          break
        }
      }
    }
  }

  // NCM 8 dígitos (direto ou formatado 0000.00.00).
  const m8 = cru.match(/\b\d{8}\b/) ?? cru.match(/\b\d{4}\.\d{2}\.\d{2}\b/)
  if (m8) f.ncm = m8[0].replace(/\D+/g, '')
  // cClassTrib 6 dígitos explícito ("cclasstrib 000001", "cct 200003").
  const mCct = n.match(/(?:cclasstrib|cct|classe)\D{0,12}(\d{6})/)
  if (mCct) f.cClassTrib = mCct[1]
  // CST da Reforma 3 dígitos ("cst 000", "cst 200", "cst 510").
  const mCstRef = n.match(/\bcst\D{0,6}(\d{3})/)
  if (mCstRef) f.cstReforma = mCstRef[1]
  // CFOP 4 dígitos ("cfop 5102").
  const mCfop = cru.match(/\b[1-9]\d{3}\b/)
  if (mCfop && /cfop/i.test(cru)) f.cfop = mCfop[0]
  // CST/CSOSN ICMS ("cst 00", "csosn 102") — só quando fala de ICMS/antigo.
  const mIcms = n.match(/(?:cst\s*(?:do\s*)?icms|csosn)\D{0,6}(\d{2,3})/)
  if (mIcms) f.cstIcms = mIcms[1]

  // Direção: compra/entrada = crédito · venda/saída = débito.
  if (/compr[ao]|entrada|fornecedor|credito|apropri|comprou/.test(n)) f.direcao = 'entrada'
  if (/vend[ai]|saida|faturei|debito|vendi/.test(n)) {
    f.direcao = /compr|entrada|fornecedor|credito/.test(n) ? 'todas' : 'saida'
  }
  if (/compra e venda|entradas e saidas|tudo|geral|movimento/.test(n)) f.direcao = 'todas'

  // Flags.
  if (/diferid|diferimento/.test(n)) f.soDiferidos = true
  if (/simples|mei/.test(n) && /comprou|compra|fornecedor|bloque|sem credito/.test(n)) f.soSimples = true

  // Redução ("redução de 60%", "red 60", "isento", "sem redução").
  const mRed = n.match(/redu(?:cao|cao|toria)?\D{0,10}(\d{1,3})\s*%?/)
  if (mRed) f.reducao = mRed[1]
  else if (/isento|isencao|imune|nao tributad/.test(n)) f.reducao = 'isento'
  else if (/sem reducao|aliquota cheia|integral/.test(n)) f.reducao = '0'

  // Anexo LC 214 ("anexo 5", "anexo ix", "cesta básica").
  const mAnexo = n.match(/anexo\D{0,6}(\d{1,2}|ix|xi)/)
  if (mAnexo) {
    const v = mAnexo[1]
    f.anexo = v === 'ix' ? '9' : v === 'xi' ? '11' : v
  } else if (/cesta basic/.test(n)) f.anexo = 'cesta'

  // Fornecedor explícito ("fornecedor X", "da loja Y", "da empresa Z").
  const mForn =
    cru.match(/fornecedor(?:a|es)?\s+(?:de\s+|da\s+|do\s+)?([^,.;?]{2,60})/i) ??
    cru.match(/(?:da|de|do)\s+(?:loja|empresa|distribuidora|atacado)\s+([^,.;?]{2,60})/i)
  if (mForn?.[1]) {
    const nome = mForn[1].trim().replace(/\s+(me|pra|para|em|no|na|de|do|da)\b.*$/i, '').trim()
    if (nome.length >= 2 && !/^(mais|maior|menor|melhor|que|qual|quais|desse|deste|dessa|desta|disso|dele|dela|nesse|neste)\b/i.test(nome)) f.fornecedor = nome
  }

  // Cliente explícito ("cliente X", "da Padaria Y", "empresa Z").
  // Cuidado: "de algum cliente" (genérico, sem nome) NÃO é filtro.
  // Fine-tuning v3: aspas ("da empresa "Pão Dourado"") e "empresa X"
  // minúscula também ancoram — a empresa dita o escopo antes do produto.
  const aspasTodas = [...cru.matchAll(/["'“”‘’]([^"'“”‘’]{2,60})["'“”‘’]/g)].map((m) => m[1].trim()).filter(Boolean)
  const mCli = cru.match(/clientes?\s+(?:de\s+|da\s+|do\s+)?([^,.;?]{2,60})/i)
  if (mCli?.[1]) {
    const nome = mCli[1].trim()
    if (nome.length >= 3 && !/^(algum|alguma|alguns|todos|todos os|meus|desse|deste|dessa|desta|disso|dele|dela|nesse|neste)\b/i.test(nome.trim())) {
      f.clienteTexto = nome.replace(/\s+(tem|possui|com|e|que)\b.*$/i, '').trim() || null
    }
  }
  if (!f.clienteTexto) {
    const mEmp = cru.match(/(?:empresa|cliente|companhia|loja)\s+(?:de\s+|da\s+|do\s+|chamad[ao]\s+)?([^,.;?]{2,60})/i)
    if (mEmp?.[1]) {
      const nome = mEmp[1].trim().replace(/\s+(tem|possui|com|e|que|para)\b.*$/i, '').trim()
      if (nome.length >= 2 && !/^(algum|alguma|todos|meus|desse|deste)\b/i.test(nome)) f.clienteTexto = nome
    }
  }
  if (!f.clienteTexto && aspasTodas.length) {
    // Última aspa = empresa ("o queijo "Minas" da "Padaria Y"" → empresa Y);
    // com 1 aspa + "empresa/cliente/da" na frase, a aspa é a empresa.
    const comLastroEmpresa = /empresa|cliente|da |de |do |desse cliente|dessa empresa/i.test(cru)
    const cand = aspasTodas[aspasTodas.length - 1]
    if (cand && comLastroEmpresa && !/^(algum|alguma|todos|meus|desse|deste)\b/i.test(cand)) f.clienteTexto = cand
  }
  if (!f.clienteTexto) {
    // "da/do/na/no <Nome Próprio>" ("produtos da Padaria Pão Dourado") — exige
    // maiúscula ou 2+ tokens para "da receita"/"do mês" não virarem empresa.
    const mNome = cru.match(/\b(?:da|de|do|na|no)\s+([A-ZÀ-Ú][A-Za-zÀ-ú0-9&'.\-]{1,30}(?:\s+[A-ZÀ-Úa-zà-ú0-9&'.\-]{2,30}){0,4})/)
    if (mNome?.[1]) {
      const nome = mNome[1].trim()
      if (nome.length >= 3 && !/^(receita|receitas|folha|rbt|anexo|das|simples|conversa|calculo|nota|notas|xml|lei|artigo|art|tabela|mes|ano|periodo|cliente|empresa)\b/i.test(nome)) f.clienteTexto = nome
    }
  }

  // Produto explícito ("produto X", "queijo minas").
  // Fine-tuning v3: "o <produto> da <Empresa>" e aspas de produto ("queijo "Minas"").
  const mProd = cru.match(/produtos?\s+(?:de\s+|da\s+|do\s+|chamad[ao]\s+)?([^,.;?]{2,60})/i)
  if (mProd?.[1]) {
    const nome = mProd[1].trim().split(/\s+(da|de|do|desse|desta)\b/i)[0].trim()
    if (nome.length >= 2 && !/^(diferido|diferidos|com reducao|que|qual|quais|mais|menos|top|ranking|lista|desse|deste|dessa|desta|disso|dele|dela|nesse|neste|vendidos?|comprados?)\b/i.test(nome)) f.produto = nome
  }
  if (!f.produto) {
    if (aspasTodas.length >= 2) {
      // 2+ aspas: primeira = produto, última = empresa (já capturada acima).
      const cand = aspasTodas[0]
      if (cand && (!f.clienteTexto || normBaixo(cand) !== normBaixo(f.clienteTexto))) f.produto = cand
    } else {
      const mAntes = cru.match(/(?:o|a|os|as|esse|essa|este|esta)\s+([^,.;?]{2,50})\s+(?:da|de|do)\s+/i)
      if (mAntes?.[1]) {
        const cand = mAntes[1].trim()
        if (cand.length >= 3 && !/^(cliente|empresa|fornecedor|produto|calculo|valor|imposto|nota|xml)\b/i.test(cand)) f.produto = cand
      }
    }
  }

  // Período: intervalo explícito dd/mm/aaaa, mês/ano, ou ano.
  const mIntervalo = cru.match(/(\d{2}\/\d{2}\/\d{4})\s*(?:a|até|ate|-)\s*(\d{2}\/\d{2}\/\d{4})/)
  if (mIntervalo) {
    const iso = (br: string): string => {
      const [d, m, a] = br.split('/')
      return `${a}-${m}-${d}`
    }
    f.periodo = { inicio: iso(mIntervalo[1]), fim: iso(mIntervalo[2]), rotulo: `${mIntervalo[1]} a ${mIntervalo[2]}` }
  } else {
    const mMesAno = n.match(/(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*(?:de\s*)?(\d{4})/)
    if (mMesAno) {
      const meses: Record<string, string> = {
        janeiro: '01', fevereiro: '02', marco: '03', abril: '04', maio: '05', junho: '06',
        julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12',
      }
      const mm = meses[mMesAno[1]] ?? '01'
      const aa = mMesAno[2]
      const ultimo = new Date(Number(aa), Number(mm), 0).getDate()
      f.periodo = { inicio: `${aa}-${mm}-01`, fim: `${aa}-${mm}-${String(ultimo).padStart(2, '0')}`, rotulo: `${mMesAno[1]}/${aa}` }
    } else {
      const mAno = cru.match(/\b(20\d{2})\b/)
      if (mAno && /(em|de|ano|exercicio|periodo)/i.test(cru)) {
        f.periodo = { inicio: `${mAno[1]}-01-01`, fim: `${mAno[1]}-12-31`, rotulo: mAno[1] }
      }
    }
  }

  // Top N ("top 5", "top 10").

  const mTop = n.match(/top\s*(\d{1,2})/)
  if (mTop) f.topN = Math.min(20, Math.max(3, Number(mTop[1])))

  return f
}

/**
 * Anáfora ao escopo ("desse cliente", "disso", "nesse recorte")? Puro.
 * Quando true e o filtro atual veio vazio, o orquestrador herda o filtro
 * anterior (ver `mesclarFiltrosComContexto`) em vez de zerar o recorte.
 */
export function temAnaforaFiltro(pergunta: string): boolean {
  const n = String(pergunta ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
  return /\bdesse\b|\bdesta\b|\bdeste\b|\bdessa\b|\bdisso\b|\bdele\b|\bdela\b|\bnisso\b|\bnesse\b|\bneste\b|\bnessa\b|\bnesta\b|\bdesse cliente\b|\bdeste cliente\b|\bdessa empresa\b|\bdesse fornecedor\b|\bdesse produto\b/.test(n)
}

/**
 * Herança de escopo: follow-up curto com anáfora ("e desse cliente?",
 * "só as entradas", "top 5 disso") herda cliente/CNPJ/fornecedor/período
 * do filtro anterior; o que a frase atual diz VENCE (direção e topN novos
 * sobrescrevem, nunca somem). Puro e testável.
 */
export function mesclarFiltrosComContexto(atual: FiltroDados, anterior: FiltroDados | null): FiltroDados {
  if (!anterior) return atual
  const herdouAlgo =
    atual.clienteTexto == null ||
    atual.cnpj == null ||
    atual.fornecedor == null ||
    (atual.periodo.inicio == null && anterior.periodo.inicio != null)
  if (!herdouAlgo) return atual
  return {
    ...atual,
    clienteTexto: atual.clienteTexto ?? anterior.clienteTexto,
    cnpj: atual.cnpj ?? anterior.cnpj,
    fornecedor: atual.fornecedor ?? anterior.fornecedor,
    produto: atual.produto ?? null,
    periodo: atual.periodo.inicio || atual.periodo.fim ? atual.periodo : anterior.periodo,
  }
}

/** Descreve os filtros ativos em 1 linha (para o chat citar o recorte). */
export function rotuloFiltros(f: FiltroDados): string {
  const partes: string[] = []
  if (f.clienteTexto) partes.push(`cliente "${f.clienteTexto}"`)
  if (f.cnpj) partes.push(`CNPJ ${f.cnpj}`)
  if (f.fornecedor) partes.push(`fornecedor "${f.fornecedor}"`)
  if (f.produto) partes.push(`produto "${f.produto}"`)
  if (f.ncm) partes.push(`NCM ${f.ncm}`)
  if (f.cfop) partes.push(`CFOP ${f.cfop}`)
  if (f.cstReforma) partes.push(`CST ${f.cstReforma}`)
  if (f.cClassTrib) partes.push(`cClassTrib ${f.cClassTrib}`)
  if (f.cstIcms) partes.push(`CST-ICMS ${f.cstIcms}`)
  if (f.reducao) partes.push(`redução ${f.reducao}%`)
  if (f.anexo) partes.push(`anexo ${f.anexo}`)
  if (f.direcao !== 'todas') partes.push(f.direcao === 'entrada' ? 'compras (entradas)' : 'vendas (saídas)')
  if (f.periodo.rotulo) partes.push(`período ${f.periodo.rotulo}`)
  if (f.soDiferidos) partes.push('só diferidos')
  if (f.soSimples) partes.push('só Simples/MEI')
  return partes.length ? partes.join(' · ') : 'todo o movimento'
}

/** Todos os filtros que a IA entende (para "quais filtros posso usar?"). */
export const FILTROS_SUPORTADOS = [
  'cliente (nome ou CNPJ — ex.: "do cliente Padaria Pão Dourado")',
  'fornecedor (nome ou CNPJ — ex.: "do fornecedor ACME")',
  'produto (nome ou código — ex.: "produto queijo minas")',
  'NCM (8 dígitos — ex.: "NCM 02011000")',
  'CFOP (4 dígitos — ex.: "CFOP 5102")',
  'CST da Reforma (3 dígitos — ex.: "CST 510") + cClassTrib (6 dígitos)',
  'CST/CSOSN do ICMS (regime antigo)',
  'redução IBS/CBS (ex.: "redução de 60%", "isento") + anexo LC 214',
  'direção: compras/entradas (crédito) × vendas/saídas (débito)',
  'período (ex.: "em janeiro/2026", "de 01/01/2026 a 31/03/2026")',
  'diferimento ("existe algum produto diferido?") + Simples/MEI ("comprou de Simples?")',
  'top N ("top 5 fornecedores")',
] as const

/* --------------------------------------------------------------- I/O -- */

export interface ResumoCliente {
  id: number | null
  razaoSocial: string
  fantasia: string
  cnpj: string
  uf: string
  qtdNotas: number
  base: number
  trib: number
}

function empresaAtivaId(): number | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const { SESSION_KEY } = { SESSION_KEY: 'aurum_empresa_ativa_id' }
    const v = localStorage.getItem(SESSION_KEY) ?? localStorage.getItem('aurum_empresa_ativa_id')
    const id = v != null ? Number(v) : NaN
    return Number.isFinite(id) ? id : null
  } catch {
    return null
  }
}

/**
 * Clientes cadastrados + movimento real (qtd notas, base, tributos).
 * Ordenado por base desc. Best-effort: sem banco → lista vazia.
 */
export async function listarClientesComMovimento(): Promise<ResumoCliente[]> {
  try {
    const { db } = await import('@/infrastructure/db/schema')
    const empresas = await db.empresas.toArray()
    const out: ResumoCliente[] = []
    for (const e of empresas) {
      if (e.id == null) continue
      const notas = (await db.nfeNotas.where('empresaId').equals(e.id).toArray()) as NotaXml[]
      let base = 0
      let trib = 0
      for (const n of notas) {
        base += Number(n?.valorTotal) || 0
        trib += Number(n?.totalTributos) || 0
      }
      out.push({
        id: e.id,
        razaoSocial: e.razaoSocial || '(sem razão social)',
        fantasia: e.fantasia || '',
        cnpj: e.cnpj || '',
        uf: e.uf || '',
        qtdNotas: notas.length,
        base: Math.round(base * 100) / 100,
        trib: Math.round(trib * 100) / 100,
      })
    }
    return out.sort((a, b) => b.base - a.base)
  } catch {
    return []
  }
}

export interface EscopoDados {
  empresaIds: number[]
  empresaNomes: string[]
  notas: NotaXml[]
  totalClientes: number
  clienteAlvo: string | null
}

/**
 * Resolve o escopo empresa ↔ notas nos dois sentidos:
 * - filtro com cliente/CNPJ → só as empresas que casam (nome contém ou CNPJ igual);
 * - sem filtro de cliente → empresa ativa (se houver) ou TODAS (visão geral);
 * - aplica período + dirección + item-level (fornecedor, produto, NCM, CFOP,
 *   CST, cClassTrib, redução, anexo, diferido) em memória.
 */
export async function notasDoEscopo(filtro: FiltroDados): Promise<EscopoDados> {
  const { db } = await import('@/infrastructure/db/schema')
  const empresas = await db.empresas.toArray()
  const normAlvo = norm(filtro.clienteTexto ?? '')
  const cnpjAlvo = (filtro.cnpj ?? '').replace(/\D+/g, '')
  let alvos = empresas.filter((e) => e.id != null)

  if (cnpjAlvo) {
    const porCnpj = alvos.filter((e) => norm(e.cnpj) === cnpjAlvo)
    if (porCnpj.length) alvos = porCnpj
  } else if (normAlvo.length >= 3) {
    const porNome = alvos.filter(
      (e) =>
        norm(e.razaoSocial ?? '').includes(normAlvo) ||
        norm(e.fantasia ?? '').includes(normAlvo) ||
        norm(e.cnpj ?? '').includes(normAlvo.replace(/\D+/g, '')),
    )
    if (porNome.length) alvos = porNome
    else {
      // Não casou com cliente: pode ser fornecedor — mantém todas e filtra item.
      alvos = empresas.filter((e) => e.id != null)
    }
  } else {
    const ativa = empresaAtivaId()
    if (ativa != null && alvos.some((e) => e.id === ativa)) alvos = alvos.filter((e) => e.id === ativa)
  }

  const ids = alvos.map((e) => e.id as number)
  let notas: NotaXml[] = []
  for (const id of ids) {
    try {
      const lote = (await db.nfeNotas.where('empresaId').equals(id).toArray()) as NotaXml[]
      notas.push(...lote)
    } catch {
      /* empresa sem notas */
    }
  }

  // Período + direção (nível nota).
  const { inicio, fim } = filtro.periodo
  notas = notas.filter((n) => {
    if (inicio && String(n?.dataEmissao ?? '') < inicio) return false
    if (fim && String(n?.dataEmissao ?? '') > fim) return false
    if (filtro.direcao !== 'todas' && n?.direcao !== filtro.direcao) return false
    return true
  })

  // Nível item: precisa de PELO MENOS 1 item casando (nota entra, itens filtrados na agregação).
  const temFiltroItem =
    filtro.fornecedor || filtro.produto || filtro.ncm || filtro.cfop || filtro.cstIcms ||
    filtro.cstReforma || filtro.cClassTrib || filtro.reducao || filtro.anexo || filtro.soDiferidos || filtro.soSimples
  if (temFiltroItem) {
    notas = notas.filter((n) => itensCasam(n, filtro).length > 0)
  }

  return {
    empresaIds: ids,
    empresaNomes: alvos.map((e) => e.razaoSocial || e.fantasia || e.cnpj || `empresa ${e.id}`),
    notas,
    totalClientes: empresas.length,
    clienteAlvo: filtro.clienteTexto ?? (filtro.cnpj ? `CNPJ ${filtro.cnpj}` : null),
  }
}

/** Itens da nota que casam com o filtro (usado no filtro + agregações). */
export function itensCasam(nota: NotaXml, f: FiltroDados): NotaXml['itensAnalisados'] {
  const itens = nota?.itensAnalisados ?? []
  const forn = norm(f.fornecedor ?? '')
  const prod = norm(f.produto ?? '')
  return itens.filter((it) => {
    if (forn && !norm(`${nota.emitNome ?? ''} ${nota.emitCnpj ?? ''}`).includes(forn)) return false
    if (f.soSimples) {
      const crt = String(nota.emitCrt ?? '')
      const simples = crt === '1' || crt === '2' || crt === '4' || /^[1259]\d\d$/.test(String(it.cstIcms ?? ''))
      if (!simples) return false
    }
    if (prod && !norm(`${it.descricao ?? ''} ${it.codProd ?? ''}`).includes(prod)) return false
    if (f.ncm && norm(it.ncm ?? '') !== norm(f.ncm)) return false
    if (f.cfop && String(it.cfop ?? '').trim() !== f.cfop) return false
    if (f.cstIcms && String(it.cstIcms ?? '').trim().toUpperCase() !== f.cstIcms.toUpperCase()) return false
    if (f.cstReforma) {
      const doXml = String(it.cstIbsCbs ?? '').trim()
      const doSis = String(it.classificacao?.cst ?? '').trim()
      if (doXml !== f.cstReforma && doSis !== f.cstReforma) return false
    }
    if (f.cClassTrib) {
      const doXml = String(it.cClassTribIbsCbs ?? '')
      const doSis = String(it.classificacao?.cClassTrib ?? '')
      if (!doXml.includes(f.cClassTrib) && !doSis.includes(f.cClassTrib)) return false
    }
    if (f.reducao) {
      if (f.reducao === 'isento') {
        if (String(it.anexo ?? '') !== 'isento') return false
      } else if (String(it.anexo ?? '') !== f.reducao) {
        // anexo derivado carrega a redução; aceita também redIBS/redCBS diretas
        const rI = Number(it.redIBS) || 0
        const rC = Number(it.redCBS) || 0
        if (String(Math.round(rI)) !== f.reducao && String(Math.round(rC)) !== f.reducao) return false
      }
    }
    if (f.anexo) {
      if (f.anexo === 'cesta') {
        if (!/cesta/i.test(String(it.classificacao?.resumo?.descricaoCClassTrib ?? '') + String(it.anexo ?? ''))) {
          if (String(it.anexo ?? '') !== '1') return false
        }
      } else if (String(it.anexo ?? '') !== f.anexo) return false
    }
    if (f.soDiferidos) {
      try {
        if (!ehDiferimento(it.classificacao)) return false
      } catch {
        return false
      }
    }
    return true
  })
}

/* --------------------------------------------------------- agregações -- */

export interface LinhaFornecedor {
  cnpj: string
  nome: string
  qtdNotas: number
  base: number
  creditoIBS: number
  creditoCBS: number
  creditoTotal: number
  simples: boolean
}

export function agregarFornecedores(notas: NotaXml[], limite = 8): LinhaFornecedor[] {
  const mapa = new Map<string, LinhaFornecedor>()
  for (const n of notas ?? []) {
    if (n?.direcao !== 'entrada') continue
    const chave = String(n.emitCnpj || n.emitNome || '—')
    let l = mapa.get(chave)
    if (!l) {
      l = {
        cnpj: String(n.emitCnpj || ''),
        nome: n.emitNome || n.emitCnpj || '—',
        qtdNotas: 0, base: 0, creditoIBS: 0, creditoCBS: 0, creditoTotal: 0,
        simples: false,
      }
      mapa.set(chave, l)
    }
    const crt = String(n.emitCrt ?? '')
    if (crt === '1' || crt === '2' || crt === '4') l.simples = true
    l.qtdNotas++
    l.base = Math.round((l.base + (Number(n.valorTotal) || 0)) * 100) / 100
    l.creditoIBS = Math.round((l.creditoIBS + (Number(n.totalIBS) || 0)) * 100) / 100
    l.creditoCBS = Math.round((l.creditoCBS + (Number(n.totalCBS) || 0)) * 100) / 100
    l.creditoTotal = Math.round((l.creditoTotal + (Number(n.totalTributos) || 0)) * 100) / 100
  }
  // Marca Simples também via CSOSN dos itens (fallback quando CRT vazio).
  for (const n of notas ?? []) {
    if (n?.direcao !== 'entrada') continue
    const chave = String(n.emitCnpj || n.emitNome || '—')
    const l = mapa.get(chave)
    if (l && !l.simples) {
      for (const it of n.itensAnalisados ?? []) {
        if (/^[1259]\d\d$/.test(String(it.cstIcms ?? ''))) {
          l.simples = true
          break
        }
      }
    }
  }
  return [...mapa.values()].sort((a, b) => b.creditoTotal - a.creditoTotal).slice(0, limite)
}

export interface LinhaProduto {
  codigo: string
  nome: string
  ncm: string
  direcao: 'entrada' | 'saida'
  qtd: number
  base: number
  ibs: number
  cbs: number
  trib: number
  carga: number
  redIBS: number
  redCBS: number
  cst: string
  cct: string
}

export function agregarProdutos(notas: NotaXml[], direcao: 'entrada' | 'saida' | 'todas' = 'todas', limite = 8): LinhaProduto[] {
  const mapa = new Map<string, LinhaProduto>()
  for (const n of notas ?? []) {
    if (direcao !== 'todas' && n?.direcao !== direcao) continue
    if (n?.direcao !== 'entrada' && n?.direcao !== 'saida') continue
    for (const it of n.itensAnalisados ?? []) {
      const chave = `${it.codProd || it.ncm || it.descricao}·${n.direcao}`
      let l = mapa.get(chave)
      if (!l) {
        l = {
          codigo: String(it.codProd || '—'),
          nome: String(it.descricao || it.codProd || '—'),
          ncm: String(it.ncm || ''),
          direcao: n.direcao as 'entrada' | 'saida',
          qtd: 0, base: 0, ibs: 0, cbs: 0, trib: 0, carga: 0,
          redIBS: Number(it.redIBS) || 0, redCBS: Number(it.redCBS) || 0,
          cst: String(it.classificacao?.cst ?? ''),
          cct: String(it.classificacao?.cClassTrib ?? ''),
        }
        mapa.set(chave, l)
      }
      l.qtd += Number(it.qtd) || 0
      l.base = Math.round((l.base + (Number(it.vlTotal) || 0)) * 100) / 100
      l.ibs = Math.round((l.ibs + (Number(it.ibs) || 0)) * 100) / 100
      l.cbs = Math.round((l.cbs + (Number(it.cbs) || 0)) * 100) / 100
      l.trib = Math.round((l.trib + (Number(it.totalTributos) || 0)) * 100) / 100
    }
  }
  for (const l of mapa.values()) l.carga = l.base > 0 ? (l.trib / l.base) * 100 : 0
  return [...mapa.values()].sort((a, b) => b.trib - a.trib).slice(0, limite)
}

export interface LinhaReducao {
  chave: string
  rotulo: string
  redIBS: number
  redCBS: number
  itens: number
  base: number
  trib: number
}

export function agregarReducoes(notas: NotaXml[]): LinhaReducao[] {
  const mapa = new Map<string, LinhaReducao>()
  for (const n of notas ?? []) {
    for (const it of n.itensAnalisados ?? []) {
      const rI = Number(it.redIBS) || 0
      const rC = Number(it.redCBS) || 0
      const chave = `${rI}/${rC}`
      let l = mapa.get(chave)
      if (!l) {
        l = {
          chave,
          rotulo: rI === 0 && rC === 0 ? 'sem redução (alíquota cheia)' : `redução ${rI}% IBS / ${rC}% CBS`,
          redIBS: rI, redCBS: rC, itens: 0, base: 0, trib: 0,
        }
        mapa.set(chave, l)
      }
      l.itens++
      l.base = Math.round((l.base + (Number(it.vlTotal) || 0)) * 100) / 100
      l.trib = Math.round((l.trib + (Number(it.totalTributos) || 0)) * 100) / 100
    }
  }
  return [...mapa.values()].sort((a, b) => b.base - a.base)
}

export interface LinhaDiferido {
  codigo: string
  nome: string
  ncm: string
  cst: string
  cct: string
  condicional: boolean
  base: number
  trib: number
  qtd: number
}

export function agregarDiferidos(notas: NotaXml[]): { efetivos: LinhaDiferido[]; condicionais: LinhaDiferido[] } {
  const ef = new Map<string, LinhaDiferido>()
  const cond = new Map<string, LinhaDiferido>()
  for (const n of notas ?? []) {
    for (const it of n.itensAnalisados ?? []) {
      let alvo: Map<string, LinhaDiferido> | null = null
      let condicional = false
      try {
        if (ehDiferimento(it.classificacao)) alvo = ef
        else if (ehDiferimentoCondicionalAnexoIX(it.classificacao)) {
          alvo = cond
          condicional = true
        }
      } catch {
        alvo = null
      }
      if (!alvo) continue
      const chave = `${it.ncm}·${it.classificacao?.cClassTrib}`
      let l = alvo.get(chave)
      if (!l) {
        l = {
          codigo: String(it.codProd || '—'),
          nome: String(it.descricao || '—'),
          ncm: String(it.ncm || ''),
          cst: String(it.classificacao?.cst ?? ''),
          cct: String(it.classificacao?.cClassTrib ?? ''),
          condicional, base: 0, trib: 0, qtd: 0,
        }
        alvo.set(chave, l)
      }
      l.qtd++
      l.base = Math.round((l.base + (Number(it.vlTotal) || 0)) * 100) / 100
      l.trib = Math.round((l.trib + (Number(it.totalTributos) || 0)) * 100) / 100
    }
  }
  const ord = (m: Map<string, LinhaDiferido>): LinhaDiferido[] =>
    [...m.values()].sort((a, b) => b.base - a.base).slice(0, 10)
  return { efetivos: ord(ef), condicionais: ord(cond) }
}

export interface LinhaNcm {
  ncm: string
  exemplo: string
  cst: string
  cct: string
  anexo: string
  redIBS: number
  redCBS: number
  itens: number
  base: number
  trib: number
}

export function agregarNcm(notas: NotaXml[], limite = 10): LinhaNcm[] {
  const mapa = new Map<string, LinhaNcm>()
  for (const n of notas ?? []) {
    for (const it of n.itensAnalisados ?? []) {
      const ncm = String(it.ncm || '').replace(/\D/g, '') || '(sem NCM)'
      let l = mapa.get(ncm)
      if (!l) {
        l = {
          ncm,
          exemplo: String(it.descricao || '').slice(0, 48),
          cst: String(it.classificacao?.cst ?? '—'),
          cct: String(it.classificacao?.cClassTrib ?? '—'),
          anexo: String(it.anexo ?? '—'),
          redIBS: Number(it.redIBS) || 0,
          redCBS: Number(it.redCBS) || 0,
          itens: 0, base: 0, trib: 0,
        }
        mapa.set(ncm, l)
      }
      l.itens++
      l.base = Math.round((l.base + (Number(it.vlTotal) || 0)) * 100) / 100
      l.trib = Math.round((l.trib + (Number(it.totalTributos) || 0)) * 100) / 100
    }
  }
  return [...mapa.values()].sort((a, b) => b.base - a.base).slice(0, limite)
}

export interface ResumoApuracao {
  qtd: number
  entradas: number
  saidas: number
  base: number
  credito: number
  debito: number
  saldo: number
  resultado: string
}

/** Apuração simplificada do escopo (entradas = crédito, saídas = débito). */
export function resumirEscopo(notas: NotaXml[]): ResumoApuracao {
  let entradas = 0
  let saidas = 0
  let base = 0
  let credito = 0
  let debito = 0
  for (const n of notas ?? []) {
    base += Number(n?.valorTotal) || 0
    const t = Number(n?.totalTributos) || 0
    if (n?.direcao === 'entrada') {
      entradas++
      credito += t
    } else if (n?.direcao === 'saida') {
      saidas++
      debito += t
    }
  }
  base = Math.round(base * 100) / 100
  credito = Math.round(credito * 100) / 100
  debito = Math.round(debito * 100) / 100
  const saldo = Math.round((debito - credito) * 100) / 100
  return {
    qtd: notas?.length ?? 0,
    entradas,
    saidas,
    base,
    credito,
    debito,
    saldo,
    resultado: saldo > 0.005 ? 'a pagar' : saldo < -0.005 ? 'saldo credor' : 'zerado',
  }
}
