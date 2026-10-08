/**
 * Apuração assistida reativa por filtros — filtrar uma data específica apura
 * os créditos IBS/CBS daquela data, no motor e no ranking de fornecedores.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { cadastrarEmpresa } from '@/application/empresas'
import { rankingDoFiltro } from '@/application/nfe-relatorio-ia'
import {
  importarXmls,
  listarNotas,
} from '@/application/notas-xml'
import { apurarIbsCbs } from '@/infrastructure/nfe/apuracao'
import { FILTROS_NFE_VAZIOS } from '@/infrastructure/nfe/tipos'
import { limparCacheBrasilApi } from '@/infrastructure/receita/brasilapi'
import { db } from '@/infrastructure/db/schema'

const ATIVA = '12345678000190'
const FORN_A = '11111111000111'
const FORN_B = '22222222000122'

const det = (cProd: string, cfop: string, vProd: string, ibsCbs?: { vIbs: string; vCbs: string }): string => `
    <det nItem="1">
      <prod><cProd>${cProd}</cProd><xProd>Produto ${cProd}</xProd><NCM>02011000</NCM>
      <CFOP>${cfop}</CFOP><uCom>UN</uCom><qCom>1.0000</qCom><vUnCom>${vProd}</vUnCom><vProd>${vProd}</vProd></prod>
      <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>${vProd}</vBC><vICMS>18.00</vICMS></ICMS00></ICMS>
      <PIS><PISAliq><CST>01</CST></PISAliq></PIS><COFINS><COFINSAliq><CST>01</CST></COFINSAliq></COFINS>${ibsCbs ? `
      <IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib><gIBSCBS><vBC>${vProd}</vBC><gIBSUF><vIBSUF>${ibsCbs.vIbs}</vIBSUF></gIBSUF><gCBS><vCBS>${ibsCbs.vCbs}</vCBS></gCBS></gIBSCBS></IBSCBS>` : ''}</imposto>
    </det>`

const xml = (opcoes: { chave: string; emit: string; dest: string; data: string; vProd?: string; ibsCbs?: { vIbs: string; vCbs: string } }): string => `
<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe Id="NFe${opcoes.chave}" versao="4.00">
      <ide><natOp>VENDA</natOp><mod>55</mod><serie>1</serie><nNF>1</nNF>
      <dhEmi>${opcoes.data}T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>${opcoes.emit}</CNPJ><xNome>Emit ${opcoes.emit}</xNome><CRT>3</CRT></emit>
      <dest><CNPJ>${opcoes.dest}</CNPJ><xNome>Dest</xNome></dest>
      ${det('P1', '5102', opcoes.vProd ?? '100.00', opcoes.ibsCbs)}
      <total><ICMSTot><vProd>${opcoes.vProd ?? '100.00'}</vProd><vNF>${opcoes.vProd ?? '100.00'}</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
</nfeProc>`

const arq = (nome: string, conteudo: string): File =>
  new File([conteudo], nome, { type: 'text/xml' })

beforeEach(async () => {
  await db.empresas.clear()
  await db.nfeNotas.clear()
  limparCacheBrasilApi()
})

async function massa() {
  const r = await cadastrarEmpresa({ razaoSocial: 'Ativa Ltda', cnpj: ATIVA })
  const ativa = r.empresa!
  // Dia 10: saída da ativa + entrada do fornecedor A.
  // Dia 11: entrada do fornecedor B (valor maior, p/ diferenciar).
  await importarXmls(
    [
      arq('s10.xml', xml({ chave: '1'.repeat(44), emit: ATIVA, dest: '99999999000199', data: '2026-09-10' })),
      arq('e10.xml', xml({ chave: '2'.repeat(44), emit: FORN_A, dest: ATIVA, data: '2026-09-10' })),
      arq('e11.xml', xml({ chave: '3'.repeat(44), emit: FORN_B, dest: ATIVA, data: '2026-09-11', vProd: '500.00' })),
    ],
    ativa,
  )
  return ativa
}

const noDia = (dia: string) => ({ ...FILTROS_NFE_VAZIOS, inicio: dia, fim: dia })

describe('apuração reativa à data filtrada', () => {
  it('filtra dia específico: só as notas do dia entram nos débitos/créditos', async () => {
    const ativa = await massa()
    const dia10 = await listarNotas(ativa.id!, noDia('2026-09-10'))
    expect(dia10).toHaveLength(2)
    const ap10 = apurarIbsCbs(dia10)
    expect(ap10.qtdSaidas).toBe(1)
    expect(ap10.qtdEntradasApropriaveis).toBe(1)

    const dia11 = await listarNotas(ativa.id!, noDia('2026-09-11'))
    expect(dia11).toHaveLength(1)
    const ap11 = apurarIbsCbs(dia11)
    expect(ap11.qtdSaidas).toBe(0)
    expect(ap11.qtdEntradasApropriaveis).toBe(1)
    // Entrada maior no dia 11 → informativo NCM maior que o do dia 10.
    expect(ap11.creditoTotal).toBeGreaterThan(ap10.creditoTotal)
    // Sem destaque de IBS/CBS no XML: efetivo zerado, informativo preservado.
    // A apuração assistida usa o efetivo (nota); o NCM vira informativo.
    expect(ap11.creditoEfetivoTotal).toBe(0)
    expect(ap11.creditoInformativoTotal).toBeGreaterThan(0)
    expect(ap11.divergenciaCreditoTotal).toBeLessThan(0)

    const tudo = await listarNotas(ativa.id!, { ...FILTROS_NFE_VAZIOS })
    const apTudo = apurarIbsCbs(tudo)
    expect(apTudo.qtdSaidas).toBe(1)
    expect(apTudo.qtdEntradasApropriaveis).toBe(2)
  })

  it('ranking do dia confere com os créditos IBS/CBS apurados no dia', async () => {
    const ativa = await massa()
    const dia10 = await listarNotas(ativa.id!, noDia('2026-09-10'))
    const ap10 = apurarIbsCbs(dia10)
    const rank10 = rankingDoFiltro(dia10)
    // Só o fornecedor A movimentou o dia 10.
    expect(rank10).toHaveLength(1)
    expect(rank10[0].cnpj).toBe(FORN_A)
    expect(rank10[0].creditoIBS).toBe(ap10.creditoIBS)
    expect(rank10[0].creditoCBS).toBe(ap10.creditoCBS)
    expect(rank10[0].creditoTotal).toBe(ap10.creditoTotal)

    const dia11 = await listarNotas(ativa.id!, noDia('2026-09-11'))
    const rank11 = rankingDoFiltro(dia11)
    expect(rank11).toHaveLength(1)
    expect(rank11[0].cnpj).toBe(FORN_B)
  })

  it('trocar o dia recalcula saldo/débito (reatividade entre datas)', async () => {
    const ativa = await massa()
    const ap10 = apurarIbsCbs(await listarNotas(ativa.id!, noDia('2026-09-10')))
    const ap11 = apurarIbsCbs(await listarNotas(ativa.id!, noDia('2026-09-11')))
    // XMLs legados (sem grupo IBSCBS): efetivos zerados nos dois dias —
    // o saldo assistido (destacado − destacado) fica zerado, e os
    // informativos NCM continuam reagindo ao dia filtrado.
    expect(ap10.debitoEfetivoTotal).toBe(0)
    expect(ap10.debitoInformativoTotal).toBeGreaterThan(0)
    expect(ap10.divergenciaDebitoTotal).toBeLessThan(0)
    expect(ap10.saldoTotal).toBe(0)
    expect(ap10.resultado).toBe('zerado')
    expect(ap11.debitoTotal).toBe(0)
    expect(ap11.debitoEfetivoTotal).toBe(0)
    expect(ap11.creditoEfetivoTotal).toBe(0)
    expect(ap11.creditoInformativoTotal).toBeGreaterThan(0)
    expect(ap11.resultado).toBe('zerado')
    // O informativo do dia 11 (entrada de 500) supera o do dia 10.
    expect(ap11.creditoInformativoTotal).toBeGreaterThan(ap10.creditoInformativoTotal)
  })

  it('faixa de período soma os dois dias sem vazar notas fora', async () => {
    const ativa = await massa()
    const faixa = await listarNotas(ativa.id!, {
      ...FILTROS_NFE_VAZIOS,
      inicio: '2026-09-10',
      fim: '2026-09-11',
    })
    expect(faixa).toHaveLength(3)
    const fora = await listarNotas(ativa.id!, noDia('2026-09-12'))
    expect(fora).toHaveLength(0)
    expect(apurarIbsCbs(fora).resultado).toBe('sem-movimento')
  })

  it('saída com destaque: débito efetivo compõe o saldo e o NCM confere a emissão', async () => {
    const ativa = await massa()
    // Saída da ativa COM grupo IBSCBS destacado (10 + 5).
    await importarXmls(
      [arq('s12.xml', xml({ chave: '4'.repeat(44), emit: ATIVA, dest: '99999999000199', data: '2026-09-12', ibsCbs: { vIbs: '10.00', vCbs: '5.00' } }))],
      ativa,
    )
    const dia12 = await listarNotas(ativa.id!, noDia('2026-09-12'))
    expect(dia12).toHaveLength(1)
    const ap12 = apurarIbsCbs(dia12)
    // Débito = o destacado na saída; informativo NCM segue para conferência.
    expect(ap12.qtdSaidas).toBe(1)
    expect(ap12.debitoEfetivoTotal).toBe(15)
    expect(ap12.debitoInformativoTotal).toBeGreaterThan(0)
    expect(ap12.creditoEfetivoTotal).toBe(0)
    expect(ap12.saldoTotal).toBe(15)
    expect(ap12.resultado).toBe('a-pagar')
    expect(ap12.valorAPagar).toBe(15)
  })

  it('entrada com destaque abate o débito: saldo devedor ou credor do período', async () => {
    const ativa = await massa()
    // Saída com destaque 15 e entrada com destaque 6 no mesmo dia.
    await importarXmls(
      [
        arq('s13.xml', xml({ chave: '5'.repeat(44), emit: ATIVA, dest: '99999999000199', data: '2026-09-13', ibsCbs: { vIbs: '10.00', vCbs: '5.00' } })),
        arq('e13.xml', xml({ chave: '6'.repeat(44), emit: FORN_A, dest: ATIVA, data: '2026-09-13', ibsCbs: { vIbs: '4.00', vCbs: '2.00' } })),
      ],
      ativa,
    )
    const dia13 = await listarNotas(ativa.id!, noDia('2026-09-13'))
    expect(dia13).toHaveLength(2)
    const ap13 = apurarIbsCbs(dia13)
    expect(ap13.debitoEfetivoTotal).toBe(15)
    expect(ap13.creditoEfetivoTotal).toBe(6)
    expect(ap13.saldoTotal).toBe(9)
    expect(ap13.resultado).toBe('a-pagar')
  })
})
