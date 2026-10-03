/**
 * Exportação do Relatório Analítico e Inteligente (CSV / JSON / PDF premium).
 * Consome SOMENTE o `ReportAnalitico` + `AiInsight[]` — nunca recalcula.
 *
 * Padrão visual idêntico aos relatórios de XML/NFe (`relatorios.ts`):
 * timbrado + rodapé + marca d'água compartilhados, com o emitente do
 * escritório no timbre e a empresa cliente na capa.
 *
 * Ícones 100% vetoriais (canvas pdfMake): a fonte Roboto embutida não cobre
 * os blocos Unicode de formas geométricas/dingbats/setas (◆ ● ✓ ✦ → −),
 * então nenhum desses glifos aparece em texto — `pdfText()` os converte.
 */
import { baixar, montarCSV, rodape, timbrado } from '@/infrastructure/exporters/relatorios';
import { fundoMarcaDagua, OURO_AURUM } from '@/infrastructure/pdf/marca-dagua';
import { fmtCarga, fmtMoeda } from '@/domain/services/format';
import type { Emitente } from '@/domain/entities';
import type { AiInsight, NivelInsight } from './ia-insights';
import type { ReportAnalitico, ScenarioId } from './relatorio-analitico';

const VERDE = '#067647';
const VERDE_BG = '#ECFDF3';
const AZUL = '#175CD3';
const AZUL_BG = '#EFF8FF';
const AMBAR = '#B54708';
const CINZA = '#667085';
const COR_TITULO = '#1f3d37';

function cen(report: ReportAnalitico, id: ScenarioId) {
  const c = report.cenarios.find((x) => x.scenarioId === id);
  if (!c) throw new Error(`Cenário ausente: ${id}`);
  return c;
}

const nomeBase = (r: ReportAnalitico): string => {
  const tag = r.empresa.origem === 'MANUAL' ? 'MANUAL' : (r.empresa.cnpj ?? 'CNPJ').replace(/\D+/g, '').slice(0, 14) || 'CNPJ';
  return `Relatorio-Simples-${tag}-${r.competencia}-${r.hash}`;
};

/* ------------------------- texto seguro p/ Roboto ------------------------ */

/**
 * Faixas que a Roboto embutida no pdfMake não renderiza (saem como
 * retângulo vazio no PDF): setas, formas geométricas, dingbats, símbolos
 * diversos e emoji (pares surrogate). O restante (latim, · — × ÷ %) passa
 * intacto — inclusive acentos pt-BR.
 */
const RISCOS_PDF: Array<[RegExp, string]> = [
  [/[✓✔]/g, 'OK '],
  [/[⚠]/g, '!'],
  [/[✕✖❌]/g, 'x'],
  [/[\u2190-\u21FF\u27F0-\u27FF]/g, '»'],
  [/[−–]/g, '-'],
  [/[\u25A0-\u25FF]/g, '•'],
  [/[\u2700-\u27BF]/g, '•'],
  [/[≈]/g, '~'],
  [/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ''],
  // eslint-disable-next-line no-misleading-character-class
  [/[\uFE0F\u200D]/g, ''],
];

/** Sanitiza qualquer texto (inclusive IA e dados do usuário) para o PDF. */
export function pdfText(v: unknown): string {
  let s = String(v ?? '');
  for (const [rx, rep] of RISCOS_PDF) s = s.replace(rx, rep);
  return s.replace(/[ \t]{2,}/g, ' ');
}

/* ------------------------------- ícones ---------------------------------- */

type FormaIcone = 'check' | 'alerta' | 'info' | 'vazio';

const COR_FORMA: Record<FormaIcone, string> = {
  check: VERDE,
  alerta: AMBAR,
  info: AZUL,
  vazio: '#98A2B3',
};

/**
 * Ícone vetorial 10×10 desenhado em canvas (círculo + marca branca).
 * `check` = círculo verde com visto · `alerta` = círculo âmbar com `!` ·
 * `info` = quadrado arredondado azul · `vazio` = círculo cinza vazado.
 */
