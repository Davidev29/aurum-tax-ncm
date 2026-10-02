/**
 * Farejo da Aurinha — frases personalizadas a partir do termo digitado.
 *
 * 100% puro e determinístico (sem `Math.random`, sem DOM, sem store): a
 * variação vem de um hash do próprio termo, então a mesma busca sempre rende
 * a mesma gracinha — e os testes travam o comportamento.
 *
 * Quem usa: `PetAurum.tsx` (reações da busca e da digitação).
 */

export type TipoTermo = 'ncm' | 'curto' | 'texto'

export interface ResumoBusca {
  /** Classificações oficiais resolvidas (painel 0/1/N). */
  oficiais: number
  /** Candidatos da busca por nome. */
  textos: number
  /** O classificador/IA sugeriu algo (mesmo sem oficial). */
  temSugestao: boolean
  /** Primeiro NCM para celebrar (só dígitos ou formatado). */
  primeiroCodigo?: string
}

/** Normaliza espaços para exibir o termo no balão (máx. `max` chars). */
export function resumirTermo(termo: string, max = 24): string {
  const limpo = termo.trim().replace(/\s+/g, ' ')
  if (limpo.length <= max) return limpo
  return `${limpo.slice(0, max - 1).trimEnd()}…`
}

/** Só dígitos (para exibir NCM sem formatação estranha). */
export function soDigitos(termo: string): string {
  return termo.replace(/\D+/g, '')
}

function hashTermo(termo: string): number {
  let h = 0
  for (let i = 0; i < termo.length; i++) h = (h * 31 + termo.charCodeAt(i)) >>> 0
  return h
}

function escolher<T>(termo: string, opcoes: T[]): T {
  return opcoes[hashTermo(termo.toLowerCase()) % opcoes.length]
}

/** Classifica o que o humano digitou: NCM, curto demais ou texto livre. */
export function detectarTipoTermo(termo: string): TipoTermo {
  const limpo = termo.trim()
  if (!limpo) return 'curto'
  const dig = soDigitos(limpo)
  // Tem dígito e quase tudo é dígito/ponto/traço/espaço → intenção de NCM.
  if (dig.length >= 2 && dig.length >= limpo.replace(/[\s.\-_/]/g, '').length * 0.5) return 'ncm'
  if (limpo.length < 3) return 'curto'
  return 'texto'
}

/** Palpite de categoria pelo vocabulário — o "faro" da Aurinha. */
export function palpiteFarejo(termo: string): string | null {
  const t = termo.toLowerCase()
  if (/(camis|calca|vestid|tecido|algodao|roupa|sapato|tenis|moda|malha|jeans)/.test(t)) return 'cheiro de tecido!'
  if (/(carne|boi|frango|peixe|leite|queijo|arroz|feijao|comida|alimento|fruta|verdura|doce|chocolate|cafe|acucar)/.test(t)) return 'hmm, comestível?'
  if (/(celular|computador|notebook|tablet|eletron|software|teclado|mouse|tela|fone|carregador)/.test(t)) return 'apita que é tech!'
  if (/(remedio|medicamento|farmacia|vitamina|antibiotico|cosmetico|perfume|creme|shampoo|sabonete)/.test(t)) return 'cheirinho de farmácia!'
  if (/(carro|moto|caminhao|pneu|peca|motor|freio|auto\b|veiculo)/.test(t)) return 'cheiro de graxa!'
  if (/(madeira|moveis?|mesa|cadeira|sofa|armario|marcenaria)/.test(t)) return 'madeira à vista!'
  if (/(brinquedo|bonec|jogo|console|videogame)/.test(t)) return 'diversão detectada!'
  if (/(livro|caderno|papel|caneta|lapis|impress)/.test(t)) return 'cheiro de papel!'
  if (/(cerveja|vinho|bebida|refrigerante|suco|whisky|vodka)/.test(t)) return 'brindemos com cuidado!'
  if (/(flor|planta|semente|adubo|agricola|colheita)/.test(t)) return 'cheiro de terra fértil!'
  return null
}

const TEMPLATES_FAREJANDO_TEXTO = [
  (t: string) => `Farejando '${t}'…`,
  (t: string) => `Deixa eu cheirar '${t}'…`,
  (t: string) => `'${t}'? Já tô farejando!`,
]

/**
 * Frase de início de busca. Retorna `null` para termo curto (o chamador usa
 * a frase genérica de "pensando").
 */
export function fraseFarejando(termo: string): string | null {
  const tipo = detectarTipoTermo(termo)
  if (tipo === 'curto') return null
  if (tipo === 'ncm') {
    const dig = soDigitos(termo)
    return `${dig}… conferindo dígito a dígito!`
  }
  const resumo = resumirTermo(termo)
  const base = escolher(termo, TEMPLATES_FAREJANDO_TEXTO)(resumo)
  const palpite = palpiteFarejo(termo)
  return palpite ? `${base} ${palpite}` : base
}

const TEMPLATES_ZERO = [
  (t: string) => `Nada pra '${t}'… tenta outra palavra?`,
  (t: string) => `'${t}' não deu em nada… que tal outro nome?`,
]

/** Frase de resultado — celebra, lista candidatos ou sugere retentar. */
export function fraseResultadoBusca(termo: string, r: ResumoBusca): string {
  const resumo = resumirTermo(termo)
  const codigo = r.primeiroCodigo ? soDigitos(r.primeiroCodigo) || r.primeiroCodigo : ''
  if (r.oficiais === 1 && codigo) return `Achei! '${resumo}' é NCM ${codigo}!`
  if (r.oficiais > 1) return `${r.oficiais} classificações pra '${resumo}'!`
  if (r.oficiais === 1) return `Achei uma classificação pra '${resumo}'!`
  if (r.temSugestao && codigo) return `A IA farejou NCM ${codigo} pra '${resumo}'!`
  if (r.textos > 0) {
    return r.textos === 1
      ? `Um candidato pra '${resumo}' — é esse?`
      : `${r.textos} candidatos pra '${resumo}' — escolhe um!`
  }
  if (r.temSugestao) return `Farejei uma sugestão pra '${resumo}'!`
  return escolher(termo, TEMPLATES_ZERO)(resumo)
}

/** Frase de NCM inválido citando o que foi digitado. */
export function fraseNcmInvalido(termo: string): string {
  const limpo = termo.trim()
  if (!limpo) return 'Hmm, esse NCM tá estranho…'
  return `Hmm, '${resumirTermo(limpo, 18)}' não é um NCM válido…`
}
