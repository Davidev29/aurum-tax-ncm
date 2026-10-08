/**
 * Tipos públicos da camada `simples-projection` (Etapa 2 — esqueleto).
 * Motor puro: sem I/O, sem banco, sem rede.
 */
import type { AnexoSimplesId } from '@/simples/tabelas';

/** Mês no formato `YYYY-MM`. */
export type MesRef = string;

/** Par mensal de receita. */
export interface MesReceita {
  mes: MesRef;
  receita: number;
}

/** Item da janela deslizante RBT12. */
export interface ItemJanelaRBT12 {
  /** Mês de apuração (competência do DAS). */
  mes: MesRef;
  /** RBT12(t) = soma de R[m] para m em [t-12, t-1]. */
  rbt12: number;
  /** Rótulo/valor do mês que saiu da janela. */
  mesSaindo: MesRef | null;
  /** Rótulo/valor do mês que entrou na janela. */
  mesEntrando: MesRef | null;
  /** Receita do próprio mês de apuração (não compõe o RBT12). */
  receitaMes: number;
  /** true quando aplicada a regra de empresa nova. */
  empresaNova?: boolean;
}

export interface ParamsJanelaRBT12 {
  /** Primeiro mês projetado (`YYYY-MM`). */
  mesInicio: MesRef;
  /** 12 meses ANTERIORES ao mesInicio, ordem cronológica. */
  historico12: MesReceita[];
  /** Receitas projetadas mês a mês, ordem cronológica. */
  projecaoMensal: MesReceita[];
  /** Meses de atividade na abertura da projeção (para regra de empresa nova). */
  mesesAtividade?: number;
}

export interface ConfigEmpresaCenario {
  anexoId: AnexoSimplesId;
  /** Folha 12m fixa ou série mensal (para Fator R futuro). Etapa 4 usa valor fixo. */
  folha12: number;
  /** Histórico 12m anterior ao mesInicio (para RBT12 deslizante próprio). */
  historico12: MesReceita[];
  /** Meses de atividade na abertura (empresa nova). Default = historico12.length. */
  mesesAtividade?: number;
  /**
   * true = Anexo III puro (atividade NÃO sujeita ao Fator R): dispensa o
   * diagnóstico e o alerta de troca de anexo. Default false (sujeita).
   */
  dispensarFatorR?: boolean;
  /**
   * Segregação intra-empresa (LC 123/2006, art. 18): parcelas da receita em
   * anexos distintos. Ausente ou vazio = 100% no `anexoId` (mono-anexo).
   * A RBT12 TOTAL define a faixa em cada tabela; o DAS é a soma.
   */
  composicao?: Array<{ anexoId: AnexoSimplesId; percentual: number }>;
}

/** Detalhamento por parcela de anexo dentro de uma empresa/mês. */
export interface DetalheParcelaMes {
  anexoId: AnexoSimplesId;
  receitaMes: number;
  faixa: number;
  aliquotaNominal?: number;
  aliquotaEfetiva: number;
  das: number;
}

export interface ParamsCenarioDividido {
  mesInicio: MesRef;
  /** Receita TOTAL projetada mês a mês (será fatiada por percentual). */
  receitaTotalMensal: MesReceita[];
  /** 0..1 — fração destinada à nova empresa (mãe fica com 1 - x). 0 e 1 são válidos (extremos p/ teste). */
  percentualNova: number;
  mae: ConfigEmpresaCenario;
  nova: ConfigEmpresaCenario;
  /** Custo operacional mensal da nova empresa (para payback líquido). */
  custoMensalNova?: number;
  /** Custo único de abertura (somado ao mês 1). Default 0. */
  custoInicialNova?: number;
  /** Margem de empate técnico (R$): |economia| <= margem ⇒ "Empate técnico". Default 0. */
  margemEmpate?: number;
}

