/**
 * Tabelas auxiliares (SPEC §9) — cobre as duas correções da v1:
 *
 * 1. `[BUG] L1879`: a checagem de duplicidade agora vale para **qualquer**
 *    keyPath, inclusive o `id` composto `cst|cClassTrib`;
 * 2. validação **antes** de qualquer escrita (trocar a chave em edição não
 *    pode apagar o registro original quando a nova colide).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  NORMALIZADORES,
  excluirRegistroAux,
  garantirSementes,
  idCstCct,
  idVinculoNcm,
  salvarRegistroAux,
} from '@/application/auxiliares'
import { db } from '@/infrastructure/db/schema'

beforeEach(async () => {
  await Promise.all([
    db.cfop.clear(),
    db.cst.clear(),
    db.cstClassTrib.clear(),
    db.ncm.clear(),
    db.cstIcms.clear(),
    db.cstPisCofins.clear(),
  ])
})

/* ------------------------------------------------------------- chaves -- */

describe('idCstCct', () => {
  it('preenche à esquerda os dois lados', () => {
    expect(idCstCct('1', '2')).toBe('001|000002')
    expect(idCstCct('000', '000001')).toBe('000|000001')
    expect(idCstCct(null, undefined)).toBe('000|000000')
    expect(idCstCct('10A', '12B')).toBe('010|000012')
  })
})

describe('idVinculoNcm', () => {
  it('mantém a chave original na edição', () => {
    expect(idVinculoNcm('02011000', '000001', 'ID-ANTIGO')).toBe('ID-ANTIGO')
  })

  it('gera chave única no cadastro', () => {
    const a = idVinculoNcm('02011000', '000001')
    const b = idVinculoNcm('02011000', '000001')
    expect(a).toMatch(/^02011000\|000001\|x/)
    expect(a).not.toBe(b)
  })
})

describe('NORMALIZADORES', () => {
  it('ncm/ncmnomen/cfop ficam só com dígitos', () => {
    for (const chave of ['ncm', 'ncmnomen', 'cfop']) {
      const d: Record<string, unknown> = { codigo: '02.01.10' }
      NORMALIZADORES[chave]?.(d)
      expect(d.codigo).toBe('020110')
    }
  })

  it('cst vira código de 3 dígitos (correção do L1872: a chave é `codigo`)', () => {
    const registro: Record<string, unknown> = { codigo: '1' }
    NORMALIZADORES['cst']?.(registro)
    expect(registro.codigo).toBe('001')

    const comCst: Record<string, unknown> = { cst: '1' }
    NORMALIZADORES['cst']?.(comCst)
    expect(comCst.cst).toBe('001')
  })
})

/* ------------------------------------------------------------- escrita -- */

