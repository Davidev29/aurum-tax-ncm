/**
 * Bloco **Naturezas da operação diferentes de venda** — fica logo acima dos
 * gráficos (para não ficar distante da apuração).
 *
 * Mostra, fornecedor a fornecedor: "o fornecedor X emitiu a nota Y com
 * natureza da operação diferente de venda", com CFOPs, motivo (sem crédito /
 * imobilizado) e o comparativo com as **imunidades previstas na LC 214/2025**.
 * Operação diferente de venda **não gera direito a crédito** — e compra para
 * ativo imobilizado também não. O bloco é informativo: o cliente decide.
 */
import { useMemo, useState } from 'react'
import { fmtCnpj, fmtMoeda } from '@/domain/services/format'
import { IMUNIDADES_LC214, resumirNaturezas } from '@/infrastructure/nfe/cfop'
import type { NotaXml } from '@/infrastructure/nfe/tipos'
import { useNfe } from '@/store/nfe'
import { Expansivel } from '@/ui/motion'
import { IconeBadge, Painel, Pill } from '@/ui/kit'

const ROTULO_EFEITO: Record<string, { texto: string; cor: 'amber' | 'slate' | 'brand' }> = {
  'sem-efeito': { texto: 'Diferente de venda · sem crédito', cor: 'amber' },
  imobilizado: { texto: 'Ativo imobilizado · sem crédito', cor: 'slate' },
  'compra-gera': { texto: 'Gera crédito', cor: 'brand' },
  venda: { texto: 'Venda', cor: 'brand' },
}

const fmtDataCurta = (iso: string): string =>
  /^\d{4}-\d{2}-\d{2}$/.test(iso ?? '') ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : (iso || '—')

