/**
 * Aurum AI — Simples exploratório sem empresa (puro, sem I/O).
 *
 * Cobre o caso "não tenho empresa, quanto pagaria no Simples?":
 * - matriz em TODOS os anexos (I–V) com os mesmos RBT12/receita (convencional);
 * - duelo Convencional × Híbrido por anexo com despesas/créditos;
 * - coletor proativo STEP-BY-STEP (RBT12 → receita → folha → despesas);
 * - despesas de referência editáveis + novas despesas;
 * - textos elegantes (markdown-lite do chat), insights read-only e
 *   builders de relatório customizado (CSV/JSON/TXT).
 *
 * Determinismo (P1): todo número vem de `simples/calculo.ts`. Este módulo
 * só orquestra e formata — nunca recalcula por fora do motor.
 */
import {
  calcularConvencional,
  calcularHibrido,
  debitoCBS,
  type RegraCreditoCBS,
  type RegraDebitoCBS,
} from '@/simples/calculo';
import { ANEXOS_SIMPLES, CBS_REF_PADRAO, type AnexoSimplesId } from '@/simples/tabelas';
import { fmtMoeda } from '@/domain/services/format';
import { extrairSlotsSimples, extrairTodosValores } from '@/domain/services/valores-chat';
import {
  extrairPercentualRobusto,
  regraCreditoDePercentual,
  regraDebitoDePercentual,
  temRegraIntegral,
  temVedacaoCredito,
} from '@/domain/services/percentual-chat';
import { casaToken, expandirSinonimoFiscal } from '@/domain/services/vocabulario';

export interface DespesaChat {
  rotulo: string;
  valor: number;
  regra: RegraCreditoCBS;
  /** v9 — `true` quando a regra veio explícita do texto ("com redução de 30%"). */
  regraExplicita?: boolean;
}

export interface EntradaExploratoria {
  rbt12: number;
  receitaMes: number;
  folha12: number | null;
  cbsRef: number;
  despesas: DespesaChat[];
}

export interface LinhaAnexoExploratorio {
  anexo: AnexoSimplesId;
  nome: string;
  faixa: number;
  aliquotaEfetiva: number;
  das: number;
  cbsDentroDAS: number;
  dasReduzido: number;
  debitosCbs: number;
  creditosCbs: number;
  cbsFora: number;
  totalHibrido: number;
  vencedorRegime: 'CONV' | 'HIB' | 'EMPATE';
  economiaConvHib: number;
  reparticao: Record<string, number>;
}

export interface ResultadoExploratorio {
  linhas: LinhaAnexoExploratorio[];
  vencedorConvId: AnexoSimplesId;
  vencedorConvValor: number;
  vencedorGeralId: AnexoSimplesId;
  vencedorGeralRegime: 'CONV' | 'HIB';
  vencedorGeralValor: number;
  debitosCbs: number;
  creditosCbs: number;
  fatorR: { indice: number; anexo: 'III' | 'V'; temFolha: boolean } | null;
}

/* ------------------------------------------------- referência ---------- */

export interface DespesaReferencia extends DespesaChat {
  dica: string;
}

export const DESPESAS_REFERENCIA: DespesaReferencia[] = [
  { rotulo: 'Aluguel', valor: 1500, regra: 'integral', dica: '30% da alíquota (redução 70%)' },
  { rotulo: 'Energia elétrica', valor: 300, regra: 'integral', dica: 'crédito integral' },
  { rotulo: 'Telefone / Internet', valor: 150, regra: 'integral', dica: 'crédito integral' },
  { rotulo: 'Água / Saneamento', valor: 50, regra: 'integral', dica: 'crédito integral' },
  { rotulo: 'Material de escritório', valor: 300, regra: 'integral', dica: 'crédito integral' },
];

export const CBS_REFERENCIA_PADRAO = CBS_REF_PADRAO;

export function fatorDespesaChat(d: Pick<DespesaChat, 'rotulo' | 'regra'>): number {
  if (/aluguel/i.test(d.rotulo ?? '')) return 0.3;
  if (d.regra === 'integral') return 1;
  if (d.regra === 'red30') return 0.7;
  if (d.regra === 'red60') return 0.4;
  return 0;
}

export function creditoDespesaChat(d: DespesaChat, cbsRef: number): number {
  return Math.round((Number(d.valor) || 0) * (Number(cbsRef) || 0) * fatorDespesaChat(d) * 100) / 100;
}

export function totalCreditosChat(despesas: DespesaChat[], cbsRef: number): number {
  const total = (despesas ?? []).reduce((acc, d) => acc + (Number(d.valor) || 0) * (Number(cbsRef) || 0) * fatorDespesaChat(d), 0);
  return Math.round(total * 100) / 100;
}

/* ------------------------------------------------- detecção ------------ */

const RX_SEM_EMPRESA = /n[aã]o tenho empresa|sem empresa|n[aã]o possuo empresa|ainda n[aã]o tenho|quero abrir|abrindo empresa|abrir (uma|um|a) empresa|futura empresa|estou planejando|planejando abrir|sem cnpj|sou aut[oô]nomo|autonomo|freelancer|quero simular|futura(o)? (neg[oó]cio|empreendimento)/i;

/** Sinais FORTES de plural: só com anexo explícito já justificam a matriz. */
const RX_TODOS_FORTES = /todos?\s+(os\s+)?anexos?|cada anexo|comparar anexos?|por anexo|em cada anexo|diferen[çc]as?\s+entre|particularidades?/i;

const RX_TODOS_ANEXOS = /todos?\s+(os\s+)?anexos?|cada anexo|por anexo|em cada|comparar anexos?|qual anexo|em todos|diferen[çc]as?|particularidades?|quanto (vou |iria |eu )?pagar.*(anexo|simples)|quanto (fica|custa|d[aá]).*(anexo|simples)|simula.*(todos|anexos)/i;

