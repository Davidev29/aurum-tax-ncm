/**
 * Marca do sistema — escudo + wordmark a partir dos arquivos de `public/`.
 *
 * `icone.png` (só o escudo dourado) funciona nos dois temas porque vive
 * dentro da moldura marinho+anel-ouro (`.logo-frame`). A `logomarca.png`
 * completa (escudo + "AURUM TAX NCM" em marinho) só é usada sobre fundo
 * claro, onde o texto marinho tem contraste.
 */
export function EscudoAurum({ tamanho = 68 }: { tamanho?: number }) {
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

/** Cabeçalho da barra lateral: escudo + wordmark HTML (tema-agnóstico). */
export function MarcaSidebar() {
  return (
    // `items-stretch` + `justify-center`: o bloco de texto herda a altura do
    // escudo e centraliza nela — imagem e texto sempre alinhados.
    <div className="flex w-full min-w-0 items-stretch justify-center gap-3">
      <EscudoAurum tamanho={104} />
      <div className="flex min-w-0 flex-col justify-center leading-tight">
        <div className="marca-nome truncate text-[26px]">AURUM</div>
        <div className="marca-sub truncate text-[13px]">TAX · NCM</div>
        <div className="marca-filete mt-1.5 w-full" aria-hidden="true" />
      </div>
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
