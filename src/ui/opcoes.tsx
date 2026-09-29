/**
 * Selects de **tabelas auxiliares** (CFOP, CST ICMS, PIS/COFINS, …) com
 * atalho “＋” para cadastrar um registro novo sem sair da tela.
 *
 * A lista é lida do cache do `useAuxiliares` e carregada sob demanda —
 * nenhum componente precisa conhecer a store Dexie por trás (Clean Code).
 */
import { useEffect } from 'react'
import { AUX_META, type TipoAux } from '@/application/aux-meta'
import { useAuxiliares, type RegistroAux } from '@/store/auxiliares'
import { abrirEdicaoAux } from '@/modais/globais'
import { Selecao } from './kit'

/** Carrega (uma única vez) e devolve os registros de uma tabela auxiliar. */
export function useOpcoesAux(tipo: TipoAux): RegistroAux[] {
  const cache = useAuxiliares((s) => s.caches[tipo])
  const carregar = useAuxiliares((s) => s.carregar)

  useEffect(() => {
    if (cache === undefined) void carregar(tipo)
  }, [cache, tipo, carregar])

  return cache ?? []
}

const BOTAO_ADD =
  'grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-brand-300 bg-brand-50 ' +
  'text-sm font-bold text-brand-700 transition hover:bg-brand-100 dark:border-aurum-800 ' +
  'dark:bg-brand-950/40 dark:text-brand-300'

/** Select + botão “＋” que abre o cadastro rápido da tabela correspondente. */
export function SelectAux({
  tipo,
  valor,
  onChange,
  rotuloAdicionar,
}: {
  tipo: TipoAux
  valor: string
  onChange: (v: string) => void
  rotuloAdicionar?: string
}) {
  const opcoes = useOpcoesAux(tipo)

  return (
    <div className="flex gap-1.5">
      <Selecao
        className="field-sm field-mono min-w-0 flex-1"
        value={valor ?? ''}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">—</option>
        {opcoes.map((o) => {
          const cod = String(o.codigo ?? '')
          const desc = String(o.descricao ?? '')
          return (
            <option key={cod} value={cod}>
              {cod}
              {desc ? ` — ${desc.slice(0, 70)}` : ''}
            </option>
          )
        })}
      </Selecao>
      <button
        type="button"
        className={BOTAO_ADD}
        title={rotuloAdicionar ?? `Cadastrar novo ${AUX_META[tipo].singular}`}
        onClick={() => abrirEdicaoAux(tipo)}
      >
        ＋
      </button>
    </div>
  )
}
