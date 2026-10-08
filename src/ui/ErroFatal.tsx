/**
 * Barreira fatal de renderização — espelha o `LimiteErro` de Auxiliares.
 *
 * Um throw na renderização vira um cartão de falha com **Tentar novamente**
 * (reset do estado) + **Recarregar** (reload da janela) em vez de tela em
 * branco. Uso:
 * - `main.tsx`: um `ErroFatal nome="global"` em volta do `App`;
 * - `App.tsx`: um `ErroFatal key={view}` por view (o `key` reseta a barreira
 *   a cada troca de tela).
 */
import { Component, type ReactNode } from 'react'
import { Btn, Painel } from './kit'

export function SkeletonPagina() {
  return (
    <div role="status" aria-label="Carregando tela…" aria-busy="true" className="mx-auto w-full max-w-[1400px] space-y-3">
      <div className="skeleton h-8 w-64" aria-hidden="true" />
      <div className="skeleton h-4 w-96" aria-hidden="true" />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="skeleton h-40" aria-hidden="true" />
        <div className="skeleton h-40" aria-hidden="true" />
        <div className="skeleton h-40" aria-hidden="true" />
      </div>
      <span className="sr-only">Carregando tela…</span>
    </div>
  )
}

function textoCurto(s: string, teto: number): string {
  return s.length > teto ? `${s.slice(0, teto)}…` : s
}

export class ErroFatal extends Component<{ nome?: string; children: ReactNode }, { falha: string | null }> {
  state = { falha: null as string | null }

  static getDerivedStateFromError(e: unknown): { falha: string | null } {
    return { falha: e instanceof Error ? e.message : String(e) }
  }

  componentDidCatch(e: unknown): void {
    try {
      console.error(`[erro-fatal:${this.props.nome ?? 'app'}]`, e)
    } catch {
      /* console indisponível: ignora */
    }
  }

  render(): ReactNode {
    if (this.state.falha) {
      return (
        <div className="mx-auto w-full max-w-[1400px] px-4 py-10 sm:px-6">
          <Painel>
            <div className="p-6 text-center">
              <div className="text-2xl" aria-hidden="true">⚠️</div>
              <div className="mt-2 text-sm font-bold">Algo deu errado nesta tela</div>
              <p className="mx-auto mt-1 max-w-md text-[11px] text-slate-500 dark:text-slate-400">
                {textoCurto(this.state.falha, 220)} Seus dados estão preservados — nada foi apagado.
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <Btn variante="primary" tam="sm" onClick={() => this.setState({ falha: null })}>
                  Tentar novamente
                </Btn>
                <Btn tam="sm" onClick={() => window.location.reload()}>
                  Recarregar
                </Btn>
              </div>
            </div>
          </Painel>
        </div>
      )
    }
    return this.props.children
  }
}