const RX_QUER_HIBRIDO = /h[ií]brido|convencional|por fora|dentro do das|cr[eé]dito|despesa|gasto|custo|comparar.*regime|regime.*compar/i;

export function detectarSemEmpresa(texto: string): boolean {
  return RX_SEM_EMPRESA.test(String(texto ?? ''));
}

export function detectarQuerTodosAnexos(texto: string): boolean {
  return RX_TODOS_ANEXOS.test(String(texto ?? ''));
}

export function detectarQuerHibrido(texto: string): boolean {
  return RX_QUER_HIBRIDO.test(String(texto ?? ''));
}

/** "não tenho empresa, quanto pagaria no simples?" → modo exploratório.
 * Com anexo explícito, só o plural forte (todos/cada/comparar) abre a matriz —
 * "quanto vou pagar no Anexo I" continua cálculo individual (guard Fator R). */
export function detectarModoExploratorio(texto: string, anexoAtual: string | null): boolean {
  const t = String(texto ?? '');
  if (anexoAtual != null) return RX_TODOS_FORTES.test(t);
  if (RX_SEM_EMPRESA.test(t)) return true;
  if (RX_TODOS_FORTES.test(t)) return true;
  if (/quanto.*(pagar|pago|fica|custa).*simples/i.test(t)) return true;
  if (/quanto de imposto/i.test(t) && /simples/i.test(t)) return true;
  return false;
}

export function extrairCbsRef(texto: string): number | null {
  const t = String(texto ?? '');
  const m = t.match(/cbs(?:\s+de\s+refer[eê]ncia)?\s*(?:de\s*)?(\d+(?:[.,]\d+)?)\s*%/i)
    ?? t.match(/al[ií]quota(?:\s+cbs)?\s*(?:de\s*)?(\d+(?:[.,]\d+)?)\s*%/i);
  if (!m) return null;
  const v = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(v) || v <= 0 || v > 30) return null;
  return Math.round((v / 100) * 10000) / 10000;
}

/* ------------------------------------------------- despesas ------------ */

const ROTULOS_CONHECIDOS: { chave: string; rx: RegExp; rotulo: string }[] = [
  { chave: 'aluguel', rx: /alugue\w*/i, rotulo: 'Aluguel' },
  { chave: 'energia', rx: /energia|el[eé]trica|\bluz\b/i, rotulo: 'Energia elétrica' },
  { chave: 'telefone', rx: /telefone|internet|\bfone\b|\bnet\b|wi-?fi/i, rotulo: 'Telefone / Internet' },
  { chave: 'agua', rx: /[aá]gua|saneamento/i, rotulo: 'Água / Saneamento' },
  { chave: 'material', rx: /material|escrit[oó]rio|expediente|uso e consumo/i, rotulo: 'Material de escritório' },
  { chave: 'contabilidade', rx: /contabil|contador/i, rotulo: 'Contabilidade' },
  { chave: 'advocacia', rx: /advocacia|advogad/i, rotulo: 'Advocacia' },
  { chave: 'estoque', rx: /estoque|\bcmv\b|insumo/i, rotulo: 'Estoque / CMV' },
];

/** Compat: regra sem fonte (prefira `regraPertoDeComFonte`). */
export function regraPertoDe(texto: string, indice: number): RegraCreditoCBS {
  return regraPertoDeComFonte(texto, indice).regra;
}

/**
 * v9 — regra COM fonte: distingue "integral explícito" de "integral assumido".
 * Usa o motor de porcentagem (`percentual-chat.ts`): "redução de 30%",
 * "30% da alíquota", "integral", "sem crédito".
 */
export function regraPertoDeComFonte(texto: string, indice: number): { regra: RegraCreditoCBS; explicita: boolean } {
  const t = String(texto ?? '');
  const janela = t.slice(Math.max(0, indice - 40), indice + 40).toLowerCase();
  if (/sem cr[eé]dito|n[aã]o.*cr[eé]dito|folha|pr[oó][ -]?labore|sal[aá]rio|inss|fgts|encargo|n[aã]o onerada/i.test(janela)) return { regra: 'semCredito', explicita: true };
  if (/al[ií]quota zero|zerad|isenta|isento|sem cbs/i.test(janela)) return { regra: 'zero', explicita: true };
  if (/red.{0,8}60|40%\s*da/i.test(janela)) return { regra: 'red60', explicita: true };
  if (/red.{0,8}30|70%\s*da/i.test(janela)) return { regra: 'red30', explicita: true };
  try {
    if (temVedacaoCredito(janela)) return { regra: 'semCredito', explicita: true };
    const det = extrairPercentualRobusto(janela);
    if (det != null && det.contexto !== 'direto') {
      const r = regraCreditoDePercentual(det.fracao, det.contexto);
      if (r != null) return { regra: r, explicita: true };
    }
    if (temRegraIntegral(janela)) return { regra: 'integral', explicita: true };
  } catch {
    /* motor nunca trava a extração */
  }
  return { regra: 'integral', explicita: false };
}

/** Rótulo canônico tem redução conhecida por tipo (aluguel = 30% da alíquota). */
export function ehReducaoPorTipo(rotulo: string): boolean {
  return /aluguel/i.test(String(rotulo ?? ''));
}

/* -------------------- léxico de despesas (RAG + LEXICAL) --------------- */

/**
 * Sinônimos por tipo de despesa. A classificação usa `casaToken` + expansão
 * de sinônimos — os mesmos primitivos léxicos do RAG de NCM — sobre estes
 * verbetes, com a tabela de regras como verdade determinística (nada é
 * chutado pelo modelo: sem lastro, o rótulo segue livre e a regra é
 * perguntada).
 */
