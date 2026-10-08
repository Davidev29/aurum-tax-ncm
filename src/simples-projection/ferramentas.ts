/**
 * Adaptador de ferramentas para a LLM (Etapa 5 — implementado).
 *
 * Espelha o padrão de `src/application/aurum-ai-registro-ferramentas.ts`:
 * spec { nome, descricao, dominio, leitura, parametros, exemplos, guardrail }
 * + conversor OpenAI-compatível + dispatcher isolado.
 * NÃO registra nada no núcleo sozinho: o plug é explícito pelo orquestrador
 * (Etapa 6 documenta como anexar a `REGISTRO_FERRAMENTAS`).
 */
import { simularCenarioDividido } from './cenario-dividido';
import { prepararEntradaProjecao } from './entrada';
import { projetarRBT12Rolling } from './janela-rbt12';
import type { RelatorioProjecao } from './types';

export interface PropriedadeSchema {
  type: string;
  description: string;
  items?: unknown;
}

export interface SchemaFerramentaProjecao {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, PropriedadeSchema>;
    required: string[];
  };
}

/** Nomes das 3 ferramentas da nova camada (estáveis). */
export const FERRAMENTAS_PROJECAO_NOMES = [
  'projetarRBT12',
  'simularCenarioDividido',
  'prepararEntradaProjecao',
] as const;

export type NomeFerramentaProjecao = (typeof FERRAMENTAS_PROJECAO_NOMES)[number];

export interface SpecFerramentaProjecao {
  nome: NomeFerramentaProjecao;
  descricao: string;
  dominio: 'simples';
  leitura: boolean;
  parametros: Record<string, PropriedadeSchema & { obrigatorio?: boolean; exemplo?: string }>;
  exemplos: string[];
  guardrail: string;
}

const MES_RE_DESC = 'Mês YYYY-MM (ex. "2026-01").';
const SERIE_DESC = 'Array de { mes: YYYY-MM, receita: number } em ordem cronológica.';

export const SPECS_FERRAMENTAS_PROJECAO: SpecFerramentaProjecao[] = [
  {
    nome: 'projetarRBT12',
    descricao: 'Projeta a série RBT12 por janela deslizante (soma dos 12 meses anteriores; empresa nova usa média × 12). Motor puro.',
    dominio: 'simples',
    leitura: true,
    parametros: {
      mesInicio: { type: 'string', description: `Primeiro mês projetado. ${MES_RE_DESC}`, obrigatorio: true, exemplo: '2026-01' },
      historico12: { type: 'array', description: `Até 12 meses anteriores. ${SERIE_DESC}`, obrigatorio: true },
      projecaoMensal: { type: 'array', description: `Receitas projetadas. ${SERIE_DESC}`, obrigatorio: true },
      mesesAtividade: { type: 'integer', description: 'Meses de atividade na abertura (empresa nova).', exemplo: '3' },
    },
    exemplos: ['projetarRBT12({"mesInicio":"2026-01","historico12":[...],"projecaoMensal":[...]})'],
    guardrail: 'RBT12 nunca inclui o próprio mês. Sem histórico suficiente, pergunta — nunca inventa receita.',
  },
  {
    nome: 'simularCenarioDividido',
    descricao: 'Simula divisão de faturamento mãe/nova: RBT12 deslizante + DAS do motor existente + economia + payback + alertas.',
    dominio: 'simples',
    leitura: true,
    parametros: {
      mesInicio: { type: 'string', description: `Primeiro mês. ${MES_RE_DESC}`, obrigatorio: true, exemplo: '2026-01' },
      receitaTotalMensal: { type: 'array', description: `Receita TOTAL a fatiar. ${SERIE_DESC}`, obrigatorio: true },
      percentualNova: { type: 'number', description: 'Fração 0 ≤ p ≤ 1 destinada à nova (ex. 0.3). 0 e 1 válidos (extremos).', obrigatorio: true, exemplo: '0.3' },
      anexoMae: { type: 'string', description: 'Anexo da mãe: I, II, III, IV ou V.', obrigatorio: true, exemplo: 'III' },
      anexoNova: { type: 'string', description: 'Anexo da nova: I, II, III, IV ou V.', obrigatorio: true, exemplo: 'III' },
      folha12Mae: { type: 'number', description: 'Folha 12m da mãe (Fator R).', exemplo: '400000' },
      folha12Nova: { type: 'number', description: 'Folha 12m da nova (Fator R).', exemplo: '0' },
      custoMensalNova: { type: 'number', description: 'Custo operacional mensal da nova (payback líquido).', exemplo: '5000' },
    },
    exemplos: ['simularCenarioDividido({"mesInicio":"2026-01","receitaTotalMensal":[...],"percentualNova":0.3,"anexoMae":"III","anexoNova":"III"})'],
    guardrail: 'Sem receita/percentual/anexos, PERGUNTA os valores — nunca simula com exemplo. Insights qualitativos são da LLM, não do motor.',
  },
  {
    nome: 'prepararEntradaProjecao',
    descricao: 'Valida input manual/CNPJ e monta os params do cenário. CNPJ usa o serviço existente; sem dados, retorna erro com instruções.',
    dominio: 'simples',
    leitura: true,
    parametros: {
      mesInicio: { type: 'string', description: `Primeiro mês. ${MES_RE_DESC}`, obrigatorio: true, exemplo: '2026-01' },
      cnpjReferencia: { type: 'string', description: 'CNPJ opcional (14 dígitos) — só valida/consulta, não fornece faturamento.', exemplo: '11222333000181' },
      receitaTotalMensal: { type: 'array', description: `Receita TOTAL. ${SERIE_DESC}` },
      percentualNova: { type: 'number', description: 'Fração 0 < p < 1.', exemplo: '0.3' },
      anexoMae: { type: 'string', description: 'I–V.', exemplo: 'III' },
      anexoNova: { type: 'string', description: 'I–V.', exemplo: 'V' },
    },
    exemplos: ['prepararEntradaProjecao({"mesInicio":"2026-01","receitaTotalMensal":[...]})'],
    guardrail: 'BrasilAPI não fornece faturamento — sem receita manual, retorna dados-insuficientes com instruções.',
  },
];

