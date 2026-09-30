/**
 * Detector de intenção da busca unificada (Consulta NCM).
 *
 * Funções puras — sem IndexedDB, sem estado. O orquestrador (store/página)
 * usa a intenção para decidir quais workers disparar em paralelo:
 * - dígitos (≥2) → seção **Exata · via número** (`sugerirNomenclatura` +
 *   `resolverClassificacoes` quando 8 dígitos);
 * - texto com letras (≥2 chars) → seção **Por nome** (`buscarNomenclaturaPorTexto`);
 * - texto expressivo (frase) → seção **Predição assistiva** (`classificarPorDescricao`).
 *
 * Entrada mista ("queijo 0406") acende as três seções — cada uma ancora na
 * base oficial, nenhuma inventa NCM.
 */
import { norm } from './format'
import { pareceCodigoNcm, tokenizarBusca } from './busca-texto'

export type TipoEntradaConsulta = 'vazia' | 'numerica' | 'textual' | 'mista'

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

/** Mínimos por seção (robustez: evita worker caro em digitação curta). */
export const LIMITES_ENTRADA_UNIFICADA = {
  /** Prefixo NCM precisa de ao menos 2 dígitos (paridade com `sugerirNomenclatura`). */
  digitosMinimos: 2,
  /** Busca por nome precisa de ao menos 2 caracteres úteis. */
  textoMinimo: 2,
  /**
   * Predição assistiva só com frase expressiva: ≥2 tokens úteis OU texto
   * corrido ≥10 chars. Evita `classificarPorDescricao` a cada 2 letras.
   */
  descricaoTokensMinimos: 2,
  descricaoCharsMinimos: 10,
} as const

export function detectarIntencaoConsulta(entrada: unknown): IntencaoConsulta {
  const cru = String(entrada ?? '')
  const texto = cru.trim()
  const digitos = norm(cru)
  const temLetras = /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(cru)
  const soCodigo = pareceCodigoNcm(cru)

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
    const completa = digitos.length === 8
    return {
      tipo: 'numerica',
      digitos,
      temLetras: false,
      deveBuscarExato: true,
      deveClassificarExato: completa,
      deveBuscarNome: false,
      deveBuscarDescricao: false,
      rotulo: completa ? '🔢 NCM exato' : '🔢 Buscando por número…',
    }
  }

  // A partir daqui há letras — sempre alimenta a seção Por nome.
  const tokens = tokenizarBusca(texto)
  const deveBuscarNome = texto.length >= LIMITES_ENTRADA_UNIFICADA.textoMinimo
  const fraseExpressiva =
    tokens.length >= LIMITES_ENTRADA_UNIFICADA.descricaoTokensMinimos ||
    texto.length >= LIMITES_ENTRADA_UNIFICADA.descricaoCharsMinimos
  const deveBuscarDescricao = deveBuscarNome && fraseExpressiva

  if (ehMista) {
    return {
      tipo: 'mista',
      digitos,
      temLetras: true,
      deveBuscarExato: true,
      deveClassificarExato: digitos.length === 8,
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
