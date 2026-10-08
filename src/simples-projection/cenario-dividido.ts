/**
 * Orquestrador de cenário dividido mãe/nova (Etapa 4 — implementado + upgrade v2).
 *
 * Consome APENAS os exports públicos de `@/simples/calculo`:
 * `calcularConvencional` e `fatorR`. PROIBIDO reimplementar
 * alíquota, DAS, faixa ou Fator R — delegação total ao motor existente.
 *
 * Baseline "unificado": tudo na mãe (anexo da mãe, RBT12 rolante do total
 * sobre o histórico da mãe). Economia do mês =
 * DAS_ref − (DAS_mãe + DAS_nova) − custoMes.
 * custoMes = custoMensalNova (+ custoInicialNova rateado no mês 1).
 *
 * v2: percentual 0..1 (extremos válidos), mês de virada (1ª economia mensal
 * > 0), payback (1º acumulado > 0) e veredito compensa / não-compensa /
 * empate-técnico (|economia| ≤ margemEmpate).
 */
import { calcularConvencional, fatorR } from '@/simples/calculo';
import { ANEXOS_SIMPLES, RBT12_MAX, SUBLIMITE } from '@/simples/tabelas';
import { calcularDASegregado, normalizarComposicao } from './das-segregado';
import { projetarRBT12Rolling } from './janela-rbt12';
import { analisarFatorRSerie } from './fator-r-dividido';
import { analisarRetorno } from './analise-retorno';
import type {
  AlertaFiscal,
  ConfigEmpresaCenario,
  DetalheParcelaMes,
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
  if (!(params.percentualNova >= 0) || !(params.percentualNova <= 1) || !Number.isFinite(params.percentualNova)) {
    throw new Error(
      `percentualNova inválido (${String(params.percentualNova)}): use fração 0 ≤ p ≤ 1 (ex. 0.3 = 30% na nova).`,
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
  for (const lado of ['mae', 'nova'] as const) {
    const comp = params[lado].composicao;
    if (comp !== undefined && comp !== null) {
      if (!Array.isArray(comp) || comp.length === 0) {
        throw new Error(`"${lado}.composicao" vazia: omita o campo (mono-anexo) ou informe [{ anexoId, percentual }].`);
      }
      normalizarComposicao(comp); // valida percentuais (lança se inválido)
    }
  }
  const custoInicial = params.custoInicialNova ?? 0;
  if (!Number.isFinite(custoInicial) || custoInicial < 0) {
    throw new Error('custoInicialNova inválido: use número >= 0.');
  }
  const margem = params.margemEmpate ?? 0;
  if (!Number.isFinite(margem) || margem < 0) {
    throw new Error('margemEmpate inválida: use número >= 0.');
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
  const custoInicialNova = params.custoInicialNova ?? 0;
  const margemEmpate = params.margemEmpate ?? 0;
  const compMae = mae.composicao?.length ? normalizarComposicao(mae.composicao) : null;
  const compNova = nova.composicao?.length ? normalizarComposicao(nova.composicao) : null;

  /**
   * Apura UMA empresa num mês: mono-anexo (1 chamada ao motor) ou segregado
   * (1 chamada por parcela, RBT12 total em cada tabela, DAS somado).
   * Retorna faixa/alíquota da maior parcela para exibição + detalhe auditável.
   */
  const apurarEmpresa = (
    cfg: ConfigEmpresaCenario,
    comp: Array<{ anexoId: ConfigEmpresaCenario['anexoId']; percentual: number }> | null,
    rbt12: number,
    receita: number,
  ): {
    das: number;
    faixa: number;
    aliquotaEfetiva: number;
    aliquotaNominal?: number;
    parcelaDeduzir?: number;
    detalhe?: DetalheParcelaMes[];
  } => {
    if (!comp) {
      const conv = calcularConvencional({ anexoId: cfg.anexoId, rbt12, receitaMes: receita });
      const tab = ANEXOS_SIMPLES[cfg.anexoId].faixas.find((f) => f.faixa === conv.faixa);
      return {
        das: conv.das,
        faixa: conv.faixa,
        aliquotaEfetiva: conv.aliquotaEfetiva,
        aliquotaNominal: tab?.aliquotaNominal,
        parcelaDeduzir: tab?.parcelaDeduzir,
      };
    }
    const parcelas = comp.map((c) => ({
      anexoId: c.anexoId,
      receitaMes: Math.round(receita * c.percentual * 100) / 100,
    }));
    const seg = calcularDASegregado(rbt12, parcelas);
    const maior = seg.parcelas.reduce((a, b) => (b.receitaMes >= a.receitaMes ? b : a), seg.parcelas[0]!);
    const tabMaior = ANEXOS_SIMPLES[maior.anexoId].faixas.find((f) => f.faixa === maior.faixa);
    return {
      das: seg.das,
      faixa: maior.faixa,
      aliquotaEfetiva: receita > 0 ? seg.das / receita : 0,
      aliquotaNominal: tabMaior?.aliquotaNominal,
      parcelaDeduzir: tabMaior?.parcelaDeduzir,
      detalhe: seg.parcelas,
    };
  };

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
  let mesVirada: string | null = null;
  let mesesAteVirada: number | null = null;

  for (let i = 0; i < receitaTotalMensal.length; i++) {
    const total = receitaTotalMensal[i]!;
    const rMae = janelaMae[i]!;
    const rNova = janelaNova[i]!;
    const rRef = janelaRef[i]!;
    // Motor existente — única fonte de alíquota/faixa/DAS (nunca recalculado aqui).
    // Composição presente ⇒ DAS segregado por anexo (RBT12 total em cada tabela).
    const apMae = apurarEmpresa(mae, compMae, rMae.rbt12, split.mae[i]!.receita);
    const apNova = apurarEmpresa(nova, compNova, rNova.rbt12, split.nova[i]!.receita);
    // Baseline unificado: mesma mistura de atividades da mãe, tudo nela.
    const apRef = apurarEmpresa(mae, compMae, rRef.rbt12, total.receita);

    const custoMes =
      Math.round((custoMensalNova + (i === 0 ? custoInicialNova : 0)) * 100) / 100;
    const economiaBruta = Math.round((apRef.das - (apMae.das + apNova.das)) * 100) / 100;
    const economiaMes = Math.round((economiaBruta - custoMes) * 100) / 100;
    economiaAcumulada = Math.round((economiaAcumulada + economiaMes) * 100) / 100;
    if (mesVirada === null && economiaMes > 0) {
      mesVirada = total.mes;
      mesesAteVirada = i + 1;
    }
    if (paybackMes === null && economiaAcumulada > 0) {
      paybackMes = total.mes;
      paybackIdx = i + 1;
      paybackValor = economiaAcumulada;
    }

    // Detalhe da faixa (nominal + dedução) apenas para exibição da
    // progressividade — lido da tabela oficial, nunca recalculado.
    // (Com segregação: dados da maior parcela; o detalhe integral vai em `detalhe*`.)
    const faixaMaeTab = !compMae ? ANEXOS_SIMPLES[mae.anexoId].faixas.find((f) => f.faixa === apMae.faixa) : undefined;
    const faixaNovaTab = !compNova ? ANEXOS_SIMPLES[nova.anexoId].faixas.find((f) => f.faixa === apNova.faixa) : undefined;
    const faixaRefTab = !compMae ? ANEXOS_SIMPLES[mae.anexoId].faixas.find((f) => f.faixa === apRef.faixa) : undefined;

    serieMensal.push({
      mes: total.mes,
      receitaTotal: total.receita,
      receitaMae: split.mae[i]!.receita,
      receitaNova: split.nova[i]!.receita,
      rbt12Mae: rMae.rbt12,
      rbt12Nova: rNova.rbt12,
      rbt12Ref: rRef.rbt12,
      faixaMae: apMae.faixa,
      faixaNova: apNova.faixa,
      faixaRef: apRef.faixa,
      aliquotaEfetivaMae: apMae.aliquotaEfetiva,
      aliquotaEfetivaNova: apNova.aliquotaEfetiva,
      aliquotaEfetivaRef: total.receita > 0 ? apRef.das / total.receita : 0,
      aliquotaNominalMae: apMae.aliquotaNominal ?? faixaMaeTab?.aliquotaNominal,
      aliquotaNominalNova: apNova.aliquotaNominal ?? faixaNovaTab?.aliquotaNominal,
      aliquotaNominalRef: apRef.aliquotaNominal ?? faixaRefTab?.aliquotaNominal,
      parcelaDeduzirMae: apMae.parcelaDeduzir ?? faixaMaeTab?.parcelaDeduzir,
      parcelaDeduzirNova: apNova.parcelaDeduzir ?? faixaNovaTab?.parcelaDeduzir,
      parcelaDeduzirRef: apRef.parcelaDeduzir ?? faixaRefTab?.parcelaDeduzir,
      dasMae: apMae.das,
      dasNova: apNova.das,
      dasUnificadoReferencia: apRef.das,
      detalheMae: apMae.detalhe,
      detalheNova: apNova.detalhe,
      detalheRef: apRef.detalhe,
      economiaBrutaMes: economiaBruta,
      custoMes,
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

  // Fator R: alerta pontual por empresa (folha fixa × último RBT12) +
  // diagnóstico mensal completo em `analiseFatorR` (déficit e pró-labore).
  // Empresa dispensada (III puro) não é verificada.
  for (const [rotulo, cfg, janela] of [
    ['mãe', mae, janelaMae],
    ['nova', nova, janelaNova],
  ] as const) {
    if ((cfg.anexoId === 'III' || cfg.anexoId === 'V') && !cfg.dispensarFatorR) {
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

  const veredito =
    margemEmpate > 0 && Math.abs(economiaAcumulada) <= margemEmpate
      ? 'empate-tecnico'
      : economiaAcumulada > 0
        ? 'compensa'
        : 'nao-compensa';

  return {
    serieMensal,
    payback: {
      mes: paybackMes,
      mesesAtePayback: paybackIdx,
      valorAcumuladoNoPayback: paybackValor,
      mesVirada,
      mesesAteVirada,
      veredito,
    },
    economiaTotal: economiaAcumulada,
    alertas,
    insightsSugeridos: [],
    analiseFatorR: analisarFatorRSerie(
      serieMensal.map((l) => ({ mes: l.mes, rbt12Mae: l.rbt12Mae, rbt12Nova: l.rbt12Nova, rbt12Ref: l.rbt12Ref ?? 0 })),
      {
        anexoMae: mae.anexoId,
        anexoNova: nova.anexoId,
        folha12Mae: mae.folha12,
        folha12Nova: nova.folha12,
        sujeitaFatorRMae: !mae.dispensarFatorR,
        sujeitaFatorRNova: !nova.dispensarFatorR,
        envolveAnexoIV: mae.anexoId === 'IV' || nova.anexoId === 'IV',
      },
    ),
    analiseRetorno: analisarRetorno(serieMensal, custoMensalNova),
    metadados: {
      mesInicio,
      horizonteMeses: receitaTotalMensal.length,
      percentualNova,
      anexoMae: mae.anexoId,
      anexoNova: nova.anexoId,
      composicaoMae: compMae ?? undefined,
      composicaoNova: compNova ?? undefined,
      folha12Mae: mae.folha12,
      folha12Nova: nova.folha12,
      custoMensalNova,
      custoInicialNova,
      margemEmpate,
      motorVersao: 'simples-projection v2 + calc-engine v3',
    },
  };
}