/** Specs no padrão do projeto para registro/LLM. */
export function specsFerramentasProjecao(): SpecFerramentaProjecao[] {
  return SPECS_FERRAMENTAS_PROJECAO;
}

/** Converte para function-calling OpenAI-compatível (como `listarFerramentasParaModelo`). */
export function listarFerramentasProjecaoParaModelo(): SchemaFerramentaProjecao[] {
  return SPECS_FERRAMENTAS_PROJECAO.map((f) => {
    const properties: Record<string, PropriedadeSchema> = {};
    const required: string[] = [];
    for (const [k, p] of Object.entries(f.parametros)) {
      properties[k] = { type: p.type, description: p.description };
      if (p.obrigatorio) required.push(k);
    }
    return { name: f.nome, description: f.descricao, parameters: { type: 'object', properties, required } };
  });
}

export interface ResultadoFerramentaProjecao {
  ok: boolean;
  ferramenta: NomeFerramentaProjecao;
  dados?: RelatorioProjecao | unknown;
  erro?: string;
}

/** Dispatcher isolado (modelo escolhe, motor executa, sem I/O no cálculo). */
export async function executarFerramentaProjecao(
  nome: NomeFerramentaProjecao,
  args: Record<string, unknown> = {},
): Promise<ResultadoFerramentaProjecao> {
  try {
    switch (nome) {
      case 'projetarRBT12': {
        const dados = projetarRBT12Rolling(args as never);
        return { ok: true, ferramenta: nome, dados };
      }
      case 'simularCenarioDividido': {
        const a = args as Record<string, never>;
        const maeHist = (a as { historicoMae12?: never }).historicoMae12;
        const novaHist = (a as { historicoNova12?: never }).historicoNova12;
        const num = (v: unknown, fb: number): number => {
          const n = Number(v);
          return Number.isFinite(n) ? n : fb;
        };
        const histMaeLen = Array.isArray(maeHist as unknown) ? (maeHist as unknown as unknown[]).length : 0;
        const mesesMae = (args as { mesesAtividadeMae?: unknown }).mesesAtividadeMae;
        const dados = simularCenarioDividido({
          mesInicio: (args as { mesInicio: string }).mesInicio,
          receitaTotalMensal: (args as { receitaTotalMensal: never }).receitaTotalMensal as never,
          percentualNova: num((args as { percentualNova: unknown }).percentualNova, NaN),
          mae: {
            anexoId: (args as { anexoMae: never }).anexoMae as never,
            folha12: num((args as { folha12Mae?: unknown }).folha12Mae, 0),
            historico12: (maeHist ?? []) as never,
            mesesAtividade: mesesMae === undefined ? histMaeLen : num(mesesMae, histMaeLen),
            composicao: (args as { composicaoMae?: never }).composicaoMae as never,
            dispensarFatorR: Boolean((args as { dispensarFatorRMae?: unknown }).dispensarFatorRMae),
          },
          nova: {
            anexoId: (args as { anexoNova: never }).anexoNova as never,
            folha12: num((args as { folha12Nova?: unknown }).folha12Nova, 0),
            historico12: (novaHist ?? []) as never,
            mesesAtividade: num((args as { mesesAtividadeNova?: unknown }).mesesAtividadeNova, 0),
            composicao: (args as { composicaoNova?: never }).composicaoNova as never,
            dispensarFatorR: Boolean((args as { dispensarFatorRNova?: unknown }).dispensarFatorRNova),
          },
          custoMensalNova: num((args as { custoMensalNova?: unknown }).custoMensalNova, 0),
          custoInicialNova: num((args as { custoInicialNova?: unknown }).custoInicialNova, 0),
          margemEmpate: num((args as { margemEmpate?: unknown }).margemEmpate, 0),
        });
        return { ok: true, ferramenta: nome, dados };
      }
      case 'prepararEntradaProjecao': {
        const r = await prepararEntradaProjecao(args as never);
        if (!r.ok) return { ok: false, ferramenta: nome, erro: `${r.erro}: ${r.instrucao}` };
        return { ok: true, ferramenta: nome, dados: r.params };
      }
      default:
        return { ok: false, ferramenta: nome, erro: `ferramenta-desconhecida: "${String(nome)}"` };
    }
  } catch (e) {
    return { ok: false, ferramenta: nome, erro: String((e as Error)?.message ?? e) };
  }
}
