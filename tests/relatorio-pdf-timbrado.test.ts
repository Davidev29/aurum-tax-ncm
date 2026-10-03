/**
 * Relatório Analítico — timbrado padrão + ícones vetoriais no PDF.
 *
 * - O PDF usa o mesmo `timbrado`/`rodape`/marca d'água dos relatórios de
 *   XML/NFe (com o emitente do escritório).
 * - Nenhum texto do documento usa glifos fora da cobertura da Roboto
 *   embutida (setas, formas geométricas, dingbats, emoji): os ícones são
 *   vetores de canvas e `pdfText()` converte o restante.
 * - Gera os dois ramos (CNPJ dual com matriz × anexo único) em buffer PDF
 *   válido de ponta a ponta.
 */
import { describe, it, expect, vi } from 'vitest';
import pdfMake from 'pdfmake/build/pdfmake';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import type { Emitente } from '@/domain/entities';
import { orquestrarRelatorio, type RelatorioInput } from '@/simples/relatorio-analitico';
import { gerarInsightsFallback } from '@/simples/ia-insights';
import {
  exportarRelatorioAnaliticoPDF,
  iconeNivel,
  iconeCanvas,
  pdfText,
  ROTULO_NIVEL,
} from '@/simples/export-relatorio-analitico';

const capturados: { nome: string; doc: TDocumentDefinitions }[] = [];

vi.mock('@/infrastructure/pdf/setup', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/infrastructure/pdf/setup')>();
  return {
    ...mod,
    baixarPdf: (doc: TDocumentDefinitions, nomeArquivo: string): Promise<void> => {
      capturados.push({ nome: nomeArquivo, doc });
      return Promise.resolve();
    },
  };
});

const emitente: Emitente = {
  razaoSocial: 'Escritório Modelo Ltda',
  cnpj: '12345678000190',
  ie: '',
  endereco: 'Rua Modelo, 100',
  cidade: 'São Paulo',
  cep: '01001000',
  telefone: '11 3333-4444',
  email: 'contato@modelo.com',
  site: '',
  cor: '#0f215c',
  rodape: 'Escritório Modelo',
  logo: null,
};

function inputBase(over: Partial<RelatorioInput> = {}): RelatorioInput {
  return {
    empresa: { origem: 'CNPJ_API', razaoSocial: 'Cliente Dual Ltda', cnpj: '98765432000100' },
    competencia: '2027-05',
    exercicioReferencia: 2027,
    rbt12: 850_000,
    rba: 200_000,
    receitaMes: 95_000,
    folha12: 180_000,
    cbsRef: 0.088,
    despesas: [
      { rotulo: 'Aluguel (30% da alíquota)', valor: 1500, regra: 'integral' },
      { rotulo: 'Energia elétrica', valor: 300, regra: 'integral' },
    ],
    contexto: { modo: 'cnpj', anexoSelecionado: 'V', anexosElegiveis: ['III', 'V'] },
    ...over,
  };
}

/** Coleta recursiva de todo `text` do documento (ignora canvas/imagem). */
function coletarTextos(no: unknown, out: string[]): void {
  if (typeof no === 'string') {
    out.push(no);
    return;
  }
  if (Array.isArray(no)) {
    for (const item of no) coletarTextos(item, out);
    return;
  }
  if (no && typeof no === 'object') {
    for (const [chave, valor] of Object.entries(no)) {
      if (chave === 'canvas' || chave === 'image') continue;
      if (typeof valor === 'function') continue;
      coletarTextos(valor, out);
    }
  }
}

function coletarCanvas(no: unknown, out: unknown[][]): void {
  if (Array.isArray(no)) {
    for (const item of no) coletarCanvas(item, out);
    return;
  }
  if (no && typeof no === 'object') {
    const rec = no as Record<string, unknown>;
    if (Array.isArray(rec.canvas) && rec.canvas.length > 0) out.push(rec.canvas as unknown[]);
    for (const [chave, valor] of Object.entries(rec)) {
      if (chave === 'canvas') continue;
      if (typeof valor === 'function') continue;
      coletarCanvas(valor, out);
    }
  }
}

