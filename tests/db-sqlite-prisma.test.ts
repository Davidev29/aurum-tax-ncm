/**
 * Banco SQLite via Prisma — cobertura da nova camada de persistência.
 *
 * Substitui `db-migracao.test.ts` (cadeia Dexie removida; banco novo, sem
 * migração legada). Roda sobre SQLite real (arquivo por teste, ver
 * `tests/setup.ts`), cobrindo:
 *   1. round-trip put/get + count nas 26 stores;
 *   2. validação de domínio (`validacao:*` fail-closed);
 *   3. restrições Prisma (@id/@unique/autoincremento);
 *   4. consultas (equals/anyOf/between/startsWith/composto/first/limit/
 *      orderBy+reverse/sortBy+and/uniqueKeys/count/delete);
 *   5. lotes (bulkPut+progresso, modo inserir, bulkAdd, update);
 *   6. API do banco (table/tables/transaction/open/close/isOpen/verno/
 *      contarTodos);
 *   7. segurança (injeção SQL vira literal, allowlist de store/campo);
 *   8. paridade dos drivers (memória) e rota IPC.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { bulkPut, contarTodos, db, INSERIR } from '@/infrastructure/db/schema'
import { resolverDriver } from '@/infrastructure/db/motor'
import { DriverMemoria } from '@/infrastructure/db/motor'
import { validarChave, validarRegistro } from '@/infrastructure/db/validacao'
import { camposDe, somenteConhecidos, TODAS_STORES } from '@/infrastructure/db/db-protocolo'

const AGORA = '2026-01-01T00:00:00.000Z'

const NOTA = (chave: string, empresaId: number, direcao = 'saida') => ({
  chave,
  numero: '1',
  serie: '1',
  modelo: '55',
  natOp: 'VENDA',
  dataEmissao: '2026-01-10',
  emitCnpj: '11111111000111',
  emitNome: 'Emit',
  emitCrt: '3',
  emitIe: '',
  emitIm: '',
  emitEndereco: '',
  emitCidade: '',
  emitUf: 'SP',
  destDoc: '22222222000122',
  destNome: 'Dest',
  destIe: '',
  valorProdutos: 100,
  valorTotal: 100,
  empresaId,
  direcao,
  arquivo: null,
  xmlConteudo: null,
  refIBS: 19,
  refCBS: 9,
  totalIBS: 19,
  totalCBS: 9,
  totalTributos: 28,
  importadoEm: AGORA,
  itens: [],
  itensAnalisados: [],
})

beforeEach(async () => {
  await db.delete()
})

/* ------------------------------------------------- 1) round-trip --- */

