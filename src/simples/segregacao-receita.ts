/**
 * Simples Nacional — segregação de receitas por anexo (LC 123/2006, art. 18)
 * com Substituição Tributária opcional por parcela.
 *
 * Fluxo único: o usuário informa o valor a segregar em cada linha — no mesmo
 * anexo ou em outro — e marca o checkbox ST quando aquela parcela já teve
 * ICMS/ISS recolhido por substituição (I/II → ICMS · III/IV/V → ISS).
 *
 * - faixa em cada tabela: sempre pelo RBT12 total (nunca rateado)
 * - folha compartilhada: Anexo V com Fator R ≥ 28% calcula como III
 * - DAS parcela = aliquotaEfetiva(anexo EFETIVO, RBT12 total) × receita da parcela
 * - parcela com ST: deduz integralmente o ICMS/ISS daquela parcela
 *   (equivale ao proporcional do PGDAS, pois a parcela ISOLA a receita ST)
 * - DAS total = soma dos DAS das parcelas (já deduzidos)
 * - DAS bruto = soma sem nenhuma dedução ST (p/ exibir Bruto − Segregado)
 * - repartição total = soma das repartições (por tributo)
 * - alíquota média = DAS total ÷ receita total (p/ exibição)
 * - Folha/Fator R: informativa (o anexo de cada parcela já vem escolhido;
 *   sem nova decisão III×V por parcela)
 *
 * PURA: consome `calcularConvencional` + `calcularST`. Sem I/O.
 */
import { calcularConvencional, fatorR, round2, type ForaSublimite, type Reparticao, type ResultadoConvencional } from './calculo';
import { calcularST, tributoSTDoAnexo, type TributoST } from './segregacao-st';
import { SUBLIMITE, type AnexoSimplesId } from './tabelas';

export interface ParcelaSegEntrada {
  anexoId: AnexoSimplesId;
  receitaMes: number;
  /** true = ICMS/ISS desta parcela já recolhido por ST (dedução integral). */
  st?: boolean;
  /** true = restante automático (receita não segregada, anexo efetivo). */
  resto?: boolean;
  /** Anexo escolhido pelo usuário (p/ exibir V→III; default = anexoId). */
  escolhido?: AnexoSimplesId;
}

export interface DetalheParcelaSeg {
  /** Anexo escolhido pelo usuário na linha. */
  anexoId: AnexoSimplesId;
  /** Anexo efetivamente usado no cálculo (V com Fator R ≥ 28% → III). */
  anexoCalculado: AnexoSimplesId;
  receitaMes: number;
  faixa: number;
  aliquotaEfetiva: number;
  /** Carga total da parcela (guia + fora) já com a ST deduzida. */
  das: number;
  /** DAS da parcela DENTRO da guia (sem fora do sublimite), já com ST. */
  dasGuia: number;
  /** Carga total da parcela antes da ST. */
  dasBruto: number;
  /** Guia da parcela antes da ST. */
  dasBrutoGuia: number;
  reparticao: Reparticao;
  /** Repartição da parcela só na guia (fora zerado, ST deduzida). */
  reparticaoGuia: Reparticao;
  /** Repartição da parcela antes da ST (p/ riscado por tributo). */
  reparticaoBruta: Reparticao;
  /** Repartição da guia antes da ST. */
  reparticaoBrutaGuia: Reparticao;
  /** ICMS/ISS/IBS da parcela fora da guia (sublimite). */
  foraSublimite: ForaSublimite;
  tributosFora: string[];
  excedeSublimite: boolean;
  cbsDentroDAS: number;
  st: boolean;
  tributoST: TributoST | null;
  deducaoST: number;
  /** true = restante automático (não digitado pelo usuário). */
  resto: boolean;
  /** Anexo escolhido pelo usuário (redirecionado? ver anexoCalculado). */
  escolhido: AnexoSimplesId;
  excedenteISS: number;
  receitaNaoExcedente: number;
  receitaExcedente: number;
}

