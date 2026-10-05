/**
 * Orquestrador de cenário dividido mãe/nova (Etapa 4 — implementado).
 *
 * Consome APENAS os exports públicos de `@/simples/calculo`:
 * `calcularConvencional` e `fatorR`. PROIBIDO reimplementar
 * alíquota, DAS, faixa ou Fator R — delegação total ao motor existente.
 *
 * Baseline "unificado": tudo na mãe (anexo da mãe, RBT12 rolante do total
 * sobre o histórico da mãe). Economia do mês =
 * DAS_ref − (DAS_mãe + DAS_nova) − custoMensalNova.
 */
import { calcularConvencional, fatorR } from '@/simples/calculo';
import { RBT12_MAX, SUBLIMITE } from '@/simples/tabelas';
import { projetarRBT12Rolling } from './janela-rbt12';
import type {
  AlertaFiscal,
  MesReceita,
  ParamsCenarioDividido,
  RelatorioProjecao,
} from './types';

const ANEXOS_VALIDOS = ['I', 'II', 'III', 'IV', 'V'] as const;

function validarConfigCenario(params: ParamsCenarioDividido): void {
  if (!params || typeof params !== 'object') {
    throw new Error('params inválido: informe { mesInicio, receitaTotalMensal, percentualNova, mae, nova }.');
  }
  if (!Array.isArray(params.receitaTotalMensal) || params.receitaTotalMensal.length === 0) {
    throw new Error('receitaTotalMensal vazia: informe a receita TOTAL projetada mês a mês em ordem cronológica.');
  }
  if (!(params.percentualNova > 0) || !(params.percentualNova < 1)) {
    throw new Error(
      `percentualNova inválido (${String(params.percentualNova)}): use fração 0 < p < 1 (ex. 0.3 = 30% na nova).`,
    );
  }
  for (const lado of ['mae', 'nova'] as const) {
    const cfg = params[lado];
    if (!cfg || typeof cfg !== 'object') throw new Error(`"${lado}" ausente: informe { anexoId, folha12, historico12 }.`);
    if (!ANEXOS_VALIDOS.includes(cfg.anexoId as (typeof ANEXOS_VALIDOS)[number])) {
      throw new Error(`"${lado}.anexoId" inválido ("${String(cfg.anexoId)}"): use I, II, III, IV ou V.`);
    }
    if (!Number.isFinite(cfg.folha12) || cfg.folha12 < 0) {
      throw new Error(`"${lado}.folha12" inválida: use número >= 0 (folha 12m para Fator R).`);
    }
    if (!Array.isArray(cfg.historico12)) {
      throw new Error(`"${lado}.historico12" deve ser um array de { mes, receita }.`);
    }
  }
  const custo = params.custoMensalNova ?? 0;
  if (!Number.isFinite(custo) || custo < 0) {
    throw new Error('custoMensalNova inválido: use número >= 0.');
  }
}

function fatiarReceita(total: MesReceita[], percentualNova: number): { mae: MesReceita[]; nova: MesReceita[] } {
  const mae: MesReceita[] = [];
  const nova: MesReceita[] = [];
  for (const t of total) {
    const rNova = Math.round(t.receita * percentualNova * 100) / 100;
    nova.push({ mes: t.mes, receita: rNova });
    mae.push({ mes: t.mes, receita: Math.round((t.receita - rNova) * 100) / 100 });
  }
  return { mae, nova };
}

/**
 * Simula o cenário dividido mês a mês:
 * RBT12 deslizante (mãe + nova + referência) → motor existente → economia → payback.
 * PURA: sem I/O.
 */
