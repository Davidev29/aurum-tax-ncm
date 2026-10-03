/**
 * Simples Nacional — exportação isolada (CSV / JSON / PDF).
 * Reusa apenas `montarCSV` + `baixar` genéricos; PDF via setup lazy.
 */
import { montarCSV, baixar } from '@/infrastructure/exporters/relatorios';
import { fmtCarga, fmtMoeda } from '@/domain/services/format';
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

export async function exportarSimplesPDF(p: PayloadSimples): Promise<void> {
  const { baixarPdf } = await import('@/infrastructure/pdf/setup');
  const cor = '#1e2f4d';
  const temFatorR = p.rbt12 > 0 && p.folha12 > 0;
  const indiceFR = temFatorR ? p.folha12 / p.rbt12 : 0;
  const anexoFR = indiceFR >= 0.28 ? 'III' : 'V';
  const subtituloFatorR = temFatorR ? ` · Fator R ${(indiceFR * 100).toFixed(2)}% → Anexo ${anexoFR}` : '';
  const doc = {
    pageSize: 'A4' as const,
    pageMargins: [34, 60, 34, 44] as [number, number, number, number],
    defaultStyle: { font: 'Roboto' as const, fontSize: 8, color: '#1e293b' },
    info: { title: 'Simples Nacional — relatório', author: 'Aurum Tax NCM', creator: 'Aurum Tax NCM' },
    content: [
      { text: 'Simples Nacional — LC 123/2006 + LC 214/2025 (2027–2028)', fontSize: 13, bold: true, color: cor },
      { text: `${ANEXO_LABEL[p.anexoId]} · ${p.conv.faixa}ª faixa · Cenário sublimite ${p.conv.cenario}${subtituloFatorR}`, fontSize: 8, color: '#64748b', margin: [0, 2, 0, 8] as [number, number, number, number] },
      {
        table: {
          widths: ['*', '*', '*'],
          body: [
            [
              { text: `RBT12\n${fmtMoeda(p.rbt12)}`, fontSize: 9, bold: true },
              { text: `Receita do mês\n${fmtMoeda(p.receitaMes)}`, fontSize: 9, bold: true },
              { text: `DAS\n${fmtMoeda(p.conv.das)} (${fmtCarga(p.conv.aliquotaEfetiva * 100)})`, fontSize: 9, bold: true },
            ],
          ],
        },
        layout: 'noBorders' as const,
        margin: [0, 0, 0, 8] as [number, number, number, number],
      },
      {
        table: {
          headerRows: 1,
          widths: ['*', '30%', '30%'],
          body: [
            [{ text: 'Tributo', bold: true, color: '#fff', fillColor: cor }, { text: 'Valor', bold: true, color: '#fff', fillColor: cor }, { text: '% repartição', bold: true, color: '#fff', fillColor: cor }],
            ...(['IRPJ', 'CSLL', 'CBS', 'IBS', 'CPP', 'ICMS', 'IPI', 'ISS'] as const).map((t) => [
              t,
              fmtMoeda(p.conv.reparticao[t]),
              p.conv.das > 0 ? fmtCarga((p.conv.reparticao[t] / p.conv.das) * 100) : '—',
            ]),
            [{ text: 'TOTAL DAS', bold: true }, { text: fmtMoeda(p.conv.das), bold: true }, { text: fmtCarga(p.conv.aliquotaEfetiva * 100), bold: true }],
          ],
        },
      },
      ...(p.hib
        ? [
            { text: `Híbrido: DAS reduzido ${fmtMoeda(p.hib.dasReduzido)} + CBS fora ${fmtMoeda(p.hib.cbsFora)} = ${fmtMoeda(p.hib.total)} · Melhor: ${p.hib.melhor}`, fontSize: 8, margin: [0, 8, 0, 0] as [number, number, number, number] },
            { text: `CBS dentro do DAS ${fmtMoeda(p.conv.cbsDentroDAS)} · Débitos ${fmtMoeda(p.debitosCBS)} · Créditos ${fmtMoeda(p.creditosCBS)} · Saldo credor ${fmtMoeda(p.hib.saldoCredor)}`, fontSize: 7, color: '#64748b' },
          ]
        : [{ text: `CBS dentro do DAS ${fmtMoeda(p.conv.cbsDentroDAS)}`, fontSize: 7, color: '#64748b' }]),
    ],
  };
  await baixarPdf(doc as never, `simples_${p.anexoId}_${hoje()}.pdf`);
}
