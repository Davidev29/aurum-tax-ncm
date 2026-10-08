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
  PendenteCadastroXml,
  ResumoImportacaoXml,
} from '@/infrastructure/nfe/tipos'
import { salvarProdutosEmLote, type ItemLoteGravavel } from './produtos'
import { mapaRegrasProdutos, type MapaRegraProduto } from './regra-produto'
import { completarEmpresa } from './empresas'
import { norm } from '@/domain/services/format'
import { round2 } from '@/domain/services/calculo'
import { regimeDoEmitente } from '@/infrastructure/nfe/regime'
import { classificarNatOp, efeitoDoItem } from '@/infrastructure/nfe/cfop'
import type { NotaXmlBruta } from '@/infrastructure/nfe/tipos'

/**
 * Estacionamento de notas sem dono cadastrado.
 *
 * Quando um XML não pertence a nenhuma empresa do banco (nem à ativa), ele
 * NÃO vai para a ativa como quarentena visível — vai para este `empresaId`
 * reservado. Assim o cadastro atual nunca enxerga notas que não são do
 * perfil dele (`listarNotas` filtra por `empresaId`), e o cadastro futuro do
 * contribuinte adota as notas automaticamente.
 *
 * `0` nunca colide com `++id` do SQLite (começa em 1).
 */
export const EMPRESA_ORFA_ID = 0

type OuvinteNotas = (empresaIds: number[]) => void
const ouvintesNotas = new Set<OuvinteNotas>()

/** Reatividade cruzada: avisa quem exibe notas que os dados mudaram. */
export function assinarMudancaNotas(fn: OuvinteNotas): () => void {
  ouvintesNotas.add(fn)
  return () => {
    ouvintesNotas.delete(fn)
  }
}

function notificarNotasMudaram(empresaIds: number[]): void {
  if (!empresaIds.length) return
  const unicos = [...new Set(empresaIds)]
  for (const fn of [...ouvintesNotas]) {
    try {
      fn(unicos)
    } catch {
      /* ouvinte nunca quebra o fluxo */
    }
  }
}

 /* -------------------------------------------------------------- importação -- */
/**
 * Importa XMLs de NF-e/NFC-e com roteamento por CNPJ.
 *
 * - a nota vai para o cadastro cujo CNPJ participa dela (emitente →
 *   saída, destinatário → entrada), seja a empresa ativa ou outra já
 *   cadastrada — nunca para um cadastro estranho;
 * - XML que não pertence a ninguém cadastrado é estacionado como órfão
 *   (`EMPRESA_ORFA_ID`, invisível à ativa) até o contribuinte ser
 *   cadastrado — quando isso acontece, as notas são adotadas;
 * - XML entre dois cadastros do sistema é espelhado (1 linha por dono);
 * - o motor (totais/apuração) deve ser recarregado após cada retorno com
 *   `novas > 0` — o resumo traz `menorData`/`maiorData` para expansão
 *   reativa do filtro e `pendentesCadastro` para o 1-clique BrasilAPI.
 *
 * Garantias:
 * - empresa com `id` é obrigatória (o chamador valida e avisa);
 * - chave duplicada **na empresa dona** é pulada (nunca duplica);
 * - falha num arquivo não aborta o lote (vira linha de `erros`);
 * - falha ao guardar o XML também vira erro — a nota não persiste pela metade.
 */