const SINONIMOS_DESPESA: Record<string, string[]> = {
  Aluguel: ['aluguel', 'alugue', 'locacao', 'locação', 'rent', 'aluguel comercial'],
  'Energia elétrica': ['energia', 'eletrica', 'elétrica', 'luz', 'conta de luz'],
  'Telefone / Internet': ['telefone', 'internet', 'fone', 'net', 'wifi', 'wi-fi', 'banda larga'],
  'Água / Saneamento': ['agua', 'água', 'saneamento'],
  'Material de escritório': ['material', 'escritorio', 'escritório', 'expediente', 'papelaria', 'uso e consumo'],
  Contabilidade: ['contabilidade', 'contabil', 'contábil', 'contador'],
  Advocacia: ['advocacia', 'advogado'],
  'Estoque / CMV': ['estoque', 'cmv', 'insumo', 'mercadoria'],
};

function tokensLex(s: string): string[] {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2);
}

/**
 * Canonicaliza um rótulo livre para o tipo conhecido mais próximo via
 * léxico tolerante (`casaToken` + sinônimos). Retorna null sem lastro — o
 * rótulo segue livre e a regra será perguntada no fluxo do híbrido.
 */
export function classificarRotuloDespesaLexical(frase: string): { rotulo: string; escore: number } | null {
  const base = tokensLex(frase);
  if (!base.length) return null;
  const toks: string[] = [];
  for (const w of base) {
    toks.push(w);
    try {
      const e = expandirSinonimoFiscal(w);
      if (e && e !== w) toks.push(...tokensLex(e));
    } catch {
      /* léxico nunca trava */
    }
  }
  let melhor: { rotulo: string; escore: number } | null = null;
  let melhorExato: { rotulo: string; escore: number } | null = null;
  for (const [rotulo, chaves] of Object.entries(SINONIMOS_DESPESA)) {
    let casa = 0;
    let exato = 0;
    for (const chave of chaves) {
      const ck = tokensLex(chave);
      if (ck.some((k) => toks.includes(k))) {
        casa++;
        exato++;
        continue;
      }
      if (ck.some((k) => toks.some((w) => { try { return casaToken(w, k); } catch { return false; } }))) casa++;
    }
    // Substring casa fácil demais ("conta" dentro de "contabil"): o desempate
    // prioriza o casamento EXATO ("conta de luz" → Energia, não Contabilidade).
    const escoreExato = exato / chaves.length;
    if (exato > 0 && (melhorExato == null || escoreExato > melhorExato.escore)) {
      melhorExato = { rotulo, escore: escoreExato };
    }
    const escore = casa / chaves.length;
    if (casa > 0 && (melhor == null || escore > melhor.escore)) melhor = { rotulo, escore };
  }
  return melhorExato ?? melhor;
}

/**
 * Detecta regra de DÉBITO sobre a receita ("receita com redução de 30%",
 * "faturamento com 70% da alíquota", "venda isenta"). "X% do RBT" e
 * "receita bruta" são ignorados (folha e RBT12, não débito). Retorna a última
 * menção decisiva; `incerta` pede a pergunta ("tem redução? qual %?").
 */
export function detectarRegraDebitoReceita(texto: string): { regra: RegraDebitoCBS | null; incerta: boolean } {
  const t = String(texto ?? '');
  if (!t.trim()) return { regra: null, incerta: false };
  const RX_REC = /receita(?!\s*bruta)|faturamento(?!\s*bruto)|vendas?|nota\s*fiscal/gi;
  let m: RegExpExecArray | null;
  let ultima: { regra: RegraDebitoCBS | null; incerta: boolean } | null = null;
  RX_REC.lastIndex = 0;
  while ((m = RX_REC.exec(t)) !== null) {
    const win = t.slice(Math.max(0, m.index - 10), m.index + 70);
    if (/rbt/i.test(win)) continue;
    const wl = win.toLowerCase();
    if (/al[ií]quota\s*zero|zerad|isenta?|imune|sem\s*cbs/.test(wl)) { ultima = { regra: 'zero', incerta: false }; continue; }
    if (/sem\s*redu[cç][aã]o|\bcheia\b|integral/.test(wl)) { ultima = { regra: 'cheia', incerta: false }; continue; }
    const det = extrairPercentualRobusto(win);
    if (det) {
      if (det.contexto === 'direto' && Math.abs(det.fracao - 0.5) < 0.001) {
        ultima = { regra: 'red50', incerta: false };
        continue;
      }
      if (det.contexto !== 'direto') {
        const r = regraDebitoDePercentual(det.fracao, det.contexto);
        ultima = r ? { regra: r, incerta: false } : { regra: null, incerta: true };
        continue;
      }
      ultima = { regra: null, incerta: true };
      continue;
    }
    if (/redu[cç][aã]o|\bred\b|desconto/.test(wl)) { ultima = { regra: null, incerta: true }; continue; }
    if (m[0].length === 0) RX_REC.lastIndex++;
  }
  return ultima ?? { regra: null, incerta: false };
}

/** `true` quando a frase menciona redução sobre a receita (com ou sem %). */
export function mencionaReducaoReceita(texto: string): boolean {
  const d = detectarRegraDebitoReceita(texto);
  return d.regra != null || d.incerta;
}

const RX_NUM_DESPESA = /(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d+)?)\s*(bilh[õo]es|bilh[ãa]o|\bbi\b|milh[õo]es|milh[ãa]o|\bmil\b|\bmi\b|\bk\b|M\b)?/;

