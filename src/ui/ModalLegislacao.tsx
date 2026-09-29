/**
 * `ModalLegislacao` — leitura da norma **dentro do sistema**.
 *
 * Modos de leitura:
 * - **Texto no sistema** (padrão quando possível): o HTML oficial é baixado
 *   (no Electron via canal `rede:buscar-texto`, sem CORS; no navegador via
 *   `fetch`), sanitizado e renderizado no próprio modal, com o artigo citado
 *   **grifado de verde** e scroll automático até ele. PDFs e o portal CFF
 *   (interativo) não têm esse modo.
 * - **Página original** (`iframe` com `#artNNN` + reforço de âncora pós-load):
 *   fallback quando a leitura interna falha ou para documentos sem texto.
 *
 * Ações: **Baixar PDF** (ficha do trecho via pdfMake), **Imprimir** (ficha via
 * `iframe` oculto — funciona no navegador e no Electron, sem abrir janelas),
 * Recarregar e Abrir em nova aba.
 */
import { useEffect, useRef, useState } from 'react'
import { rotuloDestino } from '@/domain/legislacao'
import { toast } from '@/store/ui'
import { Btn, Modal } from './kit'
import {
  buscarTextoLegislacao,
  destacarArtigo,
  extrairTextoArtigo,
  imprimirFicha,
  nomeArquivoLegislacao,
  podeLerNoSistema,
  sanitizarHtml,
  tirarHash,
  trechoParaImpressao,
} from '@/infrastructure/legislacao-texto'

export interface DestinoLegislacao {
  url: string
  /** Ex.: "Art. 128 — Redução de 60%" — exibido como contexto do trecho. */
  titulo?: string | null
  /** Trecho citado no sistema — exibido com marca-texto verde no modal. */
  texto?: string | null
}

/** Tempo máximo de espera pelo documento antes do fallback (ms). */
const TIMEOUT_CARREGAMENTO = 20000

type FaseTexto = 'ocioso' | 'carregando' | 'pronto' | 'falha'

