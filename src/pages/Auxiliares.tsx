/**
 * Tela **Tabelas auxiliares** (SPEC §9).
 *
 * Oito listas editáveis + auditoria, renderizadas a partir de `AUX_META` (Clean Code: a UI
 * é genérica — colunas, rótulos e formulário vêm dos metadados).
 *
 * Paginação:
 * - todas as tabelas exibem no máximo `PAGE_SIZE` (10) itens por página, com
 *   navegação « ‹ 1 2 3 › » até a última página;
 * - a exceção é a Nomenclatura NCM (milhares de registros): viewport de altura
 *   fixa com scroll elegante (`scroll-elegante`), agrupada por capítulo;
 * - filtro com debounce de 150 ms, que volta para a página 1;
 * - CFOP, CST ICMS e CST PIS/COFINS ordenados por código.
 */
import { useEffect, useMemo, useState } from 'react'
import { PAGE_SIZE } from '@/domain/constants'
import { CAPITULOS_NCM } from '@/domain/constants/capitulos'
import { fmtNcm } from '@/domain/services/format'
import {
  AUX_META,
  COLUNAS_AUX,
  ROTULOS_COLUNA,
  celulaAux,
  type TipoAux,
} from '@/application/aux-meta'
import { abrirEdicaoAux } from '@/modais/globais'
import { confirmar } from '@/store/dialogo'
import { itensVisiveis, totalFiltrado, useAuxiliares, type RegistroAux } from '@/store/auxiliares'
import { Btn, Painel, Texto, Vazio, useDebounce } from '@/ui/kit'

const VAZIO: RegistroAux[] = []

/** Tabelas com ordenação lexicográfica por código (paridade com a v1). */
const ORDENAVEIS: ReadonlySet<TipoAux> = new Set<TipoAux>(['cfop', 'csticms', 'cstpiscofins', 'cest'])

interface DescricaoTabela {
  tipo: TipoAux
  icone: string
  titulo: string
  placeholder: string
  rotuloNovo: string
}

const TABELAS: DescricaoTabela[] = [
  {
    tipo: 'cst',
    icone: '🏷',
    titulo: 'CST — Situação Tributária (IBS/CBS)',
    placeholder: 'Filtrar…',
    rotuloNovo: 'Novo CST',
  },
  {
    tipo: 'cstct',
    icone: '🎯',
    titulo: 'cClassTrib — Classificação Tributária',
    placeholder: 'Filtrar código ou nome…',
    rotuloNovo: 'Novo cClassTrib',
  },
  {
    tipo: 'ncmnomen',
    icone: '📖',
    titulo: 'Nomenclatura NCM vigente',
    placeholder: 'Filtrar código ou descrição…',
    rotuloNovo: 'Novo NCM',
  },
  {
    tipo: 'ncm',
    icone: '🔗',
    titulo: 'NCM × Classificação Tributária',
    placeholder: 'Filtrar código, CST ou cClassTrib…',
    rotuloNovo: 'Vínculo NCM',
  },
  {
    tipo: 'cfop',
    icone: '📋',
    titulo: 'CFOP — Código Fiscal de Operações',
    placeholder: 'Filtrar código ou descrição…',
    rotuloNovo: 'Novo CFOP',
  },
  {
    tipo: 'csticms',
    icone: '🏷',
    titulo: 'CST ICMS — Tributação do ICMS',
    placeholder: 'Filtrar código ou descrição…',
    rotuloNovo: 'Novo CST ICMS',
  },
  {
    tipo: 'cstpiscofins',
    icone: '💰',
    titulo: 'CST PIS / COFINS',
    placeholder: 'Filtrar código ou descrição…',
    rotuloNovo: 'Novo CST PIS/COFINS',
  },
  {
    tipo: 'cest',
    icone: '🏷',
    titulo: 'CEST — Código Especificador (informativo)',
    placeholder: 'Filtrar código, descrição ou NCM…',
    rotuloNovo: 'Novo CEST',
  },
]

export function Auxiliares() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="rounded-2xl border border-brand-200 bg-gradient-to-r from-brand-50 to-white p-4 text-xs text-brand-900 dark:border-aurum-900 dark:from-brand-950/40 dark:to-slate-900 dark:text-brand-200">
        <div className="flex items-start gap-2">
          <span className="text-lg">✏️</span>
          <div>
            <div className="font-bold">Tabelas editáveis</div>
            <div className="mt-0.5 opacity-90">
              Você pode <strong>adicionar</strong>, <strong>editar</strong> e{' '}
              <strong>excluir</strong> registros em todas as tabelas abaixo.
            </div>
          </div>
        </div>
      </div>

      {TABELAS.map((t) => (
        <PainelTabela key={t.tipo} {...t} />
      ))}

      <PainelAuditoria />
    </div>
  )
}

