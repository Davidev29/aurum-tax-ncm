/**
 * Aurum AI — Projeção mãe × nova (Etapa 6 — integração ao chat).
 *
 * Cobre "dividir o faturamento em duas empresas?" / "vale a pena abrir uma
 * nova empresa?": coleta RBT12 + receita total + % nova + anexos e orquestra
 * o motor puro `simularCenarioDividido` (nunca recalcula DAS/faixa/Fator R).
 *
 * Padrão do projeto: como `aurum-ai-simples-exploratorio.ts` — este módulo
 * só orquestra e formata; todo número vem de `@/simples/calculo` via
 * `@/simples-projection/cenario-dividido`.
 */

import { simularCenarioDividido } from '@/simples-projection/cenario-dividido';
import type { AnexoSimplesId } from '@/simples/tabelas';
import { fmtMoeda } from '@/domain/services/format';
import { extrairSlotsSimples, extrairTodosValores } from '@/domain/services/valores-chat';
import { ehPedidoProjecaoDividida } from '@/domain/services/detector-chat';
import type { BotaoChat } from './aurum-ai-recursos';
import type { MensagemHistorico, PensamentoChat, RespostaChat } from './aurum-ai-chat';

function pensar(etapas: Array<string | false | null | undefined>, detalhe?: string, ms?: number): PensamentoChat {
  return { etapas: etapas.filter(Boolean) as string[], detalhe, ms };
}

const P_CALC = 'Calculando DAS…';

function normBaixo(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/* ------------------------------------------------- extração ----------- */

/**
 * Percentual destinado à nova empresa (0 < p < 1).
 * "30% na nova", "30% para a nova", "70/30", "meio a meio", "metade",
 * "50/50", "um terço na nova", "nova fica com 25%", "30% do faturamento
 * na nova". Puro e testável.
 */
export function extrairPercentualNova(texto: string): number | null {
  const t = String(texto ?? '');
  if (!t.trim()) return null;
  const n = normBaixo(t);
  // "meio a meio", "metade para cada", "50/50", "50% para cada".
  if (/meio a meio|metade (para|pra) cada|50\s*\/\s*50|50%\s*(para|pra) cada/.test(n)) return 0.5;
  // "metade do faturamento na nova" / "metade na nova".
  if (/metade[^.\n]{0,24}?\bna nova\b/.test(n)) return 0.5;
  // "um terço na nova" / "1/3 na nova" / "dois terços" / "2/3".
  if (/(um terco|1\s*\/\s*3)[^.\n]{0,24}?\bna nova\b/.test(n)) return Math.round((1 / 3) * 10000) / 10000;
  if (/(dois tercos|2\s*\/\s*3)[^.\n]{0,24}?\bna nova\b/.test(n)) return Math.round((2 / 3) * 10000) / 10000;
  // "70/30" (mãe/nova ou nova/mãe?): assume 1º = mãe quando há "mãe" perto,
  // senão o menor vai para a nova (convenção: nova é a fatia menor).
  const mBarra = n.match(/(\d{1,2}(?:[.,]\d+)?)\s*\/\s*(\d{1,2}(?:[.,]\d+)?)/);
  if (mBarra) {
    const a = Number(mBarra[1].replace(',', '.'));
    const b = Number(mBarra[2].replace(',', '.'));
    if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0 && Math.abs(a + b - 100) < 0.01) {
      const novaPct = /nova.*(fica|recebe)|para.*nova|na nova/.test(n)
        ? (n.indexOf('nova') < n.indexOf(mBarra[0]) ? a : b)
        : Math.min(a, b);
      void a;
      const p = novaPct / 100;
      if (p > 0 && p < 1) return Math.round(p * 10000) / 10000;
    }
  }
  // "30% na nova / para a nova / da nova".
  const mNova = n.match(/(\d{1,2}(?:[.,]\d+)?)\s*%\s*(na?|para|pra|da?)?\s*(nova|segunda|outra|filial|2a)/);
  if (mNova) {
    const v = Number(mNova[1].replace(',', '.'));
    if (Number.isFinite(v) && v > 0 && v < 100) return Math.round((v / 100) * 10000) / 10000;
  }
  // "30% do faturamento na nova" (objeto fiscal entre o % e a nova).
  const mNova3 = n.match(/(\d{1,2}(?:[.,]\d+)?)\s*%[^.\n]{0,32}?\bnova\b/);
  if (mNova3) {
    const v = Number(mNova3[1].replace(',', '.'));
    if (Number.isFinite(v) && v > 0 && v < 100) return Math.round((v / 100) * 10000) / 10000;
  }
  // "nova com 30%" / "nova fica com 30%".
  const mNova2 = n.match(/(nova|segunda|outra|filial).*?(\d{1,2}(?:[.,]\d+)?)\s*%/);
  if (mNova2) {
    const v = Number(mNova2[2].replace(',', '.'));
    if (Number.isFinite(v) && v > 0 && v < 100) return Math.round((v / 100) * 10000) / 10000;
  }
  return null;
}

