/**
 * `DialogoGlass` — confirmações e perguntas em padrão glassmorphism.
 *
 * Montado no `Layout` acima de todos os modais (`z-index` maior que o
 * `.modal-backdrop`). Reaproveita as classes `.modal-backdrop` / `.modal-box`
 * com o modificador `.glass-dialogo`, somando selo em gradiente por tom.
 *
 * Acessibilidade: `role="alertdialog"`, foco automático no botão principal
 * (ou no primeiro campo), `Enter` confirma, `Escape` cancela, rótulos sempre
 * em texto — nunca só cor.
 */
import { useEffect, useState } from 'react'
import { resolverDialogo, useDialogo, type Dialogo } from '@/store/dialogo'
import { Btn, Texto, ehTopoEscapeModal, empilharEscapeModal } from './kit'

export function DialogoGlass() {
  const atual = useDialogo((s) => s.atual)
  const [visivel, setVisivel] = useState(false)
  const [saindo, setSaindo] = useState(false)

  // Entrada/saída suaves: mantém montado ~180 ms após `atual` zerar para a
  // animação de saída terminar (mesmo protocolo do `Modal`).
  useEffect(() => {
    if (atual) {
      setVisivel(true)
      setSaindo(false)
      return
    }
    if (!visivel) return
    setSaindo(true)
    const t = window.setTimeout(() => {
      setVisivel(false)
      setSaindo(false)
    }, 180)
    return () => window.clearTimeout(t)
  }, [atual, visivel])

  if (!visivel) return null
  return (
    <div
      className={`modal-backdrop glass-dialogo${saindo ? ' is-saindo' : ''}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) resolverDialogo(atual?.tipo === 'prompt' ? null : false)
      }}
    >
      <div
        className={`modal-box glass-box max-w-md${saindo ? ' is-saindo' : ''}`}
        role="alertdialog"
        aria-modal="true"
        aria-label={atual?.titulo ?? 'Confirmação'}
      >
        {atual ? <Corpo dialogo={atual} /> : null}
      </div>
    </div>
  )
}

function Corpo({ dialogo }: { dialogo: Dialogo }) {
  const [campos, setCampos] = useState<Record<string, string>>(() =>
    dialogo.tipo === 'prompt'
      ? Object.fromEntries(dialogo.campos.map((c) => [c.nome, c.valorInicial ?? '']))
      : {},
  )

  // Troca de diálogo = formulário novo; foco no primeiro campo (prompt),
  // no Cancelar (confirmação perigosa) ou no botão de confirmação.
  useEffect(() => {
    setCampos(
      dialogo.tipo === 'prompt'
        ? Object.fromEntries(dialogo.campos.map((c) => [c.nome, c.valorInicial ?? '']))
        : {},
    )
    const t = window.setTimeout(() => {
      const seletor =
        dialogo.tipo === 'prompt'
          ? '[data-dialogo-foco="campo"]'
          : dialogo.perigo
            ? '[data-dialogo-foco="cancelar"]'
            : '[data-dialogo-foco="confirmar"]'
      document.querySelector<HTMLElement>(seletor)?.focus()
    }, 60)
    return () => window.clearTimeout(t)
  }, [dialogo])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Com modais empilhados, o diálogo (z-80, topo do Layout) tem
      // precedência: `Escape`/`Enter` não vazam para o modal de baixo.
      if (!ehTopoEscapeModal(onKey)) return
      if (e.key === 'Escape') resolverDialogo(dialogo.tipo === 'prompt' ? null : false)
      if (e.key === 'Enter' && podeConfirmar()) {
        e.preventDefault()
        confirmar()
      }
    }
    window.addEventListener('keydown', onKey)
    const desempilhar = empilharEscapeModal(onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      desempilhar()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogo, campos])

  const podeConfirmar = (): boolean => {
    if (dialogo.tipo !== 'prompt') return true
    return dialogo.campos.every((c) => !c.obrigatorio || campos[c.nome]?.trim())
  }

  const confirmar = (): void => {
    if (!podeConfirmar()) return
    resolverDialogo(dialogo.tipo === 'prompt' ? campos : true)
  }

  return (
    <>
      <div className="flex items-start gap-3 px-5 pb-1 pt-5">
        <span
          aria-hidden
          className={`glass-selo ${dialogo.perigo ? 'glass-selo-danger' : 'glass-selo-info'}`}
        >
          {dialogo.icone}
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-black tracking-tight">{dialogo.titulo}</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            {dialogo.texto}
          </p>
        </div>
      </div>

      {dialogo.tipo === 'prompt' ? (
        <div className="space-y-3 px-5 py-3">
          {dialogo.campos.map((c, i) => (
            <label key={c.nome} className="block">
              <span className="field-label">
                {c.rotulo}
                {c.obrigatorio ? <span className="req">*</span> : null}
              </span>
              <Texto
                data-dialogo-foco={i === 0 ? 'campo' : undefined}
                mono={c.mono}
                value={campos[c.nome] ?? ''}
                placeholder={c.placeholder}
                className="field-sm"
                onChange={(e) => setCampos((f) => ({ ...f, [c.nome]: e.target.value }))}
              />
            </label>
          ))}
        </div>
      ) : (
        <div className="px-5 py-1" />
      )}

      <div className="flex items-center justify-end gap-2 px-5 py-4">
        <Btn
          data-dialogo-foco="cancelar"
          onClick={() => resolverDialogo(dialogo.tipo === 'prompt' ? null : false)}
        >
          Cancelar
        </Btn>
        <Btn
          data-dialogo-foco="confirmar"
          variante={dialogo.perigo ? 'danger' : 'primary'}
          disabled={!podeConfirmar()}
          onClick={confirmar}
        >
          {dialogo.textoConfirmar}
        </Btn>
      </div>
    </>
  )
}