export async function importarXmls(
  arquivos: File[],
  empresa: Empresa,
  ref: { refIBS: number; refCBS: number } = { refIBS: REF_DEFAULT.IBS, refCBS: REF_DEFAULT.CBS },
  onProgress?: (feito: number, total: number) => void,
): Promise<ResumoImportacaoXml> {
  const empresaId = empresa.id
  if (empresaId == null) throw new Error('Empresa sem identificador.')
  const resumo: ResumoImportacaoXml = {
    novas: 0,
    duplicadas: 0,
    quarentena: 0,
    erros: [],
    redirecionadas: 0,
    orfas: 0,
    pendentesCadastro: [],
    menorData: null,
    maiorData: null,
  }
  const pendentes = new Map<string, PendenteCadastroXml>()
  const anotarPendente = (cnpjBruto: string | undefined, nome: string, papel: PendenteCadastroXml['papel']) => {
    const cnpj = norm(cnpjBruto)
    if (cnpj.length !== 14) return
    const atual = pendentes.get(cnpj)
    if (!atual) {
      pendentes.set(cnpj, { cnpj, nome: nome || cnpj, papel, qtd: 1 })
      return
    }
    atual.qtd++
    if (nome && atual.nome === atual.cnpj) atual.nome = nome
    if (atual.papel !== papel) atual.papel = 'ambos'
  }

  // Mapa de donos conhecidos: todas as cadastradas + a ativa passada
  // (a ativa pode não estar persistida ainda nos testes — ainda assim é dona).
  let cadastradas: Empresa[] = []
  try {
    cadastradas = await db.empresas.toArray()
  } catch {
    cadastradas = []
  }
  const donos = new Map<string, Empresa>()
  for (const e of cadastradas) {
    const k = norm(e.cnpj)
    if (k && !donos.has(k)) donos.set(k, e)
  }
  const chaveAtiva = norm(empresa.cnpj)
  if (chaveAtiva && !donos.has(chaveAtiva)) donos.set(chaveAtiva, empresa)

  const tocadas = new Set<number>()
  const tocarData = (iso: string) => {
    if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return
    if (resumo.menorData == null || iso < resumo.menorData) resumo.menorData = iso
    if (resumo.maiorData == null || iso > resumo.maiorData) resumo.maiorData = iso
  }
  // Regras do cadastro por dono (SKU + empresa) — um mapa por empresa para a
  // importação inteira, não por arquivo.
  const mapas = new Map<number, MapaRegraProduto>()

  for (let i = 0; i < arquivos.length; i++) {
    const file = arquivos[i]
    try {
      const conteudo = await file.text()
      const bruta = parseXmlNfe(conteudo, file.name)
      const emit = norm(bruta.emitCnpj)
      const dest = norm(bruta.destDoc)
      const donoEmit = emit ? donos.get(emit) : undefined
      const donoDest = dest ? donos.get(dest) : undefined

      // Alvos: espelha quando emitente e destinatário são cadastros distintos.
      // Sem CNPJ na ativa (legado manual), o roteamento por CNPJ é impossível:
      // tudo vai para a ativa como quarentena visível (comportamento anterior).
      type Alvo = { dono: Empresa | null; direcao: 'entrada' | 'saida' | 'quarentena' }
      let alvos: Alvo[] = []
      if (!chaveAtiva) {
        alvos = [{ dono: empresa, direcao: 'quarentena' }]
      } else if (donoEmit && donoDest && donoEmit.id != null && donoDest.id != null && donoEmit.id !== donoDest.id) {
        alvos = [
          { dono: donoEmit, direcao: classificarDirecao(bruta.emitCnpj, bruta.destDoc, donoEmit.cnpj) },
          { dono: donoDest, direcao: classificarDirecao(bruta.emitCnpj, bruta.destDoc, donoDest.cnpj) },
        ]
      } else if (donoEmit && donoEmit.id != null) {
        alvos = [{ dono: donoEmit, direcao: classificarDirecao(bruta.emitCnpj, bruta.destDoc, donoEmit.cnpj) }]
      } else if (donoDest && donoDest.id != null) {
        alvos = [{ dono: donoDest, direcao: classificarDirecao(bruta.emitCnpj, bruta.destDoc, donoDest.cnpj) }]
      } else {
        alvos = [{ dono: null, direcao: 'quarentena' }]
      }

      const ehOrfa = alvos.length === 1 && alvos[0].dono === null
      if (ehOrfa) {
        anotarPendente(bruta.emitCnpj, bruta.emitNome, 'emitente')
        if (bruta.destDoc) anotarPendente(bruta.destDoc, bruta.destNome, 'destinatario')
      }

      // Análise por dono (não mais uma vez por arquivo): cada espelho usa as
      // regras salvas no cadastro do SEU dono — SKU + empresa. Sem dono
      // (órfã), motor puro.
      const analises = new Map<number, { itens: Awaited<ReturnType<typeof analisarItensNfe>>; tot: ReturnType<typeof totaisItensNfe> }>()
      const agora = new Date().toISOString()

      let gravouAlguma = false
      for (const alvo of alvos) {
        const idDono = alvo.dono?.id ?? EMPRESA_ORFA_ID
        const existente = await db.nfeNotas
          .where('[empresaId+chave]')
          .equals([idDono, bruta.chave])
          .first()
        if (existente) {
          resumo.duplicadas++
          continue
        }
        let an = analises.get(idDono)
        if (!an) {
          let mapa = mapas.get(idDono)
          if (!mapa) {
            mapa = await mapaRegrasProdutos(alvo.dono?.id ?? null)
            mapas.set(idDono, mapa)
          }
          const itensAnalisados = await analisarItensNfe(bruta.itens, ref, undefined, { regras: mapa })
          an = { itens: itensAnalisados, tot: totaisItensNfe(itensAnalisados) }
          analises.set(idDono, an)
        }
        const { itens: itensAnalisados, tot } = an
        // Pasta do dono (isolamento também no disco); órfã usa o emitente.
        const pastaCnpj = (alvo.dono?.cnpj || bruta.emitCnpj || 'avulso') as string
        const { arquivo, xmlConteudo } = await salvarXmlImportado(pastaCnpj, bruta.chave, conteudo)
        const nota: NotaXml = {
          ...bruta,
          empresaId: idDono,
          direcao: alvo.direcao,
          arquivo,
          xmlConteudo,
          refIBS: ref.refIBS,
          refCBS: ref.refCBS,
          totalIBS: tot.totalIBS,
          totalCBS: tot.totalCBS,
          totalTributos: tot.totalTributos,
          importadoEm: agora,
          itensAnalisados,
        }
        await db.nfeNotas.add(nota)
        resumo.novas++
        gravouAlguma = true
        if (alvo.direcao === 'quarentena') resumo.quarentena++
        if (alvo.dono === null) resumo.orfas = (resumo.orfas ?? 0) + 1
        else if (alvo.dono.id !== empresaId) resumo.redirecionadas = (resumo.redirecionadas ?? 0) + 1
        tocadas.add(idDono)
        tocarData(bruta.dataEmissao)
        // Enriquecimento best-effort no DONO (não na ativa alheia).
        if (alvo.dono?.id != null) {
          void completarEmpresaComNota(alvo.dono.id, alvo.dono.cnpj, bruta)
        }
      }
      void gravouAlguma
    } catch (e) {
      resumo.erros.push({ arquivo: file.name, motivo: e instanceof Error ? e.message : String(e) })
    }
    onProgress?.(i + 1, arquivos.length)
  }

  resumo.pendentesCadastro = [...pendentes.values()].sort((a, b) => b.qtd - a.qtd)
  notificarNotasMudaram([...tocadas])
  return resumo
}