export function iconeCanvas(forma: FormaIcone): { canvas: unknown[] } {
  const cor = COR_FORMA[forma];
  if (forma === 'alerta') {
    return {
      canvas: [
        { type: 'ellipse', x: 5, y: 5, r1: 4.6, r2: 4.6, color: cor },
        { type: 'rect', x: 4.5, y: 2.2, w: 1, h: 3.4, color: '#FFFFFF' },
        { type: 'rect', x: 4.5, y: 6.2, w: 1, h: 1.1, color: '#FFFFFF' },
      ],
    };
  }
  if (forma === 'info') {
    return {
      canvas: [
        { type: 'rect', x: 0.5, y: 0.5, w: 9, h: 9, r: 2.4, color: cor },
        { type: 'rect', x: 4.5, y: 2.2, w: 1, h: 1.1, color: '#FFFFFF' },
        { type: 'rect', x: 4.5, y: 3.9, w: 1, h: 3.4, color: '#FFFFFF' },
      ],
    };
  }
  if (forma === 'vazio') {
    return {
      canvas: [{ type: 'ellipse', x: 5, y: 5, r1: 4.2, r2: 4.2, lineColor: cor, lineWidth: 1.2 }],
    };
  }
  return {
    canvas: [
      { type: 'ellipse', x: 5, y: 5, r1: 4.6, r2: 4.6, color: cor },
      {
        type: 'polyline',
        points: [{ x: 2.6, y: 5.2 }, { x: 4.4, y: 7 }, { x: 7.6, y: 3.2 }],
        lineColor: '#FFFFFF',
        lineWidth: 1.5,
      },
    ],
  };
}

/** Ícone do nível do insight: oportunidade, alerta ou informação. */
export function iconeNivel(nivel: NivelInsight): { canvas: unknown[] } {
  if (nivel === 'ALERTA') return iconeCanvas('alerta');
  if (nivel === 'INFO') return iconeCanvas('info');
  return iconeCanvas('check');
}

export const ROTULO_NIVEL: Record<NivelInsight, string> = {
  OPORTUNIDADE: 'Oportunidade',
  ALERTA: 'Alerta',
  INFO: 'Informação',
};

/** Linha [ícone | texto] para usar dentro de tabelas e colunas. */
function linhaIcone(forma: FormaIcone, texto: string, opts?: { bold?: boolean; fontSize?: number; color?: string }) {
  return {
    columns: [
      { width: 13, ...iconeCanvas(forma), margin: [0, 1.5, 0, 0] as [number, number, number, number] },
      {
        width: '*',
        text: pdfText(texto),
        bold: opts?.bold ?? false,
        fontSize: opts?.fontSize ?? 7.8,
        ...(opts?.color ? { color: opts.color } : {}),
      },
    ],
  };
}

/* --------------------------------- CSV/JSON ------------------------------- */

export function jsonRelatorioAnalitico(r: ReportAnalitico, insights: AiInsight[]): string {
  return JSON.stringify({ exportadoEm: new Date().toISOString(), report: r, insights }, null, 2);
}

export function csvRelatorioAnalitico(r: ReportAnalitico): string {
  const linhas: unknown[][] = [
    ['Relatório Analítico e Inteligente — Simples Nacional', `Gerado em ${new Date(r.geradoEm).toLocaleString('pt-BR')}`],
    ['Empresa', r.empresa.razaoSocial],
    ['Origem', r.empresa.origem === 'MANUAL' ? 'Cálculo Realizado via Preenchimento Manual' : 'CNPJ_API'],
    ['CNPJ', r.empresa.cnpj ?? '—'],
    ['Competência', r.competencia],
    ['Anexo em foco', r.dueloFoco.anexo],
    ['Matriz III x V exibida', r.contexto.mostrarMatrizIIIV ? 'Sim (CNPJ dual)' : 'Não (anexo único)'],
    ['RBT12', r.premissas.rbt12.toFixed(2)],
    ['RBA', r.premissas.rba.toFixed(2)],
    ['Receita do mês', r.premissas.receitaMes.toFixed(2)],
    ['Folha 12m', r.premissas.folha12.toFixed(2)],
    ['Fator r', `${(r.fatorR.valor * 100).toFixed(4)}%`],
    ['Gap folha p/ 28%', r.fatorR.gapFolha.toFixed(2)],
    ['Gap mensal pró-labore', r.fatorR.gapMensalProlabore.toFixed(2)],
    [],
    ['Cenário', 'Anexo', 'Regime', 'Faixa', 'Alíquota efetiva %', 'Total a pagar R$'],
    ...r.cenarios.map((c) => [c.scenarioId, c.anexo, c.regime, c.faixa, (c.aliquotaEfetiva * 100).toFixed(4), c.totalPagar.toFixed(2)]),
    [],
    ['De', 'Para', 'Delta R$', 'Delta p.p.'],
    ...r.comparativo.matrizDeltas.map((d) => [d.de, d.para, d.deltaRs.toFixed(2), d.deltaPp?.toFixed(2) ?? '—']),
  ];
  return montarCSV(linhas);
}

