/**
 * Simples Nacional — extração PURA das variáveis derivadas de
 * `src/simples/page.tsx:415-577` (useMemo + consts) e da repartição
 * (`:744-746`) para fora do React.
 *
 * CONTRATO: as expressões abaixo são cópias literais do componente — mesma
 * fórmula, mesmo arredondamento, mesma ordem de operações, mesmos `??`.
 * Não houve refatoração matemática. A única diferença é que os `useMemo`
 * passam a ser cálculos diretos (a cena é reconstruída a cada chamada).
 *
 * Fora da cena (continuam no componente/hooks próprios):
 * - `reparticaoVisiveis`: depende da flag LOCAL `reparticaoAberta`; calcular no
 *   componente como `reparticaoAberta ? cena.reparticaoItens : cena.reparticaoItens.slice(0, 4)`.
 * - `relatorioAnalitico`/`insightsAnaliticos` (`:580-621`) e `payload()` (`:714-738`).
 */
import { calcularConvencional, calcularHibrido, fatorR, type ResultadoConvencional } from './calculo';
import {
  calcularSegregado,
  pseudoConvDoSegregado,
  somaParcelas,
  type ParcelaSegEntrada,
  type ResultadoSegregado,
} from './segregacao-receita';
import type { AnexoSimplesId } from './tabelas';
import {
  envolveAnexoV,
  etapa1Pronta,
  preverAnexoFatorR,
  refsForaDoAnexo,
  sublimiteEstourado,
} from './store';
import { montarDadosDas } from './DasModal';
import { fmtMoeda } from '@/domain/services/format';
import type { CenaSimples, SimplesState, StResumo } from './types';

/**
 * @param s estado completo da store (`useSimples()` no componente).
 * @param gerando flag LOCAL do componente (`const [gerando, setGerando] = useState(false)`)
 *                que entra em `podeVisualizar`. Default `false` preserva a
 *                assinatura de um argumento e o comportamento em repouso.
 */
