/**
 * Parsers SPED — EFD ICMS/IPI e EFD Contribuições (SPEC §4).
 *
 * As fixtures reproduzem o layout real campo a campo; os índices conferidos
 * são exatamente os que o parser lê.
 */
import { describe, expect, it } from 'vitest'
import { parseContribuicoes, parseIcmsIpi } from '@/infrastructure/sped/parse'

/** Linha pipe-delimited: `campos[0]` vira o registro (c[1] do SPED). */
const linha = (...campos: string[]): string => ['', ...campos].join('|')

/** Cabeçalho no padrão `NUM_DOC · CHV · DT_DOC · DT_E_S · VL_DOC`. */
const cabecalho = (
  reg: string,
  indOper: string,
  numDoc: string,
  chave: string,
  data: string,
  valor: string,
): string =>
  linha(reg, indOper, '0', 'PART01', '55', '000', numDoc, chave, data, data, valor, '0,00')

const c100Saida = cabecalho('C100', '1', '000123', 'CHAVE0001', '01/02/2026', '1500,00')
const c100Entrada = cabecalho('C100', '0', '000999', 'CHAVE0999', '05/02/2026', '900,00')

/** C170 do ICMS/IPI (16 campos — sem o parecer estrutural de PIS/COFINS). */
const c170Icms = (
  numItem: string,
  codItem: string,
  desc: string,
  extra: Partial<{ cst: string; cfop: string; vlItem: string }> = {},
): string =>
  linha(
    'C170',
    numItem,
    codItem,
    desc,
    '2,000000',
    'UN',
    extra.vlItem ?? '250,00',
    '0,00',
    '',
    extra.cst ?? '000',
    extra.cfop ?? '5102',
    '',
    '250,00',
    '18,00',
    '45,00',
  )

const registro0200 = (codItem: string, descricao: string, ncm: string): string =>
  linha('0200', codItem, descricao, 'SEM', 'SEM', 'UN', '00', ncm, '')

const c190 = (cst: string, cfop: string, vlOpr: string, vlIcms: string): string =>
  linha('C190', cst, cfop, '18,00', vlOpr, vlOpr, vlIcms, '0,00', '0,00', '0,00')

/** C170 do EFD Contribuições: 37 campos, PIS/COFINS nas posições 25–36. */
function c170Contrib(
  numItem: string,
  codItem: string,
  desc: string,
  campos: Partial<Record<number, string>> = {},
): string {
  const c = new Array<string>(37).fill('')
  c[0] = ''
  c[1] = 'C170'
  c[2] = numItem
  c[3] = codItem
  c[4] = desc
  c[5] = '1,000000'
  c[6] = 'UN'
  c[7] = '100,00'
  c[8] = '0,00'
  c[10] = '06' // CST_ICMS
  c[11] = '5502' // CFOP
  for (const [k, v] of Object.entries(campos)) if (v !== undefined) c[Number(k)] = v
  return c.join('|')
}

/* ========================================================================== */
/* EFD ICMS/IPI                                                                */
/* ========================================================================== */