describe('round-trip nas 27 stores', () => {
  it('ncm/nbs/cst/cstClassTrib/referencia/nomenclatura', async () => {
    await db.ncm.put({
      id: '99999999|000001|x', codigo: '99999999', codigoFormatado: '99.99.99.99',
      cst: '000', cClassTrib: '000001', baseLegal: 'LC', reducao: 0,
      aliquotaIBS: null, aliquotaCBS: null, descricao: 'D', documentos: '',
    })
    await db.nbs.put({
      id: '999999999|000001', codigo: '999999999', cst: '000', cClassTrib: '000001',
      baseLegal: 'LC', reducao: null, aliquotaIBS: null, aliquotaCBS: null, descricao: 'D', documentos: '',
    })
    await db.cst.put({ codigo: '000', descricao: 'T', indIBSCBS: true, indIBSCBSMono: false, indReducao: false, indDiferimento: false, indTransferenciaCredito: false, docs: { NFe: true } as never })
    await db.cstClassTrib.put({
      id: '000|000001', cst: '000', cClassTrib: '000001', nome: 'N', descricao: 'D',
      lcRedacao: null, lcRef: null, tipoAliquota: null, pRedIBS: 0, pRedCBS: 0,
      indRedutorBC: null, indTribRegular: null, indCredPres: null, indMono: null,
      indMonoReten: null, indMonoRet: null, indMonoDif: null, creditoPara: null,
      inicioVigencia: null, fimVigencia: null, atualizadoEm: null,
    })
    await db.referencia.put({
      id: '000|000001', cst: '000', cstDescricao: 'CD', cClassTrib: '000001', descricao: 'D',
      pRedIBS: 0, pRedCBS: 0, tipoAliquota: null, anexo: null, urlLegislacao: null,
      exigeTributacao: true, reducaoBC: false, reducaoAliquota: false, transferenciaCredito: false,
      diferimento: false, monofasica: false, creditoPresumidoZFM: false, ajusteCompetencia: false,
      tributacaoRegular: false, creditoPresumido: false, estornoCredito: false, monoNormal: false,
      monoRetencao: false, monoRetida: false, monoDiferimentoCombustivel: false,
      simplesReceitaBruta: null, regimeContribuicaoSocial: null, impostoBensServicos: null,
      docs: { NFe: true } as never,
    })
    await db.ncmNomenclatura.put({ codigo: '99999999', codigoOriginal: '9999.99.99', descricao: 'D', dataInicio: null, dataFim: null, ato: null })
    expect(await db.ncm.count()).toBe(1)
    expect(await db.nbs.count()).toBe(1)
    expect(await db.cst.count()).toBe(1)
    expect(await db.cstClassTrib.count()).toBe(1)
    expect(await db.referencia.count()).toBe(1)
    expect((await db.ncm.get('99999999|000001|x'))?.codigo).toBe('99999999')
    expect((await db.ncmNomenclatura.get('99999999'))?.descricao).toBe('D')
  })

  it('empresas/produtos/meta/auxiliares', async () => {
    const idEmp = await db.empresas.add({ razaoSocial: 'R', cnpj: '12345678000195', fantasia: 'F', criadoEm: AGORA })
    expect(typeof idEmp).toBe('number')
    await db.produtos.add({
      empresaId: idEmp, codigo: 'SKU', nome: 'N', ncm: '99999999', cfop: '5102',
      cstIcms: '00', pis: '01', cofins: '01', quantidade: 1, valorUnitario: 10,
      cstReforma: '000', cClassTrib: '000001', regraGeral: false,
      classificacaoSnapshot: { codigo: '99999999' } as never,
      criadoEm: AGORA, atualizadoEm: AGORA,
    })
    await db.meta.put({ chave: 'k', valor: { a: 1 }, total: 3 })
    await db.cfop.put({ codigo: '5102', descricao: 'V', tipo: 'Saída' })
    await db.cstIcms.put({ codigo: '00', descricao: 'T' })
    await db.cstPisCofins.put({ codigo: '01', descricao: 'B' })
    expect((await db.empresas.get(idEmp))?.cnpj).toBe('12345678000195')
    expect(await db.produtos.count()).toBe(1)
    expect((await db.meta.get('k'))?.total).toBe(3)
    expect((await db.cfop.get('5102'))?.tipo).toBe('Saída')
  })

  it('nfeNotas/reclassificacoes/classificacaoProduto/anexos/produtosDfe', async () => {
    const id = await db.nfeNotas.add({ ...NOTA('1'.repeat(44), 1) } as never)
    await db.reclassificacoesManuais.put({
      ncm: '99999999', cst: '000', cClassTrib: '000001', descricao: 'J', fonteDescricao: 'LC', fonteUrl: '', criadoEm: AGORA, atualizadoEm: AGORA,
    })
    await db.classificacaoProduto.put({
      id: 'NFCom|000001', sistema: 'NFCom', cClassTrib: '000001', descricao: null,
      permitido: true, confianca: 'explicita', flags: {}, inicioVigencia: null, fimVigencia: null, sincronizadoEm: AGORA,
    })
    await db.anexos.put({
      id: '99999999|1|0', codigo: '99999999', tipo: 'NCM', permissao: 'permitido',
      nroAnexo: 1, nroItemAnexoLei: null, descrAnexo: 'CB', descrItemAnexo: null,
      descrCondicao: null, descrExcecao: null, observacao: null, inicioVigencia: null, fimVigencia: null,
    })
    await db.produtosDfe.put({
      id: 'NFCom|0100101', sistema: 'NFCom', codClassProd: '0100101', codGrupo: null,
      descrGrupo: null, descricao: 'Tel', tipoPrestacao: null, flags: {}, sincronizadoEm: AGORA,
    })
    expect((await db.nfeNotas.get(id))?.direcao).toBe('saida')
    expect((await db.reclassificacoesManuais.get('99999999'))?.cst).toBe('000')
    expect(await db.classificacaoProduto.count()).toBe(1)
    expect(await db.anexos.count()).toBe(1)
    expect(await db.produtosDfe.count()).toBe(1)
  })

  it('audit/ia_feedback/cest/cnae/consultasCnpj/conversas', async () => {
    await db.table('audit_log').add({ quando: AGORA, tabela: 't', chave: 'k', operacao: 'criar', autor: 'a', antes: null, depois: { x: 1 } })
    await db.table('ia_feedback').add({ quando: AGORA, descricao: 'd', via: 'v', decisao: null, confianca: 0.5, motivo: null })
    await db.cest.put({ codigo: '1234567', descricao: 'C' })
    await db.cnae.put({ codigo7: '0161001', codigoFormatado: '0161-0/01', descricao: 'D', situacao: 'Permitido', anexos: ['III'], fatorR: false })
    await db.consultasCnpj.put({ cnpj: '12345678000195', razaoSocial: 'R', fantasia: 'F', porte: null, situacao: null, opcaoSimples: null, cnaePrincipal: null, cnaesSecundarios: [], quando: AGORA })
    await db.conversasEmitente.put({
      conversaId: 'c1', emitenteId: 'e1', empresaAtivaId: null, titulo: 'T',
      mensagens: [{ papel: 'user', texto: 'oi', quando: AGORA }], updatedAt: AGORA, createdAt: AGORA,
    })
    expect(await db.table('audit_log').count()).toBe(1)
    expect(await db.table('ia_feedback').count()).toBe(1)
    expect((await db.cest.get('1234567'))?.descricao).toBe('C')
    expect((await db.cnae.get('0161001'))?.fatorR).toBe(false)
    expect((await db.consultasCnpj.get('12345678000195'))?.razaoSocial).toBe('R')
    expect((await db.conversasEmitente.get('c1'))?.mensagens).toHaveLength(1)
  })

  it('ponte CNAE→NBS + consolidadas + grafometa', async () => {
    await db.cnaeNbs.bulkAdd([{ cnae7: '0161001', cnae: '0161-0/01', nbs: '118032100', fonte: 'por_codigo' }])
    await db.lcNbs.bulkAdd([{
      lc: '01.01', nbs: '118032100', cct: '000001', descricaoLc: 'L', descricaoNbs: 'N',
      descricaoCct: 'C', onerosa: 'S', exterior: 'N', indop: '1', local: 'BR',
    }])
    await db.classificacoesConsolidadas.put({
      cnae7: '0161001', codigoFormatado: '0161-0/01', descricao: 'D', fonteDescricao: 'oficial',
      anexoSimples: ['III'], situacao: 'Permitido', fatorR: false, vedacoes: ['V'],
      nbsVinculadas: [], beneficiosReforma: [], divergencia: null, estadoNbs: 'mapeado',
    })
    await db.grafometa.put({ id: 'atual', hash: 'h', versao: 'v', nodos: 1, arestas: 2, geradoEm: AGORA })
    expect(await db.cnaeNbs.count()).toBe(1)
    expect(await db.lcNbs.count()).toBe(1)
    expect((await db.classificacoesConsolidadas.get('0161001'))?.estadoNbs).toBe('mapeado')
    expect((await db.grafometa.get('atual'))?.nodos).toBe(1)
  })
})

