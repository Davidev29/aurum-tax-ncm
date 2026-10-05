/**
 * Motor de janela deslizante da RBT12 (Etapa 3 — implementado).
 *
 * Regras oficiais (não negociar):
 * - RBT12(t) = soma(R[m]) para m em [t-12, t-1] (nunca inclui o próprio mês).
 * - Empresa nova (< 12 meses): RBT12 = (soma desde abertura / meses) × 12.
 * - 1º mês de empresa nova sem histórico: RBT12 = receita do mês × 12.
 *
 * PURA: sem I/O, sem rede, sem banco. Erros explícitos, sem engolir exceção.
 */
import type { ItemJanelaRBT12, MesReceita, ParamsJanelaRBT12 } from './types';

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function validarMesReceitaLista(lista: MesReceita[], campo: string): void {
  if (!Array.isArray(lista)) throw new Error(`${campo} deve ser um array de { mes, receita }.`);
  for (const item of lista) {
    if (!item || typeof item !== 'object') throw new Error(`${campo} contém item inválido (esperado { mes: YYYY-MM, receita: number }).`);
    if (!MES_RE.test(item.mes)) {
      throw new Error(`${campo} contém mês inválido "${String(item.mes)}" (use YYYY-MM).`);
    }
    if (!Number.isFinite(item.receita) || item.receita < 0) {
      throw new Error(`${campo}[${item.mes}] tem receita inválida (esperado número >= 0).`);
    }
  }
}

/**
 * Projeta a série de RBT12 mês a mês por janela deslizante.
 * PURA: sem I/O, sem rede, sem banco.
 */
export function projetarRBT12Rolling(params: ParamsJanelaRBT12): ItemJanelaRBT12[] {
  if (!params || typeof params !== 'object') {
    throw new Error('params inválido: informe { mesInicio, historico12, projecaoMensal }.');
  }
  const { mesInicio, historico12, projecaoMensal } = params;
  if (!MES_RE.test(mesInicio)) {
    throw new Error(`mesInicio inválido "${String(mesInicio)}" (use YYYY-MM, ex. "2026-01").`);
  }
  validarMesReceitaLista(historico12, 'historico12');
  validarMesReceitaLista(projecaoMensal, 'projecaoMensal');
  if (historico12.length > 12) {
    throw new Error(
      `historico12 deve ter no máximo 12 meses anteriores a ${mesInicio} (recebido ${historico12.length}). Use exatamente os 12 meses [t-12, t-1].`,
    );
  }
  if (projecaoMensal.length === 0) {
    throw new Error('projecaoMensal vazia: informe ao menos 1 mês projetado em ordem cronológica.');
  }
  if (projecaoMensal[0]!.mes !== mesInicio) {
    throw new Error(
      `projecaoMensal[0].mes ("${projecaoMensal[0]!.mes}") diverge de mesInicio ("${mesInicio}"). Alinhe a série projetada ao mês de início.`,
    );
  }
  const mesesAtividade = params.mesesAtividade ?? historico12.length;
  if (!Number.isInteger(mesesAtividade) || mesesAtividade < 0) {
    throw new Error('mesesAtividade inválido: use inteiro >= 0 (meses de atividade na abertura da projeção).');
  }

  // Fila cronológica de receitas conhecidas ANTERIORES a cada t.
  const fila: MesReceita[] = [...historico12];
  const out: ItemJanelaRBT12[] = [];

  for (let i = 0; i < projecaoMensal.length; i++) {
    const atual = projecaoMensal[i]!;
    const mesesAbertosEmT = mesesAtividade + i;
    const ehEmpresaNova = mesesAbertosEmT < 12;

    let rbt12: number;
    if (!ehEmpresaNova) {
      // Regime cheio: soma dos 12 anteriores (nunca inclui o próprio mês).
      const janela = fila.slice(-12);
      rbt12 = janela.reduce((s, m) => s + m.receita, 0);
    } else {
      // Regime proporcional: média desde abertura × 12.
      const soma = fila.reduce((s, m) => s + m.receita, 0);
      if (mesesAbertosEmT <= 0) {
        // 1º mês sem histórico: RBT12 = receita do mês × 12.
        rbt12 = atual.receita * 12;
      } else {
        rbt12 = (soma / mesesAbertosEmT) * 12;
      }
    }

    // Rastreabilidade da janela (para auditoria da série).
    const janelaEfetiva = ehEmpresaNova ? [...fila] : fila.slice(-12);
    const mesEntrando = janelaEfetiva.length > 0 ? janelaEfetiva[janelaEfetiva.length - 1]!.mes : null;
    // Mês que saiu vs. janela do período anterior (apenas regime cheio a partir do 2º mês).
    // Fila pré-push tem L itens; janela atual = [L-12, L-1], anterior = [L-13, L-2] → saiu = fila[L-13].
    const mesSaindo =
      !ehEmpresaNova && i > 0 && fila.length >= 13 ? fila[fila.length - 13]!.mes : null;

    out.push({
      mes: atual.mes,
      rbt12: Math.round(rbt12 * 100) / 100,
      mesSaindo,
      mesEntrando,
      receitaMes: atual.receita,
      empresaNova: ehEmpresaNova ? true : undefined,
    });

    // Avança a fila: a receita do mês atual passa a compor o RBT12 do mês seguinte.
    fila.push(atual);
  }

  return out;
}
