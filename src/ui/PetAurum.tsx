/**
 * Aurinha — a pet oficial da Aurum Bit, recriada em SVG puro.
 *
 * Ela mora na sidebar, entre o menu e o rodapé: um cantinho só dela, com
 * caminha (elipse de sombra) e balão de fala. Tudo é CSS (só `transform` e
 * `opacity`, GPU-friendly) — nenhum GIF, nenhum PNG, ~6 KB no total.
 *
 * Anatomia do SVG (viewBox 0 0 200 190):
 * - corpinho marrom + barriguinha creme, pezinhos e rabinho de lontra;
 * - óculos redondos verde-petróleo (a marca da detetive fiscal);
 * - lupinha na patinha direita (grupo `.pet-lupa`);
 * - bracinho esquerdo livre (grupo `.pet-tchau`) para o tchauzinho;
 * - olhos kawaii com brilho, bochechas rosadas, sobrancelhas bravas
 *   (só aparecem no `data-mood="angry"`), pálpebras (modo `sleeping`) e
 *   corações/`Zzz` flutuantes via HTML (mais barato que SMIL).
 *
 * Reações (hook `useReacoesDaAurinha`): escuta stores + DOM por delegação,
 * com throttle e MutationObserver só para spinners — sem polling.
 */
import { useEffect, useRef } from 'react'
import { useConsulta } from '@/store/consulta'
import { FRASE_POR_VIEW, fazerCarinho, usePet } from '@/store/pet'
import { useUi } from '@/store/ui'
import './pet-aurum.css'

/** Frases rotativas de leitura — a detetive narrando a investigação. */
const FRASES_LEITURA = ['Farejando NCMs…', 'Lendo a tabelinha…', 'Hmm, deixa eu ver…']
const FRASES_PENSANDO = ['Conferindo na base…', 'Só um farejinho…', 'Calculando…']

function fraseAleatoria(lista: string[]): string {
  return lista[Math.floor(Math.random() * lista.length)]
}