/* ------------------------------------------------- 2) validação --- */

describe('validação fail-closed', () => {
  it('rejeita formatos inválidos com prefixo validacao:', async () => {
    await expect(db.empresas.add({ razaoSocial: 'R', cnpj: '123', fantasia: 'F', criadoEm: AGORA })).rejects.toThrow(/validacao:empresas:cnpj-formato/)
    await expect(db.nfeNotas.add({ ...NOTA('curta', 1) } as never)).rejects.toThrow(/validacao:nfeNotas:chave-formato/)
    await expect(db.cnae.put({ codigo7: '123', codigoFormatado: 'x', descricao: 'D', situacao: 'Permitido', anexos: [], fatorR: false })).rejects.toThrow(/validacao:cnae:codigo7-formato/)
    await expect(db.cest.put({ codigo: '123', descricao: 'C' })).rejects.toThrow(/validacao:cest:codigo-formato/)
    await expect(db.consultasCnpj.put({ cnpj: '', razaoSocial: 'R', fantasia: 'F', cnaesSecundarios: [], quando: AGORA } as never)).rejects.toThrow(/validacao:consultasCnpj:cnpj-/)
    await expect(db.table('nada' as never).get('x')).rejects.toThrow(/store-desconhecida/)
  })

  it('rejeita NaN/Infinity, enums e chaves ruins', async () => {
    await expect(db.produtos.add({
      empresaId: null, codigo: 'S', nome: 'N', ncm: '99999999', cfop: '', cstIcms: '', pis: '', cofins: '',
      quantidade: NaN, valorUnitario: 1, cstReforma: '000', cClassTrib: '000001', regraGeral: false,
      classificacaoSnapshot: {} as never, criadoEm: AGORA, atualizadoEm: AGORA,
    })).rejects.toThrow(/nao-numerico/)
    await expect(db.nfeNotas.add({ ...NOTA('1'.repeat(44), 1, 'diagonal' as never) } as never)).rejects.toThrow(/direcao-invalido/)
    await expect(db.empresas.get('' as never)).rejects.toThrow(/chave-vazia/)
    expect(() => validarChave('empresas', -1)).toThrow(/chave-numerica-invalida/)
    expect(() => validarRegistro('empresas', null)).toThrow(/registro-invalido/)
    expect(() => validarRegistro('inexistente', {})).toThrow(/store-desconhecida/)
  })

  it('campos extras são ignorados (paridade schemaless), não quebram', async () => {
    await db.cfop.put({ codigo: '5102', descricao: 'V', id: 'ignorado' } as never)
    expect((await db.cfop.get('5102'))?.descricao).toBe('V')
    expect(somenteConhecidos('cfop', { codigo: '1', xyz: 2 })).toEqual({ codigo: '1' })
    expect(camposDe('[empresaId+chave]')).toEqual(['empresaId', 'chave'])
    expect(camposDe('codigo')).toEqual(['codigo'])
  })
})