/**
 * Totais + apuração sempre reativos: rode após CADA importação/adoção/
 * exclusão sobre os documentos da empresa — é o "motor de comparação"
 * (débitos destacados nas saídas − créditos destacados nas entradas) que
 * decide saldo devedor ou credor no período.
 */
export async function apuracaoDaEmpresa(empresaId: number): Promise<{
  qtd: number
  menorData: string | null
  maiorData: string | null
  apuracao: import('@/infrastructure/nfe/apuracao').ApuracaoIbsCbs
}> {
  const notas = await db.nfeNotas.where('empresaId').equals(empresaId).toArray()
  const { apurarIbsCbs } = await import('@/infrastructure/nfe/apuracao')
  let menor: string | null = null
  let maior: string | null = null
  for (const n of notas) {
    const d = String(n.dataEmissao || '')
    if (!/^\d{4}-\d{2}-\d{2}/.test(d)) continue
    if (menor == null || d < menor) menor = d
    if (maior == null || d > maior) maior = d
  }
  return { qtd: notas.length, menorData: menor, maiorData: maior, apuracao: apurarIbsCbs(notas) }
}

/** Notas estacionadas sem dono (invisíveis a qualquer cadastro). */
export async function listarNotasOrfas(limite = 200): Promise<NotaXml[]> {
  const todas = await db.nfeNotas.where('empresaId').equals(EMPRESA_ORFA_ID).toArray()
  todas.sort((a, b) => (a.dataEmissao < b.dataEmissao ? 1 : -1))
  return todas.slice(0, Math.max(1, limite))
}

