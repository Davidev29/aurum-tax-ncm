/**
 * Revogações de anexos e cClassTribs (ex.: anexo integralmente revogado).
 *
 * Um item revogado NÃO pode apresentar redução como tributação vigente:
 * o resolvedor o rebaixa para regra geral com aviso vermelho. Duas fontes:
 *
 * 1. **Curadoria** (`REVOGACOES_ANEXO` / `REVOGADOS_CCT`): atos normativos
 *    conhecidos, versionados em código com ato + data + motivo.
 * 2. **CFF** (`extrairRevogacoesAnexos`): varredura best-effort do JSON bruto
 *    do endpoint `anexos` guardado em `meta` — quando a fonte oficial marca
 *    linhas como revogadas/inativas, elas valem sem esperar curadoria.
 */
import type { Observacao } from '../entities'

/** Revogação identificada (curadoria ou CFF). */
export interface Revogacao {
  /** '19' (anexo) ou '200038' (cClassTrib). */
  alvo: string
  tipo: 'anexo' | 'cClassTrib'
  /** Ato que revogou (ex.: 'Resolução Gecex nº 926/2026'). 'a confirmar' = relato não verificado. */
  ato: string
  /** Data da revogação (texto livre, ex.: '30/09/2026'). */
  data: string | null
  motivo: string
}

type Curadoria = Omit<Revogacao, 'alvo' | 'tipo'>

/**
 * Anexos integralmente revogados, por número oficial ("1".."15", ...).
 *
 * - '19': relato de revogação integral — ATO A CONFIRMAR contra a norma.
 *   Mantido porque o mecanismo precisa existir antes do ato chegar via CFF;
 *   como a base atual não tem nenhum item de anexo 19, é no-op até lá
 *   (travado em teste).
 */
export const REVOGACOES_ANEXO: Record<string, Curadoria> = {
  '19': {
    ato: 'a confirmar — relato de revogação integral recebido, confrontar com a norma',
    data: null,
    motivo: 'Anexo integralmente revogado: todos os enquadramentos caem para regra geral.',
  },
}

/** cClassTribs individualmente revogados, por código de 6 dígitos. */
export const REVOGADOS_CCT: Record<string, Curadoria> = {}

/** Normaliza o anexo oficial ("9", "09", "IX", "Anexo IX", 9) para dígitos. */
export function normAnexo(anexo: unknown): string | null {
  if (anexo === null || anexo === undefined) return null
  const s = String(anexo).trim().toUpperCase().replace(/^ANEXO\s+/, '')
  if (!s) return null
  if (s === 'IX') return '9'
  if (/^\d{1,2}$/.test(s)) return String(Number(s))
  return null
}

/** Revogação curada para um anexo oficial, se houver. */
export function revogacaoDoAnexo(anexo: unknown): Revogacao | null {
  const n = normAnexo(anexo)
  if (!n) return null
  const c = REVOGACOES_ANEXO[n]
  return c ? { alvo: n, tipo: 'anexo', ...c } : null
}

/** Revogação curada para um cClassTrib, se houver. */
export function revogacaoDoCct(cct: unknown): Revogacao | null {
  const d = String(cct ?? '').replace(/\D+/g, '').padStart(6, '0').slice(-6)
  if (!/^\d{6}$/.test(d)) return null
  const c = REVOGADOS_CCT[d]
  return c ? { alvo: d, tipo: 'cClassTrib', ...c } : null
}

/**
 * Revogação aplicável a um vínculo (cClassTrib primeiro, depois anexo).
 * `dinamicas` = achados do CFF (`extrairRevogacoesAnexos`).
 */
export function revogacaoDe(
  cct: unknown,
  anexo: unknown,
  dinamicas: Revogacao[] = [],
): Revogacao | null {
  const d = String(cct ?? '').replace(/\D+/g, '').padStart(6, '0').slice(-6)
  const n = normAnexo(anexo)
  return (
    dinamicas.find((r) => r.tipo === 'cClassTrib' && r.alvo === d) ??
    dinamicas.find((r) => r.tipo === 'anexo' && r.alvo === n) ??
    revogacaoDoCct(d) ??
    revogacaoDoAnexo(n) ??
    null
  )
}

/**
 * Varredura best-effort do JSON bruto do endpoint CFF `anexos` em busca de
 * linhas marcadas como revogadas/inativas/vencidas. Formato do endpoint não
 * é contratual — qualquer linha sem marcador explícito é ignorada (nunca
 * revoga por inferência).
 */
export function extrairRevogacoesAnexos(dados: unknown): Revogacao[] {
  const b = dados as Record<string, unknown> | unknown[] | null
  const lista = Array.isArray(b)
    ? b
    : (['itens', 'data', 'anexos', 'lista', 'result', 'registros']
      .map((k) => (b as Record<string, unknown>)?.[k])
      .find((v) => Array.isArray(v)) as unknown[] | undefined) ?? []
  if (!Array.isArray(lista)) return []

  const out: Revogacao[] = []
  for (const raw of lista) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const marcador = [
      r.status, r.situacao, r.situation, r.estado, r.vigente, r.vigencia,
      r.ativo, r.ativa, r.revogado, r.revogada, r.indRevogado, r.indAtivo,
    ]
      .map((v) => String(v ?? '').trim().toLowerCase())
      .filter(Boolean)
      .join(' | ')
    const revogado = /(^|\W)(revogad[oa]|inativ[oa]|vencid[oa]|cancelad[oa]|exclu[ií]d[oa]|suspens[oa])(\W|$)|\bn[ãa]o\s+vigente\b/.test(marcador)
    if (!revogado) continue
    const cctRaw = String(
      r.cClassTrib ?? r.codClassificacao ?? r.codigoClassificacao ?? r.codigo ?? '',
    ).replace(/\D+/g, '')
    // Vazio NÃO pode virar '000000' (padStart de '') — linha sem código é ignorada.
    const cct = cctRaw ? cctRaw.padStart(6, '0').slice(-6) : ''
    const anexo = normAnexo(r.anexo ?? r.numeroAnexo ?? r.numero_do_anexo)
    const ato = String(r.ato ?? r.atoRevogacao ?? r.numeroAto ?? '').trim() || 'ato indicado na fonte CFF'
    const data = String(r.data ?? r.dataRevogacao ?? r.dataFim ?? '').trim() || null
    if (/^\d{6}$/.test(cct)) {
      out.push({ alvo: cct, tipo: 'cClassTrib', ato, data, motivo: 'Marcado como revogado/inativo na tabela oficial CFF.' })
    } else if (anexo) {
      out.push({ alvo: anexo, tipo: 'anexo', ato, data, motivo: 'Marcado como revogado/inativo na tabela oficial CFF.' })
    }
  }
  const vistos = new Set<string>()
  return out.filter((r) => {
    const k = `${r.tipo}|${r.alvo}`
    if (vistos.has(k)) return false
    vistos.add(k)
    return true
  })
}

/** Observação vermelha de revogação para cartões e análises. */
export function observacaoRevogacao(r: Revogacao | null | undefined): Observacao | null {
  if (!r) return null
  const alvo = r.tipo === 'anexo' ? `Anexo ${r.alvo}` : `cClassTrib ${r.alvo}`
  return {
    titulo: `⛔ ${alvo} revogado — sem redução vigente`,
    texto:
      `${alvo} foi revogado (${r.ato}${r.data ? ` em ${r.data}` : ''}). ${r.motivo} ` +
      'Apresenta-se tributação integral (regra geral) até que novo enquadramento oficial seja publicado.',
    cor: 'red',
  }
}
