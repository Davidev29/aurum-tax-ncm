/**
 * DAS segregado por anexo (intra-empresa) — LC 123/2006, art. 18.
 *
 * Empresa com atividades em mais de um anexo apura o Simples segregando as
 * receitas: a RBT12 TOTAL define a faixa em cada tabela, cada parcela é
 * tributada pela alíquota efetiva do seu anexo e o DAS é a soma.
 *
 * REGRA DE OURO respeitada: consome APENAS `calcularConvencional` e
 * `ANEXOS_SIMPLES` (exports públicos). Nenhuma fórmula fiscal aqui.
 *
 * PURA: sem I/O, sem rede, sem banco.
 */
import { calcularConvencional } from '@/simples/calculo';
import { ANEXOS_SIMPLES, type AnexoSimplesId } from '@/simples/tabelas';

export interface ParcelaAnexo {
  anexoId: AnexoSimplesId;
  receitaMes: number;
}

export interface DetalheParcelaAnexo {
  anexoId: AnexoSimplesId;
  receitaMes: number;
  faixa: number;
  aliquotaNominal?: number;
  aliquotaEfetiva: number;
  das: number;
}

export interface ResultadoSegregado {
  das: number;
  parcelas: DetalheParcelaAnexo[];
}

/**
 * Soma o DAS das parcelas usando a RBT12 TOTAL em cada tabela.
 * Parcela com receita zerada contribui com DAS 0 (faixa da tabela no RBT12).
 */
export function calcularDASegregado(rbt12Total: number, parcelas: ParcelaAnexo[]): ResultadoSegregado {
  if (!Array.isArray(parcelas) || parcelas.length === 0) {
    throw new Error('parcelas vazias: informe ao menos { anexoId, receitaMes }.');
  }
  const det: DetalheParcelaAnexo[] = parcelas.map((p) => {
    const conv = calcularConvencional({
      anexoId: p.anexoId,
      rbt12: Math.max(0, Number(rbt12Total) || 0),
      receitaMes: Math.max(0, Number(p.receitaMes) || 0),
    });
    const tab = ANEXOS_SIMPLES[p.anexoId].faixas.find((f) => f.faixa === conv.faixa);
    return {
      anexoId: p.anexoId,
      receitaMes: Math.max(0, Number(p.receitaMes) || 0),
      faixa: conv.faixa,
      aliquotaNominal: tab?.aliquotaNominal,
      aliquotaEfetiva: conv.aliquotaEfetiva,
      das: conv.das,
    };
  });
  const das = Math.round(det.reduce((a, d) => a + d.das, 0) * 100) / 100;
  return { das, parcelas: det };
}

/**
 * Normaliza composição percentual [{anexoId, percentual}] → soma 1.
 * Entrada com soma ≤ 0 lança erro; percentuais negativos lançam erro.
 */
export function normalizarComposicao(
  composicao: Array<{ anexoId: AnexoSimplesId; percentual: number }>,
): Array<{ anexoId: AnexoSimplesId; percentual: number }> {
  const limpa = (composicao ?? []).filter((c) => c && Number(c.percentual) > 0);
  const soma = limpa.reduce((a, c) => a + Number(c.percentual), 0);
  if (limpa.length === 0 || !(soma > 0)) {
    throw new Error('composição inválida: informe percentuais > 0 com soma > 0.');
  }
  for (const c of limpa) {
    if (!Number.isFinite(Number(c.percentual)) || Number(c.percentual) < 0) {
      throw new Error(`composição inválida no anexo ${String(c.anexoId)}: use percentual 0..1.`);
    }
  }
  return limpa.map((c) => ({ anexoId: c.anexoId, percentual: Number(c.percentual) / soma }));
}
