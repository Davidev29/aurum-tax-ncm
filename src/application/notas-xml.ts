import { REF_DEFAULT } from '@/domain/constants'
import type { Empresa } from '@/domain/entities'
import { db } from '@/infrastructure/db/schema'
import { salvarXmlImportado, removerXmlImportado } from '@/infrastructure/arquivos/xml-storage'
import { analisarItensNfe, totaisItensNfe } from '@/infrastructure/nfe/analisar'
import { classificarDirecao, parseXmlNfe } from '@/infrastructure/nfe/parse'
import type {
  CreditoFornecedor,
  FiltrosNfe,
  NotaXml,
  ResumoImportacaoXml,
} from '@/infrastructure/nfe/tipos'
import { salvarProdutosEmLote, type ItemLoteGravavel } from './produtos'
import { completarEmpresa } from './empresas'
import { norm } from '@/domain/services/format'
import { round2 } from '@/domain/services/calculo'
import { regimeDoEmitente } from '@/infrastructure/nfe/regime'
import type { NotaXmlBruta } from '@/infrastructure/nfe/tipos'

/* -------------------------------------------------------------- importação -- */

/**
 * Importa XMLs de NF-e/NFC-e para a empresa ativa.
 *
 * Garantias:
 * - empresa com `id` é obrigatória (o chamador valida e avisa);
 * - chave de acesso duplicada na empresa é pulada (nunca duplica);
 * - falha num arquivo não aborta o lote (vira linha de `erros`);
 * - falha ao guardar o XML em disco também vira erro — a nota não é
 *   persistida pela metade.
 */
export async function importarXmls(
  arquivos: File[],
  empresa: Empresa,
  ref: { refIBS: number; refCBS: number } = { refIBS: REF_DEFAULT.IBS, refCBS: REF_DEFAULT.CBS },
  onProgress?: (feito: number, total: number) => void,
): Promise<ResumoImportacaoXml> {
  const empresaId = empresa.id
  if (empresaId == null) throw new Error('Empresa sem identificador.')
  const resumo: ResumoImportacaoXml = { novas: 0, duplicadas: 0, quarentena: 0, erros: [] }

  for (let i = 0; i < arquivos.length; i++) {
    const file = arquivos[i]
    try {
      const conteudo = await file.text()
      const bruta = parseXmlNfe(conteudo, file.name)

      const existente = await db.nfeNotas
        .where('[empresaId+chave]')
        .equals([empresaId, bruta.chave])
        .first()
      if (existente) {
        resumo.duplicadas++
        continue
      }

      const direcao = classificarDirecao(bruta.emitCnpj, bruta.destDoc, empresa.cnpj)
      if (direcao === 'quarentena') resumo.quarentena++
      const itensAnalisados = await analisarItensNfe(bruta.itens, ref)
      const tot = totaisItensNfe(itensAnalisados)
      const { arquivo, xmlConteudo } = await salvarXmlImportado(empresa.cnpj, bruta.chave, conteudo)

      const nota: NotaXml = {
        ...bruta,
        empresaId,
        direcao,
        arquivo,
        xmlConteudo,
        refIBS: ref.refIBS,
        refCBS: ref.refCBS,
        totalIBS: tot.totalIBS,
        totalCBS: tot.totalCBS,
        totalTributos: tot.totalTributos,
        importadoEm: new Date().toISOString(),
        itensAnalisados,
      }
      await db.nfeNotas.add(nota)
      resumo.novas++
      // Enriquecimento best-effort: a nota pode trazer IE/IM/endereço que o
      // cadastro ainda não tem — completa sem nunca quebrar a importação.
      void completarEmpresaComNota(empresaId, empresa.cnpj, bruta)
    } catch (e) {
      resumo.erros.push({ arquivo: file.name, motivo: e instanceof Error ? e.message : String(e) })
    }
    onProgress?.(i + 1, arquivos.length)
  }

  return resumo
}

/**
 * Completa o cadastro da empresa ativa com IE/IM/endereço vindos da nota.
 * Só usa o lado da nota cujo CNPJ coincide com a empresa (emitente na saída,
 * destinatário na entrada). Silencioso e best-effort.
 */
