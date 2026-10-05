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

/** Candidato NCM oferecido ao worker IA (Top-5 RAG no fluxo real). */
export interface CandidatoIa {
  codigo: string
  descricao: string
  /** Pontuação do RAG (quando vindo de `ia:buscar`). */
  score?: number
}

/** Decisão do worker IA (`NÃO SEI` sob baixa similaridade/confiança). */
export interface SucessoIaBridge {
  ok: true
  codigo: string
  confianca: number
  motivo: string
  /** AI-first: `false` em produção (modelo real). `true` só fora do Electron/testes. */
  mock: boolean
  candidatos?: CandidatoIa[]
  ms?: number
  ramMB?: number
  /** Presente quando o main respondeu sem worker vivo (legado, `AURUM_AI_FIRST=0`). */
  fallback?: string
  erro?: string
}

/** Falha fechada AI-first: sem modelo real, sem decisão (nunca mock silencioso). */
export interface FalhaIaBridge {
  ok: false
  mock: false
  erro: string
  cmd?: string
  candidatos?: CandidatoIa[]
  ms?: number
}

export type ResultadoIaBridge = SucessoIaBridge | FalhaIaBridge

/** Estado do worker IA (canal `ia:status`). `erro` = AI-first sem modelo real. */
export interface PerfilModeloIa {
  familia: string
  templateChat: string
  contextSize: number
  arquivo?: string | null
}

export interface StatusIaBridge {
  pronto: boolean
  mock: boolean
  modo: 'desligado' | 'mock' | 'modelo' | 'erro'
  modelPath: string | null
  /** Perfil da camada de compatibilidade (família/template/parâmetros). */
  perfil?: PerfilModeloIa | null
  workerPath: string | null
  pid: number | null
  erro: string | null
}

/** Ponte da IA offline (worker `utilityProcess` via processo principal). */
export interface IaBridge {
  classificar(descricao: string, candidatos?: CandidatoIa[]): Promise<ResultadoIaBridge>
  buscar(consulta: string, k?: number): Promise<{ ok: boolean; candidatos: CandidatoIa[]; erro?: string }>
  status(): Promise<StatusIaBridge>
  /**
   * Conversa livre (IA-06, Qwen3 real). `ok:false` quando sem modelo —
   * o renderer cai no template determinístico (fail-closed).
   */
  conversar?(
    pergunta: string,
    opts?: { sistema?: string; historico?: { papel: string; texto: string }[]; think?: boolean; maxTokens?: number; temperature?: number },
  ): Promise<{ ok: boolean; texto?: string; motivo?: string; erro?: string; mock?: boolean }>
}

/** Resultado da verificação de atualizações (electron-updater). */
export interface VerificacaoAtualizacao {
  disponivel: boolean
  versao?: string | null
  mensagem?: string
  notas?: string | null
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
  /**
   * Guarda o XML importado em `userData/xml/<cnpj>/<chave>.xml`.
   * Devolve o caminho relativo (`<cnpj>/<chave>.xml`) gravado na nota.
   */
  salvarXml(op: { cnpj: string; chave: string; conteudo: string }): Promise<string>
  /** Lê um XML guardado (caminho relativo de `salvarXml`). */
  lerXml(caminho: string): Promise<string>
  /** Remove um XML guardado; inexistente não é erro. */
  removerXml(caminho: string): Promise<void>
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
  /**
   * IA offline (Phase 6 / IA-05). Só existe no Electron — fora dele
   * (`window.aurum` ausente) o fluxo usa o fallback local em
   * `src/application/classificacao-ia.ts`.
   */
  ia: IaBridge
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
