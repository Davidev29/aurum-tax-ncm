/**
 * Marca do sistema — escudo + wordmark a partir dos arquivos de `public/`.
 *
 * `icone.png` (só o escudo dourado) funciona nos dois temas porque vive
 * dentro da moldura marinho+anel-ouro (`.logo-frame`). A `logomarca.png`
 * completa (escudo + "AURUM TAX NCM" em marinho) só é usada sobre fundo
 * claro, onde o texto marinho tem contraste.
 */
export function EscudoAurum({ tamanho = 44 }: { tamanho?: number }) {
  // Escudo puro, sem moldura: a arte em ouro vive direto no fundo do sidebar
  // (a sombra suave é só para dar relevo, sem caixa nem borda).
  const largura = Math.round(tamanho * 0.59)
  return (
    <img
      src="escudo.png"
      alt="Escudo Aurum Tax NCM"
      width={largura}
      height={tamanho}
      className="escudo-aurum"
    />
  )
}

/** Cabeçalho da barra lateral: escudo + wordmark.
 *
 * Recolhido, renderiza literalmente só o escudo (sem `.marca-texto` no DOM —
 * nada para "sumir" com fade). O nome só existe quando o menu está aberto.
 * Alinhamento sempre à esquerda (`justify-start` + `.marca-caixa`), nos dois
 * estados, para acompanhar o hambúrguer e os ícones do menu. */
export function MarcaSidebar({ expandida = true }: { expandida?: boolean }) {
  return (
    <div className="marca-caixa flex w-full min-w-0 items-center justify-start gap-3 text-left">
      <EscudoAurum tamanho={expandida ? 60 : 56} />
      {expandida ? (
        <div className="marca-texto flex min-w-0 flex-col justify-center leading-tight">
          <div className="marca-nome truncate">AURUM</div>
          <div className="marca-sub truncate">TAX · NCM</div>
          <div className="marca-filete mt-1 w-full" aria-hidden="true" />
        </div>
      ) : null}
    </div>
  )
}

/**
 * Logomarca completa (escudo + lettering oficial) para superfícies claras:
 * splash de relatórios, "Sobre" e pré-visualizações claras.
 */
export function LogomarcaClara({ className = 'h-14 w-auto' }: { className?: string }) {
  return <img src="logomarca-cheia.png" alt="Aurum Tax NCM" className={className} />
}
