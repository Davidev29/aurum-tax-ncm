/**
 * Aurinha — pet oficial da Aurum Bit (pixel-art 26×29).
 *
 * ARQUITETURA DO VOO (separada, testável, sem acoplamento):
 * - `useVoo` hook: lógica imperativa pura, roda em requestAnimationFrame
 *   sem React state no loop quente. Expõe refs para portal/sombra.
 * - React só monta/desmonta o portal; callbacks disparam transições de fase.
 *
 * CORREÇÕES APLICADAS:
 * 1. Zero re-renders no drag: portal/sombra são refs atualizadas via DOM direto
 * 2. Pet gruda no cursor com glide: loop rAF interpola render→alvo centrado
 *    (mouse +4px, toque +30px), sem salto de pickup; tilt/stretch pelo vetor
 *    velocidade suavizada + flutuação viva
 * 3. Superman pose: overlay de braços esticados no voo/retorno
 * 4. Retorno em dois tempos (planeio até acima da doca + descida vertical
 *    lenta, nunca por baixo) com freio de copa, alvo na doca viva,
 *    assentamento squash & stretch de 260ms e nuvem de poeira no toque
 * 5. Clique simples preservado (carinho); arrasto suprime o click fantasma
 * 6. Transições de fase limpas: limpar() zera tudo e força doca
 */
import { useEffect, useRef, useState, useCallback, memo } from 'react'
import { createPortal } from 'react-dom'
import { useCalculadora } from '@/store/calculadora'
import { useConsulta } from '@/store/consulta'
import { useServicos } from '@/store/consulta-servicos'
import { FRASE_POR_VIEW, FRASES_CALCULANDO, FRASES_PESQUISANDO, fazerCarinho, usePet } from '@/store/pet'
import {
  sortearAmbiente,
  sortearIntervaloAmbiente,
  sortearTagarelice,
  fraseAusencia,
  fraseRetorno,
} from '@/store/pet-ambiente'
import {
  alturaPulo,
  duracaoPulo,
  escolherAlvo,
  intervaloPuloAleatorio,
  limitesPasseio,
  pausaEntreViagens,
  podePular,
  podeVagar,
  velocidadePasseio,
  acelerarPara,
  aplicarAtrito,
  inclinacaoPorVelocidade,
  squashPorVelocidade,
  posicaoPulo,
  rajadaVento,
  pedirViagemLonga,
  consumirViagemLonga,
  alvoBorda,
  AMBIENTES_VIAGEM_LONGA,
  podeConsultar,
  ACELERACAO_PASSEIO,
  ATRITO_PARADA,
  VEL_MAX_PASSEIO,
} from '@/store/pet-locomocao'
import {
  fraseFarejando,
  fraseNcmInvalido,
  fraseResultadoBusca,
  resumirTermo,
} from '@/store/pet-farejo'
import {
  sortearFalaHora,
  sortearHumorFalaHora,
  sortearIntervaloFalaHora,
} from '@/store/pet-falas-hora'
import { registrarEventoPet, saudacaoInicialPet } from '@/store/pet-ia'
import { useDirecaoIADaAurinha } from '@/store/pet-direcao-ia'
import { useUi } from '@/store/ui'
import {
  CABECA,
  CORPO,
  LOUPE,
  LOUPE_POS,
  OVERLAYS,
  PALETA,
  type Bloco,
} from './pet-sprite'
import './pet-aurum.css'

/* ------------------------------- frases / util ------------------------------- */
const FRASES_LEITURA = ['Farejando NCMs…', 'Lendo a tabelinha…', 'Hmm, deixa eu ver…']
const FRASES_PENSANDO = ['Conferindo na base…', 'Só um farejinho…', 'Calculando…']
function fraseAleatoria(lista: string[]) { return lista[Math.floor(Math.random() * lista.length)] }

/* ----------------------------------- pixels ---------------------------------- */
function Px({ linhas, ox = 0, oy = 0, className }: {
  linhas: string[]; ox?: number; oy?: number; className?: string
}) {
  const els: React.ReactNode[] = []
  linhas.forEach((linha, dy) => {
    ;[...linha].forEach((ch, dx) => {
      if (ch === '.' || ch === ' ') return
      const cor = PALETA[ch]; if (!cor) return
      els.push(<rect key={`${dy}-${dx}`} x={ox + dx} y={oy + dy} width={1.04} height={1.04} fill={cor} opacity={ch === 'S' ? 0.18 : 1} />)
    })
  })
  return <g className={className} shapeRendering="crispEdges">{els}</g>
}
function Blocos({ lista, className }: { lista: Bloco[]; className?: string }) {
  return <g className={className} shapeRendering="crispEdges">
    {lista.map(([x, y, w, h, ch], i) => <rect key={i} x={x} y={y} width={w * 1.04} height={h * 1.04} fill={PALETA[ch] ?? '#000'} />)}
  </g>
}

/** Boneco puro (usado na doca e no portal de voo). Memoizado: o SVG tem
 * centenas de rects e não depende de humor/frase — sem memo, cada tecla
 * digitada (que antes dava `set` no pet) reconstruía tudo no meio do input. */
const PetCorpoMemo = memo(function PetCorpo({ modoVoo = false }: { modoVoo?: boolean }) {
  return (
    <>
      <svg className="pet-svg" viewBox="0 0 26 29" role="img" aria-hidden="true">
        <g className="pet-px-corpo"><Px linhas={CORPO} oy={16} /></g>
        <g className="pet-px-pes-a"><Blocos lista={OVERLAYS.PES_A} /></g>
        <g className="pet-px-pes-b"><Blocos lista={OVERLAYS.PES_B} /></g>
        <g className="pet-px-rabo"><Blocos lista={OVERLAYS.RABO} /></g>
        {/* Braços: no voo usa pose superman (estendidos), senão pose normal */}
        {modoVoo ? (
          <>
            <g className="pet-px-braco-superman-e"><Blocos lista={OVERLAYS.BRACO_SUPERMAN_E} /></g>
            <g className="pet-px-braco-superman-d"><Blocos lista={OVERLAYS.BRACO_SUPERMAN_D} /></g>
          </>
        ) : (
          <>
            <g className="pet-px-braco-baixo"><Blocos lista={OVERLAYS.BRACO_BAIXO_E} /></g>
            <g className="pet-px-braco-alto"><Blocos lista={OVERLAYS.BRACO_ALTO_E} /></g>
            <g className="pet-px-braco-gaveta"><Blocos lista={OVERLAYS.BRACO_GAVETA} /></g>
            <g className="pet-px-braco-dir"><Blocos lista={OVERLAYS.BRACO_DIR} /></g>
          </>
        )}
        <g className="pet-px-lupa">
          <g transform={`translate(${LOUPE_POS.x} ${LOUPE_POS.y})`}>
            <g className="pet-px-lupa-giro"><Px linhas={LOUPE} /></g>
          </g>
        </g>
        <g className="pet-px-cabeca"><Px linhas={CABECA} /></g>
        <g className="pet-px-lids"><Blocos lista={OVERLAYS.PALPEBRAS} /></g>
        <g className="pet-px-bravas"><Blocos lista={OVERLAYS.SOBRANCELHAS} /></g>
        <g className="pet-px-boca-brava"><Blocos lista={OVERLAYS.BOCA_BRAVA} /></g>
        <g className="pet-px-boca-aberta"><Blocos lista={OVERLAYS.BOCA_ABERTA} /></g>
      </svg>
      <span className="pet-fx pet-zzz" aria-hidden="true"><span>z</span><span>Z</span><span>z</span></span>
      <span className="pet-fx pet-coracoes" aria-hidden="true"><span>♥</span><span>♥</span><span>♥</span></span>
      <span className="pet-fx pet-confete" aria-hidden="true"><span /><span /><span /><span /><span /></span>
      {/* Lâmpada de ideia (eureka do lote): overlay ao lado direito da cabeça,
          dentro do .pet-salto — herda o pulo/squash sem brigar com o X da
          locomoção. Acende via [data-eureka='true'] no .pet-aurum. */}
      <span className="pet-fx pet-lampada" aria-hidden="true">
        <span className="pet-lampada-haste" />
        <span className="pet-lampada-cupula" />
        <span className="pet-lampada-bulbo" />
        <span className="pet-lampada-glow" />
        <span className="pet-lampada-raio pet-lampada-raio--1" />
        <span className="pet-lampada-raio pet-lampada-raio--2" />
        <span className="pet-lampada-raio pet-lampada-raio--3" />
        <span className="pet-lampada-raio pet-lampada-raio--4" />
      </span>
      {/* Chuva de comemoração do eureka: cai do topo centralizado (não da
          lâmpada), lenta — 4s de queda suave com leve deriva lateral. */}
      <span className="pet-fx pet-chuva" aria-hidden="true">
        <span className="pet-chuva-floco pet-chuva-floco--1" />
        <span className="pet-chuva-floco pet-chuva-floco--2" />
        <span className="pet-chuva-floco pet-chuva-floco--3" />
        <span className="pet-chuva-floco pet-chuva-floco--4" />
        <span className="pet-chuva-floco pet-chuva-floco--5" />
        <span className="pet-chuva-floco pet-chuva-floco--6" />
      </span>
    </>
  )
})

/* ============================ CONTROLADOR DE VOO ============================= */
type FaseVoo = 'doca' | 'arrastando' | 'retornando'

interface OrigemVoo {
  x: number; y: number; w: number; h: number
}

interface UseVooRefs {
  portalRef: React.RefObject<HTMLDivElement | null>
  sombraRef: React.RefObject<HTMLDivElement | null>
  vooMoveRef: React.RefObject<HTMLDivElement | null>
  penduloRef: React.RefObject<HTMLDivElement | null>
}

/** Hook React que encapsula o controlador de voo imperativo.
 *
 * COORDENADAS (contrato, após correção do arrasto gigante):
 * - O portal `.pet-voo` é `position:fixed; left:0; top:0` com largura = doca.
 *   Logo `transform: translate(x, y)` usa coordenadas ABSOLUTAS de viewport
 *   (canto superior-esquerdo do portal). Nada de deltas relativos.
 * - No arrasto: x = cursor.x - w/2, y = cursor.y - h/2 - lift (toque +30px,
 *   mouse +4px para centralizar de verdade).
 * - No retorno: planeio até o ponto ACIMA da doca + descida vertical lenta
 *   (nunca por baixo) + assentamento com nuvem de poeira — doca VIVA medida
 *   a cada frame, com failsafe de tempo.
 */