function numeroComSufixo(num: string, suf: string | undefined): number | null {
  const mult = !suf ? 1 : /^(k|mil)$/i.test(suf) ? 1e3 : /^(mi|m)$/i.test(suf) || /^milh/i.test(suf) ? 1e6 : /^bi|^bilh/i.test(suf) ? 1e9 : 1;
  let base: number;
  if (num.includes(',')) base = Number(num.replace(/\./g, '').replace(',', '.'));
  else if (/^\d{1,3}(\.\d{3})+$/.test(num)) base = Number(num.replace(/\./g, ''));
  else {
    const m = num.match(/^(\d+)\.(\d+)$/);
    base = m ? (m[2].length === 3 ? Number(m[1] + m[2]) : Number(num)) : Number(num);
  }
  if (!Number.isFinite(base) || base <= 0) return null;
  return Math.round(base * mult * 100) / 100;
}

/**
 * Extrai despesas citadas num texto ("aluguel 1500", "energia: R$ 300",
 * "adicionar contador 800 integral"). Puro e testável. Última menção
 * do mesmo rótulo vence na acumulação (ver `acumularDespesas`).
 */
export function extrairDespesasDoTexto(texto: string): DespesaChat[] {
  const t = String(texto ?? '');
  if (!t.trim()) return [];
  const out: DespesaChat[] = [];
  const usados: Array<{ inicio: number; fim: number }> = [];

  for (const item of ROTULOS_CONHECIDOS) {
    const rxLabel = new RegExp(item.rx.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = rxLabel.exec(t)) !== null) {
      const li = m.index;
      // número até 40 chars depois do rótulo ("aluguel 1500", "aluguel: R$ 1.500")
      const apos = t.slice(li, li + 60);
      const mn = apos.match(new RegExp(`^.{0,${String(item.rotulo).length + 12}}?(?:R\\$\\s*)?${RX_NUM_DESPESA.source}`, 'i'));
      let valor: number | null = null;
      let fim = li + m[0].length;
      if (mn && mn[1]) {
        valor = numeroComSufixo(mn[1], mn[2]);
        fim = li + (mn[0]?.length ?? m[0].length);
      } else {
        // número até 40 chars ANTES ("1500 de aluguel")
        const antes = t.slice(Math.max(0, li - 60), li + m[0].length);
        const ma = antes.match(new RegExp(`(?:R\\$\\s*)?${RX_NUM_DESPESA.source}\\s*(?:de\\s+)?$`, 'i'));
        if (ma && ma[1]) valor = numeroComSufixo(ma[1], ma[2]);
      }
      if (valor == null) continue;
      if (usados.some((u) => li < u.fim && fim > u.inicio)) continue;
      usados.push({ inicio: li, fim });
      const detRegra = regraPertoDeComFonte(t, li);
      out.push({ rotulo: item.rotulo, valor, regra: detRegra.regra, regraExplicita: detRegra.explicita });
    }
  }

  // Nova despesa genérica ("adicionar contador 800", "nova despesa marketing 1200 integral").
  const rxNova = new RegExp(
    `(?:adiciona\\w*|nova?|outra?|inclu\\w+|mais)\\s+(?:despesa|gasto|custo)?\\s*([A-Za-zÀ-ú][A-Za-zÀ-ú /.-]{2,36}?)\\s*(?:de\\s*)?(?:R\\$\\s*)?${RX_NUM_DESPESA.source}`,
    'gi',
  );
  let mn: RegExpExecArray | null;
  while ((mn = rxNova.exec(t)) !== null) {
    const rotulo = (mn[1] ?? '').trim().replace(/\s+/g, ' ');
    if (rotulo.length < 3 || ROTULOS_CONHECIDOS.some((r) => r.rx.test(rotulo))) continue;
    const valor = numeroComSufixo(mn[2] ?? '', mn[3]);
    if (valor == null) continue;
    const li = mn.index;
    if (usados.some((u) => li < u.fim && li + mn![0].length > u.inicio)) continue;
    usados.push({ inicio: li, fim: li + mn[0].length });
    // v9 — léxico tolerante: typo ("alugel") ou sinônimo ("locação") cai no
    // tipo canônico; sem lastro, o rótulo segue livre e a regra é perguntada.
    let rotuloFinal = rotulo.charAt(0).toUpperCase() + rotulo.slice(1);
    try {
      const lex = classificarRotuloDespesaLexical(rotulo);
      if (lex) rotuloFinal = lex.rotulo;
    } catch {
      /* léxico nunca trava */
    }
    const detRegraNova = regraPertoDeComFonte(t, li);
    out.push({ rotulo: rotuloFinal, valor, regra: detRegraNova.regra, regraExplicita: detRegraNova.explicita });
  }
  return out;
}

/** Acumula despesas de várias falas (última menção do rótulo vence). */
export function acumularDespesas(falas: string[]): DespesaChat[] {
  const mapa = new Map<string, DespesaChat>();
  for (const fala of falas ?? []) {
    for (const d of extrairDespesasDoTexto(fala)) {
      mapa.set(d.rotulo.toLowerCase(), d);
    }
  }
  return [...mapa.values()];
}

export function despesasIguaisReferencia(despesas: DespesaChat[]): boolean {
  if (despesas.length !== DESPESAS_REFERENCIA.length) return false;
  return DESPESAS_REFERENCIA.every((r) => {
    const d = despesas.find((x) => x.rotulo.toLowerCase() === r.rotulo.toLowerCase());
    return d != null && Math.abs(d.valor - r.valor) < 0.005 && d.regra === r.regra;
  });
}

/* ------------------------------------------------- motor --------------- */