export async function completarEmpresaComNota(
  empresaId: number,
  empresaCnpj: string,
  bruta: NotaXmlBruta,
): Promise<boolean> {
  const empresa = norm(empresaCnpj)
  if (!empresa) return false
  if (norm(bruta.emitCnpj) === empresa) {
    return completarEmpresa(empresaId, {
      razaoSocial: bruta.emitNome || undefined,
      ie: bruta.emitIe || undefined,
      im: bruta.emitIm || undefined,
      regimeTributario: regimeDaNota(bruta) ?? undefined,
      endereco: bruta.emitEndereco || undefined,
      cidade: bruta.emitCidade || undefined,
      uf: bruta.emitUf || undefined,
    })
  }
  if (bruta.destDoc && norm(bruta.destDoc) === empresa) {
    return completarEmpresa(empresaId, {
      razaoSocial: bruta.destNome || undefined,
      ie: bruta.destIe || undefined,
    })
  }
  return false
}

/**
 * Regime do emitente da nota (CRT manda; sem CRT, CSOSN dos itens).
 * `null` quando desconhecido — o cadastro preserva o que já tem.
 */
function regimeDaNota(bruta: NotaXmlBruta): 'simples' | 'mei' | 'normal' | null {
  const r = regimeDoEmitente(bruta.emitCrt, bruta.itens)
  return r === 'desconhecido' ? null : r
}

/* --------------------------------------------------------------- consultas -- */

const noPeriodo = (data: string, inicio: string, fim: string): boolean =>
  (!inicio || data >= inicio) && (!fim || data <= fim)

/** Lista as notas da empresa aplicando os filtros (ordenadas por emissão desc). */
export async function listarNotas(empresaId: number, filtros: FiltrosNfe): Promise<NotaXml[]> {
  let col = db.nfeNotas.where('empresaId').equals(empresaId)
  if (filtros.direcao !== 'todas') col = col.and((n) => n.direcao === filtros.direcao)
  if (filtros.inicio || filtros.fim) {
    const { inicio, fim } = filtros
    col = col.and((n) => noPeriodo(n.dataEmissao, inicio, fim))
  }
  const notas = await col.reverse().sortBy('dataEmissao')

  const texto = filtros.texto.trim().toLowerCase()
  const forn = filtros.fornecedor.trim().toLowerCase()
  const cfop = filtros.cfop.trim()
  const cstIcms = filtros.cstIcms.trim().toUpperCase()
  const cct = filtros.cClassTrib.trim()
  const cstRef = filtros.cstReforma.trim().toUpperCase()
  const red = filtros.reducao.trim()
  if (!texto && !forn && !cfop && !cstIcms && !cct && !cstRef && !red) return notas

  return notas.filter((n) => {
    if (forn && !`${n.emitNome} ${n.emitCnpj}`.toLowerCase().includes(forn)) return false
    if (!texto && !cfop && !cstIcms && !cct && !cstRef && !red) return true
    return n.itensAnalisados.some((it) => {
      if (cfop && it.cfop !== cfop) return false
      if (cstIcms && String(it.cstIcms ?? '').trim().toUpperCase() !== cstIcms) return false
      // Reforma: a tabela exibe o CST/cClassTrib destacado no XML primeiro e
      // o do sistema como fallback — o filtro casa com qualquer um dos dois.
      if (cct && ![it.cClassTribIbsCbs, it.classificacao.cClassTrib].some((v) => String(v ?? '').includes(cct))) return false
      if (cstRef && ![it.cstIbsCbs, it.classificacao.cst].some((v) => String(v ?? '').trim().toUpperCase() === cstRef)) return false
      if (red && it.anexo !== red) return false
      if (!texto) return true
      return `${it.descricao} ${it.codProd} ${it.ncm}`.toLowerCase().includes(texto)
    })
  })
}