function useVoo(
  refs: UseVooRefs,
  opts?: { onPousar?: (cx: number, baseY: number) => void },
): {
  fase: FaseVoo
  iniciarArraste: (e: React.PointerEvent) => void
  suprimirClickRef: React.MutableRefObject<boolean>
} {
  const [fase, setFase] = useState<FaseVoo>('doca')
  const { portalRef, vooMoveRef, sombraRef } = refs
  const onPousarRef = useRef(opts?.onPousar)
  onPousarRef.current = opts?.onPousar

  const rafRef = useRef<number>(0)
  const dragRafRef = useRef<number>(0)
  const passoRef = useRef<number>(0)
  const timeoutRef = useRef<number>(0)
  const assentamentoRef = useRef<number>(0)
  const suprimirClickRef = useRef<boolean>(false)
  // Posição pendente: o portal só monta APÓS setFase('arrastando'), então a
  // primeira escrita em vooMoveRef seria perdida (flash no canto 0,0).
  // Guardamos aqui e aplicamos no efeito pós-mount.
  const pendenteRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  // Alvo (cursor) x render (tela) do arrasto — o loop rAF interpola um no
  // outro para filtrar o jitter do pointermove e centralizar com glide.
  const alvoRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const renderRef = useRef<{ x: number; y: number } | null>(null)
  const velSuaveRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  const gestoRef = useRef<{
    origem: OrigemVoo | null
    arrastando: boolean
    ultimoX: number
    ultimoY: number
    velX: number // px/ms
    velY: number // px/ms
    ultimoT: number
    anguloAtual: number
    moveuMax: number
  }>({
    origem: null, arrastando: false, ultimoX: 0, ultimoY: 0, velX: 0, velY: 0, ultimoT: 0, anguloAtual: 0, moveuMax: 0
  })

  /** Atualiza portal DOM diretamente (coordenadas absolutas de viewport).
   * Escala não-uniforme (sx/sy) permite squash & stretch ao longo do voo. */
  const atualizarPortalDOM = useCallback((x: number, y: number, anguloDeg: number, sx: number, sy?: number) => {
    const el = vooMoveRef.current
    if (el) {
      const scaleY = sy ?? sx
      el.style.transform = `translate(${x}px, ${y}px) rotate(${anguloDeg}deg) scale(${sx}, ${scaleY})`
    }
  }, [vooMoveRef])

  const reduzirMovimento = useCallback(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  )

  /** Mede a doca viva (caminha vazia durante o voo) — tolera scroll/layout. */
  const medirDocaViva = useCallback((): { x: number; y: number; cx: number; baseY: number; w: number; h: number } | null => {
    const g = gestoRef.current
    const viva = document.querySelector('.pet-caminha-vazia')?.getBoundingClientRect()
    const w = g.origem?.w ?? viva?.width ?? 72
    const h = g.origem?.h ?? viva?.height ?? 72
    if (viva && viva.width > 0 && viva.height > 0) {
      return {
        x: viva.left + viva.width / 2 - w / 2,
        y: viva.top + viva.height / 2 - h / 2,
        cx: viva.left + viva.width / 2,
        baseY: viva.bottom,
        w, h,
      }
    }
    if (g.origem) {
      return { x: g.origem.x, y: g.origem.y, cx: g.origem.x + g.origem.w / 2, baseY: g.origem.y + g.origem.h, w, h }
    }
    return null
  }, [])

  /** Atualiza sombra ancorada na doca (X do pet, Y da base da doca). */
  const atualizarSombraDOM = useCallback((petCx: number, docaBaseY: number, distDaDoca: number) => {
    const el = sombraRef.current
    if (!el) return
    const fator = Math.min(1, distDaDoca / 500)
    // Quanto mais alto/longe, menor e mais transparente (física correta).
    const raioX = Math.max(12, 28 * (1 - fator * 0.45))
    const raioY = Math.max(3.5, 8 * (1 - fator * 0.45))
    const opacidade = Math.max(0.08, 0.35 * (1 - fator * 0.75))
    el.style.left = `${petCx - raioX}px`
    el.style.top = `${docaBaseY - raioY}px`
    el.style.width = `${raioX * 2}px`
    el.style.height = `${raioY * 2}px`
    el.style.opacity = String(opacidade)
  }, [sombraRef])

  /** Mostra/esconde sombra. */
  const mostrarSombra = useCallback((mostrar: boolean) => {
    const el = sombraRef.current
    if (el) el.style.display = mostrar ? 'block' : 'none'
  }, [sombraRef])

  /** Limpa tudo e força volta à doca. */
  const limpar = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    cancelAnimationFrame(dragRafRef.current)
    if (timeoutRef.current) { window.clearTimeout(timeoutRef.current); timeoutRef.current = 0 }
    if (assentamentoRef.current) { window.clearTimeout(assentamentoRef.current); assentamentoRef.current = 0 }
    pendenteRef.current = null
    renderRef.current = null
    try { document.body.style.cursor = '' } catch { /* noop */ }
    if (vooMoveRef.current) {
      vooMoveRef.current.style.transform = ''
      vooMoveRef.current.style.transformOrigin = ''
    }
    if (portalRef.current) portalRef.current.removeAttribute('data-pouso')
    mostrarSombra(false)
    setFase('doca')
    gestoRef.current = { origem: null, arrastando: false, ultimoX: 0, ultimoY: 0, velX: 0, velY: 0, ultimoT: 0, anguloAtual: 0, moveuMax: 0 }
  }, [mostrarSombra, vooMoveRef, portalRef])

  /** Força retorno à doca (usado quando chega no destino). */
  const forcarRetornoDoca = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    cancelAnimationFrame(dragRafRef.current)
    if (timeoutRef.current) { window.clearTimeout(timeoutRef.current); timeoutRef.current = 0 }
    if (assentamentoRef.current) { window.clearTimeout(assentamentoRef.current); assentamentoRef.current = 0 }
    pendenteRef.current = null
    renderRef.current = null
    try { document.body.style.cursor = '' } catch { /* noop */ }
    if (vooMoveRef.current) {
      vooMoveRef.current.style.transform = ''
      vooMoveRef.current.style.transformOrigin = ''
    }
    if (portalRef.current) portalRef.current.removeAttribute('data-pouso')
    mostrarSombra(false)
    setFase('doca')
    gestoRef.current = { origem: null, arrastando: false, ultimoX: 0, ultimoY: 0, velX: 0, velY: 0, ultimoT: 0, anguloAtual: 0, moveuMax: 0 }
  }, [mostrarSombra, vooMoveRef, portalRef])

  const iniciarArraste = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    // Guarda por ref (não só por state): evita duplo pointerdown antes do re-render.
    if (fase !== 'doca' || gestoRef.current.arrastando) return

    const casa = (e.currentTarget as HTMLElement).getBoundingClientRect()
    if (casa.width <= 0 || casa.height <= 0) return
    const origem: OrigemVoo = {
      x: casa.left, y: casa.top, w: casa.width, h: casa.height
    }

    gestoRef.current = {
      origem,
      arrastando: true,
      ultimoX: e.clientX,
      ultimoY: e.clientY,
      velX: 0, velY: 0,
      ultimoT: performance.now(),
      anguloAtual: 0,
      moveuMax: 0,
    }
    suprimirClickRef.current = false
    passoRef.current = 0

    // Centralização com glide: o render nasce na doca (sem salto) e persegue
    // o cursor centrado via rAF — filtra o jitter e dá a sensação de "grude".
    // Toque/pen ganha +30px de altura (dedo não cobre o sprite); mouse fica
    // quase exato (+4px) para centralizar de verdade.
    const lift = e.pointerType === 'mouse' ? 4 : 30
    const x0 = e.clientX - origem.w / 2
    const y0 = e.clientY - origem.h / 2 - lift
    pendenteRef.current = { x: x0, y: y0, w: origem.w, h: origem.h }
    if (portalRef.current) {
      portalRef.current.style.width = `${origem.w}px`
    }
    alvoRef.current = { x: x0, y: y0 }
    renderRef.current = { x: origem.x, y: origem.y }
    velSuaveRef.current = { x: 0, y: 0 }
    gestoRef.current.anguloAtual = 0

    setFase('arrastando')
    usePet.getState().agir('voando', 'Wheee! Me solta!')

    // Coordenadas ABSOLUTAS: portal tem left:0/top:0, então translate = canto superior-esquerdo.
    // (Se o portal já estiver montado — re-arrasto rápido — aplica direto.)
    atualizarPortalDOM(origem.x, origem.y, 0, 0.92, 0.92) // squash de pickup, o loop dá o pop
    const doca0 = medirDocaViva()
    if (doca0) atualizarSombraDOM(e.clientX, doca0.baseY, 0)
    mostrarSombra(true)
    try { e.preventDefault() } catch { /* noop */ }
    try { document.body.style.cursor = 'grabbing' } catch { /* noop */ }

    const comMovimentoReduzido = reduzirMovimento()
    let ultimoQuadro = performance.now()
    let prevRx = origem.x
    let prevRy = origem.y
    const tPickup = performance.now()

    // Loop de arrasto: interpola render→alvo, inclina e estica pelo vetor
    // velocidade. Roda a 60fps independente da taxa do pointermove.
    const loopArrasto = (agora: number) => {
      const g = gestoRef.current
      if (!g.origem || !g.arrastando) return
      const dt = Math.max(0.5, Math.min(2, (agora - ultimoQuadro) / 16.67))
      ultimoQuadro = agora
      const r = renderRef.current
      const t = alvoRef.current
      if (!r) return

      if (comMovimentoReduzido) {
        r.x = t.x; r.y = t.y
        velSuaveRef.current = { x: 0, y: 0 }
        g.anguloAtual = 0
        atualizarPortalDOM(r.x, r.y, 0, 1.05)
      } else {
        // dt em frames (1 = 1 quadro a 60fps): taxas exponenciais por quadro.
        // Ganho ADAPTATIVO: gruda no cursor — base mais firme que antes
        // para a pet não ficar para trás, e enrijece com a distância para
        // fechar vãos rápido; de perto volta a filtrar o tremor parado.
        const distAlvo = Math.hypot(t.x - r.x, t.y - r.y)
        const rigidez = 0.65 + Math.min(1.6, distAlvo / 120)
        const kPos = 1 - Math.exp(-dt * rigidez) // ~0.48 de perto, até ~0.9 longe
        r.x += (t.x - r.x) * kPos
        r.y += (t.y - r.y) * kPos
        // Snap final quando почти lá (evita perseguição infinita sub-pixel).
        if (Math.abs(t.x - r.x) < 0.15) r.x = t.x
        if (Math.abs(t.y - r.y) < 0.15) r.y = t.y

        // Velocidade suavizada (px/frame) a partir do deslocamento renderizado.
        const instVx = (r.x - prevRx) / dt
        const instVy = (r.y - prevRy) / dt
        prevRx = r.x; prevRy = r.y
        const kVel = 1 - Math.exp(-dt * 0.14) // ~0.13: filtra jitter sem lag
        const vs = velSuaveRef.current
        vs.x += (instVx - vs.x) * kVel
        vs.y += (instVy - vs.y) * kVel
        const speed = Math.hypot(vs.x, vs.y)

        // Inclinação (bank) pelo eixo X + leve mergulho pelo Y.
        const alvoAng = Math.max(-0.24, Math.min(0.24, vs.x * 0.026 + vs.y * 0.006))
        const kAng = 1 - Math.exp(-dt * 0.18) // ~0.16: inclina sem tremer
        g.anguloAtual += (alvoAng - g.anguloAtual) * kAng

        // Pop de pickup (0.92→1.05 em ~160ms, easeOutCubic) + stretch por velocidade.
        const tDesdePickup = Math.min(1, (agora - tPickup) / 160)
        const pop = tDesdePickup < 1
          ? 0.92 + 0.13 * (1 - Math.pow(1 - tDesdePickup, 3))
          : 1.05
        const stretch = Math.min(0.13, speed * 0.011)
        const sx = pop * (1 - stretch * 0.55)
        const sy = pop * (1 + stretch)

        // Flutuação viva (soma ao Y sem contaminar a física).
        const bobAmp = 2.2 * (0.35 + 0.65 * Math.min(1, speed / 9))
        const bobY = Math.sin(agora * 0.007) * bobAmp
        const bobRot = Math.sin(agora * 0.0053 + 1.2) * 1.1

        atualizarPortalDOM(r.x, r.y + bobY, g.anguloAtual * (180 / Math.PI) + bobRot, sx, sy)
      }

      const doca = medirDocaViva()
      if (doca) {
        const distDaDoca = Math.hypot(r.x - doca.x, r.y - doca.y)
        atualizarSombraDOM(r.x + g.origem.w / 2, doca.baseY, distDaDoca)
      }
      dragRafRef.current = requestAnimationFrame(loopArrasto)
    }
    dragRafRef.current = requestAnimationFrame(loopArrasto)

    const onMove = (ev: PointerEvent) => {
      const g = gestoRef.current
      if (!g.origem || !g.arrastando) return

      const agora = performance.now()
      const dt = Math.max(1, agora - g.ultimoT)
      // Velocidade crua só para herança no soltar (o tilt usa a suavizada).
      g.velX = 0.6 * g.velX + 0.4 * ((ev.clientX - g.ultimoX) / dt)
      g.velY = 0.6 * g.velY + 0.4 * ((ev.clientY - g.ultimoY) / dt)
      g.ultimoX = ev.clientX
      g.ultimoY = ev.clientY
      g.ultimoT = agora

      const distDaOrigem = Math.hypot(
        ev.clientX - (g.origem.x + g.origem.w / 2),
        ev.clientY - (g.origem.y + g.origem.h / 2),
      )
      g.moveuMax = Math.max(g.moveuMax, distDaOrigem)

      // Alvo SEMPRE centrado no cursor (absoluto). O loop dá o glide.
      const liftMove = ev.pointerType === 'mouse' ? 4 : 30
      alvoRef.current = {
        x: ev.clientX - g.origem.w / 2,
        y: ev.clientY - g.origem.h / 2 - liftMove,
      }
    }

    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      cancelAnimationFrame(dragRafRef.current)
      try { document.body.style.cursor = '' } catch { /* noop */ }

      const g = gestoRef.current
      g.arrastando = false
      if (!g.origem) { limpar(); return }

      const cx0 = g.origem.x + g.origem.w / 2
      const cy0 = g.origem.y + g.origem.h / 2
      const dist = Math.hypot(ev.clientX - cx0, ev.clientY - cy0)

      // Clique simples (quase não moveu): deixa o onClick dar carinho.
      if (g.moveuMax < 8 && dist < 12) {
        limpar()
        return
      }
      // Soltou pertinho: só encaixa, sem paraquedas.
      if (dist < 60) {
        suprimirClickRef.current = true
        limpar()
        usePet.getState().agir('happy', 'Opa, quase fui!')
        window.setTimeout(() => { suprimirClickRef.current = false }, 350)
        return
      }

      // Inicia retorno de paraquedas (coordenadas absolutas).
      suprimirClickRef.current = true
      setFase('retornando')
      usePet.getState().agir('retornando', 'Wheee! Olha o vento!')
      // Narração do voo: ela comenta a descida se ainda estiver planando.
      window.setTimeout(() => {
        if (usePet.getState().mood === 'retornando') {
          usePet.getState().agir('retornando', 'Uhuul! Segura a lupinha!')
        }
      }, 1400)
      window.setTimeout(() => {
        if (usePet.getState().mood === 'retornando') {
          usePet.getState().agir('retornando', 'Tô planando… quase lá!')
        }
      }, 2900)

      const w = g.origem.w
      const h = g.origem.h
      // Parte da posição RENDERIZADA (onde o olho vê), não do cursor —
      // evita salto entre o glide do arrasto e o início do retorno.
      const r0 = renderRef.current
      const liftSolta = ev.pointerType === 'mouse' ? 4 : 30
      let px = r0 ? r0.x : ev.clientX - w / 2
      let py = r0 ? r0.y : ev.clientY - h / 2 - liftSolta
      // Herança de velocidade suavizada + freio de abertura da copa: a
      // velame mata o flick (40-65% de sangria, sem arremesso para cima).
      const vs = velSuaveRef.current
      let vx = Math.max(-9, Math.min(9, vs.x * 0.55 + g.velX * 16.67 * 0.12))
      let vy = Math.max(-4, Math.min(4, vs.y * 0.35 + g.velY * 16.67 * 0.08))
      if (!Number.isFinite(vx)) vx = 0
      if (!Number.isFinite(vy)) vy = 0
      let angulo = g.anguloAtual ?? 0
      let velAngular = 0

      // Retorno em dois tempos, SEM gravidade constante:
      // 1. PLANEIO: mola até o ponto ACIMA da doca — a pet sempre chega por
      //    cima para o pouso, nunca subindo por baixo;
      // 2. DESCIDA: vertical lenta e aprumada até a caminha, com nuvem de
      //    poeira no toque.
      // MIRA NO BONECO (K vivo): o portal inclui o paraquedas ACIMA do
      // boneco, então mirar o TOPO do portal na doca afundava a pet ~100px
      // abaixo da caminha. `medirK` mede a cada passo a distância real
      // topo-do-portal → base-do-boneco (copa + corpo + escala/bob do
      // frame) e o alvejado passa a ser a BASE DO BONECO na doca. Efeito
      // colateral bom: o portal absorve o bob da flutuação e o boneco voa
      // colado na trajetória.
      const ALTURA_PLANEIO = 210
      const ESCALA_INICIAL = 1.05
      const ESCALA_FINAL = 1.0
      const copaEl = portalRef.current?.querySelector('.pet-paraquedas') as HTMLElement | null
      const copaMedida = copaEl?.getBoundingClientRect().height ?? 0
      // -15px: o boneco sobrepõe a base da copa (margin-bottom negativa no CSS).
      const ajusteCopa = copaMedida > 0 ? Math.max(0, copaMedida - 15) : Math.max(0, w * 1.83 - 15)
      const kReserva = ajusteCopa + h
      /** Distância viva topo-do-portal → base-do-boneco (px de viewport). */
      const medirK = (topoPortal: number): number => {
        const b = portalRef.current?.querySelector('.pet-voo-boneco') as HTMLElement | null
        if (!b) return kReserva
        const base = b.getBoundingClientRect().bottom
        const k = base - topoPortal
        // Guarda: copa ainda sem layout (primeiros frames) ou medida
        // inválida → usa a estimativa em vez de puxar o alvo de repente.
        if (!Number.isFinite(k) || k < kReserva * 0.7) return kReserva
        return k
      }

      const alvoInicial = medirDocaViva()
      const distTotal = Math.max(1, alvoInicial
        ? Math.hypot(px - alvoInicial.x, py - (alvoInicial.baseY - kReserva - ALTURA_PLANEIO))
        : Math.hypot(ev.clientX - cx0, ev.clientY - cy0))
      const t0 = performance.now()
      let emDescida = false
      let inicioDescida = 0
      passoRef.current = 0
      renderRef.current = null

      const finalizar = (pousoSuave: boolean) => {
        if (timeoutRef.current) { window.clearTimeout(timeoutRef.current); timeoutRef.current = 0 }
        if (assentamentoRef.current) { window.clearTimeout(assentamentoRef.current); assentamentoRef.current = 0 }
        forcarRetornoDoca()
        window.setTimeout(() => { suprimirClickRef.current = false }, 350)
        if (pousoSuave) vibrar([10, 40, 10])
        if (!registrarEventoPet({ tipo: 'voo' })) {
          usePet.getState().agir('waving', 'De volta! Sentiu falta?')
        }
      }

      // Assentamento: squash & stretch com a BASE ANCORADA (transform-origin
      // embaixo) para não "cair" abaixo da caminha + nuvem de poeira
      // (via onPousar) antes de desmontar o portal. A copa recolhe via CSS.
      // O estacionamento usa o K vivo: a base do boneco — não o topo do
      // portal — assenta na base da caminha.
      const pousarComAssentamento = () => {
        cancelAnimationFrame(rafRef.current)
        const alvo = medirDocaViva()
        if (!alvo) { finalizar(false); return }
        const kPouso = medirK(py)
        const pousoY = alvo.baseY - kPouso
        try { portalRef.current?.setAttribute('data-pouso', 'true') } catch { /* noop */ }
        try { onPousarRef.current?.(alvo.cx, alvo.baseY) } catch { /* noop */ }
        if (vooMoveRef.current) vooMoveRef.current.style.transformOrigin = '50% 100%'
        atualizarPortalDOM(alvo.x, pousoY, 0, 1.08, 0.9)
        atualizarSombraDOM(alvo.cx, alvo.baseY, 0)
        assentamentoRef.current = window.setTimeout(() => {
          const a2 = medirDocaViva() ?? alvo
          atualizarPortalDOM(a2.x, a2.baseY - kPouso, 0, 0.98, 1.03)
          assentamentoRef.current = window.setTimeout(() => {
            const a3 = medirDocaViva() ?? a2
            atualizarPortalDOM(a3.x, a3.baseY - kPouso, 0, 1, 1)
            finalizar(true)
          }, 130)
        }, 130)
      }

      // Failsafe: nunca prende a pet fora da caminha (descida lenta = teto maior).
      timeoutRef.current = window.setTimeout(() => {
        cancelAnimationFrame(rafRef.current)
        finalizar(false)
      }, 6500)

      function passo(agora: number) {
        const anterior = passoRef.current || agora
        const dtNorm = Math.max(0.5, Math.min(2, (agora - anterior) / 16.67))
        passoRef.current = agora

        const alvo = medirDocaViva()
        if (!alvo) { finalizar(false); return }

        // Ponto do TOPO do portal que coloca a base do boneco na doca.
        const kVivo = medirK(py)
        const baseAlvo = alvo.baseY - kVivo

        if (!emDescida) {
          // ——— PLANEIO até o ponto acima da doca (base do boneco) ———
          // Descida lenta de paraquedas: mola macia + teto de velocidade baixo
          // + rajadas de vento lateral (senos sobrepostos) para deriva viva.
          const gx = alvo.x
          const gy = baseAlvo - ALTURA_PLANEIO
          const dx = gx - px
          const dy = gy - py
          const distPlaneio = Math.hypot(dx, dy)
          const speed = Math.hypot(vx, vy)

          if ((distPlaneio < 30 && speed < 2.5) || agora - t0 > 3200) {
            emDescida = true
            inicioDescida = agora
            vx *= 0.4
            vy = Math.min(Math.max(vy * 0.3, 0), 2)
            angulo *= 0.5
            velAngular = 0
          } else {
            vx += dx * 0.0075 - vx * 0.14
            vy += dy * 0.0075 - vy * 0.14
            // Vento: duas frentes sobrepostas (lenta + rápida) — deriva sem tranco.
            const vt = agora * 0.001
            const rajada = Math.sin(vt * 0.9) * 0.9 + Math.sin(vt * 2.3 + 1.7) * 0.45
            vx += rajada * 0.12 * dtNorm
            vy += Math.sin(vt * 3.1) * 0.03 * dtNorm
            const sp = Math.hypot(vx, vy)
            if (sp > 12) { vx = (vx / sp) * 12; vy = (vy / sp) * 12 }

            velAngular += (vx * 0.0016 + rajada * 0.0006) * dtNorm
            velAngular *= 0.93
            angulo += velAngular * dtNorm
            angulo = Math.max(-0.2, Math.min(0.2, angulo))

            px += vx * dtNorm
            py += vy * dtNorm

            const progressoBruto = 1 - Math.min(1, distPlaneio / distTotal)
            const progresso = 1 - Math.pow(1 - progressoBruto, 3)
            const escala = ESCALA_INICIAL + (ESCALA_FINAL - ESCALA_INICIAL) * progresso * 0.5
            const stretchVoo = Math.min(0.08, speed * 0.008)

            atualizarPortalDOM(px, py, angulo * (180 / Math.PI), escala * (1 - stretchVoo * 0.5), escala * (1 + stretchVoo))
            atualizarSombraDOM(px + w / 2, alvo.baseY, Math.hypot(alvo.x - px, alvo.y - py))

            rafRef.current = requestAnimationFrame(passo)
            return
          }
        }

        // ——— DESCIDA vertical, lenta e aprumada (base do boneco) ———
        // Paraquedas aberto = freio forte: ganhos baixos, teto de queda em
        // ~1.8px/frame + brisa residual para não descer reta feito elevador.
        // Piso rígido: o topo do portal nunca passa de `baseAlvo`,
        // então o boneco nunca mergulha abaixo da caminha — toca por cima.
        const dx = alvo.x - px
        const dy = baseAlvo - py
        const distRest = Math.hypot(dx, dy)
        const speed = Math.hypot(vx, vy)

        if ((distRest < 6 && speed < 1.4) || agora - inicioDescida > 3500) {
          pousarComAssentamento()
          return
        }

        vx += dx * 0.016 - vx * 0.32
        vy += dy * 0.008 - vy * 0.22
        const vtDesc = agora * 0.001
        vx += Math.sin(vtDesc * 1.4 + 0.6) * 0.09 * dtNorm
        // Teto de descida: flutua para baixo, sem mergulho nem subida.
        vx = Math.max(-2.2, Math.min(2.2, vx))
        vy = Math.max(-0.8, Math.min(1.8, vy))

        // Apruma o balanço para tocar a caminha zerada.
        velAngular += vx * 0.0012 * dtNorm
        velAngular *= 0.88
        angulo += velAngular * dtNorm
        angulo = Math.max(-0.12, Math.min(0.12, angulo))
        angulo *= 1 - 0.15 * dtNorm

        px += vx * dtNorm
        py += vy * dtNorm
        // Piso: corta qualquer overshoot da mola antes de desenhar.
        if (py > baseAlvo) {
          py = baseAlvo
          if (vy > 0) vy = 0
        }

        const progressoBruto = 1 - Math.min(1, distRest / Math.max(1, ALTURA_PLANEIO))
        const progresso = 1 - Math.pow(1 - Math.min(1, progressoBruto), 2)
        const escala = ESCALA_INICIAL + (ESCALA_FINAL - ESCALA_INICIAL) * (0.5 + progresso * 0.5)

        atualizarPortalDOM(px, py, angulo * (180 / Math.PI), escala, escala)
        atualizarSombraDOM(px + w / 2, alvo.baseY, distRest)

        rafRef.current = requestAnimationFrame(passo)
      }
      rafRef.current = requestAnimationFrame(passo)
    }

    const onCancel = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      cancelAnimationFrame(dragRafRef.current)
      try { document.body.style.cursor = '' } catch { /* noop */ }
      gestoRef.current.arrastando = false
      limpar()
      usePet.getState().aquietar()
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }, [fase, portalRef, atualizarPortalDOM, medirDocaViva, atualizarSombraDOM, limpar, forcarRetornoDoca, mostrarSombra, reduzirMovimento])

  // Pós-mount do portal: aplica largura 1:1 + posição inicial pendente,
  // evitando flash no canto (0,0) no primeiro frame. A caminha vazia é
  // calçada no tamanho EXATO do botão (medido no pickup) para o pouso
  // encaixar sem salto na remontagem.
  useEffect(() => {
    if (fase === 'doca') { pendenteRef.current = null; return }
    const p = pendenteRef.current
    if (!p) return
    if (portalRef.current) portalRef.current.style.width = `${p.w}px`
    const viva = document.querySelector('.pet-caminha-vazia') as HTMLElement | null
    if (viva && p.w > 0 && p.h > 0) {
      viva.style.width = `${p.w}px`
      viva.style.height = `${p.h}px`
    }
    atualizarPortalDOM(p.x, p.y, 0, 0.92, 0.92)
    // Mantém até o primeiro onMove/passo sobrescrever; limpa após 500ms.
    const t = window.setTimeout(() => { pendenteRef.current = null }, 500)
    return () => window.clearTimeout(t)
  }, [fase, portalRef, atualizarPortalDOM])

  // Limpeza ao desmontar
  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current)
    cancelAnimationFrame(dragRafRef.current)
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
    if (assentamentoRef.current) window.clearTimeout(assentamentoRef.current)
  }, [])

  return { fase, iniciarArraste, suprimirClickRef }
}

