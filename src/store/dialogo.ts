/**
 * Diálogos de confirmação e pergunta — substitutos dos `window.confirm` /
 * `window.prompt` nativos (SPEC §10: nenhuma primitiva de navegador).
 *
 * API por promessa, utilizável de componentes **e** de stores:
 *
 * ```ts
 * if (!(await confirmar('Excluir produto', '...'))) return
 * const r = await perguntar('Novo produto', '...', [{ nome: 'sku', rotulo: 'SKU' }])
 * if (!r) return // cancelado
 * ```
 *
 * A renderização vive em `DialogoGlass` (`src/ui/dialogos.tsx`), montado no
 * `Layout` acima de todos os modais.
 */
import { create } from 'zustand'

export interface CampoDialogo {
  nome: string
  rotulo: string
  valorInicial?: string
  placeholder?: string
  /** Fonte monoespaçada (SKU, NCM, valores). */
  mono?: boolean
  /** Bloqueia a confirmação enquanto estiver vazio. */
  obrigatorio?: boolean
}

interface BaseDialogo {
  id: number
  /** Emoji do selo (ex.: '🗑', '⚠', '❓'). Texto + ícone: nunca só cor. */
  icone: string
  titulo: string
  texto: string
  textoConfirmar: string
  /** Tom vermelho no selo e no botão de confirmação. */
  perigo: boolean
}

export interface DialogoConfirm extends BaseDialogo {
  tipo: 'confirm'
}

export interface DialogoPrompt extends BaseDialogo {
  tipo: 'prompt'
  campos: CampoDialogo[]
}

export type Dialogo = DialogoConfirm | DialogoPrompt

interface OpcoesDialogo {
  /** Emoji do selo. */
  icone?: string
  /** Rótulo do botão de confirmação. */
  confirmar?: string
  /** Tom de perigo (vermelho). */
  perigo?: boolean
}

interface DialogoState {
  atual: Dialogo | null
  confirmar: (titulo: string, texto: string, opts?: OpcoesDialogo) => Promise<boolean>
  perguntar: (
    titulo: string,
    texto: string,
    campos: CampoDialogo[],
    opts?: OpcoesDialogo,
  ) => Promise<Record<string, string> | null>
}

let seq = 0
let resolverConfirm: ((v: boolean) => void) | null = null
let resolverPrompt: ((v: Record<string, string> | null) => void) | null = null

function encerrar(): void {
  resolverConfirm = null
  resolverPrompt = null
  useDialogo.setState({ atual: null })
}

export const useDialogo = create<DialogoState>((set) => ({
  atual: null,

  confirmar: (titulo, texto, opts) =>
    new Promise<boolean>((resolve) => {
      resolverConfirm = resolve
      set({
        atual: {
          id: ++seq,
          tipo: 'confirm',
          icone: opts?.icone ?? '❓',
          titulo,
          texto,
          textoConfirmar: opts?.confirmar ?? 'Confirmar',
          perigo: opts?.perigo ?? false,
        },
      })
    }),

  perguntar: (titulo, texto, campos, opts) =>
    new Promise<Record<string, string> | null>((resolve) => {
      resolverPrompt = resolve
      set({
        atual: {
          id: ++seq,
          tipo: 'prompt',
          icone: opts?.icone ?? '✏️',
          titulo,
          texto,
          textoConfirmar: opts?.confirmar ?? 'Confirmar',
          perigo: opts?.perigo ?? false,
          campos,
        },
      })
    }),
}))

/** Atalhos fora de componentes React (stores, serviços). */
export const confirmar = (
  titulo: string,
  texto: string,
  opts?: OpcoesDialogo,
): Promise<boolean> => useDialogo.getState().confirmar(titulo, texto, opts)

export const perguntar = (
  titulo: string,
  texto: string,
  campos: CampoDialogo[],
  opts?: OpcoesDialogo,
): Promise<Record<string, string> | null> =>
  useDialogo.getState().perguntar(titulo, texto, campos, opts)

/** Resolve o diálogo ativo (chamado pelo `DialogoGlass`). */
export function resolverDialogo(valor: boolean | Record<string, string> | null): void {
  if (typeof valor === 'boolean') resolverConfirm?.(valor)
  else resolverPrompt?.(valor)
  encerrar()
}
