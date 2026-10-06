/**
 * Simples Projection — diagnóstico do Fator R no cenário dividido (módulo PURO).
 *
 * REGRA DE OURO: o índice e o anexo indicado vêm SEMPRE do motor existente
 * (`fatorR` de `@/simples/calculo` — nunca recalculado aqui). Este módulo
 * apenas organiza o diagnóstico mês a mês (mãe × nova × unificado) e calcula
 * o DÉFICIT de folha para 28% (matemática nova, não regra do Simples):
 *
 *   deficitFolha = max(0, 0,28 × RBT12p − folha12)
 *   proLaboreMensalSugerido = deficitFolha ÷ 12
 *
 * O RBT12p é o RBT12 projetado (deslizante) de cada mês da série — por isso o
 * déficit varia ao longo do horizonte. O cenário "unificado" usa a folha
 * somada (mesma equipe, tudo na mãe) contra o RBT12 de referência.
 *
 * PURA: sem I/O, sem rede, sem banco.
 */
import { fatorR } from '@/simples/calculo';
import { FATOR_R_LIMIAR, type AnexoSimplesId } from '@/simples/tabelas';
import { calcularCustoProLabore, round2, type CustoProLabore } from './pro-labore';

export type RotuloEmpresaFatorR = 'mae' | 'nova' | 'unificado';

export interface DiagnosticoFatorREmpresa {
  rotulo: RotuloEmpresaFatorR;
  anexo: AnexoSimplesId;
  /** false quando o anexo não usa Fator R (I, II, IV) — diagnóstico dispensado. */
  aplicaFatorR: boolean;
  folha12: number;
  /** RBT12 projetado do mês (ou do cenário unificado). */
  rbt12p: number;
  /** Índice folha12 ÷ RBT12p (via motor `fatorR`). */
  indice: number;
  /** Anexo indicado pelo motor (III ≥ 28%, V < 28%). */
  anexoIndicado: 'III' | 'V';
  atinge28: boolean;
  /** Quanto falta na folha 12m para alcançar 28% (0 quando já atinge). */
  deficitFolha: number;
  /** deficitFolha ÷ 12 — pró-labore mensal adicional sugerido. */
  proLaboreMensalSugerido: number;
}

/** Folha necessária (12m) para o índice exato de 28%. */
export function folhaNecessaria28(rbt12p: number): number {
  return round2(Math.max(0, Number(rbt12p) || 0) * FATOR_R_LIMIAR);
}

export function diagnosticarFatorREmpresa(
  rotulo: RotuloEmpresaFatorR,
  anexo: AnexoSimplesId,
  folha12: number,
  rbt12p: number,
): DiagnosticoFatorREmpresa {
  const folha = Math.max(0, Number(folha12) || 0);
  const rbt = Math.max(0, Number(rbt12p) || 0);
  const aplicaFatorR = anexo === 'III' || anexo === 'V';
  const fr = fatorR(folha, rbt);
  const atinge28 = fr.indice >= FATOR_R_LIMIAR;
  const deficitFolha = aplicaFatorR && rbt > 0 && !atinge28 ? round2(folhaNecessaria28(rbt) - folha) : 0;
  return {
    rotulo,
    anexo,
    aplicaFatorR,
    folha12: round2(folha),
    rbt12p: round2(rbt),
    indice: round2(fr.indice * 10000) / 10000,
    anexoIndicado: fr.anexo,
    atinge28,
    deficitFolha,
    proLaboreMensalSugerido: round2(deficitFolha / 12),
  };
}

export interface EntradaSerieFatorR {
  mes: string;
  rbt12Mae: number;
  rbt12Nova: number;
  rbt12Ref: number;
}

export interface LinhaFatorRMensal {
  mes: string;
  mae: DiagnosticoFatorREmpresa;
  nova: DiagnosticoFatorREmpresa;
  unificado: DiagnosticoFatorREmpresa;
}

export interface ResumoFatorR {
  mesesAbaixo28Mae: number;
  mesesAbaixo28Nova: number;
  mesesAbaixo28Unificado: number;
  /** Maior déficit da mãe no horizonte (e o mês em que ocorre). */
  maiorDeficitMae: { valor: number; mes: string | null };
  maiorDeficitNova: { valor: number; mes: string | null };
  maiorDeficitUnificado: { valor: number; mes: string | null };
  /** Custo PF do pró-labore sugerido no mês de maior déficit (mãe/nova). */
  custoMaiorProLaboreMae: CustoProLabore | null;
  custoMaiorProLaboreNova: CustoProLabore | null;
}

export interface AnaliseFatorR {
  linhas: LinhaFatorRMensal[];
  resumo: ResumoFatorR;
}

export interface ConfigAnaliseFatorR {
  anexoMae: AnexoSimplesId;
  anexoNova: AnexoSimplesId;
  folha12Mae: number;
  folha12Nova: number;
  /** true quando algum anexo envolvido é o IV (CPP patronal por fora do DAS). */
  envolveAnexoIV?: boolean;
}

/**
 * Diagnóstico mês a mês do Fator R (mãe × nova × unificado).
 * A folha 12m é fixa (input); o RBT12p varia → déficit e pró-labore variam.
 */
export function analisarFatorRSerie(
  serie: EntradaSerieFatorR[],
  cfg: ConfigAnaliseFatorR,
): AnaliseFatorR {
  const linhas: LinhaFatorRMensal[] = (serie ?? []).map((l) => ({
    mes: l.mes,
    mae: diagnosticarFatorREmpresa('mae', cfg.anexoMae, cfg.folha12Mae, l.rbt12Mae),
    nova: diagnosticarFatorREmpresa('nova', cfg.anexoNova, cfg.folha12Nova, l.rbt12Nova),
    unificado: diagnosticarFatorREmpresa(
      'unificado',
      cfg.anexoMae,
      (Number(cfg.folha12Mae) || 0) + (Number(cfg.folha12Nova) || 0),
      l.rbt12Ref,
    ),
  }));

  const abaixo = (xs: LinhaFatorRMensal[], k: 'mae' | 'nova' | 'unificado'): number =>
    xs.filter((l) => l[k].aplicaFatorR && !l[k].atinge28).length;

  const maior = (
    xs: LinhaFatorRMensal[],
    k: 'mae' | 'nova' | 'unificado',
  ): { valor: number; mes: string | null } => {
    let valor = 0;
    let mes: string | null = null;
    for (const l of xs) {
      if (l[k].deficitFolha > valor) {
        valor = l[k].deficitFolha;
        mes = l.mes;
      }
    }
    return { valor: round2(valor), mes };
  };

  const maiorMae = maior(linhas, 'mae');
  const maiorNova = maior(linhas, 'nova');
  const maiorUni = maior(linhas, 'unificado');

  return {
    linhas,
    resumo: {
      mesesAbaixo28Mae: abaixo(linhas, 'mae'),
      mesesAbaixo28Nova: abaixo(linhas, 'nova'),
      mesesAbaixo28Unificado: abaixo(linhas, 'unificado'),
      maiorDeficitMae: maiorMae,
      maiorDeficitNova: maiorNova,
      maiorDeficitUnificado: maiorUni,
      custoMaiorProLaboreMae:
        maiorMae.valor > 0
          ? calcularCustoProLabore(round2(maiorMae.valor / 12), { envolveAnexoIV: cfg.envolveAnexoIV })
          : null,
      custoMaiorProLaboreNova:
        maiorNova.valor > 0
          ? calcularCustoProLabore(round2(maiorNova.valor / 12), { envolveAnexoIV: cfg.envolveAnexoIV })
          : null,
    },
  };
}