function vibrar(padrao: number | number[]) { try { navigator.vibrate?.(padrao) } catch {} }

/* ---------------------------- REAÇÕES (inalteradas) -------------------------- */
function useReacoesDaAurinha() {
  const agirRef = useRef(usePet.getState().agir)
  agirRef.current = usePet.getState().agir

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const parar = useUi.subscribe((s, ant) => {
      if (s.view === ant.view) return
      if (registrarEventoPet({ tipo: 'view', view: s.view })) return
      const agir = agirRef.current
      agir('walking', 'Indo lá…')
      if (timer) window.clearTimeout(timer)
      timer = setTimeout(() => agirRef.current('waving', FRASE_POR_VIEW[s.view] ?? 'Vamos lá!'), 1500)
    })
    return () => { parar(); if (timer) window.clearTimeout(timer) }
  }, [])

  useEffect(() => {
    const parar = useUi.subscribe((s, ant) => {
      if (s.toasts.length <= ant.toasts.length) return
      const u = s.toasts[s.toasts.length - 1]; if (!u) return
      const agir = agirRef.current
      if (u.tipo === 'ok') { if (!registrarEventoPet({ tipo: 'sucesso' })) agir('celebrating', 'Conseguimos!') }
      else if (u.tipo === 'err') { if (!registrarEventoPet({ tipo: 'erro' })) agir('angry', 'Ops… vamos corrigir?') }
      else if (u.tipo === 'warn') agir('curious', 'Opa, olha isso!')
      else agir('happy', 'Anotado!')
    })
    return parar
  }, [])

  useEffect(() => {
    const parar = useConsulta.subscribe((s, ant) => {
      const b = s.carregando || s.buscandoTexto || s.classificandoDescricao
      const bAnt = ant.carregando || ant.buscandoTexto || ant.classificandoDescricao
      const termo = s.entrada || s.buscaTexto || s.codigo || s.descricao
      if (b && !bAnt) {
        // Busca ativa = modo investigativo: a lupinha varre sem parar.
        agirRef.current('searching', fraseFarejando(termo) ?? fraseAleatoria(FRASES_PESQUISANDO))
        return
      }
      if (s.avisoInvalido && !ant.avisoInvalido) {
        if (!registrarEventoPet({ tipo: 'erro' })) {
          agirRef.current('angry', fraseNcmInvalido(s.codigo || s.entrada))
        }
        return
      }
      if (!b && bAnt) {
        const oficiais = s.resultados.length
        const textos = s.resultadosTexto.length
        const codigoIa = s.codigoIa ?? undefined
        const primeiroCodigo = s.resultados[0]?.classificacao.codigo ?? codigoIa
        const temSugestao = Boolean(s.sugestao || codigoIa)
        if (oficiais + textos > 0 || temSugestao) {
          if (!registrarEventoPet({ tipo: 'sucesso' })) {
            agirRef.current('celebrating', fraseResultadoBusca(termo || 'essa busca', {
              oficiais, textos, temSugestao, primeiroCodigo,
            }))
          }
          return
        }
        // Busca válida que zerou: cutuca com o termo, sem pisar em erro/sucesso.
        if (termo.trim() && ['idle', 'reading', 'searching', 'thinking', 'curious'].includes(usePet.getState().mood)) {
          agirRef.current('curious', fraseResultadoBusca(termo, {
            oficiais, textos, temSugestao, primeiroCodigo,
          }))
        }
      }
    })
    return parar
  }, [])

  // Serviços (NBS): espelho da consulta NCM — ela também vai à gaveta
  // (o mood `searching` acende a gaveta + livro e a locomoção a leva até lá).
  useEffect(() => {
    const parar = useServicos.subscribe((s, ant) => {
      const b = s.carregando || s.buscandoTexto || s.classificandoDescricao
      const bAnt = ant.carregando || ant.buscandoTexto || ant.classificandoDescricao
      const termo = s.entrada || s.codigo
      if (b && !bAnt) {
        agirRef.current('searching', fraseFarejando(termo) ?? fraseAleatoria(FRASES_PESQUISANDO))
        return
      }
      if (s.avisoInvalido && !ant.avisoInvalido) {
        if (!registrarEventoPet({ tipo: 'erro' })) {
          const limpo = (s.codigo || s.entrada).trim()
          agirRef.current('angry', limpo ? `Hmm, '${resumirTermo(limpo, 18)}' não é um NBS válido…` : 'Hmm, esse NBS tá estranho…')
        }
        return
      }
      if (!b && bAnt) {
        const oficiais = s.resultados.length
        const textos = s.resultadosTexto.length
        const codigoIa = s.codigoIa ?? undefined
        const primeiroCodigo = s.resultados[0]?.classificacao.codigo ?? codigoIa
        const temSugestao = Boolean(s.sugestao || codigoIa)
        // Mesmas frases da NCM, com o nome certo (NBS tem 9 dígitos).
        const frase = fraseResultadoBusca(termo || 'essa busca', {
          oficiais, textos, temSugestao, primeiroCodigo,
        }).replaceAll('NCM', 'NBS')
        if (oficiais + textos > 0 || temSugestao) {
          if (!registrarEventoPet({ tipo: 'sucesso' })) {
            agirRef.current('celebrating', frase)
          }
          return
        }
        if (termo.trim() && ['idle', 'reading', 'searching', 'thinking', 'curious'].includes(usePet.getState().mood)) {
          agirRef.current('curious', frase)
        }
      }
    })
    return parar
  }, [])

  // Farejo da digitação: pausa de ~900ms na busca unificada (≥3 letras) rende
  // um farejo com o termo — só se a pet estiver livre, no máx. 1 a cada 8s.
  useEffect(() => {
    let t: number | null = null
    let ultimoFarejo = 0
    const aoDigitar = (e: Event) => {
      const alvo = e.target as HTMLElement | null
      if (!alvo || (alvo as HTMLInputElement).id !== 'busca-unificada') return
      if (t) window.clearTimeout(t)
      t = window.setTimeout(() => {
        const termo = (alvo as HTMLInputElement).value ?? ''
        if (termo.trim().length < 3) return
        if (Date.now() - ultimoFarejo < 8000) return
        const mood = usePet.getState().mood
        if (!['idle', 'reading'].includes(mood)) return
        const frase = fraseFarejando(termo)
        if (!frase) return
        ultimoFarejo = Date.now()
        agirRef.current('reading', frase)
      }, 900)
    }
    document.addEventListener('input', aoDigitar, { capture: true })
    return () => {
      document.removeEventListener('input', aoDigitar, { capture: true } as EventListenerOptions)
      if (t) window.clearTimeout(t)
    }
  }, [])

  // Calculadora: item novo na conta → lupinha a postos (sem pisar em festa).
  useEffect(() => {
    const parar = useCalculadora.subscribe((s, ant) => {
      if (s.itens.length <= ant.itens.length) return
      const mood = usePet.getState().mood
      if (!['idle', 'reading', 'calculating', 'happy', 'waving'].includes(mood)) return
      agirRef.current('calculating', fraseAleatoria(FRASES_CALCULANDO))
    })
    return parar
  }, [])

  useEffect(() => {
    let ult = 0
    let tSoneca: ReturnType<typeof setTimeout> | null = null
    // Throttle das reações de digitação: sem isso cada tecla chamava `agir`
    // (set no zustand → re-render do SVG pesado) no meio do input = lag.
    // Agora: entra em reading/calculating UMA vez e ignora o resto por 6s.
    let ultimaReacaoDigitacao = 0
    const JANELA_DIGITACAO_MS = 6000
    const TIPOS_CAMPO = ['INPUT', 'TEXTAREA', 'SELECT']
    const naCalculadora = () => useUi.getState().view === 'calculadora'
    // `adiar` roda em pointermove (altíssima frequência): guarda de 1s evita
    // churn de clearTimeout/setTimeout a cada pixel do mouse.
    let ultimaSonecaAdiada = 0
    const adiar = (forcar = false) => {
      const agora = Date.now()
      if (!forcar && agora - ultimaSonecaAdiada < 1000) return
      ultimaSonecaAdiada = agora
      if (tSoneca) clearTimeout(tSoneca); tSoneca = setTimeout(() => { if (usePet.getState().mood !== 'sleeping') agirRef.current('sleeping', 'Zzz…') }, 75_000)
    }
    const acordar = () => { if (usePet.getState().mood === 'sleeping') { agirRef.current('waving', 'Voltei! Sentiu saudade?'); registrarEventoPet({ tipo: 'despertar' }); adiar(true); return true } return false }
    const fraseCampo = () => naCalculadora() ? fraseAleatoria(FRASES_CALCULANDO) : fraseAleatoria(FRASES_LEITURA)
    const humorCampo = () => naCalculadora() ? 'calculating' as const : 'reading' as const
    const focar = (e: FocusEvent) => { adiar(true); if (acordar()) return; const a = e.target as HTMLElement; if (!a) return; if (TIPOS_CAMPO.includes(a.tagName) && !['checkbox', 'radio', 'button'].includes((a as HTMLInputElement).type) && usePet.getState().mood === 'idle') agirRef.current(humorCampo(), fraseCampo()) }
    const digitar = (e: Event) => {
      adiar();
      if (acordar()) return
      const a = e.target as HTMLElement
      if (!a) return
      if (!['INPUT', 'TEXTAREA'].includes(a.tagName)) return
      // Já está lendo/calculando? Só mantém o timer da soneca, sem `set`.
      // Evita re-render do SVG a cada tecla (causa do lag nos inputs).
      const mood = usePet.getState().mood
      if (mood !== 'idle') return
      const agora = Date.now()
      if (agora - ultimaReacaoDigitacao < JANELA_DIGITACAO_MS) return
      ultimaReacaoDigitacao = agora
      agirRef.current(humorCampo(), fraseCampo())
    }
    const clicar = (e: MouseEvent) => { adiar(); if (acordar()) return; const b = (e.target as HTMLElement)?.closest?.('button,a,[role="button"]'); if (!b || b.closest('.pet-aurum')) return; const texto = (b.textContent ?? '').toLowerCase(); if (/pdf|excel|exportar|relat/.test(texto)) { agirRef.current('celebrating', 'Relatório prontinho!'); return } const ag = Date.now(); if (ag - ult < 4000) return; ult = ag; if (/copiar|copiado|copied/.test(texto)) { if (['idle', 'happy', 'reading', 'calculating'].includes(usePet.getState().mood)) agirRef.current('happy', 'Copiado! Farejei tudinho!'); return } if (/salvar|guardar/.test(texto)) { if (['idle', 'happy', 'reading', 'calculating'].includes(usePet.getState().mood)) agirRef.current('happy', 'Guardadinho!'); return } }
    const teclar = () => { adiar(); acordar() }
    // pointermove dispara a dezenas de Hz: wrapper sem `forcar` para o
    // throttle de 1s em `adiar` valer (passar `adiar` direto entregaria o
    // Event como `forcar=true` e furaria a guarda).
    const aoMover = () => { adiar() }
    adiar(true)
    document.addEventListener('focusin', focar)
    document.addEventListener('input', digitar, { capture: true })
    document.addEventListener('click', clicar)
    document.addEventListener('keydown', teclar)
    document.addEventListener('pointermove', aoMover, { passive: true })
    return () => { if (tSoneca) clearTimeout(tSoneca); document.removeEventListener('focusin', focar); document.removeEventListener('input', digitar, { capture: true } as EventListenerOptions); document.removeEventListener('click', clicar); document.removeEventListener('keydown', teclar); document.removeEventListener('pointermove', aoMover) }
  }, [])

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null
    // Digitar dispara mutações do React a cada tecla: sem batch, o callback
    // rodaria querySelector dezenas de vezes por segundo. Agrega por frame.
    let checagemPendente = false
    const checar = () => {
      checagemPendente = false
      const c = document.querySelector('.btn-spinner, .loading-bar')
      if (c && usePet.getState().mood === 'idle') { agirRef.current('thinking', fraseAleatoria(FRASES_PENSANDO)); if (t) clearTimeout(t); t = setTimeout(() => { if (usePet.getState().mood === 'thinking') usePet.getState().aquietar() }, 5200) }
    }
    const obs = new MutationObserver(() => {
      if (checagemPendente) return
      checagemPendente = true
      requestAnimationFrame(checar)
    })
    obs.observe(document.body, { childList: true, subtree: true })
    return () => { obs.disconnect(); if (t) clearTimeout(t) }
  }, [])

  // Lote: enquanto classifica, a Aurinha lê o livrinho; ao concluir, a
  // lâmpada acende (festeja sem pisar em erro/sucesso já registrados).
  useEffect(() => {
    let importarLote = true
    let parar: (() => void) | null = null
    void import('@/store/lote').then((mod) => {
      if (!importarLote) return
      parar = mod.useLote.subscribe((s, ant) => {
        if (s.processando && !ant.processando) {
          agirRef.current('reading', 'Lendo a planilha pra você…')
          return
        }
        if (!s.processando && ant.processando && s.resumo) {
          if (!registrarEventoPet({ tipo: 'sucesso' })) {
            agirRef.current('celebrating', `Prontinho! ${s.resumo.itens.length} produtos classificados!`)
          }
          // Lâmpada de ideia acende NO PET da sidebar (nunca na tela de lote).
          try { usePet.getState().dispararEureka() } catch { /* noop */ }
        }
      })
    })
    return () => { importarLote = false; parar?.() }
  }, [])

  useEffect(() => { const t = setTimeout(() => saudacaoInicialPet(), 900); return () => clearTimeout(t) }, [])
}

