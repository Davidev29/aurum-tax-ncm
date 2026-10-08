/**
 * Tela **Tabelas auxiliares** (SPEC §9).
 *
 * Oito listas editáveis + base oficial em uso + auditoria, renderizadas a
 * partir de `AUX_META` (Clean Code: a UI é genérica — colunas, rótulos e
 * formulário vêm dos metadados).
 *
 * Disponibilidade: cada painel vive dentro de um `LimiteErro` próprio e a
 * tela inteira tem outro na raiz — uma tabela corrompida ou uma store legada
 * ausente nunca deixa a tela em branco; no pior caso o painel mostra a falha
 * com botão de tentar de novo e os demais continuam funcionando.
 *
 * Paginação:
 * - todas as tabelas exibem no máximo `PAGE_SIZE` (10) itens por página, com
 *   navegação « ‹ 1 2 3 › » até a última página;
 * - a exceção é a Nomenclatura NCM (milhares de registros): viewport de altura
 *   fixa com scroll elegante (`scroll-elegante`), agrupada por capítulo;
 * - filtro com debounce de 150 ms, que volta para a página 1;
 * - CFOP, CST ICMS e CST PIS/COFINS ordenados por código.
 */
import { Component, useEffect, useMemo, useState, type ReactNode } from 'react'
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
import { useUi } from '@/store/ui'
import { itensVisiveis, totalFiltrado, useAuxiliares, type RegistroAux } from '@/store/auxiliares'
import { Btn, Painel, Texto, Vazio, useDebounce } from '@/ui/kit'
import { Entrada, Secao } from '@/ui/motion'

const VAZIO: RegistroAux[] = []

/** Tabelas com ordenação lexicográfica por código (paridade com a v1). */
const ORDENAVEIS: ReadonlySet<TipoAux> = new Set<TipoAux>(['cfop', 'csticms', 'cstpiscofins', 'cest'])

/* ------------------------------------------------- segurança de texto --- */

/** `String(v).slice(0, n)` que nunca lança e nunca devolve vazio cru. */
function textoCurto(v: unknown, n: number): string {
  try {
    const s = v == null ? '' : String(v)
    if (!s.trim()) return '—'
    return s.length > n ? `${s.slice(0, n)}…` : s
  } catch {
    return '—'
  }
}

/** Milhares em pt-BR; `—` quando ausente/inválido (nunca lança). */
function qtdSegura(v: unknown): string {
  try {
    if (v == null) return '—'
    return Number(v).toLocaleString('pt-BR')
  } catch {
    return '—'
  }
}

/** Lê o texto de busca de um registro sem lançar (linha corrompida = ''). */
function textoRegistro(tipo: TipoAux, r: RegistroAux): string {
  try {
    const meta = AUX_META[tipo]
    if (!meta || !r || typeof r !== 'object') return ''
    return meta.texto(r as Record<string, unknown>).toLowerCase()
  } catch {
    return ''
  }
}

/** Lê a chave de um registro sem lançar (linha corrompida = ''). */
function chaveRegistro(tipo: TipoAux, r: RegistroAux): string {
  try {
    const meta = AUX_META[tipo]
    if (!meta || !r || typeof r !== 'object') return ''
    return String(meta.chave(r as Record<string, unknown>) ?? '')
  } catch {
    return ''
  }
}

/* ------------------------------------------------------- limite de erro --- */

/**
 * Barreira por painel: um throw na renderização vira um cartão de falha com
 * retry em vez de desmontar a tela inteira (tela em branco).
 */
class LimiteErro extends Component<{ nome: string; children: ReactNode }, { falha: string | null }> {
  state = { falha: null as string | null }

  static getDerivedStateFromError(e: unknown): { falha: string | null } {
    return { falha: e instanceof Error ? e.message : String(e) }
  }

  componentDidCatch(e: unknown): void {
    try {
      console.error(`[auxiliares:${this.props.nome}]`, e)
    } catch {
      /* console indisponível: ignora */
    }
  }

  render(): ReactNode {
    if (this.state.falha) {
      return (
        <Painel>
          <div className="p-5 text-center">
            <div className="text-2xl">⚠️</div>
            <div className="mt-2 text-sm font-bold">Esta seção falhou ao carregar</div>
            <p className="mx-auto mt-1 max-w-md text-[11px] text-slate-500 dark:text-slate-400">
              {textoCurto(this.state.falha, 220)} As demais tabelas continuam disponíveis.
            </p>
            <div className="mt-3">
              <Btn variante="primary" tam="sm" onClick={() => this.setState({ falha: null })}>
                Tentar novamente
              </Btn>
            </div>
          </div>
        </Painel>
      )
    }
    return this.props.children
  }
}

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
    <LimiteErro nome="tabelas-auxiliares">
      <div className="mx-auto max-w-6xl space-y-6">
        <Entrada>
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
        </Entrada>

        <Secao>
        <LimiteErro nome="base-oficial">
          <PainelBaseOficial />
        </LimiteErro>
        </Secao>

        {TABELAS.map((t) => (
          <Secao key={t.tipo}>
          <LimiteErro nome={`tabela-${t.tipo}`}>
            <PainelTabela {...t} />
          </LimiteErro>
          </Secao>
        ))}

        <Secao>
        <LimiteErro nome="referencia-oficial">
          <PainelReferenciaOficial />
        </LimiteErro>
        </Secao>

        <Secao>
        <LimiteErro nome="nbs">
          <PainelNbs />
        </LimiteErro>
        </Secao>

        <Secao>
        <LimiteErro nome="tabelas-cff">
          <TabelasOficiaisCff />
        </LimiteErro>
        </Secao>

        <Secao>
        <LimiteErro nome="auditoria">
          <PainelAuditoria />
        </LimiteErro>
        </Secao>
      </div>
    </LimiteErro>
  )
}

