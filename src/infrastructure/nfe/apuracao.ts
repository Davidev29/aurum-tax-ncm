/**
 * Apuração **assistida** de IBS/CBS sobre as notas importadas — espelha a
 * lógica do portal da Reforma (tributação sobre o consumo): **débitos** das
 * saídas menos **créditos** das entradas, por tributo e no total.
 *
 * Regras:
 * - **saída de venda** (emitida pela empresa, CFOP/natureza de venda) →
 *   **débito** integral de IBS + CBS estimados. Saída com CFOP diferente de
 *   venda vai para `debitoSemEfeito*` (informativo, fora do saldo);
 * - **entrada de emitente em regime normal** (recebida de fornecedor, ou
 *   seja: ele emitiu, você recebe o **crédito**) → a apuração assistida usa o
 *   **crédito EFETIVO: o que veio destacado na nota** (`totalIbsXml` /
 *   `totalCbsXml`, grupo `imposto/IBSCBS`). É este valor que abate o saldo;
 * - a estimativa **via NCM** (`totalIBS` / `totalCBS`, "Análise pelo NCM —
 *   Pela reforma") é **INFORMATIVA**: não abate o saldo. O bloco da tela
 *   mostra a diferença (nota − NCM) e o cliente decide o que fazer;
 * - **nota legada sem os campos do XML** (`totalIbsXml` ausente — dado
 *   anterior à Reforma): o efetivo usa a estimativa NCM como proxy e o
 *   bloco sinaliza `creditoProvisorio` (vale conferir o XML);
 * - **entrada de Simples/MEI** → crédito **bloqueado** (não transfere, LC
 *   214/2025) — somado à parte, nunca abatido;
 * - **entrada com regime desconhecido** → crédito **não confirmado** —
 *   também à parte, por prudência (não afirma o que o XML não prova);
 * - **CFOP diferente de venda / compra para imobilizado** (`./cfop`) →
 *   separado em `semEfeito*` / `imobilizado*` (informativos, fora do
 *   crédito) — o detalhamento fica no bloco de naturezas da operação;
 * - **quarentena** → fora da apuração (direção indefinida), apenas contada.
 *
 * Tudo em R$ com arredondamento de centavos; a comparação final usa tolerância
 * de R$ 0,005 para não gerar "a pagar R$ 0,00" por resíduo de float.
 */
import type { NotaXml } from './tipos'
import { classificarNatOp, efeitoDoItem } from './cfop'
import { regimeDoEmitente } from './regime'

export type ResultadoApuracao = 'a-pagar' | 'saldo-credor' | 'zerado' | 'sem-movimento'