/* --------------------------------------- 3) restrições Prisma --- */

describe('restrições relacionais', () => {
  it('add duplica chave → erro; put faz upsert', async () => {
    await db.cst.put({ codigo: '000', descricao: 'A' } as never)
    await expect(db.cst.add({ codigo: '000', descricao: 'B' } as never)).rejects.toThrow()
    await db.cst.put({ codigo: '000', descricao: 'B' } as never)
    expect((await db.cst.get('000'))?.descricao).toBe('B')
    expect(await db.cst.count()).toBe(1)
  })

  it('auto-incremento gera ids distintos; put com id respeita', async () => {
    const a = await db.empresas.add({ razaoSocial: 'A', cnpj: '', fantasia: '', criadoEm: AGORA })
    const b = await db.empresas.add({ razaoSocial: 'B', cnpj: '', fantasia: '', criadoEm: AGORA })
    expect(a).not.toBe(b)
    await db.empresas.put({ id: 999, razaoSocial: 'C', cnpj: '', fantasia: '', criadoEm: AGORA })
    expect((await db.empresas.get(999))?.razaoSocial).toBe('C')
  })

  it('unique (empresaId+chave) impede duplicada', async () => {
    await db.nfeNotas.add({ ...NOTA('1'.repeat(44), 7) } as never)
    await expect(db.nfeNotas.add({ ...NOTA('1'.repeat(44), 7) } as never)).rejects.toThrow()
    // mesma chave em outra empresa é outra linha
    await db.nfeNotas.add({ ...NOTA('1'.repeat(44), 8) } as never)
    expect(await db.nfeNotas.count()).toBe(2)
  })

  it('update mescla e retorna 1; inexistente retorna 0', async () => {
    await db.cfop.put({ codigo: '5102', descricao: 'V' })
    expect(await db.cfop.update('5102', { descricao: 'Nova' })).toBe(1)
    expect((await db.cfop.get('5102'))?.descricao).toBe('Nova')
    expect(await db.cfop.update('9999', { descricao: 'X' })).toBe(0)
  })

  it('delete de ausente é no-op; clear esvazia', async () => {
    await db.cfop.delete('ausente')
    await db.cfop.put({ codigo: '1', descricao: 'V' })
    await db.cfop.clear()
    expect(await db.cfop.count()).toBe(0)
    expect(await db.cfop.get('1')).toBeUndefined()
  })
})

/* -------------------------------------------------- 4) consultas --- */

