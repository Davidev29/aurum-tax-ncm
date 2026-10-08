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

/** Candidato NCM oferecido pelo RAG lexical (Top-20 no fluxo real). */
export interface CandidatoIa {
  codigo: string
  descricao: string
  /** Pontuação do RAG (quando vindo de `ia:buscar`). */
  score?: number
  /**
   * Trilha do grafo (Phase 10-05 / GRAFO-05): caminho multi-hop + cypher +
   * proveniência + boost. Presente SÓ quando o candidato veio do grafo
   * (`via:grafo`); lexical puro nunca carrega estes campos (fallback
   * bit-idêntico).
   */
  caminhoGrafo?: string[]
  provenienciaGrafo?: Array<{
    de: string
    para: string
    tipo: string
    origem: string
    confianca: number
    anoReferencia?: number | null
  }>
  cypherGrafo?: string
  boostGrafo?: 'uso_local' | null
  boostValorGrafo?: number
  viaGrafo?: boolean
}

/** Ponte da busca local (grafo fiscal via processo principal). */
export interface IaBridge {
  /**
   * Grafo fiscal local (Phase 10-02 / GRAFO-02): FTS + expansão 2-hops com
   * caminho auditável (`via:grafo` em 10-05). Sem `.lbug` → `ok:false` +
   * `fallback:'lexical'`. Opcional (builds antigos não expõem `ia:grafo`).
   */
  grafoConsultar?(texto: string, k?: number, anoReferencia?: number, opts?: { modoVetor?: 'hibrido' | 'fts-puro' }): Promise<ResultadoGrafoBridge>
  /**
   * Overlay de aprendizado local (Phase 10-05 / GRAFO-08): registra uso
   * (`escolha em <select>` lote/consulta, `ia_feedback` ±, CNAE via CNPJ).
   * Best-effort, nunca lança — sem canal vira no-op.
   */
  registrarUsoGrafo?(evento: {
    tipo: string
    termo?: string | null
    codigo?: string | null
    emitente?: string | null
    peso?: number
  }): Promise<{ ok: boolean; erro?: string }>
}

/** Candidato do grafo com caminho multi-hop auditável. */
export interface CandidatoGrafo {
  codigo: string
  tipo: string
  descricao: string
  /** Ranking interno (base + boost, teto 0.3) — NUNCA confiança fiscal. */
  score: number
  caminho: string[]
  /**
   * Proveniência por aresta do caminho (origem + confiança + ano).
   * OBRIGATÓRIA para exibir o caminho (nunca exibir sem proveniência).
   */
  proveniencia?: Array<{
    de: string
    para: string
    tipo: string
    origem: string
    confianca: number
    anoReferencia?: number | null
  }>
  /** Decomposição do ranking p/ debug (Phase 10-03 / GRAFO-03). */
  scores?: { fts: number; vetor: number; pagerank: number }
  /** Base antes do boost de uso local. */
  scoreBase?: number
  /** Comunidade Louvain-lite (scoping por capítulo/grupo). */
  comunidade?: string
  /** Origem do boost aplicado (`uso_local` do overlay, ou null). */
  boost?: 'uso_local' | null
  /** Valor do boost aplicado (já com teto 0.3). */
  boostValor?: number
}

