/**
 * Migração do banco legado (v2 — gravado pelo `index.html`) para o schema
 * atual (v3).
 *
 * A versão anterior usava os **mesmos keyPaths**, mas:
 *   - gravava os indicadores com os nomes do JSON de origem (`ind_gRed`,
 *     `ind_RedutorBC`, `ind_gTribRegular`, …) e `docs` com valores crus
 *     (`'Sim'`/`'Não'`/`1`/`'S'`);
 *   - não tinha as stores `referencia` e `nbs` (daí os anexos/documentos
 *     caírem no fallback sem a resemeação da base embutida).
 *
 * Aqui garantimos que a abertura no novo schema preserva as linhas (o Dexie
 * apenas **acrescenta** os índices novos), normaliza o conteúdo e não executa
 * duas vezes.
 */
import { describe, expect, it } from 'vitest'
import { DB_NAME, DB_VERSION, STORES } from '@/domain/constants'
import { baseCompleta } from '@/infrastructure/base/base-service'
import { db } from '@/infrastructure/db/schema'

type Registro = Record<string, unknown>

/** Acessa campos que existiam apenas na versão legada do registro. */
const bruto = (v: unknown): Registro => v as Registro

/* ------------------------------------------------------------ fixtures --- */

const LINHAS: Array<[string, Registro[]]> = [
  [
    STORES.CST,
    [
      {
        codigo: '000',
        descricao: 'Tributação integral',
        ind_gIBSCBS: true,
        ind_gIBSCBSMono: false,
        ind_gRed: false,
        ind_gDif: false,
        ind_gTransfCred: true,
        docs: {
          NFe: 'Sim', NFCe: 'Não', CTe: 1, CTeOS: 0, BPe: 'S',
          BPeTM: 'N', NF3e: true, NFCom: false, NFSe: 'Sim',
        },
      },
      {
        codigo: '200',
        descricao: 'Alíquota reduzida',
        ind_gIBSCBS: true,
        ind_gIBSCBSMono: false,
        ind_gRed: true,
        ind_gDif: false,
        ind_gTransfCred: false,
        docs: {
          NFe: false, NFCe: false, CTe: false, CTeOS: false, BPe: false,
          BPeTM: false, NF3e: false, NFCom: false, NFSe: false,
        },
      },
    ],
  ],
  [
    STORES.CSTCT,
    [
      {
        id: '000|000001',
        cst: '000',
        descricaoCst: 'Tributação integral',
        cClassTrib: '000001',
        nome: 'Tributação integral',
        descricao: 'Alíquota padrão',
        lcRedacao: 'LC 214/2025, art. 100',
        lcRef: 'LC 214/25',
        tipoAliquota: 'Padrão',
        pRedIBS: 0,
        pRedCBS: 0,
        ind_RedutorBC: 1,
        ind_gTribRegular: 2,
        ind_CredPres: 3,
        indMono: 0,
        indMonoReten: 1,
        indMonoRet: 0,
        indMonoDif: 1,
        'LC 214/25': 'LC 214/25',
      },
      {
        id: '200|000003',
        cst: '200',
        descricaoCst: 'Alíquota reduzida',
        cClassTrib: '000003',
        nome: 'Redução de 60%',
        descricao: 'Alíquota reduzida para alimentos',
        lcRedacao: '',
        lcRef: '',
        tipoAliquota: '',
        pRedIBS: 60,
        pRedCBS: 60,
      },
    ],
  ],
  [
    STORES.NCM,
    [
      {
        id: '84713012|000001|0',
        codigo: '84713012',
        codigoFormatado: '84.71.30.12',
        cst: '000',
        cClassTrib: '000001',
        baseLegal: 'LC 214/2025',
        reducao: 0,
        aliquotaIBS: 17.7,
        aliquotaCBS: 8.8,
        descricao: 'Máquinas automáticas para processamento de dados',
        cstDetalhes: { codigo: '000' },
        cstClassTribDetalhes: { id: '000|000001' },
        referencia: { id: '000|000001' },
        resumo: { descricaoCClassTrib: 'Tributação integral' },
      },
      {
        id: '02011000|000003|1',
        codigo: '02011000',
        codigoFormatado: '02.01.10.00',
        cst: '200',
        cClassTrib: '000003',
        baseLegal: 'Art. 135 da LC 214/2025',
        reducao: 60,
        aliquotaIBS: null,
        aliquotaCBS: null,
        descricao: 'Carnes e miudezas comestíveis de bovinos',
      },
    ],
  ],
  [
    STORES.NCMNOM,
    [
      {
        codigo: '8471',
        codigoOriginal: '8471',
        descricao: 'Máquinas automáticas para processamento de dados',
        dataInicio: null,
        dataFim: null,
        ato: null,
      },
    ],
  ],
  [
    STORES.EMPRESAS,
    [
      {
        id: 1,
        razaoSocial: 'Aurum Bit Labs & Studios LTDA',
        cnpj: '12345678000190',
        fantasia: 'Aurum',
        criadoEm: '2025-06-01T00:00:00.000Z',
      },
    ],
  ],
  [
    STORES.PRODUTOS,
    [
      {
        id: 1,
        empresaId: 1,
        codigo: 'SKU-1',
        nome: 'Servidor de aplicação',
        ncm: '84713012',
        cfop: '5102',
        cstIcms: '000',
        pis: '01',
        cofins: '01',
        quantidade: 2,
        valorUnitario: 1000,
        cstReforma: '000',
        cClassTrib: '000001',
        regraGeral: false,
        classificacaoSnapshot: {
          codigo: '84713012',
          codigoFormatado: '84.71.30.12',
          cst: '000',
          cClassTrib: '000001',
          descricao: 'Máquinas automáticas',
          baseLegal: 'LC 214/2025',
          pRedIBS: 0,
          pRedCBS: 0,
          anexo: null,
          classificacao: 'Tributação integral',
        },
        criadoEm: '2025-06-01T00:00:00.000Z',
        atualizadoEm: '2025-06-01T00:00:00.000Z',
      },
    ],
  ],
  [
    STORES.META,
    [
      {
        chave: 'importacao',
        data: '2025-06-01T00:00:00.000Z',
        arquivo: 'reforma_tributaria_por_ncm.json',
      },
    ],
  ],
  [
    STORES.CFOP,
    [{ codigo: '5102', descricao: 'Venda de mercadoria adquirida de terceiros', tipo: 'Saída' }],
  ],
  [STORES.CSTICMS, [{ codigo: '000', descricao: 'Tributada integralmente' }]],
  [STORES.CSTPISCOFINS, [{ codigo: '01', descricao: 'Operação com alíquota básica' }]],
]

