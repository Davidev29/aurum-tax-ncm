import { describe, expect, it } from 'vitest'
import { detectarIntencaoChat } from '@/domain/services/detector-chat'
import {
  buscarArtigoLC214,
  disponibilidadeLC214,
  explicarArtigoLC214,
  extrairNumeroArtigoLC214,
  pesquisarLC214,
} from '@/domain/services/lc214'
import {
  extrairMencaoEmpresa,
  localizarProdutoEmNotas,
  resolverEmpresaAlvo,
} from '@/application/aurum-ai-empresa'
import { extrairFiltrosDados } from '@/application/aurum-ai-dados'
import { refinarIntencaoComContexto, toolParaIntencao } from '@/application/aurum-ai-tools'
import { responderChat } from '@/application/aurum-ai-chat'

describe('fine-tuning v3 — intenção legislacao (LC 214)', () => {
  it('"explica o art. 128" vira legislacao', () => {
    expect(detectarIntencaoChat('Explica o art. 128 da LC 214').intencao).toBe('legislacao')
  })
  it('"o que diz a LC 214 sobre cesta básica?" vira legislacao', () => {
    expect(detectarIntencaoChat('O que diz a LC 214 sobre cesta básica?').intencao).toBe('legislacao')
  })
  it('"onde a lei fala de diferimento?" vira legislacao', () => {
    expect(detectarIntencaoChat('Onde a lei fala de diferimento?').intencao).toBe('legislacao')
  })
  it('não rouba simples ("Anexo III") nem NBS ("aula de yoga")', () => {
    expect(detectarIntencaoChat('meu DAS no Anexo III com RBT12 500 mil').intencao).toBe('simples')
    expect(detectarIntencaoChat('qual seria a nbs para aula de yoga?').intencao).toBe('nbs')
  })
  it('tool legislacao → explicarArtigoLC214', () => {
    expect(toolParaIntencao('legislacao')).toBe('explicarArtigoLC214')
  })
})

describe('fine-tuning v3 — corpus offline LC 214', () => {
  it('disponível sem rede, com temas e fonte oficial', () => {
    const d = disponibilidadeLC214()
    expect(d.offline).toBe(true)
    expect(d.totalArtigos).toBeGreaterThan(20)
    expect(d.fonteOficial).toContain('lcp214')
  })
  it('extrai número do artigo', () => {
    expect(extrairNumeroArtigoLC214('Explica o art. 128, por favor')).toBe('128')
    expect(extrairNumeroArtigoLC214('artigo 137')).toBe('137')
    expect(extrairNumeroArtigoLC214('tem ncm de banana?')).toBeNull()
  })
  it('busca exata por número', () => {
    expect(buscarArtigoLC214('128')?.titulo).toContain('128')
    expect(buscarArtigoLC214(138)?.titulo).toContain('138')
    expect(buscarArtigoLC214('999')).toBeNull()
  })
  it('pesquisa temática acha o artigo certo', () => {
    expect(pesquisarLC214('diferimento', 2)[0].artigo.numero).toBe('138')
    expect(pesquisarLC214('cesta básica nacional', 2)[0].artigo.numero).toBe('125')
  })
  it('explicação segue o molde claro + técnico + link (sem inventar literal)', () => {
    const t = explicarArtigoLC214('128')
    expect(t).toContain('Art. 128')
    expect(t).toContain('Em linguagem clara:')
    expect(t).toContain('Leitura técnica:')
    expect(t).toContain('#art128')
  })
  it('orquestrador explica o art. 128 de ponta a ponta', async () => {
    const r = await responderChat('Explica o art. 128 da LC 214')
    expect(r.texto).toContain('Art. 128')
    expect(r.texto).toContain('Em linguagem clara:')
  }, 15000)
})

describe('fine-tuning v3 — empresa × produto × cálculo', () => {
  const empresas = [
    { id: 1, razaoSocial: 'Padaria Pão Dourado LTDA', fantasia: 'Pão Dourado', cnpj: '11111111111111' },
    { id: 2, razaoSocial: 'Padaria Pão Doce LTDA', fantasia: 'Pão Doce', cnpj: '22222222222222' },
    { id: 3, razaoSocial: 'Mercado Central SA', fantasia: '', cnpj: '33333333333333' },
  ]

  it('extrai menção de empresa (aspas, "empresa X", "da Padaria")', () => {
    expect(extrairMencaoEmpresa('produtos da empresa "Pão Dourado"?')).toContain('Pão Dourado')
    expect(extrairMencaoEmpresa('Tem XML de algum cliente?')).toBeNull()
  })
  it('resolve: única ancora, ambígua pergunta, inexistente orienta', () => {
    const unica = resolverEmpresaAlvo('Pão Dourado', empresas, null)
    expect(unica.tipo).toBe('unica')
    expect(unica.candidatas[0].id).toBe(1)
    const ambigua = resolverEmpresaAlvo('Pão', empresas, null)
    expect(ambigua.tipo).toBe('ambigua')
    expect(ambigua.candidatas.length).toBe(2)
    expect(resolverEmpresaAlvo('Inexistente XYZ', empresas, null).tipo).toBe('nao_encontrada')
  })
  it('sem menção usa a ativa ou todas (avisando)', () => {
    expect(resolverEmpresaAlvo(null, empresas, 3).tipo).toBe('sem_mencao_com_ativa')
    expect(resolverEmpresaAlvo(null, empresas, null).tipo).toBe('sem_mencao_todas')
  })
  it('filtros entendem "produtos da Padaria Pão Dourado"', () => {
    const f = extrairFiltrosDados('quais produtos da Padaria Pão Dourado mais venderam?')
    expect(f.clienteTexto).toMatch(/Padaria/i)
  })
  it('localiza produto específico nos itens (fuzzy)', () => {
    const itens = [
      { descricao: 'Queijo minas frescal', codProd: 'Q1', ncm: '04061000' },
      { descricao: 'Pão francês', codProd: 'P2', ncm: '19059000' },
    ]
    expect(localizarProdutoEmNotas('queijo minas', itens)[0].codProd).toBe('Q1')
  })
  it('follow-up "e desse cliente?" com histórico de dados herda dados', () => {
    const hist = [
      { papel: 'user' as const, texto: 'qual fornecedor me dá mais crédito?' },
      { papel: 'assistant' as const, texto: 'fornecedor A com R$ 100' },
    ]
    const det = detectarIntencaoChat('e desse cliente?')
    const refinada = refinarIntencaoComContexto(det, 'e desse cliente?', hist)
    expect(refinada.intencao).toBe('dados')
  })
})