export interface LinhaCenarioMensal {
  mes: MesRef;
  receitaTotal: number;
  receitaMae: number;
  receitaNova: number;
  rbt12Mae: number;
  rbt12Nova: number;
  /** RBT12 projetado (deslizante) do cenário unificado — base da coluna "referência". */
  rbt12Ref?: number;
  faixaMae: number;
  faixaNova: number;
  /** Faixa do cenário unificado (referência). */
  faixaRef?: number;
  aliquotaEfetivaMae: number;
  aliquotaEfetivaNova: number;
  /** Alíquota efetiva do cenário unificado (referência). */
  aliquotaEfetivaRef?: number;
  /** Alíquota nominal da faixa (mãe / nova / referência) — para a tabela de progressividade. */
  aliquotaNominalMae?: number;
  aliquotaNominalNova?: number;
  aliquotaNominalRef?: number;
  /** Parcela a deduzir da faixa (mãe / nova / referência). */
  parcelaDeduzirMae?: number;
  parcelaDeduzirNova?: number;
  parcelaDeduzirRef?: number;
  dasMae: number;
  dasNova: number;
  dasUnificadoReferencia: number;
  /** Parcelas por anexo (só quando há segregação intra-empresa). */
  detalheMae?: DetalheParcelaMes[];
  detalheNova?: DetalheParcelaMes[];
  detalheRef?: DetalheParcelaMes[];
  /** Economia bruta de DAS (sem descontar custos). */
  economiaBrutaMes?: number;
  /** Custo agregado do mês (mensal + rateio da abertura no mês 1). */
  custoMes?: number;
  economiaMes: number;
  economiaAcumulada: number;
}

export type CodigoAlerta =
  | 'SUBLIMITE_3_6M'
  | 'DESENQUADRAMENTO_4_8M'
  | 'FATOR_R_TROCA_ANEXO'
  | 'CONSOLIDACAO_RECEITA_GRUPO'
  | 'EMPRESA_NOVA_REGRA_MEDIA';

export interface AlertaFiscal {
  codigo: CodigoAlerta;
  mes: MesRef | null;
  mensagem: string;
}

export type VereditoSegregacao = 'compensa' | 'nao-compensa' | 'empate-tecnico';

export interface PaybackInfo {
  mes: MesRef | null;
  mesesAtePayback: number | null;
  valorAcumuladoNoPayback: number | null;
  /** Primeiro mês com economia mensal > 0 (mês de virada). */
  mesVirada?: MesRef | null;
  mesesAteVirada?: number | null;
  /** Veredito financeiro com margem de empate. */
  veredito?: VereditoSegregacao;
}

export interface RelatorioProjecao {
  serieMensal: LinhaCenarioMensal[];
  payback: PaybackInfo;
  economiaTotal: number;
  alertas: AlertaFiscal[];
  /** Container vazio — preenchido pela LLM depois (motor nunca gera texto). */
  insightsSugeridos: [];
  /** Diagnóstico do Fator R mês a mês (mãe × nova × unificado). Opcional p/ compat. */
  analiseFatorR?: import('./fator-r-dividido').AnaliseFatorR;
  /** Classificação do retorno (imediato / payback / sem-payback / prejuízo). Opcional p/ compat. */
  analiseRetorno?: import('./analise-retorno').AnaliseRetorno;
  metadados: {
    mesInicio: MesRef;
    horizonteMeses: number;
    percentualNova: number;
    anexoMae: AnexoSimplesId;
    anexoNova: AnexoSimplesId;
    composicaoMae?: Array<{ anexoId: AnexoSimplesId; percentual: number }>;
    composicaoNova?: Array<{ anexoId: AnexoSimplesId; percentual: number }>;
    /** Folha 12m informada (para o diagnóstico do Fator R na UI). */
    folha12Mae?: number;
    folha12Nova?: number;
    custoMensalNova?: number;
    custoInicialNova?: number;
    margemEmpate?: number;
    motorVersao: string;
  };
}

export interface EntradaManualProjecao {
  cnpjReferencia?: string;
  mesInicio: MesRef;
  historicoMae12?: MesReceita[];
  historicoNova12?: MesReceita[];
  receitaTotalMensal?: MesReceita[];
  percentualNova?: number;
  anexoMae?: AnexoSimplesId;
  anexoNova?: AnexoSimplesId;
  folha12Mae?: number;
  folha12Nova?: number;
  mesesAtividadeNova?: number;
  custoMensalNova?: number;
}
