/**
 * Camada de entrada de dados (Etapa 5 — implementada).
 *
 * - Aceita CNPJ opcional OU valores manuais.
 * - CNPJ → delega ao serviço EXISTENTE `buscarCnpj`
 *   (`src/infrastructure/receita/brasilapi.ts`). NUNCA cria client HTTP aqui.
 * - Nunca inventa dados: faltando receita/histórico, retorna erro explícito.
 * - I/O (rede) isolada nesta fronteira — o motor permanece puro.
 */
import { mensagemCnpjInvalido, validarCnpj } from '@/domain/services/cnpj';
import type { EntradaManualProjecao, MesReceita, ParamsCenarioDividido } from './types';

export interface EntradaProjecaoPronta {
  ok: true;
  params: ParamsCenarioDividido;
  /** Eco do cadastro consultado (quando CNPJ informado e válido). */
  cadastro?: { cnpj: string; razaoSocial?: string | null };
}

export interface EntradaProjecaoErro {
  ok: false;
  erro: string;
  instrucao: string;
}

export type ResultadoEntradaProjecao = EntradaProjecaoPronta | EntradaProjecaoErro;

export interface DepsEntradaProjecao {
  /** Injeção para testes (default: serviço existente `buscarCnpj`). */
  buscarCnpjFn?: (cnpj: string) => Promise<{ cnpj?: string; razaoSocial?: string | null }>;
}

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ANEXOS = ['I', 'II', 'III', 'IV', 'V'] as const;

function exigirSerie(lista: MesReceita[] | undefined, campo: string, obrigatorio: boolean): string | null {
  if (lista == null) return obrigatorio ? `Informe "${campo}" (array de { mes: YYYY-MM, receita >= 0 }).` : null;
  if (!Array.isArray(lista)) return `"${campo}" deve ser um array de { mes, receita }.`;
  for (const item of lista) {
    if (!item || !MES_RE.test(item.mes)) return `"${campo}" contém mês inválido (use YYYY-MM).`;
    if (!Number.isFinite(item.receita) || item.receita < 0) return `"${campo}" contém receita inválida em ${item.mes} (use número >= 0).`;
  }
  return null;
}

/**
 * Valida e normaliza o input manual/CNPJ em `ParamsCenarioDividido`.
 */
export async function prepararEntradaProjecao(
  input: EntradaManualProjecao,
  deps: DepsEntradaProjecao = {},
): Promise<ResultadoEntradaProjecao> {
  if (!input || typeof input !== 'object') {
    return { ok: false, erro: 'input-ausente', instrucao: 'Informe { mesInicio, receitaTotalMensal, percentualNova, anexos, históricos }. Ver README da camada.' };
  }
  if (!MES_RE.test(input.mesInicio)) {
    return { ok: false, erro: 'mesInicio-invalido', instrucao: `mesInicio "${String(input.mesInicio)}" inválido — use YYYY-MM (ex. "2026-01").` };
  }

  // CNPJ opcional: valida DV local primeiro (sem rede), depois delega ao serviço existente.
  let cadastro: EntradaProjecaoPronta['cadastro'];
  if (input.cnpjReferencia) {
    const v = validarCnpj(input.cnpjReferencia);
    if (!v.ok) {
      return { ok: false, erro: 'cnpj-invalido', instrucao: mensagemCnpjInvalido(v.motivo ?? 'cnpj-tamanho') + ' Corrija o CNPJ e tente de novo.' };
    }
    try {
      const buscar = deps.buscarCnpjFn ?? (async (c: string) => {
        const { buscarCnpj } = await import('@/infrastructure/receita/brasilapi');
        return buscarCnpj(c);
      });
      const dados = await buscar(cnpjReferenciaNormalizada(v.cnpj));
      cadastro = { cnpj: v.cnpj, razaoSocial: (dados as { razaoSocial?: string | null }).razaoSocial ?? null };
    } catch (e) {
      return { ok: false, erro: 'cnpj-consulta-falhou', instrucao: `CNPJ válido, mas a consulta falhou: ${e instanceof Error ? e.message : String(e)} Tente de novo ou informe os valores manuais.` };
    }
    // BrasilAPI não fornece faturamento: receitas continuam obrigatórias (nunca inventar).
  }

  const faltas: string[] = [];
  const errSerie = exigirSerie(input.receitaTotalMensal, 'receitaTotalMensal', true);
  if (errSerie) faltas.push(errSerie);
  const errHistMae = exigirSerie(input.historicoMae12, 'historicoMae12', true);
  if (errHistMae) faltas.push(errHistMae);
  if (input.percentualNova == null || !Number.isFinite(input.percentualNova) || input.percentualNova < 0 || input.percentualNova > 1) {
    faltas.push('Informe "percentualNova" como fração 0 ≤ p ≤ 1 (ex. 0.3 = 30% na nova empresa; 0 e 1 são válidos).');
  }
  if (!ANEXOS.includes(input.anexoMae as (typeof ANEXOS)[number])) {
    faltas.push('Informe "anexoMae" (I, II, III, IV ou V — Tabelas CNAE × Anexo ou Fator R).');
  }
  if (!ANEXOS.includes(input.anexoNova as (typeof ANEXOS)[number])) {
    faltas.push('Informe "anexoNova" (I, II, III, IV ou V).');
  }
  if (input.receitaTotalMensal?.length && input.receitaTotalMensal[0]!.mes !== input.mesInicio) {
    faltas.push(`receitaTotalMensal[0].mes ("${input.receitaTotalMensal[0]!.mes}") diverge de mesInicio ("${input.mesInicio}"). Alinhe as séries.`);
  }
  if (faltas.length > 0) {
    return {
      ok: false,
      erro: 'dados-insuficientes',
      instrucao: 'Faltam dados obrigatórios (nada foi inventado): ' + faltas.join(' '),
    };
  }

  return {
    ok: true,
    cadastro,
    params: {
      mesInicio: input.mesInicio,
      receitaTotalMensal: input.receitaTotalMensal!,
      percentualNova: input.percentualNova!,
      mae: {
        anexoId: input.anexoMae!,
        folha12: input.folha12Mae ?? 0,
        historico12: input.historicoMae12!,
      },
      nova: {
        anexoId: input.anexoNova!,
        folha12: input.folha12Nova ?? 0,
        historico12: input.historicoNova12 ?? [],
        mesesAtividade: input.mesesAtividadeNova,
      },
      custoMensalNova: Math.max(0, Number(input.custoMensalNova) || 0),
    },
  };
}

function cnpjReferenciaNormalizada(cnpj: string): string {
  return cnpj;
}
