/**
 * Fine-tuning v4 — fluxos assistidos de cadastro (CNPJ + produto).
 * Roda sobre IndexedDB em memória (fake-indexeddb) + BrasilAPI mockada.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { detectarIntencaoChat } from '@/domain/services/detector-chat'
import {
  ehConfirmacao,
  ehNegacao,
  ehComandoCadastrarCnpj,
  ehPerguntaCadastroCnpj,
  extrairRascunhoProduto,
  faltantesObrigatorios,
  fluxoCadastroEmAndamento,
  ofertaCadastroCnpjPendente,
  ofertaAtualizarSkuPendente,
  resumoProdutoPendente,
  resolverEscolhaLista,
} from '@/application/aurum-ai-cadastro'
import { refinarIntencaoComContexto, toolParaIntencao } from '@/application/aurum-ai-tools'
import { responderChat } from '@/application/aurum-ai-chat'
import { cadastrarEmpresa } from '@/application/empresas'
import { limparCacheBrasilApi } from '@/infrastructure/receita/brasilapi'
import { db } from '@/infrastructure/db/schema'
import { semearBaseIa } from './ia/ajuda-ia'

const CNPJ_SIM = '11222333000181'
const CNPJ_NAO = '12345678000195'

const RESP_BRASIL = {
  cnpj: CNPJ_NAO,
  razao_social: 'Fornecedor Novo LTDA',
  nome_fantasia: 'Novo',
  logradouro: 'Rua B',
  numero: '10',
  bairro: 'Centro',
  municipio: 'Fortaleza',
  uf: 'ce',
  cep: '60000-000',
  ddd_telefone_1: '85 9999-9999',
  email: 'n@n.com',
}

function stubBrasil() {
  vi.stubGlobal(
    'fetch',
    (async () =>
      new Response(JSON.stringify(RESP_BRASIL), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch,
  )
}

beforeEach(async () => {
  await db.empresas.clear()
  await db.produtos.clear()
  await db.nfeNotas.clear()
  limparCacheBrasilApi()
  vi.unstubAllGlobals()
  await semearBaseIa()
})

describe('detector — cadastro', () => {
  it('"quero cadastrar um produto" → cadastrar_produto', () => {
    expect(detectarIntencaoChat('quero cadastrar um produto').intencao).toBe('cadastrar_produto')
  })
  it('"cadastra esse produto na empresa X" → cadastrar_produto', () => {
    expect(detectarIntencaoChat('cadastra esse produto na empresa Pão Dourado').intencao).toBe('cadastrar_produto')
  })
  it('"salvar essa empresa" continua cnpj', () => {
    expect(detectarIntencaoChat('salvar essa empresa como cliente').intencao).toBe('cnpj')
  })
  it('"o cnpj X tá cadastrado?" → cnpj', () => {
    const a = detectarIntencaoChat(`o cnpj ${CNPJ_SIM} tá cadastrado no sistema?`)
    expect(a.intencao).toBe('cnpj')
    expect(a.cnpj).toBe(CNPJ_SIM)
  })
  it('tool cadastrar_produto → cadastrarProdutoAssistido', () => {
    expect(toolParaIntencao('cadastrar_produto')).toBe('cadastrarProdutoAssistido')
  })
})

describe('helpers puros de confirmação', () => {
  it('ehConfirmacao cobre variações, sem roubar "simular"', () => {
    expect(ehConfirmacao('sim')).toBe(true)
    expect(ehConfirmacao('Sim, cadastra')).toBe(true)
    expect(ehConfirmacao('pode cadastrar')).toBe(true)
    expect(ehConfirmacao('confirma')).toBe(true)
    expect(ehConfirmacao('simular o valor')).toBe(false)
    expect(ehConfirmacao('não')).toBe(false)
  })
  it('ehNegacao cobre variações', () => {
    expect(ehNegacao('não')).toBe(true)
    expect(ehNegacao('deixa pra lá')).toBe(true)
    expect(ehNegacao('cancela')).toBe(true)
    expect(ehNegacao('sim')).toBe(false)
  })
  it('pergunta e comando de CNPJ', () => {
    expect(ehPerguntaCadastroCnpj('o cnpj X tá cadastrado?')).toBe(true)
    expect(ehPerguntaCadastroCnpj('já existe no sistema?')).toBe(true)
    expect(ehPerguntaCadastroCnpj('quais atividades tem?')).toBe(false)
    expect(ehComandoCadastrarCnpj('cadastra esse cnpj pra mim')).toBe(true)
    expect(ehComandoCadastrarCnpj('salvar essa empresa como cliente')).toBe(true)
    expect(ehComandoCadastrarCnpj('quais atividades tem?')).toBe(false)
  })
  it('oferta pendente exige a frase de oferta da assistente', () => {
    expect(ofertaCadastroCnpjPendente([{ papel: 'assistant', texto: 'Quer que eu cadastre agora?' }])).toBe(true)
    expect(ofertaCadastroCnpjPendente([{ papel: 'assistant', texto: 'Qual o NCM de banana?' }])).toBe(false)
    expect(ofertaCadastroCnpjPendente([])).toBe(false)
  })
  it('resumo pendente extrai o SKU conferido', () => {
    const hist = [{ papel: 'assistant', texto: '**Confirma o cadastro?** Responda SIM PARA SALVAR do SKU QM-01 ...' }]
    expect(resumoProdutoPendente(hist)).toBe('QM-01')
    expect(resumoProdutoPendente([])).toBeNull()
  })
  it('portão 2 exige o aviso de ATUALIZAR', () => {
    const hist = [{ papel: 'assistant', texto: 'Quer ATUALIZAR o SKU QM-01 com estes dados?' }]
    expect(ofertaAtualizarSkuPendente(hist)).toBe('QM-01')
    expect(ofertaAtualizarSkuPendente([])).toBeNull()
  })
  it('fluxo em andamento detecta pedido de slot', () => {
    expect(fluxoCadastroEmAndamento([{ papel: 'assistant', texto: 'Vamos cadastrar. Falta o SKU.' }])).toBe(true)
    expect(fluxoCadastroEmAndamento([{ papel: 'assistant', texto: 'NCM 0803.10.00 — banana' }])).toBe(false)
  })
  it('escolha em lista numerada', () => {
    const hist = [{ papel: 'assistant', texto: 'Encontrei **2 empresas**:\n1. **Pão Dourado**\n2. **Pão Doce**' }]
    expect(resolverEscolhaLista(hist, 'o 1')).toBe('Pão Dourado')
    expect(resolverEscolhaLista(hist, 'Pão Doce')).toBe('Pão Doce')
    expect(resolverEscolhaLista([], 'o 1')).toBeNull()
  })
})

describe('rascunho do produto', () => {
  it('monta slots de mensagens variadas (última vence)', () => {
    const r = extrairRascunhoProduto([
      'quero cadastrar um produto na Padaria Pão Dourado',
      'sku QM-01, nome Queijo Minas',
      'ncm 10051000',
      'cfop 5102, cst 00, pis 01, cofins 01',
    ])
    expect(r.empresaTexto).toMatch(/Padaria/i)
    expect(r.sku).toBe('QM-01')
    expect(r.nome).toBe('Queijo Minas')
    expect(r.ncm).toBe('10051000')
    expect(r.cfop).toBe('5102')
    expect(r.cstIcms).toBe('00')
    expect(r.pis).toBe('01')
    expect(r.cofins).toBe('01')
    expect(faltantesObrigatorios(r)).toEqual([])
  })
  it('correção posterior vence ("na verdade o sku é...")', () => {
    const r = extrairRascunhoProduto(['sku AAA', 'na verdade o sku é BBB'])
    expect(r.sku).toBe('BBB')
  })
  it('lista faltantes em ordem', () => {
    expect(faltantesObrigatorios(extrairRascunhoProduto(['quero cadastrar um produto']))).toEqual(['empresa', 'sku', 'nome', 'ncm'])
  })
})

describe('fluxo CNPJ — verifica, oferece, cadastra', () => {
  it('CNPJ cadastrado → confirma com o nome', async () => {
    await cadastrarEmpresa({ razaoSocial: 'Padaria Pão Dourado LTDA', cnpj: CNPJ_SIM })
    const r = await responderChat(`o cnpj ${CNPJ_SIM} tá cadastrado no sistema?`)
    expect(r.texto).toContain('está cadastrado')
    expect(r.texto).toContain('Pão Dourado')
    expect(await db.empresas.count()).toBe(1)
  }, 15000)

  it('CNPJ ausente → oferece; "sim" cadastra (BrasilAPI mockada)', async () => {
    stubBrasil()
    const oferta = await responderChat(`o cnpj ${CNPJ_NAO} já está cadastrado?`)
    expect(oferta.texto).toContain('não está cadastrado')
    expect(oferta.texto.toLowerCase()).toContain('quer que eu')
    expect(await db.empresas.count()).toBe(0)
    const hist = [
      { papel: 'user' as const, texto: `o cnpj ${CNPJ_NAO} já está cadastrado?` },
      { papel: 'assistant' as const, texto: oferta.texto },
    ]
    const feito = await responderChat('sim, cadastra', hist)
    expect(feito.texto).toContain('salva')
    expect(await db.empresas.count()).toBe(1)
  }, 20000)

  it('"não" após a oferta não grava nada', async () => {
    stubBrasil()
    const oferta = await responderChat(`o cnpj ${CNPJ_NAO} tá cadastrado?`)
    const hist = [
      { papel: 'user' as const, texto: `o cnpj ${CNPJ_NAO} tá cadastrado?` },
      { papel: 'assistant' as const, texto: oferta.texto },
    ]
    const r = await responderChat('não, deixa', hist)
    expect(r.texto).toContain('não cadastrei nada')
    expect(await db.empresas.count()).toBe(0)
  }, 20000)

  it('"sim" sozinho, sem oferta, não grava nada', async () => {
    stubBrasil()
    const r = await responderChat('sim')
    expect(await db.empresas.count()).toBe(0)
    expect(await db.produtos.count()).toBe(0)
    expect(r.texto).not.toContain('cadastrado:**')
  }, 15000)
})

describe('fluxo produto — rascunho, conferência, gravação', () => {
  async function cadastraEmpresaPadrao() {
    await cadastrarEmpresa({ razaoSocial: 'Padaria Pão Dourado LTDA', cnpj: CNPJ_SIM })
  }

  type Msg = { papel: 'user' | 'assistant'; texto: string }

  async function conversa(...falasUsuario: string[]): Promise<{ h: Msg[]; ultima: import('@/application/aurum-ai-chat').RespostaChat }> {
    let h: Msg[] = []
    let ultima!: import('@/application/aurum-ai-chat').RespostaChat
    for (const fala of falasUsuario) {
      ultima = await responderChat(fala, h)
      h = [...h, { papel: 'user' as const, texto: fala }, { papel: 'assistant' as const, texto: ultima.texto }]
    }
    return { h, ultima }
  }

  it('pede slots em ordem e mostra conferência com trib. antiga', async () => {
    await cadastraEmpresaPadrao()
    const { ultima } = await conversa(
      'quero cadastrar um produto na Padaria Pão Dourado',
      'sku QM-01, nome Queijo Minas, ncm 10051000',
      'cfop 5102, cst 00, pis 01, cofins 01',
    )
    expect(ultima.texto).toContain('Confirma o cadastro?')
    expect(ultima.texto).toContain('SKU QM-01')
    expect(ultima.texto).toContain('5102')
    expect(await db.produtos.count()).toBe(0)
  }, 25000)

  it('SIM após conferência grava com a trib. antiga digitada', async () => {
    await cadastraEmpresaPadrao()
    const { h, ultima } = await conversa(
      'quero cadastrar um produto na Padaria Pão Dourado',
      'sku QM-01, nome Queijo Minas, ncm 10051000',
      'cfop 5102, cst 00, pis 01, cofins 01',
    )
    expect(ultima.texto).toContain('Confirma o cadastro?')
    const r = await responderChat('SIM PARA SALVAR', h)
    expect(r.texto).toContain('cadastrado')
    const todos = await db.produtos.toArray()
    expect(todos).toHaveLength(1)
    expect(todos[0]).toMatchObject({ codigo: 'QM-01', nome: 'Queijo Minas', ncm: '10051000', cfop: '5102', cstIcms: '00', pis: '01', cofins: '01' })
  }, 25000)

  it('SKU existente abre o portão 2; SIM ATUALIZAR sobrescreve', async () => {
    await cadastraEmpresaPadrao()
    const primeira = await conversa(
      'quero cadastrar um produto na Padaria Pão Dourado',
      'sku QM-01, nome Queijo Minas, ncm 10051000',
      'pular',
    )
    expect(primeira.ultima.texto).toContain('Confirma o cadastro?')
    const salva = await responderChat('SIM PARA SALVAR', primeira.h)
    expect(salva.texto).toContain('cadastrado')
    expect(await db.produtos.count()).toBe(1)
    // Segunda tentativa com o mesmo SKU e nome diferente.
    const segunda = await conversa(
      'quero cadastrar outro produto na Padaria Pão Dourado',
      'sku QM-01, nome Queijo Novo, ncm 10051000',
      'pular',
    )
    expect(segunda.ultima.texto).toContain('ATUALIZAR o SKU QM-01')
    expect(await db.produtos.count()).toBe(1)
    const atualiza = await responderChat('SIM ATUALIZAR', segunda.h)
    expect(atualiza.texto).toContain('atualizado')
    const todos = await db.produtos.toArray()
    expect(todos).toHaveLength(1)
    expect(todos[0].nome).toBe('Queijo Novo')
  }, 30000)

  it('NCM sem lastro não grava', async () => {
    await cadastraEmpresaPadrao()
    const { ultima } = await conversa(
      'quero cadastrar um produto na Padaria Pão Dourado',
      'sku XX-1, nome Coisa, ncm 99999999',
      'pular',
    )
    expect(ultima.texto).toContain('sem lastro')
    expect(await db.produtos.count()).toBe(0)
  }, 25000)

  it('empresa inexistente não grava', async () => {
    const r = await responderChat('quero cadastrar um produto na Empresa Fantasma, sku F-1, nome X, ncm 10051000, pular')
    expect(r.texto).toMatch(/não encontrei|Falta/)
    expect(await db.produtos.count()).toBe(0)
  }, 25000)

  it('refino mantém "08031000" digitado dentro do fluxo', () => {
    const h = [
      { papel: 'user' as const, texto: 'quero cadastrar um produto' },
      { papel: 'assistant' as const, texto: 'Vamos cadastrar o produto. Falta o **NCM (8 dígitos)**.' },
    ]
    const det = detectarIntencaoChat('10051000')
    expect(det.intencao).toBe('ncm')
    const refinada = refinarIntencaoComContexto(det, '10051000', h)
    expect(refinada.intencao).toBe('cadastrar_produto')
  })
})
