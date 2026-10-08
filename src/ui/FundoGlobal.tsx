/**
 * Fundo global do app — camada fixa abaixo de tudo (Pexels ou degradê).
 *
 * A sidebar (`z-50`) e o cabeçalho (`z-30`), opacos/translúcidos, ficam por
 * cima; os painéis viram placas de vidro (`.panel` + `.aero-vidro`).
 * Sem chave no código ou offline: degradê local animado, sem rede.
 */
import { useEffect } from 'react'
import { useFundo } from '@/store/fundo'

export function FundoGlobal() {
  const fotos = useFundo((s) => s.fotos)
  const indice = useFundo((s) => s.indice)
  const animar = useFundo((s) => s.animar)
  const intervalo = useFundo((s) => s.intervalo)
  const iniciar = useFundo((s) => s.iniciar)
  const proximo = useFundo((s) => s.proximo)

  useEffect(() => {
    iniciar()
  }, [iniciar])

  // Troca suave no intervalo configurado (tela Aparência; padrão 14 s).
  // Só com 2+ fotos e animação ligada.
  useEffect(() => {
    if (!animar || fotos.length < 2) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const ms = Math.max(5, Math.min(86400, intervalo || 14)) * 1000
    const t = window.setInterval(proximo, ms)
    return () => window.clearInterval(t)
  }, [animar, fotos.length, intervalo, proximo])

  return (
    <div className="aurum-fundo-fixo" aria-hidden="true">
      <div className="pexels-camadas" aria-hidden="true">
        {fotos.length ? (
          fotos.map((f, i) => (
            <img
              key={f.url}
              src={f.url}
              alt=""
              loading={i === 0 ? 'eager' : 'lazy'}
              className={`pexels-foto${i === indice % fotos.length ? ' is-ativa' : ''}${animar ? ' is-animada' : ''}`}
            />
          ))
        ) : (
          <div className={`pexels-degrade${animar ? ' is-animado' : ''}`} />
        )}
        <div className="pexels-veu" />
      </div>
    </div>
  )
}