/* Poeira do pouso — grãos de areia + anel de impacto. Monta no toque e
   desmonta sozinha após a animação (~1.1s). */
const GRAOS_POEIRA: { dx: string; dy: string; size: number; delay: string; cor: string }[] = [
  { dx: '-58px', dy: '-30px', size: 8, delay: '0s', cor: '#d2a94e' },
  { dx: '-44px', dy: '-14px', size: 6, delay: '0.04s', cor: '#c9b48a' },
  { dx: '-30px', dy: '-42px', size: 7, delay: '0.07s', cor: '#e3c878' },
  { dx: '-16px', dy: '-22px', size: 5, delay: '0.02s', cor: '#a08c5b' },
  { dx: '-6px', dy: '-48px', size: 6, delay: '0.09s', cor: '#e3c878' },
  { dx: '6px', dy: '-46px', size: 6, delay: '0.05s', cor: '#d2a94e' },
  { dx: '16px', dy: '-22px', size: 5, delay: '0s', cor: '#c9b48a' },
  { dx: '30px', dy: '-42px', size: 7, delay: '0.08s', cor: '#e3c878' },
  { dx: '44px', dy: '-14px', size: 6, delay: '0.03s', cor: '#d2a94e' },
  { dx: '58px', dy: '-30px', size: 8, delay: '0.06s', cor: '#a08c5b' },
  { dx: '-36px', dy: '-8px', size: 5, delay: '0.1s', cor: '#e3c878' },
  { dx: '36px', dy: '-8px', size: 5, delay: '0.11s', cor: '#c9b48a' },
]