function useReacoesDaAurinha() {
  const agirRef = useRef(usePet.getState().agir)
  agirRef.current = usePet.getState().agir

  // 1) Troca de menu: anda até o destino e dá tchauzinho de boas-vindas.
  useEffect(() => {
    let timer: number | null = null
    const parar = useUi.subscribe((s, anterior) => {
      if (s.view === anterior.view) return
      const agir = agirRef.current
      agir('walking', 'Indo lá…')
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        agirRef.current('waving', FRASE_POR_VIEW[s.view] ?? 'Vamos lá!')
      }, 1500)
    })
    return () => {
      parar()
      if (timer) window.clearTimeout(timer)
    }
  }, [])

  // 2) Toasts: a pet comemora, estranha ou se chateia junto.
  useEffect(() => {
    const parar = useUi.subscribe((s, anterior) => {
      if (s.toasts.length <= anterior.toasts.length) return
      const ultimo = s.toasts[s.toasts.length - 1]
      if (!ultimo) return
      const agir = agirRef.current
      if (ultimo.tipo === 'ok') agir('celebrating', 'Conseguimos!')
      else if (ultimo.tipo === 'err') agir('angry', 'Ops… vamos corrigir?')
      else if (ultimo.tipo === 'warn') agir('curious', 'Opa, olha isso!')
      else agir('happy', 'Anotado!')
    })
    return parar
  }, [])

  // 3) Consulta NCM: pensar → celebrar (achou) ou bravejar (inválido).
  useEffect(() => {
    const parar = useConsulta.subscribe((s, anterior) => {
      const agir = agirRef.current
      const buscando = s.carregando || s.buscandoTexto || s.classificandoDescricao
      const buscava = anterior.carregando || anterior.buscandoTexto || anterior.classificandoDescricao
      if (buscando && !buscava) {
        agir('thinking', fraseAleatoria(FRASES_PENSANDO))
        return
      }
      if (s.avisoInvalido && !anterior.avisoInvalido) {
        agir('angry', 'Hmm, esse NCM tá estranho…')
        return
      }
      if (!buscando && buscava && s.resultados.length > 0) {
        agir('celebrating', 'Achei a classificação!')
      }
    })
    return parar
  }, [])

  // 4) Microinterações via DOM (delegação — 3 listeners no máximo):
  //    foco em campo → lendo · digitando → lendo · clique em botão → felizinho.
  //    5) Soneca por ociosidade (75 s) + despertar com qualquer interação.
  useEffect(() => {
    let ultimoCliqueFeliz = 0
    let timerSoneca: number | null = null

    const adiarSoneca = () => {
      if (timerSoneca) window.clearTimeout(timerSoneca)
      timerSoneca = window.setTimeout(() => {
        const { mood } = usePet.getState()
        if (mood !== 'sleeping') agirRef.current('sleeping', 'Zzz…')
      }, 75_000)
    }
    const acordarSeDormindo = (): boolean => {
      if (usePet.getState().mood === 'sleeping') {
        agirRef.current('waving', 'Voltei! Sentiu saudade?')
        adiarSoneca()
        return true
      }
      return false
    }

    const aoFocar = (e: FocusEvent) => {
      adiarSoneca()
      if (acordarSeDormindo()) return
      const alvo = e.target as HTMLElement | null
      if (!alvo) return
      const tag = alvo.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        const tipo = (alvo as HTMLInputElement).type
        if (tipo === 'checkbox' || tipo === 'radio' || tipo === 'button') return
        if (usePet.getState().mood === 'idle') {
          agirRef.current('reading', fraseAleatoria(FRASES_LEITURA))
        }
      }
    }
    const aoDigitar = (e: Event) => {
      adiarSoneca()
      if (acordarSeDormindo()) return
      const alvo = e.target as HTMLElement | null
      if (!alvo) return
      if (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA') {
        const m = usePet.getState().mood
        if (m === 'idle' || m === 'reading') agirRef.current('reading', fraseAleatoria(FRASES_LEITURA))
      }
    }
    const aoClicar = (e: MouseEvent) => {
      adiarSoneca()
      if (acordarSeDormindo()) return
      const alvo = e.target as HTMLElement | null
      const botao = alvo?.closest?.('button, a, [role="button"]')
      if (!botao) return
      // Exportações merecem festa maior.
      const texto = (botao.textContent ?? '').toLowerCase()
      if (/pdf|excel|exportar|relat.r/.test(texto)) {
        agirRef.current('celebrating', 'Relatório prontinho!')
        return
      }
      const agora = Date.now()
      if (agora - ultimoCliqueFeliz < 4000) return
      ultimoCliqueFeliz = agora
      const m = usePet.getState().mood
      if (m === 'idle' || m === 'happy') agirRef.current('happy', '')
    }
    const aoTeclar = () => {
      adiarSoneca()
      acordarSeDormindo()
    }

    adiarSoneca()
    document.addEventListener('focusin', aoFocar)
    document.addEventListener('input', aoDigitar, { capture: true })
    document.addEventListener('click', aoClicar)
    document.addEventListener('keydown', aoTeclar)
    document.addEventListener('pointermove', adiarSoneca, { passive: true })
    return () => {
      if (timerSoneca) window.clearTimeout(timerSoneca)
      document.removeEventListener('focusin', aoFocar)
      document.removeEventListener('input', aoDigitar, { capture: true } as EventListenerOptions)
      document.removeEventListener('click', aoClicar)
      document.removeEventListener('keydown', aoTeclar)
      document.removeEventListener('pointermove', adiarSoneca)
    }
  }, [])

  // 6) Loading genérico: se um spinner/barra de progresso aparecer no DOM,
  //    a pet pensa junto (MutationObserver, sem polling).
  useEffect(() => {
    let timer: number | null = null
    const obs = new MutationObserver(() => {
      const carregando = document.querySelector('.btn-spinner, .loading-bar')
      if (carregando && usePet.getState().mood === 'idle') {
        agirRef.current('thinking', fraseAleatoria(FRASES_PENSANDO))
        if (timer) window.clearTimeout(timer)
        timer = window.setTimeout(() => {
          if (usePet.getState().mood === 'thinking') usePet.getState().aquietar()
        }, 5200)
      }
    })
    obs.observe(document.body, { childList: true, subtree: true })
    return () => {
      obs.disconnect()
      if (timer) window.clearTimeout(timer)
    }
  }, [])
}