export function montarCenaSimples(s: SimplesState, gerando = false): CenaSimples {
  const pronta1 = etapa1Pronta(s);
  /** Passo 1 concluído: RBT12 + receita do mês informados (antes do anexo). */
  const valoresOk = s.rbt12 > 0 && s.receitaMes > 0;
  /** Sublimite estadual detectado já no passo 1 (automático: RBT12 > R$ 3,6M). */
  const estouradoPasso1 = sublimiteEstourado(s);
  const comFolha = envolveAnexoV(s);
  // Folha também quando a segregação envolve o Anexo V (Fator R só se
  // calcula sobre o V — III puro já é III, sem decisão).
  const segTemFatorR = s.segAtivo && s.segParcelas.some((p) => p.anexoId === 'V');
  const precisaFolha = comFolha || segTemFatorR;
  const previsaoFR = precisaFolha ? preverAnexoFatorR(s.rbt12, s.folha12) : null;
  // Segregação de receita: cada desmembramento usa a RBT12 TOTAL na sua
  // tabela; checkbox ST por parcela deduz o ICMS/ISS daquela parcela.
  // Segregação PARCIAL: o que não for segregado vira "restante" calculado
  // normalmente no anexo efetivo (bruto). Só barra se a soma ULTRAPASSAR.
  const segSoma = somaParcelas(s.segParcelas.map((p) => ({ valor: p.valor })));
  const segExcesso = s.segAtivo && segSoma > s.receitaMes + 0.01;
  const segValida = !s.segAtivo || (s.segParcelas.filter((p) => p.valor > 0).length > 0 && !segExcesso);
  const segRestoAnexo = s.convencional?.anexoId ?? s.anexoId;
  const segResto = s.segAtivo ? Math.round((s.receitaMes - segSoma) * 100) / 100 : 0;
  let segResultado: ResultadoSegregado | null = null;
  {
    if (s.segAtivo && s.convencional) {
      const validas = s.segParcelas.filter((p) => p.valor > 0);
      if (validas.length > 0 && !(segSoma > s.receitaMes + 0.01)) {
        const parcelas: ParcelaSegEntrada[] = validas.map((p) => ({ anexoId: p.anexoId, receitaMes: p.valor, st: p.st }));
        const resto = Math.round((s.receitaMes - segSoma) * 100) / 100;
        if (resto > 0) parcelas.push({ anexoId: segRestoAnexo, receitaMes: resto, st: false, resto: true, escolhido: s.anexoId });
        try {
          // Folha compartilhada: vale p/ todas as parcelas (Fator R no V).
          segResultado = calcularSegregado(s.rbt12, parcelas, s.rbt12, s.folha12, {
            aliqRefICMS: s.aliqRefICMS,
            aliqRefISS: s.aliqRefISS,
          });
        } catch {
          segResultado = null;
        }
      }
    }
  }
  // Base de exibição: segregado (pseudo-conv) ou convencional único.
  // A ST já vem deduzida por parcela dentro do segregado — sem ajuste global.
  const convBase = segResultado && s.convencional ? pseudoConvDoSegregado(segResultado, s.convencional) : s.convencional;
  // Bruto normal (sem segregar) × final (segregado): a diferença é a economia.
  // Com excesso de sublimite a exibição é a GUIA (sem ICMS/ISS/IBS fora);
  // a carga total (guia + fora) aparece em bloco próprio.
  const convExib = convBase;
  const dasExib = convBase?.dasGuia ?? convBase?.das ?? 0;
  const cargaTotalExib = convBase?.cargaTotal ?? convBase?.das ?? 0;
  const repExib = convBase?.reparticaoGuia ?? convBase?.reparticao;
  const dasBruto = s.convencional?.dasGuia ?? s.convencional?.das ?? 0;
  /** Dedução ST por tributo (p/ riscado). Chave ausente = sem ST naquele tributo. */
  const deducaoSTPorTributo: Partial<Record<'ICMS' | 'ISS', number>> = {};
  if (segResultado?.temST) {
    for (const d of segResultado.parcelas) {
      if (d.st && d.tributoST && d.deducaoST > 0) {
        deducaoSTPorTributo[d.tributoST] = Math.round(((deducaoSTPorTributo[d.tributoST] ?? 0) + d.deducaoST) * 100) / 100;
      }
    }
  }
  /** Detalhe ST por tributo p/ tooltip: quais parcelas deduziram. */
  const infoSTPorTributo: Partial<Record<'ICMS' | 'ISS', string>> = {};
  if (segResultado?.temST) {
    for (const t of segResultado.tributosST) {
      infoSTPorTributo[t] = segResultado.parcelas
        .filter((d) => d.st && d.tributoST === t && d.deducaoST > 0)
        .map((d) => `${d.resto ? 'restante · ' : ''}Anexo ${d.escolhido}${d.anexoCalculado !== d.escolhido ? `→${d.anexoCalculado}` : ''} (${fmtMoeda(d.receitaMes)})`)
        .join(' + ');
    }
  }
  const repBrutaExib = segResultado?.temST ? segResultado.reparticaoBrutaGuia : convBase?.reparticaoGuia;
  /** Resumo ST p/ guia/exports/legendas (null sem ST com dedução). */
  let stResumo: StResumo | null = null;
  if (segResultado?.temST) {
    const valorST = Math.round(segResultado.parcelas.filter((d) => d.st).reduce((a, d) => a + d.receitaMes, 0) * 100) / 100;
    const detalhe = segResultado.stDetalhe
      .map((d) => `ST ${d.tributo} s/ ${fmtMoeda(d.valorST)} (−${fmtMoeda(d.deducao)})`)
      .join(' + ');
    stResumo = { tributo: segResultado.tributosST.join('+'), valorST, deducao: segResultado.deducaoST, detalhe };
  }
  /** Híbrido coerente com o exibido: com seg ativa, reaplica a fórmula sobre
      os totais segregados (mesmos débitos/créditos CBS); sem seg, é o da store. */
  const hibExib = s.compararHibrido && s.hibrido && convExib
    ? calcularHibrido({ convencional: convExib, debitosCBS: s.debitosCBS, creditosCBS: s.creditosCBS })
    : null;
  const dadosDas = convExib
    ? montarDadosDas(convExib, {
        modo: s.modo,
        empresaNome: s.empresaNome,
        cnpj: s.cnpj,
        cnae: s.cnaeEscolhido,
        rbt12: s.rbt12,
        receitaMes: s.receitaMes,
        st: stResumo ?? undefined,
        seg: segResultado
          ? {
              anexos: segResultado.anexos,
              temResto: segResultado.parcelas.some((d) => d.resto),
              redir: [...new Set(segResultado.parcelas.filter((d) => d.anexoCalculado !== d.escolhido).map((d) => `${d.escolhido}→${d.anexoCalculado}`))],
            }
          : undefined,
      })
    : null;
  const fr = precisaFolha && s.rbt12 > 0 && s.folha12 > 0 ? fatorR(s.folha12, s.rbt12) : null;
  /**
   * Anexos efetivos do cálculo (p/ saber quais referências fora da guia
   * mostrar): com segregação, a união das parcelas; sem, o anexo efetivo
   * (Fator R já aplicado quando houver folha).
   */
  const anexosEfetivosRefs: AnexoSimplesId[] = (() => {
    if (s.segAtivo) {
      const validas = s.segParcelas.filter((p) => p.valor > 0);
      if (validas.length > 0) {
        const out: AnexoSimplesId[] = [];
        for (const p of validas) {
          const eff = p.anexoId === 'V' && s.rbt12 > 0 && s.folha12 > 0 && precisaFolha
            ? preverAnexoFatorR(s.rbt12, s.folha12).anexo
            : p.anexoId;
          if (!out.includes(eff)) out.push(eff);
        }
        return out;
      }
    }
    if (precisaFolha && s.folha12 > 0 && s.rbt12 > 0) return [preverAnexoFatorR(s.rbt12, s.folha12).anexo];
    return [s.anexoId];
  })();
  const mostraRefICMS = estouradoPasso1 && anexosEfetivosRefs.some((a) => refsForaDoAnexo(a).includes('ICMS'));
  const mostraRefISS = estouradoPasso1 && anexosEfetivosRefs.some((a) => refsForaDoAnexo(a).includes('ISS'));
  /** Prévia do convencional (só p/ exibir as alíquotas automáticas do fora). */
  let previaConv: ResultadoConvencional | null = null;
  if (s.rbt12 > 0 && s.receitaMes > 0 && estouradoPasso1) {
    try {
      const anexoEff = anexosEfetivosRefs[0] ?? s.anexoId;
      previaConv = calcularConvencional({
        anexoId: anexoEff,
        rbt12: s.rbt12,
        receitaMes: s.receitaMes,
        rba: s.rbt12,
      });
    } catch {
      previaConv = null;
    }
  }
  const podeVisualizar = pronta1 && s.rbt12 > 0 && s.receitaMes > 0 && segValida && !gerando;
  const mostrando = s.relatorioVisivel && s.convencional;

  const reparticao = repExib;
  const reparticaoItens = reparticao
    ? (['IRPJ', 'CSLL', 'CBS', 'IBS', 'CPP', 'ICMS', 'IPI', 'ISS'] as const).filter((t) =>
        ((deducaoSTPorTributo[t as 'ICMS' | 'ISS'] ?? 0) > 0 ? (repBrutaExib?.[t] ?? 0) > 0 : (reparticao[t] ?? 0) > 0),
      )
    : [];
  // `reparticaoVisiveis = reparticaoAberta ? reparticaoItens : reparticaoItens.slice(0, 4)`
  // permanece no componente: depende da flag local `reparticaoAberta`.

  return {
    pronta1,
    valoresOk,
    estouradoPasso1,
    comFolha,
    segTemFatorR,
    precisaFolha,
    previsaoFR,
    segSoma,
    segExcesso,
    segValida,
    segRestoAnexo,
    segResto,
    segResultado,
    convBase,
    convExib,
    dasExib,
    cargaTotalExib,
    repExib,
    dasBruto,
    deducaoSTPorTributo,
    infoSTPorTributo,
    repBrutaExib,
    stResumo,
    hibExib,
    dadosDas,
    fr,
    anexosEfetivosRefs,
    mostraRefICMS,
    mostraRefISS,
    previaConv,
    podeVisualizar,
    mostrando,
    reparticao,
    reparticaoItens,
  };
}