/* ------------------------------------------------------------- painel ----- */

function PainelTabela({ tipo, icone, titulo, placeholder, rotuloNovo }: DescricaoTabela) {
  const carregar = useAuxiliares((s) => s.carregar)
  const filtrar = useAuxiliares((s) => s.filtrar)
  const irParaPagina = useAuxiliares((s) => s.irParaPagina)
  const cache = useAuxiliares((s) => s.caches[tipo] ?? VAZIO)
  const filtro = useAuxiliares((s) => s.filtros[tipo] ?? '')
  const paginaNum = useAuxiliares((s) => s.paginas[tipo] ?? 1)
  const [texto, setTexto] = useState(filtro)

  const meta = AUX_META[tipo]

  useEffect(() => {
    void carregar(tipo)
  }, [tipo, carregar])

  // Filtro com debounce de 150 ms (que volta para a página 1).
  const aplicar = useDebounce((t: string) => filtrar(tipo, t), 150)
  // Busca inline da nomenclatura replica o filtro com debounce próprio de 200 ms.
  const aplicarInline = useDebounce((t: string) => filtrar(tipo, t), 200)

  const ordenados = useMemo(() => {
    if (!ORDENAVEIS.has(tipo)) return cache
    return [...cache].sort((a, b) => String(a.codigo).localeCompare(String(b.codigo)))
  }, [cache, tipo])

  const total = totalFiltrado(ordenados, filtro, meta)
  const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const paginaSegura = Math.min(Math.max(1, paginaNum), totalPaginas)

  // Prende a página ao intervalo válido quando o total encolhe (filtro/exclusão).
  useEffect(() => {
    if (paginaNum !== paginaSegura) irParaPagina(tipo, paginaSegura)
  }, [tipo, paginaNum, paginaSegura, irParaPagina])

  const visiveis = itensVisiveis(ordenados, paginaSegura, filtro, meta, PAGE_SIZE)
  // A nomenclatura não pagina: exibe tudo (agrupado por capítulo) dentro de
  // um viewport de altura fixa com scroll elegante.
  const linhasNomen = useMemo(() => {
    const f = filtro.trim().toLowerCase()
    return f ? ordenados.filter((r) => meta.texto(r).includes(f)) : ordenados
  }, [ordenados, filtro, meta])

  const inicio = total === 0 ? 0 : (paginaSegura - 1) * PAGE_SIZE + 1
  const fim = Math.min(paginaSegura * PAGE_SIZE, total)

  return (
    <Painel>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5 dark:border-slate-800">
        <h2 className="flex items-center gap-2 text-base font-bold">
          <span className="text-lg">{icone}</span> {titulo}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Texto
            type="search"
            className="field-sm w-64"
            placeholder={placeholder}
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value)
              aplicar(e.target.value)
            }}
          />
          <Btn variante="primary" onClick={() => abrirEdicaoAux(tipo)}>
            ＋ {rotuloNovo}
          </Btn>
        </div>
      </div>

      <div className="p-5">
        {!cache.length ? (
          <Vazio
            icone="🗂"
            titulo={`Nenhum registro em ${meta.titulo}`}
            texto="Use o botão ＋ Novo acima para criar o primeiro registro."
          />
        ) : tipo === 'ncmnomen' ? (
          <Nomenclatura
            linhas={linhasNomen}
            filtro={filtro}
            total={total}
            texto={texto}
            aoMudarInline={(t) => {
              setTexto(t)
              aplicarInline(t)
            }}
          />
        ) : !visiveis.length ? (
          <Vazio icone="🔍" titulo="Nenhum registro corresponde ao filtro" texto="Ajuste a busca." />
        ) : (
          <>
            <TabelaGenerica tipo={tipo} linhas={visiveis} />
            <Paginacao
              pagina={paginaSegura}
              totalPaginas={totalPaginas}
              inicio={inicio}
              fim={fim}
              total={total}
              aoMudar={(p) => irParaPagina(tipo, p)}
            />
          </>
        )}
      </div>
    </Painel>
  )
}

/* ---------------------------------------------------------- paginação ----- */

