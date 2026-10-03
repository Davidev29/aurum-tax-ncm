/**
 * IA Insights — modo READ-ONLY estrito.
 *
 * A IA NUNCA recalcula, soma, aplica alíquota ou deriva valores.
 * Este módulo:
 * 1. gera textos a partir de template determinístico (fallback garantido);
 * 2. valida qualquer lote de insights (de LLM futuro ou fallback) contra o
 *    JSON canônico — rejeita insight com número inventado.
 *
 * Integração futura com LLM: chamar `montarPrompt(report)` fora deste
 * módulo, receber `{insights}` em JSON-mode e passar por `validarInsights`.
 */
import {
  coletarNumerosPermitidos,
  type ReportAnalitico,
  type ScenarioId,
} from './relatorio-analitico';

export type NivelInsight = 'OPORTUNIDADE' | 'ALERTA' | 'INFO';

export interface AiInsight {
  insightId: string;
  titulo: string;
  texto: string;
  nivel: NivelInsight;
  cenariosRef: ScenarioId[];
  valoresCitados: number[];
}

export const GLOSSARIO_IA = [
  'Simples Nacional: Brazilian simplified tax regime for micro and small businesses.',
  'Anexo III: services taxed mainly on payroll ratio (Fator r >= 28%).',
  'Anexo V: services taxed at higher rates when payroll criteria are not met (Fator r < 28%).',
  'Fator r (Payroll Ratio): Folha12 / RBT12. Threshold = 28% (0.28).',
  'Regime Convencional: DAS with CBS inside (LC 123/2006 Art. 18).',
  'Regime Híbrido: reduced DAS (without CBS) + CBS assessed outside (LC 214/2025 Arts. 28-45).',
  'Pró-labore: owner compensation counted in payroll (Folha12).',
  'Alíquota Efetiva: (RBT12 x nominal − deduction) / RBT12, not the nominal rate.',
  'DAS: unified payment slip (Documento de Arrecadação do Simples Nacional).',
].join('\n');

export const SYSTEM_PROMPT_IA = [
  'Você é consultor tributário executivo. MODO LEITURA (READ-ONLY).',
  'Use APENAS números do JSON canônico fornecido. Não calcule, não estime,',
  'não arredonde diferente, não converta. Se faltar um dado, diga "dado não fornecido".',
  'Cada insight deve citar o scenario_id (ex. III_CONV) e listar em valores_citados',
  'EXATAMENTE os números citados no texto. Máximo 5 insights, pt-BR executivo,',
  '2ª pessoa, sem juridiquês. Ordem: veredito menor carga → Fator r/gap →',
  'híbrido vs convencional → próximos passos.',
  'Glossário:',
  GLOSSARIO_IA,
].join('\n');