export function BlocoNaturezas({ notas }: { notas: NotaXml[] }) {
  const [expandidos, setExpandidos] = useState<Record<string, boolean>>({})
  const [notasAbertas, setNotasAbertas] = useState<Record<string, boolean>>({})
  const [verLc, setVerLc] = useState(false)
  const resumo = useMemo(() => resumirNaturezas(notas ?? []), [notas])
  const porChave = useMemo(
    () => new Map((notas ?? []).map((n) => [String(n?.chave ?? ''), n])),
    [notas],
  )
  const abrirNota = useNfe((s) => s.abrirNota)
  // Por padrão a primeira natureza vem aberta (dropdown); demais fechadas.
  const isAberto = (natOp: string, idx: number) => expandidos[natOp] ?? idx === 0
  const alternar = (natOp: string, idx: number) =>
    setExpandidos((m) => ({ ...m, [natOp]: !isAberto(natOp, idx) }))
  const todasAbertas = resumo.grupos.length > 0 && resumo.grupos.every((g, i) => isAberto(g.natOp, i))
  const alternarTodas = () =>
    setExpandidos(() =>
      Object.fromEntries(resumo.grupos.map((g) => [g.natOp, !todasAbertas])),
    )
  if (!notas?.length) return null

  if (!resumo.qtdNaoVenda) {
    return (
      <Painel className="overflow-hidden p-0">
        <div className="flex items-start gap-3 px-5 py-4">
          <IconeBadge nome="nota" tom="emerald" tamanho="lg" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-black tracking-tight">
              Naturezas da operação — tudo venda
            </h3>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              Todas as {resumo.totalNotas} nota(s) do filtro têm natureza da operação de{' '}
              <strong>venda</strong> (ou compra correspondente). Nenhuma operação diferente de
              venda, imobilizado ou imunidade da LC 214/2025 foi separada.
            </p>
          </div>
          <span className="pill bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            ✓ NADA A CONFERIR
          </span>
        </div>
      </Painel>
    )
  }

  return (
    <Painel className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] bg-gradient-to-r from-amber-50/90 to-white px-5 py-4 dark:from-amber-950/30 dark:to-slate-900">
        <IconeBadge nome="alerta" tom="amber" tamanho="lg" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-black tracking-tight">
            Naturezas da operação diferentes de venda
          </h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            <strong>{resumo.qtdNaoVenda}</strong> de {resumo.totalNotas} nota(s) —{' '}
            <strong>{fmtMoeda(resumo.valorNaoVenda)}</strong> — vieram com natureza ou CFOP
            diferente de venda: <strong>não geram direito a crédito</strong>. Compra para ativo
            imobilizado também não. Compare com as imunidades da LC 214/2025 abaixo —{' '}
            <strong>você decide</strong> o que aproveitar.
          </p>
        </div>
        <span className="pill bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          {resumo.qtdNaoVenda} NOTA(S) · {fmtMoeda(resumo.valorNaoVenda)}
        </span>
      </div>

      <div className="space-y-2.5 p-5">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <div className="calc-kpi border-l-4 !border-l-amber-400">
            <div className="text-[10px] font-bold uppercase text-slate-500">Diferente de venda</div>
            <div className="font-mono text-lg font-black">{fmtMoeda(resumo.valorSemEfeito)}</div>
            <div className="mt-0.5 text-[10px] text-slate-400">
              {resumo.qtdSemEfeito} nota(s) · CFOP {resumo.cfopsEnvolvidos.slice(0, 6).join(', ') || '—'}
              {resumo.cfopsEnvolvidos.length > 6 ? ` +${resumo.cfopsEnvolvidos.length - 6}` : ''}
            </div>
          </div>
          <div className="calc-kpi border-l-4 !border-l-slate-400">
            <div className="text-[10px] font-bold uppercase text-slate-500">Ativo imobilizado / uso</div>
            <div className="font-mono text-lg font-black">{fmtMoeda(resumo.valorImobilizado)}</div>
            <div className="mt-0.5 text-[10px] text-slate-400">{resumo.qtdImobilizado} nota(s) · sem crédito</div>
          </div>
          <div className="calc-kpi border-l-4 !border-l-brand-400">
            <div className="text-[10px] font-bold uppercase text-slate-500">Como conferir</div>
            <div className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              Abra cada natureza abaixo, veja o motivo e compare com as imunidades da LC 214/2025.
            </div>
          </div>
        </div>

        <div className="space-y-2">
          {resumo.grupos.length > 1 ? (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={alternarTodas}
                className="text-[11px] font-bold text-slate-500 underline-offset-2 hover:underline dark:text-slate-400"
              >
                {todasAbertas ? 'Recolher todas' : 'Expandir todas'}
              </button>
            </div>
          ) : null}
          {resumo.grupos.map((g, idx) => {
            const abertoGrupo = isAberto(g.natOp, idx)
            const painelId = `natureza-${idx}`
            return (
            <div key={g.natOp} className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => alternar(g.natOp, idx)}
                aria-expanded={abertoGrupo}
                aria-controls={painelId}
                className="flex w-full flex-wrap items-center gap-2 bg-slate-50/80 px-4 py-2.5 text-left transition-colors hover:bg-slate-100/80 dark:bg-slate-950/40 dark:hover:bg-slate-900/60"
              >
                <span aria-hidden className="inline-block w-4 shrink-0 text-slate-400">
                  {abertoGrupo ? '▾' : '▸'}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-black" title={g.natOp}>
                  🏷️ {g.natOp}
                </span>
                {g.temImobilizado ? <Pill cor="slate">Ativo imobilizado</Pill> : null}
                {g.temImunidade ? <Pill cor="brand">Possível imunidade LC 214</Pill> : null}
                <span className="font-mono text-xs font-bold text-slate-500">
                  {g.qtdNotas} nota(s) · {fmtMoeda(g.valorTotal)}
                </span>
              </button>
              <Expansivel aberto={abertoGrupo}>
              <div id={painelId}>
              <ul className="divide-y divide-slate-100 px-4 dark:divide-slate-800">
                {g.notas.map((n) => {
                  const rot = ROTULO_EFEITO[n.efeito] ?? ROTULO_EFEITO['sem-efeito']
                  const idNota = n.chave || `${n.emitCnpj}-${n.numero}`
                  const notaAberta = !!notasAbertas[idNota]
                  const completa = porChave.get(String(n.chave ?? ''))
                  const detalheId = `nota-${g.natOp}-${n.numero}-${n.emitCnpj}`.replace(/\W+/g, '-')
                  return (
                    <li key={idNota} className="py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-xs font-bold" title={`${n.emitNome} · nota ${n.numero}`}>
                          {n.emitNome} · nota {n.numero || '—'}
                        </span>
                        <Pill cor={rot.cor}>{rot.texto}</Pill>
                        <span className="font-mono text-xs font-black">{fmtMoeda(n.valorTotal)}</span>
                      </div>
                      <div className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                        Fornecedor emitiu com natureza <strong>"{n.natOp}"</strong>
                        {n.cfops.length ? <> · CFOP {n.cfops.join(', ')}</> : null} — {n.motivo}
                      </div>
                      {n.imunidadeLC ? (
                        <div className="mt-1 rounded-xl border border-brand-200 bg-brand-50/60 px-2.5 py-1.5 text-[11px] leading-relaxed text-brand-800 dark:border-brand-900 dark:bg-brand-950/30 dark:text-brand-200">
                          🛡️ {n.imunidadeLC}
                        </div>
                      ) : null}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setNotasAbertas((m) => ({ ...m, [idNota]: !notaAberta }))}
                          aria-expanded={notaAberta}
                          aria-controls={detalheId}
                          className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-bold text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          {notaAberta ? '▾ Ocultar nota' : '▸ Ver nota'}
                        </button>
                        {completa ? (
                          <button
                            type="button"
                            onClick={() => abrirNota(completa)}
                            title="Abrir detalhe completo (itens, NCM e tributos)"
                            className="rounded-lg px-2 py-1 text-[11px] font-bold text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/40"
                          >
                            👁 Detalhes completos
                          </button>
                        ) : null}
                      </div>
                      <Expansivel aberto={notaAberta}>
                        <div id={detalheId} className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-950/40">
                          {completa ? (
                            <div className="space-y-2 p-3">
                              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] sm:grid-cols-4">
                                <div>
                                  <dt className="font-bold uppercase text-slate-400 text-[10px]">Emissão</dt>
                                  <dd className="font-mono">{fmtDataCurta(completa.dataEmissao)}</dd>
                                </div>
                                <div>
                                  <dt className="font-bold uppercase text-slate-400 text-[10px]">Série / Nº</dt>
                                  <dd className="font-mono">{completa.serie || '—'} / {completa.numero || '—'}</dd>
                                </div>
                                <div>
                                  <dt className="font-bold uppercase text-slate-400 text-[10px]">Emitente</dt>
                                  <dd className="truncate" title={`${completa.emitNome} · ${fmtCnpj(completa.emitCnpj)}`}>{completa.emitNome} · {fmtCnpj(completa.emitCnpj)}</dd>
                                </div>
                                <div>
                                  <dt className="font-bold uppercase text-slate-400 text-[10px]">Direção</dt>
                                  <dd>{completa.direcao}</dd>
                                </div>
                                <div>
                                  <dt className="font-bold uppercase text-slate-400 text-[10px]">Produtos</dt>
                                  <dd className="font-mono">{fmtMoeda(completa.valorProdutos)}</dd>
                                </div>
                                <div>
                                  <dt className="font-bold uppercase text-slate-400 text-[10px]">Total nota</dt>
                                  <dd className="font-mono font-black">{fmtMoeda(completa.valorTotal)}</dd>
                                </div>
                                <div>
                                  <dt className="font-bold uppercase text-slate-400 text-[10px]">IBS / CBS</dt>
                                  <dd className="font-mono">{fmtMoeda(completa.totalIBS)} / {fmtMoeda(completa.totalCBS)}</dd>
                                </div>
                                <div>
                                  <dt className="font-bold uppercase text-slate-400 text-[10px]">Chave</dt>
                                  <dd className="truncate font-mono" title={completa.chave}>{completa.chave}</dd>
                                </div>
                              </dl>
                              <div className="overflow-auto">
                                <table className="tbl w-full">
                                  <thead>
                                    <tr>
                                      <th>Item</th>
                                      <th>NCM</th>
                                      <th>CFOP</th>
                                      <th className="th-r">Qtd</th>
                                      <th className="th-r">Valor</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {completa.itensAnalisados.map((it) => (
                                      <tr key={`${it.chave}-${it.numItem}`}>
                                        <td className="max-w-45 truncate" title={it.descricao}>{it.descricao}</td>
                                        <td className="font-mono">{it.ncm || '—'}</td>
                                        <td className="font-mono">{it.cfop || '—'}</td>
                                        <td className="text-right font-mono">{Number(it.qtd) || 0} {it.unid || ''}</td>
                                        <td className="text-right font-mono">{fmtMoeda(it.vlTotal)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          ) : (
                            <p className="p-3 text-[11px] text-slate-500">
                              Chave {n.chave || '—'} · {n.cfops.length ? `CFOP ${n.cfops.join(', ')} · ` : ''}{fmtMoeda(n.valorTotal)}. A nota completa saiu do filtro atual — amplie o período para ver os itens.
                            </p>
                          )}
                        </div>
                      </Expansivel>
                    </li>
                  )
                })}
              </ul>
              </div>
              </Expansivel>
            </div>
            )
          })}
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={() => setVerLc((v) => !v)}
            aria-expanded={verLc}
            className="flex w-full items-center gap-2 bg-slate-50/80 px-4 py-2.5 text-left text-xs font-black dark:bg-slate-950/40"
          >
            <span aria-hidden>{verLc ? '▾' : '▸'}</span>
            🛡️ Imunidades previstas na LC 214/2025 — compare operação a operação
          </button>
          <Expansivel aberto={verLc}>
            <ul className="space-y-1.5 p-3 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              {IMUNIDADES_LC214.map((im) => (
                <li key={im.titulo} className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-950/40">
                  <strong className="text-slate-600 dark:text-slate-300">{im.titulo}:</strong> {im.detalhe}
                </li>
              ))}
              <li className="p-1">
                Tabela CFOP salva no sistema (<span className="font-mono">bases-fonte/cfop.json</span>,
                619 operações) — cada nota acima foi comparada CFOP a CFOP e natureza a natureza.
              </li>
            </ul>
          </Expansivel>
        </div>
      </div>
    </Painel>
  )
}
