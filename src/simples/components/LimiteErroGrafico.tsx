/**
 * Simples Nacional — contenção de falha dos gráficos na tela de resultado.
 */
import { Component, type ReactNode } from 'react'

/** Contenção de falha dos gráficos: nunca derruba a tela de resultado. */
class LimiteErroGrafico extends Component<{ children: ReactNode }, { falhou: boolean }> {
  state = { falhou: false };
  static getDerivedStateFromError(): { falhou: boolean } {
    return { falhou: true };
  }
  render() {
    if (this.state.falhou) {
      return (
        <p className="rounded-2xl border border-[var(--line)] bg-white px-4 py-6 text-center text-[13px] text-slate-600 dark:bg-slate-900">
          Gráficos indisponíveis neste momento — os valores acima seguem válidos.
        </p>
      );
    }
    return this.props.children;
  }
}

export { LimiteErroGrafico }