export function orquestrarTodosAnexos(e: EntradaExploratoria): ResultadoExploratorio {
  const rbt12 = Number(e.rbt12) || 0;
  const receita = Number(e.receitaMes) || 0;
  const cbsRef = Number(e.cbsRef) || CBS_REFERENCIA_PADRAO;
  const debitos = debitoCBS(receita, 'cheia', cbsRef);
  const creditos = totalCreditosChat(e.despesas ?? [], cbsRef);
  const linhas: LinhaAnexoExploratorio[] = (Object.keys(ANEXOS_SIMPLES) as AnexoSimplesId[]).map((id) => {
    const conv = calcularConvencional({ anexoId: id, rbt12, receitaMes: receita });
    const hib = calcularHibrido({ convencional: conv, debitosCBS: debitos, creditosCBS: creditos });
    const economia = hib.economiaVsConvencional;
    return {
      anexo: id,
      nome: ANEXOS_SIMPLES[id].nome,
      faixa: conv.faixa,
      aliquotaEfetiva: conv.aliquotaEfetiva,
      das: conv.dasGuia ?? conv.das,
      cbsDentroDAS: conv.cbsDentroDAS,
      dasReduzido: hib.dasReduzido,
      debitosCbs: debitos,
      creditosCbs: creditos,
      cbsFora: hib.cbsFora,
      totalHibrido: hib.total,
      vencedorRegime: hib.melhor === 'hibrido' ? 'HIB' : hib.melhor === 'convencional' ? 'CONV' : 'EMPATE',
      economiaConvHib: Math.abs(economia),
      reparticao: { ...(conv.reparticaoGuia ?? conv.reparticao) },
    };
  });
  const convOrdenado = [...linhas].sort((a, b) => a.das - b.das);
  const geralOrdenado = [...linhas].sort((a, b) => Math.min(a.das, a.totalHibrido) - Math.min(b.das, b.totalHibrido));
  const melhorGeral = geralOrdenado[0];
  const folha = e.folha12 != null && e.folha12 > 0 && rbt12 > 0
    ? { indice: (Number(e.folha12) || 0) / rbt12, anexo: (((Number(e.folha12) || 0) / rbt12) >= 0.28 ? 'III' : 'V') as 'III' | 'V', temFolha: true }
    : null;
  return {
    linhas,
    vencedorConvId: convOrdenado[0]?.anexo ?? 'I',
    vencedorConvValor: convOrdenado[0]?.das ?? 0,
    vencedorGeralId: melhorGeral?.anexo ?? 'I',
    vencedorGeralRegime: melhorGeral ? (melhorGeral.das <= melhorGeral.totalHibrido ? 'CONV' : 'HIB') : 'CONV',
    vencedorGeralValor: melhorGeral ? Math.min(melhorGeral.das, melhorGeral.totalHibrido) : 0,
    debitosCbs: debitos,
    creditosCbs: creditos,
    fatorR: folha,
  };
}

/* ------------------------------------------------- etapas -------------- */

export type EtapaSimples = 'rbt12' | 'receita' | 'folha' | 'despesas' | 'pronto';

export interface EstadoColeta {
  rbt12: number | null;
  receita: number | null;
  folha: number | null;
  cbsRef: number;
  despesas: DespesaChat[];
  despesasConfirmadas: boolean;
  querHibrido: boolean;
  folhaOpcional: boolean;
}

export function proximaEtapa(s: EstadoColeta): EtapaSimples {
  if (!(s.rbt12 != null && s.rbt12 > 0)) return 'rbt12';
  if (!(s.receita != null && s.receita > 0)) return 'receita';
  // Folha: obrigatória quando híbrido interessa a serviços; no exploratório
  // sem anexo definido ela é recomendada (decide III × V) mas pode pular.
  if (s.folha == null && !s.folhaOpcional) {
    // Sem anexo definido (exploratório) sempre sugere a folha.
    return 'folha';
  }
  if (s.querHibrido && !s.despesasConfirmadas) return 'despesas';
  return 'pronto';
}

/** Reconstrói o estado da coleta a partir da pergunta + histórico (só falas do usuário). */
export function reconstruirEstadoColeta(pergunta: string, historicoUser: string[]): EstadoColeta {
  const combinado = [...historicoUser, pergunta].join('\n');
  const slots = extrairSlotsSimples(combinado);
  const cbs = extrairCbsRef(combinado) ?? CBS_REFERENCIA_PADRAO;
  const despesas = acumularDespesas([...historicoUser, pergunta]);
  const querHibrido = RX_QUER_HIBRIDO.test(combinado);
  const despesasConfirmadas =
    /usar refer[eê]ncia|manter refer[eê]ncia|confirma.*despesa|despesas? (ok|confirm|pront)/i.test(combinado) || despesas.length > 0;
  const folhaOpcional = /pular folha|sem folha|n[aã]o tenho folha|n[aã]o informar folha/i.test(combinado);
  return {
    rbt12: slots.rbt12,
    receita: slots.receitaMes,
    folha: slots.folha12,
    cbsRef: cbs,
    despesas,
    despesasConfirmadas,
    querHibrido,
    folhaOpcional,
  };
}

/* ------------------------------------------------- textos -------------- */

const pct4 = (v: number): string => `${((Number(v) || 0) * 100).toFixed(4).replace('.', ',')}%`;
const pct2 = (v: number): string => `${((Number(v) || 0) * 100).toFixed(2).replace('.', ',')}%`;

function linhaAnexoConv(l: LinhaAnexoExploratorio, vencedor: boolean): string {
  return `• Anexo ${l.anexo} — ${l.nome}: **${fmtMoeda(l.das)}** (${l.faixa}ª faixa · efetiva ${pct4(l.aliquotaEfetiva)} · CBS dentro ${fmtMoeda(l.cbsDentroDAS)})${vencedor ? ' **← menor carga**' : ''}`;
}

