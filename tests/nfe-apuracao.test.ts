/**
 * Apuração IBS/CBS — débitos das saídas × créditos das entradas.
 * Função pura: cenários montados à mão, sem IndexedDB.
 */
import { describe, expect, it } from 'vitest'
import { apurarIbsCbs } from '@/infrastructure/nfe/apuracao'

const nota = (p: {
  direcao: 'entrada' | 'saida' | 'quarentena'
  ibs?: number
  cbs?: number
  base?: number
  crt?: string
  csts?: string[]
}): Parameters<typeof apurarIbsCbs>[0][number] => ({
  direcao: p.direcao,
  totalIBS: p.ibs ?? 0,
  totalCBS: p.cbs ?? 0,
  valorTotal: p.base ?? 0,
  emitCrt: p.crt ?? '3',
  itensAnalisados: (p.csts ?? ['00']).map((cstIcms) => ({ cstIcms }) as never),
})

describe('apurarIbsCbs', () => {
  it('lista vazia → sem-movimento zerado', () => {
    const a = apurarIbsCbs([])
    expect(a.resultado).toBe('sem-movimento')
    expect(a.saldoTotal).toBe(0)
    expect(a.valorAPagar).toBe(0)
    expect(a.saldoCredor).toBe(0)
  })

  it('só saídas → tudo a pagar', () => {
    const a = apurarIbsCbs([nota({ direcao: 'saida', ibs: 100, cbs: 50, base: 1000 })])
    expect(a).toMatchObject({
      debitoTotal: 150, creditoTotal: 0, saldoTotal: 150,
      resultado: 'a-pagar', valorAPagar: 150,
    })
    expect(a.saldoIBS).toBe(100)
    expect(a.saldoCBS).toBe(50)
  })

  it('débitos maiores que créditos → a pagar a diferença', () => {
    const a = apurarIbsCbs([
      nota({ direcao: 'saida', ibs: 200, cbs: 100, base: 2000 }),
      nota({ direcao: 'entrada', ibs: 80, cbs: 40, base: 800 }),
    ])
    expect(a).toMatchObject({
      debitoTotal: 300, creditoTotal: 120, saldoTotal: 180, resultado: 'a-pagar',
    })
    expect(a.qtdEntradasApropriaveis).toBe(1)
  })

  it('créditos maiores que débitos → saldo credor (restituição)', () => {
    const a = apurarIbsCbs([
      nota({ direcao: 'saida', ibs: 50, cbs: 25, base: 500 }),
      nota({ direcao: 'entrada', ibs: 120, cbs: 60, base: 1200 }),
    ])
    expect(a).toMatchObject({
      saldoTotal: -105, resultado: 'saldo-credor', saldoCredor: 105, valorAPagar: 0,
    })
  })

  it('empate exato → zerado', () => {
    const a = apurarIbsCbs([
      nota({ direcao: 'saida', ibs: 100, cbs: 50 }),
      nota({ direcao: 'entrada', ibs: 100, cbs: 50 }),
    ])
    expect(a.resultado).toBe('zerado')
    expect(a.saldoTotal).toBe(0)
  })

  it('entrada Simples/MEI bloqueia o crédito (não abate)', () => {
    const a = apurarIbsCbs([
      nota({ direcao: 'saida', ibs: 100, cbs: 50 }),
      nota({ direcao: 'entrada', ibs: 100, cbs: 50, crt: '1', csts: ['102'] }),
    ])
    expect(a.creditoTotal).toBe(0)
    expect(a.bloqueadoTotal).toBe(150)
    expect(a.qtdEntradasBloqueadas).toBe(1)
    expect(a).toMatchObject({ saldoTotal: 150, resultado: 'a-pagar' })
  })

  it('entrada com regime desconhecido vai para não confirmado', () => {
    const a = apurarIbsCbs([
      nota({ direcao: 'saida', ibs: 100, cbs: 50 }),
      nota({ direcao: 'entrada', ibs: 60, cbs: 30, crt: '', csts: [] }),
    ])
    expect(a.naoConfirmadoTotal).toBe(90)
    expect(a.creditoTotal).toBe(0)
    expect(a.qtdEntradasNaoConfirmadas).toBe(1)
    expect(a.saldoTotal).toBe(150)
  })

  it('quarentena fica fora da apuração, só contada', () => {
    const a = apurarIbsCbs([
      nota({ direcao: 'saida', ibs: 100, cbs: 50 }),
      nota({ direcao: 'quarentena', ibs: 999, cbs: 999 }),
    ])
    expect(a.qtdQuarentena).toBe(1)
    expect(a.debitoTotal).toBe(150)
    expect(a.saldoTotal).toBe(150)
  })

  it('apuração por tributo: IBS a pagar com CBS credor', () => {
    const a = apurarIbsCbs([
      nota({ direcao: 'saida', ibs: 100, cbs: 10 }),
      nota({ direcao: 'entrada', ibs: 20, cbs: 60 }),
    ])
    expect(a.saldoIBS).toBe(80)
    expect(a.saldoCBS).toBe(-50)
    expect(a.saldoTotal).toBe(30)
    expect(a.resultado).toBe('a-pagar')
  })
})
