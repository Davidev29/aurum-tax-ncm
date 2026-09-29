/**
 * Leitura de legislação **dentro do sistema** (modal, sem sair do app).
 *
 * Por que não só `iframe`? O Planalto envia `X-Frame-Options` e a página da
 * LC 214/2025 tem 5 MB+ — o `iframe` ora bloqueia, ora demora e não ancora.
 * Aqui o HTML é baixado (no Electron, via canal `rede:buscar-texto`, sem
 * restrição de CORS; no navegador, via `fetch` direto), **sanitizado**,
 * renderizado no próprio modal com o artigo citado **grifado de verde** e
 * rolado até ele. O mesmo conteúdo alimenta **Baixar PDF** e **Imprimir**.
 */
import { bridge, type TextoRemoto } from './bridge'

/** Hosts com documento legível (PDF e portal interativo ficam no `iframe`). */
const HOSTS_TEXTO = new Set([
  'www.planalto.gov.br',
  'planalto.gov.br',
  'www.cgibs.gov.br',
  'cgibs.gov.br',
])

/** Dá para ler o documento como texto dentro do sistema? */
export function podeLerNoSistema(url?: string | null): boolean {
  if (!url) return false
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  if (/\.pdf(\?|#|$)/i.test(u.pathname)) return false
  return HOSTS_TEXTO.has(u.hostname.toLowerCase())
}

/** URL sem fragmento (o `#artNNN` só serve para ancorar, não para baixar). */
export function tirarHash(url: string): string {
  const i = url.indexOf('#')
  return i < 0 ? url : url.slice(0, i)
}

/** Baixa o HTML da norma (bridge no Electron, `fetch` no navegador). */
export async function buscarTextoLegislacao(url: string): Promise<TextoRemoto> {
  const alvo = tirarHash(url)
  if (bridge) return bridge.buscarTexto(alvo)
  const resposta = await fetch(alvo, { signal: AbortSignal.timeout(30000) })
  if (!resposta.ok) throw new Error(`Documento indisponível (HTTP ${resposta.status}).`)
  const bruto = new Uint8Array(await resposta.arrayBuffer())
  if (bruto.length > 15_000_000) throw new Error('Documento grande demais para leitura interna.')
  const tipo = resposta.headers.get('content-type') ?? ''
  const charset = /charset=([^;]+)/i.exec(tipo)?.[1]?.trim().toLowerCase() ?? 'utf-8'
  const rotulo =
    charset.includes('8859') || charset.includes('latin') || charset.includes('1252')
      ? 'iso-8859-1'
      : 'utf-8'
  return {
    ok: true,
    status: resposta.status,
    urlFinal: resposta.url || alvo,
    contentType: tipo,
    texto: new TextDecoder(rotulo).decode(bruto),
  }
}

/* ---------------------------------------------------------- sanitização -- */

const TAGS_REMOVER = new Set([
  'script', 'noscript', 'style', 'iframe', 'object', 'embed', 'link', 'meta',
  'base', 'form', 'input', 'button', 'select', 'textarea', 'video', 'audio',
  'canvas', 'img', 'picture', 'source',
])

/**
 * Sanitiza o HTML oficial para exibição segura no modal.
 * Remove executável/externo (`script`, `iframe`, `img`…) e manipuladores
 * (`on*`, `javascript:`), preservando a estrutura do texto legal.
 */
export function sanitizarHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll([...TAGS_REMOVER].join(',')).forEach((el) => el.remove())
  const todos = doc.body.querySelectorAll('*')
  for (const el of todos) {
    for (const attr of [...el.attributes]) {
      const nome = attr.name.toLowerCase()
      if (nome.startsWith('on') || nome === 'style') {
        el.removeAttribute(attr.name)
        continue
      }
      if ((nome === 'href' || nome === 'src') && /^\s*(javascript|data):/i.test(attr.value)) {
        el.removeAttribute(attr.name)
      }
    }
    if (el.tagName === 'A') {
      const href = el.getAttribute('href')
      // Âncoras internas (`#art…`) viram texto — a navegação é do modal.
      if (href && href.startsWith('#')) {
        const span = doc.createElement('span')
        span.innerHTML = el.innerHTML
        el.replaceWith(span)
      } else if (href) {
        el.setAttribute('target', '_blank')
        el.setAttribute('rel', 'noreferrer')
      }
    }
  }
  return doc.body.innerHTML
}

/* ------------------------------------------------------------- destaque -- */

/** Bloco legível mais próximo (o Planalto usa `<p>`, `<font>` e tabelas). */
function blocoDoArtigo(el: Element): Element {
  let atual: Element | null = el
  for (let i = 0; i < 4 && atual; i += 1) {
    const tag = atual.tagName
    if (['P', 'DIV', 'TD', 'LI', 'FONT'].includes(tag) && (atual.textContent?.length ?? 0) > 40) {
      return atual
    }
    atual = atual.parentElement
  }
  return el.parentElement ?? el
}

/**
 * Grifa o artigo citado (`art128`) no HTML sanitizado e marca
 * `id="trecho-citado"` para o scroll do modal. Devolve o HTML final.
 */
export function destacarArtigo(htmlSanitizado: string, ancora: string | null): string {
  if (!ancora) return htmlSanitizado
  const doc = new DOMParser().parseFromString(`<body>${htmlSanitizado}</body>`, 'text/html')
  const id = ancora.toLowerCase()
  let alvo: Element | null = doc.querySelector(`[name="${id}"], [id="${id}"]`)
  if (!alvo) {
    const num = id.replace(/^art/i, '')
    const re = new RegExp(`\\bArt\\.\\s*${num}\\b`, 'i')
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
    let no: Text | null = null
    while ((no = walker.nextNode() as Text | null)) {
      if (re.test(no.nodeValue ?? '')) {
        alvo = no.parentElement
        break
      }
    }
  }
  if (!alvo) return htmlSanitizado
  const bloco = blocoDoArtigo(alvo)
  bloco.setAttribute('id', 'trecho-citado')
  bloco.classList.add('trecho-citado')
  return doc.body.innerHTML
}

/**
 * Extrai o texto corrido do artigo citado (para PDF/impressão).
 * Coleta o bloco do artigo + parágrafos seguintes até o próximo "Art.".
 */
export function extrairTextoArtigo(
  htmlSanitizado: string,
  ancora: string | null,
  limite = 6000,
): string {
  const doc = new DOMParser().parseFromString(`<body>${htmlSanitizado}</body>`, 'text/html')
  const corpo = doc.body.textContent ?? ''
  if (!ancora) return normalizarEspacos(corpo).slice(0, limite)
  const num = ancora.replace(/^art/i, '')
  const re = new RegExp(`Art\\.\\s*${num}\\b[\\s\\S]*?(?=\\bArt\\.\\s*\\d+\\b|$)`, 'i')
  const trecho = re.exec(corpo)?.[0]
  const texto = normalizarEspacos(trecho ?? corpo)
  return texto.slice(0, limite)
}

function normalizarEspacos(s: string): string {
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/* ------------------------------------------------------- pdf / impressão -- */

/** Nome de arquivo seguro: `legislacao-art-128.pdf`. */
export function nomeArquivoLegislacao(artigo: string | null, extensao: string): string {
  const base = artigo ? artigo.toLowerCase().replace(/[^\w]+/g, '-') : 'trecho-citado'
  return `legislacao-${base}.${extensao}`
}

function escaparHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Parágrafos do trecho em HTML de impressão. */
export function trechoParaImpressao(texto: string): string {
  return texto
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escaparHtml(p)}</p>`)
    .join('\n')
}

/**
 * Imprime a ficha do trecho via `iframe` oculto com `srcdoc`.
 * Funciona no navegador e no Electron, sem abrir janelas (o app bloqueia
 * `window.open` e direciona links externos ao navegador).
 */
export function imprimirFicha(htmlImpressao: string, tituloDoc: string): void {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0;'
  frame.srcdoc = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escaparHtml(tituloDoc)}</title></head><body>${htmlImpressao}</body></html>`
  const limpar = () => window.setTimeout(() => frame.remove(), 1000)
  frame.onload = () => {
    try {
      frame.contentWindow?.focus()
      frame.contentWindow?.print()
    } catch {
      /* diálogo de impressão indisponível — mantém o iframe para cópia manual */
      return
    }
    limpar()
  }
  // Rede de segurança: se o `onload` não disparar, remove após 30 s.
  window.setTimeout(() => frame.remove(), 30000)
  document.body.appendChild(frame)
}
