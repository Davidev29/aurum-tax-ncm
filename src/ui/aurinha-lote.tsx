/**
 * Aurinha em modo "pesquisa de lote" — loading elegante da Classificação em lote.
 *
 * A lâmpada de conclusão mora NO PET da sidebar (`pet-lampada` em
 * `pet-aurum.css`, via `data-eureka`): aqui fica só o "lendo" — anel-spinner
 * dourado girando + Aurinha lendo um livro com página virando em loop +
 * frase por faixa de progresso. Sem assets externos (100% CSS/SVG inline).
 *
 * Acessibilidade: root `role="status"` + `aria-live="polite"`.
 * Movimento: só transform/opacity; `prefers-reduced-motion` congela tudo.
 */
const FRASE_POR_PROGRESSO: { ate: number; frase: string }[] = [
  { ate: 40, frase: 'Lendo planilha…' },
  { ate: 75, frase: 'Resolvendo NCMs na base oficial…' },
  { ate: 101, frase: 'Aurinha analisando nome × tributação…' },
]

function frasePara(progresso: number): string {
  return FRASE_POR_PROGRESSO.find((f) => progresso < f.ate)?.frase ?? 'Analisando…'
}

/** Aurinha pixel-art simplificada (lontra detetive: touca, óculos, focinho). */
function AurinhaMini() {
  return (
    <svg className="aurinha-lote-sprite" viewBox="0 0 32 30" aria-hidden="true" focusable="false">
      {/* orelhas */}
      <rect x="7" y="1" width="3" height="3" fill="#241610" />
      <rect x="22" y="1" width="3" height="3" fill="#241610" />
      <rect x="8" y="2" width="1" height="1" fill="#e8938a" />
      <rect x="23" y="2" width="1" height="1" fill="#e8938a" />
      {/* cabeça */}
      <rect x="6" y="3" width="20" height="14" rx="4" fill="#a8703f" />
      <rect x="6" y="3" width="20" height="4" rx="2" fill="#7c4a2d" />
      {/* óculos */}
      <rect x="8" y="7" width="7" height="6" rx="3" fill="#22a8a8" />
      <rect x="17" y="7" width="7" height="6" rx="3" fill="#22a8a8" />
      <rect x="9" y="8" width="5" height="4" rx="2" fill="#fff" />
      <rect x="18" y="8" width="5" height="4" rx="2" fill="#fff" />
      <rect x="11" y="9" width="2" height="3" rx="1" fill="#22344d" />
      <rect x="20" y="9" width="2" height="3" rx="1" fill="#22344d" />
      <rect x="15" y="9" width="2" height="1" fill="#22a8a8" />
      {/* focinho */}
      <rect x="11" y="13" width="10" height="4" rx="2" fill="#fbeed3" />
      <rect x="15" y="14" width="2" height="1" fill="#5b3a26" />
      {/* corpo */}
      <rect x="10" y="17" width="12" height="9" rx="3" fill="#a8703f" />
      <rect x="13" y="18" width="6" height="7" rx="2" fill="#fbeed3" />
      {/* selo ouro */}
      <rect x="15" y="20" width="2" height="2" fill="#d2a94e" transform="rotate(45 16 21)" />
    </svg>
  )
}

export function AurinhaLote({
  progresso,
  frase,
}: {
  progresso: number
  frase?: string
}) {
  const pct = Math.max(0, Math.min(100, Math.round(progresso)))
  const texto = frase ?? frasePara(pct)
  return (
    <div
      className="aurinha-lote aurinha-lote--lendo"
      data-estado="lendo"
      role="status"
      aria-live="polite"
      aria-label={`Classificando em lote: ${pct}%. ${texto}`}
    >
      <div className="aurinha-lote-cena" aria-hidden="true">
        <span className="aurinha-lote-anel" />
        <AurinhaMini />
        <span className="aurinha-lote-livro">
          <span className="aurinha-lote-livro-esq" />
          <span className="aurinha-lote-livro-pagina" />
          <span className="aurinha-lote-livro-dir" />
        </span>
      </div>
      <div className="aurinha-lote-texto">
        <span className="aurinha-lote-frase">{texto}</span>
        <span className="aurinha-lote-pct num">{`${pct}%`}</span>
      </div>
    </div>
  )
}