/** Ordinais do Simples ("terceiro anexo" → III). */
const ORDINAIS_ANEXO: Record<string, AnexoSimplesId> = {
  primeiro: 'I', segundo: 'II', terceiro: 'III', quarto: 'IV', quinto: 'V',
};

/**
 * Lê UM anexo num trecho, com validação estrita (precision first):
 * - "anexo 3" / "anexo III" / "terceiro anexo" (ancorado — dígito solto vale);
 * - romano isolado ("mãe no III", "nova: V");
 * - dígito solto ("nova em 2 empresas") NUNCA vira anexo ("2 empresas" ≠ II).
 */
function lerAnexoTrecho(s: string): AnexoSimplesId | null {
  const mapa: Record<string, AnexoSimplesId> = {
    i: 'I', ii: 'II', iii: 'III', iv: 'IV', v: 'V',
    '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V',
  };
  let m = s.match(/(?:anexo|anx|anex)\s*(iv|iii|ii|i|v|[1-5]|primeiro|segundo|terceiro|quarto|quinto)/)
    ?? s.match(/(primeiro|segundo|terceiro|quarto|quinto)\s*(?:anexo|anx|anex)/);
  if (m) {
    const v = m[1].toLowerCase();
    return mapa[v] ?? ORDINAIS_ANEXO[v] ?? null;
  }
  m = s.match(/\b(iii|ii|iv|v)\b/);
  if (m) return mapa[m[1].toLowerCase()] ?? null;
  return null;
}

/** Anexos da mãe e da nova ("mãe no III e nova no V", "ambas no III"). */
export function extrairAnexosMaeNova(texto: string, anexoUnico: AnexoSimplesId | null): { mae: AnexoSimplesId | null; nova: AnexoSimplesId | null } {
  const t = normBaixo(String(texto ?? ' '));
  // "mãe no III ... nova no V" (duas menções ancoradas, qualquer ordem).
  const mMae = t.match(/mae\b[^.\n]{0,40}?(anexo[^.\n]{0,12}?|:\s*)?(iii|ii|iv|i|v|[1-5]|primeiro|segundo|terceiro|quarto|quinto)\b/);
  const mNova = t.match(/(nova|segunda|outra|filial)\b[^.\n]{0,40}?(anexo[^.\n]{0,12}?|:\s*)?(iii|ii|iv|i|v|[1-5]|primeiro|segundo|terceiro|quarto|quinto)\b/);
  if (mMae && mNova) {
    const mae = lerAnexoTrecho(mMae[0]);
    const nova = lerAnexoTrecho(mNova[0]);
    if (mae && nova) return { mae, nova };
  }
  // Ordem reversa: "III para a mãe, V para a nova".
  const mMaeRev = t.match(/\b(iii|ii|iv|v)\b\s*(para|pra|no|na|p\/)?\s*(a\s+)?mae\b/);
  const mNovaRev = t.match(/\b(iii|ii|iv|v)\b\s*(para|pra|no|na|p\/)?\s*(a\s+)?(nova|segunda|outra|filial)\b/);
  if (mMaeRev && mNovaRev) {
    const mae = lerAnexoTrecho(mMaeRev[0]);
    const nova = lerAnexoTrecho(mNovaRev[0]);
    if (mae && nova) return { mae, nova };
  }
  // "ambas/os dois no III", "as duas no V", "anexo 3 nas duas".
  const mAmbas = t.match(/(amba|nas duas|as duas|os dois|anexo (unico|igual))[^.\n]{0,24}?(anexo[^.\n]{0,12}?)?(iii|ii|iv|i|v|[1-5]|primeiro|segundo|terceiro|quarto|quinto)\b/);
  if (mAmbas) {
    const a = lerAnexoTrecho(mAmbas[0]);
    if (a) return { mae: a, nova: a };
  }
  // Fallback: um único anexo citado vale para as duas.
  if (anexoUnico) return { mae: anexoUnico, nova: anexoUnico };
  const avulso = lerAnexoTrecho(t);
  if (avulso) return { mae: avulso, nova: avulso };
  return { mae: null, nova: null };
}

