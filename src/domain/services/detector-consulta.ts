/**
 * Detector de intenção da busca unificada (Consulta NCM / Serviços NBS).
 *
 * Funções puras — sem IndexedDB, sem estado. O orquestrador (store/página)
 * usa a intenção para decidir quais workers disparar em paralelo:
 * - dígitos (≥2) → seção **Exata · via número** (`sugerirNomenclatura` +
 *   `resolverClassificacoes` quando 8 dígitos; no domínio `nbs`, `sugerirNbs` +
 *   `resolverClassificacoesNbs` somente com 9 dígitos);
 * - texto com letras (≥2 chars) → seção **Por nome** (`buscarNomenclaturaPorTexto`);
 * - texto expressivo (frase) → seção **Predição assistiva** (`classificarPorDescricao`).
 *
 * Entrada mista ("queijo 0406") acende as três seções — cada uma ancora na
 * base oficial, nenhuma inventa NCM.
 */
import { norm } from './format'
import { pareceCodigoNcm, tokensRelevantes } from './busca-texto'

export type TipoEntradaConsulta = 'vazia' | 'numerica' | 'textual' | 'mista'

/**
 * Domínio da tela que consome a intenção: a Consulta NCM classifica 8
 * dígitos, a Consulta Serviços (NBS) só classifica 9 — 8 dígitos ali é
 * NCM, não NBS, e o selo precisa dizer isso (nunca "NCM exato" na tela NBS).
 */
export type DominioConsulta = 'ncm' | 'nbs'

export interface IntencaoConsulta {
  tipo: TipoEntradaConsulta
  /** Só dígitos da entrada (`norm`). */
  digitos: string
  /** Há letras (inclui acentuadas)? */
  temLetras: boolean
  /** Deve alimentar a seção Exata (prefixo NCM)? */
  deveBuscarExato: boolean
  /** Dígitos formam NCM completo → classifica imediatamente. */
  deveClassificarExato: boolean
  /** Deve alimentar a seção Por nome? */
  deveBuscarNome: boolean
  /** Deve alimentar a seção Predição assistiva? (mais cara — threshold maior) */
  deveBuscarDescricao: boolean
  /** Rótulo curto para o badge de roteamento da UI. */
  rotulo: string
}

/** Mínimos por seção (proativo: 1 palavra relevante já acende a predição). */
export const LIMITES_ENTRADA_UNIFICADA = {
  /** Prefixo NCM precisa de ao menos 2 dígitos (paridade com `sugerirNomenclatura`). */
  digitosMinimos: 2,
  /** Busca por nome precisa de ao menos 2 caracteres úteis. */
  textoMinimo: 2,
  /**
   * Predição assistiva desde a 1ª palavra relevante: ≥1 token útil OU texto
   * corrido ≥4 chars. Antes exigia frase expressiva (≥2 tokens ou ≥10 chars),
   * então "queijo", "celular", "camiseta" mostravam só o nome e nunca a IA —
   * parecia que "a IA nunca sabia nada". O custo continua controlado pelo
   * debounce (600 ms) + RAG lexical local.
   */
  descricaoTokensMinimos: 1,
  descricaoCharsMinimos: 4,
} as const

export function detectarIntencaoConsulta(entrada: unknown, dominio: DominioConsulta = 'ncm'): IntencaoConsulta {
  const cru = String(entrada ?? '')
  const texto = cru.trim()
  const digitos = norm(cru)
  const temLetras = /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(cru)
  const soCodigo = pareceCodigoNcm(cru)
  const ehNbs = dominio === 'nbs'

  if (!texto) {
    return {
      tipo: 'vazia',
      digitos,
      temLetras: false,
      deveBuscarExato: false,
      deveClassificarExato: false,
      deveBuscarNome: false,
      deveBuscarDescricao: false,
      rotulo: 'Digite para buscar',
    }
  }

  const ehNumerica = soCodigo && digitos.length >= LIMITES_ENTRADA_UNIFICADA.digitosMinimos && !temLetras
  const ehMista = temLetras && digitos.length >= LIMITES_ENTRADA_UNIFICADA.digitosMinimos

  if (ehNumerica) {
    const completaNcm = digitos.length === 8
    const completaNbs = digitos.length === 9
    // No domínio NBS só 9 dígitos classificam: 8 dígitos é NCM (outro
    // imposto, outra tela) — o selo orienta em vez de afirmar "NCM exato".
    const completa = ehNbs ? completaNbs : completaNcm || completaNbs
    return {
      tipo: 'numerica',
      digitos,
      temLetras: false,
      deveBuscarExato: true,
      deveClassificarExato: completa,
      deveBuscarNome: false,
      deveBuscarDescricao: false,
      rotulo: completaNbs
        ? '🔢 NBS exato'
        : completaNcm && !ehNbs
          ? '🔢 NCM exato'
          : ehNbs
            ? '⌨️ NBS tem 9 dígitos'
            : '🔢 Buscando por número…',
    }
  }

  // A partir daqui há letras — sempre alimenta a seção Por nome.
  // A predição usa tokens RELEVANTES (sem "para", "de", "com"): "para" sozinho
  // não acende a IA, mas "queijo" sozinho já acende.
  const tokens = tokensRelevantes(texto)
  const deveBuscarNome = texto.length >= LIMITES_ENTRADA_UNIFICADA.textoMinimo
  const fraseExpressiva = tokens.length >= LIMITES_ENTRADA_UNIFICADA.descricaoTokensMinimos
  const deveBuscarDescricao = deveBuscarNome && fraseExpressiva

  if (ehMista) {
    return {
      tipo: 'mista',
      digitos,
      temLetras: true,
      deveBuscarExato: true,
      // No domínio NBS, 8 dígitos no meio do texto também não classificam.
      deveClassificarExato: ehNbs ? digitos.length === 9 : digitos.length === 8 || digitos.length === 9,
      deveBuscarNome,
      deveBuscarDescricao,
      rotulo: '🔀 Número + texto',
    }
  }

  return {
    tipo: 'textual',
    digitos,
    temLetras: true,
    deveBuscarExato: false,
    deveClassificarExato: false,
    deveBuscarNome,
    deveBuscarDescricao,
    rotulo: deveBuscarDescricao ? '✨ Predição assistiva + nome' : '📝 Buscando por nome…',
  }
}