/** Janela de botões numéricos: até 7, com primeira/última sempre visíveis. */
function numerosPaginacao(pagina: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const janela = new Set<number>([1, 2, pagina - 1, pagina, pagina + 1, total - 1, total])
  const nums = [...janela].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b)
  const saida: (number | '…')[] = []
  for (let i = 0; i < nums.length; i++) {
    if (i > 0 && nums[i] - nums[i - 1] > 1) saida.push('…')
    saida.push(nums[i])
  }
  return saida
}

function Paginacao({
  pagina,
  totalPaginas,
  inicio,
  fim,
  total,
  aoMudar,
}: {
  pagina: number
  totalPaginas: number
  inicio: number
  fim: number
  total: number
  aoMudar: (p: number) => void
}) {
  const numeros = numerosPaginacao(pagina, totalPaginas)
  const base =
    'grid h-7 min-w-7 place-items-center rounded-lg px-1.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40'
  const idle =
    'text-slate-500 hover:bg-slate-100 hover:text-brand-600 dark:text-slate-400 dark:hover:bg-slate-800'
  const ativa = 'bg-brand-600 text-white shadow-pop'

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
      <span className="num text-[11px] text-slate-500 dark:text-slate-400">
        Exibindo {inicio}–{fim} de {total}
      </span>
      <nav className="flex items-center gap-1" aria-label="Paginação">
        <button
          type="button"
          title="Primeira página"
          aria-label="Primeira página"
          className={`${base} ${idle}`}
          disabled={pagina <= 1}
          onClick={() => aoMudar(1)}
        >
          «
        </button>
        <button
          type="button"
          title="Página anterior"
          aria-label="Página anterior"
          className={`${base} ${idle}`}
          disabled={pagina <= 1}
          onClick={() => aoMudar(pagina - 1)}
        >
          ‹
        </button>
        {numeros.map((n, i) =>
          n === '…' ? (
            <span key={`gap-${i}`} className="px-0.5 text-xs text-slate-400">
              …
            </span>
          ) : (
            <button
              key={n}
              type="button"
              aria-label={`Página ${n}`}
              aria-current={n === pagina ? 'page' : undefined}
              className={`${base} ${n === pagina ? ativa : idle}`}
              onClick={() => aoMudar(n)}
            >
              {n}
            </button>
          ),
        )}
        <button
          type="button"
          title="Próxima página"
          aria-label="Próxima página"
          className={`${base} ${idle}`}
          disabled={pagina >= totalPaginas}
          onClick={() => aoMudar(pagina + 1)}
        >
          ›
        </button>
        <button
          type="button"
          title="Última página"
          aria-label="Última página"
          className={`${base} ${idle}`}
          disabled={pagina >= totalPaginas}
          onClick={() => aoMudar(totalPaginas)}
        >
          »
        </button>
      </nav>
    </div>
  )
}

/* ---------------------------------------------------------- genérica ------ */

