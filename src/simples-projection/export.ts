/**
 * Simples Projection — export CSV/JSON da simulação (camada ADITIVA).
 *
 * Padrão do projeto: `montarCSV`/`baixar` de
 * `src/infrastructure/exporters/relatorios.ts` (espelha `src/simples/export.ts`).
 */
import { montarCSV, baixar } from '@/infrastructure/exporters/relatorios';
import type { RelatorioProjecao } from './types';

function nomeBase(mesInicio: string): string {
  return `projecao-dividida-${mesInicio}`;
}

export function exportarProjecaoCSV(rel: RelatorioProjecao): void {
  const linhas: string[][] = [
    ['mes', 'receita_total', 'receita_mae', 'receita_nova', 'rbt12_mae', 'rbt12_nova', 'rbt12_ref', 'faixa_mae', 'faixa_nova', 'faixa_ref', 'aliq_nominal_mae', 'aliq_nominal_nova', 'aliq_nominal_ref', 'aliq_efet_mae', 'aliq_efet_nova', 'aliq_efet_ref', 'das_mae', 'das_nova', 'das_unificado', 'economia_bruta', 'custo_mes', 'economia_mes', 'economia_acumulada'],
    ...rel.serieMensal.map((l) => [
      l.mes,
      l.receitaTotal.toFixed(2),
      l.receitaMae.toFixed(2),
      l.receitaNova.toFixed(2),
      l.rbt12Mae.toFixed(2),
      l.rbt12Nova.toFixed(2),
      (l.rbt12Ref ?? 0).toFixed(2),
      String(l.faixaMae),
      String(l.faixaNova),
      String(l.faixaRef ?? ''),
      (l.aliquotaNominalMae ?? 0).toFixed(6),
      (l.aliquotaNominalNova ?? 0).toFixed(6),
      (l.aliquotaNominalRef ?? 0).toFixed(6),
      l.aliquotaEfetivaMae.toFixed(6),
      l.aliquotaEfetivaNova.toFixed(6),
      (l.aliquotaEfetivaRef ?? 0).toFixed(6),
      l.dasMae.toFixed(2),
      l.dasNova.toFixed(2),
      l.dasUnificadoReferencia.toFixed(2),
      (l.economiaBrutaMes ?? 0).toFixed(2),
      (l.custoMes ?? 0).toFixed(2),
      l.economiaMes.toFixed(2),
      l.economiaAcumulada.toFixed(2),
    ]),
  ];
  baixar(`${nomeBase(rel.metadados.mesInicio)}.csv`, montarCSV(linhas), 'text/csv;charset=utf-8');
}

export function exportarProjecaoJSON(rel: RelatorioProjecao): void {
  baixar(`${nomeBase(rel.metadados.mesInicio)}.json`, JSON.stringify(rel, null, 2), 'application/json;charset=utf-8');
}
