/** Destaca (âmbar) as palavras da consulta que aparecem no texto, insensível a acento/caixa. */
import { normalizarBusca, tokensRelevantes } from '@/domain/services/busca-texto'

export function Destacar({ texto, termo }: { texto: string; termo: string }) {
  const tokens = tokensRelevantes(termo)
  if (!tokens.length) return <>{texto}</>
  const palavras = texto.split(/(\s+)/)
  return (
    <>
      {palavras.map((p, i) => {
        if (!p.trim()) return <span key={i}>{p}</span>
        const np = normalizarBusca(p)
        const hit = np.length >= 2 && tokens.some((t) => np.includes(t))
        return hit ? (
          <mark
            key={i}
            className="rounded bg-amber-200/70 px-0.5 text-inherit dark:bg-amber-500/30"
          >
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        )
      })}
    </>
  )
}
