/**
 * Inferência de Anexo do Simples por atividade em linguagem natural (Phase 8 — 08-01).
 *
 * Explícito (`extrairAnexoRobusto`) sempre vence. Sem "anexo" na frase,
 * infere por palavras-chave normalizadas (lower + NFD + typos comuns).
 * V é provisório (precisaConfirmar=true → pedir folha para III×V).
 * Puro e testável.
 */
import { extrairAnexoRobusto, type AnexoId } from './valores-chat'

export type OrigemAnexo = 'explicito' | 'atividade' | null

export interface InferenciaAnexo {
  anexo: AnexoId | null
  confianca: number
  precisaConfirmar: boolean
  origem: OrigemAnexo
}

function normAtv(s: string): string {
  let n = String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
  // typos comuns de atividade
  n = n
    .replace(/\bcomesio\b/g, 'comercio')
    .replace(/\bcomersio\b/g, 'comercio')
    .replace(/\badvogacia\b/g, 'advocacia')
    .replace(/\bemgenheiro\b/g, 'engenheiro')
    .replace(/\bfabrica\b/g, 'fabrica')
  return n
}

function tem(n: string, lista: string[]): boolean {
  return lista.some((k) => n.includes(k))
}

// Ordem importa: IV e II antes de I (evita "serviços" genérico engolir fixos).
const K_IV = ['construcao', 'empreitada', 'vigilancia', 'limpeza', 'conservacao', 'advocacia', 'advogado', 'paisagismo']
const K_II = ['industria', 'fabrica', 'fabrico', 'produzo', 'industrializacao']
const K_I = ['comercio', 'loja', 'lojinha', 'lojista', 'revenda', 'mercadoria para revenda', 'mercadinho', 'distribuidora', 'vendo ', 'revendo']
const K_V = ['medico', 'engenheiro', 'contador', 'contabil', 'consultoria', 'auditor', 'publicidade', 'jornalista', 'veterinario', 'psicologo', 'designer', 'programador', 'software', 'desenvolvimento de software', ' ti ', ' sou ti', 'dev ']
const K_III = ['salao', 'barbeiro', 'academia', 'aula', 'curso', 'manutencao', 'reparo', 'locacao', 'bens moveis', 'creche', 'escolinha', 'ensino', 'yoga', 'beleza']

export function inferirAnexoPorAtividade(texto: string): InferenciaAnexo {
  const explicito = extrairAnexoRobusto(texto)
  if (explicito) return { anexo: explicito, confianca: 1.0, precisaConfirmar: false, origem: 'explicito' }
  const n = ` ${normAtv(texto)} `
  // MEI: fora dos anexos — sinaliza para o orquestrador orientar
  if (/\bmei\b/.test(n)) return { anexo: null, confianca: 0.9, precisaConfirmar: true, origem: 'atividade' }
  if (tem(n, K_IV)) return { anexo: 'IV', confianca: 0.9, precisaConfirmar: false, origem: 'atividade' }
  if (tem(n, K_II)) return { anexo: 'II', confianca: 0.9, precisaConfirmar: false, origem: 'atividade' }
  if (tem(n, K_I)) return { anexo: 'I', confianca: 0.9, precisaConfirmar: false, origem: 'atividade' }
  if (tem(n, K_V)) return { anexo: 'V', confianca: 0.75, precisaConfirmar: true, origem: 'atividade' }
  if (tem(n, K_III)) return { anexo: 'III', confianca: 0.75, precisaConfirmar: false, origem: 'atividade' }
  return { anexo: null, confianca: 0, precisaConfirmar: true, origem: null }
}

/** Amostra de exemplos (usada por testes e docs). */
export const ANEXO_POR_ATIVIDADE_EXEMPLOS: Array<{ texto: string; anexo: AnexoId | null }> = [
  { texto: 'sou comercio', anexo: 'I' },
  { texto: 'tenho lojinha de roupa', anexo: 'I' },
  { texto: 'vendo mercadoria para revenda', anexo: 'I' },
  { texto: 'tenho mercadinho', anexo: 'I' },
  { texto: 'sou lojista', anexo: 'I' },
  { texto: 'trabalho com revenda de cosmeticos', anexo: 'I' },
  { texto: 'tenho distribuidora', anexo: 'I' },
  { texto: 'sou comesio', anexo: 'I' },
  { texto: 'sou industria', anexo: 'II' },
  { texto: 'tenho fabrica de moveis', anexo: 'II' },
  { texto: 'eu fabrico moveis', anexo: 'II' },
  { texto: 'produzo alimentos na industria', anexo: 'II' },
  { texto: 'tenho salao de beleza', anexo: 'III' },
  { texto: 'sou barbeiro', anexo: 'III' },
  { texto: 'tenho academia', anexo: 'III' },
  { texto: 'dou aula de yoga', anexo: 'III' },
  { texto: 'faco manutencao e reparos', anexo: 'III' },
  { texto: 'trabalho com locacao de bens moveis', anexo: 'III' },
  { texto: 'tenho creche', anexo: 'III' },
  { texto: 'tenho escolinha', anexo: 'III' },
  { texto: 'sou da construcao civil', anexo: 'IV' },
  { texto: 'faco obra por empreitada', anexo: 'IV' },
  { texto: 'tenho empresa de vigilancia', anexo: 'IV' },
  { texto: 'faco limpeza e conservacao', anexo: 'IV' },
  { texto: 'sou advogado', anexo: 'IV' },
  { texto: 'tenho escritorio de advocacia', anexo: 'IV' },
  { texto: 'sou medico', anexo: 'V' },
  { texto: 'sou engenheiro', anexo: 'V' },
  { texto: 'sou contador', anexo: 'V' },
  { texto: 'trabalho com TI', anexo: 'V' },
  { texto: 'sou programador', anexo: 'V' },
  { texto: 'faco software', anexo: 'V' },
  { texto: 'sou designer', anexo: 'V' },
  { texto: 'faco consultoria empresarial', anexo: 'V' },
  { texto: 'sou auditor', anexo: 'V' },
  { texto: 'trabalho com publicidade', anexo: 'V' },
]
