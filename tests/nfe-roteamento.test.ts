/**
 * Roteamento multi-empresa, isolamento por perfil, adoção via BrasilAPI e
 * reatividade do motor (saldo/débito) após cada lote.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { cadastrarEmpresa } from '@/application/empresas'
import {
  adotarNotasParaEmpresa,
  apuracaoDaEmpresa,
  EMPRESA_ORFA_ID,
  importarXmls,
  listarCnpjsPendentes,
  listarNotas,
} from '@/application/notas-xml'
import { limparCacheBrasilApi } from '@/infrastructure/receita/brasilapi'
import { FILTROS_NFE_VAZIOS } from '@/infrastructure/nfe/tipos'
import { db } from '@/infrastructure/db/schema'

const CNPJ_A = '12345678000190'
const CNPJ_B = '11222333000181'
const CNPJ_C = '11444777000161'

const det = (cProd: string, cfop: string, vProd: string): string => `
    <det nItem="1">
      <prod><cProd>${cProd}</cProd><xProd>Produto ${cProd}</xProd><NCM>02011000</NCM>
      <CFOP>${cfop}</CFOP><uCom>UN</uCom><qCom>1.0000</qCom><vUnCom>${vProd}</vUnCom><vProd>${vProd}</vProd></prod>
      <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>${vProd}</vBC><vICMS>18.00</vICMS></ICMS00></ICMS>
      <PIS><PISAliq><CST>01</CST></PISAliq></PIS><COFINS><COFINSAliq><CST>01</CST></COFINSAliq></COFINS></imposto>
    </det>`

const xml = (opcoes: { chave: string; emit: string; dest: string; data: string; dets?: string }): string => `
<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe Id="NFe${opcoes.chave}" versao="4.00">
      <ide><natOp>VENDA</natOp><mod>55</mod><serie>1</serie><nNF>1</nNF>
      <dhEmi>${opcoes.data}T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>${opcoes.emit}</CNPJ><xNome>Emit ${opcoes.emit}</xNome><CRT>3</CRT></emit>
      <dest><CNPJ>${opcoes.dest}</CNPJ><xNome>Dest</xNome></dest>
      ${opcoes.dets ?? det('P1', '5102', '100.00')}
      <total><ICMSTot><vProd>100.00</vProd><vNF>100.00</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
</nfeProc>`

const arq = (nome: string, conteudo: string): File =>
  new File([conteudo], nome, { type: 'text/xml' })

const CH = (d: string) => d.repeat(44)

beforeEach(async () => {
  await db.empresas.clear()
  await db.nfeNotas.clear()
  limparCacheBrasilApi()
})

async function empresaAtiva(cnpj: string, razao: string) {
  const r = await cadastrarEmpresa({ razaoSocial: razao, cnpj })
  expect(r.ok).toBe(true)
  return r.empresa!
}

describe('roteamento por CNPJ', () => {
  it('nota de outra cadastrada não vai para a ativa (isolamento)', async () => {
    const ativa = await empresaAtiva(CNPJ_A, 'Ativa Ltda')
    const outra = await empresaAtiva(CNPJ_B, 'Outra Ltda')
    const r = await importarXmls(
      [arq('x.xml', xml({ chave: CH('5'), emit: '99999999000199', dest: CNPJ_B, data: '2026-09-10' }))],
      ativa,
    )
    expect(r.novas).toBe(1)
    expect(r.redirecionadas).toBe(1)
    expect(await listarNotas(ativa.id!, { ...FILTROS_NFE_VAZIOS })).toHaveLength(0)
    const notasB = await listarNotas(outra.id!, { ...FILTROS_NFE_VAZIOS })
    expect(notasB).toHaveLength(1)
    expect(notasB[0].direcao).toBe('entrada')
  })

  it('espelha quando emitente e destinatário são cadastros distintos', async () => {
    const a = await empresaAtiva(CNPJ_A, 'A Ltda')
    const b = await empresaAtiva(CNPJ_B, 'B Ltda')
    const r = await importarXmls(
      [arq('e.xml', xml({ chave: CH('6'), emit: CNPJ_A, dest: CNPJ_B, data: '2026-09-11' }))],
      a,
    )
    expect(r.novas).toBe(2)
    const notasA = await listarNotas(a.id!, { ...FILTROS_NFE_VAZIOS })
    const notasB = await listarNotas(b.id!, { ...FILTROS_NFE_VAZIOS })
    expect(notasA).toHaveLength(1)
    expect(notasB).toHaveLength(1)
    expect(notasA[0].direcao).toBe('saida')
    expect(notasB[0].direcao).toBe('entrada')
  })

  it('sem dono estaciona como órfã, invisível à ativa, com pendente para BrasilAPI', async () => {
    const ativa = await empresaAtiva(CNPJ_A, 'Ativa Ltda')
    const r = await importarXmls(
      [arq('orf.xml', xml({ chave: CH('7'), emit: CNPJ_C, dest: '99999999000199', data: '2026-09-12' }))],
      ativa,
    )
    expect(r.novas).toBe(1)
    expect(r.orfas).toBe(1)
    expect(r.quarentena).toBe(1)
    expect(r.pendentesCadastro?.map((p) => p.cnpj)).toContain(CNPJ_C)
    expect(r.menorData).toBe('2026-09-12')
    // Ativa não enxerga.
    expect(await listarNotas(ativa.id!, { ...FILTROS_NFE_VAZIOS })).toHaveLength(0)
    // Órfãs listáveis só pelo estacionamento.
    expect(await db.nfeNotas.where('empresaId').equals(EMPRESA_ORFA_ID).count()).toBe(1)
    const pend = await listarCnpjsPendentes()
    expect(pend.map((p) => p.cnpj)).toContain(CNPJ_C)
  })
})

describe('adoção ao cadastrar', () => {
  const brasilOk = (async () =>
    new Response(
      JSON.stringify({
        cnpj: CNPJ_C,
        razao_social: 'Contribuinte Novo LTDA',
        nome_fantasia: 'Novo',
        municipio: 'Fortaleza',
        uf: 'ce',
      }),
      { status: 200 },
    )) as unknown as typeof fetch

  it('cadastrar via BrasilAPI adota as órfãs e recalcula a direção', async () => {
    const ativa = await empresaAtiva(CNPJ_A, 'Ativa Ltda')
    await importarXmls(
      [arq('orf.xml', xml({ chave: CH('8'), emit: CNPJ_C, dest: '99999999000199', data: '2026-09-12' }))],
      ativa,
    )
    const { cadastrarEmpresaAPartirDeNota } = await import('@/application/empresas')
    const r = await cadastrarEmpresaAPartirDeNota(CNPJ_C, { nomeFallback: 'Emitente', fetchFn: brasilOk })
    expect(r.ok).toBe(true)
    expect(r.fonte).toBe('brasilapi')
    expect(r.empresa?.razaoSocial).toContain('Novo')
    expect(r.adotadas).toBe(1)
    // Órfãs zeradas e nota na nova empresa como saída.
    expect(await db.nfeNotas.where('empresaId').equals(EMPRESA_ORFA_ID).count()).toBe(0)
    const notasNova = await listarNotas(r.empresa!.id!, { ...FILTROS_NFE_VAZIOS })
    expect(notasNova).toHaveLength(1)
    expect(notasNova[0].direcao).toBe('saida')
    // Ativa continua sem ver nada.
    expect(await listarNotas(ativa.id!, { ...FILTROS_NFE_VAZIOS })).toHaveLength(0)
  })

  it('sem internet usa o nome do XML e adota do mesmo jeito', async () => {
    const ativa = await empresaAtiva(CNPJ_A, 'Ativa Ltda')
    await importarXmls(
      [arq('orf.xml', xml({ chave: CH('9'), emit: CNPJ_C, dest: '99999999000199', data: '2026-09-12' }))],
      ativa,
    )
    const falha = (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch
    const { cadastrarEmpresaAPartirDeNota } = await import('@/application/empresas')
    limparCacheBrasilApi()
    const r = await cadastrarEmpresaAPartirDeNota(CNPJ_C, { nomeFallback: 'Nome do XML LTDA', fetchFn: falha })
    expect(r.ok).toBe(true)
    expect(r.fonte).toBe('xml')
    expect(r.empresa?.razaoSocial).toBe('Nome do XML LTDA')
    expect(r.adotadas).toBe(1)
    expect(r.aviso).toMatch(/BrasilAPI/)
  })

  it('adotarNotasParaEmpresa nunca rouba entrada/saída de outro cadastro', async () => {
    const a = await empresaAtiva(CNPJ_A, 'A Ltda')
    const b = await empresaAtiva(CNPJ_B, 'B Ltda')
    await importarXmls(
      [arq('e.xml', xml({ chave: CH('6'), emit: CNPJ_A, dest: CNPJ_B, data: '2026-09-11' }))],
      a,
    )
    const antesA = await listarNotas(a.id!, { ...FILTROS_NFE_VAZIOS })
    const antesB = await listarNotas(b.id!, { ...FILTROS_NFE_VAZIOS })
    // Tenta adotar tudo para B de novo — nada deve duplicar nem sumir de A.
    const r = await adotarNotasParaEmpresa(b)
    expect(r.adotadas).toBe(0)
    expect(await listarNotas(a.id!, { ...FILTROS_NFE_VAZIOS })).toHaveLength(antesA.length)
    expect(await listarNotas(b.id!, { ...FILTROS_NFE_VAZIOS })).toHaveLength(antesB.length)
  })
})

describe('motor reativo a cada lote', () => {
  it('segundo lote recalcula saldo/débito sobre todos os documentos', async () => {
    const ativa = await empresaAtiva(CNPJ_A, 'Ativa Ltda')
    const r1 = await importarXmls(
      [arq('s1.xml', xml({ chave: '1'.repeat(44), emit: CNPJ_A, dest: '99999999000199', data: '2026-09-10' }))],
      ativa,
    )
    expect(r1.novas).toBe(1)
    const ap1 = await apuracaoDaEmpresa(ativa.id!)
    expect(ap1.qtd).toBe(1)
    expect(ap1.apuracao.resultado).toBe('a-pagar')
    const saldo1 = ap1.apuracao.saldoTotal

    const r2 = await importarXmls(
      [
        arq(
          'e1.xml',
          xml({ chave: '2'.repeat(44), emit: CNPJ_B, dest: CNPJ_A, data: '2026-09-11' }),
        ),
      ],
      ativa,
    )
    expect(r2.novas).toBe(1)
    // Segunda carga vê as duas notas (reatividade, sem filtro escondendo).
    const todas = await listarNotas(ativa.id!, { ...FILTROS_NFE_VAZIOS })
    expect(todas).toHaveLength(2)
    const ap2 = await apuracaoDaEmpresa(ativa.id!)
    expect(ap2.qtd).toBe(2)
    expect(ap2.apuracao.creditoTotal).toBeGreaterThan(0)
    // O crédito da entrada abateu o débito da saída.
    expect(ap2.apuracao.saldoTotal).toBeLessThan(saldo1)
    // Datas para expansão reativa do filtro.
    expect(r2.menorData).toBe('2026-09-11')
  })
})
