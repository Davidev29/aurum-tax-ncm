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
}

export interface ParamsCenarioDividido {
  mesInicio: MesRef;
  /** Receita TOTAL projetada mês a mês (será fatiada por percentual). */
  receitaTotalMensal: MesReceita[];
  /** 0..1 — fração destinada à nova empresa (mãe fica com 1 - x). */
  percentualNova: number;
  mae: ConfigEmpresaCenario;
  nova: ConfigEmpresaCenario;
  /** Custo operacional mensal da nova empresa (para payback líquido). */
  custoMensalNova?: number;
}

export interface LinhaCenarioMensal {
  mes: MesRef;
  receitaTotal: number;
  receitaMae: number;
  receitaNova: number;
  rbt12Mae: number;
  rbt12Nova: number;
  faixaMae: number;
  faixaNova: number;
  aliquotaEfetivaMae: number;
  aliquotaEfetivaNova: number;
  dasMae: number;
  dasNova: number;
  dasUnificadoReferencia: number;
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

export interface PaybackInfo {
  mes: MesRef | null;
  mesesAtePayback: number | null;
  valorAcumuladoNoPayback: number | null;
}

export interface RelatorioProjecao {
  serieMensal: LinhaCenarioMensal[];
  payback: PaybackInfo;
  economiaTotal: number;
  alertas: AlertaFiscal[];
  /** Container vazio — preenchido pela LLM depois (motor nunca gera texto). */
  insightsSugeridos: [];
  metadados: {
    mesInicio: MesRef;
    horizonteMeses: number;
    percentualNova: number;
    anexoMae: AnexoSimplesId;
    anexoNova: AnexoSimplesId;
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
