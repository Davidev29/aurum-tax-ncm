/**
 * Expansão máxima v2 — travas de regressão (2026-10-03).
 *
 * Cobre o que a v2 adicionou sem quebrar a v1:
 * - vocabulário 947 chaves (era ~310) + expansão em lote com cache;
 * - 5 novos sinais preditivos (QUIMICO … INSTRUMENTO_OTICA) + perguntas;
 * - núcleo forte SÓ no vazio (nunca dilui a margem do determinístico);
 * - calibragem multi-fator com meta ≥0.85 nos casos claros (sem exceções);
 * - dicionário 99 pins (nomes populares → NCM vigente) + 73 typos.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  calibrarConfiancaFinal,
  nivelDeConfianca,
} from '@/domain/aurum-ai'
import {
  analisarDescricao,
  expandirConsultas,
  expandirConsultasNucleoForte,
  extrairSinais,
  perguntasComplementares,
} from '@/domain/services/classificador-descricao'
import {
  buscarNoDicionarioComercial,
} from '@/domain/constants/dicionario-comercial'
import {
  corrigirTextoConsulta,
} from '@/domain/services/correcao-consulta'
import {
  expandirSinonimosTodos,
  tamanhoVocabularioFiscal,
} from '@/domain/services/vocabulario'
import { montarFichasAbsolutas } from '@/application/aurum-ai-contexto'
import { semearBaseIa } from './ajuda-ia'

describe('expansao-v2', () => {
  beforeEach(async () => { await semearBaseIa() })

  it('vocabulário cobre ~3x a v1 e expande em lote', () => {
    expect(tamanhoVocabularioFiscal()).toBeGreaterThanOrEqual(900)
    expect(expandirSinonimosTodos(['boi', 'celular', 'amoxicilina'])).toEqual(
      expect.arrayContaining(['boi', 'bovin', 'celular', 'telefone', 'amoxicilina']),
    )
    // Consulta primária continua enxuta (2 variações — precisão > cobertura).
    expect(expandirConsultas(['milho', 'grao', 'consumo']).length).toBeLessThanOrEqual(2)
  })

  it('núcleo forte só existe como fallback do vazio', () => {
    expect(expandirConsultasNucleoForte(['milho', 'grao'])).toEqual([])
    const nucleo = expandirConsultasNucleoForte(['saca', 'milho', 'grao'])
    expect(nucleo.length).toBeGreaterThanOrEqual(1)
    expect(nucleo[0]).toContain('milho')
  })

  it('sinais preditivos v2 disparam por segmento', () => {
    expect(extrairSinais(['amoxicilina'])).toContain('QUIMICO')
    expect(extrairSinais(['adubo', 'npk'])).toContain('QUIMICO')
    expect(extrairSinais(['polietileno'])).toContain('PLASTICO_BORRACHA')
    expect(extrairSinais(['tabua', 'pinus'])).toContain('MADEIRA_PAPEL')
    expect(extrairSinais(['roteador', 'wifi'])).toContain('MAQUINA_EQUIPAMENTO')
    expect(extrairSinais(['oculos', 'sol'])).toContain('INSTRUMENTO_OTICA')
    // Perguntas de refino existem para os 5 sinais novos.
    const perguntas = perguntasComplementares(analisarDescricao({ descricao: 'amoxicilina 500mg' }))
    expect(perguntas.some((p) => /princ.pio ativo|medicamento/i.test(p))).toBe(true)
  })

  it('dicionário v2 ancora nomes populares novos', () => {
    expect(buscarNoDicionarioComercial('amoxicilina 500mg')[0]?.ncm).toBe('30041011')
    expect(buscarNoDicionarioComercial('roteador wifi')[0]?.ncm).toBe('85176241')
    expect(buscarNoDicionarioComercial('ar condicionado split')[0]?.ncm).toBe('84151011')
    expect(buscarNoDicionarioComercial('tubo inox')[0]?.ncm).toBe('73041100')
  })

  it('correção ortográfica v2 cobre typos industriais', () => {
    expect(corrigirTextoConsulta('microhondas').textoCorrigido).toBe('microondas')
    expect(corrigirTextoConsulta('parafuzo').textoCorrigido).toBe('parafuso')
    expect(corrigirTextoConsulta('dipirrona').textoCorrigido).toBe('dipirona')
  })

  it('calibragem ancora ≥0.85 no caso claro e recusa o fraco', () => {
    // Caso claro: cobertura total + vínculo + pin + margem + contexto.
    const claro = calibrarConfiancaFinal({
      baseTexto: 1,
      margem: 30,
      temVinculo: true,
      temPin: true,
      tokens: 3,
    })
    expect(claro).toBeGreaterThanOrEqual(0.85)
    expect(nivelDeConfianca(claro)).toBe('alta')
    // Caso claro sem pin, só vínculo + margem, também ancora.
    expect(
      calibrarConfiancaFinal({ baseTexto: 1, margem: 30, temVinculo: true, tokens: 2 }),
    ).toBeGreaterThanOrEqual(0.85)
    // Caso fraco: cobertura mínima + 1 token → NÃO SEI.
    expect(
      calibrarConfiancaFinal({ baseTexto: 0.1, margem: 0, tokens: 1 }),
    ).toBeLessThan(0.2)
  })

  it('fichas em lote resolvem em paralelo', async () => {
    const fichas = await montarFichasAbsolutas(['10051000', '10059010'])
    expect(fichas).toHaveLength(2)
    expect(fichas.map((f) => f.codigo)).toEqual(['10051000', '10059010'])
  })
})