/** Dias do mês com notas (para o calendário histórico). */
export async function contarPorDia(
  empresaId: number,
  ano: number,
  mes: number,
): Promise<Map<number, number>> {
  const prefixo = `${ano}-${String(mes).padStart(2, '0')}`
  const notas = await db.nfeNotas
    .where('empresaId')
    .equals(empresaId)
    .and((n) => n.dataEmissao.startsWith(prefixo))
    .toArray()
  const mapa = new Map<number, number>()
  for (const n of notas) {
    const dia = Number(n.dataEmissao.slice(8, 10))
    mapa.set(dia, (mapa.get(dia) ?? 0) + 1)
  }
  return mapa
}

/** Fornecedores distintos da empresa (para o filtro). */
export async function listarFornecedores(empresaId: number): Promise<{ cnpj: string; nome: string }[]> {
  const notas = await db.nfeNotas.where('empresaId').equals(empresaId).toArray()
  const mapa = new Map<string, string>()
  for (const n of notas) {
    if (!mapa.has(n.emitCnpj)) mapa.set(n.emitCnpj, n.emitNome || n.emitCnpj)
  }
  return [...mapa.entries()]
    .map(([cnpj, nome]) => ({ cnpj, nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}

/**
 * CST/CSOSN de ICMS distintos existentes nas notas da empresa — alimenta o
 * **dropdown** do filtro (em vez de um campo livre, o usuário escolhe o que
 * realmente existe no histórico; cobre CST de regime normal e CSOSN do
 * Simples, ambos de 2–3 dígitos).
 */
export async function listarCstIcmsNotas(empresaId: number): Promise<string[]> {
  const notas = await db.nfeNotas.where('empresaId').equals(empresaId).toArray()
  const set = new Set<string>()
  for (const n of notas) {
    for (const it of n.itensAnalisados ?? []) {
      const cst = String(it.cstIcms ?? '').trim().toUpperCase()
      if (cst) set.add(cst)
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

/**
 * Ranking de fornecedores por crédito — soma de IBS+CBS estimados das
 * **entradas** (é nelas que o crédito se forma). A contraparte da entrada é
 * o emitente da nota.
 */
export async function rankingFornecedores(
  empresaId: number,
  inicio: string,
  fim: string,
  limite = 10,
): Promise<CreditoFornecedor[]> {
  const notas = await db.nfeNotas
    .where('empresaId')
    .equals(empresaId)
    .and((n) => n.direcao === 'entrada' && noPeriodo(n.dataEmissao, inicio, fim))
    .toArray()
  const mapa = new Map<string, CreditoFornecedor>()
  for (const n of notas) {
    let atual = mapa.get(n.emitCnpj)
    if (!atual) {
      atual = {
        cnpj: n.emitCnpj,
        nome: n.emitNome || n.emitCnpj,
        qtdNotas: 0,
        totalEntradas: 0,
        creditoIBS: 0,
        creditoCBS: 0,
        creditoTotal: 0,
        simples: false,
      }
      mapa.set(n.emitCnpj, atual)
    }
    // Qualquer nota Simples/MEI do fornecedor contamina o agregado: os valores
    // seguem como estimativa, mas a UI sinaliza que não há transferência.
    const regime = regimeDoEmitente(n.emitCrt, n.itensAnalisados)
    if (regime === 'simples' || regime === 'mei') atual.simples = true
    atual.qtdNotas++
    atual.totalEntradas = round2(atual.totalEntradas + (Number(n.valorTotal) || 0))
    atual.creditoIBS = round2(atual.creditoIBS + (Number(n.totalIBS) || 0))
    atual.creditoCBS = round2(atual.creditoCBS + (Number(n.totalCBS) || 0))
    atual.creditoTotal = round2(atual.creditoTotal + (Number(n.totalTributos) || 0))
  }
  return [...mapa.values()].sort((a, b) => b.creditoTotal - a.creditoTotal).slice(0, limite)
}

/** Totais agregados de uma lista de notas (base = valorTotal da nota). */
export function totaisNotas(notas: NotaXml[]) {
  let base = 0
  let ibs = 0
  let cbs = 0
  let entradas = 0
  let saidas = 0
  let quarentena = 0
  for (const n of notas) {
    base = round2(base + (Number(n.valorTotal) || 0))
    ibs = round2(ibs + (Number(n.totalIBS) || 0))
    cbs = round2(cbs + (Number(n.totalCBS) || 0))
    if (n.direcao === 'entrada') entradas++
    else if (n.direcao === 'saida') saidas++
    else quarentena++
  }
  const trib = round2(ibs + cbs)
  return { qtd: notas.length, entradas, saidas, quarentena, base, ibs, cbs, trib, carga: base > 0 ? (trib / base) * 100 : 0 }
}

/* ------------------------------------------------------------------ escrita -- */

/** Vincula os itens das notas ao cadastro de produtos (upsert por SKU = cProd). */
export async function vincularProdutosNfe(
  empresaId: number,
  notas: NotaXml[],
): Promise<{ salvos: number; atualizados: number; ignorados: number }> {
  const gravaveis: ItemLoteGravavel[] = []
  for (const n of notas) {
    for (const it of n.itensAnalisados) {
      gravaveis.push({
        codigo: it.codProd,
        nome: it.descricao || it.codProd,
        ncm: it.ncm,
        cfop: it.cfop,
        cstIcms: it.cstIcms,
        pis: it.cstPis,
        cofins: it.cstCofins,
        quantidade: Number(it.qtd) || 0,
        valorUnitario: Number(it.vlUnit) || 0,
        classificacao: it.classificacao,
      })
    }
  }
  return salvarProdutosEmLote(gravaveis, empresaId)
}

/** Exclui a nota e remove o XML do disco (falha no disco não impede a exclusão). */
export async function excluirNota(nota: NotaXml): Promise<void> {
  if (nota.id == null) return
  await db.nfeNotas.delete(nota.id)
  try {
    await removerXmlImportado(nota.arquivo)
  } catch {
    /* disco indisponível — o registro já saiu */
  }
}

/* ------------------------------------------ reaplicar classificação vigente -- */

/**
 * Reaplica a classificação vigente (base oficial > manual > regra geral) em
 * todos os itens de uma nota já importada — é o "forçar atualização" quando
 * uma reclassificação manual (ou a base oficial) mudou depois da importação.
 *
 * Usa o `refIBS/refCBS` guardado na própria nota para não misturar
 * referências entre importações. Retorna quantos itens foram tocados e
 * quantos realmente mudaram de enquadramento/valores.
 */
export async function reaplicarClassificacaoNota(
  notaId: number,
): Promise<{ ok: true; itens: number; alterados: number } | { ok: false; motivo: string }> {
  const nota = await db.nfeNotas.get(notaId)
  if (!nota) return { ok: false, motivo: 'Nota não encontrada.' }
  const ref = {
    refIBS: Number(nota.refIBS) || REF_DEFAULT.IBS,
    refCBS: Number(nota.refCBS) || REF_DEFAULT.CBS,
  }
  const refeitos = await analisarItensNfe(nota.itensAnalisados ?? [], ref)
  let alterados = 0
  const antes = nota.itensAnalisados ?? []
  for (let i = 0; i < refeitos.length; i++) {
    const a = antes[i]
    const b = refeitos[i]
    if (
      !a ||
      a.classificacao?.cst !== b.classificacao.cst ||
      a.classificacao?.cClassTrib !== b.classificacao.cClassTrib ||
      Number(a.redIBS) !== Number(b.redIBS) ||
      Number(a.redCBS) !== Number(b.redCBS) ||
      Number(a.ibs) !== Number(b.ibs) ||
      Number(a.cbs) !== Number(b.cbs) ||
      Boolean(a.regraGeral) !== Boolean(b.regraGeral) ||
      Boolean(a.manual) !== Boolean(b.manual)
    ) {
      alterados++
    }
  }
  const tot = totaisItensNfe(refeitos)
  await db.nfeNotas.put({
    ...nota,
    itensAnalisados: refeitos,
    totalIBS: tot.totalIBS,
    totalCBS: tot.totalCBS,
    totalTributos: tot.totalTributos,
  })
  return { ok: true, itens: refeitos.length, alterados }
}