export interface ApuracaoIbsCbs {
  qtdSaidas: number
  qtdEntradasApropriaveis: number
  qtdEntradasBloqueadas: number
  qtdEntradasNaoConfirmadas: number
  qtdQuarentena: number
  baseSaidas: number
  baseEntradas: number
  debitoIBS: number
  debitoCBS: number
  debitoTotal: number
  /** Saídas com CFOP/natureza diferente de venda (informativo, fora do saldo). */
  debitoSemEfeitoIBS: number
  debitoSemEfeitoCBS: number
  debitoSemEfeitoTotal: number
  qtdSaidasSemEfeito: number
  /**
   * Crédito **informativo** — análise pelo NCM ("Pela reforma", estimado pelo
   * sistema). NÃO abate o saldo; o cliente decide o que fazer com ele.
   * Mantido com o nome histórico por compatibilidade.
   */
  creditoIBS: number
  creditoCBS: number
  creditoTotal: number
  /**
   * Crédito **efetivo** — o que veio destacado na nota do fornecedor
   * (`totalIbsXml`/`totalCbsXml`). É este valor que a apuração assistida
   * abate dos débitos.
   */
  creditoEfetivoIBS: number
  creditoEfetivoCBS: number
  creditoEfetivoTotal: number
  /** Espelho explícito do informativo (NCM) para a UI não confundir. */
  creditoInformativoIBS: number
  creditoInformativoCBS: number
  creditoInformativoTotal: number
  /** `efetivo − informativo` (negativo = nota destacou menos que a Reforma). */
  divergenciaCreditoIBS: number
  divergenciaCreditoCBS: number
  divergenciaCreditoTotal: number
  /** Entradas de regime normal com ao menos um item gerador de crédito. */
  qtdEntradasEfetivas: number
  baseEntradasEfetiva: number
  /**
   * `true` quando ao menos uma nota legada (sem os campos do XML) usou a
   * estimativa NCM como proxy do efetivo — vale conferir o XML.
   */
  creditoProvisorio: boolean
  /** Itens com CFOP diferente de venda (informativo, fora do crédito). */
  semEfeitoIBS: number
  semEfeitoCBS: number
  semEfeitoTotal: number
  qtdSemEfeito: number
  /** Itens de imobilizado / uso e consumo (informativo, sem crédito). */
  imobilizadoIBS: number
  imobilizadoCBS: number
  imobilizadoTotal: number
  qtdImobilizado: number
  bloqueadoIBS: number
  bloqueadoCBS: number
  bloqueadoTotal: number
  naoConfirmadoIBS: number
  naoConfirmadoCBS: number
  naoConfirmadoTotal: number
  saldoIBS: number
  saldoCBS: number
  saldoTotal: number
  resultado: ResultadoApuracao
  /** > 0 quando `a-pagar`; senão 0. */
  valorAPagar: number
  /** > 0 quando `saldo-credor` (módulo, p/ restituição ou compensação). */
  saldoCredor: number
}

const cent = (v: number | null | undefined): number => Math.round((Number(v) || 0) * 100) / 100

type EntradaApuracao = Pick<
  NotaXml,
  'direcao' | 'totalIBS' | 'totalCBS' | 'valorTotal' | 'emitCrt' | 'itensAnalisados'
> &
  Partial<Pick<NotaXml, 'natOp' | 'totalIbsXml' | 'totalCbsXml'>>

