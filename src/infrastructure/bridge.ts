/**
 * Ponte entre o renderer e o processo principal do Electron.
 *
 * Em execução pura (web/dev sem Electron) o bridge é `null` e a aplicação
 * cai no fallback HTTP (`fetch`), permitindo rodar no navegador.
 */

export interface BridgeEscolha {
  caminho: string
  nome: string
  /** Conteúdo em base64 (binários) ou texto UTF-8 quando `texto` for verdadeiro. */
  conteudo: string
}

export interface BridgeSalvar {
  nome: string
  conteudo: string
  filtro?: { nome: string; extensoes: string[] }[]
}

/** Documento oficial baixado para leitura dentro do sistema. */
export interface TextoRemoto {
  ok: boolean
  status: number
  urlFinal: string
  contentType: string
  texto: string
}

export interface AurumBridge {
  versao: string
  plataforma: string
  lerArquivo(caminho: string): Promise<string>
  lerArquivoBase64(caminho: string): Promise<string>
  escolherArquivo(filtros: { nome: string; extensoes: string[] }[]): Promise<BridgeEscolha | null>
  escolherPasta(): Promise<string | null>
  salvarArquivo(op: BridgeSalvar): Promise<string | null>
  /**
   * Baixa o HTML de uma norma oficial (canal `rede:buscar-texto`).
   * Só existe no Electron — no navegador, cai no `fetch` direto (sujeito a CORS).
   */
  buscarTexto(url: string): Promise<TextoRemoto>
  /**
   * Guarda o XML importado em `userData/xml/<cnpj>/<chave>.xml`.
   * Devolve o caminho relativo (`<cnpj>/<chave>.xml`) gravado na nota.
   */
  salvarXml(op: { cnpj: string; chave: string; conteudo: string }): Promise<string>
  /** Lê um XML guardado (caminho relativo de `salvarXml`). */
  lerXml(caminho: string): Promise<string>
  /** Remove um XML guardado; inexistente não é erro. */
  removerXml(caminho: string): Promise<void>
  /** Assina eventos de menu nativo (ex.: "abrir", "exportar", "tema"). */
  onMenu(cb: (acao: string) => void): void
}

declare global {
  interface Window {
    aurum?: AurumBridge
  }
}

export const bridge: AurumBridge | null =
  typeof window !== 'undefined' && window.aurum ? window.aurum : null

export const isElectron = (): boolean => bridge !== null

/**
 * Lê um arquivo de base (`public/base` no dev, `dist/base` no pacote).
 * Usa IPC no Electron e `fetch` no navegador.
 */
export async function lerArquivoBase(nome: string): Promise<string> {
  if (bridge) return bridge.lerArquivo(nome)
  const resposta = await fetch(`base/${nome}`, { cache: 'no-cache' })
  if (!resposta.ok) throw new Error(`Arquivo base "${nome}" indisponível (${resposta.status}).`)
  return resposta.text()
}