/* ------------------------------------------- base oficial em uso ---------- */

/**
 * Carimbo da base que o motor realmente consulta (join 3NF NCM → CST →
 * cClassTrib → referência + nomenclatura vigente + NBS + anexos). É o que
 * responde "quais dados o sistema está utilizando" sem sair da tela.
 */
function PainelBaseOficial() {
  const [status, setStatus] = useState<{
    ncm: number
    cst: number
    cstClassTrib: number
    referencia: number
    nomenclatura: number
    nbs: number
    anexos: number
    produtosDfe: number
    credPresumido: number
    indOper: number
    geradoEm: string | null
    grafo: { nodos: number; arestas: number; hash: string; versao: string } | null
  } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [tentativa, setTentativa] = useState(0)

  useEffect(() => {
    let vivo = true
    setErro(null)
    void (async () => {
      try {
        const { statusBase } = await import('@/infrastructure/base/base-service')
        const s = await statusBase()
        if (!vivo) return
        setStatus(s)
      } catch (e) {
        if (vivo) setErro(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      vivo = false
    }
  }, [tentativa])

  const itens: Array<[string, string, unknown]> = status
    ? [
        ['🔗', 'Vínculos NCM', status.ncm],
        ['🏷', 'CST', status.cst],
        ['🎯', 'cClassTrib', status.cstClassTrib],
        ['📚', 'Referência oficial', status.referencia],
        ['📖', 'Nomenclatura', status.nomenclatura],
        ['🧮', 'NBS', status.nbs],
        ['📎', 'Anexos', status.anexos],
        ['🏭', 'Produtos DFe', status.produtosDfe],
        ['💰', 'Crédito pres.', status.credPresumido],
        ['📍', 'Locais operação', status.indOper],
        ['🕸', 'Grafo fiscal', status.grafo ? `${qtdSegura(status.grafo.nodos)} nós · ${qtdSegura(status.grafo.arestas)} arestas` : 'ausente (lexical)'],
      ]
    : []

  return (
    <Painel>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5 dark:border-slate-800">
        <h2 className="flex items-center gap-2 text-base font-bold">
          <span className="text-lg">🛡</span> Base oficial em uso pelo motor
        </h2>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          {status?.geradoEm
            ? `gerada em ${textoCurto(status.geradoEm.slice(0, 10).split('-').reverse().join('/'), 12)}`
            : 'origem: base embutida + importações manuais'}
        </span>
      </div>
      <div className="p-5">
        <p className="mb-3 text-[11px] text-slate-500 dark:text-slate-400">
          É desta base que saem as classificações da Consulta, do Lote e do XML (vínculo NCM →
          CST/cClassTrib → referência oficial com reduções, anexos e documentos). Para atualizar,
          use Configurações → Bases de dados.
        </p>
        {status?.grafo ? (
          <p className="mb-3 font-mono text-[10px] text-slate-400 dark:text-slate-500">
            🕸 grafo {textoCurto(status.grafo.versao, 16)} · hash {textoCurto(status.grafo.hash.slice(0, 12), 16)}… · índice derivado (o resolvedor segue sendo a única verdade fiscal)
          </p>
        ) : null}
        {erro ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center text-xs text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
            <div className="font-bold">Não foi possível ler o status da base</div>
            <p className="mt-1">{textoCurto(erro, 200)}</p>
            <div className="mt-2">
              <Btn tam="sm" variante="primary" onClick={() => setTentativa((t) => t + 1)}>
                Tentar novamente
              </Btn>
            </div>
          </div>
        ) : !status ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Carregando status da base">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-xl bg-slate-100 p-3 dark:bg-slate-800">
                <div className="h-3 w-2/3 rounded bg-slate-200 dark:bg-slate-700" />
                <div className="mt-2 h-5 w-1/2 rounded bg-slate-200 dark:bg-slate-700" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {itens.map(([icone, rotulo, valor]) => (
              <div key={rotulo} className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-950/40">
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  {icone} {rotulo}
                </div>
                <div className="num font-mono text-sm font-bold">{qtdSegura(valor)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Painel>
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
  const erroCarreg = useAuxiliares((s) => s.erros[tipo])
  const [texto, setTexto] = useState(filtro)

  const meta = AUX_META[tipo]

  useEffect(() => {
    try {
      void carregar(tipo)?.catch?.(() => undefined)
    } catch {
      /* o erro vai para `erros[tipo]` na store — a tela nunca quebra */
    }
  }, [tipo, carregar])

  // Filtro com debounce de 150 ms (que volta para a página 1).
  const aplicar = useDebounce((t: string) => {
    try {
      filtrar(tipo, t)
    } catch {
      /* filtro é cosmético: nunca quebra a tela */
    }
  }, 150)
  // Busca inline da nomenclatura replica o filtro com debounce próprio de 200 ms.
  const aplicarInline = useDebounce((t: string) => {
    try {
      filtrar(tipo, t)
    } catch {
      /* idem */
    }
  }, 200)

  if (!meta) {
    return (
      <Painel>
        <div className="p-5 text-center text-xs text-slate-500">
          Tabela “{tipo}” sem metadados — nada a exibir. As demais tabelas continuam disponíveis.
        </div>
      </Painel>
    )
  }

  const ordenados = useMemo(() => {
    try {
      const lista = Array.isArray(cache) ? cache.filter((r) => r && typeof r === 'object') : []
      if (!ORDENAVEIS.has(tipo)) return lista
      return [...lista].sort((a, b) => String(a.codigo ?? '').localeCompare(String(b.codigo ?? '')))
    } catch {
      return []
    }
  }, [cache, tipo])

  let total = 0
  try {
    const f = (filtro ?? '').trim().toLowerCase()
    total = f ? ordenados.filter((r) => textoRegistro(tipo, r).includes(f)).length : ordenados.length
  } catch {
    total = 0
  }
  // `totalFiltrado` é a fonte canônica quando funciona; o cálculo acima é o fallback.
  try {
    total = totalFiltrado(ordenados, filtro ?? '', meta)
  } catch {
    /* mantém o fallback */
  }
  const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const paginaSegura = Math.min(Math.max(1, paginaNum), totalPaginas)

  // Prende a página ao intervalo válido quando o total encolhe (filtro/exclusão).
  useEffect(() => {
    if (paginaNum !== paginaSegura) {
      try {
        irParaPagina(tipo, paginaSegura)
      } catch {
        /* nunca quebra a tela */
      }
    }
  }, [tipo, paginaNum, paginaSegura, irParaPagina])

  let visiveis: RegistroAux[] = []
  try {
    visiveis = itensVisiveis(ordenados, paginaSegura, filtro ?? '', meta, PAGE_SIZE)
  } catch {
    visiveis = []
  }
  // A nomenclatura não pagina: exibe tudo (agrupado por capítulo) dentro de
  // um viewport de altura fixa com scroll elegante.
  const linhasNomen = useMemo(() => {
    try {
      const f = (filtro ?? '').trim().toLowerCase()
      return f ? ordenados.filter((r) => textoRegistro(tipo, r).includes(f)) : ordenados
    } catch {
      return []
    }
  }, [ordenados, filtro, tipo])

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
          <Btn
            variante="primary"
            onClick={() => {
              try {
                abrirEdicaoAux(tipo)
              } catch {
                /* modal indisponível: a tabela continua legível */
              }
            }}
          >
            ＋ {rotuloNovo}
          </Btn>
        </div>
      </div>

      <div className="p-5">
        {erroCarreg ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center text-xs text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
            <div className="font-bold">Falha ao carregar {meta.titulo}</div>
            <p className="mt-1">{textoCurto(erroCarreg, 200)}</p>
            <div className="mt-2">
              <Btn tam="sm" variante="primary" onClick={() => void carregar(tipo)}>
                Tentar novamente
              </Btn>
            </div>
          </div>
        ) : !cache.length ? (
          <Vazio
            icone="🗂"
            titulo={`Nenhum registro em ${meta.titulo}`}
            texto="Use o botão ＋ Novo acima para criar o primeiro registro."
          />
        ) : tipo === 'ncmnomen' ? (
          <Nomenclatura
            linhas={linhasNomen}
            filtro={filtro ?? ''}
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
              aoMudar={(p) => {
                try {
                  irParaPagina(tipo, p)
                } catch {
                  /* nunca quebra */
                }
              }}
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
  try {
    const p = Math.max(1, Math.floor(pagina) || 1)
    const t = Math.max(1, Math.floor(total) || 1)
    if (t <= 7) return Array.from({ length: t }, (_, i) => i + 1)
    const janela = new Set<number>([1, 2, p - 1, p, p + 1, t - 1, t])
    const nums = [...janela].filter((n) => n >= 1 && n <= t).sort((a, b) => a - b)
    const saida: (number | '…')[] = []
    for (let i = 0; i < nums.length; i++) {
      if (i > 0 && nums[i] - nums[i - 1] > 1) saida.push('…')
      saida.push(nums[i])
    }
    return saida
  } catch {
    return [1]
  }
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
  if (!meta || !Array.isArray(colunas)) {
    return <div className="p-4 text-center text-xs text-slate-500">Tabela sem metadados.</div>
  }
  const seguras = Array.isArray(linhas) ? linhas.filter((r) => r && typeof r === 'object') : []

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
          {seguras.map((r, i) => (
            <tr key={`${chaveRegistro(tipo, r) || 'sem-chave'}-${i}`}>
              {colunas.map((c) => (
                <td key={c} className={c === 'descricao' ? 'max-w-md truncate' : undefined}>
                  {celulaAux(tipo, c, (r as Record<string, unknown>)[c])}
                </td>
              ))}
              <td>
                <AcoesAux tipo={tipo} chave={chaveRegistro(tipo, r)} />
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
        onClick={() => {
          try {
            abrirEdicaoAux(tipo, chave)
          } catch {
            /* modal indisponível */
          }
        }}
      >
        ✏️
      </button>
      <button
        type="button"
        title="Excluir"
        className="grid h-7 w-7 place-items-center rounded-lg text-red-600 transition hover:bg-red-50 dark:hover:bg-red-950/40"
        onClick={() => {
          void (async () => {
            try {
              const ok = await confirmar(
                `Excluir ${meta?.singular ?? 'registro'}?`,
                `Excluir este registro de ${meta?.titulo ?? tipo}?`,
                { icone: '🗑', confirmar: 'Excluir', perigo: true },
              )
              if (ok) {
                try {
                  await excluir(tipo, chave)
                } catch {
                  /* a store já avisa */
                }
              }
            } catch {
              /* diálogo indisponível */
            }
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
  const f = (filtro ?? '').trim().toLowerCase()

  const grupos = useMemo(() => {
    try {
      const mapa = new Map<string, RegistroAux[]>()
      const lista = Array.isArray(linhas) ? linhas : []
      for (const r of lista) {
        if (!r || typeof r !== 'object') continue
        const rec = r as Record<string, unknown>
        const bruto = String(rec.codigoOriginal ?? rec.codigo ?? '')
        const cap = bruto.replace(/\./g, '').slice(0, 2)
        if (!cap) continue
        const alvo = mapa.get(cap)
        if (alvo) alvo.push(r)
        else mapa.set(cap, [r])
      }
      for (const listaCap of mapa.values()) {
        listaCap.sort((a, b) =>
          String((a as Record<string, unknown>).codigo ?? '').localeCompare(
            String((b as Record<string, unknown>).codigo ?? ''),
          ),
        )
      }
      return [...mapa.entries()].sort(([a], [b]) => a.localeCompare(b))
    } catch {
      return [] as Array<[string, RegistroAux[]]>
    }
  }, [linhas])

  if (!linhas.length) {
    return (
      <Vazio
        icone="🔍"
        titulo={f ? `Nenhum NCM encontrado para "${textoCurto(filtro, 60)}".` : 'Nenhum registro'}
        texto="Ajuste a busca ou crie um registro com o botão ＋ Novo."
      />
    )
  }

  const alternar = (cap: string) =>
    setAbertos((atual) => {
      try {
        const novo = new Set(atual)
        if (novo.has(cap)) novo.delete(cap)
        else novo.add(cap)
        return novo
      } catch {
        return atual
      }
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
                    {/* FIX sobreposição: sem viewport interno — só o externo
                        (max-h-560) rola. Viewport duplo criava 2 barras +
                        headers sticky empilhados. */}
                    <div className="overflow-visible">
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
                            <LinhaNcm
                              key={`${chaveRegistro('ncmnomen', r) || 'ncm'}-${i}`}
                              r={r}
                            />
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
  let codigo = ''
  let vigencia = ''
  let ato = '—'
  let extinto = false
  try {
    const rec = (r ?? {}) as Record<string, unknown>
    codigo = String(rec.codigoOriginal ?? rec.codigo ?? '')
    const ini = rec.dataInicio ? String(rec.dataInicio) : ''
    const fim = rec.dataFim ? String(rec.dataFim) : ''
    vigencia = [ini, fim ? ` → ${fim}` : ''].join('')
    extinto = Boolean(fim)
    const atoFim = rec.atoFim ? String(rec.atoFim) : ''
    ato = rec.ato ? String(rec.ato) : '—'
    if (atoFim) ato = `${ato} · fim: ${atoFim}`
  } catch {
    codigo = ''
    vigencia = ''
    ato = '—'
  }
  let codigoFmt = codigo
  try {
    codigoFmt = fmtNcm(codigo) || codigo
  } catch {
    codigoFmt = codigo
  }

  return (
    <tr>
      <td className="whitespace-nowrap font-mono font-bold">
        {codigoFmt}
        {extinto ? (
          <span className="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-black text-red-700 dark:bg-red-950/40 dark:text-red-300">
            extinto
          </span>
        ) : null}
      </td>
      <td>{celulaAux('ncmnomen', 'descricao', (r as Record<string, unknown>)?.descricao)}</td>
      <td className="whitespace-nowrap text-[10px] text-slate-500">{vigencia || '—'}</td>
      <td className="max-w-[12rem] truncate text-[10px] text-slate-500" title={ato}>
        {textoCurto(ato, 80)}
      </td>
      <td>
        <AcoesAux tipo="ncmnomen" chave={String((r as Record<string, unknown>)?.codigo ?? '')} />
      </td>
    </tr>
  )
}

/* -------------------------------------- referência oficial (somente leitura) --- */

/**
 * Referência oficial CST × cClassTrib (`classificacao-tributaria.json`): é o
 * que o motor cruza com o vínculo para obter reduções, anexo, diferimento e
 * documentos. Somente leitura — atualizada em Configurações → Bases.
 */
function PainelReferenciaOficial() {
  const [linhas, setLinhas] = useState<RegistroAux[]>([])
  const [filtro, setFiltro] = useState('')
  const [pagina, setPagina] = useState(1)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    let vivo = true
    setCarregando(true)
    setErro(null)
    void (async () => {
      try {
        const { db } = await import('@/infrastructure/db/schema')
        if (!db.tables.some((t) => t.name === 'referencia')) {
          if (vivo) {
            setLinhas([])
            setCarregando(false)
          }
          return
        }
        const todas = await db.table('referencia').toArray().catch(() => [])
        if (!vivo) return
        setLinhas(Array.isArray(todas) ? (todas as RegistroAux[]) : [])
        setCarregando(false)
      } catch (e) {
        if (vivo) {
          setErro(e instanceof Error ? e.message : String(e))
          setLinhas([])
          setCarregando(false)
        }
      }
    })()
    return () => {
      vivo = false
    }
  }, [])

  const f = filtro.trim().toLowerCase()
  const filtradas = f
    ? linhas.filter((r) => {
        try {
          const rec = (r ?? {}) as Record<string, unknown>
          return `${String(rec.id ?? '')} ${String(rec.cst ?? '')} ${String(rec.cClassTrib ?? '')} ${String(rec.descricao ?? '')} ${String(rec.anexo ?? '')}`
            .toLowerCase()
            .includes(f)
        } catch {
          return false
        }
      })
    : linhas
  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / PAGE_SIZE))
  const paginaSegura = Math.min(Math.max(1, pagina), totalPaginas)
  const visiveis = filtradas.slice((paginaSegura - 1) * PAGE_SIZE, paginaSegura * PAGE_SIZE)

  return (
    <Painel>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5 dark:border-slate-800">
        <h2 className="flex items-center gap-2 text-base font-bold">
          <span className="text-lg">📚</span> Referência oficial CST × cClassTrib — somente leitura
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {qtdSegura(linhas.length)} combinação(ões) · reduções, anexo e diferimento usados pelo motor
          </span>
          <Texto
            type="search"
            className="field-sm w-64"
            placeholder="Filtrar CST, cClassTrib, anexo…"
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
          Dado oficial (LC 214/2025): cada linha diz a redução de IBS/CBS, o anexo e os flags que o
          motor aplica ao vínculo do NCM. Não é editável aqui — entra via Configurações → Bases.
        </p>
        {erro ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center text-xs text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
            <div className="font-bold">Falha ao ler a referência oficial</div>
            <p className="mt-1">{textoCurto(erro, 200)}</p>
          </div>
        ) : carregando ? (
          <div className="animate-pulse space-y-2" aria-label="Carregando referência oficial">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-10 rounded-xl bg-slate-100 dark:bg-slate-800" />
            ))}
          </div>
        ) : !visiveis.length ? (
          <Vazio
            icone="📚"
            titulo={f ? 'Nenhuma combinação corresponde ao filtro' : 'Referência oficial vazia'}
            texto="Importe a classificação tributária em Configurações → Bases."
          />
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="tbl w-full">
                <thead>
                  <tr>
                    <th>CST</th>
                    <th>cClassTrib</th>
                    <th>Descrição</th>
                    <th>Red. IBS</th>
                    <th>Red. CBS</th>
                    <th>Anexo</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((r, i) => {
                    const rec = (r ?? {}) as Record<string, unknown>
                    return (
                      <tr key={`${String(rec.id ?? i)}-${i}`}>
                        <td className="whitespace-nowrap font-mono font-bold">{textoCurto(rec.cst, 12)}</td>
                        <td className="whitespace-nowrap font-mono">{textoCurto(rec.cClassTrib, 12)}</td>
                        <td className="max-w-md truncate">{textoCurto(rec.descricao, 120)}</td>
                        <td className="whitespace-nowrap font-mono">{textoCurto(rec.pRedIBS ?? '—', 12)}</td>
                        <td className="whitespace-nowrap font-mono">{textoCurto(rec.pRedCBS ?? '—', 12)}</td>
                        <td className="whitespace-nowrap font-mono">{textoCurto(rec.anexo ?? '—', 12)}</td>
                      </tr>
                    )
                  })}
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

/* ------------------------------------------------- NBS (somente leitura) --- */

/** Vínculos NBS (9 dígitos): o motor também classifica serviços por NBS. */
function PainelNbs() {
  const [linhas, setLinhas] = useState<RegistroAux[]>([])
  const [filtro, setFiltro] = useState('')
  const [pagina, setPagina] = useState(1)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    let vivo = true
    setCarregando(true)
    setErro(null)
    void (async () => {
      try {
        const { db } = await import('@/infrastructure/db/schema')
        if (!db.tables.some((t) => t.name === 'nbs')) {
          if (vivo) {
            setLinhas([])
            setCarregando(false)
          }
          return
        }
        const todas = await db.table('nbs').limit(2000).toArray().catch(() => [])
        if (!vivo) return
        setLinhas(Array.isArray(todas) ? (todas as RegistroAux[]) : [])
        setCarregando(false)
      } catch (e) {
        if (vivo) {
          setErro(e instanceof Error ? e.message : String(e))
          setLinhas([])
          setCarregando(false)
        }
      }
    })()
    return () => {
      vivo = false
    }
  }, [])

  const f = filtro.trim().toLowerCase()
  const filtradas = f
    ? linhas.filter((r) => {
        try {
          const rec = (r ?? {}) as Record<string, unknown>
          return `${String(rec.codigo ?? '')} ${String(rec.cst ?? '')} ${String(rec.cClassTrib ?? '')} ${String(rec.descricao ?? '')}`
            .toLowerCase()
            .includes(f)
        } catch {
          return false
        }
      })
    : linhas
  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / PAGE_SIZE))
  const paginaSegura = Math.min(Math.max(1, pagina), totalPaginas)
  const visiveis = filtradas.slice((paginaSegura - 1) * PAGE_SIZE, paginaSegura * PAGE_SIZE)

  return (
    <Painel>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5 dark:border-slate-800">
        <h2 className="flex items-center gap-2 text-base font-bold">
          <span className="text-lg">🧮</span> NBS × Classificação — somente leitura
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {qtdSegura(linhas.length)} vínculo(s) · 9 dígitos
          </span>
          <Texto
            type="search"
            className="field-sm w-64"
            placeholder="Filtrar código, CST ou cClassTrib…"
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
          Vínculos oficiais de serviços (NBS de 9 dígitos). Somente leitura — entram via
          Configurações → Bases junto com os vínculos de NCM. Para classificar, use a{' '}
          <button
            type="button"
            className="font-bold text-brand-700 underline dark:text-aurum-200"
            onClick={() => useUi.getState().trocarView('servicos')}
          >
            Consulta Serviços (NBS)
          </button>
          .
        </p>
        {erro ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center text-xs text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
            <div className="font-bold">Falha ao ler os vínculos NBS</div>
            <p className="mt-1">{textoCurto(erro, 200)}</p>
          </div>
        ) : carregando ? (
          <div className="animate-pulse space-y-2" aria-label="Carregando NBS">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-10 rounded-xl bg-slate-100 dark:bg-slate-800" />
            ))}
          </div>
        ) : !visiveis.length ? (
          <Vazio
            icone="🧮"
            titulo={f ? 'Nenhum NBS corresponde ao filtro' : 'Sem vínculos NBS na base'}
            texto="Importe a base da Reforma em Configurações → Bases."
          />
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="tbl w-full">
                <thead>
                  <tr>
                    <th>NBS</th>
                    <th>CST</th>
                    <th>cClassTrib</th>
                    <th>Descrição</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((r, i) => {
                    const rec = (r ?? {}) as Record<string, unknown>
                    return (
                      <tr key={`${String(rec.id ?? rec.codigo ?? i)}-${i}`}>
                        <td className="whitespace-nowrap font-mono font-bold">
                          {textoCurto(rec.codigo, 16)}
                        </td>
                        <td className="whitespace-nowrap font-mono">{textoCurto(rec.cst, 12)}</td>
                        <td className="whitespace-nowrap font-mono">{textoCurto(rec.cClassTrib, 12)}</td>
                        <td className="max-w-md truncate">{textoCurto(rec.descricao, 140)}</td>
                      </tr>
                    )
                  })}
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

/* ---------------------------------------------------------- auditoria ----- */

/** Log imutável de auditoria (append-only, somente leitura). */
function PainelAuditoria() {
  const [linhas, setLinhas] = useState<RegistroAux[]>([])
  const [filtro, setFiltro] = useState('')
  const [pagina, setPagina] = useState(1)
  const [total, setTotal] = useState(0)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    void (async () => {
      try {
        const { db } = await import('@/infrastructure/db/schema')
        if (!db.tables.some((t) => t.name === 'audit_log')) {
          if (vivo) {
            setTotal(0)
            setLinhas([])
          }
          return
        }
        const n = await db.table('audit_log').count().catch(() => 0)
        if (!vivo) return
        setTotal(n)
        const ultimos = await db
          .table('audit_log')
          .orderBy('id')
          .reverse()
          .limit(200)
          .toArray()
          .catch(() => [])
        if (!vivo) return
        setLinhas((Array.isArray(ultimos) ? ultimos : []) as RegistroAux[])
      } catch (e) {
        if (vivo) {
          setErro(e instanceof Error ? e.message : String(e))
          setLinhas([])
        }
      }
    })()
    return () => {
      vivo = false
    }
  }, [])

  const f = filtro.trim().toLowerCase()
  const filtradas = f
    ? linhas.filter((r) => {
        try {
          const rec = (r ?? {}) as Record<string, unknown>
          return `${String(rec.quando ?? '')} ${String(rec.tabela ?? '')} ${String(rec.chave ?? '')} ${String(rec.operacao ?? '')} ${String(rec.autor ?? '')}`
            .toLowerCase()
            .includes(f)
        } catch {
          return false
        }
      })
    : linhas
  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / PAGE_SIZE))
  const paginaSegura = Math.min(Math.max(1, pagina), totalPaginas)
  const visiveis = filtradas.slice((paginaSegura - 1) * PAGE_SIZE, paginaSegura * PAGE_SIZE)

  const resumo = (v: unknown): string => {
    try {
      if (v == null) return '—'
      const s = typeof v === 'string' ? v : JSON.stringify(v)
      return s.length > 120 ? `${s.slice(0, 120)}…` : s
    } catch {
      return '—'
    }
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
        {erro ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center text-xs text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
            <div className="font-bold">Falha ao ler a auditoria</div>
            <p className="mt-1">{textoCurto(erro, 200)}</p>
          </div>
        ) : !visiveis.length ? (
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
                  {visiveis.map((r, i) => {
                    const rec = (r ?? {}) as Record<string, unknown>
                    return (
                      <tr key={`${String(rec.quando ?? i)}-${i}`}>
                        <td className="whitespace-nowrap font-mono text-[11px]">
                          {textoCurto(String(rec.quando ?? '—').slice(0, 19).replace('T', ' '), 24)}
                        </td>
                        <td className="font-mono text-[11px]">{textoCurto(rec.tabela, 32)}</td>
                        <td className="font-mono text-[11px]">{textoCurto(rec.chave, 48)}</td>
                        <td>
                          <span
                            className={
                              rec.operacao === 'excluir'
                                ? 'pill bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                                : rec.operacao === 'criar'
                                  ? 'pill bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                                  : 'pill bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                            }
                          >
                            {textoCurto(rec.operacao, 16)}
                          </span>
                        </td>
                        <td className="max-w-md truncate font-mono text-[10px] text-slate-500" title={resumo(rec.depois)}>
                          {resumo(rec.antes)} → {resumo(rec.depois)}
                        </td>
                      </tr>
                    )
                  })}
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

/* ----------------------------------------------- tabelas oficiais (CFF) --- */

/**
 * Tabelas oficiais CFF — somente leitura (sem edição/exclusão: dado oficial).
 *
 * - **Anexos por NCM**: busca por NCM mostra os anexos que o citam;
 * - **Produtos por DFe**: catálogo por sistema;
 * - **Crédito presumido / Locais de operação**: tabelas de referência.
 *
 * Tudo com leitura defensiva: store ausente (banco legado), linha sem
 * descrição ou import dinâmico quebrado viram "vazio/zero", nunca exceção.
 */
function TabelasOficiaisCff() {
  const [ncm, setNcm] = useState('')
  const [sistema, setSistema] = useState('NFCom')
  const [anexos, setAnexos] = useState<import('@/domain/entities').AnexoNcm[]>([])
  const [totais, setTotais] = useState({ anexos: 0, produtos: 0, cred: 0, ind: 0 })
  const [produtos, setProdutos] = useState<import('@/domain/entities').ProdutoDfe[]>([])
  const [totalProd, setTotalProd] = useState(0)
  const [cred, setCred] = useState<import('@/domain/entities').CreditoPresumido[]>([])
  const [ind, setInd] = useState<import('@/domain/entities').LocalOperacao[]>([])
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    let vivo = true
    void (async () => {
      try {
        const { db } = await import('@/infrastructure/db/schema')
        const { regrasCreditoPresumido, locaisOperacao } = await import(
          '@/infrastructure/base/info-adicional'
        )
        const contar = async (tabela: string): Promise<number> => {
          try {
            if (!db.tables.some((t) => t.name === tabela)) return 0
            return await db.table(tabela).count().catch(() => 0)
          } catch {
            return 0
          }
        }
        const [tA, tP, c, l] = await Promise.all([
          contar('anexos'),
          contar('produtosDfe'),
          regrasCreditoPresumido().catch(() => []),
          locaisOperacao().catch(() => []),
        ])
        if (!vivo) return
        setTotais({
          anexos: tA,
          produtos: tP,
          cred: Array.isArray(c) ? c.length : 0,
          ind: Array.isArray(l) ? l.length : 0,
        })
        setCred(Array.isArray(c) ? c : [])
        setInd(Array.isArray(l) ? l : [])
        setCarregando(false)
      } catch {
        if (vivo) {
          setCarregando(false)
        }
      }
    })()
    return () => {
      vivo = false
    }
  }, [])

  const buscarAnexos = async (texto: string) => {
    setNcm(texto)
    let cod = ''
    try {
      cod = texto.replace(/\D+/g, '')
    } catch {
      cod = ''
    }
    if (cod.length !== 8) {
      setAnexos([])
      return
    }
    try {
      const { anexosDoNcm } = await import('@/infrastructure/base/info-adicional')
      const lista = await anexosDoNcm(cod).catch(() => [])
      setAnexos(Array.isArray(lista) ? lista : [])
    } catch {
      setAnexos([])
    }
  }

  const carregarSistema = async (s: string) => {
    setSistema(s)
    try {
      const { db } = await import('@/infrastructure/db/schema')
      if (!db.tables.some((t) => t.name === 'produtosDfe')) {
        setProdutos([])
        setTotalProd(0)
        return
      }
      const total = await db.table('produtosDfe').where('sistema').equals(s).count().catch(() => 0)
      setTotalProd(total)
      const lista = await db
        .table<import('@/domain/entities').ProdutoDfe, string>('produtosDfe')
        .where('sistema')
        .equals(s)
        .limit(50)
        .toArray()
        .catch(() => [])
      setProdutos(Array.isArray(lista) ? lista : [])
    } catch {
      setProdutos([])
      setTotalProd(0)
    }
  }

  useEffect(() => {
    void carregarSistema(sistema).catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Painel>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5 dark:border-slate-800">
        <h2 className="flex items-center gap-2 text-base font-bold">
          <span className="text-lg">🏛</span> Tabelas oficiais CFF — somente leitura
        </h2>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          {carregando
            ? 'carregando…'
            : `${qtdSegura(totais.anexos)} anexos · ${qtdSegura(totais.produtos)} produtos · ${qtdSegura(totais.cred)} créd. presumido · ${qtdSegura(totais.ind)} locais operação`}
        </span>
      </div>
      <div className="space-y-4 p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-black">📎 Anexos por NCM</div>
            <Texto
              type="search"
              className="field-sm w-full"
              placeholder="Digite o NCM (8 dígitos)…"
              value={ncm}
              onChange={(e) => void buscarAnexos(e.target.value).catch(() => undefined)}
            />
            {anexos.length ? (
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                {anexos.slice(0, 30).map((a, i) => {
                  const id = (a as { id?: unknown })?.id ?? i
                  const nro = (a as { nroAnexo?: unknown })?.nroAnexo ?? '—'
                  const perm = (a as { permissao?: unknown })?.permissao
                  const cond = (a as { descrCondicao?: unknown })?.descrCondicao
                  return (
                    <li key={String(id)} className="text-[11px] text-slate-600 dark:text-slate-300">
                      <span className="font-mono font-bold">Anexo {String(nro)}</span> ·{' '}
                      <span className={perm === 'negado' ? 'font-bold text-red-600' : 'font-bold text-emerald-700 dark:text-emerald-300'}>
                        {perm === 'negado' ? '⛔ Não permitido' : perm === 'permitido' ? '✓ Permitido' : '—'}
                      </span>
                      {cond ? <span> · {textoCurto(cond, 100)}</span> : null}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="mt-2 text-[11px] text-slate-400">Nenhum anexo para este NCM (ou tabela vazia — importe em Configurações → Bases).</p>
            )}
          </div>
          <div>
            <div className="mb-1 text-xs font-black">🏭 Produtos por DFe</div>
            <select className="field field-sm w-full" value={sistema} onChange={(e) => void carregarSistema(e.target.value).catch(() => undefined)} aria-label="Sistema DFe">
              {['NFCom', 'NFAg', 'NF3e', 'NFGas'].map((s) => (
                <option key={s} value={s}>
                  {s} {s === sistema && totalProd ? `(${qtdSegura(totalProd)})` : ''}
                </option>
              ))}
            </select>
            {produtos.length ? (
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                {produtos.map((p, i) => {
                  const rec = (p ?? {}) as unknown as Record<string, unknown>
                  return (
                    <li key={String(rec.id ?? i)} className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                      <strong>{textoCurto(rec.codClassProd, 16)}</strong> · {textoCurto(rec.descricao, 80)}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="mt-2 text-[11px] text-slate-400">Nenhum produto para {sistema} (importe em Configurações → Bases).</p>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <details className="rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-700">
            <summary className="cursor-pointer text-xs font-bold">💰 Crédito presumido — regras ({Array.isArray(cred) ? cred.length : 0})</summary>
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
              {(Array.isArray(cred) ? cred : []).map((c, i) => {
                const rec = (c ?? {}) as unknown as Record<string, unknown>
                return (
                  <li key={String(rec.cod ?? i)} className="text-[11px] text-slate-600 dark:text-slate-300">
                    <span className="font-mono font-bold">{textoCurto(rec.cod, 12)}</span> · {rec.indIbs ? 'IBS ' : ''}{rec.indCbs ? 'CBS' : ''} — {textoCurto(rec.descricao, 120)}
                  </li>
                )
              })}
            </ul>
          </details>
          <details className="rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-700">
            <summary className="cursor-pointer text-xs font-bold">📍 Locais de operação ({Array.isArray(ind) ? ind.length : 0})</summary>
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
              {(Array.isArray(ind) ? ind : []).map((l, i) => {
                const rec = (l ?? {}) as unknown as Record<string, unknown>
                return (
                  <li key={String(rec.cod ?? i)} className="text-[11px] text-slate-600 dark:text-slate-300">
                    <span className="font-mono font-bold">{textoCurto(rec.cod, 16)}</span> · {textoCurto(rec.nome, 100)}
                  </li>
                )
              })}
            </ul>
          </details>
        </div>
      </div>
    </Painel>
  )
}
