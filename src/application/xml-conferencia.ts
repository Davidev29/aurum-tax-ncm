/**
 * Conferência de produtos vindos de XML — mesmo motor da importação em lote.
 *
 * Por que existe: um NCM pode ter mais de uma regra (2+ tributações oficiais,
 * diferimento condicional do Anexo IX, etc.). O botão "Vincular produtos"
 * gravava direto a 1ª opção como estimativa, sem deixar o usuário escolher.
 * Agora os itens do XML passam pelo MESMO pipeline do lote:
 * resolverClassificacoes -> expansão de diferimento -> integral de segurança
 * -> analisarItemLoteIA (única confirma / múltipla sugere integral) — e só
 * são gravados após revisão com aceite explícito.
 */
import { norm } from '@/domain/services/format'
import { interpretarEntradaNcm } from '@/domain/services/classificacao'
import { analisarItemLoteIA } from '@/domain/services/analise-lote-ia'
import { resolverClassificacoes } from '@/infrastructure/base/classificacao-repo'
import { escolherComRegraProduto, mapaRegrasProdutos } from '@/application/regra-produto'
import type { ItemLote } from '@/infrastructure/parsers/lote'
import type { NotaXml } from '@/infrastructure/nfe/tipos'

export interface ItemConferenciaXml extends ItemLote {
  /** Quantidade somada em todas as ocorrências do SKU nas notas filtradas. */
  quantidade: number
  /** Último valor unitário visto (cadastro guarda 1 preço por SKU). */
  valorUnitario: number
  /** Em quantas linhas/notas o SKU apareceu. */
  ocorrencias: number
  /** `true` quando a pré-seleção veio da regra salva no cadastro. */
  usouRegraDoCadastro?: boolean
  /** CST × cClassTrib salvos no cadastro (quando `usouRegraDoCadastro`). */
  regraDoCadastro?: { cst: string; cClassTrib: string } | null
}

export interface ResumoConferenciaXml {
  itens: ItemConferenciaXml[]
  /** Rótulo de origem (ex.: "8 nota(s) filtrada(s)"). */
  nomeOrigem: string
  comClassificacao: number
  regraGeral: number
  ambiguos: number
  semNcm: number
  unicas: number
  /** Itens pré-selecionados com a regra salva no cadastro. */
  comRegraDoCadastro: number
}

/**
 * Agrupa os itens das notas por SKU (cProd) e resolve cada NCM distinto com
 * o motor único — lógica espelhada de `processarArquivoLote` para paridade.
 *
 * Quando o cadastro já tem regra salva para o SKU (escolhida antes pelo
 * usuário entre as várias do NCM), ela vem **pré-selecionada**
 * (`usouRegraDoCadastro`) — o usuário só troca se a operação mudou.
 */
