import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// @ts-expect-error — módulo CJS do Electron (sem tipos; importado pelo runtime)
import * as perfil from '@/../electron/ia/perfil-modelo.cjs'
// @ts-expect-error — módulo CJS do Electron (sem tipos; importado pelo runtime)
import * as servico from '@/../electron/ia/ia-service.cjs'

let dir = ''
const ENV_ORIG = process.env.AURUM_IA_MODEL

function gguf(nome: string, bytes = 16): string {
  const p = path.join(dir, nome)
  fs.writeFileSync(p, Buffer.alloc(bytes, 7))
  return p
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurum-modelo-'))
  delete process.env.AURUM_IA_MODEL
})

afterEach(() => {
  if (ENV_ORIG === undefined) delete process.env.AURUM_IA_MODEL
  else process.env.AURUM_IA_MODEL = ENV_ORIG
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('descoberta automática do modelo (troca sem código)', () => {
  it('sem gguf → nenhum modelo', () => {
    expect(perfil.descobrirModelo(dir)).toEqual({ caminho: null, arquivo: null, origem: null })
  })

  it('qualquer *.gguf vale (descoberta pelo maior)', () => {
    gguf('a-pequeno.gguf', 8)
    const grande = gguf('Modelo-Novo-Q4.gguf', 64)
    const achado = perfil.descobrirModelo(dir)
    expect(achado.caminho).toBe(grande)
    expect(achado.origem).toBe('descoberta')
  })

  it('legado tem prioridade sobre descoberta genérica', () => {
    gguf('Outro-Modelo.gguf', 128)
    const legado = gguf('Qwen3-0.6B-Q8_0.gguf', 8)
    const achado = perfil.descobrirModelo(dir)
    expect(achado.caminho).toBe(legado)
    expect(achado.origem).toBe('legado')
  })

  it('manifesto vence o legado', () => {
    gguf('Qwen3-0.6B-Q8_0.gguf', 8)
    gguf('llama-novo.gguf', 64)
    fs.writeFileSync(path.join(dir, 'modelo.json'), JSON.stringify({ arquivo: 'llama-novo.gguf', familia: 'llama' }))
    const achado = perfil.descobrirModelo(dir)
    expect(achado.arquivo).toBe('llama-novo.gguf')
    expect(achado.origem).toBe('manifesto')
    const { perfil: pf } = perfil.perfilEfetivo(dir)
    expect(pf.familia).toBe('llama')
    expect(pf.templateChat).toBe('llama3')
  })

  it('manifesto vence o env (ordem: manifesto > env > legado > descoberta)', () => {
    gguf('llama-novo.gguf', 64)
    fs.writeFileSync(path.join(dir, 'modelo.json'), JSON.stringify({ arquivo: 'llama-novo.gguf' }))
    const externo = gguf('externo.gguf', 16)
    process.env.AURUM_IA_MODEL = externo
    const achado = perfil.descobrirModelo(dir)
    expect(achado.arquivo).toBe('llama-novo.gguf')
    expect(achado.origem).toBe('manifesto')
  })

  it('env vence o legado quando não há manifesto', () => {
    gguf('Qwen3-0.6B-Q8_0.gguf', 8)
    const externo = gguf('externo.gguf', 16)
    process.env.AURUM_IA_MODEL = externo
    const achado = perfil.descobrirModelo(dir)
    expect(achado.caminho).toBe(externo)
    expect(achado.origem).toBe('env')
  })

  it('família detectada pelo nome (mistral → template mistral)', () => {
    gguf('mistral-7b-q4.gguf', 32)
    const { perfil: pf } = perfil.perfilEfetivo(dir)
    expect(pf.familia).toBe('mistral')
    expect(pf.templateChat).toBe('mistral')
  })
})

describe('vigia de troca automática (ehArquivoDeModelo)', () => {
  it.each([
    ['modelo-novo.gguf', true],
    ['MODELO.GGUF', true],
    ['modelo.json', true],
    ['indice-lexical.json', false],
    ['CHECKSUMS.txt', false],
    ['cópia.tmp', false],
    ['modelo.gguf.part', false],
    ['.DS_Store', false],
    ['', false],
  ])('%s → %s', (nome, esperado) => {
    expect(servico.ehArquivoDeModelo(nome)).toBe(esperado)
  })

  it('arquivo ausente estabiliza de imediato (remoção)', async () => {
    const ok = await servico.aguardarArquivoEstavel(path.join(dir, 'sumiu.gguf'), 50, 500)
    expect(ok).toBe(true)
  })

  it('arquivo estável resolve sem esperar o teto', async () => {
    const p = gguf('estavel.gguf', 32)
    const t0 = Date.now()
    const ok = await servico.aguardarArquivoEstavel(p, 50, 5000)
    expect(ok).toBe(true)
    expect(Date.now() - t0).toBeLessThan(2000)
  })
})
