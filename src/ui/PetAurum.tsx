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
import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useCalculadora } from '@/store/calculadora'
import { useConsulta } from '@/store/consulta'
import { FRASE_POR_VIEW, FRASES_CALCULANDO, fazerCarinho, usePet } from '@/store/pet'
import {
  fraseFarejando,
  fraseNcmInvalido,
  fraseResultadoBusca,
} from '@/store/pet-farejo'
import { registrarEventoPet, saudacaoInicialPet } from '@/store/pet-ia'
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

/** Boneco puro (usado na doca e no portal de voo). */
function PetCorpo({ modoVoo = false }: { modoVoo?: boolean }) {
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
    </>
  )
}

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
        const kPos = 1 - Math.exp(-dt * 0.35) // ~0.30 a 60fps: glide macio
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
      usePet.getState().agir('retornando', 'Voltando pra caminha!')

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
      const ALTURA_PLANEIO = 170
      const ESCALA_INICIAL = 1.05
      const ESCALA_FINAL = 1.0

      const alvoInicial = medirDocaViva()
      const distTotal = Math.max(1, alvoInicial
        ? Math.hypot(px - alvoInicial.x, py - (alvoInicial.y - ALTURA_PLANEIO))
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
      const pousarComAssentamento = () => {
        cancelAnimationFrame(rafRef.current)
        const alvo = medirDocaViva()
        if (!alvo) { finalizar(false); return }
        try { portalRef.current?.setAttribute('data-pouso', 'true') } catch { /* noop */ }
        try { onPousarRef.current?.(alvo.cx, alvo.baseY) } catch { /* noop */ }
        if (vooMoveRef.current) vooMoveRef.current.style.transformOrigin = '50% 100%'
        atualizarPortalDOM(alvo.x, alvo.y, 0, 1.08, 0.9)
        atualizarSombraDOM(alvo.cx, alvo.baseY, 0)
        assentamentoRef.current = window.setTimeout(() => {
          const a2 = medirDocaViva() ?? alvo
          atualizarPortalDOM(a2.x, a2.y, 0, 0.98, 1.03)
          assentamentoRef.current = window.setTimeout(() => {
            const a3 = medirDocaViva() ?? a2
            atualizarPortalDOM(a3.x, a3.y, 0, 1, 1)
            finalizar(true)
          }, 130)
        }, 130)
      }

      // Failsafe: nunca prende a pet fora da caminha.
      timeoutRef.current = window.setTimeout(() => {
        cancelAnimationFrame(rafRef.current)
        finalizar(false)
      }, 4000)

      function passo(agora: number) {
        const anterior = passoRef.current || agora
        const dtNorm = Math.max(0.5, Math.min(2, (agora - anterior) / 16.67))
        passoRef.current = agora

        const alvo = medirDocaViva()
        if (!alvo) { finalizar(false); return }

        if (!emDescida) {
          // ——— PLANEIO até o ponto acima da doca ———
          const gx = alvo.x
          const gy = alvo.y - ALTURA_PLANEIO
          const dx = gx - px
          const dy = gy - py
          const distPlaneio = Math.hypot(dx, dy)
          const speed = Math.hypot(vx, vy)

          if ((distPlaneio < 36 && speed < 4) || agora - t0 > 2000) {
            emDescida = true
            inicioDescida = agora
            vx *= 0.4
            vy = Math.min(Math.max(vy * 0.3, 0), 2)
            angulo *= 0.5
            velAngular = 0
          } else {
            vx += dx * 0.011 - vx * 0.12
            vy += dy * 0.011 - vy * 0.12
            const sp = Math.hypot(vx, vy)
            if (sp > 18) { vx = (vx / sp) * 18; vy = (vy / sp) * 18 }

            velAngular += vx * 0.0016 * dtNorm
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

        // ——— DESCIDA vertical, lenta e aprumada ———
        const dx = alvo.x - px
        const dy = alvo.y - py
        const distRest = Math.hypot(dx, dy)
        const speed = Math.hypot(vx, vy)

        if ((distRest < 7 && speed < 2.0) || agora - inicioDescida > 2000) {
          pousarComAssentamento()
          return
        }

        vx += dx * 0.03 - vx * 0.3
        vy += dy * 0.015 - vy * 0.18
        // Teto de descida: flutua para baixo, sem mergulho nem subida.
        vx = Math.max(-3, Math.min(3, vx))
        vy = Math.max(-1.5, Math.min(3.0, vy))

        // Apruma o balanço para tocar a caminha zerada.
        velAngular += vx * 0.0012 * dtNorm
        velAngular *= 0.88
        angulo += velAngular * dtNorm
        angulo = Math.max(-0.12, Math.min(0.12, angulo))
        angulo *= 1 - 0.15 * dtNorm

        px += vx * dtNorm
        py += vy * dtNorm

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
        agirRef.current('thinking', fraseFarejando(termo) ?? fraseAleatoria(FRASES_PENSANDO))
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
        if (termo.trim() && ['idle', 'reading', 'thinking', 'curious'].includes(usePet.getState().mood)) {
          agirRef.current('curious', fraseResultadoBusca(termo, {
            oficiais, textos, temSugestao, primeiroCodigo,
          }))
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
    const TIPOS_CAMPO = ['INPUT', 'TEXTAREA', 'SELECT']
    const naCalculadora = () => useUi.getState().view === 'calculadora'
    const adiar = () => { if (tSoneca) clearTimeout(tSoneca); tSoneca = setTimeout(() => { if (usePet.getState().mood !== 'sleeping') agirRef.current('sleeping', 'Zzz…') }, 75_000) }
    const acordar = () => { if (usePet.getState().mood === 'sleeping') { agirRef.current('waving', 'Voltei! Sentiu saudade?'); registrarEventoPet({ tipo: 'despertar' }); adiar(); return true } return false }
    const fraseCampo = () => naCalculadora() ? fraseAleatoria(FRASES_CALCULANDO) : fraseAleatoria(FRASES_LEITURA)
    const humorCampo = () => naCalculadora() ? 'calculating' as const : 'reading' as const
    const focar = (e: FocusEvent) => { adiar(); if (acordar()) return; const a = e.target as HTMLElement; if (!a) return; if (TIPOS_CAMPO.includes(a.tagName) && !['checkbox', 'radio', 'button'].includes((a as HTMLInputElement).type) && ['idle', 'reading', 'calculating'].includes(usePet.getState().mood)) agirRef.current(humorCampo(), fraseCampo()) }
    const digitar = (e: Event) => { adiar(); if (acordar()) return; const a = e.target as HTMLElement; if (!a) return; if (['INPUT', 'TEXTAREA'].includes(a.tagName) && ['idle', 'reading', 'calculating'].includes(usePet.getState().mood)) agirRef.current(humorCampo(), fraseCampo()) }
    const clicar = (e: MouseEvent) => { adiar(); if (acordar()) return; const b = (e.target as HTMLElement)?.closest?.('button,a,[role="button"]'); if (!b || b.closest('.pet-aurum')) return; const texto = (b.textContent ?? '').toLowerCase(); if (/pdf|excel|exportar|relat/.test(texto)) { agirRef.current('celebrating', 'Relatório prontinho!'); return } const ag = Date.now(); if (ag - ult < 4000) return; ult = ag; if (/copiar|copiado|copied/.test(texto)) { if (['idle', 'happy', 'reading', 'calculating'].includes(usePet.getState().mood)) agirRef.current('happy', 'Copiado! Farejei tudinho!'); return } if (/salvar|guardar/.test(texto)) { if (['idle', 'happy', 'reading', 'calculating'].includes(usePet.getState().mood)) agirRef.current('happy', 'Guardadinho!'); return } }
    const teclar = () => { adiar(); acordar() }
    adiar()
    document.addEventListener('focusin', focar)
    document.addEventListener('input', digitar, { capture: true })
    document.addEventListener('click', clicar)
    document.addEventListener('keydown', teclar)
    document.addEventListener('pointermove', adiar, { passive: true })
    return () => { if (tSoneca) clearTimeout(tSoneca); document.removeEventListener('focusin', focar); document.removeEventListener('input', digitar, { capture: true } as EventListenerOptions); document.removeEventListener('click', clicar); document.removeEventListener('keydown', teclar); document.removeEventListener('pointermove', adiar) }
  }, [])

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null
    const obs = new MutationObserver(() => {
      const c = document.querySelector('.btn-spinner, .loading-bar')
      if (c && usePet.getState().mood === 'idle') { agirRef.current('thinking', fraseAleatoria(FRASES_PENSANDO)); if (t) clearTimeout(t); t = setTimeout(() => { if (usePet.getState().mood === 'thinking') usePet.getState().aquietar() }, 5200) }
    })
    obs.observe(document.body, { childList: true, subtree: true })
    return () => { obs.disconnect(); if (t) clearTimeout(t) }
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

/* =============================== COMPONENTE ================================ */
export function PetAurum({ recolhida = false }: { recolhida?: boolean }) {
  const mood = usePet(s => s.mood)
  const frase = usePet(s => s.frase)
  const seq = usePet(s => s.seq)
  const view = useUi(s => s.view)

  // Refs criadas aqui (uma vez por instância do componente)
  const portalRef = useRef<HTMLDivElement>(null)
  const sombraRef = useRef<HTMLDivElement>(null)
  const vooMoveRef = useRef<HTMLDivElement>(null)
  const penduloRef = useRef<HTMLDivElement>(null)
  const casaRef = useRef<HTMLDivElement>(null)

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

  return (
    <div className="pet-aurum" data-mood={mood} data-recolhida={recolhida} data-fase={fase} data-view={view}>
      {/* Balão */}
      {!recolhida && frase ? <div key={seq} className="pet-balao" role="status" aria-live="polite">{frase}</div> : null}
      {recolhida && frase && fase === 'doca' ? <div key={seq} className="pet-balao pet-balao-tooltip" role="status" aria-live="polite">{frase}</div> : null}

      {/* Doca na sidebar */}
      <div ref={casaRef} className="pet-casa">
        {foraDaCaminha ? (
          <div className="pet-caminha-vazia" aria-hidden="true" />
        ) : (
          <button
            type="button"
            className="pet-palco"
            onPointerDown={iniciarArraste}
            onClick={() => {
              if (suprimirClickRef.current) { suprimirClickRef.current = false; return }
              fazerCarinho(); registrarEventoPet({ tipo: 'carinho' })
            }}
            onContextMenu={e => e.preventDefault()}
            onDragStart={e => e.preventDefault()}
            title="Aurinha — clique para carinho, arraste para ela voar"
            aria-label="Aurinha, a pet da Aurum Bit. Clique para carinho, arraste para voar."
          >
            <span className="pet-passeio"><span className="pet-salto"><PetCorpo modoVoo={modoVoo} /></span></span>
          </button>
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
              <div className="pet-voo-boneco"><PetCorpo modoVoo={true} /></div>
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