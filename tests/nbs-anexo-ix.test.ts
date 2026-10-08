/**
 * Regressão: os 10 NBS do Anexo IX (art. 138, 200/200038) que a fonte oficial
 * publica DENTRO da lista `NCM` de `reforma_tributaria_por_ncm.json`.
 *
 * Antes do resgate, esses códigos caíam em `codigosIgnorados` e a conferência
 * do serviço voltava em regra geral — sem descrição, sem redução de 60%,
 * sem anexo IX, sem base legal da LC e sem a opção de diferimento.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { db } from '@/infrastructure/db/schema'
import { importarBase } from '@/infrastructure/base/base-service'
import { resolverClassificacoesNbs } from '@/infrastructure/base/classificacao-repo'
import {
  normalizarCst,
  normalizarCstClassTrib,
  normalizarNbs,
  normalizarReferencia,
  unirVinculosNbs,
} from '@/infrastructure/base/normalizacao'
import {
  ehDiferimentoCondicionalAnexoIX,
  expandirOpcoesComDiferimento,
  temOpcaoDiferimento,
} from '@/domain/services/calculo'

const BASE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'base')
const ler = (nome: string) => JSON.parse(readFileSync(path.join(BASE_DIR, nome), 'utf8'))

const NBS_ANEXO_IX = [
  '114052200',
  '114059000',
  '114109000',
  '119011000',
  '111051000',
  '111091000',
  '114031000',
  '114032900',
  '114044100',
  '114052100',
]

async function semearComArtefatos(): Promise<void> {
  const ref = ler('classificacao-tributaria.json')
  const reforma = ler('reforma.json')
  await Promise.all([
    db.nbs.clear(),
    db.cst.clear(),
    db.cstClassTrib.clear(),
    db.referencia.clear(),
  ])
  await db.referencia.bulkPut(normalizarReferencia(ref.itens))
  await db.cst.bulkPut(normalizarCst(reforma.cst))
  await db.cstClassTrib.bulkPut(normalizarCstClassTrib(reforma.cstClassTrib))
  await db.nbs.bulkPut(normalizarNbs(reforma.nbs))
}

describe('NBS do Anexo IX resgatados do overflow NCM', () => {
  it('artefato embutido contém os 10 NBS com CST 200/cClassTrib 200038', () => {
    const reforma = ler('reforma.json')
    const nbs = normalizarNbs(reforma.nbs)
    expect(nbs).toHaveLength(122)
    for (const codigo of NBS_ANEXO_IX) {
      const v = nbs.find((n) => n.codigo === codigo)
      expect(v, codigo).toMatchObject({ cst: '200', cClassTrib: '200038' })
      expect(v?.descricao).toContain('Anexo IX')
      expect(v?.baseLegal).toContain('Anexo IX')
    }
  })

  it('conferência oficial: descrição, redução 60%, anexo IX, LC art. 138 e diferimento condicional', async () => {
    await semearComArtefatos()
    for (const codigo of NBS_ANEXO_IX) {
      const r = await resolverClassificacoesNbs(codigo)
      expect(r.regraGeral, codigo).toBe(false)
      expect(r.lista).toHaveLength(1)
      const cl = r.lista[0]
      expect(cl.cst).toBe('200')
      expect(cl.cClassTrib).toBe('200038')
      // Descrição oficial da LC.
      expect(cl.descricao).toContain('Anexo IX')
      expect(cl.resumo.descricaoCClassTrib).toContain('insumos agropecu')
      // Redução de 60% vinda da LC (join 3NF), não do vínculo.
      expect(cl.resumo.percentualReducaoIBS).toBe(60)
      expect(cl.resumo.percentualReducaoCBS).toBe(60)
      // Anexo oficial + legislação.
      expect(cl.resumo.anexo).toBe('9')
      expect(cl.cstClassTribDetalhes?.lcRef).toContain('138')
      expect(cl.cstClassTribDetalhes?.lcRedacao).toContain('60%')
      expect(cl.resumo.urlLegislacao).toContain('art138')
      // Diferimento é condicional à operação (art. 138, §2º): o cartão avisa
      // e oferece a 2ª opção (CST 515, alíquota 0%).
      expect(ehDiferimentoCondicionalAnexoIX(cl)).toBe(true)
      expect(temOpcaoDiferimento(cl)).toBe(true)
      const expandidas = expandirOpcoesComDiferimento([cl])
      expect(expandidas).toHaveLength(2)
      expect(expandidas[1]).toMatchObject({ cst: '515', cClassTrib: '515001' })
      expect(expandidas[1].resumo.percentualReducaoIBS).toBe(100)
    }
  }, 30_000)

  it('importação em tempo de execução também resgata o overflow NCM', async () => {
    const noop = () => undefined
    await Promise.all([db.ncm.clear(), db.cst.clear(), db.cstClassTrib.clear(), db.nbs.clear()])
    await importarBase(
      {
        NCM: [
          { codigo: '02011000', cst: '200', cClassTrib: '200003', baseLegal: 'x', descricaoCompleta: 'y' },
          {
            codigo: '114052200',
            cst: '200',
            cClassTrib: '200038',
            baseLegal: 'Fornecimento dos insumos agropecuários e aquícolas (Anexo IX)',
            descricaoCompleta: 'Fornecimento dos insumos do Anexo IX.',
          },
        ],
        tabelasAuxiliares: { cst: [], cstClassTrib: [] },
      },
      'reforma_tributaria_por_ncm.json',
      noop,
    )
    expect(await db.ncm.count()).toBe(1)
    const nbs = await db.nbs.toArray()
    expect(nbs.map((v) => v.codigo)).toContain('114052200')
    // União é idempotente: reimportar não duplica.
    expect(unirVinculosNbs(nbs, nbs)).toHaveLength(nbs.length)
  })
})