function TabelaGenerica({ tipo, linhas }: { tipo: TipoAux; linhas: RegistroAux[] }) {
  const meta = AUX_META[tipo]
  const colunas = COLUNAS_AUX[tipo]

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
      <table className="tbl w-full">
        <thead>
          <tr>
            {colunas.map((c) => (
              <th key={c}>{ROTULOS_COLUNA[c] ?? c}</th>
            ))}
            <th className="th-r">Ações</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((r, i) => (
            <tr key={`${meta.chave(r)}-${i}`}>
              {colunas.map((c) => (
                <td key={c} className={c === 'descricao' ? 'max-w-md truncate' : undefined}>
                  {celulaAux(tipo, c, r[c])}
                </td>
              ))}
              <td>
                <AcoesAux tipo={tipo} chave={meta.chave(r)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AcoesAux({ tipo, chave }: { tipo: TipoAux; chave: string }) {
  const excluir = useAuxiliares((s) => s.excluir)
  const meta = AUX_META[tipo]

  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        title="Editar"
        className="grid h-7 w-7 place-items-center rounded-lg text-brand-600 transition hover:bg-brand-50 dark:hover:bg-brand-900/30"
        onClick={() => abrirEdicaoAux(tipo, chave)}
      >
        ✏️
      </button>
      <button
        type="button"
        title="Excluir"
        className="grid h-7 w-7 place-items-center rounded-lg text-red-600 transition hover:bg-red-50 dark:hover:bg-red-950/40"
        onClick={() => {
          void (async () => {
            const ok = await confirmar(
              `Excluir ${meta.singular}?`,
              `Excluir este registro de ${meta.titulo}?`,
              { icone: '🗑', confirmar: 'Excluir', perigo: true },
            )
            if (ok) void excluir(tipo, chave)
          })()
        }}
      >
        🗑
      </button>
    </div>
  )
}

/* ------------------------------------------------------- nomenclatura ----- */

function Nomenclatura({
  linhas,
  filtro,
  total,
  texto,
  aoMudarInline,
}: {
  linhas: RegistroAux[]
  filtro: string
  total: number
  texto: string
  aoMudarInline: (t: string) => void
}) {
  const [abertos, setAbertos] = useState<Set<string>>(() => new Set())
  const f = filtro.trim().toLowerCase()

  const grupos = useMemo(() => {
    const mapa = new Map<string, RegistroAux[]>()
    for (const r of linhas) {
      const bruto = String(r.codigoOriginal ?? r.codigo ?? '')
      const cap = bruto.replace(/\./g, '').slice(0, 2)
      if (!cap) continue
      const lista = mapa.get(cap)
      if (lista) lista.push(r)
      else mapa.set(cap, [r])
    }
    for (const lista of mapa.values()) {
      lista.sort((a, b) => String(a.codigo).localeCompare(String(b.codigo)))
    }
    return [...mapa.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [linhas])

  if (!linhas.length) {
    return (
      <Vazio
        icone="🔍"
        titulo={f ? `Nenhum NCM encontrado para "${filtro}".` : 'Nenhum registro'}
        texto="Ajuste a busca ou crie um registro com o botão ＋ Novo."
      />
    )
  }

  const alternar = (cap: string) =>
    setAbertos((atual) => {
      const novo = new Set(atual)
      if (novo.has(cap)) novo.delete(cap)
      else novo.add(cap)
      return novo
    })

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            🔍
          </span>
          <Texto
            type="search"
            className="field-sm w-full pl-9"
            placeholder="Buscar NCM ou descrição…"
            value={texto}
            onChange={(e) => aoMudarInline(e.target.value)}
          />
        </div>
        <span className="text-xs text-slate-500">
          {f
            ? `${total} resultado(s) em ${grupos.length} capítulo(s)`
            : `${grupos.length} capítulos`}
        </span>
      </div>

      {/* Viewport de altura fixa com scroll elegante: a nomenclatura tem
          milhares de registros e não usa paginação numérica. */}
      <div className="scroll-elegante max-h-[560px] overflow-y-auto rounded-xl bg-slate-50/60 p-2 dark:bg-slate-950/30">
        <div className="space-y-2">
          {grupos.map(([cap, itens]) => {
            // Com filtro, tudo abre; sem filtro, respeita o acordeão local.
            const expandido = Boolean(f) || abertos.has(cap)

            return (
              <div
                key={cap}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
              >
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-slate-950/40"
                  onClick={() => alternar(cap)}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="pill shrink-0 bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
                      {cap}
                    </span>
                    <span className="truncate text-sm font-semibold">
                      {CAPITULOS_NCM[cap] ?? ''}
                    </span>
                    <span className="shrink-0 text-[10px] text-slate-400">({itens.length})</span>
                  </div>
                  <span
                    className={`text-slate-400 transition-transform duration-200 ${
                      expandido ? 'rotate-180' : ''
                    }`}
                  >
                    ▼
                  </span>
                </button>

                {expandido ? (
                  <div className="border-t border-slate-100 dark:border-slate-800">
                    <div className="scroll-elegante max-h-[320px] overflow-auto">
                      <table className="tbl w-full">
                        <thead>
                          <tr>
                            <th>Código</th>
                            <th>Descrição</th>
                            <th>Vigência</th>
                            <th>Ato</th>
                            <th className="th-r">Ações</th>
                          </tr>
                        </thead>
                        <tbody>
                          {itens.map((r, i) => (
                            <LinhaNcm key={`${r.codigo}-${i}`} r={r} />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

function LinhaNcm({ r }: { r: RegistroAux }) {
  const codigo = String(r.codigoOriginal ?? r.codigo ?? '')
  const vigencia = [
    r.dataInicio ? String(r.dataInicio) : '',
    r.dataFim ? ` → ${String(r.dataFim)}` : '',
  ].join('')

  return (
    <tr>
      <td className="whitespace-nowrap font-mono font-bold">{fmtNcm(codigo) || codigo}</td>
      <td>{celulaAux('ncmnomen', 'descricao', r.descricao)}</td>
      <td className="whitespace-nowrap text-[10px] text-slate-500">{vigencia || '—'}</td>
      <td className="text-[10px] text-slate-500">{r.ato ? String(r.ato) : '—'}</td>
      <td>
        <AcoesAux tipo="ncmnomen" chave={String(r.codigo ?? '')} />
      </td>
    </tr>
  )
}

/* ---------------------------------------------------------- auditoria ----- */

/** Log imutável de auditoria (append-only, somente leitura). */
function PainelAuditoria() {
  const [linhas, setLinhas] = useState<RegistroAux[]>([])
  const [filtro, setFiltro] = useState('')
  const [pagina, setPagina] = useState(1)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    let vivo = true
    void (async () => {
      try {
        const { db } = await import('@/infrastructure/db/schema')
        const n = await db.table('audit_log').count().catch(() => 0)
        if (!vivo) return
        setTotal(n)
        const ultimos = await db.table('audit_log').orderBy('id').reverse().limit(200).toArray().catch(() => [])
        if (!vivo) return
        setLinhas((ultimos as RegistroAux[]).reverse())
      } catch {
        if (vivo) setLinhas([])
      }
    })()
    return () => {
      vivo = false
    }
  }, [])

  const f = filtro.trim().toLowerCase()
  const filtradas = f
    ? linhas.filter((r) =>
        `${String(r.quando ?? '')} ${String(r.tabela ?? '')} ${String(r.chave ?? '')} ${String(r.operacao ?? '')} ${String(r.autor ?? '')}`.toLowerCase().includes(f),
      )
    : linhas
  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / PAGE_SIZE))
  const paginaSegura = Math.min(Math.max(1, pagina), totalPaginas)
  const visiveis = filtradas.slice((paginaSegura - 1) * PAGE_SIZE, paginaSegura * PAGE_SIZE)

  const resumo = (v: unknown): string => {
    if (v == null) return '—'
    const s = typeof v === 'string' ? v : JSON.stringify(v)
    return s.length > 120 ? `${s.slice(0, 120)}…` : s
  }

  return (
    <Painel>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5 dark:border-slate-800">
        <h2 className="flex items-center gap-2 text-base font-bold">
          <span className="text-lg">🧾</span> Auditoria — log imutável
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {total} evento(s) · últimos 200 · append-only
          </span>
          <Texto
            type="search"
            className="field-sm w-64"
            placeholder="Filtrar tabela, chave, operação…"
            value={filtro}
            onChange={(e) => {
              setFiltro(e.target.value)
              setPagina(1)
            }}
          />
        </div>
      </div>
      <div className="p-5">
        <p className="mb-3 text-[11px] text-slate-500 dark:text-slate-400">
          Quem mudou o quê e quando. Este log nunca é editado nem apagado pela interface — nem o restore o limpa, só acrescenta.
        </p>
        {!visiveis.length ? (
          <Vazio icone="🧾" titulo="Nenhum evento de auditoria" texto="Edite uma tabela auxiliar ou faça uma reclassificação manual para gerar o primeiro evento." />
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="tbl w-full">
                <thead>
                  <tr>
                    <th>Quando</th>
                    <th>Tabela</th>
                    <th>Chave</th>
                    <th>Operação</th>
                    <th>Antes → Depois</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((r, i) => (
                    <tr key={`${String(r.quando ?? i)}-${i}`}>
                      <td className="whitespace-nowrap font-mono text-[11px]">
                        {String(r.quando ?? '—').slice(0, 19).replace('T', ' ')}
                      </td>
                      <td className="font-mono text-[11px]">{String(r.tabela ?? '—')}</td>
                      <td className="font-mono text-[11px]">{String(r.chave ?? '—')}</td>
                      <td>
                        <span
                          className={
                            r.operacao === 'excluir'
                              ? 'pill bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                              : r.operacao === 'criar'
                                ? 'pill bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                                : 'pill bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                          }
                        >
                          {String(r.operacao ?? '—')}
                        </span>
                      </td>
                      <td className="max-w-md truncate font-mono text-[10px] text-slate-500" title={resumo(r.depois)}>
                        {resumo(r.antes)} → {resumo(r.depois)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginacao
              pagina={paginaSegura}
              totalPaginas={totalPaginas}
              inicio={(paginaSegura - 1) * PAGE_SIZE + 1}
              fim={Math.min(paginaSegura * PAGE_SIZE, filtradas.length)}
              total={filtradas.length}
              aoMudar={setPagina}
            />
          </>
        )}
      </div>
    </Painel>
  )
}
