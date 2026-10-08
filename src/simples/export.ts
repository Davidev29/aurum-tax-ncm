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
  /** Referência sem segregar (anexo único) — linha própria no CSV. */
  dasReferencia: number;
  st?: { ativo: boolean; tributo: string; valorST: number; deducao: number; detalhe: string; detalhePorTributo: Array<{ tributo: string; valorST: number; deducao: number }>; dasIntegral: number; dasFinal: number };
  seg?: { ativo: boolean; anexos: string[]; dasBruto: number; parcelas: Array<{ anexoId: string; anexoCalculado: string; escolhido: string; receitaMes: number; faixa: number; aliquotaEfetiva: number; das: number; dasBruto: number; st: boolean; tributoST: string | null; deducaoST: number; resto: boolean }> };
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
    ...(p.seg?.ativo ? [
      ['Anexos segregados (efetivos)', p.seg.anexos.join(' + ')],
      ...p.seg.parcelas.map((d) => [`${d.resto ? 'Restante' : 'Parcela'} Anexo ${d.anexoCalculado}${d.anexoCalculado !== d.escolhido ? ` (escolhido ${d.escolhido})` : ''} — receita`, d.receitaMes.toFixed(2)]),
      ...p.seg.parcelas.map((d) => [`${d.resto ? 'Restante' : 'Parcela'} Anexo ${d.anexoCalculado} — DAS (${(d.aliquotaEfetiva * 100).toFixed(4)}%, ${d.faixa}ª faixa)${d.st && d.tributoST ? ` · ST ${d.tributoST} −${Number(d.deducaoST).toFixed(2)}` : ''}`, d.das.toFixed(2)]),
      ['DAS bruto (soma parcelas)', p.seg.dasBruto.toFixed(2)],
      ['DAS segregado (guia)', p.conv.dasGuia.toFixed(2)],
      ['DAS convencional (anexo único, referência)', p.dasReferencia.toFixed(2)],
    ] as unknown[][] : [
      ['DAS convencional (guia)', p.conv.dasGuia.toFixed(2)],
    ] as unknown[][]),
    ...(p.conv.excedeSublimite ? [
      ['Guia DAS (sem ICMS/ISS/IBS do sublimite)', p.conv.dasGuia.toFixed(2)],
      ['ICMS fora da guia (sublimite)', p.conv.foraSublimite.icms.toFixed(2)],
      ['ISS fora da guia (sublimite)', p.conv.foraSublimite.iss.toFixed(2)],
      ['IBS fora da guia (sublimite)', p.conv.foraSublimite.ibs.toFixed(2)],
      ['Carga total (guia + fora)', p.conv.cargaTotal.toFixed(2)],
    ] as unknown[][] : []),
    ...(p.st?.ativo ? [
      ...p.st.detalhePorTributo.map((d) => [`Receita com ST (${d.tributo})`, Number(d.valorST).toFixed(2)]),
      ...p.st.detalhePorTributo.map((d) => [`Dedução ST (${d.tributo})`, Number(d.deducao).toFixed(2)]),
      ['DAS final (guia)', p.st.dasFinal.toFixed(2)],
    ] as unknown[][] : []),
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
      ['DAS reduzido (híbrido, guia)', p.hib.dasReduzido.toFixed(2)],
      ['Débitos CBS', p.debitosCBS.toFixed(2)],
      ['Créditos CBS', p.creditosCBS.toFixed(2)],
      ['CBS a recolher', p.hib.cbsFora.toFixed(2)],
      ['Total híbrido (guia)', p.hib.total.toFixed(2)],
      ...(p.conv.excedeSublimite ? [['Carga híbrida total (guia + fora)', p.hib.cargaTotal.toFixed(2)]] as unknown[][] : []),
      ['Melhor regime (na guia)', p.hib.melhor],
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
