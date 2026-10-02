/**
 * Validação determinística absoluta (Phase 6 / 06-09, IA-09).
 *
 * Um worker alucinando o código inexistente `99999999` (fora da base
 * homologada) NUNCA chega à UI: o gate (`classificarComIa`) exige código
 * homologado na nomenclatura vigente via `resolverClassificacoes`
 * (única fonte de verdade) e cai em NÃO SEI.
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

  it('gate recusa a alucinação mesmo com worker "confiante" (NÃO SEI)', async () => {
    // 'semeadura' gera candidato real → worker é chamado e alucina.
    let usouWorker = false
    const g = await classificarComIa({ descricao: 'semeadura' }, { aoWorker: (u) => { usouWorker = u } })
    expect(usouWorker).toBe(true)
    expect(g.codigoEscolhido).toBe(ALUCINADO)
    expect(g.ncmValidado).toBeNull()
  })

  it('repositório nunca exibe o alucinado (sem decisão, sem cálculo)', async () => {
    const r = await classificarComIA('semeadura')
    expect(r.codigoEscolhido).toBeNull()
    expect(r.decisao).toBeNull()
    expect(r.nomenclatura).toBeNull()
    expect(r.calculo).toBeNull()
    expect(JSON.stringify(r)).not.toContain(ALUCINADO)
  })
})