/* Nuvem macia — baias grandes e desfocadas que sobem devagar por trás dos grãos. */
const NUVENS_POEIRA: { dx: string; dy: string; size: number; delay: string }[] = [
  { dx: '-30px', dy: '-30px', size: 26, delay: '0.02s' },
  { dx: '0px', dy: '-40px', size: 32, delay: '0.07s' },
  { dx: '30px', dy: '-30px', size: 26, delay: '0.04s' },
  { dx: '-12px', dy: '-18px', size: 20, delay: '0.1s' },
  { dx: '12px', dy: '-18px', size: 20, delay: '0.12s' },
]

function PoeiraPouso({ x, baseY }: { x: number; baseY: number }) {
  return (
    <div className="pet-poeira" aria-hidden="true" style={{ left: `${x}px`, top: `${baseY}px` }}>
      <span className="pet-poeira-anel" />
      <span className="pet-poeira-anel pet-poeira-anel--2" />
      {NUVENS_POEIRA.map((n, i) => (
        <span
          key={`n${i}`}
          className="pet-poeira-nuvem"
          style={{
            // @ts-expect-error variáveis customizadas do keyframe
            '--dx': n.dx, '--dy': n.dy, '--atraso': n.delay,
            width: `${n.size}px`, height: `${n.size}px`,
          }}
        />
      ))}
      {GRAOS_POEIRA.map((g, i) => (
        <span
          key={`g${i}`}
          className="pet-poeira-grao"
          style={{
            // @ts-expect-error variáveis customizadas do keyframe
            '--dx': g.dx, '--dy': g.dy, '--atraso': g.delay,
            width: `${g.size}px`, height: `${g.size}px`, background: g.cor,
          }}
        />
      ))}
    </div>
  )
}

