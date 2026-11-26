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

/** Versão instalada (para a aba Atualização nas Configurações). */
export interface VersaoApp {
  versao: string
  empacotado: boolean
}

/** Candidato NCM oferecido pelo busca lexical lexical (Top-20 no fluxo real). */
export interface CandidatoBusca {
  codigo: string
  descricao: string
  /** Pontuação do busca lexical (quando vindo de `ia:buscar`). */
  score?: number
}

export interface VerificacaoAtualizacao {
  disponivel: boolean
  versao?: string | null
  mensagem?: string
  notas?: string | null
}

/**
 * Ponte do banco SQLite (canal `db:op` → Prisma no processo main).
 * Opcional: só existe no Electron com o canal registrado. Fora dele o motor
 * usa Prisma direto (Node/testes) ou memória (navegador puro).
 */
export interface DbPonte {
  op(
    req: import('@/infrastructure/db/db-protocolo').DbOp,
  ): Promise<import('@/infrastructure/db/motor').Registro | Array<import('@/infrastructure/db/motor').Registro> | number | string | null>
  /** Snapshot pré-restore (`db:snapshot`): cópia best-effort, nunca lança. */
  snapshotBanco?(): Promise<{ ok: boolean; caminho?: string; erro?: string }>
  /**
   * Lote atômico (`db:transaction` → transação SQLite real no main). Opcional:
   * ausente em builds antigos — o `DriverIpc` lança `ipc:sem-transacao` e o
   * chamador usa o replay sequencial documentado.
   */
  transacao?(ops: import('@/infrastructure/db/db-protocolo').DbOp[]): Promise<unknown[]>
}

/** Eventos do auto-updater repassados pelo processo principal. */
export type EventoAtualizacao =
  | { tipo: 'verificando' }
  | { tipo: 'em-dia' }
  | { tipo: 'disponivel'; versao?: string | null; notas?: string | null }
  | { tipo: 'baixando'; pct: number; baixado?: number; total?: number }
  | { tipo: 'baixada'; versao?: string | null }
  | { tipo: 'erro'; mensagem: string }

export interface AurumBridge {
  versao: string
  plataforma: string
  /**
   * Banco SQLite via processo main (canal `db:op`). Ausente fora do
   * Electron — ver `motor.ts` (fallback Prisma direto / memória).
   */
  db?: DbPonte
  lerArquivo(caminho: string): Promise<string>
  lerArquivoBase64(caminho: string): Promise<string>
  escolherArquivo(filtros: { nome: string; extensoes: string[] }[]): Promise<BridgeEscolha | null>
  escolherPasta(): Promise<string | null>
  salvarArquivo(op: BridgeSalvar): Promise<string | null>
  /**
   * Baixa texto remoto via processo principal (canal `rede:buscar-texto`,
   * sem restrição de CORS): HTML de norma oficial. Só existe no Electron —
   * no navegador, cai no `fetch` direto (sujeito a CORS).
   */
  buscarTexto(url: string): Promise<TextoRemoto>
  /** Assina eventos de menu nativo (ex.: "abrir", "exportar", "tema", "atualizar"). */
  onMenu(cb: (acao: string) => void): void
  /**
   * Atualização do programa (electron-updater + GitHub Releases).
   * É aqui que as bases embutidas (`dist/base`) são renovadas.
   * Fora do Electron, os métodos rejeitam e `onAtualizacao` é inerte.
   */
  versaoApp(): Promise<VersaoApp>
  verificarAtualizacao(): Promise<VerificacaoAtualizacao>
  baixarAtualizacao(): Promise<{ ok: boolean }>
  instalarAtualizacao(): Promise<{ ok: boolean }>
  /** Empilha um ouvinte e devolve a desinscrição. */
  onAtualizacao(cb: (evento: EventoAtualizacao) => void): () => void
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