/** Resposta do canal `ia:grafo` (fail-closed: sem `.lbug` → fallback lexical). */
export interface ResultadoGrafoBridge {
  ok: boolean
  candidatos: CandidatoGrafo[]
  caminhos: string[][]
  cypher: string
  tempoMs: number
  modo?: 'lbug' | 'json-fallback'
  /** `hnsw` = FTS+vetor+PageRank; `fts-puro` = sem índice vetorial. */
  modoVetor?: 'hnsw' | 'fts-puro'
  /** Metadados do índice vetorial lateral (null em FTS-puro). */
  embedding?: { modo: string; modelo: string; dim: number; totalVetores: number } | null
  fallback?: string
  motivo?: string
  erro?: string
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
   * Busca local (grafo fiscal via processo principal). Só existe no
   * Electron — fora dele (`window.aurum` ausente) o fluxo usa o Top-20
   * lexical em `src/application/classificacao-ia.ts`.
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
 * Consulta o grafo fiscal local (Phase 10-02 / GRAFO-02), null-safe: fora do
 * Electron (`window.aurum` ausente) ou sem canal `ia:grafo`, devolve
 * `{ ok:false, fallback:'lexical' }` — o chamador usa o Top-20 lexical atual
 * (comportamento pré-grafo, bit-idêntico). NUNCA lança.
 */
export async function grafoConsultarGrafo(
  texto: string,
  k = 5,
  anoReferencia?: number,
  opts?: { modoVetor?: 'hibrido' | 'fts-puro' },
): Promise<ResultadoGrafoBridge> {
  const vazio: ResultadoGrafoBridge = {
    ok: false,
    candidatos: [],
    caminhos: [],
    cypher: '',
    tempoMs: 0,
    fallback: 'lexical',
  }
  try {
    const { removerPII } = await import('@/ai/guards')
    const textoLimpo = removerPII(texto)
    const fn = bridge?.ia?.grafoConsultar
    if (typeof fn !== 'function') return vazio
    const r = (await fn.call(bridge!.ia, textoLimpo, k, anoReferencia, opts)) as unknown as ResultadoGrafoBridge
    if (!r || typeof r !== 'object') return vazio
    const brutos = Array.isArray((r as { candidatos?: unknown }).candidatos)
      ? ((r as { candidatos: unknown[] }).candidatos as Array<Record<string, unknown>>)
      : []
    const candidatos: CandidatoGrafo[] = brutos.map((c) => {
      const provRaw = (c as { proveniencia?: unknown }).proveniencia
      const prov = Array.isArray(provRaw)
        ? (provRaw as Array<Record<string, unknown>>)
            .filter((p) => p && typeof p === 'object' && typeof (p as { origem?: unknown }).origem === 'string')
            .map((p) => ({
              de: String((p as { de?: unknown }).de ?? ''),
              para: String((p as { para?: unknown }).para ?? ''),
              tipo: String((p as { tipo?: unknown }).tipo ?? ''),
              origem: String((p as { origem?: unknown }).origem ?? ''),
              confianca: Number((p as { confianca?: unknown }).confianca) || 0,
              anoReferencia:
                (p as { anoReferencia?: unknown }).anoReferencia === null ||
                (p as { anoReferencia?: unknown }).anoReferencia === undefined
                  ? null
                  : Number((p as { anoReferencia?: unknown }).anoReferencia),
            }))
        : undefined
      const scoresRaw = (c as { scores?: unknown }).scores as { fts: number; vetor: number; pagerank: number } | undefined
      return {
        codigo: String((c as { codigo?: unknown }).codigo ?? ''),
        tipo: String((c as { tipo?: unknown }).tipo ?? ''),
        descricao: String((c as { descricao?: unknown }).descricao ?? ''),
        score: Number((c as { score?: unknown }).score) || 0,
        caminho: Array.isArray((c as { caminho?: unknown }).caminho)
          ? (((c as { caminho: unknown[] }).caminho as unknown[]).map((x) => String(x)))
          : [],
        ...(prov ? { proveniencia: prov } : {}),
        ...(scoresRaw && typeof scoresRaw === 'object' ? { scores: scoresRaw } : {}),
        ...((c as { scoreBase?: unknown }).scoreBase !== undefined
          ? { scoreBase: Number((c as { scoreBase?: unknown }).scoreBase) || 0 }
          : {}),
        ...((c as { comunidade?: unknown }).comunidade !== undefined
          ? { comunidade: String((c as { comunidade?: unknown }).comunidade) }
          : {}),
        ...((c as { boost?: unknown }).boost === 'uso_local' || (c as { boost?: unknown }).boost === null
          ? { boost: (c as { boost: 'uso_local' | null }).boost }
          : {}),
        ...((c as { boostValor?: unknown }).boostValor !== undefined
          ? { boostValor: Number((c as { boostValor?: unknown }).boostValor) || 0 }
          : {}),
      }
    })
    return {
      ok: r.ok === true,
      candidatos,
      caminhos: Array.isArray(r.caminhos) ? r.caminhos : [],
      cypher: typeof r.cypher === 'string' ? r.cypher : '',
      tempoMs: typeof r.tempoMs === 'number' ? r.tempoMs : 0,
      ...(r.modo ? { modo: r.modo } : {}),
      ...(r.modoVetor === 'hnsw' || r.modoVetor === 'fts-puro' ? { modoVetor: r.modoVetor } : {}),
      ...(r.embedding && typeof r.embedding === 'object' ? { embedding: r.embedding } : {}),
      ...(!r.ok && r.fallback ? { fallback: r.fallback } : !r.ok ? { fallback: 'lexical' } : {}),
      ...(r.motivo ? { motivo: r.motivo } : {}),
      ...(r.erro ? { erro: r.erro } : {}),
    }
  } catch (e) {
    return { ...vazio, erro: e instanceof Error ? e.message : String(e) }
  }
}

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

/**
 * Escritor do overlay (Phase 10-05 / GRAFO-08), null-safe: sem Electron ou
 * sem canal `ia:grafo-uso`, devolve `{ ok:false }` — o chamador
 * (`grafo-overlay.ts`) cai no `localStorage`. NUNCA lança.
 */
export async function registrarUsoGrafoBridge(evento: {
  tipo: string
  termo?: string | null
  codigo?: string | null
  emitente?: string | null
  peso?: number
}): Promise<{ ok: boolean; erro?: string }> {
  try {
    // C-008: PII-first — emitente vira hash, termo passa por removerPII. Nunca CNPJ cru no IPC.
    const { removerPII, hashEmitente } = await import('@/ai/guards')
    const eventoLimpo = {
      tipo: evento.tipo,
      ...(evento.termo ? { termo: removerPII(evento.termo) } : {}),
      ...(evento.codigo ? { codigo: evento.codigo } : {}),
      ...(evento.emitente ? { emitente: hashEmitente(evento.emitente) } : {}),
      ...(evento.peso !== undefined ? { peso: evento.peso } : {}),
    }
    const fn = bridge?.ia?.registrarUsoGrafo
    if (typeof fn !== 'function') return { ok: false, erro: 'sem-canal' }
    const r = await fn.call(bridge!.ia, eventoLimpo)
    if (!r || typeof r !== 'object') return { ok: false, erro: 'resposta-invalida' }
    return (r as { ok: boolean; erro?: string }).ok === true
      ? { ok: true }
      : { ok: false, erro: (r as { erro?: string }).erro ?? 'falha' }
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) }
  }
}
