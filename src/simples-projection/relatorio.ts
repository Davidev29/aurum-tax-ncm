/**
 * Contrato de saída do relatório (Etapa 5 — implementado).
 * Envelope canônico: serieMensal + payback + economiaTotal + alertas +
 * insightsSugeridos (container vazio para a LLM preencher depois).
 */
import { RBT12_MAX, SUBLIMITE } from '@/simples/tabelas';
import type { AlertaFiscal, LinhaCenarioMensal, RelatorioProjecao } from './types';

/** Reexporta o contrato canônico (fonte: `types.ts`). */
export type { AlertaFiscal, LinhaCenarioMensal, RelatorioProjecao };

/** Emite os alertas fiscais obrigatórios a partir da série (sem Fator R — ver orquestrador). */
export function emitirAlertasFiscais(serie: LinhaCenarioMensal[]): AlertaFiscal[] {
  const alertas: AlertaFiscal[] = [];
  for (const linha of serie) {
    if (linha.rbt12Mae > SUBLIMITE || linha.rbt12Nova > SUBLIMITE) {
      alertas.push({
        codigo: 'SUBLIMITE_3_6M',
        mes: linha.mes,
        mensagem: `RBT12 acima do sublimite R$ 3,6M em ${linha.mes}: ISS/ICMS saem do DAS na parcela excedente.`,
      });
    }
    if (linha.rbt12Mae > RBT12_MAX || linha.rbt12Nova > RBT12_MAX) {
      alertas.push({
        codigo: 'DESENQUADRAMENTO_4_8M',
        mes: linha.mes,
        mensagem: `RBT12 acima de R$ 4,8M em ${linha.mes}: risco de desenquadramento do Simples.`,
      });
    }
  }
  alertas.push({
    codigo: 'CONSOLIDACAO_RECEITA_GRUPO',
    mes: null,
    mensagem: 'Projeção informativa: grupo econômico pode exigir consolidação de receita — valide com contador.',
  });
  return alertas;
}

export interface MetadadosRelatorio {
  mesInicio: string;
  percentualNova: number;
  anexoMae: RelatorioProjecao['metadados']['anexoMae'];
  anexoNova: RelatorioProjecao['metadados']['anexoNova'];
  motorVersao?: string;
}

/** Monta o envelope final a partir da série mensal (recalcula payback/economia). */
export function montarRelatorioProjecao(
  serie: LinhaCenarioMensal[],
  metadados: MetadadosRelatorio,
): RelatorioProjecao {
  if (!Array.isArray(serie) || serie.length === 0) {
    throw new Error('serie vazia: informe a série mensal do orquestrador (simularCenarioDividido).');
  }
  let acumulado = 0;
  let paybackMes: string | null = null;
  let paybackIdx: number | null = null;
  let paybackValor: number | null = null;
  const serieOrdenada = [...serie].sort((a, b) => (a.mes < b.mes ? -1 : a.mes > b.mes ? 1 : 0));
  for (let i = 0; i < serieOrdenada.length; i++) {
    const linha = serieOrdenada[i]!;
    acumulado = Math.round((acumulado + linha.economiaMes) * 100) / 100;
    if (paybackMes === null && acumulado > 0) {
      paybackMes = linha.mes;
      paybackIdx = i + 1;
      paybackValor = acumulado;
    }
  }
  return {
    serieMensal: serieOrdenada,
    payback: { mes: paybackMes, mesesAtePayback: paybackIdx, valorAcumuladoNoPayback: paybackValor },
    economiaTotal: acumulado,
    alertas: emitirAlertasFiscais(serieOrdenada),
    insightsSugeridos: [],
    metadados: {
      mesInicio: metadados.mesInicio,
      horizonteMeses: serieOrdenada.length,
      percentualNova: metadados.percentualNova,
      anexoMae: metadados.anexoMae,
      anexoNova: metadados.anexoNova,
      motorVersao: metadados.motorVersao ?? 'simples-projection v1 + calc-engine v3',
    },
  };
}