describe('consultas', () => {
  beforeEach(async () => {
    await db.anexos.bulkPut([
      { id: 'a1', codigo: '02011000', tipo: 'NCM', permissao: 'permitido', nroAnexo: 1, nroItemAnexoLei: null, descrAnexo: 'CB', descrItemAnexo: null, descrCondicao: null, descrExcecao: null, observacao: null, inicioVigencia: null, fimVigencia: null },
      { id: 'a2', codigo: '02012000', tipo: 'NCM', permissao: 'negado', nroAnexo: 2, nroItemAnexoLei: null, descrAnexo: 'X', descrItemAnexo: null, descrCondicao: null, descrExcecao: null, observacao: null, inicioVigencia: null, fimVigencia: null },
      { id: 'a3', codigo: '02011000', tipo: 'NCM', permissao: 'permitido', nroAnexo: 3, nroItemAnexoLei: null, descrAnexo: 'Y', descrItemAnexo: null, descrCondicao: null, descrExcecao: null, observacao: null, inicioVigencia: null, fimVigencia: null },
    ] as never[])
  })

  it('equals/anyOf/first/count/delete/limit', async () => {
    expect(await db.anexos.where('codigo').equals('02011000').count()).toBe(2)
    expect((await db.anexos.where('codigo').equals('02011000').first())?.id).toBeDefined()
    expect(await db.anexos.where('nroAnexo').anyOf([1, 3]).toArray()).toHaveLength(2)
    expect(await db.anexos.where('codigo').equals('02011000').limit(1).toArray()).toHaveLength(1)
    expect(await db.anexos.where('codigo').equals('nada').first()).toBeUndefined()
    expect(await db.anexos.where('codigo').equals('02012000').delete()).toBe(1)
    expect(await db.anexos.count()).toBe(2)
  })

  it('between com inclusão de borda', async () => {
    await db.ncmNomenclatura.bulkPut([
      { codigo: '0201', codigoOriginal: '0201', descricao: 'A', dataInicio: null, dataFim: null, ato: null },
      { codigo: '02011000', codigoOriginal: '0201.10.00', descricao: 'B', dataInicio: null, dataFim: null, ato: null },
      { codigo: '03', codigoOriginal: '03', descricao: 'C', dataInicio: null, dataFim: null, ato: null },
    ] as never[])
    const faixa = await db.ncmNomenclatura.where('codigo').between('0201', '0201\uffff', true, true).toArray()
    expect(faixa.map((r) => r.codigo).sort()).toEqual(['0201', '02011000'])
  })

  it('startsWith no meta (memória IA)', async () => {
    await db.meta.put({ chave: 'aurum_memoria_fato__e1__x', valor: { codigo: 'f1' } })
    await db.meta.put({ chave: 'outra', valor: {} })
    const linhas = await db.table('meta').where('chave').startsWith('aurum_memoria_fato__e1__').toArray()
    expect(linhas).toHaveLength(1)
  })

  it('índice composto [empresaId+chave]', async () => {
    await db.nfeNotas.add({ ...NOTA('9'.repeat(44), 5) } as never)
    const achada = await db.nfeNotas.where('[empresaId+chave]').equals([5, '9'.repeat(44)]).first()
    expect(achada?.empresaId).toBe(5)
    expect(await db.nfeNotas.where('[empresaId+chave]').equals([6, '9'.repeat(44)]).first()).toBeUndefined()
  })

  it('orderBy+reverse+limit e sortBy+and', async () => {
    await db.table('ia_feedback').bulkPut([
      { quando: '2026-01-01', descricao: 'a', via: 'v', decisao: 'x', confianca: 0.1 },
      { quando: '2026-01-03', descricao: 'b', via: 'v', decisao: 'y', confianca: 0.2 },
      { quando: '2026-01-02', descricao: 'c', via: 'w', decisao: null, confianca: 0.3 },
    ] as never[])
    const ultimas = await db.table('ia_feedback').orderBy('quando').reverse().limit(2).toArray()
    expect(ultimas.map((r) => r.descricao)).toEqual(['b', 'c'])
    const filtradas = await db.table('ia_feedback').where('via').equals('v').and((r) => (r.confianca as number) > 0.15).toArray()
    expect(filtradas.map((r) => r.descricao)).toEqual(['b'])
    const ordenadas = await db.table('ia_feedback').where('via').equals('v').and(() => true).reverse().sortBy('quando')
    expect(ordenadas.map((r) => r.descricao)).toEqual(['a', 'b'])
  })

  it('uniqueKeys distintas', async () => {
    await db.cnaeNbs.bulkAdd([
      { cnae7: '0161001', cnae: '0161-0/01', nbs: '118032100', fonte: 'por_codigo' },
      { cnae7: '0161001', cnae: '0161-0/01', nbs: '118032200', fonte: 'por_codigo' },
      { cnae7: '1011201', cnae: '1011-2/01', nbs: '118032100', fonte: 'por_codigo' },
    ])
    const distintas = await db.cnaeNbs.orderBy('cnae7').uniqueKeys()
    expect(distintas.sort()).toEqual(['0161001', '1011201'])
  })
})

/* ----------------------------------------------------- 5) lotes --- */

describe('lotes', () => {
  it('bulkPut em lotes de 500 com progresso', async () => {
    const itens = Array.from({ length: 1200 }, (_, i) => ({
      codigo: `9${String(i).padStart(3, '0')}`, codigoOriginal: `9${i}`, descricao: `N${i}`,
      dataInicio: null, dataFim: null, ato: null,
    }))
    const marcas: Array<[number, number]> = []
    await bulkPut(db.ncmNomenclatura, itens as never[], (f, t) => void marcas.push([f, t]))
    expect(await db.ncmNomenclatura.count()).toBe(1200)
    expect(marcas[marcas.length - 1]).toEqual([1200, 1200])
    expect(marcas.length).toBe(3)
  })

  it('modo inserir pula duplicadas; bulkAdd falha nelas', async () => {
    await db.cfop.put({ codigo: '5102', descricao: 'V' })
    await bulkPut(db.cfop, [{ codigo: '5102', descricao: 'X' }, { codigo: '5103', descricao: 'Y' }] as never[], INSERIR)
    expect((await db.cfop.get('5102'))?.descricao).toBe('V')
    expect((await db.cfop.get('5103'))?.descricao).toBe('Y')
    await expect(db.cfop.bulkAdd([{ codigo: '5102', descricao: 'Z' }] as never[])).rejects.toThrow()
  })
})

/* -------------------------------------------------- 6) API banco --- */

describe('API do banco', () => {
  it('tables/tables-isOpen/verno/transaction/contarTodos', async () => {
    expect(db.tables).toHaveLength(TODAS_STORES.length)
    expect(db.tables.some((t) => t.name === 'audit_log')).toBe(true)
    expect(db.isOpen()).toBe(true)
    expect(db.verno).toBe(1)
    await db.open()
    let executou = false
    await db.transaction('rw', [db.empresas], async () => {
      executou = true
    })
    expect(executou).toBe(true)
    await db.cfop.put({ codigo: '1', descricao: 'V' })
    const todos = await contarTodos()
    expect(todos.cfop).toBe(1)
    expect(todos.ncm).toBe(0)
    expect(Object.keys(todos)).toContain('grafometa')
  })

  it('close não quebra; delete zera tudo', async () => {
    await db.cfop.put({ codigo: '1', descricao: 'V' })
    await db.close()
    await db.open()
    expect((await db.cfop.get('1'))?.descricao).toBe('V')
    await db.delete()
    expect(await db.cfop.count()).toBe(0)
  })
})