describe('parseIcmsIpi', () => {
  it('lê o cadastro 0200 e a primeira ocorrência vence', () => {
    const conteudo = [
      registro0200('P1', 'Produto Um', '02011000'),
      registro0200('P1', 'Duplicado', '99999999'),
      registro0200('P2', 'Produto Dois', '84713012'),
    ].join('\n')
    const r = parseIcmsIpi(conteudo)
    expect(r.produtos).toHaveLength(2)
    expect(r.produtos[0]).toEqual({ codigo: 'P1', descricao: 'Produto Um', ncm: '02011000', cest: '' })
    expect(r.stats.registros0200).toBe(2) // conta ocorrências **únicas** (paridade com a v1)
  })

  it('separa saídas (indOper=1) de entradas', () => {
    const conteudo = [registro0200('P1', 'Produto Um', '02011000'), c100Saida, c100Entrada].join('\n')
    const r = parseIcmsIpi(conteudo)
    expect(r.stats.notasSaida).toBe(1)
    expect(r.stats.notasEntrada).toBe(1)
    expect(r.notas).toHaveLength(1)
    expect(r.notasEntrada).toHaveLength(1)
    expect(r.notas[0]).toMatchObject({
      numDoc: '000123',
      chave: 'CHAVE0001',
      data: '01/02/2026',
      valorTotal: 1500,
      indOper: '1',
    })
  })

  it('ancora o cabeçalho na data (melhoria sobre os índices fixos da v1)', () => {
    const conteudo = [
      // Sem ancoragem na data, os índices fixos leriam a CHAVE como NUM_DOC
      // e o campo errado como VL_DOC.
      linha('C100', '1', '0', 'PART01', '55', '000', '000777', 'X'.repeat(44), '10/03/2026', '10/03/2026', '250,75', '0,00'),
    ].join('\n')
    const [nota] = parseIcmsIpi(conteudo).notas
    expect(nota.numDoc).toBe('000777')
    expect(nota.data).toBe('10/03/2026')
    expect(nota.valorTotal).toBe(250.75)
  })

  it('cai nos índices fixos quando não há data reconhecível', () => {
    // cabecalhoPorIndice: iNum=8, iChave=9, iData=10, iValor=12.
    const conteudo = [
      ['', 'C100', '1', '0', 'P', '55', 'S', 'X', 'DOCNUM', 'CHAVE', '2026-02-01', 'Y', '300,00'].join('|'),
    ].join('\n')
    const [nota] = parseIcmsIpi(conteudo).notas
    expect(nota.numDoc).toBe('DOCNUM')
    expect(nota.chave).toBe('CHAVE')
    expect(nota.data).toBe('2026-02-01')
    expect(nota.valorTotal).toBe(300)
  })

  it('só gera item para a nota de saída corrente', () => {
    const conteudo = [
      registro0200('P1', 'Produto Um', '02011000'),
      c100Saida,
      c170Icms('1', 'P1', 'Primeiro'),
      c170Icms('2', 'P1', 'Segundo'),
      c100Entrada,
      c170Icms('1', 'P1', 'Entrada não é item'),
    ].join('\n')
    const r = parseIcmsIpi(conteudo)
    expect(r.itens).toHaveLength(2)
    expect(r.stats.itensSaida).toBe(2)
    expect(r.stats.itensEntrada).toBe(1)
    expect(r.stats.itensOrfaos).toBe(0)
    expect(r.itens[0]).toMatchObject({
      numDoc: '000123',
      numItem: '1',
      codItem: 'P1',
      descricaoProduto: 'Produto Um', // vem do 0200
      ncm: '02011000',
      qtd: 2,
      unid: 'UN',
      vlItem: 250,
      cstIcms: '000',
      cfop: '5102',
      vlBcIcms: 250,
      aliqIcms: 18,
      vlIcms: 45,
      indOper: '1',
      tipoDoc: 'C',
    })
  })

  it('conta item órfão: sem nota e sem codItem', () => {
    const conteudo = [c170Icms('1', 'P1', 'Sem nota'), `${c100Saida}\n${c170Icms('1', '', '')}`].join('\n')
    const r = parseIcmsIpi(conteudo)
    expect(r.stats.itensOrfaos).toBe(2)
    expect(r.itens).toHaveLength(0)
  })

  it('sem 0200 usa a descrição do próprio item e marca itensSemCadastro0200', () => {
    const conteudo = [c100Saida, c170Icms('1', 'SEM0200', 'Descrição inline')].join('\n')
    const r = parseIcmsIpi(conteudo)
    expect(r.itens[0].descricaoProduto).toBe('Descrição inline')
    expect(r.itens[0].ncm).toBe('')
    expect(r.stats.itensSemCadastro0200).toBe(1)
  })

  it('resume C190 apenas das saídas', () => {
    const conteudo = [
      c100Saida,
      c190('000', '5102', '250,00', '45,00'),
      c100Entrada,
      c190('020', '1102', '900,00', '0,00'),
    ].join('\n')
    const r = parseIcmsIpi(conteudo)
    expect(r.resumoC190).toHaveLength(1)
    expect(r.stats.resumosSaida).toBe(1)
    expect(r.stats.resumosEntrada).toBe(1)
    expect(r.resumoC190[0]).toMatchObject({
      cstIcms: '000',
      cfop: '5102',
      vlOpr: 250,
      vlBcIcms: 250,
      vlIcms: 45,
      numDoc: '000123',
    })
  })

  it('C190 sem nota corrente é ignorado', () => {
    const r = parseIcmsIpi(c190('000', '5102', '10,00', '1,80'))
    expect(r.resumoC190).toHaveLength(0)
    expect(r.stats.registrosC190).toBe(1)
  })

  it('conta as linhas totais do arquivo', () => {
    const conteudo = [c100Saida, c170Icms('1', 'P1', 'X'), ''].join('\n')
    expect(parseIcmsIpi(conteudo).stats.linhasTotais).toBe(3)
  })

  it('não pula itens quando o C100 vem sem IND_OPER (complementar)', () => {
    const semInd = linha('C100', '', '0', 'PART01', '55', '000', '000123', 'CHAVE0001', '01/02/2026', '01/02/2026', '1500,00', '0,00')
    const conteudo = [registro0200('P1', 'Produto Um', '02011000'), semInd, c170Icms('1', 'P1', 'Primeiro')].join('\n')
    const r = parseIcmsIpi(conteudo)
    expect(r.itens).toHaveLength(1)
    expect(r.stats.itensSaida).toBe(1)
  })

  it('descarta itens de nota cancelada (COD_SIT 02) em contador próprio', () => {
    const cancelada = linha('C100', '1', '0', 'PART01', '55', '02', '000123', 'CHAVE0001', '01/02/2026', '01/02/2026', '1500,00', '0,00')
    const conteudo = [registro0200('P1', 'Produto Um', '02011000'), cancelada, c170Icms('1', 'P1', 'X')].join('\n')
    const r = parseIcmsIpi(conteudo)
    expect(r.itens).toHaveLength(0)
    expect(r.stats.notasCanceladas).toBe(1)
    expect(r.stats.itensCancelados).toBe(1)
    expect(r.stats.notasSaida).toBe(0)
  })

  it('normaliza NCM com máscara ou EX do 0200 para 8 dígitos', () => {
    const conteudo = [
      registro0200('P1', 'Produto Um', '0201.10.00'),
      registro0200('P2', 'Produto Dois', '84713012EX01'),
      c100Saida,
      c170Icms('1', 'P1', 'Primeiro'),
      c170Icms('2', 'P2', 'Segundo'),
    ].join('\n')
    const r = parseIcmsIpi(conteudo)
    expect(r.itens[0].ncm).toBe('02011000')
    expect(r.itens[1].ncm).toBe('84713012')
  })
})

