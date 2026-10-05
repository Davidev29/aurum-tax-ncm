/**
 * Direção IA → Aurinha: o núcleo puro (`dirigirPetPorIA`) traduz cada sinal
 * da Aurum AI em humor + frase + ambiente de braços — determinístico e
 * testável sem DOM.
 */
import { describe, expect, it } from 'vitest'
import { dirigirPetPorIA, type SinalIAPet } from '@/store/pet-direcao-ia'
import { AMBIENTES } from '@/store/pet-ambiente'

const R0 = () => 0

function ambientesValidos(): Set<string> {
  return new Set(AMBIENTES.map((a) => a.id))
}

describe('dirigirPetPorIA', () => {
  it('veredito NCM com benefício vira festa com aplauso + eureka em confiança alta', () => {
    const d = dirigirPetPorIA(
      { tipo: 'veredito-ncm', situacao: 'beneficio-confirmado', codigo: '84713012', confianca: 0.87 },
      R0,
    )
    expect(d?.mood).toBe('celebrating')
    expect(d?.ambient).toBe('aplaudir')
    expect(d?.eureka).toBe(true)
    expect(d?.frase).toMatch(/8471/)
  })

  it('hipótese condicional vira curiosidade com binóculo', () => {
    const d = dirigirPetPorIA(
      { tipo: 'veredito-ncm', situacao: 'hipotese-condicional', codigo: '01051200', confianca: 0.5 },
      R0,
    )
    expect(d?.mood).toBe('curious')
    expect(d?.ambient).toBe('focar-binoculo')
    expect(d?.eureka).toBeFalsy()
  })

  it('regra geral vira apontar-achado e indefinido vira escavação', () => {
    const regra = dirigirPetPorIA(
      { tipo: 'veredito-ncm', situacao: 'tributacao-integral', codigo: '84713012', confianca: 0.6 },
      R0,
    )
    expect(regra?.mood).toBe('happy')
    expect(regra?.ambient).toBe('apontar-achado')
    const vago = dirigirPetPorIA(
      { tipo: 'veredito-ncm', situacao: 'indefinido', codigo: 'NÃO SEI', confianca: 0 },
      R0,
    )
    expect(vago?.mood).toBe('thinking')
    expect(vago?.ambient).toBe('escavar')
  })

  it('veredito NBS com verificação pede binóculo, sem verificação aponta', () => {
    const comVer = dirigirPetPorIA(
      { tipo: 'veredito-nbs', exigeVerificacao: true, codigo: '111071000', confianca: 0.5 },
      R0,
    )
    expect(comVer?.ambient).toBe('focar-binoculo')
    const ok = dirigirPetPorIA(
      { tipo: 'veredito-nbs', exigeVerificacao: false, codigo: '111071000', confianca: 0.8 },
      R0,
    )
    expect(ok?.ambient).toBe('apontar-achado')
  })

  it('IA pensando vira modo investigativo por origem', () => {
    const c = dirigirPetPorIA({ tipo: 'ia-pensando', origem: 'consulta' }, R0)
    expect(c?.mood).toBe('searching')
    const l = dirigirPetPorIA({ tipo: 'ia-pensando', origem: 'lote' }, R0)
    expect(l?.mood).toBe('thinking')
    expect(l?.ambient).toBe('carregar-caixa')
  })

  it('lote narra progresso e conclui com festa + eureka', () => {
    const p = dirigirPetPorIA({ tipo: 'lote-progresso', feitos: 50, total: 100 }, R0)
    expect(p?.mood).toBe('reading')
    expect(p?.ambient).toBe('carregar-caixa')
    const f = dirigirPetPorIA({ tipo: 'lote-concluido', total: 10, comClassificacao: 9 }, R0)
    expect(f?.mood).toBe('celebrating')
    expect(f?.eureka).toBe(true)
    expect(f?.frase).toMatch(/9 de 10/)
  })

  it('invalidez, zero, cálculo, XML, sequência, apoio e boas-vindas têm palco', () => {
    expect(dirigirPetPorIA({ tipo: 'ncm-invalido', termo: '123' }, R0)?.mood).toBe('angry')
    const zero = dirigirPetPorIA({ tipo: 'busca-zerada', termo: 'abc' }, R0)
    expect(zero?.mood).toBe('curious')
    expect(zero?.ambient).toBe('escavar')
    expect(dirigirPetPorIA({ tipo: 'calculo-item', totalItens: 1 }, R0)?.mood).toBe('calculating')
    expect(dirigirPetPorIA({ tipo: 'calculo-item', totalItens: 5 }, R0)?.ambient).toBe('apontar-achado')
    const xmlOk = dirigirPetPorIA({ tipo: 'xml-resumo', novas: 3, erros: 0 }, R0)
    expect(xmlOk?.mood).toBe('celebrating')
    const xmlErr = dirigirPetPorIA({ tipo: 'xml-resumo', novas: 3, erros: 1 }, R0)
    expect(xmlErr?.mood).toBe('curious')
    const seq = dirigirPetPorIA({ tipo: 'sequencia-boa', sucessos: 4 }, R0)
    expect(seq?.ambient).toBe('malabarismo')
    const apoio = dirigirPetPorIA({ tipo: 'apoio-erro' }, R0)
    expect(apoio?.ambient).toBe('abraco-quente')
    const boas = dirigirPetPorIA({ tipo: 'boas-vindas', view: 'lote' }, R0)
    expect(boas?.mood).toBe('waving')
    expect(boas?.ambient).toBe('carregar-caixa')
  })

  it('é determinístico com rand injetado', () => {
    const sinal: SinalIAPet = { tipo: 'calculo-item', totalItens: 2 }
    const a = dirigirPetPorIA(sinal, () => 0.1)
    const b = dirigirPetPorIA(sinal, () => 0.1)
    expect(a).toEqual(b)
  })

  it('todo ambiente sugerido existe no catálogo de 81', () => {
    const validos = ambientesValidos()
    const sinais: SinalIAPet[] = [
      { tipo: 'veredito-ncm', situacao: 'beneficio-confirmado', codigo: '84713012', confianca: 0.9 },
      { tipo: 'veredito-ncm', situacao: 'hipotese-condicional', codigo: '01051200', confianca: 0.5 },
      { tipo: 'veredito-ncm', situacao: 'tributacao-integral', codigo: '84713012', confianca: 0.6 },
      { tipo: 'veredito-ncm', situacao: 'indefinido', codigo: 'x', confianca: 0 },
      { tipo: 'veredito-nbs', exigeVerificacao: true, codigo: '111071000', confianca: 0.5 },
      { tipo: 'veredito-nbs', exigeVerificacao: false, codigo: '111071000', confianca: 0.8 },
      { tipo: 'ia-pensando', origem: 'consulta' },
      { tipo: 'ia-pensando', origem: 'servicos' },
      { tipo: 'ia-pensando', origem: 'lote' },
      { tipo: 'ia-pensando', origem: 'calculadora' },
      { tipo: 'ia-pensando', origem: 'xml' },
      { tipo: 'lote-progresso', feitos: 1, total: 2 },
      { tipo: 'lote-concluido', total: 2, comClassificacao: 2 },
      { tipo: 'ncm-invalido', termo: 'x' },
      { tipo: 'busca-zerada', termo: 'x' },
      { tipo: 'calculo-item', totalItens: 4 },
      { tipo: 'xml-resumo', novas: 1, erros: 0 },
      { tipo: 'xml-resumo', novas: 1, erros: 2 },
      { tipo: 'sequencia-boa', sucessos: 3 },
      { tipo: 'apoio-erro' },
      { tipo: 'boas-vindas', view: 'consulta' },
      { tipo: 'boas-vindas', view: 'inexistente' },
    ]
    for (const s of sinais) {
      const d = dirigirPetPorIA(s, R0)
      expect(d, `sinal ${s.tipo} sem direção`).not.toBeNull()
      if (d?.ambient) expect(validos.has(d.ambient), `ambiente fora do catálogo: ${d.ambient}`).toBe(true)
      expect(d!.frase.length).toBeGreaterThan(3)
    }
  })
})