export function PetAurum({ recolhida = false }: { recolhida?: boolean }) {
  const mood = usePet((s) => s.mood)
  const frase = usePet((s) => s.frase)
  const seq = usePet((s) => s.seq)
  useReacoesDaAurinha()

  return (
    <div
      className="pet-aurum"
      data-mood={mood}
      data-recolhida={recolhida}
      // `seq` como key do balão: a mesma frase repetida re-dispara o pop.
      key={undefined}
    >
      {!recolhida && frase ? (
        <div key={seq} className="pet-balao" role="status" aria-live="polite">
          {frase}
        </div>
      ) : null}

      <button
        type="button"
        className="pet-palco"
        onClick={fazerCarinho}
        title="Aurinha, a pet da Aurum Bit — clique para fazer carinho"
        aria-label="Aurinha, a pet da Aurum Bit. Clique para fazer carinho."
      >
        {/* Caminha */}
        <svg className="pet-svg" viewBox="0 0 200 190" role="img" aria-hidden="true">
          <ellipse className="pet-sombra" cx="100" cy="172" rx="62" ry="10" />
          {/* Rabinho */}
          <path
            className="pet-rabo"
            d="M150 138 Q178 132 184 108 Q186 100 180 102 Q168 106 158 118 Z"
            fill="#7c4a2d"
            stroke="#2b1a12"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          {/* Corpinho */}
          <ellipse cx="100" cy="122" rx="52" ry="48" fill="#9a6742" stroke="#2b1a12" strokeWidth="3.5" />
          {/* Barriguinha */}
          <ellipse className="pet-barriga" cx="100" cy="134" rx="30" ry="32" fill="#fbeed3" />
          {/* Orelhinhas */}
          <circle cx="52" cy="58" r="10" fill="#9a6742" stroke="#2b1a12" strokeWidth="3" />
          <circle cx="52" cy="58" r="4" fill="#6e4023" />
          <circle cx="148" cy="58" r="10" fill="#9a6742" stroke="#2b1a12" strokeWidth="3" />
          <circle cx="148" cy="58" r="4" fill="#6e4023" />
          {/* Cabecinha */}
          <circle cx="100" cy="82" r="52" fill="#9a6742" stroke="#2b1a12" strokeWidth="3.5" />
          {/* Focinho creme */}
          <ellipse cx="100" cy="102" rx="40" ry="26" fill="#fbeed3" />
          {/* Bochechas */}
          <ellipse className="pet-blush" cx="66" cy="102" rx="9" ry="6" fill="#f0a3a3" opacity="0.85" />
          <ellipse className="pet-blush" cx="134" cy="102" rx="9" ry="6" fill="#f0a3a3" opacity="0.85" />
          {/* Olhos */}
          <g className="pet-olhos">
            <ellipse cx="80" cy="82" rx="9" ry="11" fill="#fff" stroke="#2b1a12" strokeWidth="2.5" />
            <ellipse cx="120" cy="82" rx="9" ry="11" fill="#fff" stroke="#2b1a12" strokeWidth="2.5" />
            <g className="pet-pupilas">
              <circle cx="81" cy="84" r="5" fill="#1e2f4d" />
              <circle cx="121" cy="84" r="5" fill="#1e2f4d" />
              <circle cx="83" cy="82" r="1.8" fill="#fff" />
              <circle cx="123" cy="82" r="1.8" fill="#fff" />
            </g>
          </g>
          {/* Pálpebras (soneca) */}
          <g className="pet-palpebras" opacity="0">
            <path d="M71 82 Q80 88 89 82" stroke="#2b1a12" strokeWidth="3" fill="none" strokeLinecap="round" />
            <path d="M111 82 Q120 88 129 82" stroke="#2b1a12" strokeWidth="3" fill="none" strokeLinecap="round" />
          </g>
          {/* Sobrancelhas bravas */}
          <g className="pet-bravas" opacity="0">
            <path d="M70 66 L90 71" stroke="#2b1a12" strokeWidth="4" strokeLinecap="round" />
            <path d="M130 66 L110 71" stroke="#2b1a12" strokeWidth="4" strokeLinecap="round" />
          </g>
          {/* Nariz + boquinha */}
          <ellipse cx="100" cy="96" rx="7" ry="5" fill="#5b3a26" stroke="#2b1a12" strokeWidth="2" />
          <path
            className="pet-boca"
            d="M100 101 Q100 107 92 108 M100 101 Q100 107 108 108"
            stroke="#2b1a12"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
          />
          <path
            className="pet-boca-brava"
            d="M90 110 Q100 106 110 110"
            stroke="#2b1a12"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
            opacity="0"
          />
          {/* Óculos redondos verde-petróleo */}
          <g className="pet-oculos" fill="none" stroke="#1fa3a3" strokeWidth="5">
            <circle cx="80" cy="82" r="17" />
            <circle cx="120" cy="82" r="17" />
            <path d="M97 82 L103 82" strokeWidth="5" />
            <path d="M63 80 L52 76" strokeWidth="5" strokeLinecap="round" />
            <path d="M137 80 L148 76" strokeWidth="5" strokeLinecap="round" />
          </g>
          <g className="pet-brilho-oculos" fill="#fff" opacity="0.7">
            <circle cx="74" cy="76" r="2.4" />
            <circle cx="114" cy="76" r="2.4" />
          </g>
          {/* Bracinho esquerdo (tchau) */}
          <g className="pet-tchau">
            <ellipse cx="52" cy="128" rx="12" ry="16" fill="#8a5a38" stroke="#2b1a12" strokeWidth="3" />
            <circle cx="52" cy="112" r="7" fill="#fbeed3" stroke="#2b1a12" strokeWidth="2.5" />
          </g>
          {/* Lupinha na patinha direita */}
          <g className="pet-lupa">
            <ellipse cx="148" cy="128" rx="12" ry="16" fill="#8a5a38" stroke="#2b1a12" strokeWidth="3" />
            <circle cx="156" cy="108" r="16" fill="#bfe9ef" stroke="#5b6b7a" strokeWidth="4" />
            <circle cx="151" cy="103" r="5" fill="#fff" opacity="0.8" />
            <rect x="150" y="122" width="7" height="20" rx="3.5" fill="#3c4450" stroke="#2b1a12" strokeWidth="2" transform="rotate(-18 153 132)" />
          </g>
          {/* Pezinhos */}
          <ellipse cx="78" cy="164" rx="13" ry="9" fill="#6e4023" stroke="#2b1a12" strokeWidth="3" />
          <ellipse cx="122" cy="164" rx="13" ry="9" fill="#6e4023" stroke="#2b1a12" strokeWidth="3" />
        </svg>

        {/* Fofurinhas flutuantes por humor */}
        <span className="pet-fx pet-zzz" aria-hidden="true">
          <span>z</span>
          <span>Z</span>
          <span>z</span>
        </span>
        <span className="pet-fx pet-coracoes" aria-hidden="true">
          <span>♥</span>
          <span>♥</span>
          <span>♥</span>
        </span>
        <span className="pet-fx pet-confete" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </span>
      </button>

      {!recolhida ? (
        <div className="pet-nome" aria-hidden="true">
          <span className="pet-nome-ponto" />
          Aurinha · pet oficial
        </div>
      ) : null}
    </div>
  )
}