export interface ResultadoSegregado {
  rbt12: number;
  receitaMes: number;
  /** DAS final = soma das parcelas (ST já deduzida). */
  das: number;
  /** DAS final DENTRO da guia (sem ICMS/ISS/IBS do sublimite). */
  dasGuia: number;
  /** Carga total = guia + fora do sublimite. */
  cargaTotal: number;
  /** ICMS/ISS/IBS fora da guia somados (sublimite). */
  foraSublimite: ForaSublimite;
  /** true quando ao menos 1 parcela excede o sublimite. */
  excedeSublimite: boolean;
  /** DAS bruto = soma sem dedução ST (Bruto − Segregado = economia). */
  dasBruto: number;
  /** Total deduzido por ST (dasBruto − das). */
  deducaoST: number;
  /** true quando ao menos 1 parcela tem ST com dedução > 0. */
  temST: boolean;
  /** Tributos substituídos com dedução > 0 (p/ rótulos/legenda). */
  tributosST: TributoST[];
  /** ST por tributo: base segregada + dedução (p/ obs/guia/CSV). */
  stDetalhe: Array<{ tributo: TributoST; valorST: number; deducao: number }>;
  /** Partição real do sublimite (soma das parcelas — ver rateio). */
  receitaNaoExcedente: number;
  receitaExcedente: number;
  /** Soma das repartições das parcelas (por tributo, já deduzida). */
  reparticao: Reparticao;
  /** Soma das repartições só na guia (fora zerado, ST deduzida). */
  reparticaoGuia: Reparticao;
  /** Soma das repartições brutas (antes da ST, p/ riscado). */
  reparticaoBruta: Reparticao;
  /** Soma das repartições da guia antes da ST. */
  reparticaoBrutaGuia: Reparticao;
  /** Guia bruta (antes da ST) — p/ legenda. */
  dasBrutoGuia: number;
  cbsDentroDAS: number;
  /** Alíquota média ponderada (DAS ÷ receita) — exibição. */
  aliquotaMedia: number;
  anexos: AnexoSimplesId[];
  parcelas: DetalheParcelaSeg[];
}

/**
 * Anexo efetivo da parcela — aplica a MESMA regra do cálculo normal:
 * Anexo V com Fator R (folha ÷ RBT12) ≥ 28% é tributado como Anexo III
 * (o V só vale abaixo de 28%). Sem folha informada, mantém o escolhido.
 * Demais anexos seguem sempre a escolha explícita.
 */
export function anexoEfetivoParcela(
  anexoId: AnexoSimplesId,
  rbt12: number,
  folha12: number,
): { anexo: AnexoSimplesId; redirecionado: boolean } {
  if (anexoId === 'V') {
    const rbt = Math.max(0, Number(rbt12) || 0);
    const folha = Math.max(0, Number(folha12) || 0);
    if (rbt > 0 && folha > 0 && fatorR(folha, rbt).anexo === 'III') {
      return { anexo: 'III', redirecionado: true };
    }
  }
  return { anexo: anexoId, redirecionado: false };
}

/**
 * Calcula o DAS segregado. Lança erro fail-closed se:
 * - nenhuma parcela com receita > 0
 * - rbt12Total <= 0
 *
 * Todas as parcelas compartilham RBT12 total (faixa) e folha (Fator R);
 * cada uma é calculada na tabela do seu anexo EFETIVO e o DAS é a soma.
 */
