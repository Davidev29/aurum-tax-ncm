/**
 * Markdown leve do chat (Aurum AI) — formatação elegante sem dependências.
 *
 * A IA escreve em markdown-lite (`**negrito**`, `` `código` ``, `•` bullets,
 * `1.` numeradas, `##` títulos, `---` divisores). O chat antes exibia o cru
 * (`whitespace-pre-wrap`), então `**NCM ...**` aparecia com asteriscos.
 * Aqui o texto vira elementos React com classes `chat-md-*` (ver `index.css`).
 *
 * Seguro por construção: nunca usa `dangerouslySetInnerHTML` — todo texto
 * passa como children do React (escape automático).
 */
import type { ReactNode } from 'react'

/**
 * Parse inline: `**negrito**` e `` `código` `` → React nodes.
 * `**` não fechado é mantido literal (sem quebrar a linha).
 */
export function inlineChat(raw: string, chave: string): ReactNode[] {
  const out: ReactNode[] = []
  const rx = /(\*\*[^*\n][^*]*\*\*|`[^`\n]+`)/g
  let ultimo = 0
  let m: RegExpExecArray | null
  let i = 0
  rx.lastIndex = 0
  while ((m = rx.exec(raw)) !== null) {
    const ini = m.index
    if (ini > ultimo) out.push(<span key={`${chave}-t${i++}`}>{raw.slice(ultimo, ini)}</span>)
    const tok = m[0]
    if (tok.startsWith('**')) {
      out.push(
        <strong key={`${chave}-b${i++}`} className="chat-md-strong">
          {tok.slice(2, -2)}
        </strong>,
      )
    } else {
      out.push(
        <code key={`${chave}-c${i++}`} className="chat-md-code">
          {tok.slice(1, -1)}
        </code>,
      )
    }
    ultimo = ini + tok.length
  }
  if (ultimo < raw.length) out.push(<span key={`${chave}-t${i++}`}>{raw.slice(ultimo)}</span>)
  return out
}

type BlocoChat =
  | { tipo: 'titulo'; nivel: number; texto: string }
  | { tipo: 'divisor' }
  | { tipo: 'bullet'; itens: string[] }
  | { tipo: 'numero'; itens: string[] }
  | { tipo: 'paragrafo'; texto: string }

/** Agrupa linhas em blocos (títulos, listas, parágrafos). Puro e testável. */
export function blocosChat(texto: string): BlocoChat[] {
  const linhas = String(texto ?? '').replace(/\r\n/g, '\n').split('\n')
  const blocos: BlocoChat[] = []
  let pendBullet: string[] = []
  let pendNumero: string[] = []
  const descarregar = () => {
    if (pendBullet.length) {
      blocos.push({ tipo: 'bullet', itens: pendBullet })
      pendBullet = []
    }
    if (pendNumero.length) {
      blocos.push({ tipo: 'numero', itens: pendNumero })
      pendNumero = []
    }
  }
  for (const cru of linhas) {
    const lin = cru.trimEnd()
    const t = lin.trim()
    if (!t) {
      descarregar()
      continue
    }
    if (/^(-{3,}|\*{3,}|—{3,})$/.test(t)) {
      descarregar()
      blocos.push({ tipo: 'divisor' })
      continue
    }
    const mh = t.match(/^(#{1,3})\s+(.+)$/)
    if (mh) {
      descarregar()
      blocos.push({ tipo: 'titulo', nivel: mh[1].length, texto: mh[2].trim() })
      continue
    }
    const mb = t.match(/^[•\-*▪◦]\s+(.+)$/)
    if (mb) {
      if (pendNumero.length) {
        blocos.push({ tipo: 'numero', itens: pendNumero })
        pendNumero = []
      }
      pendBullet.push(mb[1].trim())
      continue
    }
    const mn = t.match(/^\d{1,2}[.)]\s+(.+)$/)
    if (mn) {
      if (pendBullet.length) {
        blocos.push({ tipo: 'bullet', itens: pendBullet })
        pendBullet = []
      }
      pendNumero.push(mn[1].trim())
      continue
    }
    descarregar()
    // Cada linha não vazia vira um parágrafo próprio: os templates da IA
    // usam uma quebra por seção (`**Rótulo:** ...`), então juntar linhas
    // colaria seções distintas num bloco só.
    blocos.push({ tipo: 'paragrafo', texto: t })
  }
  descarregar()
  return blocos
}

/** Texto do chat com negrito, listas e títulos. */
export function TextoChat({ texto, className }: { texto: string; className?: string }): ReactNode {
  const blocos = blocosChat(texto)
  return (
    <div className={className ?? 'chat-md'}>
      {blocos.map((b, bi) => {
        if (b.tipo === 'divisor') return <hr key={bi} className="chat-md-hr" />
        if (b.tipo === 'titulo') {
          const Tag = b.nivel <= 1 ? 'h4' : b.nivel === 2 ? 'h5' : 'h6'
          return (
            <Tag key={bi} className="chat-md-titulo">
              {inlineChat(b.texto, `h${bi}`)}
            </Tag>
          )
        }
        if (b.tipo === 'bullet') {
          return (
            <ul key={bi} className="chat-md-ul">
              {b.itens.map((it, ii) => (
                <li key={ii} className="chat-md-li">
                  {inlineChat(it, `b${bi}-${ii}`)}
                </li>
              ))}
            </ul>
          )
        }
        if (b.tipo === 'numero') {
          return (
            <ol key={bi} className="chat-md-ol">
              {b.itens.map((it, ii) => (
                <li key={ii} className="chat-md-li">
                  {inlineChat(it, `n${bi}-${ii}`)}
                </li>
              ))}
            </ol>
          )
        }
        return (
          <p key={bi} className="chat-md-p">
            {inlineChat(b.texto, `p${bi}`)}
          </p>
        )
      })}
    </div>
  )
}
