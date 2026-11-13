/**
 * Utilitários de texto fiscal para exibição — puro, sem I/O.
 *
 * As descrições oficiais da TEC trazem HTML leve (`<i>Gallus</i>`,
 * `<sub>2</sub>`), tags de nível como hífens/bullets iniciais ("- ", "-- ",
 * "• ", "* ") e quebras inúteis. Este módulo centraliza a limpeza para que
 * NENHUM card/modal exiba lixo de formatação — e para que a busca e a
 * exibição concordem no mesmo texto.
 */

/** Remove tags HTML/XML, decodifica entidades comuns e colapsa espaços. */
export function limparTextoFiscal(v: unknown): string {
  const semTags = String(v ?? '').replace(/<[^>]*>/g, ' ')
  return semTags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/^[-–—•*\s]+/, '')
    .replace(/\s+$/, '')
    .trim()
}

/** `dd/mm/aaaa` a partir de ISO ou de data já formatada; `null` para sentinela. */
export function fmtDataBr(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (!s || /9999|31\/12\/9999/i.test(s)) return null
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  const b = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (b) return `${b[1]}/${b[2]}/${b[3]}`
  return s || null
}

/** Linha curta de vigência para os cards: "Vigente desde dd/mm/aaaa" / extinto. */
export function vigenciaCurta(dataInicio: unknown, dataFim: unknown): string {
  if (dataFim) return `Extinto em ${fmtDataBr(dataFim) ?? dataFim}`
  const ini = fmtDataBr(dataInicio)
  return ini ? `Vigente desde ${ini}` : 'Vigente'
}
