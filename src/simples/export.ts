/**
 * Simples Nacional — exportação isolada (CSV / JSON).
 * Reusa apenas `montarCSV` + `baixar` genéricos.
 */
import { montarCSV, baixar } from '@/infrastructure/exporters/relatorios';
import type { ResultadoConvencional, ResultadoHibrido } from './calculo';
import { ANEXO_LABEL, type AnexoSimplesId } from './tabelas';

export interface PayloadSimples {
  anexoId: AnexoSimplesId;
  rbt12: number;
  receitaMes: number;
  folha12: number;
  rba: number;
  cbsRef: number;
  conv: ResultadoConvencional;
  hib: ResultadoHibrido | null;
  debitosCBS: number;
  creditosCBS: number;
  empresa?: string;
  cnae?: string;
}

const hoje = (): string => new Date().toISOString().slice(0, 10);

export function csvSimples(p: PayloadSimples): string {
  const temFatorR = p.rbt12 > 0 && p.folha12 > 0;
  const indiceFR = temFatorR ? p.folha12 / p.rbt12 : 0;
  const anexoFR = indiceFR >= 0.28 ? 'III' : 'V';
  const linhas: unknown[][] = [
    ['Simples Nacional (LC 123/2006 + LC 214/2025)', `Gerado em ${new Date().toLocaleString('pt-BR')}`],
    ['Anexo utilizado (efetivo)', ANEXO_LABEL[p.anexoId]],
    ...(temFatorR ? [[`Fator R (folha/RBT12)`, `${(indiceFR * 100).toFixed(2)}% → Anexo ${anexoFR} (regra: ≥ 28% III, < 28% V)`]] as unknown[][] : []),
    ['Faixa', `${p.conv.faixa}ª`],
    ['Cenário sublimite', String(p.conv.cenario)],
    ['RBT12', p.rbt12.toFixed(2)],
    ['Receita do mês', p.receitaMes.toFixed(2)],
    ['Folha 12m', p.folha12.toFixed(2)],
    ['RBA', p.rba.toFixed(2)],
    ['Alíquota efetiva', (p.conv.aliquotaEfetiva * 100).toFixed(4) + '%'],
    ['DAS convencional', p.conv.das.toFixed(2)],
    ['CBS dentro do DAS', p.conv.cbsDentroDAS.toFixed(2)],
    ['IRPJ', p.conv.reparticao.IRPJ.toFixed(2)],
    ['CSLL', p.conv.reparticao.CSLL.toFixed(2)],
    ['CBS repartição', p.conv.reparticao.CBS.toFixed(2)],
    ['IBS', p.conv.reparticao.IBS.toFixed(2)],
    ['CPP', p.conv.reparticao.CPP.toFixed(2)],
    ['ICMS', p.conv.reparticao.ICMS.toFixed(2)],
    ['IPI', p.conv.reparticao.IPI.toFixed(2)],
    ['ISS', p.conv.reparticao.ISS.toFixed(2)],
  ];
  if (p.hib) {
    linhas.push(
      ['DAS reduzido (híbrido)', p.hib.dasReduzido.toFixed(2)],
      ['Débitos CBS', p.debitosCBS.toFixed(2)],
      ['Créditos CBS', p.creditosCBS.toFixed(2)],
      ['CBS a recolher', p.hib.cbsFora.toFixed(2)],
      ['Total híbrido', p.hib.total.toFixed(2)],
      ['Melhor regime', p.hib.melhor],
    );
  }
  return montarCSV(linhas);
}

export function jsonSimples(p: PayloadSimples): string {
  return JSON.stringify({ exportadoEm: new Date().toISOString(), ...p }, null, 2);
}

export function exportarSimplesCSV(p: PayloadSimples): void {
  baixar(`simples_${p.anexoId}_${hoje()}.csv`, csvSimples(p), 'text/csv;charset=utf-8');
}

export function exportarSimplesJSON(p: PayloadSimples): void {
  baixar(`simples_${p.anexoId}_${hoje()}.json`, jsonSimples(p), 'application/json');
}