/**
 * CNPJs distintos nas órfãs — base do banner "contribuinte novo: cadastrar
 * via BrasilAPI em 1 clique". Agrega por CNPJ com papel e quantidade.
 */
export async function listarCnpjsPendentes(): Promise<PendenteCadastroXml[]> {
  const orfas = await db.nfeNotas.where('empresaId').equals(EMPRESA_ORFA_ID).toArray()
  const mapa = new Map<string, PendenteCadastroXml & { comoEmit: number; comoDest: number }>()
  for (const n of orfas) {
    const emit = norm(n.emitCnpj)
    if (emit.length === 14) {
      const a = mapa.get(emit) ?? { cnpj: emit, nome: n.emitNome || emit, papel: 'emitente' as const, qtd: 0, comoEmit: 0, comoDest: 0 }
      a.qtd++
      a.comoEmit++
      if (n.emitNome && a.nome === a.cnpj) a.nome = n.emitNome
      mapa.set(emit, a)
    }
    const dest = norm((n as NotaXml).destDoc)
    if (dest.length === 14 && dest !== emit) {
      const a = mapa.get(dest) ?? { cnpj: dest, nome: (n as NotaXml).destNome || dest, papel: 'destinatario' as const, qtd: 0, comoEmit: 0, comoDest: 0 }
      a.qtd++
      a.comoDest++
      if ((n as NotaXml).destNome && a.nome === a.cnpj) a.nome = (n as NotaXml).destNome
      mapa.set(dest, a)
    }
  }
  return [...mapa.values()]
    .map(({ comoEmit, comoDest, ...r }) => ({
      ...r,
      papel: (comoEmit > 0 && comoDest > 0 ? 'ambos' : comoEmit > 0 ? 'emitente' : 'destinatario') as PendenteCadastroXml['papel'],
    }))
    .sort((a, b) => b.qtd - a.qtd)
}

/**
 * Adoção automática: transfere para a empresa tudo que é dela —
 * órfãs estacionadas + quarentenas legadas gravadas no cadastro errado —
 * recalculando a direção (entrada/saída) pelo CNPJ dela.
 *
 * Nunca rouba entrada/saída de outro cadastro: só move órfãs ou quarentena.
 */
export async function adotarNotasParaEmpresa(empresa: Empresa): Promise<{
  adotadas: number
  saidas: number
  entradas: number
}> {
  const out = { adotadas: 0, saidas: 0, entradas: 0 }
  const id = empresa.id
  if (id == null) return out
  const cnpj = norm(empresa.cnpj)
  if (!cnpj) return out
  // Órfãs dela.
  const orfas = await db.nfeNotas.where('empresaId').equals(EMPRESA_ORFA_ID).toArray()
  // Quarentenas legadas que na verdade são dela (base antiga jogava tudo na ativa).
  let quarentenas: NotaXml[] = []
  try {
    quarentenas = await db.nfeNotas.where('direcao').equals('quarentena').toArray()
  } catch {
    quarentenas = await db.nfeNotas.toArray().then((t) => t.filter((n) => n.direcao === 'quarentena'))
  }
  const candidatas = [
    ...orfas.filter((n) => norm(n.emitCnpj) === cnpj || norm(n.destDoc) === cnpj),
    ...quarentenas.filter(
      (n) => n.empresaId !== id && (norm(n.emitCnpj) === cnpj || norm(n.destDoc) === cnpj),
    ),
  ]
  // Evita processar a mesma linha 2x (órfã também indexada por direção).
  const vistas = new Set<number>()
  for (const nota of candidatas) {
    if (nota.id == null || vistas.has(nota.id)) continue
    vistas.add(nota.id)
    const novaDirecao = classificarDirecao(nota.emitCnpj, nota.destDoc, empresa.cnpj)
    const jaExiste = await db.nfeNotas.where('[empresaId+chave]').equals([id, nota.chave]).first()
    if (jaExiste) {
      // A dona já tem a chave (espelho anterior): remove o fantasma.
      await db.nfeNotas.delete(nota.id)
      try {
        if (nota.arquivo) await removerXmlImportado(nota.arquivo)
      } catch {
        /* disco best-effort */
      }
      out.adotadas++
      continue
    }
    await db.nfeNotas.put({ ...nota, empresaId: id, direcao: novaDirecao })
    out.adotadas++
    if (novaDirecao === 'saida') out.saidas++
    else if (novaDirecao === 'entrada') out.entradas++
    void completarEmpresaComNota(id, empresa.cnpj, nota)
  }
  if (out.adotadas > 0) notificarNotasMudaram([id, EMPRESA_ORFA_ID])
  return out
}

