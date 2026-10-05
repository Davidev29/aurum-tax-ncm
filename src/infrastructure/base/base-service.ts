import { META_KEYS, REF_DEFAULT } from '@/domain/constants'
import { SISTEMAS_CFF } from '@/domain/constants/cff-apis'
import type {
  NomenclaturaNcm,
  ReferenciaCClassTrib,
  TabelaCst,
  TabelaCstClassTrib,
  VinculoNcm,
} from '@/domain/entities'
import { lerArquivoBase } from '../bridge'
import { bulkPut, db, type MetaRecord } from '../db/schema'
import { invalidarCacheBuscaTexto } from './classificacao-repo'
import { fingerprintBase, type TipoBase } from './formatos'
import {
  normalizarAnexosCff,
  normalizarClassTribCff,
  normalizarCnaeAnexo,
  normalizarCreditoPresumido,
  normalizarCst,
  normalizarCstClassTrib,
  normalizarLocaisOperacao,
  normalizarNcm,
  normalizarNbsServicos,
  normalizarNomenclatura,
  normalizarNbs,
  normalizarProdutoDfe,
  normalizarReferencia,
  unirVinculosNbs,
} from './normalizacao'

export type Progresso = (etapa: string, pct: number) => void

export type FormatoBase =
  | { formato: 'nomenclatura'; total: number }
  | { formato: 'reforma'; total: number }
  | { formato: 'referencia'; total: number }
  | { formato: 'classtrib-cff'; total: number }
  | { formato: 'anexos-cff'; total: number }
  | { formato: 'credito-presumido-cff'; total: number }
  | { formato: 'indoper-cff'; total: number }
  | { formato: 'cnae-anexo'; total: number }
  | { formato: 'nbs-servicos'; total: number }
  | { formato: 'classprod-cff'; total: number; sistema: string }

export interface OpcoesImportacao {
  /** Obrigatório para `classprod-cff` (o arquivo não declara o próprio sistema). */
  sistema?: string
}

/** Chaves de `meta` das bases CFF versionadas. */
export const META_BASES_CFF = {
  ANEXOS: 'importacao_anexos',
  CRED_PRESUMIDO: 'base_credPresumido',
  IND_OPER: 'base_indOper',
  PRODUTOS_DFE: 'importacao_produtosDfe',
  /** Phase 7 — arquivos vivos de Serviços. */
  CNAE: 'importacao_cnae',
  NBS_SERVICOS: 'importacao_nbs_servicos',
} as const

export interface StatusBase {
  ncm: number
  cst: number
  cstClassTrib: number
  referencia: number
  nomenclatura: number
  nbs: number
  /** Phase 7 — CNAE × Anexo Simples. */
  cnae: number
  anexos: number
  produtosDfe: number
  credPresumido: number
  indOper: number
  ultimaImportacao: MetaRecord | null
  ultimaNomenclatura: MetaRecord | null
  embutida: boolean
  /** Data de geração da base embutida (`MANIFEST.json → geradoEm`), ou `null`. */
  geradoEm: string | null
}

interface Manifest {
  schema: number
  geradoEm: string
  estatisticas: Record<string, number>
  arquivos: { arquivo: string; bytes: number; sha256: string }[]
}

/**
 * Detecção de formato — primeiro teste vence (SPEC R5.2).
 *
 * Além dos JSON oficiais brutos, reconhece os artefatos já normalizados da
 * base embutida (`{ tipo, itens }` / `{ tipo, ncm }`), que os normalizadores
 * também sabem reaplicar sem perda.
 */