/* ============ VIDA PRÓPRIA (ambientes + tagarelice + presença) ============
   A Aurinha vive mesmo sem clique: microcomportamentos visuais (data-ambient),
   frases espontâneas espaçadas e reação a presença (aba/rede). Tudo respeita
   humor ocupado, voo, aba oculta e `prefers-reduced-motion`. */
function useAmbienteDaAurinha(fase: FaseVoo): string | null {
  const [ambiente, setAmbiente] = useState<string | null>(null)
  const faseRef = useRef(fase)
  faseRef.current = fase
  const anteriorRef = useRef<string | null>(null)

  useEffect(() => {
    let vivo = true
    let agendarId = 0
    let limparId = 0
    const movimentoReduzido = () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    const agendar = () => {
      if (!vivo) return
      agendarId = window.setTimeout(() => {
        if (!vivo) return
        const livre = usePet.getState().mood === 'idle'
          && faseRef.current === 'doca'
          && !document.hidden
          && !movimentoReduzido()
        if (livre) {
          const amb = sortearAmbiente(anteriorRef.current)
          anteriorRef.current = amb.id
          setAmbiente(amb.id)
          // Travessia real: ambientes "andantes" pedem ao passeio JS uma
          // ida de borda a borda (o CSS sozinho só mexe o corpinho no lugar).
          if ((AMBIENTES_VIAGEM_LONGA as readonly string[]).includes(amb.id)) {
            pedirViagemLonga(1)
          }
          limparId = window.setTimeout(() => {
            if (vivo) setAmbiente(null)
            agendar()
          }, amb.duracaoMs + 350)
        } else {
          agendar()
        }
      }, sortearIntervaloAmbiente())
    }
    // Nunca empilha dois ambientes: se o humor saiu do idle no meio da
    // apresentação, o efeito abaixo recolhe o atributo para o CSS voltar
    // à patrulha.
    agendar()
    return () => {
      vivo = false
      window.clearTimeout(agendarId)
      window.clearTimeout(limparId)
    }
  }, [])

  // Recolhe o ambiente se algo importante assumir o palco no meio da cena.
  const mood = usePet(s => s.mood)
  useEffect(() => {
    if (mood !== 'idle' && ambiente) setAmbiente(null)
  }, [mood, ambiente])

  return ambiente
}

/** Tagarelice espaçada + presença (aba/rede) — só fala quando está livre. */
function useVidaPropriaDaAurinha(fase: FaseVoo) {
  const faseRef = useRef(fase)
  faseRef.current = fase

  useEffect(() => {
    let vivo = true
    let id = 0
    const podeFalar = () =>
      vivo
      && usePet.getState().mood === 'idle'
      && faseRef.current === 'doca'
      && !document.hidden
      && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const falar = () => {
      if (!vivo) return
      // 75–140 s entre gracinhas: presente, nunca tagarela.
      id = window.setTimeout(() => {
        if (podeFalar() && Math.random() < 0.65) {
          const frase = sortearTagarelice()
          usePet.getState().agir(Math.random() < 0.5 ? 'curious' : 'happy', frase)
        }
        falar()
      }, 75_000 + Math.random() * 65_000)
    }
    falar()
    return () => { vivo = false; window.clearTimeout(id) }
  }, [])

  useEffect(() => {
    let awayDesde = 0
    let ultimaAusencia: string | null = null
    let ultimoRetorno: string | null = null
    const movimentoReduzido = () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const aoVisivel = () => {
      if (movimentoReduzido()) return
      if (document.hidden) {
        // Janela minimizada / aba oculta: ela percebe e comenta (varia sempre).
        awayDesde = Date.now()
        if (usePet.getState().mood === 'idle') {
          ultimaAusencia = fraseAusencia(ultimaAusencia)
          usePet.getState().agir('sleeping', ultimaAusencia)
        }
      } else {
        const awayMs = awayDesde > 0 ? Date.now() - awayDesde : 0
        awayDesde = 0
        if (usePet.getState().mood === 'sleeping') {
          // Varia por tempo fora: curta = oi seco, média = saudade, longa = festa.
          ultimoRetorno = fraseRetorno(awayMs, ultimoRetorno)
          const longa = awayMs >= 5 * 60_000
          usePet.getState().agir(longa ? 'celebrating' : 'waving', ultimoRetorno)
          registrarEventoPet({ tipo: 'despertar' })
        } else if (awayMs >= 30_000 && usePet.getState().mood === 'idle') {
          // Voltou depois de um tempo mas ela não dormiu: cutuca de leve.
          ultimoRetorno = fraseRetorno(awayMs, ultimoRetorno)
          usePet.getState().agir('curious', ultimoRetorno)
        }
      }
    }
    const aoCair = () => { if (usePet.getState().mood === 'idle') usePet.getState().agir('curious', 'Opa, sem internet? Farejo offline!') }
    const aoVoltar = () => { if (usePet.getState().mood === 'curious') usePet.getState().aquietar() }
    document.addEventListener('visibilitychange', aoVisivel)
    window.addEventListener('offline', aoCair)
    window.addEventListener('online', aoVoltar)
    return () => {
      document.removeEventListener('visibilitychange', aoVisivel)
      window.removeEventListener('offline', aoCair)
      window.removeEventListener('online', aoVoltar)
    }
  }, [])
}

/* ============ FALAS DA HORA (elogio + relógio, em tempos aleatórios) ============
   A Aurinha surge do nada com uma fala carismática/divertida, elogiando o
   humano e lendo a hora atual do relógio. Intervalo irregular (45–115 s) +
   chance de 80% por ciclo = viva, nunca mecânica. Só fala quando está livre
   (idle na doca, aba visível, sem `prefers-reduced-motion`). */
function useFalasHoraDaAurinha(fase: FaseVoo) {
  const faseRef = useRef(fase)
  faseRef.current = fase

  useEffect(() => {
    let vivo = true
    let id = 0
    let anterior: string | null = null
    const podeFalar = () =>
      vivo
      && usePet.getState().mood === 'idle'
      && faseRef.current === 'doca'
      && !document.hidden
      && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const agendar = () => {
      if (!vivo) return
      id = window.setTimeout(() => {
        if (podeFalar() && Math.random() < 0.8) {
          const frase = sortearFalaHora(new Date(), anterior)
          anterior = frase
          usePet.getState().agir(sortearHumorFalaHora(), frase)
        }
        agendar()
      }, sortearIntervaloFalaHora())
    }
    agendar()
    return () => { vivo = false; window.clearTimeout(id) }
  }, [])
}

/* ============ LOCOMOÇÃO (passeio pela sidebar + pulinhos) ============
   Dona do eixo X: o JS move `.pet-locomocao` continuamente (rAF, sem
   React state no loop quente — mesmo padrão do voo). Os humores NUNCA
   animam `translateX` do passeio, então trocar de humor ou mostrar/esconder
   o balão não dá snap ("travadinha"): a posição é contínua.
   - Vaga de um lado ao outro da casinha quando `idle` (mede o trilho vivo,
     então anda por TODA a largura da sidebar, aberta ou recolhida);
   - Pulinhos aleatórios a cada 6–14 s + fila da IA: `celebrating` = 3 hops,
     `happy`/`love` = 1 hop (acerto da IA vira festa física);
   - Planta pegadas que somem no `.pet-eco` enquanto anda;
   - `data-loco` (off/parada/andando/pulando) alimenta o CSS (sombra, trote);
   - Respeita voo, aba oculta e `prefers-reduced-motion` (vira `off` e o CSS
     assume o fallback estático). */