function linhaAnexoHib(l: LinhaAnexoExploratorio): string {
  const veredito = l.vencedorRegime === 'EMPATE'
    ? 'empate técnico'
    : l.vencedorRegime === 'HIB'
      ? `híbrido vence por ${fmtMoeda(l.economiaConvHib)}`
      : `convencional vence por ${fmtMoeda(l.economiaConvHib)}`;
  return `• Anexo ${l.anexo}: conv ${fmtMoeda(l.das)} × hib ${fmtMoeda(l.totalHibrido)} (DAS reduzido ${fmtMoeda(l.dasReduzido)} + CBS fora ${fmtMoeda(l.cbsFora)}) → ${veredito}`;
}

export function textoColetaEtapa(etapa: Exclude<EtapaSimples, 'pronto'>, s: EstadoColeta, passoAtual: number, totalPassos: number): string {
  const entendido: string[] = [];
  if (s.rbt12 != null) entendido.push(`RBT12 ${fmtMoeda(s.rbt12)}`);
  if (s.receita != null) entendido.push(`receita ${fmtMoeda(s.receita)}`);
  if (s.folha != null) entendido.push(`folha ${fmtMoeda(s.folha)}`);
  const ctxLinha = entendido.length ? `\nJá entendi: ${entendido.join(' · ')}.\n` : '';
  if (etapa === 'rbt12') {
    return (
      `## Passo ${passoAtual} de ${totalPassos} — RBT12 (faturamento 12 meses)\n` +
      `${ctxLinha}\n` +
      `Para comparar **todos os anexos** preciso do seu **RBT12** (soma dos últimos 12 meses, teto R$ 4,8 mi).\n\n` +
      `• Ex.: "RBT12 500 mil" ou "faturamento 1,2 milhão"\n` +
      `• Vale aproximado — te mostro a faixa e a alíquota efetiva de cada anexo`
    );
  }
  if (etapa === 'receita') {
    return (
      `## Passo ${passoAtual} de ${totalPassos} — Receita do mês\n` +
      `${ctxLinha}\n` +
      `Agora a **receita deste mês** (base da guia DAS).\n\n` +
      `• Ex.: "receita 40 mil" ou "faturei R$ 36.000 este mês"`
    );
  }
  if (etapa === 'folha') {
    return (
      `## Passo ${passoAtual} de ${totalPassos} — Folha 12m (decide III × V)\n` +
      `${ctxLinha}\n` +
      `A **folha dos últimos 12 meses** (salários + pró-labore + FGTS) decide entre **Anexo III (≥ 28%)** e **Anexo V (< 28%)** pelo Fator R.\n\n` +
      `• Ex.: "folha 200 mil"\n` +
      `• Sem folha? Diga "pular folha" — comparo os 5 anexos e marco o III/V como referência`
    );
  }
  return textoEtapaDespesas(s, passoAtual, totalPassos);
}

export function textoEtapaDespesas(s: EstadoColeta, passoAtual: number, totalPassos: number): string {
  const ref = DESPESAS_REFERENCIA.map((d) => {
    const cred = creditoDespesaChat(d, s.cbsRef);
    return `• ${d.rotulo}: ${fmtMoeda(d.valor)} (${d.dica}) → crédito ${fmtMoeda(cred)}`;
  }).join('\n');
  const totalRef = totalCreditosChat(DESPESAS_REFERENCIA, s.cbsRef);
  const atuais = s.despesas.length
    ? s.despesas.map((d) => `• ${d.rotulo}: ${fmtMoeda(d.valor)} → crédito ${fmtMoeda(creditoDespesaChat(d, s.cbsRef))}`).join('\n')
    : '• (nenhuma despesa informada ainda — CBS fora fica cheia, cenário pessimista)';
  return (
    `## Passo ${passoAtual} de ${totalPassos} — Despesas com crédito (Híbrido preciso)\n\n` +
    `No **híbrido**, a CBS sai da guia e vira **débitos − créditos**: cada real de despesa com crédito abate a CBS por fora.\n\n` +
    `**Valores de referência que já uso:**\n${ref}\n` +
    `Total de créditos (referência): **${fmtMoeda(totalRef)}** (CBS ${(s.cbsRef * 100).toFixed(2).replace('.', ',')}%)\n\n` +
    `**Suas despesas até agora:**\n${atuais}\n\n` +
    `• Confirme: "usar referência"\n` +
    `• Corrija: "aluguel 2000, energia 350"\n` +
    `• Adicione: "adicionar contador 800 integral" ou "adicionar marketing 1200 red30"`
  );
}

const PARTICULARIDADES: Record<AnexoSimplesId, string> = {
  I: 'Comércio: sem ISS e sem Fator R. O peso está em CPP + ICMS + CBS. 6ª faixa sem ICMS próprio (usa 5ª faixa).',
  II: 'Indústria: única com IPI (até 35,13% da repartição na 6ª faixa). Sem ISS e sem Fator R.',
  III: 'Serviços com ISS: ISS até 33,5% da guia com trava em 5% (excedente redistribuído p/ IRPJ/CSLL/CBS/CPP). Exige Fator R ≥ 28%.',
  IV: 'Serviços sem CPP: CPP zerado (INSS patronal pago por fora). ISS alto (40–44,5%). Sem Fator R.',
  V: 'Serviços Fator R: alíquotas nominais mais altas (15,5%–30,4%). Vale quando o Fator R < 28%; com folha alta, migrar p/ III economiza.',
};