/* ------------------------------------------------- 7) segurança --- */

describe('segurança', () => {
  it("injeção SQL vira literal (parametrização do Prisma)", async () => {
    const mal = "'; DROP TABLE Cfop; --"
    await db.cfop.put({ codigo: '1', descricao: mal })
    expect((await db.cfop.get('1'))?.descricao).toBe(mal)
    expect(await db.cfop.where('codigo').equals(mal).count()).toBe(0)
    expect(await db.cfop.count()).toBe(1)
    expect(db.tables.some((t) => t.name === 'cfop')).toBe(true)
  })

  it('campo fora do alfabeto é recusado', () => {
    expect(() => db.cfop.orderBy('codigo; DROP')).toThrow(/campo-invalido/)
    expect(() => db.cfop.where('a+b')).toThrow()
  })

  it('chave com travessia não atinge disco (é só valor)', async () => {
    await db.meta.put({ chave: '../../etc', valor: 1 })
    expect((await db.meta.get('../../etc'))?.valor).toBe(1)
  })
})

/* --------------------------------- 10) correções da auditoria --- */

describe('correções da auditoria multiagente', () => {
  it('bootstrap: banco vazio ganha as 27 tabelas sozinho', async () => {
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const { DriverPrisma } = await import('@/infrastructure/db/driver-prisma')
    const caminho = join(tmpdir(), `aurum-bootstrap-${process.pid}-${Date.now()}.db`)
    const d = new DriverPrisma(caminho)
    expect(await d.contar('cfop', null)).toBe(0)
    await d.upsert('cfop', { codigo: 'X', descricao: 'Y' })
    expect(await d.contar('cfop', null)).toBe(1)
    await d.fechar()
  })

  it('restore valida tudo antes de apagar (falha = zero escrita)', async () => {
    const { restaurarBackup } = await import('@/application/backup')
    await db.cfop.put({ codigo: 'MANTIDO', descricao: 'V' })
    await expect(
      restaurarBackup({
        exportadoEm: new Date().toISOString(),
        ncm: [],
        cst: [],
        cstClassTrib: [],
        nomenclatura: [],
        empresas: [],
        produtos: [],
        emitente: null,
        cfop: [{ codigo: 'NOVO', descricao: 'N' }],
        cstIcms: [],
        cstPisCofins: [],
        nfeNotas: [{ chave: 'curta', empresaId: 1 }],
      }),
    ).rejects.toThrow(/validacao:nfeNotas:chave-formato/)
    expect((await db.cfop.get('MANTIDO'))?.descricao).toBe('V')
    expect(await db.cfop.get('NOVO')).toBeUndefined()
  })

  it('troca de chave com dado inválido preserva o original', async () => {
    const { salvarRegistroAux } = await import('@/application/auxiliares')
    await db.cfop.put({ codigo: '5102', descricao: 'Venda' })
    const r = await salvarRegistroAux({
      store: 'cfop',
      keyPath: 'codigo',
      dados: { codigo: '', descricao: 'X' },
      chaveOriginal: '5102',
    })
    expect(r.ok).toBe(false)
    expect((await db.cfop.get('5102'))?.descricao).toBe('Venda')
  })

  it('CNPJ mascarado vira dígitos (nunca rejeita o cadastro)', async () => {
    const { cadastrarEmpresa } = await import('@/application/empresas')
    const r = await cadastrarEmpresa({ razaoSocial: 'R', cnpj: '12.345.678/0001-95', fantasia: 'F' })
    expect(r.ok).toBe(true)
    expect(r.empresa?.cnpj).toBe('12345678000195')
    const manual = await cadastrarEmpresa({ razaoSocial: 'M', cnpj: 'ISENTO' })
    expect(manual.ok).toBe(true)
    expect(manual.empresa?.cnpj).toBe('')
  })

  it('listarNotas devolve emissão descendente', async () => {
    const { listarNotas } = await import('@/application/notas-xml')
    const { FILTROS_NFE_VAZIOS } = await import('@/infrastructure/nfe/tipos')
    const base = { ...NOTA('1'.repeat(44), 77, 'entrada'), emitCnpj: '12345678000195' }
    await db.nfeNotas.add({ ...base, chave: '1'.repeat(44), dataEmissao: '2026-01-01' } as never)
    await db.nfeNotas.add({ ...base, chave: '2'.repeat(44), dataEmissao: '2026-03-01' } as never)
    await db.nfeNotas.add({ ...base, chave: '3'.repeat(44), dataEmissao: '2026-02-01' } as never)
    const lista = await listarNotas(77, { ...FILTROS_NFE_VAZIOS, inicio: '', fim: '' })
    expect(lista.map((n) => n.chave)).toEqual(['2'.repeat(44), '3'.repeat(44), '1'.repeat(44)])
  })

  it('backup cobre as 27 stores sem vazar KEK', async () => {
    const { montarBackup, META_SENSIVEL_PREFIXOS } = await import('@/application/backup')
    await db.meta.put({ chave: 'aurum_kek_teste', valor: 'segredo' })
    await db.conversasEmitente.put({
      conversaId: 'c9', emitenteId: 'e9', empresaAtivaId: null, titulo: 'T',
      mensagens: [], updatedAt: AGORA, createdAt: AGORA,
    })
    const b = await montarBackup()
    const bruto = JSON.stringify(b)
    expect(bruto).not.toContain('segredo')
    expect(bruto).not.toContain('aurum_kek_teste')
    expect(META_SENSIVEL_PREFIXOS).toContain('aurum_kek_')
    expect(b.conversasEmitente).toHaveLength(1)
    expect(b.meta?.some((r) => (r as { chave?: string }).chave === 'aurum_kek_teste')).toBe(false)
  })
})

