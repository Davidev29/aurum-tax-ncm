/**
 * Consumo do grafo fiscal pela IA (Phase 10-05 / GRAFO-05 + GRAFO-08).
 *
 * - `consultarGrafoPrimeiro`: tenta `grafoConsultarGrafo` (fail-closed);
 * - `fundirCandidatosGrafoLexical`: grafo primeiro, dedupe por código;
 * - `desempatarPorGrafo`: lote/XML usam o caminho do grafo para desempate
 *   multi-opção (lista[0] continua vindo do resolvedor; o grafo SÓ reordena
 *   quando o caminho cita o CCT da opção — nunca cria redução);
 * - `motivoViaGrafo`: marca `via:'grafo'|'grafo+ia'` na trilha.
 *
 * O resolvedor (`resolverClassificacoes`/`resolverClassificacoesNbs`) é a
 * única verdade — o grafo propõe, nunca precifica. Sem grafo (`ok:false`),
 * o chamador segue bit-idêntico ao pré-grafo.
 */
import { grafoConsultarGrafo, type CandidatoIa, type ResultadoGrafoBridge } from '@/infrastructure/bridge'

export interface TrilhaGrafo {
  usouGrafo: boolean
  cypher: string | null
  caminhos: string[][]
  /** `codigo` → caminho (só com proveniência; sem proveniência = sem citação). */
  caminhoPorCodigo: Map<string, string[]>
  provenienciaPorCodigo: Map<
    string,
    Array<{ de: string; para: string; tipo: string; origem: string; confianca: number; anoReferencia?: number | null }>
  >
  boostPorCodigo: Map<string, { boost: 'uso_local' | null; valor: number }>
}

export function trilhaVazia(): TrilhaGrafo {
  return {
    usouGrafo: false,
    cypher: null,
    caminhos: [],
    caminhoPorCodigo: new Map(),
    provenienciaPorCodigo: new Map(),
    boostPorCodigo: new Map(),
  }
}

/**
 * Consulta o grafo primeiro (fail-closed). Devolve a trilha + resposta bruta.
 * NUNCA lança — sem `.lbug`/sem canal, `usouGrafo:false` (fallback lexical).
 */
export async function consultarGrafoPrimeiro(
  texto: string,
  k = 5,
  anoReferencia?: number,
): Promise<{ trilha: TrilhaGrafo; resposta: ResultadoGrafoBridge }> {
  const trilha = trilhaVazia()
  try {
    const resposta = await grafoConsultarGrafo(texto, k, anoReferencia)
    if (!resposta || resposta.ok !== true || !Array.isArray(resposta.candidatos) || !resposta.candidatos.length) {
      return { trilha, resposta }
    }
    trilha.usouGrafo = true
    trilha.cypher = typeof resposta.cypher === 'string' && resposta.cypher ? resposta.cypher : null
    trilha.caminhos = Array.isArray(resposta.caminhos) ? resposta.caminhos : []
    for (const c of resposta.candidatos) {
      const codigo = String(c.codigo ?? '').replace(/\D+/g, '')
      if (!codigo) continue
      if (Array.isArray(c.caminho) && c.caminho.length) {
        // Só cita caminho COM proveniência (proibição 10-05).
        const prov = Array.isArray((c as { proveniencia?: unknown }).proveniencia)
          ? ((c as { proveniencia: TrilhaGrafo['provenienciaPorCodigo'] extends Map<string, infer V> ? V : never }).proveniencia ?? [])
          : []
        if (prov.length) {
          if (!trilha.caminhoPorCodigo.has(codigo)) trilha.caminhoPorCodigo.set(codigo, [...c.caminho.map(String)])
          if (!trilha.provenienciaPorCodigo.has(codigo)) trilha.provenienciaPorCodigo.set(codigo, [...prov])
        } else if (!trilha.caminhoPorCodigo.has(codigo)) {
          // Sem proveniência: guarda o caminho mas NÃO expõe (fallback exibe
          // só lexical; o boost ainda vale para reordenar).
          trilha.caminhoPorCodigo.set(codigo, [...c.caminho.map(String)])
        }
      }
      const boost = (c as { boost?: 'uso_local' | null }).boost ?? null
      const boostValor = Number((c as { boostValor?: unknown }).boostValor) || 0
      trilha.boostPorCodigo.set(codigo, { boost, valor: boostValor })
    }
    return { trilha, resposta }
  } catch {
    return { trilha, resposta: { ok: false, candidatos: [], caminhos: [], cypher: '', tempoMs: 0, fallback: 'lexical' } }
  }
}

/** Normaliza código para dedupe (só dígitos). */
function digitos(codigo: unknown): string {
  return String(codigo ?? '').replace(/\D+/g, '')
}