describe('salvarRegistroAux — CFOP (keyPath codigo)', () => {
  const cfop = (dados: Record<string, unknown>) =>
    salvarRegistroAux({
      store: 'cfop',
      keyPath: 'codigo',
      dados,
      camposObrigatorios: [
        { nome: 'codigo', label: 'Código' },
        { nome: 'descricao', label: 'Descrição' },
      ],
    })

  it('cria e normaliza o código', async () => {
    const r = await cfop({ codigo: '51-02', descricao: 'Venda de mercadoria' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.status).toBe('criado')
    expect(r.registro.codigo).toBe('5102')
    expect(await db.cfop.count()).toBe(1)
  })

  it('duplicidade é recusada', async () => {
    await cfop({ codigo: '5102', descricao: 'Venda' })
    const r = await cfop({ codigo: '5102', descricao: 'Outra' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.motivo).toContain('Já existe um registro com esta chave')
    expect(await db.cfop.count()).toBe(1)
    expect((await db.cfop.get('5102'))?.descricao).toBe('Venda')
  })

  it('valida obrigatórios antes de escrever', async () => {
    const r = await cfop({ codigo: '5102' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.motivo).toBe('Campo "Descrição" é obrigatório.')
    expect(await db.cfop.count()).toBe(0)
  })

  it('chave vazia é recusada', async () => {
    const r = await salvarRegistroAux({ store: 'cfop', keyPath: 'codigo', dados: { descricao: 'Só descrição' } })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.motivo).toBe('Chave do registro vazia.')
  })

  it('edição com a mesma chave atualiza', async () => {
    await cfop({ codigo: '5102', descricao: 'Venda' })
    const r = await salvarRegistroAux({
      store: 'cfop',
      keyPath: 'codigo',
      dados: { codigo: '5102', descricao: 'Descrição nova' },
      chaveOriginal: '5102',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.status).toBe('atualizado')
    expect(await db.cfop.count()).toBe(1)
    expect((await db.cfop.get('5102'))?.descricao).toBe('Descrição nova')
  })

  it('edição que troca a chave apaga a antiga e grava a nova', async () => {
    await cfop({ codigo: '5102', descricao: 'Venda' })
    const r = await salvarRegistroAux({
      store: 'cfop',
      keyPath: 'codigo',
      dados: { codigo: '5103', descricao: 'Venda' },
      chaveOriginal: '5102',
    })
    expect(r.ok).toBe(true)
    expect(await db.cfop.get('5102')).toBeUndefined()
    expect(await db.cfop.get('5103')).toBeDefined()
    expect(await db.cfop.count()).toBe(1)
  })

  it('edição para uma chave já usada é bloqueada e preserva o original', async () => {
    await cfop({ codigo: '5102', descricao: 'Venda' })
    await cfop({ codigo: '5103', descricao: 'Outra' })

    const r = await salvarRegistroAux({
      store: 'cfop',
      keyPath: 'codigo',
      dados: { codigo: '5103', descricao: 'Venda' },
      chaveOriginal: '5102',
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.motivo).toBe('Já existe outro registro com esta chave.')
    expect((await db.cfop.get('5102'))?.descricao).toBe('Venda')
    expect((await db.cfop.get('5103'))?.descricao).toBe('Outra')
    expect(await db.cfop.count()).toBe(2)
  })

  it('executa a normalização específica antes de validar', async () => {
    const r = await salvarRegistroAux({
      store: 'cfop',
      keyPath: 'codigo',
      dados: { codigo: '', descricao: 'X' },
      camposObrigatorios: [{ nome: 'codigo', label: 'Código' }],
      normalizar: (d) => { d.codigo = '5102' },
    })
    expect(r.ok).toBe(true)
    expect(r.ok && r.registro.codigo).toBe('5102')
  })
})

/* ------------------------------------------- cstClassTrib (bug L1879) -- */

describe('salvarRegistroAux — cstClassTrib (keyPath id composto)', () => {
  const cct = (dados: Record<string, unknown>, chaveOriginal?: string) =>
    salvarRegistroAux({
      store: 'cstClassTrib',
      keyPath: 'id',
      dados,
      chaveOriginal,
      camposObrigatorios: [{ nome: 'nome', label: 'Nome' }],
    })

  it('monta o id `cst|cClassTrib` e normaliza os lados', async () => {
    const r = await cct({ cst: '1', cClassTrib: '2', nome: 'Alíquota zero' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.registro.id).toBe('001|000002')
    expect(r.registro.cst).toBe('001')
    expect(r.registro.cClassTrib).toBe('000002')
  })

  it('[L1879] "novo" com combinação existente não sobrescreve', async () => {
    await cct({ cst: '1', cClassTrib: '2', nome: 'Original' })
    const r = await cct({ cst: '1', cClassTrib: '2', nome: 'Sobrescrita' })

    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.motivo).toContain('Já existe um registro com esta chave')
    expect(await db.cstClassTrib.count()).toBe(1)
    expect((await db.cstClassTrib.get('001|000002'))?.nome).toBe('Original')
  })

  it('combinações diferentes convivem', async () => {
    await cct({ cst: '1', cClassTrib: '2', nome: 'A' })
    await cct({ cst: '1', cClassTrib: '3', nome: 'B' })
    expect(await db.cstClassTrib.count()).toBe(2)
  })

  it('validação falha antes de montar qualquer chave', async () => {
    const r = await cct({ cst: '1', cClassTrib: '2' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.motivo).toBe('Campo "Nome" é obrigatório.')
    expect(await db.cstClassTrib.count()).toBe(0)
  })

  it('edição na mesma chave atualiza', async () => {
    await cct({ cst: '1', cClassTrib: '2', nome: 'Original' })
    const r = await cct({ cst: '1', cClassTrib: '2', nome: 'Editado' }, '001|000002')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.status).toBe('atualizado')
    expect(await db.cstClassTrib.count()).toBe(1)
    expect((await db.cstClassTrib.get('001|000002'))?.nome).toBe('Editado')
  })
})

/* ------------------------------------------------- ncm / id genérico -- */

describe('salvarRegistroAux — stores com keyPath id', () => {
  it('vínculo NCM ganha chave única `codigo|cClassTrib|uid`', async () => {
    const r = await salvarRegistroAux({
      store: 'ncm',
      keyPath: 'id',
      dados: { codigo: '02.01.10.00', cClassTrib: '000001', descricao: 'X' },
      normalizar: NORMALIZADORES['ncm'],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.registro.codigo).toBe('02011000')
    expect(String(r.registro.id)).toMatch(/^02011000\|000001\|x/)
  })

  it('demais stores com keyPath id recebem uid', async () => {
    const r = await salvarRegistroAux({ store: 'cfop', keyPath: 'id', dados: { codigo: '5102' } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(String(r.registro.id)).toMatch(/^x/)
  })
})

/* ---------------------------------------------------------- exclusão -- */

describe('excluirRegistroAux', () => {
  it('remove a chave indicada', async () => {
    await salvarRegistroAux({ store: 'cfop', keyPath: 'codigo', dados: { codigo: '5102', descricao: 'X' } })
    await excluirRegistroAux('cfop', '5102')
    expect(await db.cfop.get('5102')).toBeUndefined()
  })
})

/* ------------------------------------------------------------ sementes -- */

describe('garantirSementes', () => {
  const sementes = {
    cfop: [{ codigo: '5101', descricao: 'Entrada' }],
    cstIcms: [{ codigo: '000', descricao: 'Tributada' }],
    cstPisCofins: [{ codigo: '01', descricao: 'Operação com alíquota básica' }],
  }

  it('popula as tabelas vazias e não duplica na segunda chamada', async () => {
    await garantirSementes(sementes)
    expect(await db.cfop.count()).toBe(1)
    expect(await db.cstIcms.count()).toBe(1)
    expect(await db.cstPisCofins.count()).toBe(1)

    await garantirSementes(sementes)
    expect(await db.cfop.count()).toBe(1)
    expect(await db.cstIcms.count()).toBe(1)
    expect(await db.cstPisCofins.count()).toBe(1)
  })

  it('complementa os códigos faltantes sem mexer no que o usuário já cadastrou', async () => {
    await db.cfop.put({ codigo: '6101', descricao: 'Minha' })
    await garantirSementes(sementes)
    // 6101 do usuário mantido + 5101 da semente acrescido ("o que tiver não entra").
    expect(await db.cfop.count()).toBe(2)
    expect((await db.cfop.get('6101'))?.descricao).toBe('Minha')
    expect(await db.cfop.get('5101')).toBeDefined()
    expect(await db.cstIcms.count()).toBe(1)
  })

  it('não sobrescreve a descrição editada pelo usuário no mesmo código', async () => {
    await db.cfop.put({ codigo: '5101', descricao: 'Editada por mim' })
    await garantirSementes(sementes)
    expect(await db.cfop.count()).toBe(1)
    expect((await db.cfop.get('5101'))?.descricao).toBe('Editada por mim')
  })
})
