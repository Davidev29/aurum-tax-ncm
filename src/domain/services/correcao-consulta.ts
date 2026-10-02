/**
 * Correção ortográfica de runtime da Aurum AI (autonomia do RAG).
 *
 * Espelho em código de `recursos-ia/conhecimento/erros-comuns.json`
 * (single-source auditável — mesma tabela, sem ler arquivo em runtime,
 * que no browser/Electron-renderer não tem `fs`).
 *
 * Papel: SEGUNDA CHANCE, nunca decisão. Quando a primeira tentativa do gate
 * retorna NÃO SEI e o texto contém typos conhecidos, o gate tenta de novo
 * com o texto corrigido. Se a segunda decide, o motivo carrega
 * `correcao-ortografica` para auditoria. Correção só reescreve a CONSULTA —
 * jamais CST/cClassTrib/redução/base legal (nível Deus, só leitura).
 */

import { normalizarBusca } from './busca-texto'

/** typo normalizado → forma correta (espelho de `erros-comuns.json`). */
export const CORRECOES_ORTOGRAFICAS: Record<string, string> = {
  parmezao: 'parmesao',
  muzzarela: 'mozarela',
  mussarela: 'mozarela',
  notbook: 'notebook',
  notebbok: 'notebook',
  celula: 'celular',
  smartfone: 'smartphone',
  television: 'televisao',
  teve: 'televisao',
  xocolate: 'chocolate',
  cerjeva: 'cerveja',
  serueja: 'cerveja',
  linguissa: 'linguica',
  salsixa: 'salsicha',
  presuntoo: 'presunto',
  camizeta: 'camiseta',
  tennis: 'tenis',
  fraldaa: 'fralda',
}

export interface CorrecaoConsulta {
  /** Texto com typos corrigidos (preserva caixa/pontuação original no resto). */
  textoCorrigido: string
  /** Pares aplicados, para trilha/auditoria. */
  correcoes: string[]
  /** `true` quando algo mudou. */
  alterado: boolean
}

/**
 * Corrige typos conhecidos token a token (comparação normalizada, reescrita
 * no token original para preservar o resto da frase).
 */
export function corrigirTextoConsulta(texto: unknown): CorrecaoConsulta {
  const cru = String(texto ?? '')
  if (!cru.trim()) return { textoCorrigido: cru, correcoes: [], alterado: false }
  const correcoes: string[] = []
  const partes = cru.split(/(\s+)/)
  const saida = partes.map((p) => {
    if (!p.trim()) return p
    const n = normalizarBusca(p)
    const certo = CORRECOES_ORTOGRAFICAS[n]
    if (certo && n !== certo) {
      correcoes.push(`${n}→${certo}`)
      // Preserva caixa simples: todo-maiúscula continua maiúscula.
      if (p === p.toUpperCase() && p.length > 1) return certo.toUpperCase()
      if (p[0] === p[0]?.toUpperCase()) return certo[0].toUpperCase() + certo.slice(1)
      return certo
    }
    return p
  })
  const textoCorrigido = saida.join('')
  return { textoCorrigido, correcoes, alterado: textoCorrigido !== cru }
}
