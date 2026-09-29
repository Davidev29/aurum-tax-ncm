/**
 * Leitura interna de legislação — helpers puros (sem DOM).
 *
 * Cobre a elegibilidade de leitura no sistema, o nome de arquivo do PDF e a
 * montagem dos parágrafos de impressão. As funções com DOM (`sanitizarHtml`,
 * `destacarArtigo`, `extrairTextoArtigo`) rodam no renderer (jsdom fora do
 * escopo do ambiente `node` dos testes).
 */
import { describe, expect, it } from 'vitest'
import {
  nomeArquivoLegislacao,
  podeLerNoSistema,
  tirarHash,
  trechoParaImpressao,
} from '@/infrastructure/legislacao-texto'

describe('podeLerNoSistema', () => {
  it('aceita páginas HTML do Planalto com âncora', () => {
    expect(podeLerNoSistema('https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm#art128')).toBe(true)
  })

  it('aceita o decreto da CBS', () => {
    expect(
      podeLerNoSistema('https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2026/decreto/d12955.htm'),
    ).toBe(true)
  })

  it('recusa PDF (fica no iframe com o visualizador nativo)', () => {
    expect(
      podeLerNoSistema('https://www.cgibs.gov.br/upload/arquivos/202604/30084927-res-cgibs-n-6-30-abr-2026-regulamenta-o-ibs.pdf'),
    ).toBe(false)
  })

  it('recusa o portal interativo e hosts fora da lista', () => {
    expect(podeLerNoSistema('https://dfe-portal.svrs.rs.gov.br/Cff')).toBe(false)
    expect(podeLerNoSistema('https://exemplo.com/lei.htm')).toBe(false)
    expect(podeLerNoSistema(null)).toBe(false)
    expect(podeLerNoSistema('nao-url')).toBe(false)
  })
})

describe('tirarHash', () => {
  it('remove o fragmento da URL de busca', () => {
    expect(tirarHash('https://x.com/lcp214.htm#art128')).toBe('https://x.com/lcp214.htm')
    expect(tirarHash('https://x.com/lcp214.htm')).toBe('https://x.com/lcp214.htm')
  })
})

describe('nomeArquivoLegislacao', () => {
  it('gera nome seguro com o artigo', () => {
    expect(nomeArquivoLegislacao('art. 128', 'pdf')).toBe('legislacao-art-128.pdf')
  })

  it('cai no fallback sem artigo', () => {
    expect(nomeArquivoLegislacao(null, 'pdf')).toBe('legislacao-trecho-citado.pdf')
  })
})

describe('trechoParaImpressao', () => {
  it('quebra em parágrafos e escapa HTML', () => {
    const saida = trechoParaImpressao('Art. 128 <b>redução</b>.\n\nSegundo parágrafo.')
    expect(saida).toBe('<p>Art. 128 &lt;b&gt;redução&lt;/b&gt;.</p>\n<p>Segundo parágrafo.</p>')
  })
})