export function simularCenarioDividido(params: ParamsCenarioDividido): RelatorioProjecao {
  validarConfigCenario(params);
  const { mesInicio, receitaTotalMensal, percentualNova, mae, nova } = params;
  const custoMensalNova = params.custoMensalNova ?? 0;

  const split = fatiarReceita(receitaTotalMensal, percentualNova);

  // Três janelas independentes (cada uma valida formato/ordem por si).
  const janelaMae = projetarRBT12Rolling({
    mesInicio,
    historico12: mae.historico12,
    projecaoMensal: split.mae,
    mesesAtividade: mae.mesesAtividade,
  });
  const janelaNova = projetarRBT12Rolling({
    mesInicio,
    historico12: nova.historico12,
    projecaoMensal: split.nova,
    mesesAtividade: nova.mesesAtividade,
  });
  const janelaRef = projetarRBT12Rolling({
    mesInicio,
    historico12: mae.historico12,
    projecaoMensal: receitaTotalMensal,
    mesesAtividade: mae.mesesAtividade,
  });

  const serieMensal: RelatorioProjecao['serieMensal'] = [];
  const alertas: AlertaFiscal[] = [];
  let economiaAcumulada = 0;
  let paybackMes: string | null = null;
  let paybackIdx: number | null = null;
  let paybackValor: number | null = null;

  for (let i = 0; i < receitaTotalMensal.length; i++) {
    const total = receitaTotalMensal[i]!;
    const rMae = janelaMae[i]!;
    const rNova = janelaNova[i]!;
    // Motor existente — única fonte de alíquota/ƒaixa/DAS (nunca recalculado aqui).
    const convMae = calcularConvencional({ anexoId: mae.anexoId, rbt12: rMae.rbt12, receitaMes: split.mae[i]!.receita });
    const convNova = calcularConvencional({ anexoId: nova.anexoId, rbt12: rNova.rbt12, receitaMes: split.nova[i]!.receita });
    const convRef = calcularConvencional({
      anexoId: mae.anexoId,
      rbt12: janelaRef[i]!.rbt12,
      receitaMes: total.receita,
    });

    const economiaMes =
      Math.round((convRef.das - (convMae.das + convNova.das) - custoMensalNova) * 100) / 100;
    economiaAcumulada = Math.round((economiaAcumulada + economiaMes) * 100) / 100;
    if (paybackMes === null && economiaAcumulada > 0) {
      paybackMes = total.mes;
      paybackIdx = i + 1;
      paybackValor = economiaAcumulada;
    }

    serieMensal.push({
      mes: total.mes,
      receitaTotal: total.receita,
      receitaMae: split.mae[i]!.receita,
      receitaNova: split.nova[i]!.receita,
      rbt12Mae: rMae.rbt12,
      rbt12Nova: rNova.rbt12,
      faixaMae: convMae.faixa,
      faixaNova: convNova.faixa,
      aliquotaEfetivaMae: convMae.aliquotaEfetiva,
      aliquotaEfetivaNova: convNova.aliquotaEfetiva,
      dasMae: convMae.das,
      dasNova: convNova.das,
      dasUnificadoReferencia: convRef.das,
      economiaMes,
      economiaAcumulada,
    });

    // Alertas fiscais obrigatórios (sinalizar, nunca bloquear).
    if (rMae.rbt12 > SUBLIMITE || rNova.rbt12 > SUBLIMITE) {
      alertas.push({
        codigo: 'SUBLIMITE_3_6M',
        mes: total.mes,
        mensagem: `RBT12 acima do sublimite R$ 3,6M em ${total.mes} (mãe ${rMae.rbt12} / nova ${rNova.rbt12}): ISS/ICMS saem do DAS na parcela excedente.`,
      });
    }
    if (rMae.rbt12 > RBT12_MAX || rNova.rbt12 > RBT12_MAX || janelaRef[i]!.rbt12 > RBT12_MAX) {
      alertas.push({
        codigo: 'DESENQUADRAMENTO_4_8M',
        mes: total.mes,
        mensagem: `RBT12 acima de R$ 4,8M em ${total.mes}: risco de desenquadramento do Simples.`,
      });
    }
    if (rNova.empresaNova) {
      alertas.push({
        codigo: 'EMPRESA_NOVA_REGRA_MEDIA',
        mes: total.mes,
        mensagem: `Nova empresa em ${total.mes} com < 12 meses: RBT12 proporcional (média × 12).`,
      });
    }
  }

  // Fator R: confere 1x por empresa (folha fixa) contra o último RBT12.
  for (const [rotulo, cfg, janela] of [
    ['mãe', mae, janelaMae],
    ['nova', nova, janelaNova],
  ] as const) {
    if (cfg.anexoId === 'III' || cfg.anexoId === 'V') {
      const ultimo = janela[janela.length - 1]!;
      const fr = fatorR(cfg.folha12, ultimo.rbt12);
      if (fr.anexo !== cfg.anexoId) {
        alertas.push({
          codigo: 'FATOR_R_TROCA_ANEXO',
          mes: ultimo.mes,
          mensagem: `Fator R da ${rotulo} indica Anexo ${fr.anexo} (índice ${(fr.indice * 100).toFixed(2)}%), mas o cenário usa Anexo ${cfg.anexoId}. Revise folha ou anexo.`,
        });
      }
    }
  }
  alertas.push({
    codigo: 'CONSOLIDACAO_RECEITA_GRUPO',
    mes: null,
    mensagem:
      'Projeção informativa: grupo econômico pode exigir consolidação de receita para fins de sublimite/desenquadramento — valide com contador.',
  });

  return {
    serieMensal,
    payback: {
      mes: paybackMes,
      mesesAtePayback: paybackIdx,
      valorAcumuladoNoPayback: paybackValor,
    },
    economiaTotal: economiaAcumulada,
    alertas,
    insightsSugeridos: [],
    metadados: {
      mesInicio,
      horizonteMeses: receitaTotalMensal.length,
      percentualNova,
      anexoMae: mae.anexoId,
      anexoNova: nova.anexoId,
      motorVersao: 'simples-projection v1 + calc-engine v3',
    },
  };
}
