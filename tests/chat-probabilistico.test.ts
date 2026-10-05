import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { responderChat } from '@/application/aurum-ai-chat'
import { extrairSlotsSimples, aplicarEdicaoSimples } from '@/domain/services/valores-chat'

interface Row {
  id: string
  categoria: string
  input: string
  historico: Array<{ papel: 'user' | 'assistant'; texto: string }>
  slots_esperados: { intencao: string; anexo: string | null; rbt12: number | null; receitaMes: number | null; folha12: number | null }
  resposta_contem: string[]
  resposta_nao_contem: string[]
}

function carregar(): Row[] {
  const p = join(__dirname, 'fixtures', 'simples-finetuning-30.jsonl')
  return readFileSync(p, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l))
}

function catOf(r: Row): string {
  return r.categoria.split('-')[0]
}

describe('probabilístico Simples/Fator R — threshold 90% (fine-tuning v6)', () => {
  it('dataset tem 30 casos', () => {
    expect(carregar().length).toBe(30)
  })

  it('acurácia global ≥90% e por categoria ≥80% (I1/I2/I3 críticas ≥85%)', async () => {
    const rows = carregar()
    const porCat: Record<string, { ok: number; total: number; misses: string[] }> = {}
    let okGlobal = 0
    for (const r of rows) {
      const resp = await responderChat(r.input, (r.historico ?? []) as never)
      // Slots: turno atual + herança de contexto (o que o orquestrador realmente usa).
      const slotsTurno = extrairSlotsSimples(r.input)
      const ctxHist = (r.historico ?? []).filter((m) => m.papel === 'user').map((m) => m.texto).join('\n')
      const slotsCtx = ctxHist ? extrairSlotsSimples(ctxHist) : null
      const ed = aplicarEdicaoSimples(
        r.input,
        slotsTurno,
        {
          ultimoAnexo: (slotsCtx?.anexo ?? null) as never,
          ultimoRbt12: slotsCtx?.rbt12 ?? null,
          ultimaReceita: slotsCtx?.receitaMes ?? null,
          ultimaFolha: slotsCtx?.folha12 ?? null,
        },
      )
      const esperado = r.slots_esperados
      // Campos null no esperado = "não julgar" (ex.: extenso total, exploratório).
      // Anexo inferido ("sou medico" → V) sai do texto, não do `ed.anexo` — aceita se o texto cita.
      const anexoOk =
        esperado.anexo == null ||
        ed.anexo === esperado.anexo ||
        resp.texto.includes(`Anexo ${esperado.anexo}`)
      const slotsOk =
        anexoOk &&
        (esperado.rbt12 == null || ed.rbt12 === esperado.rbt12) &&
        (esperado.receitaMes == null || ed.receitaMes === esperado.receitaMes) &&
        (esperado.folha12 == null || ed.folha12 === esperado.folha12)
      const txt = resp.texto.toLowerCase()
      const txtOk =
        r.resposta_contem.every((s) => txt.includes(s.toLowerCase())) &&
        r.resposta_nao_contem.every((s) => !txt.includes(s.toLowerCase()))
      const ok = slotsOk && txtOk
      if (ok) okGlobal++
      const c = catOf(r)
      porCat[c] ??= { ok: 0, total: 0, misses: [] }
      porCat[c].total++
      if (ok) porCat[c].ok++
      else porCat[c].misses.push(`${r.id} "${r.input}" slots=${JSON.stringify({ anexo: ed.anexo, rbt: ed.rbt12, rec: ed.receitaMes, folha: ed.folha12 })} txt=${resp.texto.slice(0, 140).replace(/\n/g, ' ')}`)
    }
    for (const [c, v] of Object.entries(porCat)) {
      console.log(`${c}: ${v.ok}/${v.total} = ${((v.ok / v.total) * 100).toFixed(1)}%`)
      for (const m of v.misses) console.log('  MISS', m)
    }
    const taxaGlobal = okGlobal / rows.length
    console.log(`GLOBAL: ${okGlobal}/${rows.length} = ${(taxaGlobal * 100).toFixed(1)}%`)
    expect(taxaGlobal, 'acurácia global').toBeGreaterThanOrEqual(0.9)
    for (const [c, v] of Object.entries(porCat)) {
      const alvo = c === 'I4' ? 0.8 : 0.85
      expect(v.ok / v.total, `categoria ${c}`).toBeGreaterThanOrEqual(alvo)
    }
  }, 180000)
})
