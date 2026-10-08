/**
 * Baseline temporal da projeção — regra legal (LC 123/2006, art. 18).
 *
 * - RBT12(t) = receita dos 12 meses ANTERIORES ao período de apuração t,
 *   ou seja, a janela é [t-12, t-1]: a competência em curso (t) NUNCA compõe
 *   a própria RBT12 — cada competência só entra na RBT12 a partir do mês
 *   seguinte (quando já está encerrada/escriturada).
 * - O início da projeção é a competência em curso (mês atual do calendário).
 *   O histórico RTB12/RBT12 corresponde aos 12 meses anteriores a ele
 *   ("Atual − 1" para trás). Ex.: início 10/2026 → histórico 10/2025 → 09/2026.
 *
 * PURA: sem I/O. Persistência por CNPJ fica em `persistencia.ts`.
 */

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function somarMesesLocal(base: string, delta: number): string {
  const [a, m] = base.split('-').map(Number);
  const d = new Date(Date.UTC(a ?? 1970, ((m ?? 1) - 1) + delta, 1));
  const y = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${mm}`;
}

/** Competência em curso (mês atual do calendário) — `YYYY-MM`. */
export function mesAtualCompetencia(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Mês de início padrão da projeção = competência em curso. */
export function mesInicioPadrao(): string {
  return mesAtualCompetencia();
}

/** 12 meses de histórico anteriores ao `mesInicio` (ordem cronológica). */
export function historico12Labels(mesInicio: string): string[] {
  if (!MES_RE.test(mesInicio)) throw new Error(`mesInicio inválido "${mesInicio}" (use YYYY-MM).`);
  const out: string[] = [];
  for (let i = 12; i >= 1; i--) out.push(somarMesesLocal(mesInicio, -i));
  return out;
}

/** `MM/AAAA` para exibição no cabeçalho. */
export function rotuloPeriodo(mes: string): string {
  const [a, m] = mes.split('-');
  return `${m}/${a}`;
}

/**
 * Período de referência para o cabeçalho: `primeiro → último` do histórico
 * (janela [t-12, t-1] — exclui o mês de início, em curso).
 */
export function periodoReferencia(historico12: Array<{ mes: string }>): string {
  if (!historico12.length) {
    const ref = mesInicioPadrao();
    return `${rotuloPeriodo(somarMesesLocal(ref, -2))} → ${rotuloPeriodo(somarMesesLocal(ref, -1))}`;
  }
  const primeiro = historico12[0]!.mes;
  const ultimo = historico12[historico12.length - 1]!.mes;
  return `${rotuloPeriodo(primeiro)} → ${rotuloPeriodo(ultimo)}`;
}

export type CurvaDistribuicao = 'igual' | 'crescente' | 'sazonal';

function pesosCurva(n: number, curva: CurvaDistribuicao): number[] {
  if (curva === 'crescente') {
    // Rampa linear 1..n normalizada.
    const soma = (n * (n + 1)) / 2;
    return Array.from({ length: n }, (_, i) => (i + 1) / soma);
  }
  if (curva === 'sazonal') {
    // Curva suave: pico no 11º mês (13º salário / festas), vale no 2º.
    const brutos = Array.from({ length: n }, (_, i) => 1 + 0.22 * Math.sin(((i + 1) / n) * Math.PI * 2 - 1.1));
    const soma = brutos.reduce((a, b) => a + b, 0);
    return brutos.map((b) => b / soma);
  }
  return Array.from({ length: n }, () => 1 / n);
}

/**
 * Distribui o total da RTB12 entre 12 meses.
 * Garante soma exata (ajuste de centavos no último mês).
 */
export function distribuirRTB12(
  total: number,
  meses: string[],
  curva: CurvaDistribuicao = 'igual',
): Array<{ mes: string; receita: number }> {
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error('RTB12 inválida: informe um total > 0.');
  }
  if (meses.length === 0) throw new Error('Meses vazios: informe ao menos 1 mês.');
  const pesos = pesosCurva(meses.length, curva);
  const out = meses.map((mes, i) => ({
    mes,
    receita: Math.round(total * (pesos[i] ?? 1 / meses.length) * 100) / 100,
  }));
  const soma = out.reduce((a, r) => a + r.receita, 0);
  const diff = Math.round((total - soma) * 100) / 100;
  out[out.length - 1]!.receita = Math.round((out[out.length - 1]!.receita + diff) * 100) / 100;
  return out;
}

/** Validação obrigatória: RTB12 ≠ 0 e nenhum mês vazio no modo manual. */
export function validarRTB12(
  historico: Array<{ mes: string; receita: number }>,
): { ok: boolean; erros: string[]; total: number } {
  const erros: string[] = [];
  const total = historico.reduce((a, r) => a + (Number(r.receita) || 0), 0);
  if (!(total > 0)) erros.push('RTB12 zerada: informe receitas > 0 em ao menos um mês.');
  const vazios = historico.filter((r) => !(Number(r.receita) > 0)).map((r) => r.mes);
  if (vazios.length > 0 && total > 0) {
    // Alerta (não bloqueia): mês zerado pode ser sazonalidade real.
    erros.push(`Meses zerados: ${vazios.join(', ')} — confirme se é sazonalidade ou dado faltante.`);
  }
  return { ok: erros.length === 0 || (erros.length === 1 && total > 0 && vazios.length > 0), erros, total };
}