export function ModalLegislacao({
  destino,
  onFechar,
}: {
  destino: DestinoLegislacao | null
  onFechar: () => void
}) {
  // Último destino: mantém o corpo montado durante a animação de saída do
  // `Modal` (180 ms após `destino` virar null) — sem flash de conteúdo vazio.
  const [ultimo, setUltimo] = useState<DestinoLegislacao | null>(destino)
  const [modo, setModo] = useState<'texto' | 'pagina'>('texto')
  const [faseTexto, setFaseTexto] = useState<FaseTexto>('ocioso')
  const [htmlTexto, setHtmlTexto] = useState<string | null>(null)
  const [textoExtraido, setTextoExtraido] = useState<string | null>(null)
  const [avisoPagina, setAvisoPagina] = useState(false)
  const [gerando, setGerando] = useState(false)
  // `iframe` (modo página): estados próprios de loading/falha.
  const [iframeCarregando, setIframeCarregando] = useState(false)
  const [iframeFalhou, setIframeFalhou] = useState(false)
  /** Incrementado pelo botão "Recarregar" — única situação que remonta o iframe. */
  const [geracao, setGeracao] = useState(0)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const leituraRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<number | null>(null)

  const aberto = destino !== null
  const visivel = destino ?? ultimo
  const titulo = visivel?.titulo?.trim() || 'Legislação'
  const artigo = extrairArtigo(visivel?.url)
  const elegivelTexto = podeLerNoSistema(visivel?.url)
  const trechoPdf = textoExtraido?.trim() || visivel?.texto?.trim() || ''

  // Novo destino → estado limpo; tenta a leitura interna quando elegível.
  const urlAtual = destino?.url ?? null
  useEffect(() => {
    if (!urlAtual) return
    setUltimo(destino)
    setHtmlTexto(null)
    setTextoExtraido(null)
    setAvisoPagina(false)
    setIframeFalhou(false)
    if (podeLerNoSistema(urlAtual)) {
      setModo('texto')
      setFaseTexto('carregando')
    } else {
      setModo('pagina')
      setFaseTexto('ocioso')
      setIframeCarregando(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlAtual])

  // Busca + sanitiza + grifa o artigo (modo texto).
  useEffect(() => {
    if (faseTexto !== 'carregando' || !urlAtual) return
    let vivo = true
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      if (!vivo) return
      setFaseTexto('falha')
      setModo('pagina')
      setAvisoPagina(true)
      setIframeCarregando(true)
    }, TIMEOUT_CARREGAMENTO)
    void (async () => {
      try {
        const remoto = await buscarTextoLegislacao(urlAtual)
        if (!vivo) return
        const limpo = sanitizarHtml(remoto.texto)
        const anc = ancoraDe(urlAtual)
        if (timerRef.current) window.clearTimeout(timerRef.current)
        setHtmlTexto(destacarArtigo(limpo, anc))
        setTextoExtraido(extrairTextoArtigo(limpo, anc))
        setFaseTexto('pronto')
      } catch {
        if (!vivo) return
        if (timerRef.current) window.clearTimeout(timerRef.current)
        setFaseTexto('falha')
        setModo('pagina')
        setAvisoPagina(true)
        setIframeCarregando(true)
      }
    })()
    return () => {
      vivo = false
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faseTexto, urlAtual, geracao])

  // Leitura pronta → rola até o trecho grifado.
  useEffect(() => {
    if (faseTexto !== 'pronto' || modo !== 'texto') return
    const t = window.setTimeout(() => {
      leituraRef.current
        ?.querySelector('#trecho-citado')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 250)
    return () => window.clearTimeout(t)
  }, [faseTexto, modo, htmlTexto])

  const tentarTexto = () => {
    setAvisoPagina(false)
    setModo('texto')
    setFaseTexto('carregando')
  }

  /* ------------------------------------------------- iframe (página) -- */

  /** Documento pronto → esconde o loading e reforça a âncora. */
  const aoCarregarIframe = () => {
    setIframeCarregando(false)
    reforcarAncora()
  }

  const aoFalharIframe = () => {
    setIframeCarregando(false)
    setIframeFalhou(true)
  }

  /**
   * Reforça o scroll até `#artNNN` após o load.
   * Atribuir `location.hash` é permitido cross-origin (navegação por
   * fragmento, sem leitura do DOM) e não recarrega a página.
   */
  const reforcarAncora = () => {
    const hash = hashDe(visivel?.url)
    const frame = iframeRef.current
    if (!hash || !frame?.contentWindow) return
    for (const espera of [400, 1500]) {
      window.setTimeout(() => {
        try {
          frame.contentWindow!.location.hash = hash
        } catch {
          /* cross-origin restrito — o src com # já tentou ancorar */
        }
      }, espera)
    }
  }

  const recarregar = () => {
    if (modo === 'texto' && elegivelTexto) {
      setFaseTexto('carregando')
      return
    }
    setIframeFalhou(false)
    setIframeCarregando(true)
    setGeracao((g) => g + 1)
  }

  /* --------------------------------------------------- pdf / impressão -- */

  /** Ficha do trecho citado (base do PDF e da impressão). */
  const ficha = (): { tituloFicha: string; corpo: string } | null => {
    if (!visivel || !trechoPdf) return null
    return {
      tituloFicha: `${titulo} — ${artigo ?? 'trecho citado'}`,
      corpo: trechoPdf,
    }
  }

  const baixarPdf = async () => {
    const f = ficha()
    if (!f || !visivel) {
      toast('Nenhum trecho disponível para o PDF.', 'warn')
      return
    }
    setGerando(true)
    try {
      const { baixarPdf: baixar } = await import('@/infrastructure/pdf/setup')
      const data = new Date().toLocaleDateString('pt-BR')
      await baixar(
        {
          content: [
            { text: 'Aurum Tax NCM — Trecho de legislação', style: 'cab' },
            { text: titulo, style: 'titulo' },
            {
              text: `Trecho citado: ${artigo ?? rotuloDestino(visivel.url)}`,
              style: 'artigo',
            },
            { text: `Fonte oficial: ${tirarHash(visivel.url)}`, style: 'fonte' },
            { text: `Consultado em ${data} pelo sistema.`, style: 'fonte' },
            { text: f.corpo, style: 'corpo' },
            {
              text: 'Gerado pelo sistema para conferência do enquadramento. Leia a norma na íntegra na fonte oficial.',
              style: 'nota',
            },
          ],
          styles: {
            cab: { fontSize: 9, bold: true, color: '#64748b', margin: [0, 0, 0, 4] },
            titulo: { fontSize: 15, bold: true, margin: [0, 0, 0, 2] },
            artigo: { fontSize: 11, bold: true, color: '#047857', margin: [0, 0, 0, 6] },
            fonte: { fontSize: 8, color: '#64748b', margin: [0, 0, 0, 1] },
            corpo: { fontSize: 10, margin: [0, 10, 0, 10] },
            nota: { fontSize: 8, italics: true, color: '#64748b' },
          },
        },
        nomeArquivoLegislacao(artigo, 'pdf'),
      )
      toast('PDF do trecho baixado.', 'ok')
    } catch (e) {
      toast(`Falha ao gerar o PDF: ${e instanceof Error ? e.message : String(e)}`, 'err')
    } finally {
      setGerando(false)
    }
  }

  const imprimir = () => {
    const f = ficha()
    if (!f || !visivel) {
      toast('Nenhum trecho disponível para impressão.', 'warn')
      return
    }
    const data = new Date().toLocaleDateString('pt-BR')
    imprimirFicha(
      `<div style="font-family:Arial,sans-serif;max-width:720px;margin:0 auto;color:#111">` +
        `<div style="font-size:11px;color:#64748b;font-weight:bold">Aurum Tax NCM — Trecho de legislação</div>` +
        `<h1 style="font-size:18px;margin:4px 0">${titulo.replace(/</g, '&lt;')}</h1>` +
        `<div style="display:inline-block;background:#6ee7b7;font-weight:bold;font-size:12px;padding:2px 10px;border-radius:6px;margin:4px 0">ARTIGO: ${(artigo ?? 'trecho citado').toUpperCase()}</div>` +
        `<div style="font-size:11px;color:#475569">Fonte oficial: ${tirarHash(visivel.url)} · Consultado em ${data}</div>` +
        `<hr style="margin:12px 0">` +
        `<div style="font-size:12.5px;line-height:1.7">${trechoParaImpressao(f.corpo)}</div>` +
        `<hr style="margin:12px 0"><div style="font-size:10px;color:#64748b;font-style:italic">Gerado pelo sistema para conferência do enquadramento. Leia a norma na íntegra na fonte oficial.</div>` +
        `</div>`,
      f.tituloFicha,
    )
  }

  /* ---------------------------------------------------------------- corpo -- */

  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo={`📖 ${titulo}`}
      subtitulo={visivel ? rotuloDestino(visivel.url) : undefined}
      largura="max-w-5xl"
      rodape={
        <>
          <Btn onClick={onFechar}>Fechar</Btn>
          {visivel ? (
            <>
              <Btn onClick={recarregar}>↻ Recarregar</Btn>
              <a
                href={visivel.url}
                target="_blank"
                rel="noreferrer"
                className="btn btn-press btn-primary btn-sm"
              >
                ↗ Abrir em nova aba
              </a>
            </>
          ) : null}
        </>
      }
    >
      {visivel ? (
        <div className="space-y-3">
          {/* Marca-texto verde: o artigo/trecho citado, visível de relance. */}
          <div className="rounded-xl border-2 border-emerald-400 bg-emerald-50 p-3 dark:border-emerald-600 dark:bg-emerald-950/40">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-emerald-400 px-2 py-0.5 font-mono text-xs font-black uppercase tracking-wide text-emerald-950">
                ✳ {artigo ?? 'trecho citado'}
              </span>
              <span className="text-xs font-bold text-emerald-900 dark:text-emerald-100">
                <mark className="rounded bg-emerald-300/80 px-1 text-inherit">{titulo}</mark>
              </span>
            </div>
            {visivel.texto?.trim() ? (
              <p className="mt-2 text-[11px] leading-relaxed text-emerald-900 dark:text-emerald-100">
                <mark className="rounded bg-emerald-200/90 px-1 leading-relaxed text-inherit dark:bg-emerald-800 dark:text-emerald-50">
                  {visivel.texto.trim()}
                </mark>
              </p>
            ) : null}
          </div>

          {/* Barra de leitura: alterna texto interno/página + PDF + impressão. */}
          <div className="flex flex-wrap items-center gap-2">
            {elegivelTexto ? (
              <>
                <Btn
                  tam="sm"
                  variante={modo === 'texto' ? 'primary' : 'ghost'}
                  onClick={() => (faseTexto === 'falha' ? tentarTexto() : setModo('texto'))}
                >
                  📖 Texto no sistema
                </Btn>
                <Btn
                  tam="sm"
                  variante={modo === 'pagina' ? 'primary' : 'ghost'}
                  onClick={() => {
                    setModo('pagina')
                    setIframeFalhou(false)
                    setIframeCarregando(true)
                    setGeracao((g) => g + 1)
                  }}
                >
                  🌐 Página original
                </Btn>
              </>
            ) : null}
            <span className="mx-1 hidden h-5 w-px bg-slate-200 sm:inline dark:bg-slate-700" />
            <Btn tam="sm" disabled={!trechoPdf || gerando} onClick={() => void baixarPdf()} title="Baixar a ficha do trecho citado em PDF">
              ⬇ {gerando ? 'Gerando…' : 'Baixar PDF'}
            </Btn>
            <Btn tam="sm" disabled={!trechoPdf} onClick={imprimir} title="Imprimir a ficha do trecho citado">
              🖨 Imprimir
            </Btn>
          </div>

          {modo === 'texto' && faseTexto === 'carregando' ? (
            <div
              className="grid min-h-[40vh] place-items-center rounded-xl border border-[var(--line)] bg-white dark:bg-slate-950"
              role="status"
              aria-label="Carregando legislação"
            >
              <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
                <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-brand-500 border-t-transparent" />
                <div className="text-sm font-bold text-slate-700 dark:text-slate-200">
                  Carregando legislação…
                </div>
                <div className="max-w-sm text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                  Localizando {artigo ?? 'o trecho citado'} no documento oficial, sem sair do
                  sistema. A LC 214/2025 é extensa e pode levar alguns segundos.
                </div>
              </div>
            </div>
          ) : null}

          {modo === 'texto' && faseTexto === 'pronto' && htmlTexto ? (
            <div
              ref={leituraRef}
              className="leitura-norma scroll-elegante h-[62vh] overflow-y-auto rounded-xl border border-[var(--line)] bg-white p-5 dark:bg-slate-950"
              dangerouslySetInnerHTML={{ __html: htmlTexto }}
            />
          ) : null}

          {modo === 'pagina' ? (
            <div className="space-y-3">
              {avisoPagina ? (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  ⚠ A leitura dentro do sistema falhou (rede ou bloqueio do site oficial).
                  Exibindo a página original abaixo — ou use{' '}
                  <strong>“Abrir em nova aba”</strong>.{' '}
                  {elegivelTexto ? (
                    <button type="button" className="font-bold underline" onClick={tentarTexto}>
                      Tentar leitura interna de novo
                    </button>
                  ) : null}
                </div>
              ) : (
                <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                  O documento abaixo abre <strong>direto no trecho citado</strong>
                  {artigo ? (
                    <>
                      {' '}(<strong>{artigo}</strong>)
                    </>
                  ) : (
                    <> ({rotuloDestino(visivel.url)})</>
                  )}
                  . Aguarde o carregamento — a LC 214/2025 é um documento extenso.
                </p>
              )}
              {iframeFalhou ? (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  ⚠ O site oficial bloqueou a exibição embutida. Clique em{' '}
                  <strong>“Abrir em nova aba”</strong> para ler a norma na íntegra.
                </div>
              ) : null}
              <div className="legislacao-frame relative overflow-hidden rounded-xl border border-[var(--line)] bg-white dark:bg-slate-950">
                <iframe
                  // Sem key=url de propósito: atualizar `src` não remonta o elemento
                  // (era a causa do piscar). Só `geracao` (recarregar) remonta.
                  key={geracao}
                  ref={iframeRef}
                  src={visivel.url}
                  title={titulo}
                  className={`h-[62vh] w-full bg-white dark:bg-slate-950 ${iframeCarregando ? 'invisible' : ''}`}
                  onLoad={aoCarregarIframe}
                  onError={aoFalharIframe}
                />
                {iframeCarregando ? (
                  <div
                    className="absolute inset-0 grid place-items-center bg-white dark:bg-slate-950"
                    role="status"
                    aria-label="Carregando legislação"
                  >
                    <div className="flex flex-col items-center gap-3 px-6 text-center">
                      <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-brand-500 border-t-transparent" />
                      <div className="text-sm font-bold text-slate-700 dark:text-slate-200">
                        Carregando legislação…
                      </div>
                      <div className="max-w-sm text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                        Localizando {artigo ?? 'o trecho citado'} no documento oficial.
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  )
}

/* --------------------------------------------------------------- helpers -- */

function hashDe(url?: string | null): string | null {
  if (!url) return null
  const i = url.indexOf('#')
  if (i < 0 || i === url.length - 1) return null
  return url.slice(i + 1)
}

/** "…lcp214.htm#art128" → "art128" (âncora para busca e grifo). */
function ancoraDe(url?: string | null): string | null {
  const h = hashDe(url)
  if (!h) return null
  const m = h.match(/^art\.?\s*(\d{1,3})/i)
  return m ? `art${m[1]}` : null
}

/** "…lcp214.htm#art128" → "art. 128" (rótulo amigável). */
function extrairArtigo(url?: string | null): string | null {
  const a = ancoraDe(url)
  if (!a) return null
  const m = a.match(/^art(\d{1,3})$/i)
  return m ? `art. ${m[1]}` : null
}