function useLocomocaoDaAurinha(
  casaRef: React.RefObject<HTMLDivElement | null>,
  locoRef: React.RefObject<HTMLDivElement | null>,
  aurumRef: React.RefObject<HTMLDivElement | null>,
  fase: FaseVoo,
) {
  const faseRef = useRef(fase)
  faseRef.current = fase

  useEffect(() => {
    let raf = 0
    let vivo = true
    const movimentoReduzido = () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    let x = 0
    let vx = 0 // velocidade atual (px/s) — aceleração + atrito, não constante
    let alvo = 0
    let vel = 40 // cruzeiro alvo (px/s) — sorteado por viagem
    let maxX = 0
    let primeiraMedida = true
    let pausaAte = performance.now() + 900
    let proxPulo = performance.now() + 7000
    let pulo: { t0: number; dur: number; h: number } | null = null
    let filaPulos = 0
    let ultimoPasso = 0
    let ladoPasso = 1
    let quadros = 0
    let ultimo = performance.now()
    let locoAtual = ''

    const definirLoco = (v: string) => {
      if (locoAtual === v) return
      locoAtual = v
      const el = aurumRef.current
      if (el) el.dataset.loco = v
    }

    const medir = (): boolean => {
      const casa = casaRef.current
      const loco = locoRef.current
      if (!casa || !loco) return false
      const cw = casa.clientWidth
      const palco = loco.firstElementChild as HTMLElement | null
      const pw = palco?.getBoundingClientRect().width ?? 72
      const lim = limitesPasseio(cw, pw)
      maxX = lim.max
      x = Math.max(lim.min, Math.min(lim.max, x))
      if (primeiraMedida) {
        primeiraMedida = false
        alvo = escolherAlvo(lim, x)
        vel = velocidadePasseio()
      }
      return true
    }

    const plantarPegada = (agora: number) => {
      if (agora - ultimoPasso < 280) return
      ultimoPasso = agora
      const casa = casaRef.current
      const eco = casa?.querySelector('.pet-eco') ?? null
      if (!eco) return
      if (eco.querySelectorAll('.pet-pegada').length > 12) {
        eco.querySelector('.pet-pegada')?.remove()
      }
      ladoPasso *= -1
      const s = document.createElement('span')
      s.className = 'pet-pegada'
      s.style.left = `calc(50% + ${Math.round(x + ladoPasso * 7)}px)`
      eco.appendChild(s)
      window.setTimeout(() => s.remove(), 1400)
    }

    // Pulinhos combinados ao acerto: a IA comemora, o corpo acompanha.
    const desinscrever = usePet.subscribe((s, ant) => {
      if (s.mood === ant.mood) return
      if (s.mood === 'celebrating') filaPulos += 3
      else if (s.mood === 'happy' || s.mood === 'love') filaPulos += 1
    })

    medir()
    definirLoco(movimentoReduzido() ? 'off' : 'parada')

    const quadro = (agora: number) => {
      if (!vivo) return
      raf = requestAnimationFrame(quadro)
      if (document.hidden) return
      if (movimentoReduzido()) {
        if (locoAtual !== 'off') {
          definirLoco('off')
          const loco = locoRef.current
          if (loco) loco.style.transform = ''
          aurumRef.current?.style.removeProperty('--pet-x')
        }
        return
      }
      const loco = locoRef.current
      const aurum = aurumRef.current
      if (!loco || !aurum || faseRef.current !== 'doca') return
      quadros += 1
      if (quadros % 30 === 0) medir()
      const dt = Math.min(0.05, Math.max(0.001, (agora - ultimo) / 1000))
      ultimo = agora
      const mood = usePet.getState().mood
      const vagar = podeVagar(mood, faseRef.current)
      const pular = podePular(mood, faseRef.current)
      const consultando = podeConsultar(mood, faseRef.current)

      if (!pulo && pular) {
        if (filaPulos > 0) {
          filaPulos -= 1
          const h = alturaPulo()
          pulo = { t0: agora, dur: duracaoPulo(h), h }
        } else if (vagar && agora >= proxPulo) {
          proxPulo = agora + intervaloPuloAleatorio()
          const h = alturaPulo()
          pulo = { t0: agora, dur: duracaoPulo(h), h }
        }
      }

      let y = 0
      let tilt = 0
      let sx = 1
      let sy = 1
      if (pulo) {
        // Balística honesta via `posicaoPulo` — stretch vertical no ar.
        const p = Math.min(1, (agora - pulo.t0) / pulo.dur)
        y = posicaoPulo(p, pulo.h)
        const noAr = p > 0.08 && p < 0.92
        sx = noAr ? 0.96 : 1.06
        sy = noAr ? 1.06 : 0.9
        tilt = inclinacaoPorVelocidade(vx) * 0.4
        if (p >= 1) { pulo = null; y = 0; sx = 1.07; sy = 0.91 } // squash do pouso (1 frame)
        definirLoco('pulando')
      } else if (consultando) {
        // Consulta ativa: anda até a gaveta (lado esquerdo = min) e lê lá.
        // A gaveta abre e o livro aparece via CSS do mood — aqui só os pés.
        const gaveta = -maxX
        const dxG = gaveta - x
        if (Math.abs(dxG) < 2 && Math.abs(vx) < 10) {
          vx = aplicarAtrito(vx, ATRITO_PARADA, dt)
          x += vx * dt
          const q = squashPorVelocidade(Math.abs(vx), true)
          sx = q.sx; sy = q.sy
          tilt = -2 + inclinacaoPorVelocidade(vx) * 0.3
          if (Math.abs(vx) < 0.5) { vx = 0; definirLoco('parada') }
          else definirLoco('andando')
        } else {
          const dirG = Math.sign(dxG)
          const velG = dirG * Math.min(58, Math.max(22, Math.abs(dxG) * 4))
          vx = acelerarPara(vx, velG, ACELERACAO_PASSEIO, dt)
          vx += rajadaVento(agora, 3.7) * dt * 0.4
          vx = Math.max(-VEL_MAX_PASSEIO, Math.min(VEL_MAX_PASSEIO, vx))
          x += vx * dt
          if ((dirG > 0 && x > gaveta) || (dirG < 0 && x < gaveta)) { x = gaveta; vx *= 0.3 }
          const q = squashPorVelocidade(Math.abs(vx))
          sx = q.sx; sy = q.sy
          tilt = inclinacaoPorVelocidade(vx)
          definirLoco('andando')
          plantarPegada(agora)
        }
      } else if (vagar) {
        if (agora < pausaAte) {
          // Parada com atrito: desliza até zero em vez de travar seco.
          vx = aplicarAtrito(vx, ATRITO_PARADA, dt)
          x += vx * dt
          const q = squashPorVelocidade(Math.abs(vx), true)
          sx = q.sx; sy = q.sy
          tilt = inclinacaoPorVelocidade(vx) * 0.5
          if (Math.abs(vx) < 0.5) { vx = 0; definirLoco('parada') }
          else definirLoco('andando')
        } else {
          const dx = alvo - x
          if (Math.abs(dx) < 1.5 && Math.abs(vx) < 12) {
            // Chegou: viagem longa pedida = atravessa SEM pausa (borda oposta,
            // ritmo forte); senão sorteia destino e descansa farejando.
            if (consumirViagemLonga()) {
              alvo = alvoBorda({ min: -maxX, max: maxX }, x)
              vel = 70 + Math.random() * 20
              pausaAte = agora
            } else {
              alvo = escolherAlvo({ min: -maxX, max: maxX }, x)
              vel = Math.min(VEL_MAX_PASSEIO, velocidadePasseio())
              pausaAte = agora + pausaEntreViagens()
            }
            vx = aplicarAtrito(vx, ATRITO_PARADA, dt)
            definirLoco('parada')
          } else {
            // Pedido no meio da viagem: redireciona para a borda oposta.
            if (consumirViagemLonga()) {
              const borda = alvoBorda({ min: -maxX, max: maxX }, x)
              if (Math.abs(borda - x) > 10) {
                alvo = borda
                vel = 70 + Math.random() * 20
                pausaAte = agora
              }
            }
            // Arrancada com aceleração + brisa residual + freio de chegada.
            const dir = Math.sign(alvo - x)
            const dist = Math.abs(alvo - x)
            const velDesejada = dir * Math.min(vel, Math.max(18, dist * 4))
            vx = acelerarPara(vx, velDesejada, ACELERACAO_PASSEIO, dt)
            vx += rajadaVento(agora, 3.7) * dt * 0.6
            vx = Math.max(-VEL_MAX_PASSEIO, Math.min(VEL_MAX_PASSEIO, vx))
            x += vx * dt
            // Não ultrapassa a borda: encosta e zera.
            if ((dir > 0 && x > alvo) || (dir < 0 && x < alvo)) { x = alvo; vx *= 0.3 }
            const q = squashPorVelocidade(Math.abs(vx))
            sx = q.sx; sy = q.sy
            tilt = inclinacaoPorVelocidade(vx)
            definirLoco('andando')
            plantarPegada(agora)
          }
        }
      } else {
        vx = aplicarAtrito(vx, ATRITO_PARADA, dt)
        x += vx * dt
        definirLoco('parada')
      }

      loco.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${tilt.toFixed(2)}deg) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`
      aurum.style.setProperty('--pet-x', `${x.toFixed(1)}px`)
    }
    raf = requestAnimationFrame(quadro)

    return () => {
      vivo = false
      cancelAnimationFrame(raf)
      desinscrever()
    }
  }, [casaRef, locoRef, aurumRef])
}

/* =============================== COMPONENTE ================================ */
export function PetAurum({ recolhida = false }: { recolhida?: boolean }) {
  const mood = usePet(s => s.mood)
  const frase = usePet(s => s.frase)
  const seq = usePet(s => s.seq)
  const eureka = usePet(s => s.eureka)
  const view = useUi(s => s.view)

  // Refs criadas aqui (uma vez por instância do componente)
  const portalRef = useRef<HTMLDivElement>(null)
  const sombraRef = useRef<HTMLDivElement>(null)
  const vooMoveRef = useRef<HTMLDivElement>(null)
  const penduloRef = useRef<HTMLDivElement>(null)
  const casaRef = useRef<HTMLDivElement>(null)
  const locoRef = useRef<HTMLDivElement>(null)
  const aurumRef = useRef<HTMLDivElement>(null)

  // Nuvem de poeira do pouso — o voo avisa o ponto de impacto.
  const [poeira, setPoeira] = useState<{ x: number; baseY: number; chave: number } | null>(null)
  const poeiraTimer = useRef<number>(0)
  const aoPousar = useCallback((cx: number, baseY: number) => {
    if (poeiraTimer.current) window.clearTimeout(poeiraTimer.current)
    setPoeira(p => ({ x: cx, baseY, chave: (p?.chave ?? 0) + 1 }))
    poeiraTimer.current = window.setTimeout(() => setPoeira(null), 1350)
  }, [])
  useEffect(() => () => { if (poeiraTimer.current) window.clearTimeout(poeiraTimer.current) }, [])

  // Hook de voo recebe as refs para manipular DOM diretamente
  const { fase, iniciarArraste, suprimirClickRef } = useVoo({
    portalRef,
    sombraRef,
    vooMoveRef,
    penduloRef,
  }, { onPousar: aoPousar })

  const foraDaCaminha = fase !== 'doca'
  const modoVoo = fase === 'arrastando' || fase === 'retornando'

  useReacoesDaAurinha()
  // Script vivo IA → animações (depois das reações genéricas: a direção rica
  // da IA vence nas transições sobrepostas por last-writer-wins).
  useDirecaoIADaAurinha()
  const ambienteAuto = useAmbienteDaAurinha(fase)
  // Sugestão da IA tem prioridade sobre o sorteio autônomo; fora do idle o
  // palco é do humor (o hook autônomo já recolhe, aqui vale o mesmo).
  const sugerido = usePet(s => s.ambientSugerido)
  const ambiente = mood !== 'idle' || fase !== 'doca' ? null : (sugerido ?? ambienteAuto)
  useVidaPropriaDaAurinha(fase)
  useFalasHoraDaAurinha(fase)
  useLocomocaoDaAurinha(casaRef, locoRef, aurumRef, fase)

  // Olhar segue o cursor (interação natural): escreve --olhar-x/--olhar-y
  // no botão; o CSS (.pet-svg) translada com transição suave. Limitado a
  // ±2.5px para não quebrar o pixel-art. Não interfere no arrasto.
  const olharSegue = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'touch') return
    const el = e.currentTarget
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return
    const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2)
    const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2)
    const cx = Math.max(-1, Math.min(1, dx)) * 2.5
    const cy = Math.max(-1, Math.min(1, dy)) * 2
    el.style.setProperty('--olhar-x', `${cx.toFixed(2)}px`)
    el.style.setProperty('--olhar-y', `${cy.toFixed(2)}px`)
  }, [])
  const olharReseta = useCallback((e: React.PointerEvent<HTMLElement>) => {
    e.currentTarget.style.setProperty('--olhar-x', '0px')
    e.currentTarget.style.setProperty('--olhar-y', '0px')
  }, [])

  return (
    <div ref={aurumRef} className="pet-aurum" data-mood={mood} data-recolhida={recolhida} data-fase={fase} data-view={view} data-ambient={ambiente ?? 'nenhum'} data-loco="parada" data-eureka={eureka ? 'true' : 'false'}>
      {/* Doca na sidebar — SLOT DE TAMANHO FIXO: balão e ecossistema são
          overlays absolutos (nunca empurram o layout), a locomoção move SÓ o
          `.pet-locomocao` via JS contínuo — trocar de humor ou de frase nunca
          dá snap na posição. A caminha vazia tem o mesmo tamanho do botão. */}
      <div ref={casaRef} className="pet-casa">
        {/* Mini ecossistema: tapete, sombra viva, potinho, moeda, biscoito,
            notas e brilhos. Tudo `aria-hidden`, tudo fora do fluxo. */}
        <div className="pet-eco" aria-hidden="true">
          <span className="pet-tapete" />
          <span className="pet-sombra-doca" />
          <span className="pet-pote"><span className="pet-pote-racao" /></span>
          {/* Gaveta de documentos (lado esquerdo): ela abre sozinha quando a
              pet consulta (moods de busca/leitura) e nos ambientes
              `consultar-gaveta` / `ler-livrinho`. O livrinho segue a pet via
              --pet-x, como a sombra da doca. */}
          <span className="pet-gaveta"><span className="pet-gaveta-corpo" /><span className="pet-gaveta-livro" /><span className="pet-gaveta-frente"><span className="pet-gaveta-puxador" /></span></span>
          <span className="pet-livro"><span className="pet-livro-capa" /><span className="pet-livro-pag pet-livro-pag--e" /><span className="pet-livro-pag pet-livro-pag--d" /></span>
          <span className="pet-moeda" />
          <span className="pet-moeda pet-moeda--2" />
          <span className="pet-moeda pet-moeda--3" />
          <span className="pet-biscoito" />
          <span className="pet-nota pet-nota--1">♪</span>
          <span className="pet-nota pet-nota--2">♫</span>
          <span className="pet-brilho pet-brilho--1" />
          <span className="pet-brilho pet-brilho--2" />
          <span className="pet-brilho pet-brilho--3" />
          <span className="pet-vapor pet-vapor--1" />
          <span className="pet-vapor pet-vapor--2" />
          <span className="pet-vapor pet-vapor--3" />
          <span className="pet-borboleta"><span className="pet-borboleta-asa pet-borboleta-asa--e" /><span className="pet-borboleta-asa pet-borboleta-asa--d" /></span>
          <span className="pet-beijo">♥</span>
          <span className="pet-sonho"><span className="pet-sonho-bolha" /><span className="pet-sonho-z">z</span></span>
        </div>
        {/* Balão em overlay — fora do fluxo, acima da pet */}
        {!recolhida && frase ? <div key={seq} className="pet-balao" role="status" aria-live="polite">{frase}</div> : null}
        {recolhida && frase && fase === 'doca' ? <div key={seq} className="pet-balao pet-balao-tooltip" role="status" aria-live="polite">{frase}</div> : null}
        {foraDaCaminha ? (
          <div className="pet-caminha-vazia" aria-hidden="true" />
        ) : (
          <div ref={locoRef} className="pet-locomocao">
          <button
            type="button"
            className="pet-palco"
            onPointerDown={iniciarArraste}
            onPointerMove={olharSegue}
            onPointerLeave={olharReseta}
            onClick={() => {
              if (suprimirClickRef.current) { suprimirClickRef.current = false; return }
              fazerCarinho(); registrarEventoPet({ tipo: 'carinho' })
            }}
            onContextMenu={e => e.preventDefault()}
            onDragStart={e => e.preventDefault()}
            title="Aurinha — clique para carinho, arraste para ela voar"
            aria-label="Aurinha, a pet da Aurum Bit. Clique para carinho, arraste para voar."
          >
            <span className="pet-passeio"><span className="pet-salto"><PetCorpoMemo modoVoo={modoVoo} /></span></span>
          </button>
          </div>
        )}
      </div>

      {/* Sombra projetada no chão (viewport fixed) */}
      <div
        ref={sombraRef}
        className="pet-sombra-chao"
        aria-hidden="true"
        style={{ display: 'none' }}
      />

      {/* Nuvem de poeira do pouso (fixed, acima de tudo, vida curta) */}
      {poeira && typeof document !== 'undefined' ? createPortal(
        <PoeiraPouso key={poeira.chave} x={poeira.x} baseY={poeira.baseY} />,
        document.body,
      ) : null}

      {/* Portal de voo (fixed, acima de tudo) */}
      {modoVoo && typeof document !== 'undefined' ? createPortal(
        <div
          ref={portalRef}
          className="pet-voo"
          data-fase={fase}
          data-mood={mood}
          aria-hidden="true"
        >
          <div ref={vooMoveRef} className="pet-voo-move">
            {/* Vento do retorno: riscos + nuvenzinhas que sobem pela lateral,
                vendendo a descida lenta. Só anima em [data-fase='retornando']. */}
            <div className="pet-vento" aria-hidden="true">
              <span className="pet-vento-risco pet-vento-risco--1" />
              <span className="pet-vento-risco pet-vento-risco--2" />
              <span className="pet-vento-risco pet-vento-risco--3" />
              <span className="pet-vento-risco pet-vento-risco--4" />
              <span className="pet-vento-risco pet-vento-risco--5" />
              <span className="pet-vento-nuvem pet-vento-nuvem--1" />
              <span className="pet-vento-nuvem pet-vento-nuvem--2" />
            </div>
            <div ref={penduloRef} className="pet-voo-pendulo">
              {/* Paraquedas SVG detalhado */}
              <svg className="pet-paraquedas" viewBox="0 0 140 160" aria-hidden="true">
                <defs>
                  <linearGradient id="grad-copa" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#2b3f63" />
                    <stop offset="60%" stopColor="#1e2f4d" />
                    <stop offset="100%" stopColor="#16233a" />
                  </linearGradient>
                  <radialGradient id="grad-brilho" cx="35%" cy="25%" r="60%">
                    <stop offset="0%" stopColor="#3a5a8c" stopOpacity="0.6" />
                    <stop offset="100%" stopColor="#16233a" stopOpacity="0" />
                  </radialGradient>
                </defs>
                <path d="M10 50 Q70 -30 130 50 Q100 35 70 35 Q40 35 10 50 Z" fill="url(#grad-copa)" stroke="#1a2a3a" strokeWidth="2.5" strokeLinejoin="round" />
                <path d="M10 50 Q70 -30 130 50" fill="none" stroke="#1a2a3a" strokeWidth="1.5" strokeDasharray="8 4" opacity="0.4" />
                <path d="M70 35 L70 100" stroke="#1a2a3a" strokeWidth="1.5" strokeDasharray="6 3" opacity="0.5" />
                <ellipse cx="70" cy="25" rx="35" ry="18" fill="url(#grad-brilho)" />
                <g stroke="#241610" strokeWidth="1.8" strokeLinecap="round" opacity="0.9">
                  <line x1="20" y1="50" x2="45" y2="115" />
                  <line x1="38" y1="48" x2="55" y2="115" />
                  <line x1="55" y1="47" x2="68" y2="115" />
                  <line x1="72" y1="47" x2="82" y2="115" />
                  <line x1="85" y1="48" x2="92" y2="115" />
                  <line x1="102" y1="50" x2="100" y2="115" />
                  <line x1="120" y1="50" x2="108" y2="115" />
                </g>
                <ellipse cx="70" cy="115" rx="8" ry="4" fill="#241610" opacity="0.8" />
                <ellipse cx="70" cy="115" rx="5" ry="2.5" fill="#3a2a1a" />
              </svg>
              <div className="pet-voo-boneco"><PetCorpoMemo modoVoo={true} /></div>
            </div>
          </div>
        </div>,
        document.body
      ) : null}

      {/* Nome (só na sidebar aberta) */}
      {!recolhida ? (
        <div className="pet-nome" aria-hidden="true">
          <span className="pet-nome-ponto" /> Aurinha · pet oficial
        </div>
      ) : null}
    </div>
  )
}