/** Faixas que a Roboto do pdfMake não renderiza (viram caixa vazia). */
const GLIFOS_RISCO = /[←-⇿⌀-➿✓✔⚠✕✖❌\uFE0F]|[\uD800-\uDBFF][\uDC00-\uDFFF]/;

describe('relatório analítico — PDF padrão com ícones', () => {
  it('pdfText converte glifos de risco e preserva pt-BR', () => {
    expect(pdfText('Economia → III de − R$ 1,00')).toBe('Economia » III de - R$ 1,00');
    expect(pdfText('◆ Vantagem ● ○ ✓')).toBe('• Vantagem • • OK ');
    expect(pdfText('Fator r — 21,18% · alíquota × pró-labore çãõ')).toBe(
      'Fator r — 21,18% · alíquota × pró-labore çãõ',
    );
    expect(pdfText('emoji 😀 removido')).toBe('emoji removido');
  });

  it('ícones de nível são vetores distintos por categoria', () => {
    expect(iconeNivel('OPORTUNIDADE').canvas.length).toBeGreaterThan(0);
    expect(iconeNivel('ALERTA').canvas.length).toBeGreaterThan(0);
    expect(iconeNivel('INFO').canvas.length).toBeGreaterThan(0);
    expect(iconeCanvas('check')).not.toEqual(iconeCanvas('alerta'));
    expect(ROTULO_NIVEL.OPORTUNIDADE).toBe('Oportunidade');
    expect(ROTULO_NIVEL.ALERTA).toBe('Alerta');
    expect(ROTULO_NIVEL.INFO).toBe('Informação');
  });

  it('ramo dual: timbrado padrão + ícones + texto seguro + PDF válido', async () => {
    const report = orquestrarRelatorio(inputBase());
    const insights = gerarInsightsFallback(report);
    await exportarRelatorioAnaliticoPDF(report, insights, emitente);

    const gerado = capturados[capturados.length - 1];
    expect(gerado.nome).toMatch(/^Relatorio-Simples-/);

    // Timbrado/rodapé/marca d'água padrão dos relatórios de XML.
    expect(typeof gerado.doc.header).toBe('function');
    expect(gerado.doc.footer).toBeDefined();
    expect(gerado.doc.background).toBeDefined();

    // Ícones vetoriais presentes (canvas) — nenhum ícone via caractere.
    const telas: unknown[][] = [];
    coletarCanvas(gerado.doc.content, telas);
    expect(telas.length).toBeGreaterThan(5);

    const textos: string[] = [];
    coletarTextos(gerado.doc.content, textos);
    expect(textos.length).toBeGreaterThan(10);
    for (const t of textos) {
      expect(t).not.toMatch(GLIFOS_RISCO);
    }

    // Buffer PDF válido de ponta a ponta (fontes + layout).
    const buf = await pdfMake.createPdf(gerado.doc).getBuffer();
    expect(Buffer.from(buf.slice(0, 4)).toString()).toBe('%PDF');
  });

  it('ramo anexo único: mesmo padrão, sem matriz III×V', async () => {
    const report = orquestrarRelatorio(
      inputBase({
        empresa: { origem: 'MANUAL', razaoSocial: 'Contribuinte — cálculo manual', cnpj: null },
        contexto: { modo: 'manual', anexoSelecionado: 'I', anexosElegiveis: ['I'] },
      }),
    );
    const insights = gerarInsightsFallback(report);
    await exportarRelatorioAnaliticoPDF(report, insights, emitente);

    const gerado = capturados[capturados.length - 1];
    expect(typeof gerado.doc.header).toBe('function');
    const textos: string[] = [];
    coletarTextos(gerado.doc.content, textos);
    for (const t of textos) {
      expect(t).not.toMatch(GLIFOS_RISCO);
    }
    const buf = await pdfMake.createPdf(gerado.doc).getBuffer();
    expect(Buffer.from(buf.slice(0, 4)).toString()).toBe('%PDF');
  });
});
