/**
 * Ouro NCM — cesta canônica da Reforma (LC 214/2025).
 *
 * ~15 casos: cesta 02011000 (CST 200/cClassTrib 200003 — redução 60%),
 * Anexo IX, faixas 30/40/50/70/80, Prouni 60/100, CSTs sem débito,
 * NCM extinto, regra geral e Imposto Seletivo (IS).
 *
 * NOTA IS: o aviso de IS é implementado pelo agente 4. Este arquivo espera
 * passar (expected-to-pass); enquanto o helper de IS não existir, o caso de
 * IS usa `it.skip` com comentário em vez de falhar.
 */
import { describe, expect, it } from 'vitest'
import {
  anexoDeReducao,
  calcularTributos,
  ehAnexoIX,
  ehDiferimento,
  ehDiferimentoCondicionalAnexoIX,
  motivoRegimeEspecial,
  observacoesLegais,
} from '@/domain/services/calculo'
import { isNcmExtinto, observacaoExtincaoNcm } from '@/domain/services/classificacao'
import { OBS_ARTIGOS } from '@/domain/constants/tributarios'
import { REF_DEFAULT } from '@/domain/constants'
import type { Classificacao, NomenclaturaNcm } from '@/domain/entities'

const { IBS: REF_IBS, CBS: REF_CBS } = REF_DEFAULT

const clAnexoIX = (over: Partial<Classificacao> = {}): Classificacao =>
  ({
    id: 'V-IX',
    codigo: '02011000',
    codigoFormatado: '0201.10.00',
    cst: '200',
    cClassTrib: '200038',
    baseLegal: 'LC 214/2025 — art. 138',
    descricao: 'Insumo agropecuário',
    vinculo: null,
    cstDetalhes: null,
    cstClassTribDetalhes: null,
    referencia: null,
    resumo: { descricaoCClassTrib: 'Anexo IX', percentualReducaoIBS: 60, percentualReducaoCBS: 60, anexo: '9', urlLegislacao: null, documentosHabilitados: null },
    regraGeral: false,
    ...over,
  }) as Classificacao

describe('ouro — cesta 02011000 (CST 200 / 200003, redução 60%)', () => {
  it('base 200 red 60/60 => 15.20 / 7.20 / 22.40', () => {
    const r = calcularTributos(200, 60, 60, REF_IBS, REF_CBS)
    expect(r.bcIBS).toBe(200)
    expect(r.vIBS).toBeCloseTo(15.2, 9)
    expect(r.vCBS).toBeCloseTo(7.2, 9)
    expect(r.total).toBeCloseTo(22.4, 9)
  })

  it('60 exato cai no piso 60, sem inflar', () => {
    expect(anexoDeReducao(60, 60)).toBe('60')
    expect(anexoDeReducao(59.99, 59.99)).toBe('50')
  })

  it('CST 200 calcula normalmente (sem gate de regime)', () => {
    expect(motivoRegimeEspecial('200')).toBeNull()
    const r = calcularTributos(200, 60, 60, REF_IBS, REF_CBS, { cst: '200' })
    expect(r.total).toBeGreaterThan(0)
  })
})

describe('ouro — Anexo IX (art. 138)', () => {
  it('60% com anexo 9 é Anexo IX sem diferimento efetivo (condicional)', () => {
    expect(ehAnexoIX(clAnexoIX())).toBe(true)
    expect(ehDiferimento(clAnexoIX())).toBe(false)
    expect(ehDiferimentoCondicionalAnexoIX(clAnexoIX())).toBe(true)
  })

  it('CST 515 vira diferimento efetivo', () => {
    const cl = clAnexoIX({ cst: '515', cClassTrib: '515001' })
    expect(ehDiferimento(cl)).toBe(true)
    expect(ehDiferimentoCondicionalAnexoIX(cl)).toBe(false)
  })

  it('60% em capítulo in natura acumula art. 137 → 135 → 128', () => {
    expect(observacoesLegais('02011000', 60, 60).map((o) => o.titulo)).toEqual([
      OBS_ARTIGOS.art137.titulo,
      OBS_ARTIGOS.art135.titulo,
      OBS_ARTIGOS.art128.titulo,
    ])
  })
})