export function detectarFormato(json: unknown): FormatoBase['formato'] | 'desconhecido' {
  if (!json || typeof json !== 'object') return 'desconhecido'
  const j = json as Record<string, unknown>
  if (Array.isArray(j.Nomenclaturas) || (j.tipo === 'nomenclatura' && Array.isArray(j.itens)))
    return 'nomenclatura'
  if (Array.isArray(j.NCM) || Array.isArray(j.ncm)) return 'reforma'
  const lista =
    (Array.isArray(j) ? j : null) ??
    (j.tipo === 'classificacao-tributaria' && Array.isArray(j.itens)
      ? (j.itens as unknown[])
      : null)
  const primeiro = lista?.[0] as Record<string, unknown> | undefined
  if (primeiro && ('Código da Situação Tributária' in primeiro || 'cst' in primeiro))
    return 'referencia'
  return 'desconhecido'
}

/* -------------------------------------------------------------------------- */
/* Importação em tempo de execução (formatos originais oficiais)               */
/* -------------------------------------------------------------------------- */

export async function importarBase(
  json: unknown,
  nomeArquivo: string,
  onProgress: Progresso,
  opcoes: OpcoesImportacao = {},
): Promise<FormatoBase> {
  if (!json || typeof json !== 'object') throw new Error('JSON inválido.')
  // Reconhecimento pelo conteúdo (formatos): nomes de arquivo de download
  // (`ConsultaClassificacaoProduto (1).json`) não carregam a origem.
  const tipo: TipoBase = fingerprintBase(json)
  const formatoLegado = detectarFormato(json)
  const agora = new Date().toISOString()

  if (tipo === 'nomenclatura') {
    onProgress('Mapeando nomenclatura', 5)
    const itens = normalizarNomenclatura(json)
    if (!itens.length) throw new Error('Base de nomenclatura sem itens válidos.')
    onProgress('Limpando nomenclatura', 5)
    await db.ncmNomenclatura.clear()
    onProgress('Gravando nomenclatura', 15)
    await bulkPut(db.ncmNomenclatura, itens, (f, t) =>
      onProgress('Gravando nomenclatura', 15 + Math.round((f / t) * 80)),
    )
    await db.meta.put({
      chave: META_KEYS.IMPORTACAO_NOMENCLATURA,
      data: agora,
      arquivo: nomeArquivo,
      total: itens.length,
    })
    invalidarCacheBuscaTexto()
    onProgress('Finalizado', 100)
    return { formato: 'nomenclatura', total: itens.length }
  }

  if (tipo === 'reforma') {
    const j = json as Record<string, unknown>
    const ncmBruto = (Array.isArray(j.NCM) ? j.NCM : Array.isArray(j.ncm) ? j.ncm : []) as unknown[]
    if (!ncmBruto.length) throw new Error('Formato não reconhecido.')
    const tab = (j.tabelasAuxiliares ?? {}) as Record<string, unknown>

    onProgress('Mapeando vinculações NCM', 3)
    const ncm = normalizarNcm(ncmBruto)
    // Tabelas auxiliares: chave do formato bruto (`tabelasAuxiliares`) ou a
    // chave canônica do artefato já normalizado da base embutida.
    const cst = normalizarCst(tab.cst ?? j.cst)
    const cstct = normalizarCstClassTrib(tab.cstClassTrib ?? j.cstClassTrib)
    // A fonte publica 10 NBS do Anexo IX (art. 138, 200/200038) DENTRO da
    // lista `NCM` — sem esta união eles são descartados e a conferência do
    // serviço cai em regra geral (sem descrição, redução, anexo ou LC).
    const nbs = unirVinculosNbs(normalizarNbs(j.NBS ?? j.nbs), normalizarNbs(ncmBruto))

    onProgress('Limpando base', 3)
    await Promise.all([db.ncm.clear(), db.cst.clear(), db.cstClassTrib.clear()])

    if (cst.length) {
      onProgress('Gravando CST', 8)
      await bulkPut(db.cst, cst)
    }
    if (cstct.length) {
      onProgress('Gravando cClassTrib', 18)
      await bulkPut(db.cstClassTrib, cstct)
    }
    onProgress('Gravando NCM', 28)
    await bulkPut(db.ncm, ncm, (f, t) =>
      onProgress('Gravando NCM', 28 + Math.round((f / t) * 70)),
    )
    if (nbs.length) await bulkPut(db.nbs, nbs)

    await db.meta.put({ chave: META_KEYS.IMPORTACAO, data: agora, arquivo: nomeArquivo })
    onProgress('Finalizado', 100)
    return { formato: 'reforma', total: ncm.length }
  }

  if (tipo === 'referencia-dfe') {
    onProgress('Mapeando referência tributária', 10)
    const itens = normalizarReferencia(json)
    if (!itens.length) throw new Error('Referência sem registros válidos.')
    onProgress('Limpando referência', 15)
    await db.referencia.clear()
    onProgress('Gravando referência', 30)
    await bulkPut(db.referencia, itens, (f, t) =>
      onProgress('Gravando referência', 30 + Math.round((f / t) * 65)),
    )
    await db.meta.put({ chave: 'importacao_referencia', data: agora, arquivo: nomeArquivo, total: itens.length })
    onProgress('Finalizado', 100)
    return { formato: 'referencia', total: itens.length }
  }

  // API CFF `classTrib`: mesma referência dos 164 em serialização nativa —
  // achata para referência + CST + CST×cClassTrib (shape canônico).
  if (tipo === 'classtrib-cff') {
    onProgress('Mapeando classificação tributária (CFF)', 5)
    const { referencia, cst, cstClassTrib } = normalizarClassTribCff(json)
    if (!referencia.length) throw new Error('Classificação tributária (CFF) sem registros válidos.')
    onProgress('Limpando referência/CST', 10)
    await Promise.all([db.referencia.clear(), db.cst.clear(), db.cstClassTrib.clear()])
    onProgress('Gravando referência', 20)
    await bulkPut(db.referencia, referencia, (f, t) =>
      onProgress('Gravando referência', 20 + Math.round((f / t) * 40)),
    )
    if (cst.length) await bulkPut(db.cst, cst)
    if (cstClassTrib.length) await bulkPut(db.cstClassTrib, cstClassTrib)
    await db.meta.put({ chave: META_KEYS.IMPORTACAO, data: agora, arquivo: nomeArquivo, total: referencia.length })
    await db.meta.put({ chave: 'importacao_referencia', data: agora, arquivo: nomeArquivo, total: referencia.length })
    invalidarCacheBuscaTexto()
    onProgress('Finalizado', 100)
    return { formato: 'classtrib-cff', total: referencia.length }
  }

  // API CFF `anexos`: NCM/NBS × anexo × permissão (store própria).
  if (tipo === 'anexos-cff') {
    onProgress('Mapeando anexos', 10)
    const itens = normalizarAnexosCff(json)
    if (!itens.length) throw new Error('Tabela de anexos sem registros válidos.')
    onProgress('Limpando anexos', 15)
    await db.anexos.clear()
    onProgress('Gravando anexos', 20)
    await bulkPut(db.anexos, itens, (f, t) =>
      onProgress('Gravando anexos', 20 + Math.round((f / t) * 75)),
    )
    await db.meta.put({ chave: META_BASES_CFF.ANEXOS, data: agora, arquivo: nomeArquivo, total: itens.length })
    onProgress('Finalizado', 100)
    return { formato: 'anexos-cff', total: itens.length }
  }

  // API CFF `credPresumido` / `indOper`: sem store dedicada — conversão tipada
  // versionada em `meta` (informação adicional + tabelas oficiais).
  if (tipo === 'credito-presumido-cff' || tipo === 'indoper-cff') {
    onProgress('Convertendo tabela CFF', 20)
    const dados =
      tipo === 'credito-presumido-cff' ? normalizarCreditoPresumido(json) : normalizarLocaisOperacao(json)
    if (!dados.length) throw new Error('Tabela CFF sem registros válidos.')
    const chave = tipo === 'credito-presumido-cff' ? META_BASES_CFF.CRED_PRESUMIDO : META_BASES_CFF.IND_OPER
    await db.meta.put({ chave, data: agora, arquivo: nomeArquivo, total: dados.length, valor: { dados } })
    onProgress('Finalizado', 100)
    return { formato: tipo, total: dados.length }
  }

  // Phase 7 — arquivo vivo `CNAE X ANEXO.json` (array plano, chaves PT).
  if (tipo === 'cnae-anexo') {
    onProgress('Mapeando CNAE × Anexo', 10)
    const itens = normalizarCnaeAnexo(json)
    if (!itens.length) throw new Error('Tabela CNAE sem registros válidos.')
    onProgress('Limpando CNAE', 15)
    await db.cnae.clear()
    onProgress('Gravando CNAE', 20)
    await bulkPut(db.cnae, itens, (f, t) =>
      onProgress('Gravando CNAE', 20 + Math.round((f / t) * 75)),
    )
    await db.meta.put({ chave: META_BASES_CFF.CNAE, data: agora, arquivo: nomeArquivo, total: itens.length })
    onProgress('Finalizado', 100)
    return { formato: 'cnae-anexo', total: itens.length }
  }

  // Phase 7 — arquivo vivo `NBS SERVIÇOS.json` (array plano, chaves PT + dedupe).
  if (tipo === 'nbs-servicos') {
    onProgress('Mapeando NBS Serviços', 10)
    const { vinculos } = normalizarNbsServicos(json)
    if (!vinculos.length) throw new Error('NBS Serviços sem registros válidos.')
    onProgress('Limpando NBS', 15)
    await db.nbs.clear()
    onProgress('Gravando NBS', 20)
    await bulkPut(db.nbs, vinculos, (f, t) =>
      onProgress('Gravando NBS', 20 + Math.round((f / t) * 75)),
    )
    await db.meta.put({ chave: META_BASES_CFF.NBS_SERVICOS, data: agora, arquivo: nomeArquivo, total: vinculos.length })
    onProgress('Finalizado', 100)
    return { formato: 'nbs-servicos', total: vinculos.length }
  }

  // API CFF `ConsultaClassificacaoProduto` (formato real, por produto):
  // exige o sistema (o arquivo não declara a própria origem).
  if (tipo === 'classprod-cff') {
    const sistema = String(opcoes.sistema ?? '').trim()
    if (!sistema || !(SISTEMAS_CFF as readonly string[]).includes(sistema)) {
      throw new Error('Informe o sistema de origem (NFCom, NFAg, NF3e ou NFGas) para este arquivo.')
    }
    onProgress(`Mapeando produtos (${sistema})`, 10)
    const itens = normalizarProdutoDfe(json, sistema)
    if (!itens.length) throw new Error(`Nenhum produto válido para ${sistema} no arquivo.`)
    onProgress(`Limpando produtos (${sistema})`, 15)
    await db.produtosDfe.where('sistema').equals(sistema).delete()
    onProgress(`Gravando produtos (${sistema})`, 20)
    await bulkPut(db.produtosDfe, itens, (f, t) =>
      onProgress(`Gravando produtos (${sistema})`, 20 + Math.round((f / t) * 75)),
    )
    await db.meta.put({ chave: `${META_BASES_CFF.PRODUTOS_DFE}_${sistema}`, data: agora, arquivo: nomeArquivo, total: itens.length })
    onProgress('Finalizado', 100)
    return { formato: 'classprod-cff', total: itens.length, sistema }
  }

  throw new Error(
    formatoLegado === 'desconhecido'
      ? 'Formato não reconhecido. Selecione um JSON oficial (Siscomex, DFe, CFF ou Reforma).'
      : 'Formato não reconhecido.',
  )
}