export function textoExploratorioCompleto(e: EntradaExploratoria, r: ResultadoExploratorio, opts?: { mostrarHibrido?: boolean }): string {
  const mostrarHibrido = opts?.mostrarHibrido ?? true;
  const folhaLinha = e.folha12 != null && e.folha12 > 0
    ? `Folha 12m ${fmtMoeda(e.folha12)} · Fator R ${pct2((r.fatorR?.indice ?? 0))} → sugere **Anexo ${r.fatorR?.anexo}**`
    : 'Folha não informada — III × V como referência (diga "folha 200 mil" p/ aplicar o Fator R)';
  const convBullets = [...r.linhas].sort((a, b) => a.das - b.das)
    .map((l) => linhaAnexoConv(l, l.anexo === r.vencedorConvId)).join('\n');
  const hibBullets = [...r.linhas].map((l) => linhaAnexoHib(l)).join('\n');
  const parts: string[] = [];
  parts.push('## Simples Nacional — quanto você pagaria em cada anexo');
  parts.push(`Sem empresa? Sem problema — simulei com seus números em **todos os anexos** no motor oficial (LC 123/2006 × LC 214/2025, vigência 2027–2028).`);
  parts.push('---');
  parts.push('## Seus números');
  parts.push(`• RBT12 ${fmtMoeda(e.rbt12)} · receita do mês ${fmtMoeda(e.receitaMes)}\n• ${folhaLinha}\n• CBS referência ${(e.cbsRef * 100).toFixed(2).replace('.', ',')}% · créditos ${fmtMoeda(r.creditosCbs)} (débitos ${fmtMoeda(r.debitosCbs)})`);
  parts.push('---');
  parts.push('## Convencional — DAS com CBS dentro (por anexo)');
  parts.push(convBullets);
  parts.push(`\n**Menor carga no convencional: Anexo ${r.vencedorConvId} (${fmtMoeda(r.vencedorConvValor)})**`);
  if (mostrarHibrido) {
    parts.push('---');
    parts.push('## Convencional × Híbrido (DAS reduzido + CBS por fora)');
    parts.push(hibBullets);
    parts.push(`\nHíbrido = DAS reduzido (DAS − CBS dentro) + CBS por fora (débitos ${fmtMoeda(r.debitosCbs)} − créditos ${fmtMoeda(r.creditosCbs)}). Sem despesas, a CBS fora fica cheia — cenário pessimista.`);
  }
  parts.push('---');
  parts.push('## O que muda entre os anexos');
  (Object.keys(PARTICULARIDADES) as AnexoSimplesId[]).forEach((id) => {
    parts.push(`• **Anexo ${id}:** ${PARTICULARIDADES[id]}`);
  });
  parts.push('---');
  parts.push('## Insights da simulação');
  parts.push(textoInsightsExploratorio(e, r, { mostrarHibrido }));
  parts.push('---');
  parts.push('## Próximos passos');
  const passos: string[] = [];
  if (e.folha12 == null) passos.push('1. Informe a folha ("folha 200 mil") para confirmar III × V pelo Fator R');
  else passos.push('1. Folha registrada — o Fator R já decide III × V acima');
  passos.push(`${e.folha12 == null ? '2' : '2'}. Ajuste despesas ("aluguel 2000", "adicionar contador 800") para refinar o híbrido`);
  passos.push(`${e.folha12 == null ? '3' : '3'}. Peça "mostra em gráfico" ou "gera relatório dessa simulação"`);
  parts.push(passos.join('\n'));
  return parts.join('\n\n');
}

export function textoInsightsExploratorio(e: EntradaExploratoria, r: ResultadoExploratorio, opts?: { mostrarHibrido?: boolean }): string {
  const mostrarHibrido = opts?.mostrarHibrido ?? true;
  const iii = r.linhas.find((l) => l.anexo === 'III')!;
  const v = r.linhas.find((l) => l.anexo === 'V')!;
  const economiaConv = Math.round((v.das - iii.das) * 100) / 100;
  const economiaHib = Math.round((v.totalHibrido - iii.totalHibrido) * 100) / 100;
  const out: string[] = [];
  out.push(`1. **Veredito:** a menor carga geral é o **Anexo ${r.vencedorGeralId} no ${r.vencedorGeralRegime === 'CONV' ? 'convencional' : 'híbrido'} (${fmtMoeda(r.vencedorGeralValor)})**.`);
  if (economiaConv >= 0) {
    out.push(`2. **III × V no convencional:** o III (${fmtMoeda(iii.das)}) fica ${fmtMoeda(Math.abs(economiaConv))} abaixo do V (${fmtMoeda(v.das)}), porque a efetiva do III (${pct4(iii.aliquotaEfetiva)}) é menor nesta faixa.`);
  }
  if (r.fatorR?.temFolha) {
    out.push(`3. **Fator R ${pct2(r.fatorR.indice)}:** ${r.fatorR.anexo === 'III' ? 'enquadrado (≥ 28%) — sustenta o III; monitore todo mês' : 'abaixo de 28% — vale o V; subir a folha migra para o III e economiza no convencional'}.`);
  } else {
    out.push(`3. **Fator R pendente:** sem folha, o III × V acima é referência. Com "folha 200 mil" eu confirmo o anexo efetivo e o gap de pró-labore.`);
  }
  const algumHibVence = mostrarHibrido && r.linhas.some((l) => l.vencedorRegime === 'HIB');
  if (!mostrarHibrido) {
    // v8 — duelo com o híbrido só sob demanda (clique): aqui só o convite.
    out.push(
      `4. **Híbrido sob demanda:** o duelo com o regime híbrido (DAS sem CBS + DARF da CBS) só aparece se você pedir — diga "comparar com híbrido" ou informe despesas ("aluguel 2000").`,
    );
    void algumHibVence;
    void e;
    void economiaHib;
    return out.join('\n');
  }
  out.push(
    algumHibVence
      ? `4. **Híbrido compensa onde há crédito:** com créditos de ${fmtMoeda(r.creditosCbs)} contra débitos de ${fmtMoeda(r.debitosCbs)}, o híbrido vence em ao menos um anexo. Mais despesa com crédito = mais vantagem híbrida.`
      : `4. **Convencional vence aqui:** créditos de ${fmtMoeda(r.creditosCbs)} são pequenos diante da CBS embutida — tirar a CBS da guia deixa a conta mais cara. Com mais despesas, rode de novo.`,
  );
  void e;
  void economiaHib;
  return out.join('\n');
}