export function exportarRelatorioAnaliticoCSV(r: ReportAnalitico): void {
  baixar(`${nomeBase(r)}.csv`, csvRelatorioAnalitico(r), 'text/csv;charset=utf-8');
}

export function exportarRelatorioAnaliticoJSON(r: ReportAnalitico, insights: AiInsight[]): void {
  baixar(`${nomeBase(r)}.json`, jsonRelatorioAnalitico(r, insights), 'application/json');
}

/* ------------------------------- PDF premium ------------------------------ */

type Alin = 'left' | 'right' | 'center';

const th = (t: string) => ({ text: pdfText(t), bold: true, color: '#FFFFFF', fillColor: '#0F3D3E', fontSize: 7.5, margin: [5, 5, 5, 5] as [number, number, number, number] });
const td = (t: string, bold = false, align: Alin = 'left') => ({
  text: pdfText(t), bold, fontSize: 7.8, alignment: align, margin: [5, 4, 5, 4] as [number, number, number, number],
});
const tdN = (v: number, bold = false) => td(fmtMoeda(v), bold, 'right');

const tituloSecao = (n: string, titulo: string) => ({
  columns: [
    { width: 'auto', text: pdfText(n), bold: true, color: '#FFFFFF', fillColor: OURO_AURUM, fontSize: 9, margin: [0, 0, 0, 0] as [number, number, number, number] },
    { width: '*', text: `  ${pdfText(titulo)}`, bold: true, color: COR_TITULO, fontSize: 10.5, margin: [4, 1, 0, 0] as [number, number, number, number] },
  ],
  margin: [0, 10, 0, 5] as [number, number, number, number],
});

const faixaVeredito = (texto: string) => ({
  columns: [
    { width: 15, ...iconeCanvas('check'), margin: [6, 7, 0, 6] as [number, number, number, number] },
    { width: '*', text: pdfText(texto), bold: true, color: '#FFFFFF', fontSize: 8.5, margin: [2, 6, 6, 6] as [number, number, number, number] },
  ],
  fillColor: '#0F3D3E',
  margin: [0, 6, 0, 6] as [number, number, number, number],
});

const caixaVantagem = (vencedor: 'CONV' | 'HIB' | 'EMPATE', texto: string) => ({
  columns: [
    { width: 15, ...iconeCanvas(vencedor === 'EMPATE' ? 'vazio' : 'check'), margin: [6, 6, 0, 6] as [number, number, number, number] },
    { width: '*', text: pdfText(texto), bold: true, fontSize: 8, color: vencedor === 'HIB' ? VERDE : vencedor === 'CONV' ? AZUL : '#344054', margin: [2, 6, 6, 6] as [number, number, number, number] },
  ],
  fillColor: vencedor === 'HIB' ? VERDE_BG : vencedor === 'CONV' ? AZUL_BG : '#F2F4F7',
  margin: [0, 5, 0, 5] as [number, number, number, number],
});