export async function prepararConferenciaXml(
  notas: NotaXml[],
  nomeOrigem = 'XML',
  onProgress?: (feito: number, total: number) => void,
  empresaId?: number | null,
): Promise<ResumoConferenciaXml> {
  type Agregado = {
    codigo: string
    nome: string
    ncmBruto: string
    cest: string
    cfop: string
    cstIcms: string
    pis: string
    cofins: string
    quantidade: number
    valorUnitario: number
    ocorrencias: number
  }
  const mapa = new Map<string, Agregado>()
  const ordem: string[] = []
  for (const n of notas) {
    for (const it of n.itensAnalisados ?? []) {
      const codigo = String(it.codProd ?? '').trim()
      if (!codigo) continue
      const chave = codigo
      let agg = mapa.get(chave)
      if (!agg) {
        agg = {
          codigo,
          nome: String(it.descricao || codigo).trim(),
          ncmBruto: String(it.ncmOriginal ?? it.ncm ?? ''),
          cest: String((it as { cest?: unknown }).cest ?? '').replace(/\D/g, '').slice(0, 7),
          cfop: String(it.cfop ?? ''),
          cstIcms: String(it.cstIcms ?? ''),
          pis: String(it.cstPis ?? ''),
          cofins: String(it.cstCofins ?? ''),
          quantidade: 0,
          valorUnitario: Number(it.vlUnit) || 0,
          ocorrencias: 0,
        }
        mapa.set(chave, agg)
        ordem.push(chave)
      }
      agg.quantidade += Number(it.qtd) || 0
      if (Number(it.vlUnit)) agg.valorUnitario = Number(it.vlUnit)
      agg.ocorrencias += 1
      // Nome mais longo tende a ser mais descritivo (xProd completo).
      const nomeAtual = String(it.descricao || '').trim()
      if (nomeAtual.length > agg.nome.length) agg.nome = nomeAtual
    }
  }

  type Veredito = Awaited<ReturnType<typeof resolverClassificacoes>>
  const cache = new Map<string, Veredito>()
  // Regras já salvas no cadastro (SKU + empresa) — uma leitura por preparo.
  const regras = await mapaRegrasProdutos(empresaId ?? null)
  const itens: ItemConferenciaXml[] = []

  for (let d = 0; d < ordem.length; d++) {
    const agg = mapa.get(ordem[d])!
    const entrada = interpretarEntradaNcm(agg.ncmBruto)
    const cod = norm(agg.ncmBruto)
    const base: ItemConferenciaXml = {
      indice: d,
      codigo: agg.codigo,
      nome: agg.nome,
      ncm: cod,
      cest: agg.cest,
      cfop: agg.cfop,
      cstIcms: agg.cstIcms,
      pis: agg.pis,
      cofins: agg.cofins,
      classificacoes: [],
      escolhida: null,
      regraGeral: false,
      quantidade: agg.quantidade,
      valorUnitario: agg.valorUnitario,
      ocorrencias: agg.ocorrencias,
    }

    // Política idêntica à do lote: só 8 dígitos exatos entram no motor.
    if (entrada.kind === 'ok') {
      const chave = entrada.codigo
      base.ncm = chave
      let veredito = cache.get(chave)
      if (!veredito) {
        veredito = await resolverClassificacoes(chave)
        cache.set(chave, veredito)
      }
      let listaEfetiva = veredito.lista
      // Desempate via grafo (best-effort, só reordena) — igual ao lote.
      try {
        if (veredito.lista.length > 1) {
          const { consultarGrafoPrimeiro, desempatarPorGrafo } = await import('@/application/grafo-consumo')
          const textoItem = String(agg.nome || chave).slice(0, 120) || chave
          const g = await consultarGrafoPrimeiro(textoItem, 5).catch(() => null)
          if (g && g.trilha.usouGrafo) {
            const r = desempatarPorGrafo(veredito.lista, g.trilha, chave)
            if (r.usouGrafo) listaEfetiva = r.lista
          }
        }
      } catch {
        /* mantém a ordem oficial */
      }
      // Expansão do diferimento condicional (Anexo IX) — igual ao lote.
      if (!veredito.regraGeral && !veredito.manual && !veredito.extinto) {
        try {
          const { classificacaoDiferimentoAnexoIX, temOpcaoDiferimento } = await import('@/domain/services/calculo')
          if (listaEfetiva.some((cl) => temOpcaoDiferimento(cl))) {
            const chaves = new Set(listaEfetiva.map((cl) => `${cl.cst}|${cl.cClassTrib}`))
            const expandida: typeof listaEfetiva = []
            for (const cl of listaEfetiva) {
              expandida.push(cl)
              if (temOpcaoDiferimento(cl)) {
                const virt = classificacaoDiferimentoAnexoIX(cl)
                const chaveVirt = `${virt.cst}|${virt.cClassTrib}`
                if (!chaves.has(chaveVirt)) {
                  expandida.push(virt)
                  chaves.add(chaveVirt)
                }
              }
            }
            listaEfetiva = expandida
          }
        } catch {
          /* enriquecimento nunca quebra o veredito */
        }
        // Integral de segurança como última opção — igual ao lote.
        const temIntegral = listaEfetiva.some(
          (cl) => cl.integralFallback || (cl.cst === '000' && cl.cClassTrib === '000001'),
        )
        if (!temIntegral) {
          try {
            const { classificacaoRegraGeral } = await import('@/infrastructure/base/classificacao-repo')
            const fb = await classificacaoRegraGeral(chave, veredito.nomenclatura)
            fb.integralFallback = true
            fb.id = `INTEGRAL|${fb.codigo}`
            listaEfetiva = [...listaEfetiva, fb]
          } catch {
            /* segurança best-effort */
          }
        }
      }
      base.classificacoes = listaEfetiva
      base.regraGeral = veredito.regraGeral
      base.manual = veredito.manual || veredito.lista.some((c) => c.manual != null)
      base.nomenclatura = veredito.nomenclatura
      const analise = analisarItemLoteIA({
        nome: agg.nome,
        ncm: chave,
        classificacoes: listaEfetiva,
        regraGeral: veredito.regraGeral,
        manual: base.manual ?? false,
        extinto: veredito.extinto,
        nomenclaturaDescricao: veredito.nomenclatura?.descricao ?? null,
      })
      base.analiseIA = analise
      const padrao = listaEfetiva[analise.maisProvavelIndice] ?? listaEfetiva[0] ?? null
      base.escolhida = padrao
      // Regra salva no cadastro: se o SKU já tem escolha do usuário para
      // este NCM (e ela existe entre as opções e difere do padrão), ela vem
      // pré-selecionada — manual global e regra geral nunca entram aqui.
      base.usouRegraDoCadastro = false
      base.regraDoCadastro = null
      if (!base.manual && !base.regraGeral) {
        const salva = escolherComRegraProduto(listaEfetiva, chave, regras.get(agg.codigo) ?? null)
        if (salva && padrao && (salva.id !== padrao.id || salva.cst !== padrao.cst)) {
          base.escolhida = salva
          base.usouRegraDoCadastro = true
          base.regraDoCadastro = { cst: salva.cst, cClassTrib: salva.cClassTrib }
        }
      }
    } else {
      base.analiseIA = analisarItemLoteIA({
        nome: agg.nome,
        ncm: base.ncm,
        classificacoes: [],
        regraGeral: false,
        manual: false,
        extinto: false,
        nomenclaturaDescricao: null,
      })
    }

    itens.push(base)
    if (onProgress && (d % 10 === 0 || d === ordem.length - 1)) onProgress(d + 1, ordem.length)
  }

  const comAnalise = (s: string) => itens.filter((i) => i.analiseIA?.situacao === s).length
  return {
    itens,
    nomeOrigem,
    comClassificacao: itens.filter((i) => i.escolhida).length,
    regraGeral: itens.filter((i) => i.regraGeral).length,
    ambiguos: itens.filter((i) => i.analiseIA?.situacao === 'multipla').length,
    semNcm: itens.filter((i) => i.ncm.length !== 8).length,
    unicas: comAnalise('unica'),
    comRegraDoCadastro: itens.filter((i) => i.usouRegraDoCadastro).length,
  }
}