/* -------------------------------------------------------------------------- */
/* Base embutida (semeação automática)                                         */
/* -------------------------------------------------------------------------- */

interface ArquivoRef {
  schema: number
  tipo: string
  meta: Record<string, unknown>
}

export const ARQUIVOS_BASE = [
  'MANIFEST.json',
  'classificacao-tributaria.json',
  'reforma.json',
  'nomenclatura.json',
  'cnae.json',
] as const

/**
 * A base está **completa** quando tem vínculos NCM **e** a referência oficial
 * (`classificacao_tributaria.json`), que é o que habilita anexos, documentos e
 * chips de redução.
 *
 * O banco legado (v2) foi criado antes da store `referencia` existir: ele tem
 * NCMs, mas nenhuma referência — e é justamente esse estado que manda ressemear
 * a base embutida na primeira abertura com a nova versão.
 */
export async function baseCompleta(): Promise<boolean> {
  const [ncm, referencia] = await Promise.all([db.ncm.count(), db.referencia.count()])
  return ncm > 0 && referencia > 0
}

/**
 * Semeia a base embutida no pacote — é o que torna o `classificacao_tributaria.json`
 * "anexado" ao sistema: nada de importação manual, o banco nasce completo.
 */
export async function semearBaseEmbutida(
  onProgress: Progresso = () => {},
  forcar = false,
): Promise<StatusBase> {
  // Base legada já semeada: não resemeia tudo, mas completa as stores novas
  // (Phase 7) que o banco antigo não tem — sem isso, quem atualizou o app
  // fica com `cnae` vazia e todo CNAE cai em "fora da tabela viva".
  if ((await baseCompleta()) && !forcar) {
    await completarStoresFase7().catch(() => false)
    return statusBase()
  }

  onProgress('Lendo manifesto da base', 4)
  let manifest: Manifest | null = null
  try {
    manifest = JSON.parse(await lerArquivoBase('MANIFEST.json')) as Manifest
  } catch {
    manifest = null
  }

  onProgress('Carregando classificação tributária', 10)
  const refJson = JSON.parse(await lerArquivoBase('classificacao-tributaria.json')) as ArquivoRef & {
    itens: unknown[]
  }
  const referencia: ReferenciaCClassTrib[] = normalizarReferencia(refJson.itens)

  onProgress('Carregando vinculações NCM', 25)
  const reformaJson = JSON.parse(await lerArquivoBase('reforma.json')) as ArquivoRef & {
    cst: unknown[]
    cstClassTrib: unknown[]
    ncm: unknown[]
    nbs: unknown[]
  }
  const cst = normalizarCst(reformaJson.cst)
  const cstct = normalizarCstClassTrib(reformaJson.cstClassTrib)
  const ncm = normalizarNcm(reformaJson.ncm)
  const nbs = normalizarNbs(reformaJson.nbs)

  onProgress('Carregando nomenclatura vigente', 40)
  const nomenJson = JSON.parse(await lerArquivoBase('nomenclatura.json')) as ArquivoRef & {
    itens: unknown
  }
  const nomenclatura: NomenclaturaNcm[] = normalizarNomenclatura(nomenJson)

  // Phase 7 — CNAE × Anexo Simples (arquivo vivo; ausente = store vazia, sem falhar).
  onProgress('Carregando CNAE × Anexo', 44)
  let cnae: import('@/domain/entities').CnaeAnexo[] = []
  try {
    const cnaeJson = JSON.parse(await lerArquivoBase('cnae.json')) as ArquivoRef & {
      itens: unknown
    }
    cnae = normalizarCnaeAnexo(cnaeJson.itens ?? cnaeJson)
  } catch {
    cnae = []
  }

  onProgress('Limpando base anterior', 45)
  await Promise.all([
    db.ncm.clear(),
    db.cst.clear(),
    db.cstClassTrib.clear(),
    db.referencia.clear(),
    db.ncmNomenclatura.clear(),
    db.nbs.clear(),
    db.cnae.clear(),
  ])

  const agora = new Date().toISOString()
  const reg = (pctBase: number, span: number) => (f: number, t: number) =>
    onProgress('Gravando', pctBase + Math.round((f / Math.max(t, 1)) * span))

  onProgress('Gravando referência', 46)
  await bulkPut(db.referencia, referencia, reg(46, 6))
  onProgress('Gravando CST', 52)
  await bulkPut(db.cst, cst)
  onProgress('Gravando cClassTrib', 56)
  await bulkPut(db.cstClassTrib, cstct)
  onProgress('Gravando vinculações NCM', 60)
  await bulkPut(db.ncm, ncm, reg(60, 20))
  onProgress('Gravando nomenclatura', 80)
  await bulkPut(db.ncmNomenclatura, nomenclatura, reg(80, 18))
  if (nbs.length) await bulkPut(db.nbs, nbs)
  if (cnae.length) await bulkPut(db.cnae, cnae)

  await db.meta.put({
    chave: META_KEYS.IMPORTACAO,
    data: agora,
    arquivo: (reformaJson.meta?.arquivoOrigem as string) ?? 'base embutida',
    total: ncm.length,
  })
  await db.meta.put({
    chave: META_KEYS.IMPORTACAO_NOMENCLATURA,
    data: agora,
    arquivo: (nomenJson.meta?.arquivoOrigem as string) ?? 'base embutida',
    total: nomenclatura.length,
  })
  await db.meta.put({
    chave: 'base_embutida',
    valor: {
      geradoEm: manifest?.geradoEm ?? null,
      estatisticas: manifest?.estatisticas ?? null,
      alquotas: REF_DEFAULT,
    },
    quando: agora,
  })

  invalidarCacheBuscaTexto()
  onProgress('Finalizado', 100)
  return statusBase()
}

