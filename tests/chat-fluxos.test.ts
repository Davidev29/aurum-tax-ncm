/**
 * Fine-tuning v5 — fluxos simples: rotina com recursos nativos (1 leitura de
 * perfil + 1 escrita em lote), contexto memoizado por turno e aprendizado de
 * padrões de conversa sem consultas extras.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  INTENCOES_FLUXO_SIMPLES,
  precisaCaminhoCompleto,
  sugestoesParaPadrao,
} from '@/application/aurum-ai-fluxos'
import { contextoBaseDoTurno, extrairContextoConversa } from '@/application/aurum-ai-tools'
import {
  carregarPerfilMemoria,
  contarTurno,
  descarregarMemoria,
  intencaoDominante,
  registrarTurnoMemoria,
} from '@/application/aurum-ai-memoria'
import { responderChat } from '@/application/aurum-ai-chat'
import { db } from '@/infrastructure/db/schema'

beforeEach(async () => {
  localStorage.clear()
  await db.table('meta').clear().catch(() => null)
})

describe('mapa de fluxos simples', () => {
  it('rotina está no fluxo simples; fiscal pesado não', () => {
    for (const i of ['conversa_leve', 'capacidades', 'ajuda', 'navegar', 'status', 'conceito', 'legislacao', 'generico'] as const) {
      expect(INTENCOES_FLUXO_SIMPLES.has(i)).toBe(true)
    }
    // Saudação vai sempre pelo completo (retomada da sessão anterior).
    expect(INTENCOES_FLUXO_SIMPLES.has('saudacao')).toBe(false)
    for (const i of ['ncm', 'nbs', 'cnpj', 'cadastrar_produto', 'calculo', 'simples', 'dados', 'clientes', 'relatorio', 'comparativo', 'saudacao'] as const) {
      expect(INTENCOES_FLUXO_SIMPLES.has(i)).toBe(false)
    }
  })
})

describe('gatilhos do caminho completo', () => {
  it('intenção refinada fiscal exige o completo', () => {
    expect(precisaCaminhoCompleto('tem ncm de banana?', 'ncm', 'ncm', [])).toBe(true)
    expect(precisaCaminhoCompleto('oi', 'saudacao', 'saudacao', [])).toBe(true)
    expect(precisaCaminhoCompleto('e para 5 mil?', 'generico', 'calculo', [])).toBe(true)
  })
  it('rotina refinada simples sem histórico vai pelo fluxo simples', () => {
    expect(precisaCaminhoCompleto('oi', 'saudacao', 'saudacao', [])).toBe(true)
    expect(precisaCaminhoCompleto('obrigado!', 'conversa_leve', 'conversa_leve', [])).toBe(false)
    expect(precisaCaminhoCompleto('o que é Fator R?', 'conceito', 'conceito', [])).toBe(false)
  })
  it('chat novo com generico bruto vai ao completo (artefato pode promover)', () => {
    expect(precisaCaminhoCompleto('e para 5 mil?', 'generico', 'generico', [])).toBe(true)
  })
  it('oferta pendente + confirmação/negação exige o completo', () => {
    const h = [
      { papel: 'user', texto: 'o cnpj 11222333000181 tá cadastrado?' },
      { papel: 'assistant', texto: 'Não está cadastrado. Quer que eu cadastre agora?' },
    ]
    expect(precisaCaminhoCompleto('sim, cadastra', 'generico', 'generico', h)).toBe(true)
    // "Não" também vai ao completo (cancela a oferta sem gravar nada).
    expect(precisaCaminhoCompleto('não', 'generico', 'generico', h)).toBe(true)
    // Sem oferta, "não" é rotina.
    expect(precisaCaminhoCompleto('não', 'generico', 'generico', [])).toBe(false)
  })
  it('rascunho de produto em andamento exige o completo', () => {
    const h = [
      { papel: 'user', texto: 'quero cadastrar um produto' },
      { papel: 'assistant', texto: 'Vamos cadastrar o produto. Falta: a **empresa**.' },
    ]
    expect(precisaCaminhoCompleto('10051000', 'ncm', 'cadastrar_produto', h)).toBe(true)
  })
  it('aprendizado com resposta fiscal anterior exige o completo', () => {
    const h = [
      { papel: 'user', texto: 'tem ncm de banana?' },
      { papel: 'assistant', texto: 'Classificação sugerida: NCM 0803.10.00 — banana' },
    ]
    expect(precisaCaminhoCompleto('isso mesmo', 'generico', 'generico', h)).toBe(true)
    const hLeve = [
      { papel: 'user', texto: 'oi' },
      { papel: 'assistant', texto: 'Olá! Sou a Aurum AI.' },
    ]
    expect(precisaCaminhoCompleto('isso mesmo', 'generico', 'generico', hLeve)).toBe(false)
  })
})

describe('contexto memoizado por turno', () => {
  it('mesma referência para o mesmo histórico', () => {
    const h = [
      { papel: 'user' as const, texto: 'quanto fica R$ 2.500 no NCM 08031000?' },
      { papel: 'assistant' as const, texto: 'NCM 0803.10.00' },
    ]
    expect(contextoBaseDoTurno(h)).toBe(contextoBaseDoTurno(h))
  })
  it('igual ao cálculo direto', () => {
    const h = [{ papel: 'user' as const, texto: 'meu DAS no Anexo III com RBT12 500 mil' }]
    expect(contextoBaseDoTurno(h)).toEqual(extrairContextoConversa(h))
  })
})

describe('padrões de conversa', () => {
  it('contarTurno soma intenções (puro)', () => {
    const p0 = contarTurno(null, 'ncm')
    const p1 = contarTurno(contarTurno(p0, 'ncm'), 'calculo')
    expect(p1.total).toBe(3)
    expect(p1.intents).toMatchObject({ ncm: 2, calculo: 1 })
  })
  it('dominante exige padrão estabelecido (3+ turnos)', () => {
    expect(intencaoDominante(null)).toBeNull()
    expect(intencaoDominante(contarTurno(null, 'ncm'))).toBeNull()
    const p = contarTurno(contarTurno(contarTurno(null, 'ncm'), 'ncm'), 'ncm')
    expect(intencaoDominante(p)).toBe('ncm')
  })
  it('sugestões padrão para perfil novo; personalizadas com hábito', () => {
    expect(sugestoesParaPadrao(null)).toBeNull()
    expect(sugestoesParaPadrao({ nome: null, comoChamar: null, interacoes: 0, atualizadoEm: null, padroes: null })).toBeNull()
    let p = contarTurno(null, 'dados')
    p = contarTurno(contarTurno(p, 'dados'), 'dados')
    const perfil = { nome: null, comoChamar: null, interacoes: 3, atualizadoEm: null, padroes: p }
    expect(sugestoesParaPadrao(perfil)).toContain(
      'Qual fornecedor me dá mais crédito?',
    )
  })
  it('turno registra intenção + interação em uma escrita', async () => {
    await registrarTurnoMemoria('ncm')
    await registrarTurnoMemoria('ncm')
    await descarregarMemoria()
    const perfil = await carregarPerfilMemoria()
    expect(perfil.interacoes).toBe(2)
    expect(perfil.padroes?.intents).toMatchObject({ ncm: 2 })
    expect(intencaoDominante(perfil.padroes)).toBeNull()
    await registrarTurnoMemoria('ncm')
    await descarregarMemoria()
    const perfil2 = await carregarPerfilMemoria()
    expect(intencaoDominante(perfil2.padroes)).toBe('ncm')
  }, 15000)
})

describe('fluxo simples ponta a ponta', () => {
  it('rotina responde com âncoras e aprende o turno', async () => {
    const r1 = await responderChat('oi')
    expect(r1.texto).toContain('Aurum AI')
    const r2 = await responderChat('obrigado!')
    expect(r2.texto.toLowerCase()).toContain('por nada')
    const r3 = await responderChat('o que você pode fazer?')
    expect(r3.texto).toContain('Aurum AI')
    const r4 = await responderChat('o que é Fator R?')
    expect(r4.texto).toContain('Fator R')
    await descarregarMemoria()
    const perfil = await carregarPerfilMemoria()
    expect(perfil.interacoes).toBe(4)
    expect(perfil.padroes?.total).toBe(4)
  }, 20000)

  it('hábito estabelecido personaliza o genérico', async () => {
    await registrarTurnoMemoria('ncm')
    await registrarTurnoMemoria('ncm')
    await registrarTurnoMemoria('ncm')
    await descarregarMemoria()
    const r = await responderChat('xyzblt')
    expect(r.sugestoes).toContain('Tem algum NCM de banana?')
  }, 15000)

  it('perfil novo mantém o rodízio padrão', async () => {
    const r = await responderChat('xyzblt')
    expect(r.texto).toContain('Aurum AI')
    expect(r.sugestoes?.length).toBeGreaterThan(0)
  }, 15000)
})