/** Custo mensal da nova ("custo 5 mil da nova/mensal"). Opcional. */
export function extrairCustoNova(texto: string): number | null {
  const t = String(texto ?? '');
  if (!/custo|custo operacional|despesa.*nova|manter.*nova/i.test(t)) return null;
  const vals = extrairTodosValores(t);
  if (!vals.length) return null;
  // Heurística: o valor mais próximo da palavra "custo".
  const idx = t.toLowerCase().search(/custo/);
  let melhor = vals[0];
  let dist = Math.abs((vals[0]?.inicio ?? 0) - idx);
  for (const v of vals) {
    const d = Math.abs(v.inicio - idx);
    if (d < dist) { dist = d; melhor = v; }
  }
  return melhor ? melhor.valor : null;
}

function extrairMesInicio(texto: string): string | null {
  const m = String(texto ?? '').match(/20\d\d-(0[1-9]|1[0-2])/);
  return m ? m[0] : null;
}

function proximoMesRef(d = new Date()): string {
  const a = d.getFullYear();
  const m = d.getMonth() + 1; // 1-12
  let na = a;
  let nm = m + 1;
  if (nm > 12) { nm = 1; na += 1; }
  return `${na}-${String(nm).padStart(2, '0')}`;
}

function somarMeses(base: string, delta: number): string {
  const [a, m] = base.split('-').map(Number);
  const total = (a as number) * 12 + ((m as number) - 1) + delta;
  const na = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${na}-${String(nm).padStart(2, '0')}`;
}

/* ------------------------------------------------- estado ------------- */

export interface EstadoProjecao {
  rbt12: number | null;
  receitaMes: number | null;
  percentualNova: number | null;
  anexoMae: AnexoSimplesId | null;
  anexoNova: AnexoSimplesId | null;
  folhaMae: number | null;
  custoNova: number | null;
  mesInicio: string;
}

/**
 * Follow-up de projeção com histórico ("e com 50% na nova?" após abrir a
 * projeção). O detector puro só vê a frase atual (generico/simples); aqui o
 * contexto de projeção promove. Com histórico de projeção, qualquer slot do
 * domínio (RBT12/receita/%/anexo/folha/custo/mãe/nova) continua a projeção.
 * Guardas anti-roubo: código NCM/NBS, culinária, XML e boleto nunca promovem.
 * Puro e testável.
 */
export function ehFollowUpProjecao(pergunta: string, historicoUser: string[] = []): boolean {
  if (ehPedidoProjecaoDividida(pergunta)) return true;
  const n = normBaixo(String(pergunta ?? ' '));
  if (/\b\d{8,9}\b|\bncm\b|\bnbs\b|bolo\b|culinaria|\bxml\b|nota fiscal|boleto|segunda via/.test(n)) return false;
  if (!/%|na nova|nesta nova|mae\b|anexo|custo|fatia|meio a meio|\d+\s*\/\s*\d+|terco|metade|rbt|receita|faturamento|folha/.test(n)) return false;
  const hist = Array.isArray(historicoUser) ? historicoUser : [];
  return hist.some((t) => {
    try {
      return ehPedidoProjecaoDividida(t);
    } catch {
      return false;
    }
  });
}

/** Reconstrói o estado da projeção a partir da pergunta + falas do usuário. Puro. */
export function reconstruirEstadoProjecao(pergunta: string, historicoUser: string[]): EstadoProjecao {
  const combinado = [...(historicoUser ?? []), pergunta].join('\n');
  const slots = extrairSlotsSimples(combinado);
  const percentualNova = extrairPercentualNova(combinado);
  const anx = extrairAnexosMaeNova(combinado, slots.anexo);
  const custoNova = extrairCustoNova(combinado);
  const mesInicio = extrairMesInicio(combinado) ?? proximoMesRef();
  return {
    rbt12: slots.rbt12,
    receitaMes: slots.receitaMes,
    percentualNova,
    anexoMae: anx.mae,
    anexoNova: anx.nova,
    folhaMae: slots.folha12,
    custoNova,
    mesInicio,
  };
}

/* ------------------------------------------------- série ---------------- */

function serieMeses(mesInicio: string, n: number, valor: number): Array<{ mes: string; receita: number }> {
  const out: Array<{ mes: string; receita: number }> = [];
  for (let i = 0; i < n; i++) {
    out.push({ mes: somarMeses(mesInicio, i), receita: Math.round(valor * 100) / 100 });
  }
  return out;
}

/* ------------------------------------------------- textos --------------- */

const pct1 = (p: number): string => `${(p * 100).toFixed(1).replace('.', ',')}%`;

function textoFaltando(s: EstadoProjecao): string {
  const ent: string[] = [];
  if (s.rbt12 != null) ent.push(`RBT12 ${fmtMoeda(s.rbt12)}`);
  if (s.receitaMes != null) ent.push(`receita total ${fmtMoeda(s.receitaMes)}/mês`);
  if (s.percentualNova != null) ent.push(`${pct1(s.percentualNova)} na nova`);
  if (s.anexoMae != null && s.anexoMae === s.anexoNova) ent.push(`Anexo ${s.anexoMae} (ambas)`);
  else {
    if (s.anexoMae != null) ent.push(`mãe no ${s.anexoMae}`);
    if (s.anexoNova != null) ent.push(`nova no ${s.anexoNova}`);
  }
  const ctx = ent.length ? `\nJá entendi: ${ent.join(' · ')}.\n` : '';
  if (s.rbt12 == null) {
    return (
      `## Projeção mãe × nova — passo 1 de 4: RBT12\n${ctx}\n` +
      `Para comparar **tudo numa empresa** vs **dividir em duas**, preciso do **RBT12 atual** (faturamento dos últimos 12 meses, teto R$ 4,8 mi).\n\n` +
      `• Ex.: "RBT12 1,2 milhão" ou "faturamento 1,2 milhão nos últimos 12 meses"`
    );
  }
  if (s.receitaMes == null) {
    return (
      `## Projeção mãe × nova — passo 2 de 4: receita mensal total\n${ctx}\n` +
      `Agora a **receita total por mês** (a soma que será fatiada entre mãe e nova).\n\n` +
      `• Ex.: "receita 120 mil por mês" ou "faturamento 120 mil/mês"`
    );
  }
  if (s.percentualNova == null) {
    return (
      `## Projeção mãe × nova — passo 3 de 4: quanto vai para a nova?\n${ctx}\n` +
      `Qual **fatia vai para a nova empresa**?\n\n` +
      `• Ex.: "30% na nova", "meio a meio" ou "70/30"`
    );
  }
  return (
    `## Projeção mãe × nova — passo 4 de 4: anexos\n${ctx}\n` +
    `Quais os **anexos do Simples** de cada empresa?\n\n` +
    `• Ex.: "mãe no III e nova no III" ou "ambas no III"\n` +
    `• Folha 12m é opcional (refina o Fator R III × V): "folha 400 mil"`
  );
}

