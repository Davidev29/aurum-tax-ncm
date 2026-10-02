/**
 * Bypass determinístico (Phase 6 / 06-09, IA-09).
 *
 * Prova a IA como camada SUPERIOR, nunca substituta: descrições que o
 * caminho primário (`classificarPorDescricao` → `ncm_provavel` + confiança
 * alta) resolve NÃO acordam o worker (`aoWorker` conta 0 chamadas); as
 * difíceis (fallback) acordam (≥1 chamada).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { classificarComIA } from '@/infrastructure/ia/classificacao-ia-repo'
import { semearBaseIa, soDigitos } from './ajuda-ia'

const FACEIS: Array<[string, string]> = [
  // F1-F5 do dossiê (docs/diagnostico-fase-5.md §2).
  ['Semente de milho híbrido para plantio', '10051000'],
  ['milho para semeadura', '10051000'],
  ['Milho em grão para consumo', '10059010'],
  ['Alimentos para cães ou gatos acondicionados para venda a retalho', '23091000'],
  ['Boi vivo da raça Nelore para reprodução', '01022919'],
]

const DIFICEIS: Array<[string, string]> = [
  // D1-D5 do dossiê (§3): fallback IA com decisão validada.
  ['reprodução', '01022919'],
  ['gatos', '23091000'],
  ['grão', '10059010'],
  ['semeadura', '10051000'],
  ['retalho', '23091000'],
]

describe('bypass-deterministico', () => {
  beforeEach(semearBaseIa)

  it('fáceis: worker NUNCA é chamado (via deterministico)', async () => {
    for (const [descricao, ncm] of FACEIS) {
      let chamadas = 0
      const r = await classificarComIA(descricao, { aoWorker: (u) => { if (u) chamadas += 1 } })
      expect(chamadas).toBe(0)
      expect(r.via).toBe('deterministico')
      expect(soDigitos(r.codigoEscolhido)).toBe(ncm)
      expect(r.candidatos).toHaveLength(0)
    }
  })

  it('difíceis: worker é chamado (via ia + decisão validada)', async () => {
    for (const [descricao, ncm] of DIFICEIS) {
      let chamadas = 0
      const r = await classificarComIA(descricao, { aoWorker: (u) => { if (u) chamadas += 1 } })
      expect(chamadas).toBeGreaterThanOrEqual(1)
      expect(r.via).toBe('ia')
      expect(soDigitos(r.codigoEscolhido)).toBe(ncm)
      expect(r.decisao).not.toBeNull()
    }
  })
})
