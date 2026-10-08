/**
 * Sugestão inline de tabela auxiliar (CFOP, CST ICMS, PIS/COFINS…).
 *
 * Padrão "multitexto": digitando número ou texto, a lista sugere
 * (`código — descrição`); ao clicar, o código persiste. Sem `<select>`.
 *
 * Função pura (testável em Node) — o componente fino (`CampoTributoAntigo`)
 * só gerencia foco/teclado.
 */
export interface OpcaoSugestao {
  codigo: unknown
  descricao: unknown
  tipo?: unknown
}

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/**
 * Filtra e ordena sugestões: código que **começa** com o termo primeiro,
 * depois código que contém, depois descrição que contém.
 *
 * - `excluirNbs`: descarta códigos de 9 dígitos (NBS, serviços) — produto
 *   (NCM) nunca sugere NBS.
 */
export function filtrarSugestoesAux<T extends OpcaoSugestao>(
  opcoes: T[],
  termo: string,
  limite = 8,
  opts?: { excluirNbs?: boolean },
): T[] {
  const t = normalizar(String(termo ?? '').trim())
  if (!t) return []
  const excluirNbs = opts?.excluirNbs ?? false
  const comeca: T[] = []
  const contemCod: T[] = []
  const contemDesc: T[] = []
  for (const o of opcoes ?? []) {
    const cod = String(o.codigo ?? '')
    const dig = cod.replace(/\D/g, '')
    if (excluirNbs && dig.length === 9) continue
    const codNorm = normalizar(cod)
    const descNorm = normalizar(String(o.descricao ?? ''))
    const tipoNorm = normalizar(String((o as Record<string, unknown>).tipo ?? ''))
    if (codNorm.startsWith(t)) {
      comeca.push(o)
    } else if (codNorm.includes(t)) {
      contemCod.push(o)
    } else if (descNorm.includes(t) || (tipoNorm && tipoNorm.includes(t))) {
      contemDesc.push(o)
    }
  }
  return [...comeca, ...contemCod, ...contemDesc].slice(0, Math.max(1, limite))
}