/**
 * Funde candidatos do grafo + lexical: grafo primeiro, dedupe por código.
 * Candidatos do grafo carregam `caminhoGrafo` + `provenienciaGrafo` + `cypher`
 * + `boost` (para a UI "por que sugeriu" e a trilha); lexicais seguem intactos.
 * Grafo `ok:false` → retorna o lexical bit-idêntico (mesma ordem/referência).
 */
export function fundirCandidatosGrafoLexical(
  respostaGrafo: ResultadoGrafoBridge | null,
  lexicais: CandidatoIa[],
  trilha: TrilhaGrafo,
): CandidatoIa[] {
  if (!respostaGrafo || respostaGrafo.ok !== true || !respostaGrafo.candidatos.length) return lexicais
  const vistos = new Set<string>()
  const out: CandidatoIa[] = []
  for (const g of respostaGrafo.candidatos) {
    const cod = digitos(g.codigo)
    if (!cod || vistos.has(cod)) continue
    vistos.add(cod)
    const prov = trilha.provenienciaPorCodigo.get(cod) ?? []
    out.push({
      codigo: cod,
      descricao: String(g.descricao || ''),
      score: typeof g.score === 'number' ? g.score : undefined,
      caminhoGrafo: trilha.caminhoPorCodigo.get(cod) ? [...(trilha.caminhoPorCodigo.get(cod) as string[])] : undefined,
      ...(prov.length ? { provenienciaGrafo: [...prov] } : {}),
      ...(trilha.cypher ? { cypherGrafo: trilha.cypher } : {}),
      boostGrafo: ((trilha.boostPorCodigo.get(cod)?.boost ?? (g.boost as 'uso_local' | null)) || null) as 'uso_local' | null,
      boostValorGrafo: (trilha.boostPorCodigo.get(cod)?.valor ?? Number(g.boostValor)) || 0,
      viaGrafo: true,
    })
  }
  for (const l of lexicais) {
    const cod = digitos(l.codigo)
    if (!cod || vistos.has(cod)) continue
    vistos.add(cod)
    out.push(l)
  }
  return out
}

/**
 * Desempate multi-opção via caminho do grafo (lote/XML).
 * `lista` VEM do resolvedor (ordem oficial preservada). Se o caminho do grafo
 * citar um CCT presente nas opções (`CCT:<6 dígitos>` no caminho), essa opção
 * sobe para a posição 0 — SÓ reordena, nunca cria redução nem troca a lista.
 * Sem caminho/CCT → mesma ordem (bit-idêntico).
 */
export function desempatarPorGrafo<T extends { cst?: unknown; cClassTrib?: unknown }>(
  lista: T[],
  trilha: TrilhaGrafo,
  codigoConsulta?: string,
): { lista: T[]; usouGrafo: boolean; cctDoCaminho: string | null } {
  if (!lista || lista.length <= 1 || !trilha.usouGrafo) return { lista, usouGrafo: false, cctDoCaminho: null }
  const caminho = (codigoConsulta && trilha.caminhoPorCodigo.get(digitos(codigoConsulta))) || trilha.caminhos[0] || []
  const ccts = caminho
    .map((x) => {
      const m = String(x).match(/^CCT:(.+)$/)
      return m?.[1]?.replace(/\D+/g, '').padStart(6, '0').slice(-6) ?? null
    })
    .filter((c): c is string => !!c)
  if (!ccts.length) return { lista, usouGrafo: false, cctDoCaminho: null }
  const alvo = ccts[0]
  const idx = lista.findIndex((c) => String((c as { cClassTrib?: unknown }).cClassTrib ?? '').replace(/\D+/g, '').padStart(6, '0').slice(-6) === alvo)
  if (idx <= 0) return { lista, usouGrafo: idx === 0, cctDoCaminho: alvo }
  const copia = [...lista]
  const [escolhida] = copia.splice(idx, 1)
  copia.unshift(escolhida)
  return { lista: copia, usouGrafo: true, cctDoCaminho: alvo }
}

/**
 * Texto "por que sugeriu" (`base + seu uso`, com `boost: uso_local`).
 * Puro — a UI exibe junto ao badge `via:grafo`.
 */
export function textoPorQueSugeriu(codigo: unknown, trilha: TrilhaGrafo): string | null {
  if (!trilha.usouGrafo) return null
  const cod = digitos(codigo)
  const caminho = trilha.caminhoPorCodigo.get(cod)
  const boost = trilha.boostPorCodigo.get(cod)
  if (!caminho?.length) return null
  const base = `base: ${caminho.join(' → ')}`
  if (boost?.boost === 'uso_local' && boost.valor > 0) {
    return `${base} + seu uso (boost: uso_local +${boost.valor})`
  }
  return base
}