/* --------------------------------- 9) canal IPC do main --- */

describe('canal db:op do processo main', () => {
  it('allowlist + validação + round-trip em banco isolado', async () => {
    const { copyFileSync, mkdirSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { registrarIpcDb } = await import('../electron/main/db')
    const capturados = new Map<string, (ev: unknown, req: never) => Promise<unknown>>()
    const ipcFalso = {
      handle: (canal: string, fn: (ev: unknown, req: never) => Promise<unknown>) => void capturados.set(canal, fn),
    }
    // userData isolado com schema aplicado (cópia do template).
    const userData = join(tmpdir(), `aurum-ipc-userdata-${process.pid}`)
    mkdirSync(userData, { recursive: true })
    copyFileSync(process.env.AURUM_TEST_TEMPLATE as string, join(userData, 'aurum.db'))
    registrarIpcDb(ipcFalso as never, { getPath: () => userData } as never)
    const handler = capturados.get('db:op') as (ev: unknown, req: unknown) => Promise<unknown>
    expect(typeof handler).toBe('function')
    // allowlist + validação (fail-closed, sem tocar no banco)
    await expect(handler(null, { op: 'porChave', tabela: 'injetada', chave: 'x' })).rejects.toThrow(/store-desconhecida/)
    await expect(handler(null, { op: 'DROP', tabela: 'cfop' })).rejects.toThrow(/op-invalida/)
    await expect(handler(null, { op: 'lote', tabela: 'cfop', registros: new Array(2001).fill({ codigo: 'x' }) })).rejects.toThrow(/lote-invalido/)
    await expect(handler(null, { op: 'upsert', tabela: 'cfop', registro: { codigo: '1', descricao: 42 } })).rejects.toThrow(/validacao/)
    await expect(handler(null, { op: 'buscar', tabela: 'cfop', where: { tipo: 'equals', campo: 'codigo; X', valor: '1' } })).rejects.toThrow(/campo-invalido/)
    await expect(handler(null, { op: 'apagarTudo', tabelas: ['cfop', 'injetada'] })).rejects.toThrow(/store-desconhecida/)
    await expect(handler(null, { op: 'apagarTudo' })).rejects.toThrow(/tabelas-invalidas/)
    await expect(handler(null, { op: 'removerOnde', tabela: 'cfop' })).rejects.toThrow(/where-obrigatorio/)
    // round-trip válido
    await expect(handler(null, { op: 'lote', tabela: 'cfop', registros: [] })).resolves.toBeNull()
    await handler(null, { op: 'upsert', tabela: 'cfop', registro: { codigo: 'IPC1', descricao: 'via-main' } })
    const lidas = (await handler(null, { op: 'buscar', tabela: 'cfop', where: null })) as Array<{ codigo: string }>
    expect(lidas.some((r) => r.codigo === 'IPC1')).toBe(true)
    expect(await handler(null, { op: 'contar', tabela: 'cfop', where: null })).toBeGreaterThan(0)
    await handler(null, { op: 'limpar', tabela: 'cfop' })
    expect(await handler(null, { op: 'contar', tabela: 'cfop', where: null })).toBe(0)
  })
})

describe('drivers', () => {
  it('memória tem a mesma semântica básica', async () => {
    const m = new DriverMemoria()
    await m.inserir('cfop', { codigo: '1', descricao: 'V' })
    await expect(m.inserir('cfop', { codigo: '1', descricao: 'X' })).rejects.toThrow(/chave-duplicada/)
    await m.upsert('cfop', { codigo: '1', descricao: 'Y' })
    expect(await m.porChave('cfop', '1')).toMatchObject({ descricao: 'Y' })
    expect(await m.buscar('cfop', { tipo: 'equals', campo: 'codigo', valor: '1' })).toHaveLength(1)
    expect(await m.contar('cfop', null)).toBe(1)
    expect(await m.atualizar('cfop', '1', { descricao: 'Z' })).toBe(1)
    expect(await m.atualizar('cfop', 'nada', { descricao: 'Z' })).toBe(0)
    expect(await m.removerOnde('cfop', { tipo: 'equals', campo: 'codigo', valor: '1' })).toBe(1)
    await m.limpar('cfop')
    await m.apagarTudo(['cfop'])
  })

  it('IPC: renderer grava/lê via ponte (main faz o resto)', async () => {
    const g = globalThis as unknown as { window?: Record<string, unknown> }
    const anterior = g.window
    const memoria = new DriverMemoria()
    g.window = {
      ...(anterior ?? {}),
      aurum: {
        db: {
          op: async (req: { op: string; tabela?: string; chave?: string | number; registro?: Record<string, unknown>; where?: null; registros?: Array<Record<string, unknown>> }) => {
            switch (req.op) {
              case 'porChave': return memoria.porChave(req.tabela as string, req.chave as string)
              case 'upsert': return memoria.upsert(req.tabela as string, req.registro as Record<string, unknown>)
              case 'buscar': return memoria.buscar(req.tabela as string, req.where ?? null)
              case 'contar': return memoria.contar(req.tabela as string, req.where ?? null)
              default: throw new Error(`op-desconhecida:${req.op}`)
            }
          },
        },
      },
    }
    try {
      // Com a ponte presente, o driver resolvido é o IPC.
      const driver = resolverDriver()
      expect(driver.constructor.name).toBe('DriverIpc')
      await db.cfop.put({ codigo: 'IPC', descricao: 'via-ipc' })
      expect((await db.cfop.get('IPC'))?.descricao).toBe('via-ipc')
    } finally {
      if (anterior === undefined) delete g.window
      else g.window = anterior
    }
  })
})

/* ----------------------------- snapshot pré-restore --- */

describe('snapshot pré-restore', () => {
  async function registrarSnapshotEm(userData: string) {
    const { registrarIpcDb } = await import('../electron/main/db')
    const capturados = new Map<string, (ev: unknown) => Promise<unknown>>()
    const ipcFalso = {
      handle: (canal: string, fn: (ev: unknown) => Promise<unknown>) => void capturados.set(canal, fn),
    }
    registrarIpcDb(ipcFalso as never, { getPath: () => userData } as never)
    const handler = capturados.get('db:snapshot') as (ev: unknown) => Promise<{ ok: boolean; caminho?: string; erro?: string }>
    expect(typeof handler).toBe('function')
    return handler
  }

  async function contarTabelas(caminho: string): Promise<number> {
    // Leitura só-leitura: conta tabelas de dados (ignora internas do SQLite/Prisma).
    const { DatabaseSync } = await import('node:sqlite')
    const bd = new DatabaseSync(caminho, { readOnly: true })
    try {
      const linha = bd.prepare(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'",
      ).get() as { n: number }
      return linha.n
    } finally {
      bd.close()
    }
  }

  it('handler cria cópia válida com 27 tabelas', async () => {
    const { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const userData = join(tmpdir(), `aurum-snap-userdata-${process.pid}-${Date.now()}`)
    mkdirSync(userData, { recursive: true })
    copyFileSync(process.env.AURUM_TEST_TEMPLATE as string, join(userData, 'aurum.db'))
    const handler = await registrarSnapshotEm(userData)
    const r = await handler(null)
    expect(r.ok).toBe(true)
    const bak = join(userData, 'aurum.db.pre-restore.bak')
    expect(existsSync(bak)).toBe(true)
    expect(statSync(bak).size).toBeGreaterThan(0)
    expect(readFileSync(bak).subarray(0, 16).toString('utf8')).toBe('SQLite format 3\0')
    expect(await contarTabelas(bak)).toBe(27)
  })

  it('segundo snapshot sobrescreve (ainda um único .bak)', async () => {
    const { copyFileSync, mkdirSync, readdirSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const userData = join(tmpdir(), `aurum-snap-resnap-${process.pid}-${Date.now()}`)
    mkdirSync(userData, { recursive: true })
    copyFileSync(process.env.AURUM_TEST_TEMPLATE as string, join(userData, 'aurum.db'))
    const handler = await registrarSnapshotEm(userData)
    await handler(null)
    const r2 = await handler(null)
    expect(r2.ok).toBe(true)
    expect(readdirSync(userData).filter((f) => f.endsWith('.pre-restore.bak'))).toHaveLength(1)
  })

  it('sem aurum.db devolve ok:false sem lançar', async () => {
    const { mkdirSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const userData = join(tmpdir(), `aurum-snap-vazio-${process.pid}-${Date.now()}`)
    mkdirSync(userData, { recursive: true })
    const handler = await registrarSnapshotEm(userData)
    await expect(handler(null)).resolves.toMatchObject({ ok: false })
  })
})