function corEmitente(e: Emitente): string {
  const c = String(e?.cor ?? '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#0f215c';
}

/**
 * PDF premium no padrão dos relatórios de XML/NFe: mesmo timbrado, rodapé,
 * marca d'água e identidade do emitente — com a empresa cliente na capa.
 */
export async function exportarRelatorioAnaliticoPDF(
  r: ReportAnalitico,
  insights: AiInsight[],
  emitente: Emitente,
): Promise<void> {
  const { baixarPdf } = await import('@/infrastructure/pdf/setup');
  const cor = corEmitente(emitente);
  const comMatriz = r.contexto.mostrarMatrizIIIV;
  const d = r.dueloFoco;
  const memFoco = r.memoriaHibrido[d.anexo];
  const menor = r.comparativo.menorCargaScenarioId ? cen(r, r.comparativo.menorCargaScenarioId) : null;
  const dataGeracao = new Date(r.geradoEm).toLocaleString('pt-BR');

  const porId = (id: string): AiInsight | undefined => insights.find((i) => i.insightId === id);
  const vereditoTxt = porId('ins_veredito')?.texto ?? '';
  const memoriaTxt = porId('ins_memoria')?.texto ?? '';
  const acaoTxt = porId('ins_acao')?.texto ?? '';
  const fatorTxt = porId('ins_fator_r')?.texto ?? '';
  const hibridoTxt = porId('ins_hibrido')?.texto ?? '';

  const empresaLinha = [
    r.empresa.origem === 'MANUAL' ? 'Cálculo Realizado via Preenchimento Manual' : 'Dados via CNPJ',
    r.empresa.cnpj ? `CNPJ ${r.empresa.cnpj}` : '',
    r.empresa.cnaePrincipal ? `CNAE em análise ${r.empresa.cnaePrincipal} (Anexo ${r.contexto.anexosElegiveis.join(', ') || d.anexo})` : '',
    r.empresa.enderecoCompleto ? r.empresa.enderecoCompleto : '',
  ].filter(Boolean).join('   ·   ');

  const content: never[] = [];
  const push = (x: unknown): void => { (content as unknown[]).push(x); };

  // Capa — empresa cliente
  push({ text: pdfText(r.empresa.razaoSocial || 'Empresa'), fontSize: 13, bold: true, color: '#0F3D3E' });
  push({ text: pdfText(empresaLinha), fontSize: 7.5, color: r.empresa.origem === 'MANUAL' ? '#92400E' : VERDE, margin: [0, 2, 0, 8] as [number, number, number, number] });

  // KPIs
  if (comMatriz) {
    const iiiC = cen(r, 'III_CONV');
    const vC = cen(r, 'V_CONV');
    const eco = vC.totalPagar - iiiC.totalPagar;
    push({
      table: {
        widths: ['*', '*', '*'],
        body: [[
          { stack: [linhaIcone('check', 'Menor total', { bold: true, fontSize: 7.5 }), { text: menor ? fmtMoeda(menor.totalPagar) : '—', fontSize: 9, bold: true, margin: [15, 0, 0, 0] as [number, number, number, number] }], fillColor: VERDE_BG, margin: [6, 6, 6, 6] as [number, number, number, number] },
          { stack: [linhaIcone('check', 'Economia do Anexo V para o III', { bold: true, fontSize: 7.5 }), { text: fmtMoeda(eco), fontSize: 9, bold: true, margin: [15, 0, 0, 0] as [number, number, number, number] }], margin: [6, 6, 6, 6] as [number, number, number, number] },
          { stack: [linhaIcone('info', 'Fator r', { bold: true, fontSize: 7.5 }), { text: r.fatorR.dadosSuficientes ? fmtCarga(r.fatorR.valor * 100) : '—', fontSize: 9, bold: true, margin: [15, 0, 0, 0] as [number, number, number, number] }], margin: [6, 6, 6, 6] as [number, number, number, number] },
        ]],
      },
      layout: 'noBorders' as const, margin: [0, 0, 0, 2] as [number, number, number, number],
    });
  } else {
    push({
      table: {
        widths: ['*', '*', '*'],
        body: [[
          { stack: [linhaIcone(d.vencedor === 'CONV' ? 'check' : 'vazio', `Convencional · Anexo ${d.anexo}`, { bold: true, fontSize: 7.5 }), { text: fmtMoeda(d.convTotal), fontSize: 9, bold: true, margin: [15, 0, 0, 0] as [number, number, number, number] }], fillColor: d.vencedor === 'CONV' ? VERDE_BG : '#FFFFFF', margin: [6, 6, 6, 6] as [number, number, number, number] },
          { stack: [linhaIcone(d.vencedor === 'HIB' ? 'check' : 'vazio', `Híbrido · Anexo ${d.anexo}`, { bold: true, fontSize: 7.5 }), { text: fmtMoeda(d.hibTotal), fontSize: 9, bold: true, margin: [15, 0, 0, 0] as [number, number, number, number] }], fillColor: d.vencedor === 'HIB' ? VERDE_BG : '#FFFFFF', margin: [6, 6, 6, 6] as [number, number, number, number] },
          { stack: [linhaIcone('info', 'Diferença', { bold: true, fontSize: 7.5 }), { text: d.vencedor === 'EMPATE' ? 'Empate técnico' : fmtMoeda(Math.abs(d.deltaRs)), fontSize: 9, bold: true, margin: [15, 0, 0, 0] as [number, number, number, number] }], margin: [6, 6, 6, 6] as [number, number, number, number] },
        ]],
      },
      layout: 'noBorders' as const, margin: [0, 0, 0, 2] as [number, number, number, number],
    });
  }
  if (menor) push(faixaVeredito(`Veredito: menor carga — ${menor.scenarioId.replace('_', ' · ')} (${fmtMoeda(menor.totalPagar)}). Regra do DAS: ${r.premissas.regraDas}.`));
  if (vereditoTxt) push({ text: pdfText(vereditoTxt), fontSize: 8, italics: true, color: '#344054', margin: [0, 0, 0, 4] as [number, number, number, number] });

  // Seção 1 — duelo conforme elegibilidade
  if (comMatriz) {
    const iiiC = cen(r, 'III_CONV');
    const vC = cen(r, 'V_CONV');
    const iiiH = cen(r, 'III_HIB');
    const vH = cen(r, 'V_HIB');
    const ecoConv = vC.totalPagar - iiiC.totalPagar;
    const ecoHib = vH.totalPagar - iiiH.totalPagar;
    push(tituloSecao('1', 'Anexo III × Anexo V — Convencional × Híbrido'));
    push({ text: pdfText(`CNAE com dois anexos (III e V). Regra do DAS: ${r.premissas.regraDas}. CBS de referência: ${(r.premissas.cbsRef * 100).toFixed(2).replace('.', ',')}%.`), fontSize: 7.5, color: CINZA, margin: [0, 0, 0, 4] as [number, number, number, number] });
    push({
      table: {
        headerRows: 1,
        widths: ['32%', '23%', '23%', '22%'],
        body: [
          [th('Cenário'), th('Anexo III'), th('Anexo V'), th('Economia » III')],
          [td('Convencional — DAS total'), tdN(iiiC.totalPagar, iiiC.vencedor), tdN(vC.totalPagar, vC.vencedor), td(`- ${fmtMoeda(ecoConv)}`, true, 'right')],
          [td('Híbrido — DAS reduzido + CBS por fora'), tdN(iiiH.totalPagar, iiiH.vencedor), tdN(vH.totalPagar, vH.vencedor), td(`- ${fmtMoeda(ecoHib)}`, true, 'right')],
          [td('Alíquota efetiva no convencional', true), td(fmtCarga(iiiC.aliquotaEfetiva * 100), false, 'right'), td(fmtCarga(vC.aliquotaEfetiva * 100), false, 'right'), td(`${((vC.aliquotaEfetiva - iiiC.aliquotaEfetiva) * 100).toFixed(2).replace('.', ',')} p.p.`, true, 'right')],
        ],
      },
    });
    push(caixaVantagem('HIB', `Vantagem do Anexo III no convencional — economia de ${fmtMoeda(ecoConv)}. Motivo: a alíquota efetiva do Anexo III (${fmtCarga(iiiC.aliquotaEfetiva * 100)}) é menor que a do Anexo V (${fmtCarga(vC.aliquotaEfetiva * 100)}) nesta faixa de receita.`));
    push({ text: pdfText(`Híbrido = DAS sem CBS + CBS apurada por fora (débitos menos créditos). CBS dentro do DAS: ${fmtMoeda(iiiC.cbsDentroDas ?? 0)} no Anexo III e ${fmtMoeda(vC.cbsDentroDas ?? 0)} no Anexo V.`), fontSize: 7, color: CINZA });
    if (hibridoTxt) push({ text: pdfText(hibridoTxt), fontSize: 8, italics: true, color: '#344054', margin: [0, 3, 0, 0] as [number, number, number, number] });
  } else {
    push(tituloSecao('1', `Convencional × Híbrido — Anexo ${d.anexo}`));
    push({ text: pdfText(`CNAE de anexo único (${d.anexo}). Regra do DAS: ${r.premissas.regraDas}. CBS de referência: ${(r.premissas.cbsRef * 100).toFixed(2).replace('.', ',')}%. Alíquota efetiva no convencional: ${fmtCarga(d.aliquotaEfetivaConv * 100)}.`), fontSize: 7.5, color: CINZA, margin: [0, 0, 0, 4] as [number, number, number, number] });
    push({
      table: {
        headerRows: 1,
        widths: ['46%', '27%', '27%'],
        body: [
          [th('Regime'), th('Total a pagar'), th('Situação')],
          [td('Convencional — DAS com CBS dentro'), tdN(d.convTotal, d.vencedor === 'CONV'), d.vencedor === 'CONV' ? linhaIcone('check', 'Vantagem', { bold: true }) : d.vencedor === 'EMPATE' ? linhaIcone('vazio', 'Empate', { bold: true }) : linhaIcone('vazio', 'Desvantagem', { bold: true })],
          [td(`Híbrido — DAS reduzido (${fmtMoeda(memFoco.dasReduzido)}) + CBS por fora (${fmtMoeda(memFoco.cbsARecolher)})`), tdN(d.hibTotal, d.vencedor === 'HIB'), d.vencedor === 'HIB' ? linhaIcone('check', 'Vantagem', { bold: true }) : d.vencedor === 'EMPATE' ? linhaIcone('vazio', 'Empate', { bold: true }) : linhaIcone('vazio', 'Desvantagem', { bold: true })],
        ],
      },
    });
    push(caixaVantagem(
      d.vencedor,
      d.vencedor === 'CONV'
        ? `Vantagem do convencional — economia de ${fmtMoeda(Math.abs(d.deltaRs))}. Motivo: os créditos de CBS (${fmtMoeda(memFoco.creditosCbs)}) são menores que a CBS embutida no DAS (${fmtMoeda(memFoco.cbsDentroDas)}), então tirar a CBS da guia não compensa.`
        : d.vencedor === 'HIB'
          ? `Vantagem do híbrido — economia de ${fmtMoeda(Math.abs(d.deltaRs))}. Motivo: os créditos de CBS (${fmtMoeda(memFoco.creditosCbs)}) abatem os débitos (${fmtMoeda(memFoco.debitosCbs)}) e a CBS por fora cai para ${fmtMoeda(memFoco.cbsARecolher)}.`
          : `Empate técnico em ${fmtMoeda(d.convTotal)}. Motivo: os totais coincidem; prefira o convencional pela guia única.`,
    ));
    if (vereditoTxt) push({ text: pdfText(vereditoTxt), fontSize: 8, italics: true, color: '#344054', margin: [0, 3, 0, 0] as [number, number, number, number] });
  }

  // Fator r (só com matriz, que implica III/V elegíveis)
  if (comMatriz && r.contexto.mostrarFatorR) {
    push(tituloSecao('2', 'Fator r — massa salarial'));
    if (!r.fatorR.dadosSuficientes) {
      push({ text: pdfText(`Informe a folha dos últimos 12 meses para avaliar o Fator r. RBT12 considerado: ${fmtMoeda(r.premissas.rbt12)}.`), fontSize: 8 });
    } else {
      push({
        table: {
          widths: ['*', '*'],
          body: [[
            td(`Fator r = folha (${fmtMoeda(r.fatorR.folha12)}) ÷ RBT12 (${fmtMoeda(r.fatorR.rbt12)}) = ${fmtCarga(r.fatorR.valor * 100)}. Limite de 28% — ${r.fatorR.enquadrado ? 'ENQUADRADO no Anexo III' : 'ABAIXO do limite (Anexo V)'}.`),
            td(!r.fatorR.enquadrado
              ? `Faltam ${fmtMoeda(r.fatorR.gapFolha)} na folha dos últimos 12 meses (cerca de ${fmtMoeda(r.fatorR.gapMensalProlabore)} por mês de pró-labore) para atingir os 28%.`
              : `Folha mínima sustentada de ${fmtMoeda(r.fatorR.folhaMinimaIII)}. Monitore a folha todo mês.`),
          ]],
        },
        layout: 'noBorders' as const,
      });
      if (fatorTxt) push({ text: pdfText(fatorTxt), fontSize: 8, italics: true, color: '#344054', margin: [0, 3, 0, 0] as [number, number, number, number] });
    }
  }

  // Memória do híbrido
  push(tituloSecao(comMatriz ? '3' : '2', 'Como chegamos ao híbrido — memória de cálculo'));
  const anexosMem = comMatriz ? (['III', 'V'] as const) : ([d.anexo] as const);
  for (const ax of anexosMem) {
    const mem = r.memoriaHibrido[ax];
    push({ text: pdfText(`Anexo ${ax}`), fontSize: 9, bold: true, color: '#0F3D3E', margin: [0, 4, 0, 2] as [number, number, number, number] });
    push({
      ol: [
        pdfText(`DAS convencional de ${fmtMoeda(mem.dasTotal)}, com CBS de ${fmtMoeda(mem.cbsDentroDas)} dentro da guia.`),
        pdfText(`DAS reduzido = ${fmtMoeda(mem.dasTotal)} - ${fmtMoeda(mem.cbsDentroDas)} = ${fmtMoeda(mem.dasReduzido)}.`),
        pdfText(`Débitos de CBS sobre a receita: ${fmtMoeda(mem.debitosCbs)}.`),
        pdfText(`Créditos de CBS sobre as despesas: ${fmtMoeda(mem.creditosCbs)} (detalhe na tabela abaixo).`),
        pdfText(`CBS a recolher por fora = ${fmtMoeda(mem.debitosCbs)} - ${fmtMoeda(mem.creditosCbs)} = ${fmtMoeda(mem.cbsARecolher)}${mem.saldoCredor > 0 ? `, com saldo credor de ${fmtMoeda(mem.saldoCredor)} para o mês seguinte` : ''}.`),
        pdfText(`Total híbrido = ${fmtMoeda(mem.dasReduzido)} + ${fmtMoeda(mem.cbsARecolher)} = ${fmtMoeda(mem.totalHibrido)}.`),
      ],
      fontSize: 7.8, margin: [12, 0, 0, 4] as [number, number, number, number],
    });
    push({
      table: {
        headerRows: 1,
        widths: ['46%', '20%', '14%', '20%'],
        body: [
          [th('Despesa'), th('Valor'), th('Fator'), th('Crédito')],
          ...mem.creditosPorDespesa.map((cd) => [td(cd.rotulo), td(fmtMoeda(cd.valor), false, 'right'), td(fmtCarga(cd.fator * 100), false, 'right'), td(fmtMoeda(cd.credito), true, 'right')]),
          [td('Total de créditos', true), td('', false, 'right'), td('', false, 'right'), td(fmtMoeda(mem.creditosCbs), true, 'right')],
        ],
      },
      margin: [0, 0, 0, 4] as [number, number, number, number],
    });
  }
  if (memoriaTxt && !comMatriz) push({ text: pdfText(memoriaTxt), fontSize: 8, italics: true, color: '#344054', margin: [0, 2, 0, 0] as [number, number, number, number] });

  // Demais anexos só como referência quando há matriz
  if (comMatriz) {
    push(tituloSecao('4', 'Demais anexos — referência'));
    push({ text: pdfText('Comércio, indústria e serviços sem CPP, com os mesmos dados de receita e despesas. Apenas referência: o CNAE em análise é de serviços (III/V).'), fontSize: 7.5, color: CINZA, margin: [0, 0, 0, 4] as [number, number, number, number] });
    push({
      table: {
        headerRows: 1,
        widths: ['22%', '24%', '24%', '15%', '15%'],
        body: [
          [th('Anexo'), th('Conv (DAS)'), th('Híb (total)'), th('Diferença'), th('Vencedor')],
          ...r.comparativo.tabelaOutrosAnexos.map((l) => [
            td(`Anexo ${l.anexo} (${fmtCarga(l.aliquotaEfetivaConv * 100)})`),
            tdN(l.convTotal),
            tdN(l.hibTotal),
            td(l.deltaRs === 0 ? '—' : `${l.deltaRs > 0 ? '+' : '-'} ${fmtMoeda(Math.abs(l.deltaRs))}`, true, 'right'),
            td(l.vencedor === 'EMPATE' ? 'Empate' : l.vencedor === 'CONV' ? 'Convencional' : 'Híbrido'),
          ]),
        ],
      },
    });
  }

  // Insights da IA — cada um com seu ícone de nível
  push(tituloSecao(comMatriz ? '5' : '3', 'Insights da Inteligência Tributária — modo leitura'));
  push({ text: pdfText('A IA apenas interpreta os números acima; ela não calcula nem altera valores.'), fontSize: 7.5, color: CINZA, margin: [0, 0, 0, 4] as [number, number, number, number] });
  insights.forEach((ins, i) => {
    push({
      columns: [
        { width: 16, ...iconeNivel(ins.nivel), margin: [0, 3, 0, 0] as [number, number, number, number] },
        {
          width: '*',
          stack: [
            { text: pdfText(`${i + 1}. ${ins.titulo}`), fontSize: 8.5, bold: true, color: '#0F3D3E' },
            { text: pdfText(ROTULO_NIVEL[ins.nivel]), fontSize: 6.8, bold: true, color: ins.nivel === 'ALERTA' ? AMBAR : ins.nivel === 'INFO' ? AZUL : VERDE, margin: [0, 0, 0, 2] as [number, number, number, number] },
          ],
        },
      ],
      margin: [0, 5, 0, 0] as [number, number, number, number],
    });
    push({ text: pdfText(ins.texto), fontSize: 8, margin: [16, 1, 0, 1] as [number, number, number, number] });
    push({ text: pdfText(`Referências: ${ins.cenariosRef.join('  ·  ')}`), fontSize: 6.8, color: '#98A2B3', margin: [16, 0, 0, 3] as [number, number, number, number] });
  });
  if (acaoTxt && !insights.some((x) => x.insightId === 'ins_acao')) {
    push({ text: pdfText(acaoTxt), fontSize: 8, italics: true, color: '#344054' });
  }

  push(tituloSecao(comMatriz ? '6' : '4', 'Metodologia e fontes'));
  push({ ul: r.metodologia.formulas.map((x) => ({ text: pdfText(x), fontSize: 7.2 })), margin: [12, 0, 0, 3] as [number, number, number, number] });
  push({ text: pdfText(`Fontes: ${r.metodologia.fontes.join('  ·  ')}. ${r.metodologia.aviso}`), fontSize: 7, color: CINZA });

  const subtitulo = `Simples Nacional · LC 123/2006 × LC 214/2025 · ${(r.empresa.razaoSocial || r.competencia) ?? ''} · Gerado em ${dataGeracao} · hash ${r.hash}`;
  const doc = {
    pageSize: 'A4' as const,
    pageMargins: [34, 102, 34, 52] as [number, number, number, number],
    defaultStyle: { font: 'Roboto' as const, fontSize: 8, color: '#1e293b', lineHeight: 1.35 },
    background: fundoMarcaDagua(300, 0.07),
    info: { title: 'Relatório Analítico e Inteligente — Simples Nacional', author: 'Aurum Tax NCM', creator: 'Aurum Tax NCM' },
    header: (() => timbrado(emitente, cor, 'Relatório Analítico e Inteligente', subtitulo)) as never,
    footer: rodape(emitente) as never,
    content,
  };

  await baixarPdf(doc as never, `${nomeBase(r)}.pdf`);
}