export function calcularSegregado(
  rbt12Total: number,
  parcelas: ParcelaSegEntrada[],
  rba?: number,
  folha12?: number,
  refs?: { aliqRefICMS?: number | null; aliqRefISS?: number | null },
): ResultadoSegregado {
  const rbt = Math.max(0, Number(rbt12Total) || 0);
  if (!(rbt > 0)) throw new Error('rbt12-ausente-ou-invalido: informe RBT12 > 0');
  const folha = Math.max(0, Number(folha12) || 0);
  const validas = (parcelas ?? [])
    .map((p) => ({
      anexoId: p.anexoId,
      receitaMes: Math.max(0, Number(p.receitaMes) || 0),
      st: p.st === true,
      resto: p.resto === true,
      escolhido: p.escolhido ?? p.anexoId,
    }))
    .filter((p) => p.receitaMes > 0);
  if (validas.length === 0) throw new Error('parcelas vazias: informe ao menos { anexoId, receitaMes > 0 }.');

  // Sublimite: o excesso (RBA−3,6M) é ÚNICO e rateado entre as parcelas
  // pro-rata à receita (maior absorve o resíduo). Repetir o RBA integral
  // em cada parcela contaria o excedente N vezes (ex.: −R$ 81,65 no cen. 4).
  const rbaNum = rba == null ? rbt : Number(rba) || 0;
  const excessoTotal = Math.max(0, rbaNum - SUBLIMITE);
  const recTotal = validas.reduce((a, p) => a + p.receitaMes, 0);
  const excDistribuivel = Math.min(excessoTotal, recTotal);
  let maiorIdx = 0;
  validas.forEach((p, i) => {
    if (p.receitaMes > validas[maiorIdx].receitaMes) maiorIdx = i;
  });
  let excAcumulado = 0;
  const rbas = validas.map((p, i) => {
    // A maior parcela é calculada por último e absorve o resíduo (fecha exato).
    const exc = i === maiorIdx
      ? 0
      : round2((excDistribuivel * p.receitaMes) / (recTotal || 1));
    if (i !== maiorIdx) excAcumulado = round2(excAcumulado + exc);
    return exc;
  });
  rbas[maiorIdx] = round2(excDistribuivel - excAcumulado);
  const rbasFinais = rbas.map((exc) => SUBLIMITE + exc);

  const det: DetalheParcelaSeg[] = validas.map((p, i) => {
    const { anexo: anexoCalc } = anexoEfetivoParcela(p.anexoId, rbt, folha);
    const conv = calcularConvencional({
      anexoId: anexoCalc,
      rbt12: rbt,
      receitaMes: p.receitaMes,
      rba: rbasFinais[i],
      aliqRefICMS: refs?.aliqRefICMS,
      aliqRefISS: refs?.aliqRefISS,
    });
    const repBruta: Reparticao = { ...conv.reparticao };
    const repBrutaGuia: Reparticao = { ...conv.reparticaoGuia };
    const baseDet = {
      anexoId: p.anexoId,
      anexoCalculado: anexoCalc,
      receitaMes: p.receitaMes,
      faixa: conv.faixa,
      aliquotaEfetiva: conv.aliquotaEfetiva,
      reparticaoBruta: repBruta,
      reparticaoBrutaGuia: repBrutaGuia,
      foraSublimite: { ...conv.foraSublimite },
      tributosFora: [...conv.tributosFora],
      excedeSublimite: conv.excedeSublimite,
      cbsDentroDAS: conv.cbsDentroDAS,
      resto: p.resto,
      escolhido: p.escolhido,
      excedenteISS: conv.excedenteISS,
      receitaNaoExcedente: conv.detalhes.receitaNaoExcedente,
      receitaExcedente: conv.detalhes.receitaExcedente,
    };
    if (p.st === true) {
      // ST segue o anexo EFETIVO (V redirecionado → III deduz ISS, não ICMS).
      // Com sublimite o tributo pode já estar fora da guia → dedução 0.
      const tax = tributoSTDoAnexo(anexoCalc);
      const rst = calcularST(conv, p.receitaMes, p.receitaMes, tax);
      return {
        ...baseDet,
        das: rst.convAjustado.das,
        dasGuia: rst.dasFinal,
        dasBruto: conv.das,
        dasBrutoGuia: conv.dasGuia,
        reparticao: { ...rst.convAjustado.reparticao },
        reparticaoGuia: { ...rst.reparticaoFinal },
        st: true,
        tributoST: tax,
        deducaoST: rst.deducao,
      };
    }
    return {
      ...baseDet,
      das: conv.das,
      dasGuia: conv.dasGuia,
      dasBruto: conv.das,
      dasBrutoGuia: conv.dasGuia,
      reparticao: { ...conv.reparticao },
      reparticaoGuia: { ...conv.reparticaoGuia },
      st: false,
      tributoST: null,
      deducaoST: 0,
    };
  });

  const soma = (f: (d: DetalheParcelaSeg) => number): number =>
    round2(det.reduce((a, d) => a + f(d), 0));
  const somaRep = (f: (d: DetalheParcelaSeg) => Reparticao): Reparticao => {
    const out: Reparticao = { IRPJ: 0, CSLL: 0, CBS: 0, IBS: 0, CPP: 0, ICMS: 0, IPI: 0, ISS: 0 };
    (Object.keys(out) as (keyof Reparticao)[]).forEach((t) => {
      out[t] = round2(det.reduce((a, d) => a + (f(d)[t] ?? 0), 0));
    });
    return out;
  };

  const receitaMes = soma((d) => d.receitaMes);
  const das = soma((d) => d.das);
  const dasGuia = soma((d) => d.dasGuia);
  const dasBruto = soma((d) => d.dasBruto);
  const dasBrutoGuia = soma((d) => d.dasBrutoGuia);
  const deducaoST = round2(dasBruto - das);
  const foraSublimite: ForaSublimite = {
    icms: soma((d) => d.foraSublimite.icms),
    iss: soma((d) => d.foraSublimite.iss),
    ibs: soma((d) => d.foraSublimite.ibs),
    total: soma((d) => d.foraSublimite.total),
  };
  const excedeSublimite = det.some((d) => d.excedeSublimite);
  const tributosST: TributoST[] = [];
  for (const d of det) {
    if (d.st && d.tributoST && d.deducaoST > 0 && !tributosST.includes(d.tributoST)) tributosST.push(d.tributoST);
  }
  const stDetalhe = tributosST.map((t) => ({
    tributo: t,
    valorST: round2(det.filter((d) => d.st && d.tributoST === t).reduce((a, d) => a + d.receitaMes, 0)),
    deducao: round2(det.filter((d) => d.tributoST === t).reduce((a, d) => a + d.deducaoST, 0)),
  }));
  const anexos: AnexoSimplesId[] = [];
  for (const d of det) if (!anexos.includes(d.anexoCalculado)) anexos.push(d.anexoCalculado);
  return {
    rbt12: rbt,
    receitaMes: round2(receitaMes),
    das,
    dasGuia,
    cargaTotal: das,
    foraSublimite,
    excedeSublimite,
    dasBruto,
    deducaoST,
    temST: tributosST.length > 0,
    tributosST,
    stDetalhe,
    reparticao: somaRep((d) => d.reparticao),
    reparticaoGuia: somaRep((d) => d.reparticaoGuia),
    reparticaoBruta: somaRep((d) => d.reparticaoBruta),
    reparticaoBrutaGuia: somaRep((d) => d.reparticaoBrutaGuia),
    dasBrutoGuia,
    cbsDentroDAS: soma((d) => d.cbsDentroDAS),
    aliquotaMedia: receitaMes > 0 ? das / receitaMes : 0,
    anexos,
    parcelas: det,
    receitaNaoExcedente: soma((d) => d.receitaNaoExcedente),
    receitaExcedente: soma((d) => d.receitaExcedente),
  };
}

