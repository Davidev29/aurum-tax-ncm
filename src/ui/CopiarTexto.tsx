/**
 * Botão "copiar para a área de transferência" compartilhado.
 * Ícone ✓ por 1,2 s após copiar; stopPropagation para não disparar o card.
 */
import { useEffect, useRef, useState } from 'react'

export function CopiarTexto({
  texto,
  rotulo,
  className,
}: {
  /** Valor copiado (ex.: `0201.10.00`). */
  texto: string
  /** Nome do item (para aria-label: "Copiar NCM 0201.10.00"). */
  rotulo?: string
  className?: string
}) {
  const [copiado, setCopiado] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const copiar = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(texto)
      } else {
        const area = document.createElement('textarea')
        area.value = texto
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        document.execCommand('copy')
        document.body.removeChild(area)
      }
      setCopiado(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopiado(false), 1200)
    } catch {
      /* clipboard bloqueado — silêncio é melhor que ruído */
    }
  }

  return (
    <button
      type="button"
      className={`ncm-copy-btn${copiado ? ' ncm-copy-btn-ok' : ''}${className ? ` ${className}` : ''}`}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        void copiar()
      }}
      aria-label={rotulo ?? `Copiar ${texto}`}
      title={rotulo ?? `Copiar ${texto}`}
    >
      <span aria-hidden="true">{copiado ? '✓' : '⧉'}</span>
    </button>
  )
}
