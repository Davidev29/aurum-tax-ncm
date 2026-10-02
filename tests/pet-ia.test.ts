/**
 * Mini-IA da Aurinha: o núcleo puro (`decidirAcaoIA`) decide a ação só com
 * perfil + evento + relógio — determinístico e testável sem DOM.
 */
import { describe, expect, it } from 'vitest'
import { decidirAcaoIA, perfilVazio, type PerfilPet } from '@/store/pet-ia'

const AGORA = 1_000_000

function perfil(completar: Partial<PerfilPet> = {}): PerfilPet {
  return { ...perfilVazio(), ...completar }
}

describe('decidirAcaoIA', () => {
  it('fica quietinha sem sinal relevante', () => {
    expect(decidirAcaoIA(perfil(), { tipo: 'view', view: 'consulta' }, AGORA, 10)).toBeNull()
  })

  it('apoia após 2 erros em 5 minutos (e respeita cooldown)', () => {
    const p = perfil({ errosRecentes: [AGORA - 60_000, AGORA - 30_000] })
    const acao = decidirAcaoIA(p, { tipo: 'erro' }, AGORA, 10)
    expect(acao?.regra).toBe('apoio')
    expect(acao?.mood).toBe('curious')
    const p2 = perfil({ errosRecentes: [AGORA - 60_000, AGORA - 30_000], cooldowns: { apoio: AGORA } })
    expect(decidirAcaoIA(p2, { tipo: 'erro' }, AGORA, 10)).toBeNull()
  })

  it('ignora erros antigos fora da janela de 5 minutos', () => {
    const p = perfil({ errosRecentes: [AGORA - 10 * 60_000, AGORA - 9 * 60_000] })
    expect(decidirAcaoIA(p, { tipo: 'erro' }, AGORA, 10)).toBeNull()
  })

  it('comemora sequência de 3 sucessos', () => {
    const p = perfil({ sucessosSeguidos: 3 })
    const acao = decidirAcaoIA(p, { tipo: 'sucesso' }, AGORA, 14)
    expect(acao?.regra).toBe('sequencia')
    expect(acao?.mood).toBe('celebrating')
  })

  it('reconhece o explorador de 4 telas e o fiel dos carinhos', () => {
    const exp = perfil({ viewsDistintas: ['a', 'b', 'c', 'd'] })
    expect(decidirAcaoIA(exp, { tipo: 'view', view: 'd' }, AGORA, 14)?.regra).toBe('explorador')
    const fiel = perfil({ carinhos: 5 })
    expect(decidirAcaoIA(fiel, { tipo: 'carinho' }, AGORA, 14)?.regra).toBe('fidelidade')
  })

  it('dá dica na 3ª visita da tela e pede arrego de madrugada', () => {
    const p = perfil({ visitasPorView: { lote: 3 } })
    const dica = decidirAcaoIA(p, { tipo: 'view', view: 'lote' }, AGORA, 14)
    expect(dica?.frase).toMatch(/CSV/)
    const coruja = decidirAcaoIA(perfil(), { tipo: 'view', view: 'consulta' }, AGORA, 23)
    expect(coruja?.regra).toBe('coruja')
  })
})
