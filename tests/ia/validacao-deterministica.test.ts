/**
 * Validação determinística absoluta (Phase 6 / 06-09, IA-09).
 *
 * Sem modelo LLM, o gate (`classificarComIa`) decide SEMPRE pelo seletor
 * local ancorado e exige código homologado na nomenclatura vigente via
 * `resolverClassificacoes` (única fonte de verdade). Um mock de worker
 * alucinando (`99999999`, fora da base homologada) é inócuo: o gate nem
 * consulta o bridge — e se um dia consultar, o código fora da base cai em
 * NÃO SEI, nunca chega à UI.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/infrastructure/bridge', () => ({
  bridge: {
    ia: {
      classificar: async () => ({
        ok: true,
        codigo: '99999999',
        confianca: 0.99,
        motivo: 'alucinacao-proposital',
        mock: true,
      }),
      buscar: async () => ({ ok: true, candidatos: [] }),
      status: async () => ({ pronto: true, mock: true, modo: 'mock' as const, modelPath: null, workerPath: null, pid: null, erro: null }),
    },
  },
  isElectron: () => true,
  lerArquivoBase: async () => { throw new Error('fora de escopo') },
}))

import { classificarComIa } from '@/application/classificacao-ia'
import { classificarComIA } from '@/infrastructure/ia/classificacao-ia-repo'
import { resolverClassificacoes } from '@/infrastructure/base/classificacao-repo'
import { semearBaseIa } from './ajuda-ia'

const ALUCINADO = '99999999'

describe('validacao-deterministica: alucinação bloqueada', () => {
  beforeEach(semearBaseIa)

  it('resolver não homologa código fora da base (nomenclatura null)', async () => {
    const v = await resolverClassificacoes(ALUCINADO)
    expect(v.nomenclatura).toBeNull()
  })

  it('gate ignora worker mockado e decide pelo seletor local (10051000 validado)', async () => {
    // 'semeadura' gera candidato real → sem LLM, o seletor local decide
    // sozinho (mock de `bridge.ia.classificar` acima é inócuo: o gate nem
    // consulta o bridge). O alucinado nunca aparece na decisão.
    let usouWorker = false
    const g = await classificarComIa({ descricao: 'semeadura' }, { aoWorker: (u) => { usouWorker = u } })
    expect(usouWorker).toBe(true)
    expect(g.codigoEscolhido).toBe('10051000')
    expect(g.ncmValidado).toBe('10051000')
    expect(JSON.stringify(g)).not.toContain(ALUCINADO)
  })

  it('repositório exibe o código validado (com decisão, cálculo e lastro)', async () => {
    const r = await classificarComIA('semeadura')
    expect(r.codigoEscolhido).toBe('10051000')
    expect(r.decisao).not.toBeNull()
    expect(r.nomenclatura?.codigo).toBe('10051000')
    expect(r.calculo).not.toBeNull()
    expect(JSON.stringify(r)).not.toContain(ALUCINADO)
  })
})