const brl = (v: number): string =>
  (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const pct2 = (v: number): string => `${(Number(v) || 0).toFixed(2).replace('.', ',')}%`;

function cenario(report: ReportAnalitico, id: ScenarioId) {
  return report.cenarios.find((c) => c.scenarioId === id);
}

/**
 * Fallback determinístico — NÃO calcula nada novo: apenas formata números
 * que já existem no `report`. É a saída padrão (e o teto do que um LLM
 * poderá dizer após validação).
 *
 * Textos instrutivos com espaçamento correto entre palavras e variáveis
 * (`R$ X`, `Y%`, nomes de cenários por extenso). Dois ramos:
 * - COM matriz (CNPJ dual III/V): veredito III×V, Fator r, híbrido, ação.
 * - SEM matriz: duelo Conv × Hib do anexo em foco, memória do híbrido, ação.
 */
export function gerarInsightsFallback(report: ReportAnalitico): AiInsight[] {
  if (!report.contexto.mostrarMatrizIIIV) return gerarInsightsFoco(report);
  return gerarInsightsMatriz(report);
}

function gerarInsightsMatriz(report: ReportAnalitico): AiInsight[] {
  const iiiC = cenario(report, 'III_CONV');
  const vC = cenario(report, 'V_CONV');
  const iiiH = cenario(report, 'III_HIB');
  const vH = cenario(report, 'V_HIB');
  if (!iiiC || !vC || !iiiH || !vH) return [];

  const out: AiInsight[] = [];
  const menor = report.comparativo.menorCargaScenarioId;
  const menorC = menor ? cenario(report, menor) : null;

  // 1 — veredito menor carga (somente leitura do comparativo).
  if (menorC) {
    out.push({
      insightId: 'ins_veredito',
      titulo: 'Veredito: menor desembolso do mês',
      texto: `O menor desembolso neste mês é ${rotuloCenario(menorC.scenarioId)} (${brl(menorC.totalPagar)}). ` +
        `No regime convencional, o Anexo III (${brl(iiiC.totalPagar)}) fica ${brl(vC.totalPagar - iiiC.totalPagar)} abaixo do Anexo V (${brl(vC.totalPagar)}), porque a alíquota efetiva do Anexo III é menor para esta faixa de receita.`,
      nivel: 'OPORTUNIDADE',
      cenariosRef: [menorC.scenarioId, 'III_CONV', 'V_CONV'],
      valoresCitados: [menorC.totalPagar, iiiC.totalPagar, roundTol(vC.totalPagar - iiiC.totalPagar), vC.totalPagar],
    });
  }

  // 2 — Fator r / gap (números já resolvidos pelo motor).
  if (report.fatorR.dadosSuficientes) {
    const f = report.fatorR;
    out.push({
      insightId: 'ins_fator_r',
      titulo: f.enquadrado ? 'Fator r enquadrado no Anexo III' : 'Fator r abaixo de 28%: gap de folha',
      texto: f.enquadrado
        ? `Seu Fator r é ${pct2(f.valor * 100)} (limite de 28%), o que sustenta o Anexo III. Monitore a folha todo mês: se o índice cair abaixo de 28%, a tributação volta para o Anexo V, mais caro.`
        : `Seu Fator r é ${pct2(f.valor * 100)}. Faltam ${brl(f.gapFolha)} na folha dos últimos 12 meses (cerca de ${brl(f.gapMensalProlabore)} por mês de pró-labore) para alcançar os 28% e sustentar o Anexo III. Com a migração do Anexo V para o III, a alíquota efetiva cai de ${pct2(vC.aliquotaEfetiva * 100)} para ${pct2(iiiC.aliquotaEfetiva * 100)} no regime convencional.`,
      nivel: f.enquadrado ? 'INFO' : 'ALERTA',
      cenariosRef: ['III_CONV', 'V_CONV'],
      valoresCitados: f.enquadrado
        ? [roundTol(f.valor * 100), 28]
        : [roundTol(f.valor * 100), f.gapFolha, f.gapMensalProlabore, roundTol(vC.aliquotaEfetiva * 100), roundTol(iiiC.aliquotaEfetiva * 100)],
    });
  }

  // 3 — híbrido vs convencional.
  out.push({
    insightId: 'ins_hibrido',
    titulo: 'Convencional × Híbrido neste perfil',
    texto: `No regime híbrido, o total é ${brl(iiiH.totalPagar)} no Anexo III e ${brl(vH.totalPagar)} no Anexo V, pois a CBS passa a ser apurada por fora: débitos de ${brl(iiiH.debitosCbs ?? 0)} menos créditos de ${brl(iiiH.creditosCbs ?? 0)} sobre as despesas. ` +
      (iiiC.totalPagar <= iiiH.totalPagar
        ? `Neste perfil, o convencional (${brl(iiiC.totalPagar)} no Anexo III) é mais vantajoso que o híbrido, porque os créditos são pequenos diante da CBS que já vem dentro da guia.`
        : `Neste perfil, o híbrido (${brl(iiiH.totalPagar)} no Anexo III) supera o convencional (${brl(iiiC.totalPagar)}), porque os créditos abatem bastante a CBS apurada por fora.`),
    nivel: 'INFO',
    cenariosRef: ['III_CONV', 'III_HIB', 'V_HIB'],
    valoresCitados: [iiiH.totalPagar, vH.totalPagar, iiiH.debitosCbs ?? 0, iiiH.creditosCbs ?? 0, iiiC.totalPagar],
  });

  // 4 — próximos passos (sem números novos além dos já citados).
  out.push({
    insightId: 'ins_acao',
    titulo: 'Próximo passo prático',
    texto: `Valide com seu contador o ajuste de pró-labore de ${brl(report.fatorR.gapMensalProlabore)} por mês (quando houver gap) e rode uma nova simulação antes de alterar a folha. Acompanhe o Fator r todo mês: ele decide entre o Anexo III e o Anexo V.`,
    nivel: 'OPORTUNIDADE',
    cenariosRef: ['III_CONV', 'V_CONV'],
    valoresCitados: [report.fatorR.gapMensalProlabore],
  });

  const { filtrados } = validarInsights(report, out);
  return filtrados;
}

/**
 * Ramo sem matriz: um único anexo em foco, duelo Convencional × Híbrido.
 * Explica vantagem/desvantagem com base nos números do duelo e da memória
 * do híbrido (débitos, créditos por despesa, CBS dentro do DAS).
 */
function gerarInsightsFoco(report: ReportAnalitico): AiInsight[] {
  const d = report.dueloFoco;
  const mem = report.memoriaHibrido[d.anexo];
  if (!mem) return [];
  const convId = d.convId;
  const hibId = d.hibId;
  const out: AiInsight[] = [];
  const economia = Math.abs(d.deltaRs);

  if (d.vencedor === 'CONV') {
    out.push({
      insightId: 'ins_veredito',
      titulo: `Vantagem do convencional no Anexo ${d.anexo}`,
      texto: `O regime convencional é o mais vantajoso para o Anexo ${d.anexo} neste mês: ${brl(d.convTotal)} contra ${brl(d.hibTotal)} no híbrido, uma economia de ${brl(economia)}. Isso acontece porque os créditos de CBS das suas despesas somam apenas ${brl(mem.creditosCbs)}, enquanto a CBS embutida no DAS convencional é de ${brl(mem.cbsDentroDas)}. Como o crédito é menor do que o imposto que já vem dentro da guia, tirar a CBS da guia e apurar por fora deixa a conta mais cara.`,
      nivel: 'OPORTUNIDADE',
      cenariosRef: [convId, hibId],
      valoresCitados: [d.convTotal, d.hibTotal, economia, mem.creditosCbs, mem.cbsDentroDas],
    });
  } else if (d.vencedor === 'HIB') {
    out.push({
      insightId: 'ins_veredito',
      titulo: `Vantagem do híbrido no Anexo ${d.anexo}`,
      texto: `O regime híbrido é o mais vantajoso para o Anexo ${d.anexo} neste mês: ${brl(d.hibTotal)} contra ${brl(d.convTotal)} no convencional, uma economia de ${brl(economia)}. Isso acontece porque os créditos de CBS das suas despesas somam ${brl(mem.creditosCbs)} e abatem os débitos de ${brl(mem.debitosCbs)}, de modo que a CBS a recolher por fora fica em apenas ${brl(mem.cbsARecolher)}. Somando o DAS reduzido de ${brl(mem.dasReduzido)} com essa CBS, o total fica abaixo da guia cheia.`,
      nivel: 'OPORTUNIDADE',
      cenariosRef: [convId, hibId],
      valoresCitados: [d.hibTotal, d.convTotal, economia, mem.creditosCbs, mem.debitosCbs, mem.cbsARecolher, mem.dasReduzido],
    });
  } else {
    out.push({
      insightId: 'ins_veredito',
      titulo: `Empate técnico no Anexo ${d.anexo}`,
      texto: `Os dois regimes empatam para o Anexo ${d.anexo} neste mês: ${brl(d.convTotal)} no convencional e ${brl(d.hibTotal)} no híbrido. Nesse caso, prefira o convencional pela simplicidade da guia única, salvo se você projeta aumento de despesas com crédito, o que penderia a balança para o híbrido.`,
      nivel: 'INFO',
      cenariosRef: [convId, hibId],
      valoresCitados: [d.convTotal, d.hibTotal],
    });
  }

  out.push({
    insightId: 'ins_memoria',
    titulo: 'Como o híbrido foi calculado',
    texto: `Partimos do DAS de ${brl(mem.dasTotal)} e subtraímos a CBS de ${brl(mem.cbsDentroDas)} que vem dentro dele, chegando ao DAS reduzido de ${brl(mem.dasReduzido)}. Em paralelo, apuramos débitos de CBS de ${brl(mem.debitosCbs)} sobre a receita e créditos de ${brl(mem.creditosCbs)} sobre as despesas, resultando em CBS a recolher de ${brl(mem.cbsARecolher)}. O total híbrido é ${brl(mem.dasReduzido)} mais ${brl(mem.cbsARecolher)}, ou seja, ${brl(mem.totalHibrido)}.`,
    nivel: 'INFO',
    cenariosRef: [convId, hibId],
    valoresCitados: [mem.dasTotal, mem.cbsDentroDas, mem.dasReduzido, mem.debitosCbs, mem.creditosCbs, mem.cbsARecolher, mem.totalHibrido],
  });

  out.push({
    insightId: 'ins_acao',
    titulo: 'Próximo passo prático',
    texto: `Leve estes dois totais ao seu contador (${brl(d.convTotal)} no convencional e ${brl(d.hibTotal)} no híbrido) e confirme o enquadramento do CNAE no Anexo ${d.anexo}. Se as despesas com direito a crédito aumentarem, rode a simulação de novo: cada real de crédito novo abate diretamente a CBS do híbrido.`,
    nivel: 'OPORTUNIDADE',
    cenariosRef: [convId, hibId],
    valoresCitados: [d.convTotal, d.hibTotal],
  });

  const { filtrados } = validarInsights(report, out);
  return filtrados;
}

function roundTol(v: number): number {
  return Math.round((Number(v) || 0) * 100) / 100;
}

function rotuloCenario(id: ScenarioId): string {
  switch (id) {
    case 'III_CONV': return 'o Anexo III no regime convencional';
    case 'V_CONV': return 'o Anexo V no regime convencional';
    case 'III_HIB': return 'o Anexo III no regime híbrido';
    case 'V_HIB': return 'o Anexo V no regime híbrido';
    case 'I_CONV': return 'o Anexo I no regime convencional';
    case 'I_HIB': return 'o Anexo I no regime híbrido';
    case 'II_CONV': return 'o Anexo II no regime convencional';
    case 'II_HIB': return 'o Anexo II no regime híbrido';
    case 'IV_CONV': return 'o Anexo IV no regime convencional';
    default: return 'o Anexo IV no regime híbrido';
  }
}

/** Extrai valores monetários e percentuais citados no texto (pt-BR). */
export function extrairNumerosDoTexto(texto: string): number[] {
  const out: number[] = [];
  const rxBrl = /R\$\s?([\d.]+,\d{2})/g;
  const rxPct = /(\d[\d.]*,\d+)\s?%/g;
  let m: RegExpExecArray | null;
  while ((m = rxBrl.exec(texto)) !== null) {
    const n = Number(m[1].replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(n)) out.push(Math.round(n * 100) / 100);
  }
  while ((m = rxPct.exec(texto)) !== null) {
    const n = Number(m[1].replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(n)) out.push(Math.round(n * 100) / 100);
  }
  return out;
}

export interface ResultadoValidacao {
  ok: boolean;
  filtrados: AiInsight[];
  erros: string[];
}

function numeroPermitido(n: number, permitidos: number[], tol = 0.011): boolean {
  return permitidos.some((p) => Math.abs(p - n) <= tol);
}

/**
 * Validador anti-alucinação: um insight só passa se TODOS os números em
 * `valoresCitados` e no `texto` existirem no report (tolerância de centavo).
 * Rejeita padrões de cálculo (`=` com R$, `× R$`) como sinal de recálculo.
 */
export function validarInsights(report: ReportAnalitico, insights: AiInsight[]): ResultadoValidacao {
  const permitidos = coletarNumerosPermitidos(report);
  const idsCenarios = new Set(report.cenarios.map((c) => c.scenarioId));
  const erros: string[] = [];
  const filtrados: AiInsight[] = [];

  if (!Array.isArray(insights) || insights.length === 0) {
    return { ok: false, filtrados: [], erros: ['lote de insights vazio'] };
  }

  for (const ins of insights.slice(0, 5)) {
    const problemas: string[] = [];
    if (!ins.titulo || ins.titulo.length > 90) problemas.push('titulo inválido');
    if (!ins.texto || ins.texto.length > 600) problemas.push('texto inválido');
    for (const ref of ins.cenariosRef ?? []) {
      if (!idsCenarios.has(ref)) problemas.push(`cenario_ref desconhecido: ${ref}`);
    }
    for (const v of ins.valoresCitados ?? []) {
      if (!numeroPermitido(Number(v), permitidos)) problemas.push(`valor inventado em valores_citados: ${v}`);
    }
    for (const n of extrairNumerosDoTexto(ins.texto ?? '')) {
      if (!numeroPermitido(n, permitidos)) problemas.push(`valor inventado no texto: ${n}`);
    }
    if (/=\s*R\$|×\s*R\$|x\s*R\$|\+ R\$|R\$\s?[\d.,]+\s?(\+|-|×|x|\*|\/)/.test(ins.texto ?? '')) {
      problemas.push('padrão de cálculo detectado no texto (IA não calcula)');
    }
    if (problemas.length === 0) filtrados.push(ins);
    else erros.push(`${ins.insightId || '?'}: ${problemas.join('; ')}`);
  }

  return { ok: filtrados.length > 0 && erros.length === 0, filtrados, erros };
}

/** Prompt pronto para um LLM futuro (JSON-mode). O retorno DEVE passar por `validarInsights`. */
export function montarPrompt(report: ReportAnalitico): string {
  const cenarios = report.cenarios.map((c) => ({
    scenario_id: c.scenarioId,
    anexo: c.anexo,
    regime: c.regime,
    faixa: c.faixa,
    aliquota_efetiva: c.aliquotaEfetiva,
    total_pagar: c.totalPagar,
    das_total: c.dasTotal,
    cbs_dentro_das: c.cbsDentroDas,
    das_reduzido: c.dasReduzidoSemCbs,
    cbs_a_recolher: c.cbsARecolher,
  }));
  return [
    SYSTEM_PROMPT_IA,
    '',
    'JSON canônico (única fonte de números):',
    JSON.stringify({
      fator_r: report.fatorR,
      cenarios,
      menor_carga: report.comparativo.menorCargaScenarioId,
      deltas: report.comparativo.matrizDeltas,
    }),
    '',
    'Responda SOMENTE com {"insights": [...]} no schema combinado.',
  ].join('\n');
}