/** Atalho para testes/migração: realoca quarentenas para os donos atuais. */
export async function realocarQuarentenaLegada(): Promise<{ movidas: number }> {
  let empresas: Empresa[] = []
  try {
    empresas = await db.empresas.toArray()
  } catch {
    return { movidas: 0 }
  }
  let movidas = 0
  for (const e of empresas) {
    if (e.id == null) continue
    const r = await adotarNotasParaEmpresa(e)
    movidas += r.adotadas
  }
  return { movidas }
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
  // Ordenadas por emissão DESC (mais recentes primeiro): `sortBy` do motor é
  // terminal ascendente, então ordena em JS aqui (D1 da auditoria SQLite).
  const notas = (await col.toArray()).sort((a, b) =>
    String(a.dataEmissao ?? '').localeCompare(String(b.dataEmissao ?? '')),
  ).reverse()

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
    // Busca textual também na capa da nota (natureza da operação, número,
    // chave, emitente) — antes só casava com item (descrição/código/NCM) e a
    // natureza ficava inencontrável pelo filtro.
    const textoCapa = `${n.natOp} ${n.numero} ${n.chave} ${n.emitNome} ${n.emitCnpj}`.toLowerCase()
    const itens = n.itensAnalisados ?? []
    if (!itens.length) {
      if (cfop || cstIcms || cct || cstRef || red) return false
      if (!texto) return true
      return textoCapa.includes(texto)
    }
    // Linhas parciais podem ter `itensAnalisados` nulo ou itens sem
    // classificação (nunca derruba o filtro — só não casa).
    return itens.some((it) => {
      if (!it || typeof it !== 'object') return false
      if (cfop && it.cfop !== cfop) return false
      if (cstIcms && String(it.cstIcms ?? '').trim().toUpperCase() !== cstIcms) return false
      // Reforma: a tabela exibe o CST/cClassTrib destacado no XML primeiro e
      // o do sistema como fallback — o filtro casa com qualquer um dos dois.
      if (cct && ![it.cClassTribIbsCbs, it.classificacao?.cClassTrib].some((v) => String(v ?? '').includes(cct))) return false
      if (cstRef && ![it.cstIbsCbs, it.classificacao?.cst].some((v) => String(v ?? '').trim().toUpperCase() === cstRef)) return false
      if (red && it.anexo !== red) return false
      if (!texto) return true
      if (textoCapa.includes(texto)) return true
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

/** Anos distintos com notas (para navegar o calendário anual). */
export async function listarAnosComNota(empresaId: number): Promise<number[]> {
  const notas = await db.nfeNotas.where('empresaId').equals(empresaId).toArray()
  const set = new Set<number>()
  for (const n of notas) {
    const ano = Number(String(n.dataEmissao ?? '').slice(0, 4))
    if (Number.isInteger(ano) && ano > 0) set.add(ano)
  }
  return [...set].sort((a, b) => b - a)
}

/** Meses do ano com notas (1–12 → qtd) — base do calendário anual. */
export async function contarMesesAno(
  empresaId: number,
  ano: number,
): Promise<Map<number, number>> {
  const prefixo = `${ano}-`
  const notas = await db.nfeNotas
    .where('empresaId')
    .equals(empresaId)
    .and((n) => String(n.dataEmissao ?? '').startsWith(prefixo))
    .toArray()
  const mapa = new Map<number, number>()
  for (const n of notas) {
    const mes = Number(String(n.dataEmissao ?? '').slice(5, 7))
    if (mes >= 1 && mes <= 12) mapa.set(mes, (mapa.get(mes) ?? 0) + 1)
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
        creditoEfetivoIBS: 0,
        creditoEfetivoCBS: 0,
        creditoEfetivoTotal: 0,
        qtdNaoVenda: 0,
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
    // Efetivo = o que veio destacado na nota (apuração assistida usa este).
    const temCampoXml = n.totalIbsXml !== undefined || n.totalCbsXml !== undefined
    const efIbs = temCampoXml ? Number(n.totalIbsXml) || 0 : Number(n.totalIBS) || 0
    const efCbs = temCampoXml ? Number(n.totalCbsXml) || 0 : Number(n.totalCBS) || 0
    atual.creditoEfetivoIBS = round2((atual.creditoEfetivoIBS ?? 0) + efIbs)
    atual.creditoEfetivoCBS = round2((atual.creditoEfetivoCBS ?? 0) + efCbs)
    atual.creditoEfetivoTotal = round2((atual.creditoEfetivoTotal ?? 0) + efIbs + efCbs)
    // Natureza diferente de venda (bloco acima dos gráficos).
    const restritivo = (n.itensAnalisados ?? []).some((it) => {
      const e = efeitoDoItem(it.cfop, n.natOp, 'entrada')
      return e === 'sem-efeito' || e === 'imobilizado'
    })
    if (classificarNatOp(n.natOp) === 'nao-venda' || classificarNatOp(n.natOp) === 'imobilizado' || restritivo) {
      atual.qtdNaoVenda = (atual.qtdNaoVenda ?? 0) + 1
    }
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
  notificarNotasMudaram([nota.empresaId])
}

/* ------------------------------------------ reaplicar classificação vigente -- */

/**
 * Reaplica a classificação vigente
 * (base oficial › manual global › regra do produto (SKU) › regra geral) em
 * todos os itens de uma nota já importada — é o "forçar atualização" quando
 * uma reclassificação manual, uma escolha salva no cadastro (conferência do
 * XML / lote) ou a base oficial mudou depois da importação.
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
  const regras = await mapaRegrasProdutos(nota.empresaId)
  const refeitos = await analisarItensNfe(nota.itensAnalisados ?? [], ref, undefined, { regras })
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
      Boolean(a.manual) !== Boolean(b.manual) ||
      Boolean(a.regraDoProduto) !== Boolean(b.regraDoProduto)
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
  notificarNotasMudaram([nota.empresaId])
  return { ok: true, itens: refeitos.length, alterados }
}

/**
 * Propaga as regras salvas no cadastro (SKU + empresa) para as notas que
 * contêm esses SKUs — é o que faz a **apuração assistida adotar na hora** o
 * que o usuário escolheu ao salvar (conferência do XML ou lote).
 *
 * Reaproveita `reaplicarClassificacaoNota` (que já aplica o overlay da regra
 * do produto e recalcula os totais da nota): só as notas da empresa com ao
 * menos um dos SKUs são tocadas. A notificação recarrega a tela sozinha.
 */
export async function propagarRegrasProdutosParaNotas(
  empresaId: number,
  codigos: string[],
): Promise<{ notas: number; itens: number }> {
  const out = { notas: 0, itens: 0 }
  const alvos = new Set(
    (codigos ?? []).map((c) => String(c ?? '').trim()).filter(Boolean),
  )
  if (!empresaId && empresaId !== 0) return out
  if (!alvos.size) return out
  let notas: NotaXml[] = []
  try {
    notas = await db.nfeNotas.where('empresaId').equals(empresaId).toArray()
  } catch {
    return out
  }
  for (const n of notas) {
    if (n.id == null) continue
    const tem = (n.itensAnalisados ?? []).some((it) =>
      alvos.has(String(it.codProd ?? '').trim()),
    )
    if (!tem) continue
    const r = await reaplicarClassificacaoNota(n.id)
    if (r.ok) {
      out.notas++
      out.itens += r.alterados
    }
  }
  return out
}
