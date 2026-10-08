/**
 * Phase 7 — auditoria fim a fim com a BASE REAL (`public/base`).
 *
 * Pente-fino travado em CI: para cada CNAE representativo, prova o destino
 * (decisão NBS com reduções oficiais, ou integral + hipótese legal).
 * Se a base viva mudar (novos NBS), este teste conta a história — ajuste as
 * expectativas junto com o MANIFEST.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/infrastructure/db/schema'
import { semearBaseEmbutida } from '@/infrastructure/base/base-service'
import { limparCacheBrasilApi } from '@/infrastructure/receita/brasilapi'
import { consultarPorCnpj } from '@/application/consultar-por-cnpj'

const BASE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
  'base',
)

function corpo(codigo7: string, descricao: string) {
  return {
    cnpj: '11222333000181',
    razao_social: 'AUDITORIA LTDA',
    nome_fantasia: '',
    municipio: 'X',
    uf: 'CE',
    cnae_fiscal: Number(codigo7),
    cnae_fiscal_descricao: descricao,
    cnaes_secundarios: [],
  }
}

async function consultar(codigo7: string, descricao: string) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(corpo(codigo7, descricao)), { status: 200 }))
  return consultarPorCnpj('11222333000181', { fetchFn: fetch as unknown as typeof fetch })
}

beforeAll(async () => {
  globalThis.fetch = (async (entrada: unknown) => {
    const nome = String(entrada).replace(/^base\//, '')
    const conteudo = readFileSync(path.join(BASE_DIR, nome), 'utf8')
    return { ok: true, status: 200, text: async () => conteudo }
  }) as unknown as typeof fetch
  await semearBaseEmbutida(undefined, true)
}, 120000)

beforeEach(async () => {
  limparCacheBrasilApi()
  await db.consultasCnpj.clear().catch(() => undefined)
})

describe('auditoria base real (pente-fino)', () => {
  it('educação → 200/200028 −60% Anexo LC 214 II', async () => {
    const v = await consultar('8599601', 'Formação de condutores')
    const a = v.atividades[0]
    expect(a.estado).toBe('classificado')
    expect(a.resultado?.codigoEscolhido).toBe('122011100')
    expect(a.resultado?.decisao?.cst).toBe('200')
    expect(a.resultado?.decisao?.cClassTrib).toBe('200028')
    expect(a.resultado?.decisao?.resumo.percentualReducaoIBS).toBe(60)
    expect(a.resultado?.decisao?.resumo.anexo).toBe('2')
    expect(a.coerencia).toBe('coerente')
  }, 60000)

  it('saúde → 200/200029 −60% Anexo LC 214 III', async () => {
    const v = await consultar('8630501', 'Atividade médica ambulatorial')
    const a = v.atividades[0]
    expect(a.estado).toBe('classificado')
    expect(a.resultado?.decisao?.cClassTrib).toBe('200029')
    expect(a.resultado?.decisao?.resumo.percentualReducaoIBS).toBe(60)
    expect(a.coerencia).toBe('coerente')
  }, 60000)

  it('teatro → 200/200039 (Anexo LC 214 X, com ressalva de destinação)', async () => {
    const v = await consultar('9001901', 'Produção teatral')
    const a = v.atividades[0]
    expect(a.estado).toBe('classificado')
    expect(a.resultado?.decisao?.cClassTrib).toBe('200039')
    expect(a.resultado?.decisao?.resumo.percentualReducaoIBS).toBe(60)
  }, 60000)

  it('restaurante → integral + hipótese 200/200047 −40% (sem NBS)', async () => {
    const v = await consultar('5611201', 'Restaurantes e similares')
    const a = v.atividades[0]
    expect(a.estado).toBe('tributacao-integral')
    expect(a.hipoteses[0]?.cClassTrib).toBe('200047')
    expect(a.hipoteses[0]?.reducaoIBS).toBe(40)
    expect(a.hipoteses[0]?.temNbs).toBe(false)
  }, 60000)

  it('contabilidade → integral + hipótese 200/200052 −30% (sem NBS)', async () => {
    const v = await consultar('6920601', 'Atividades de contabilidade')
    const a = v.atividades[0]
    expect(a.estado).toBe('tributacao-integral')
    expect(a.hipoteses.map((h) => h.cClassTrib)).toContain('200052')
  }, 60000)

  it('software → integral sem hipótese forçada', async () => {
    await db.cnae.put({
      codigo7: '6201501',
      codigoFormatado: '6201-5/01',
      descricao: 'Desenvolvimento de programas de computador sob encomenda',
      situacao: 'Permitido',
      anexos: ['III'],
      fatorR: false,
    })
    const v = await consultar('6201501', 'Software')
    const a = v.atividades[0]
    expect(a.estado).toBe('tributacao-integral')
    expect(a.hipoteses).toHaveLength(0)
  }, 60000)
}, 300000)