export function apurarIbsCbs(notas: EntradaApuracao[]): ApuracaoIbsCbs {
  const a: ApuracaoIbsCbs = {
    qtdSaidas: 0,
    qtdEntradasApropriaveis: 0,
    qtdEntradasBloqueadas: 0,
    qtdEntradasNaoConfirmadas: 0,
    qtdQuarentena: 0,
    baseSaidas: 0,
    baseEntradas: 0,
    debitoIBS: 0,
    debitoCBS: 0,
    debitoTotal: 0,
    debitoSemEfeitoIBS: 0,
    debitoSemEfeitoCBS: 0,
    debitoSemEfeitoTotal: 0,
    qtdSaidasSemEfeito: 0,
    creditoIBS: 0,
    creditoCBS: 0,
    creditoTotal: 0,
    creditoEfetivoIBS: 0,
    creditoEfetivoCBS: 0,
    creditoEfetivoTotal: 0,
    creditoInformativoIBS: 0,
    creditoInformativoCBS: 0,
    creditoInformativoTotal: 0,
    divergenciaCreditoIBS: 0,
    divergenciaCreditoCBS: 0,
    divergenciaCreditoTotal: 0,
    qtdEntradasEfetivas: 0,
    baseEntradasEfetiva: 0,
    creditoProvisorio: false,
    semEfeitoIBS: 0,
    semEfeitoCBS: 0,
    semEfeitoTotal: 0,
    qtdSemEfeito: 0,
    imobilizadoIBS: 0,
    imobilizadoCBS: 0,
    imobilizadoTotal: 0,
    qtdImobilizado: 0,
    bloqueadoIBS: 0,
    bloqueadoCBS: 0,
    bloqueadoTotal: 0,
    naoConfirmadoIBS: 0,
    naoConfirmadoCBS: 0,
    naoConfirmadoTotal: 0,
    saldoIBS: 0,
    saldoCBS: 0,
    saldoTotal: 0,
    resultado: 'sem-movimento',
    valorAPagar: 0,
    saldoCredor: 0,
  }

  for (const n of notas) {
    const ibs = cent(n.totalIBS)
    const cbs = cent(n.totalCBS)
    if (n.direcao === 'saida') {
      // Você emitiu = débito seu — mas SÓ quando a operação é de venda.
      // Saída com CFOP/natureza diferente de venda vai para o bucket
      // informativo (não compõe o saldo assistido).
      const itensS = n.itensAnalisados ?? []
      a.baseSaidas = cent(a.baseSaidas + cent(n.valorTotal))
      if (!itensS.length) {
        const natS = classificarNatOp((n as { natOp?: string })?.natOp)
        if (natS === 'nao-venda' || natS === 'imobilizado') {
          a.qtdSaidasSemEfeito++
          a.debitoSemEfeitoIBS = cent(a.debitoSemEfeitoIBS + ibs)
          a.debitoSemEfeitoCBS = cent(a.debitoSemEfeitoCBS + cbs)
        } else {
          a.qtdSaidas++
          a.debitoIBS = cent(a.debitoIBS + ibs)
          a.debitoCBS = cent(a.debitoCBS + cbs)
        }
      } else {
        let vIbs = 0
        let vCbs = 0
        let sIbs = 0
        let sCbs = 0
        let temVenda = false
        let temSem = false
        for (const it of itensS) {
          const efeito = efeitoDoItem(
            (it as { cfop?: string })?.cfop,
            (n as { natOp?: string })?.natOp,
            'saida',
          )
          const nIbs = cent((it as { ibs?: number })?.ibs)
          const nCbs = cent((it as { cbs?: number })?.cbs)
          if (efeito === 'sem-efeito' || efeito === 'imobilizado') {
            temSem = true
            sIbs = cent(sIbs + nIbs)
            sCbs = cent(sCbs + nCbs)
          } else {
            temVenda = true
            vIbs = cent(vIbs + nIbs)
            vCbs = cent(vCbs + nCbs)
          }
        }
        if (vIbs + vCbs + sIbs + sCbs <= 0.005 && ibs + cbs > 0.005) {
          // Itens sem valores discriminados (sem detalhamento): o total da nota
          // segue o efeito dominante para não perder o débito.
          if (temSem && !temVenda) {
            sIbs = ibs
            sCbs = cbs
          } else {
            vIbs = ibs
            vCbs = cbs
            temVenda = true
          }
        }
        if (temVenda) {
          a.qtdSaidas++
          a.debitoIBS = cent(a.debitoIBS + vIbs)
          a.debitoCBS = cent(a.debitoCBS + vCbs)
        }
        if (temSem) {
          a.qtdSaidasSemEfeito++
          a.debitoSemEfeitoIBS = cent(a.debitoSemEfeitoIBS + sIbs)
          a.debitoSemEfeitoCBS = cent(a.debitoSemEfeitoCBS + sCbs)
        }
        if (!temVenda && !temSem) {
          // Saída sem itens classificáveis: conta como venda
          // (compatibilidade com o comportamento histórico).
          a.qtdSaidas++
          a.debitoIBS = cent(a.debitoIBS + ibs)
          a.debitoCBS = cent(a.debitoCBS + cbs)
        }
      }
    } else if (n.direcao === 'entrada') {
      a.baseEntradas = cent(a.baseEntradas + cent(n.valorTotal))
      const regime = regimeDoEmitente(n.emitCrt, n.itensAnalisados)
      if (regime === 'normal') {
        // Separa por CFOP: só "compra-gera" compõe o crédito; o restante
        // vai para os buckets informativos (sem efeito / imobilizado).
        const itens = n.itensAnalisados ?? []
        const temItens = itens.length > 0
        let infoIbs = 0
        let infoCbs = 0
        let xmlIbs = 0
        let xmlCbs = 0
        let semIbs = 0
        let semCbs = 0
        let imobIbs = 0
        let imobCbs = 0
        let temGera = false
        let temSem = false
        let temImob = false
        let baseEfetiva = 0
        for (const it of itens) {
          const efeito = efeitoDoItem(
            (it as { cfop?: string })?.cfop,
            (n as { natOp?: string })?.natOp,
            'entrada',
          )
          const ncmIbs = cent((it as { ibs?: number })?.ibs)
          const ncmCbs = cent((it as { cbs?: number })?.cbs)
          const xIbs = cent((it as { vIbsItem?: number })?.vIbsItem)
          const xCbs = cent((it as { vCbsItem?: number })?.vCbsItem)
          if (efeito === 'imobilizado') {
            temImob = true
            imobIbs = cent(imobIbs + ncmIbs)
            imobCbs = cent(imobCbs + ncmCbs)
          } else if (efeito === 'sem-efeito') {
            temSem = true
            semIbs = cent(semIbs + ncmIbs)
            semCbs = cent(semCbs + ncmCbs)
          } else {
            temGera = true
            infoIbs = cent(infoIbs + ncmIbs)
            infoCbs = cent(infoCbs + ncmCbs)
            xmlIbs = cent(xmlIbs + xIbs)
            xmlCbs = cent(xmlCbs + xCbs)
            baseEfetiva = cent(baseEfetiva + cent((it as { vlTotal?: number })?.vlTotal))
          }
        }
        if (!temItens) {
          // Nota sem itens discriminados: o total segue a natureza da capa
          // (venda = crédito; diferente de venda/imobilizado = buckets).
          const natE = classificarNatOp((n as { natOp?: string })?.natOp)
          if (natE === 'imobilizado') {
            temImob = true
            imobIbs = ibs
            imobCbs = cbs
          } else if (natE === 'nao-venda') {
            temSem = true
            semIbs = ibs
            semCbs = cbs
          } else {
            temGera = true
            infoIbs = ibs
            infoCbs = cbs
            baseEfetiva = cent(n.valorTotal)
          }
        } else if (infoIbs + infoCbs + semIbs + semCbs + imobIbs + imobCbs <= 0.005 && ibs + cbs > 0.005) {
          // Itens sem valores discriminados (sem detalhamento): o total da nota
          // segue o efeito dominante para não perder os valores.
          if (temSem && !temGera && !temImob) {
            semIbs = ibs
            semCbs = cbs
          } else if (temImob && !temGera && !temSem) {
            imobIbs = ibs
            imobCbs = cbs
          } else if (temGera && !temSem && !temImob) {
            infoIbs = ibs
            infoCbs = cbs
            baseEfetiva = cent(n.valorTotal)
          }
        }
        // Crédito EFETIVO = o que veio destacado na nota. Quando a nota é
        // legada (campos do XML ausentes), usa a estimativa NCM como proxy.
        const temCampoXml =
          (n as { totalIbsXml?: number }).totalIbsXml !== undefined ||
          (n as { totalCbsXml?: number }).totalCbsXml !== undefined
        let efIbs: number
        let efCbs: number
        if (!temCampoXml) {
          efIbs = infoIbs
          efCbs = infoCbs
          if (temGera) a.creditoProvisorio = true
        } else if (temGera && xmlIbs + xmlCbs <= 0.005) {
          // XML sem destaque de IBS/CBS: sem crédito comprovado na nota.
          // O informativo NCM segue exibido à parte para decisão.
          const declarado = cent(
            Number((n as { totalIbsXml?: number }).totalIbsXml) +
              Number((n as { totalCbsXml?: number }).totalCbsXml),
          )
          efIbs = 0
          efCbs = 0
          if (declarado > 0.005) {
            // Totais declarados sem detalhe por item: atribui ao gerador.
            efIbs = cent(Number((n as { totalIbsXml?: number }).totalIbsXml))
            efCbs = cent(Number((n as { totalCbsXml?: number }).totalCbsXml))
          }
        } else {
          efIbs = xmlIbs
          efCbs = xmlCbs
        }
        if (temGera) {
          a.qtdEntradasApropriaveis++
          a.qtdEntradasEfetivas++
          a.baseEntradasEfetiva = cent(a.baseEntradasEfetiva + baseEfetiva)
          a.creditoIBS = cent(a.creditoIBS + infoIbs)
          a.creditoCBS = cent(a.creditoCBS + infoCbs)
          a.creditoInformativoIBS = cent(a.creditoInformativoIBS + infoIbs)
          a.creditoInformativoCBS = cent(a.creditoInformativoCBS + infoCbs)
          a.creditoEfetivoIBS = cent(a.creditoEfetivoIBS + efIbs)
          a.creditoEfetivoCBS = cent(a.creditoEfetivoCBS + efCbs)
        }
        if (temSem) {
          a.qtdSemEfeito++
          a.semEfeitoIBS = cent(a.semEfeitoIBS + semIbs)
          a.semEfeitoCBS = cent(a.semEfeitoCBS + semCbs)
        }
        if (temImob) {
          a.qtdImobilizado++
          a.imobilizadoIBS = cent(a.imobilizadoIBS + imobIbs)
          a.imobilizadoCBS = cent(a.imobilizadoCBS + imobCbs)
        }
      } else if (regime === 'simples' || regime === 'mei') {
        a.qtdEntradasBloqueadas++
        a.bloqueadoIBS = cent(a.bloqueadoIBS + ibs)
        a.bloqueadoCBS = cent(a.bloqueadoCBS + cbs)
      } else {
        a.qtdEntradasNaoConfirmadas++
        a.naoConfirmadoIBS = cent(a.naoConfirmadoIBS + ibs)
        a.naoConfirmadoCBS = cent(a.naoConfirmadoCBS + cbs)
      }
    } else {
      a.qtdQuarentena++
    }
  }

  a.debitoTotal = cent(a.debitoIBS + a.debitoCBS)
  a.debitoSemEfeitoTotal = cent(a.debitoSemEfeitoIBS + a.debitoSemEfeitoCBS)
  // `credito*` histórico = informativo NCM (não abate o saldo).
  a.creditoTotal = cent(a.creditoIBS + a.creditoCBS)
  a.creditoInformativoTotal = cent(a.creditoInformativoIBS + a.creditoInformativoCBS)
  a.creditoEfetivoTotal = cent(a.creditoEfetivoIBS + a.creditoEfetivoCBS)
  a.divergenciaCreditoIBS = cent(a.creditoEfetivoIBS - a.creditoInformativoIBS)
  a.divergenciaCreditoCBS = cent(a.creditoEfetivoCBS - a.creditoInformativoCBS)
  a.divergenciaCreditoTotal = cent(a.creditoEfetivoTotal - a.creditoInformativoTotal)
  a.semEfeitoTotal = cent(a.semEfeitoIBS + a.semEfeitoCBS)
  a.imobilizadoTotal = cent(a.imobilizadoIBS + a.imobilizadoCBS)
  a.bloqueadoTotal = cent(a.bloqueadoIBS + a.bloqueadoCBS)
  a.naoConfirmadoTotal = cent(a.naoConfirmadoIBS + a.naoConfirmadoCBS)
  // Apuração assistida: débitos − créditos EFETIVOS (vieram na nota).
  a.saldoIBS = cent(a.debitoIBS - a.creditoEfetivoIBS)
  a.saldoCBS = cent(a.debitoCBS - a.creditoEfetivoCBS)
  a.saldoTotal = cent(a.saldoIBS + a.saldoCBS)

  const temMovimento =
    a.qtdSaidas +
      a.qtdEntradasApropriaveis +
      a.qtdEntradasBloqueadas +
      a.qtdEntradasNaoConfirmadas +
      a.qtdSemEfeito +
      a.qtdImobilizado +
      a.qtdSaidasSemEfeito >
    0
  if (!temMovimento) {
    a.resultado = 'sem-movimento'
  } else if (a.saldoTotal > 0.005) {
    a.resultado = 'a-pagar'
    a.valorAPagar = a.saldoTotal
  } else if (a.saldoTotal < -0.005) {
    a.resultado = 'saldo-credor'
    a.saldoCredor = Math.abs(a.saldoTotal)
  } else {
    a.resultado = 'zerado'
  }
  return a
}