/**
 * v8 — há thread híbrida ativa? Últimas 6 mensagens citam híbrido/CBS fora/
 * débitos, ou há despesas acumuladas nas falas. Puro. Decide SE o híbrido
 * pode aparecer (clique/pedido) e PARA ONDE vai o refino ("aluguel 2000").
 */
export function contextoHibridoAtivo(mensagens: string[]): boolean {
  const lista = Array.isArray(mensagens) ? mensagens : [];
  if (!lista.length) return false;
  const ultimas = lista.slice(-6).join('\n');
  if (/h[ií]brido|usar refer[eê]ncia|cbs fora|d[eé]bitos/i.test(ultimas)) return true;
  try {
    return acumularDespesas(lista).length > 0;
  } catch {
    return false;
  }
}

/* ------------------------------------------------- relatório ----------- */

export interface DadosSimplesChat {
  titulo: string;
  pergunta: string;
  geradoEm: string;
  entrada: EntradaExploratoria;
  resultado: ResultadoExploratorio;
}

export function montarRelatorioSimples(d: DadosSimplesChat, formato: 'csv' | 'json' | 'txt'): { nome: string; conteudo: string; mime: string; tamanho: number } {
  const dia = new Date().toISOString().slice(0, 10);
  const nomeBase = `aurum-ai-simples-${dia}`;
  if (formato === 'json') {
    const conteudo = JSON.stringify(
      {
        geradoEm: d.geradoEm,
        geradoPor: 'Aurum AI',
        tipo: 'simples-exploratorio',
        titulo: d.titulo,
        pergunta: d.pergunta,
        entrada: d.entrada,
        linhas: d.resultado.linhas,
        vencedorConv: { anexo: d.resultado.vencedorConvId, valor: d.resultado.vencedorConvValor },
        vencedorGeral: { anexo: d.resultado.vencedorGeralId, regime: d.resultado.vencedorGeralRegime, valor: d.resultado.vencedorGeralValor },
        fatorR: d.resultado.fatorR,
        aviso: 'Simulação com receita integralmente tributada à alíquota cheia de CBS. Confirme com o contador.',
      },
      null,
      2,
    );
    return { nome: `${nomeBase}.json`, conteudo, mime: 'application/json', tamanho: conteudo.length };
  }
  if (formato === 'txt') {
    const linhas = [
      d.titulo,
      `Gerado em ${d.geradoEm} · pela Aurum AI`,
      ``,
      `RBT12: ${fmtMoeda(d.entrada.rbt12)} · Receita: ${fmtMoeda(d.entrada.receitaMes)} · Folha: ${d.entrada.folha12 != null ? fmtMoeda(d.entrada.folha12) : '—'} · CBS ref: ${(d.entrada.cbsRef * 100).toFixed(2)}%`,
      ...d.resultado.linhas.map((l) => `Anexo ${l.anexo} (${l.nome}): conv ${fmtMoeda(l.das)} · hib ${fmtMoeda(l.totalHibrido)} · efetiva ${(l.aliquotaEfetiva * 100).toFixed(4)}%`),
      `Menor carga: Anexo ${d.resultado.vencedorGeralId} ${d.resultado.vencedorGeralRegime} (${fmtMoeda(d.resultado.vencedorGeralValor)})`,
      `Aviso: simulação informativa — confirme com o contador.`,
    ];
    const conteudo = linhas.join('\n');
    return { nome: `${nomeBase}.txt`, conteudo, mime: 'text/plain;charset=utf-8', tamanho: conteudo.length };
  }
  const q = (s: string | number): string => {
    const t = String(s ?? '');
    return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const linhas: string[][] = [
    [d.titulo, d.geradoEm],
    [],
    ['Anexo', 'Atividade', 'Faixa', 'Aliquota efetiva %', 'DAS conv (R$)', 'CBS dentro (R$)', 'DAS reduzido (R$)', 'CBS fora (R$)', 'Total hibrido (R$)', 'Vencedor'],
    ...d.resultado.linhas.map((l) => [
      `Anexo ${l.anexo}`,
      l.nome,
      String(l.faixa),
      (l.aliquotaEfetiva * 100).toFixed(4).replace('.', ','),
      l.das.toFixed(2),
      l.cbsDentroDAS.toFixed(2),
      l.dasReduzido.toFixed(2),
      l.cbsFora.toFixed(2),
      l.totalHibrido.toFixed(2),
      l.vencedorRegime,
    ]),
    [],
    ['RBT12 (R$)', d.entrada.rbt12.toFixed(2)],
    ['Receita mes (R$)', d.entrada.receitaMes.toFixed(2)],
    ['Aviso', 'Simulacao informativa — confirme com o contador antes de decidir.'],
  ];
  const conteudo = linhas.map((r) => r.map(q).join(';')).join('\r\n');
  return { nome: `${nomeBase}.csv`, conteudo, mime: 'text/csv;charset=utf-8', tamanho: conteudo.length };
}

export { extrairSlotsSimples, extrairTodosValores };