export async function statusBase(): Promise<StatusBase> {
  const [ncm, cst, cstClassTrib, referencia, nomenclatura, nbs, cnae, anexos, produtosDfe, metaCred, metaInd, ultima, ultimaNom] =
    await Promise.all([
      db.ncm.count(),
      db.cst.count(),
      db.cstClassTrib.count(),
      db.referencia.count(),
      db.ncmNomenclatura.count(),
      db.nbs.count(),
      db.cnae.count().catch(() => 0),
      db.anexos.count().catch(() => 0),
      db.produtosDfe.count().catch(() => 0),
      db.meta.get(META_BASES_CFF.CRED_PRESUMIDO).catch(() => undefined),
      db.meta.get(META_BASES_CFF.IND_OPER).catch(() => undefined),
      db.meta.get(META_KEYS.IMPORTACAO),
      db.meta.get(META_KEYS.IMPORTACAO_NOMENCLATURA),
    ])
  const embutida = await db.meta.get('base_embutida')
  const valorEmbutida = embutida?.valor as { geradoEm?: unknown } | undefined
  return {
    ncm,
    cst,
    cstClassTrib,
    referencia,
    nomenclatura,
    nbs,
    cnae,
    anexos,
    produtosDfe,
    credPresumido: typeof metaCred?.total === 'number' ? metaCred.total : 0,
    indOper: typeof metaInd?.total === 'number' ? metaInd.total : 0,
    ultimaImportacao: ultima ?? null,
    ultimaNomenclatura: ultimaNom ?? null,
    embutida: Boolean(embutida),
    geradoEm:
      typeof valorEmbutida?.geradoEm === 'string' && valorEmbutida.geradoEm
        ? valorEmbutida.geradoEm
        : null,
  }
}