/** Cria o banco exatamente como a v1 (`openDB` do `index.html`) fazia. */
function semearBancoLegado(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2)
    req.onupgradeneeded = () => {
      const d = req.result
      const ncm = d.createObjectStore(STORES.NCM, { keyPath: 'id' })
      ncm.createIndex('codigo', 'codigo', { unique: false })
      ncm.createIndex('cst', 'cst', { unique: false })
      d.createObjectStore(STORES.CST, { keyPath: 'codigo' })
      const cct = d.createObjectStore(STORES.CSTCT, { keyPath: 'id' })
      cct.createIndex('cst', 'cst', { unique: false })
      const nom = d.createObjectStore(STORES.NCMNOM, { keyPath: 'codigo' })
      nom.createIndex('descricao', 'descricao', { unique: false })
      d.createObjectStore(STORES.EMPRESAS, { keyPath: 'id', autoIncrement: true })
      const prod = d.createObjectStore(STORES.PRODUTOS, { keyPath: 'id', autoIncrement: true })
      prod.createIndex('empresaId', 'empresaId', { unique: false })
      prod.createIndex('ncm', 'ncm', { unique: false })
      d.createObjectStore(STORES.META, { keyPath: 'chave' })
      d.createObjectStore(STORES.CFOP, { keyPath: 'codigo' })
      d.createObjectStore(STORES.CSTICMS, { keyPath: 'codigo' })
      d.createObjectStore(STORES.CSTPISCOFINS, { keyPath: 'codigo' })
    }
    req.onsuccess = () => {
      const d = req.result
      try {
        const tx = d.transaction(
          LINHAS.map(([nome]) => nome),
          'readwrite',
        )
        tx.oncomplete = () => {
          d.close()
          resolve()
        }
        tx.onerror = () => {
          d.close()
          reject(tx.error)
        }
        tx.onabort = () => {
          d.close()
          reject(tx.error)
        }
        for (const [nome, itens] of LINHAS) {
          const store = tx.objectStore(nome)
          for (const item of itens) store.put(item)
        }
      } catch (e) {
        d.close()
        reject(e)
      }
    }
    req.onerror = () => reject(req.error)
  })
}

/** Leitura sem passar pelo Dexie — serve de "antes" para as comparações. */
async function lerLegado(nome: string, chave: IDBValidKey): Promise<Registro | undefined> {
  const banco = await new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open(DB_NAME, 2)
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  const valor = await new Promise<Registro | undefined>((res, rej) => {
    const tx = banco.transaction(nome, 'readonly')
    const req = tx.objectStore(nome).get(chave)
    req.onsuccess = () => res(req.result as Registro | undefined)
    req.onerror = () => rej(req.error)
  })
  banco.close()
  return valor
}

/* -------------------------------------------------------------- testes --- */