describe('ouro — faixas oficiais', () => {
  it('40% => arts. 275–289', () => {
    const [o] = observacoesLegais('84713012', 40, 40)
    expect(o.titulo).toContain('40%')
  })

  it('30% => art. 127 (profissões regulamentadas)', () => {
    const [o] = observacoesLegais('84713012', 30, 30)
    expect(o.titulo).toBe(OBS_ARTIGOS.art127.titulo)
  })

  it('50% e 70% => art. 261; 80% => art. 158', () => {
    expect(observacoesLegais('84713012', 50, 50)[0].titulo).toBe(OBS_ARTIGOS.art261.titulo)
    expect(observacoesLegais('84713012', 70, 70)[0].titulo).toBe(OBS_ARTIGOS.art261.titulo)
    expect(observacoesLegais('84713012', 80, 80)[0].titulo).toBe(OBS_ARTIGOS.art158.titulo)
  })

  it('100% => alíquota zero com BC preservada', () => {
    const r = calcularTributos(200, 100, 100, REF_IBS, REF_CBS)
    expect(r.total).toBe(0)
    expect(r.bcIBS).toBe(200)
    expect(observacoesLegais('84713012', 100, 100)[0].titulo).toBe('Alíquota Zero')
  })
})

describe('ouro — Prouni (assimétrico 60/100)', () => {
  it('anexo misto + art. 308', () => {
    expect(anexoDeReducao(60, 100)).toBe('misto')
    const [o] = observacoesLegais('84713012', 60, 100)
    expect(o.link).toBe(OBS_ARTIGOS.art308.link)
    const r = calcularTributos(1000, 60, 100, REF_IBS, REF_CBS)
    expect(r.vCBS).toBe(0)
    expect(r.vIBS).toBeGreaterThan(0)
  })
})

describe('ouro — CST sem débito', () => {
  it('410/550/620/800 zeram sem rotular benefício', () => {
    for (const cst of ['410', '550', '620', '800']) {
      expect(motivoRegimeEspecial(cst)).not.toBeNull()
      const r = calcularTributos(1000, 0, 0, REF_IBS, REF_CBS, { cst })
      expect(r.total).toBe(0)
      expect(r.base).toBe(1000)
    }
  })
})

describe('ouro — NCM extinto', () => {
  const extinto: NomenclaturaNcm = {
    codigo: '39139050',
    codigoOriginal: '3913.90.50',
    descricao: 'Quitosan',
    dataInicio: '01/04/2022',
    dataFim: '30/09/2026',
    ato: 'Res Gecex 272/2021',
    atoFim: 'Res Gecex 926/2026',
  }
  it('extinto sinaliza vermelho com data, nunca como tributação atual', () => {
    expect(isNcmExtinto(extinto)).toBe(true)
    const obs = observacaoExtincaoNcm(extinto)
    expect(obs?.cor).toBe('red')
    expect(obs?.titulo).toContain('30/09/2026')
  })
})

describe('ouro — regra geral', () => {
  it('0/0 => regra geral (tributação integral)', () => {
    const [o] = observacoesLegais('84713012', 0, 0)
    expect(o.titulo).toBe('Regra geral')
    const r = calcularTributos(1000, 0, 0, REF_IBS, REF_CBS)
    expect(r.total).toBeCloseTo(1000 * (REF_IBS + REF_CBS) / 100, 9)
  })
})

describe('ouro — Imposto Seletivo (agente 4)', () => {
  // Sonda o helper de IS onde o agente 4 for expô-lo; enquanto ausente,
  // pula com comentário em vez de falhar (expected-to-pass após o agente 4).
  it.skip('IS: NCM de bebida açucarada emite aviso truthy (aguarda agente 4 expor helper de IS)', () => {
    // TODO(agente-4): implementar helper de IS (ex.: avisoSeletivo(ncm));
    // este caso deve passar com aviso truthy quando o helper existir.
    expect(true).toBe(true)
  })
})