/**
 * Completa as stores da Phase 7 em bancos legados já semeados.
 *
 * Cenário: o usuário atualizou o app com a base NCM completa, mas as stores
 * `cnae` (e `nbs`, em instalações muito antigas) estão vazias — o seed
 * completo é pulado pelo early-return de `baseCompleta()`. Sem este top-up,
 * todo CNAE cai em "fora da tabela viva". Idempotente e best-effort: nunca
 * quebra o boot (`semearBaseEmbutida` a chama no caminho rápido).
 *
 * Também preenche NBS FALTANTES sem limpar a store: bancos semeados antes do
 * resgate do overflow NCM têm 112 vínculos e perdem os 10 NBS do Anexo IX
 * (art. 138, 200/200038) — sem backfill, a conferência desses serviços
 * continua caindo em regra geral mesmo com o app atualizado.
 *
 * Devolve `true` quando preencheu ao menos uma store.
 */
export async function completarStoresFase7(): Promise<boolean> {
  let completou = false
  try {
    const [cnae, nbs] = await Promise.all([db.cnae.count(), db.nbs.count()])
    if (cnae === 0) {
      try {
        const cnaeJson = JSON.parse(await lerArquivoBase('cnae.json')) as ArquivoRef & {
          itens: unknown
        }
        const itens = normalizarCnaeAnexo(cnaeJson.itens ?? cnaeJson)
        if (itens.length) {
          await bulkPut(db.cnae, itens)
          await db.meta.put({
            chave: META_BASES_CFF.CNAE,
            data: new Date().toISOString(),
            arquivo: 'base embutida (top-up Phase 7)',
            total: itens.length,
          })
          completou = true
        }
      } catch {
        /* sem cnae.json embutido: mantém vazia, sem falhar */
      }
    }
    if (nbs === 0) {
      try {
        const reformaJson = JSON.parse(await lerArquivoBase('reforma.json')) as ArquivoRef & {
          nbs: unknown[]
        }
        const itens = normalizarNbs(reformaJson.nbs)
        if (itens.length) {
          await bulkPut(db.nbs, itens)
          completou = true
        }
      } catch {
        /* sem reforma.json embutido: mantém vazia, sem falhar */
      }
    } else {
      // Backfill dos 10 NBS do Anexo IX resgatados do overflow NCM: bancos
      // com 112 vínculos não têm esses códigos — insere só os faltantes
      // (chave `codigo|cst|cClassTrib`), sem tocar no que já existe.
      try {
        const reformaJson = JSON.parse(await lerArquivoBase('reforma.json')) as ArquivoRef & {
          nbs: unknown[]
        }
        const oficiais = normalizarNbs(reformaJson.nbs)
        if (oficiais.length > nbs) {
          const atuais = await db.nbs.toArray().catch(() => [])
          const vistos = new Set(atuais.map((v) => `${v.codigo}|${v.cst}|${v.cClassTrib}`))
          const faltantes = oficiais.filter((v) => !vistos.has(`${v.codigo}|${v.cst}|${v.cClassTrib}`))
          if (faltantes.length) {
            await bulkPut(db.nbs, faltantes)
            completou = true
          }
        }
      } catch {
        /* sem reforma.json embutido: mantém como está, sem falhar */
      }
    }
  } catch {
    return false
  }
  return completou
}

/** Apaga apenas a base importada (SPEC R10.12). */
export async function apagarBaseImportada(): Promise<void> {  await Promise.all([
    db.ncm.clear(),
    db.cst.clear(),
    db.cstClassTrib.clear(),
    db.referencia.clear(),
    db.ncmNomenclatura.clear(),
    db.nbs.clear(),
    db.cnae.clear().catch(() => undefined),
    db.anexos.clear().catch(() => undefined),
    db.produtosDfe.clear().catch(() => undefined),
    db.classificacaoProduto.clear(),
    db.meta.delete(META_KEYS.IMPORTACAO),
    db.meta.delete(META_KEYS.IMPORTACAO_NOMENCLATURA),
    db.meta.delete(META_BASES_CFF.ANEXOS),
    db.meta.delete(META_BASES_CFF.CNAE),
    db.meta.delete(META_BASES_CFF.NBS_SERVICOS),
    db.meta.delete(META_BASES_CFF.CRED_PRESUMIDO),
    db.meta.delete(META_BASES_CFF.IND_OPER),
    db.meta.delete('base_embutida'),
  ])
  invalidarCacheBuscaTexto()
}

export type { VinculoNcm, TabelaCst, TabelaCstClassTrib }