describe('migração do banco legado v2 → v3', () => {
  it('semeia o banco no formato da versão anterior', async () => {
    await semearBancoLegado()
    const antes = await lerLegado(STORES.CST, '000')
    expect(antes).toMatchObject({ codigo: '000', ind_gRed: false })
    expect(bruto(antes).indReducao).toBeUndefined()
  })

  it('normaliza a tabela CST (indicadores e documentos)', async () => {
    const reduzida = await db.cst.get('200')
    expect(reduzida).toMatchObject({
      codigo: '200',
      descricao: 'Alíquota reduzida',
      indIBSCBS: true,
      indIBSCBSMono: false,
      indReducao: true,
      indDiferimento: false,
      indTransferenciaCredito: false,
    })
    expect(bruto(reduzida).ind_gRed).toBeUndefined()

    const integral = await db.cst.get('000')
    expect(integral?.docs).toMatchObject({
      NFe: true,
      NFCe: false,
      CTe: true,
      CTeOS: false,
      BPe: true,
      BPeTM: false,
      NF3e: true,
      NFCom: false,
      NFSe: true,
    })
    expect(await db.cst.count()).toBe(2)
  })

  it('normaliza cClassTrib (nomes legados e campos opcionais)', async () => {
    const cct = await db.cstClassTrib.get('000|000001')
    expect(cct).toMatchObject({
      id: '000|000001',
      cst: '000',
      cClassTrib: '000001',
      nome: 'Tributação integral',
      lcRef: 'LC 214/25',
      tipoAliquota: 'Padrão',
      pRedIBS: 0,
      pRedCBS: 0,
      indRedutorBC: 1,
      indTribRegular: 2,
      indCredPres: 3,
      indMono: 0,
      indMonoReten: 1,
      indMonoRet: 0,
      indMonoDif: 1,
      creditoPara: null,
      inicioVigencia: null,
      fimVigencia: null,
      atualizadoEm: null,
    })
    expect(bruto(cct).ind_RedutorBC).toBeUndefined()
    expect(bruto(cct).ind_gTribRegular).toBeUndefined()
    expect(bruto(cct).descricaoCst).toBeUndefined()
    expect(bruto(cct)['LC 214/25']).toBeUndefined()

    const parcial = await db.cstClassTrib.get('200|000003')
    expect(parcial).toMatchObject({
      pRedIBS: 60,
      pRedCBS: 60,
      indRedutorBC: null,
      indTribRegular: null,
      indCredPres: null,
      lcRedacao: null,
      lcRef: null,
      tipoAliquota: null,
    })
    expect(await db.cstClassTrib.count()).toBe(2)
  })

  it('normaliza os vínculos NCM e mantém o join por código', async () => {
    const vinculo = await db.ncm.get('84713012|000001|0')
    expect(vinculo).toMatchObject({
      codigo: '84713012',
      codigoFormatado: '84.71.30.12',
      cst: '000',
      cClassTrib: '000001',
      reducao: 0,
      aliquotaIBS: 17.7,
      aliquotaCBS: 8.8,
      documentos: '',
    })
    expect(bruto(vinculo).cstDetalhes).toBeUndefined()
    expect(bruto(vinculo).resumo).toBeUndefined()

    const semDocumento = await db.ncm.get('02011000|000003|1')
    expect(semDocumento?.documentos).toBe('')
    expect(semDocumento?.aliquotaIBS).toBeNull()

    expect(await db.ncm.where('codigo').equals('02011000').count()).toBe(1)
    // índice novo (v3) — não existia no banco legado
    expect(await db.ncm.where('cClassTrib').equals('000001').count()).toBe(1)
    expect(await db.cstClassTrib.where('cClassTrib').equals('000003').count()).toBe(1)
    expect(await db.produtos.where('cstReforma').equals('000').count()).toBe(1)
    expect(await db.ncm.count()).toBe(2)
  })

  it('preserva empresas, produtos e as demais tabelas do usuário', async () => {
    expect(await db.empresas.get(1)).toMatchObject({
      razaoSocial: 'Aurum Bit Labs & Studios LTDA',
      fantasia: 'Aurum',
    })
    const produto = await db.produtos.get(1)
    expect(produto).toMatchObject({
      codigo: 'SKU-1',
      ncm: '84713012',
      cstReforma: '000',
      cClassTrib: '000001',
      empresaId: 1,
    })
    expect(produto?.classificacaoSnapshot.anexo).toBeNull()
    expect(await db.cfop.get('5102')).toMatchObject({ tipo: 'Saída' })
    expect(await db.cstIcms.get('000')).toBeTruthy()
    expect(await db.cstPisCofins.get('01')).toBeTruthy()
    expect(await db.meta.get('importacao')).toMatchObject({
      arquivo: 'reforma_tributaria_por_ncm.json',
    })
    expect(await db.ncmNomenclatura.get('8471')).toMatchObject({ codigo: '8471' })
  })

  it('cria as stores novas (referência e NBS) sem dados', async () => {
    expect(db.verno).toBe(DB_VERSION)
    expect(await db.referencia.count()).toBe(0)
    expect(await db.nbs.count()).toBe(0)
    // o banco legado não tinha a referência → a base embutida deve ser semeada
    expect(await baseCompleta()).toBe(false)
  })

  it('não reexecuta a migração em aberturas seguintes', async () => {
    await db.cstClassTrib.update('000|000001', { lcRef: '   ' })
    db.close()
    await db.open()
    const cct = await db.cstClassTrib.get('000|000001')
    // só a migração converteria espaços em branco em `null`
    expect(cct?.lcRef).toBe('   ')
    expect(await db.ncm.count()).toBe(2)
  })
})