/* ------------------------------------------------- responder ------------ */

export function responderProjecaoDividida(
  pergunta: string,
  historico: MensagemHistorico[] = [],
): RespostaChat {
  const t0 = Date.now();
  const falasUser = historico.filter((m) => m.papel === 'user').map((m) => m.texto);
  const s = reconstruirEstadoProjecao(pergunta, falasUser);

  const faltas: string[] = [];
  if (!(s.rbt12 != null && s.rbt12 > 0)) faltas.push('o RBT12');
  if (!(s.receitaMes != null && s.receitaMes > 0)) faltas.push('a receita mensal total');
  if (!(s.percentualNova != null && s.percentualNova > 0 && s.percentualNova < 1)) faltas.push('o percentual da nova (ex.: "30% na nova")');
  if (s.anexoMae == null || s.anexoNova == null) faltas.push('os anexos (ex.: "mãe no III e nova no III")');

  if (faltas.length > 0) {
    const sug: string[] = [];
    if (s.rbt12 == null) sug.push('RBT12 1,2 milhão');
    else if (s.receitaMes == null) sug.push(`Receita ${(s.rbt12 as number) > 0 ? fmtMoeda(Math.round((s.rbt12 as number) / 12)) : '120 mil'}/mês`);
    else if (s.percentualNova == null) sug.push('30% na nova');
    else sug.push('Mãe no III e nova no III');
    return {
      texto:
        `${textoFaltando(s)}\n\n` +
        `Faltando: ${faltas.join(', ')}. Sem isso eu **não simulo com exemplo** — me diga os valores que rodo na hora.`,
      confianca: 0.9,
      nivel: 'alta',
      fontes: ['Tabela Simples Nacional — Anexos I–V + Reforma (CBS/IBS)', 'Motor simples-projection (RBT12 deslizante + DAS)'],
      sugestoes: sug,
      botoes: [
        ...(s.rbt12 == null
          ? [{ rotulo: 'Ex.: RBT12 1,2 milhão', acao: 'perguntar' as const, alvo: 'RBT12 1,2 milhão para a projeção mãe/nova' }]
          : s.receitaMes == null
            ? [{ rotulo: 'Ex.: receita 120 mil/mês', acao: 'perguntar' as const, alvo: `RBT12 ${s.rbt12} e receita 120 mil por mês na projeção` }]
            : s.percentualNova == null
              ? [{ rotulo: 'Ex.: 30% na nova', acao: 'perguntar' as const, alvo: `RBT12 ${s.rbt12}, receita ${s.receitaMes} por mês, 30% na nova` }]
              : [{ rotulo: 'Ex.: ambas no III', acao: 'perguntar' as const, alvo: `RBT12 ${s.rbt12}, receita ${s.receitaMes}, 30% na nova, mãe no III e nova no III` }]),
        { rotulo: 'Abrir Simples Nacional', acao: 'navegar', alvo: 'simples' },
      ],
      pensamento: pensar(['Entendendo…', 'Validando…'], `Projeção mãe/nova incompleta — faltando: ${faltas.join(', ')} (perguntar, não projetar)`, Date.now() - t0),
    };
  }

  // Série honesta a partir dos 2 números do usuário (sem inventar mensal real):
  // histórico da mãe = RBT12/12 por mês (12m retroativos); projeção = receita
  // total repetida por 12 meses a partir do mesInicio.
  const HORIZONTE = 12;
  const histValor = Math.round(((s.rbt12 as number) / 12) * 100) / 100;
  const historicoMae12 = serieMeses(somarMeses(s.mesInicio, -12), 12, histValor);
  // Ajuste de centavos: garante soma == RBT12.
  const somaHist = Math.round(historicoMae12.reduce((a, m) => a + m.receita, 0) * 100) / 100;
  const difHist = Math.round(((s.rbt12 as number) - somaHist) * 100) / 100;
  if (Math.abs(difHist) >= 0.01) {
    historicoMae12[historicoMae12.length - 1]!.receita = Math.round((historicoMae12[historicoMae12.length - 1]!.receita + difHist) * 100) / 100;
  }
  const receitaTotalMensal = serieMeses(s.mesInicio, HORIZONTE, s.receitaMes as number);

  let rel;
  try {
    rel = simularCenarioDividido({
      mesInicio: s.mesInicio,
      receitaTotalMensal,
      percentualNova: s.percentualNova as number,
      mae: { anexoId: s.anexoMae as AnexoSimplesId, folha12: s.folhaMae ?? 0, historico12: historicoMae12 },
      nova: { anexoId: s.anexoNova as AnexoSimplesId, folha12: 0, historico12: [] },
      custoMensalNova: s.custoNova ?? 0,
    });
  } catch (e) {
    return {
      texto: `Não consegui rodar a projeção (${e instanceof Error ? e.message : 'erro interno'}). Confira os valores — ex.: "RBT12 1,2 milhão, receita 120 mil/mês, 30% na nova, mãe no III e nova no III".`,
      confianca: 0.5,
      nivel: 'baixa',
      fontes: ['Motor simples-projection (RBT12 deslizante + DAS)'],
      botoes: [{ rotulo: 'Abrir Simples Nacional', acao: 'navegar', alvo: 'simples' }],
      pensamento: pensar(['Entendendo…', 'Validando…'], `Projeção: motor recusou input (${e instanceof Error ? e.message : e})`, Date.now() - t0),
    };
  }

  const p = s.percentualNova as number;
  const recNova = Math.round((s.receitaMes as number) * p * 100) / 100;
  const recMae = Math.round(((s.receitaMes as number) - recNova) * 100) / 100;
  const economiaTotal = rel.economiaTotal;
  const compensa = economiaTotal > 0;
  const mediaMes = Math.round((economiaTotal / rel.serieMensal.length) * 100) / 100;
  const veredito = compensa
    ? `**Compensa dividir** — economia de **${fmtMoeda(economiaTotal)}** em ${rel.serieMensal.length} meses (média ${fmtMoeda(mediaMes)}/mês).`
    : economiaTotal === 0
      ? `**Empate técnico** — dividir nem economiza nem encarece (${fmtMoeda(0)} em ${rel.serieMensal.length} meses).`
      : `**Não compensa dividir** — prejuízo de **${fmtMoeda(Math.abs(economiaTotal))}** em ${rel.serieMensal.length} meses (média ${fmtMoeda(Math.abs(mediaMes))}/mês a mais).`;

  const linhas = rel.serieMensal.map((l) => {
    const sinal = l.economiaMes > 0 ? '+' : l.economiaMes < 0 ? '−' : '';
    const eco = `${sinal}${fmtMoeda(Math.abs(l.economiaMes)).replace('R$ ', '')}`;
    return `• ${l.mes}: ref ${fmtMoeda(l.dasUnificadoReferencia)} × mãe ${fmtMoeda(l.dasMae)} + nova ${fmtMoeda(l.dasNova)} → mês ${eco} · acum. ${fmtMoeda(l.economiaAcumulada)}`;
  });
  // Chat legível: primeiros 3 + últimos 3 quando a série é longa.
  const tabela = rel.serieMensal.length > 7
    ? [...linhas.slice(0, 3), '• …', ...linhas.slice(-3)].join('\n')
    : linhas.join('\n');

  const paybackTxt = rel.payback.mes != null
    ? `Payback no mês **${rel.payback.mes}** (${rel.payback.mesesAtePayback}º mês, acumulado ${fmtMoeda(rel.payback.valorAcumuladoNoPayback ?? 0)}).`
    : `Sem payback no horizonte de ${rel.serieMensal.length} meses (acumulado segue negativo).`;

  const alertasTxt = rel.alertas.length
    ? rel.alertas.map((a) => `• ${a.mensagem}`).join('\n')
    : '• Sem alertas fiscais no horizonte.';

  const botoes: BotaoChat[] = [
    { rotulo: '🔀 Testar outro percentual', acao: 'perguntar', alvo: `E com ${p >= 0.5 ? '30%' : '50%'} na nova? (RBT12 ${s.rbt12}, receita ${s.receitaMes}, mãe no ${s.anexoMae} e nova no ${s.anexoNova})` },
    { rotulo: 'Abrir Simples Nacional', acao: 'navegar', alvo: 'simples' },
  ];

  return {
    texto:
      `## Projeção mãe × nova — veredito em 12 meses\n\n` +
      `${veredito}\n\n` +
      `---\n\n` +
      `## Seus números\n\n` +
      `• RBT12 ${fmtMoeda(s.rbt12 as number)} (média ${fmtMoeda(histValor)}/mês no histórico)\n` +
      `• Receita total ${fmtMoeda(s.receitaMes as number)}/mês → mãe ${fmtMoeda(recMae)} + nova ${fmtMoeda(recNova)} (${pct1(p)} na nova)\n` +
      `• Anexos: mãe **${s.anexoMae}** × nova **${s.anexoNova}**${s.folhaMae != null ? ` · folha mãe ${fmtMoeda(s.folhaMae)}` : ''}${(s.custoNova ?? 0) > 0 ? ` · custo nova ${fmtMoeda(s.custoNova as number)}/mês` : ''}\n` +
      `• Horizonte ${s.mesInicio} → ${rel.serieMensal[rel.serieMensal.length - 1]?.mes} (${rel.serieMensal.length} meses)\n\n` +
      `---\n\n` +
      `## Mês a mês (DAS)\n\n${tabela}\n\n${paybackTxt}\n\n` +
      `---\n\n` +
      `## Alertas fiscais\n\n${alertasTxt}\n\n` +
      `---\n\n` +
      `## Próximos passos\n\n` +
      `1. Teste outro fatiamento ("e com 50% na nova?")\n` +
      `2. Informe o custo mensal da nova ("custo 5 mil") para o payback líquido\n` +
      `3. Valide o grupo econômico com o contador (sublimite consolidado)\n\n` +
      `Simulação com histórico médio (RBT12/12) e receita repetida — informe a série real mês a mês para refinar.`,
    confianca: 0.9,
    nivel: 'alta',
    fontes: ['Tabela Simples Nacional — Anexos I–V + Reforma (CBS/IBS)', 'Motor simples-projection (RBT12 deslizante + DAS do motor oficial)'],
    sugestoes: ['E com 50% na nova?', 'Custo 5 mil da nova', 'O que é Fator R?'],
    botoes,
    pensamento: pensar(['Entendendo…', 'Validando…', P_CALC], `Projeção mãe/nova ${pct1(p)} · economia ${fmtMoeda(economiaTotal)}`, Date.now() - t0),
  };
}