/** Soma das parcelas (p/ validar contra a receita do mês). */
export function somaParcelas(parcelas: Array<{ valor: number }>): number {
  return round2((parcelas ?? []).reduce((a, p) => a + (Math.max(0, Number(p.valor) || 0)), 0));
}

/**
 * Totais segregados na forma de `ResultadoConvencional` (p/ guia PGDAS
 * e exports que esperam um único `conv`).
 *
 * Todos os campos numéricos derivam das parcelas (nada herdado da base
 * além de anexoId/cenario/acrescimos): alíquotas = médias ponderadas sobre
 * a receita, excedente ISS e partição do sublimite = somas reais.
 */
export function pseudoConvDoSegregado(seg: ResultadoSegregado, base: ResultadoConvencional): ResultadoConvencional {
  const primeira = seg.parcelas[0];
  const rec = seg.receitaMes;
  const aliqCBS = rec > 0 ? seg.cbsDentroDAS / rec : 0;
  const tribFora: string[] = [];
  for (const d of seg.parcelas) for (const t of d.tributosFora) if (!tribFora.includes(t)) tribFora.push(t);
  const usouRef = { icms: false, iss: false };
  return {
    ...base,
    anexoId: base.anexoId,
    faixa: primeira?.faixa ?? base.faixa,
    aliquotaEfetiva: rec > 0 ? seg.das / rec : 0,
    aliquotaEfetivaCBS: aliqCBS,
    aliquotaEfetivaCBSFinal: aliqCBS,
    aliquotaISSBruta: rec > 0 ? seg.reparticaoBruta.ISS / rec : 0,
    aliquotaISSFinal: rec > 0 ? seg.reparticaoGuia.ISS / rec : 0,
    excedenteISS: round2(seg.parcelas.reduce((a, d) => a + d.excedenteISS, 0)),
    das: seg.das,
    dasGuia: seg.dasGuia,
    cargaTotal: seg.das,
    foraSublimite: { ...seg.foraSublimite },
    aliquotasFora: {
      icms: rec > 0 ? seg.foraSublimite.icms / rec : 0,
      iss: rec > 0 ? seg.foraSublimite.iss / rec : 0,
      ibs: rec > 0 ? seg.foraSublimite.ibs / rec : 0,
    },
    tributosFora: tribFora as ResultadoConvencional['tributosFora'],
    excedeSublimite: seg.excedeSublimite,
    usouReferencia: usouRef,
    cbsDentroDAS: seg.cbsDentroDAS,
    reparticao: { ...seg.reparticao },
    reparticaoGuia: { ...seg.reparticaoGuia },
    detalhes: { ...base.detalhes, receitaNaoExcedente: seg.receitaNaoExcedente, receitaExcedente: seg.receitaExcedente },
  };
}