/* ========================================================================== */
/* EFD Contribuições                                                           */
/* ========================================================================== */

describe('parseContribuicoes', () => {
  it('lê A100 + A170 com layout completo (QTD/UNID)', () => {
    const a100 = cabecalho('A100', '1', '000123', '', '01/02/2026', '500,00')
    const a170 = linha(
      'A170', '1', 'P1', 'Serviço',
      '2,000000', 'UN', '200,00', '10,00',
      '01', '190,00', '1,65', '3,135',
      '01', '190,00', '7,6', '14,44',
    )
    const r = parseContribuicoes([registro0200('P1', 'Serviço X', '00000000'), a100, a170].join('\n'))

    expect(r.stats.registrosA100).toBe(1)
    expect(r.stats.registrosA170).toBe(1)
    expect(r.itens).toHaveLength(1)
    expect(r.itens[0]).toMatchObject({
      numDoc: '000123',
      qtd: 2,
      unid: 'UN',
      vlItem: 200,
      vlDesc: 10,
      cstPis: '01',
      vlBcPis: 190,
      vlPis: 3.135,
      cstCofins: '01',
      vlBcCofins: 190,
      vlCofins: 14.44,
      tipoDoc: 'A',
    })
  })

  it('A170 sem QTD/UNID cai no layout curto (qtd=1, UN)', () => {
    const a100 = cabecalho('A100', '1', '000123', '', '01/02/2026', '500,00')
    const a170 = linha(
      'A170', '1', 'P1', 'Serviço',
      '200,00', '0,00', '', '',
      '01', '190,00', '1,65', '3,135',
      '01', '190,00', '7,6', '14,44',
    )
    const [item] = parseContribuicoes([a100, a170].join('\n')).itens
    expect(item.qtd).toBe(1)
    expect(item.unid).toBe('UN')
    expect(item.vlItem).toBe(200)
    expect(item.vlDesc).toBe(0)
    expect(item.cstPis).toBe('01')
  })

  it('lê C100 + C170 com PIS/COFINS nas posições 25–36', () => {
    const conteudo = [
      registro0200('P1', 'Produto Um', '02011000'),
      c100Saida,
      c170Contrib('1', 'P1', 'Item', {
        25: '01', 26: '100,00', 30: '3,135',
        31: '01', 32: '100,00', 36: '14,44',
      }),
    ].join('\n')
    const r = parseContribuicoes(conteudo)
    expect(r.stats.registrosC100).toBe(1)
    expect(r.stats.registrosC170).toBe(1)
    expect(r.itens).toHaveLength(1)
    expect(r.itens[0]).toMatchObject({
      cstIcms: '06',
      cfop: '5502',
      cstPis: '01',
      vlBcPis: 100,
      vlPis: 3.135,
      cstCofins: '01',
      vlBcCofins: 100,
      vlCofins: 14.44,
      tipoDoc: 'C',
      descricaoProduto: 'Produto Um',
      ncm: '02011000',
    })
  })

  it('lê D100 (transporte) e D170', () => {
    const d100 = linha('D100', '0', '0', 'PART01', '57', '000', '1', '000456', 'CHAVECTE', '10/03/2026', '11/03/2026', '800,00')
    const d170 = linha(
      'D170', '1', 'T1', 'Frete',
      '1,000000', 'UN', '800,00', '0,00',
      '07', '800,00', '0,00', '0,00',
      '07', '800,00', '0,00', '0,00',
    )
    const r = parseContribuicoes([d100, d170].join('\n'))
    expect(r.stats.registrosD100).toBe(1)
    expect(r.stats.registrosD170).toBe(1)
    expect(r.stats.notasEntrada).toBe(1)
    expect(r.stats.itensEntrada).toBe(1) // item de entrada não vira linha
    expect(r.itens).toHaveLength(0)
    expect(r.notasEntrada[0]).toMatchObject({ numDoc: '000456', chave: 'CHAVECTE', valorTotal: 800 })
  })

  it('não colide notas de blocos A e C com o mesmo número', () => {
    const conteudo = [
      cabecalho('A100', '1', '000123', '', '01/02/2026', '500,00'),
      cabecalho('C100', '1', '000123', '', '01/02/2026', '500,00'),
    ].join('\n')
    const r = parseContribuicoes(conteudo)
    expect(r.stats.notasSaida).toBe(2)
    expect(r.notas).toHaveLength(2)
    expect(new Set(r.notas.map((n) => n.tipo))).toEqual(new Set(['A', 'C']))
  })

  it('item sem nota corrente é órfão; item de entrada não conta como saída', () => {
    const conteudo = [
      linha('A170', '1', 'P1', 'Órfão', '1,000000', 'UN', '10,00', '0,00', '01', '10,00', '0', '0', '01', '10,00', '0', '0'),
      cabecalho('A100', '0', '000500', '', '02/02/2026', '700,00'),
      linha('A170', '1', 'P1', 'Entrada', '1,000000', 'UN', '10,00', '0,00', '01', '10,00', '0', '0', '01', '10,00', '0', '0'),
    ].join('\n')
    const r = parseContribuicoes(conteudo)
    expect(r.stats.itensOrfaos).toBe(1)
    expect(r.stats.itensEntrada).toBe(1)
    expect(r.itens).toHaveLength(0)
  })

  it('item sem 0200 usa a descrição complementar', () => {
    const conteudo = [
      cabecalho('A100', '1', '000123', '', '01/02/2026', '500,00'),
      linha('A170', '1', 'SEM0200', 'Descrição complementar', '1,000000', 'UN', '10,00', '0,00', '01', '10,00', '0', '0', '01', '10,00', '0', '0'),
    ].join('\n')
    const r = parseContribuicoes(conteudo)
    expect(r.itens[0].descricaoProduto).toBe('Descrição complementar')
    expect(r.stats.itensSemCadastro0200).toBe(1)
  })

  it('item sem codItem é órfão', () => {
    const conteudo = [
      cabecalho('A100', '1', '000123', '', '01/02/2026', '500,00'),
      linha('A170', '1', '', 'Sem código', '1,000000', 'UN', '10,00', '0,00', '01', '10,00', '0', '0', '01', '10,00', '0', '0'),
    ].join('\n')
    expect(parseContribuicoes(conteudo).stats.itensOrfaos).toBe(1)
  })
})
