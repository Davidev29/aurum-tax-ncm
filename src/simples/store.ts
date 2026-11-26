/**
 * Simples Nacional — store isolada (Zustand).
 * NÃO importa o motor de apuração da Consulta. Reusa apenas CNPJ/CNAE + UI.
 *
 * Fluxo em etapas (refino):
 * - Passo 1: escolher Anexo (manual) ou CNPJ+CNAE (automático).
 *   Restante só aparece após essa escolha.
 * - Folha 12m é coletada em TODAS as simulações (I–V, manual ou CNPJ);
 *   o Fator R só altera o anexo quando a atividade é sujeita (III/V).
 * - Relatório lateral só após "Visualizar cálculo com busca automática".
 * - Híbrido só quando o usuário opta por comparar.
 */
import { create } from 'zustand';
import { ANEXOS_SIMPLES, CBS_REF_PADRAO, type AnexoSimplesId } from './tabelas';
import {
  calcularConvencional,
  calcularHibrido,
  debitoCBS,
  creditoCBS,
  excedeSublimite,
  fatorR,
  tributosForaSublimite,
  type RegraCreditoCBS,
  type ResultadoConvencional,
  type ResultadoHibrido,
} from './calculo';
import { fatorCreditoDespesa } from '@/domain/simples/creditos';
import {
  exigirFolha12,
  exigirRbtReceita,
  validarFolhaObrigatoria,
  type ParamsValidacaoFatorR,
} from '@/domain/simples/validacao';
import { codigo7De } from '@/domain/services/cnae';
import {
  ANO_REFERENCIA_PADRAO,
  normalizarAnoReferencia,
  regrasDoCnae,
  type RegraCnae,
  type VereditoNbs,
} from '@/domain/services/cnae-nbs';
import { consultarPorCnae } from '@/application/consultar-por-cnae';
import type { EstadoNbsAtividade } from '@/application/consultar-por-cnpj';
import { buscarCnpj } from '@/infrastructure/receita/brasilapi';
import { db } from '@/infrastructure/db/schema';
import { registrarLimpeza, toast } from '@/store/ui';
import type { CnaeAnexo } from '@/domain/entities';

export type ModoSimples = 'manual' | 'cnpj';

export interface DespesaSimples {
  id: string;
  rotulo: string;
  valor: number;
  regra: RegraCreditoCBS;
}

export interface ParcelaSegStore {
  id: string;
  anexoId: AnexoSimplesId;
  valor: number;
  /** true = ICMS/ISS desta parcela já recolhido por ST (I/II → ICMS · demais → ISS). */
  st: boolean;
}

export interface CnaeOpcao {
  cnae7: string;
  codigoFormatado: string;
  descricao: string;
  principal: boolean;
  tabela: CnaeAnexo | null;
  anexos: string[];
  exigeFatorR: boolean;
  /* --------------------------------------------- Phase 9 / 09-04 --- */
  /** Camada 1 (`regrasDoCnae`) — sempre (null só se o banco falhar). */
  regras: RegraCnae | null;
  /** Camada 2 best-effort — vereditos NBS no ano de referência (INFORMATIVO). */
  nbsLista: VereditoNbs[];
  /** Quantos vereditos têm benefício da Reforma. */
  nbsComBeneficio: number;
  /** NBS mais provável do ranking (null sem mapeamento/bens). */
  maisProvavel: string | null;
  /** Estado do enriquecimento NBS. */
  estadoNbs: EstadoNbsAtividade;
  /** Ano de referência da precificação (default 2033). */
  anoReferencia: number;
}

interface SimplesState {
  modo: ModoSimples;
  anexoId: AnexoSimplesId;
  /** Passo 1 manual concluído (clicou num Anexo). */
  escolheuAnexo: boolean;
  rbt12: number;
  receitaMes: number;
  /** Compatibilidade: 0 continua sendo o estado "não informado" na store. */
  folha12: number;
  /** Auditoria: folha > 0 informada explicitamente (ou confirmada como zero). */
  folhaInformada: boolean;
  semFolhaConfirmado: boolean;
  /** false = Anexo III puro / atividade dispensada do Fator R. */
  sujeitaFatorR: boolean;
  rba: number;
  usarRba: boolean;
  cbsRef: number;
  /**
   * Alíquotas de referência fora da guia (fração, ex. 0.18 = 18%).
   * Só valem com excesso de sublimite: ICMS em I/II, ISS em III/IV/V.
   * null = automático (efetiva da 5ª faixa). Editáveis só nesse caso.
   */
  aliqRefICMS: number | null;
  aliqRefISS: number | null;
  despesas: DespesaSimples[];
  compararHibrido: boolean;
  // CNPJ
  cnpj: string;
  buscandoCnpj: boolean;
  empresaNome: string;
  opcaoSimples: boolean | null;
  opcoes: CnaeOpcao[];
  cnaeEscolhido: string;
  // resultado (só visível após botão busca automática)
  relatorioVisivel: boolean;
  convencional: ResultadoConvencional | null;
  hibrido: ResultadoHibrido | null;
  debitosCBS: number;
  creditosCBS: number;
  // Segregação de receita (vale p/ manual e CNPJ): 1 botão, N parcelas com
  // anexo + valor + checkbox ST. Cada desmembramento usa a RBT12 total na
  // sua tabela; o DAS é a soma (ST já deduzida por parcela).
  segAtivo: boolean;
  segParcelas: ParcelaSegStore[];

  set: (p: Partial<SimplesState>) => void;
  setAnexo: (a: AnexoSimplesId) => void;
  setDespesas: (d: DespesaSimples[]) => void;
  tocarEntrada: () => void;
  calcular: () => void;
  buscarPorCnpj: (opts?: { anoReferencia?: number }) => Promise<void>;
  escolherCnae: (cnae7: string) => void;
  limpar: () => void;
}

const uid = (): string => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Aluguel na planilha usa 30% da alíquota (redução 70%).
function normalizarDespesas(): DespesaSimples[] {
  return [
    { id: uid(), rotulo: 'Aluguel (30% da alíquota)', valor: 1500, regra: 'integral' },
    { id: uid(), rotulo: 'Energia elétrica', valor: 300, regra: 'integral' },
    { id: uid(), rotulo: 'Telefone / Internet', valor: 150, regra: 'integral' },
    { id: uid(), rotulo: 'Água / Saneamento', valor: 50, regra: 'integral' },
    { id: uid(), rotulo: 'Material de escritório', valor: 300, regra: 'integral' },
  ];
}

/** Fator de crédito por despesa (fonte única: `@/domain/simples/creditos`). */
export function fatorDespesa(d: DespesaSimples): number {
  return fatorCreditoDespesa(d.rotulo, d.regra);
}

/** Normaliza `anexos` vindos do SQLite/JSON em lista limpa `['III','V']`.
 * Robusto a formatos legados: `'III / V'`, `'III,V'`, `['III,V']`, `'iii/v'`. */
export function normalizarListaAnexosSimples(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : [v];
  const out: string[] = [];
  for (const item of arr) {
    for (const parte of String(item ?? '').split(/[/,;|]/)) {
      const t = parte.trim().toUpperCase();
      if ((t === 'I' || t === 'II' || t === 'III' || t === 'IV' || t === 'V') && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

/** Crédito preview por despesa (para exibir na linha). */
export function creditoDaDespesa(d: DespesaSimples, cbsRef: number): number {
  return Math.round((Number(d.valor) || 0) * (Number(cbsRef) || 0) * fatorDespesa(d) * 100) / 100;
}

/** Folha só quando Anexo V envolvido (manual V, CNAE com V ou com Fator R).
 * Lê `anexos` de forma tolerante (`'III / V'`, `'III,V'`, `['III,V']`) e ainda
 * considera o flag `fatorR`/`exigeFatorR` — CNAE 7020-4/00 (`III/V`, Fator R
 * Sim) sempre exibe a folha. */
export function envolveAnexoV(s: Pick<SimplesState, 'modo' | 'anexoId' | 'opcoes' | 'cnaeEscolhido'>): boolean {
  if (s.anexoId === 'V') return true;
  if (s.modo === 'cnpj' && s.cnaeEscolhido) {
    const op = s.opcoes.find((o) => o.cnae7 === s.cnaeEscolhido);
    if (!op) return false;
    if (normalizarListaAnexosSimples(op.anexos).includes('V')) return true;
    if (op.exigeFatorR) return true;
    if (op.tabela?.fatorR) return true;
  }
  return false;
}

/**
 * Caso de 2 anexos via CNPJ (ex.: III + V): o CNAE escolhido traz
 * simultaneamente III e V e a folha (Fator R) decide o anexo efetivo.
 * >= 28% (folha12/RBT12) => Anexo III, < 28% => Anexo V.
 */
export function temDuploAnexoFatorR(s: Pick<SimplesState, 'modo' | 'opcoes' | 'cnaeEscolhido'>): boolean {
  if (s.modo !== 'cnpj' || !s.cnaeEscolhido) return false;
  const op = s.opcoes.find((o) => o.cnae7 === s.cnaeEscolhido);
  if (!op) return false;
  const anexos = normalizarListaAnexosSimples(op.anexos);
  return anexos.includes('III') && anexos.includes('V');
}

export interface PrevisaoFatorR {
  /** Índice folha12/RBT12 (0 quando sem base). */
  indice: number;
  /** Anexo que será usado no cálculo. */
  anexo: 'III' | 'V';
  /** true quando há RBT12 + folha para decidir (>= 28% => III). */
  definido: boolean;
}

/**
 * Previsão dinâmica do anexo efetivo pelo Fator R.
 * Espelha a regra usada em `calcular()`: sem folha/RBT12, assume V (provisório).
 */
export function preverAnexoFatorR(rbt12: number, folha12: number): PrevisaoFatorR {
  const rbt = Number(rbt12) || 0;
  const folha = Number(folha12) || 0;
  if (rbt > 0 && folha > 0) {
    const { indice, anexo } = fatorR(folha, rbt);
    return { indice, anexo, definido: true };
  }
  return { indice: rbt > 0 ? folha / rbt : 0, anexo: 'V', definido: false };
}

/** Passo 1 concluído: manual escolheu anexo / cnpj escolheu CNAE. */
export function etapa1Pronta(s: Pick<SimplesState, 'modo' | 'escolheuAnexo' | 'cnaeEscolhido'>): boolean {
  return s.modo === 'manual' ? s.escolheuAnexo : Boolean(s.cnaeEscolhido);
}

/**
 * Excesso de sublimite estadual (R$ 3,6M) — 100% automático pelo RBT12.
 * Sem botão/RBA manual: RBA efetiva = RBT12 sempre.
 */
export function sublimiteEstourado(s: Pick<SimplesState, 'rbt12' | 'rba' | 'usarRba'>): boolean {
  const rbt = Number(s.rbt12) || 0;
  if (!(rbt > 0)) return false;
  const rba = rbaEfetiva(s);
  return excedeSublimite(rbt, rba);
}

/** RBA efetiva do cálculo — automática: sempre o RBT12 (sem RBA manual). */
export function rbaEfetiva(s: Pick<SimplesState, 'rbt12' | 'rba' | 'usarRba'>): number {
  return Number(s.rbt12) || 0;
}

/**
 * Quais referências de fora da guia fazem sentido para o anexo efetivo:
 * ICMS só em I/II, ISS só em III/IV/V (e IBS automático nos dois casos).
 */
export function refsForaDoAnexo(anexoId: AnexoSimplesId): Array<'ICMS' | 'ISS'> {
  const fora = tributosForaSublimite(anexoId);
  const out: Array<'ICMS' | 'ISS'> = [];
  if (fora.includes('ICMS')) out.push('ICMS');
  if (fora.includes('ISS')) out.push('ISS');
  return out;
}

/**
 * Chaves que representam ENTRADA do usuário. Qualquer uma delas invalida o
 * relatório publicado. Resultados (`convencional`, `hibrido`, `debitosCBS`,
 * `creditosCBS`) NUNCA são apagados por invalidação — o botão Editar depende
 * deles mesmo com o relatório escondido.
 */
const CHAVES_DE_ENTRADA = new Set<keyof SimplesState>([
  'modo',
  'anexoId',
  'escolheuAnexo',
  'rbt12',
  'receitaMes',
  'folha12',
  'folhaInformada',
  'semFolhaConfirmado',
  'sujeitaFatorR',
  'rba',
  'usarRba',
  'cbsRef',
  'aliqRefICMS',
  'aliqRefISS',
  'despesas',
  'compararHibrido',
  'cnpj',
  'buscandoCnpj',
  'empresaNome',
  'opcaoSimples',
  'opcoes',
  'cnaeEscolhido',
  'segAtivo',
  'segParcelas',
]);

export const useSimples = create<SimplesState>((rawSet, get) => ({
  modo: 'manual',
  anexoId: 'I',
  escolheuAnexo: false,
  rbt12: 0,
  receitaMes: 0,
  folha12: 0,
  folhaInformada: false,
  semFolhaConfirmado: false,
  sujeitaFatorR: true,
  rba: 0,
  usarRba: false,
  cbsRef: CBS_REF_PADRAO,
  aliqRefICMS: null,
  aliqRefISS: null,
  despesas: normalizarDespesas(),
  compararHibrido: false,
  cnpj: '',
  buscandoCnpj: false,
  empresaNome: '',
  opcaoSimples: null,
  opcoes: [],
  cnaeEscolhido: '',
  relatorioVisivel: false,
  convencional: null,
  hibrido: null,
  debitosCBS: 0,
  creditosCBS: 0,
  segAtivo: false,
  segParcelas: [],

  set: (p) => {
    const proximo: Partial<SimplesState> = { ...p };

    // (b) Folha informada automaticamente quando o valor é > 0. Isso mantém
    // compatibilidade com quem usa `setState({ folha12: X })` sem flags: a
    // guarda de domínio também trata folha > 0 como informada.
    if (Object.prototype.hasOwnProperty.call(p, 'folha12')) {
      const folha = Number(p.folha12);
      if (Number.isFinite(folha) && folha > 0) proximo.folhaInformada = true;
      else if (!(p.folhaInformada === true || p.semFolhaConfirmado === true)) proximo.folhaInformada = false;
    }

    // (a) Invalidação centralizada: NUNCA mexe em convencional/hibrido.
    if (Object.keys(proximo).some((k) => CHAVES_DE_ENTRADA.has(k as keyof SimplesState))) {
      proximo.relatorioVisivel = false;
    }

    // Comportamento especial preservado: trocar de modo reabre o passo 1.
    if (p.modo && p.modo !== get().modo) {
      rawSet({ ...proximo, relatorioVisivel: false });
      return;
    }
    rawSet(proximo);
  },

  setAnexo: (a) => {
    get().set({ anexoId: a, escolheuAnexo: true, relatorioVisivel: false });
  },

  setDespesas: (d) => {
    get().set({ despesas: d, relatorioVisivel: false });
  },

  tocarEntrada: () => get().set({ relatorioVisivel: false }),

  calcular: () => {
    const s = get();
    // Entrada da guarda da folha: no modo CNPJ usamos os anexos do CNAE
    // escolhido; no manual, o anexo selecionado. Flags de auditoria viajam
    // junto para o domínio decidir sujeição sem depender da UI.
    const opCnpj = s.modo === 'cnpj' && s.cnaeEscolhido ? s.opcoes.find((o) => o.cnae7 === s.cnaeEscolhido) : undefined;
    const entradaFolha: ParamsValidacaoFatorR = {
      folha12: s.folha12,
      folhaInformada: s.folhaInformada,
      semFolhaConfirmado: s.semFolhaConfirmado,
      rbt12: s.rbt12,
      anexos: s.modo === 'cnpj' ? (opCnpj?.anexos ?? []) : [s.anexoId],
      cnaeFatorR: Boolean(opCnpj?.exigeFatorR || opCnpj?.tabela?.fatorR),
      sujeitaFatorR: s.sujeitaFatorR,
    };
    // Guardas fail-closed (fonte: `@/domain/simples/validacao`): Infinity,
    // <= 0, RBT12 > 4.8M e folha ausente/inválida geram mensagem explícita e
    // NUNCA DAS 0 exibível (relatório escondido, resultados zerados).
    try {
      exigirRbtReceita(s.rbt12, s.receitaMes);
      exigirFolha12(entradaFolha);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const codigo = msg.split(':')[0];
      const msgFolha =
        codigo === 'folha12-invalida'
          ? 'Não foi possível calcular: folha 12m inválida. Use um número maior ou igual a zero (ex.: 150000).'
          : codigo === 'rbt12-invalido'
            ? 'Não foi possível calcular: folha 12m não validada — informe RBT12 maior que zero.'
            : 'Não foi possível calcular: folha 12m não informada. Volte à etapa 1 e preencha o campo.';
      toast(msg.startsWith('desenquadramento-simples')
        ? 'RBT12 acima de R$ 4.800.000: empresa desenquadrada do Simples — revise os valores.'
        : msg.startsWith('rbt12-') || msg.startsWith('receita-')
          ? 'Informe RBT12 e receita do mês maiores que zero para calcular o DAS.'
          : msgFolha, 'warn');
      rawSet({ convencional: null, hibrido: null, debitosCBS: 0, creditosCBS: 0, relatorioVisivel: false });
      return;
    }
    // Sublimite estadual (passo 1): RBT12/RBA acima de R$ 3,6M tira
    // ICMS/ISS/IBS da guia. Com excesso, o comparativo híbrido é ativado
    // sozinho (o usuário pode desmarcar) — é o cálculo que faz sentido.
    const estourado = sublimiteEstourado(s);
    const comparar = s.compararHibrido || estourado;
    // Fator R SOMENTE quando a sujeição foi confirmada pelo domínio (III/V
    // sujeitos). Fora disso a folha fica registrada, sem efeito no anexo.
    const validacaoFolha = validarFolhaObrigatoria(entradaFolha);
    let anexoEfetivo = s.anexoId;
    if (validacaoFolha.aplicavel && s.rbt12 > 0) {
      anexoEfetivo = fatorR(s.folha12, s.rbt12).anexo;
    }
    const conv = calcularConvencional({
      anexoId: anexoEfetivo,
      rbt12: s.rbt12,
      receitaMes: s.receitaMes,
      rba: rbaEfetiva(s),
      aliqRefICMS: s.aliqRefICMS,
      aliqRefISS: s.aliqRefISS,
    });
    // Publicação usa o setter cru: `compararHibrido` é chave de entrada e,
    // pelo `set` público, esconderia o relatório que acabamos de calcular.
    if (!comparar) {
      rawSet({ convencional: conv, hibrido: null, debitosCBS: 0, creditosCBS: 0, relatorioVisivel: true });
      return;
    }
    const debitos = debitoCBS(s.receitaMes, 'cheia', s.cbsRef);
    const creditos =
      Math.round(s.despesas.reduce((acc, d) => acc + (Number(d.valor) || 0) * (Number(s.cbsRef) || 0) * fatorDespesa(d), 0) * 100) / 100;
    const hib = calcularHibrido({ convencional: conv, debitosCBS: debitos, creditosCBS: creditos });
    rawSet({ convencional: conv, hibrido: hib, debitosCBS: debitos, creditosCBS: creditos, relatorioVisivel: true, compararHibrido: comparar });
  },

  buscarPorCnpj: async (opts) => {
    const s = get();
    const dig = s.cnpj.replace(/\D+/g, '');
    if (dig.length !== 14) {
      toast('Informe um CNPJ com 14 dígitos.', 'warn');
      return;
    }
    // Ano de referência do enriquecimento NBS (09-04, default 2033 — regime
    // pleno). Só precifica o bloco INFORMATIVO; o DAS (`calculo.ts`) nem vê.
    const ano = normalizarAnoReferencia(opts?.anoReferencia ?? ANO_REFERENCIA_PADRAO);
    get().set({ buscandoCnpj: true });
    try {
      const dados = await buscarCnpj(dig);
      const todos: { codigo: string; descricao: string; principal: boolean }[] = [];
      if (dados.cnaePrincipal) todos.push({ codigo: dados.cnaePrincipal, descricao: dados.cnaePrincipalDescricao ?? '', principal: true });
      for (const sec of dados.cnaesSecundarios ?? []) {
        if (sec.codigo && !todos.some((t) => t.codigo === sec.codigo)) {
          todos.push({ codigo: sec.codigo, descricao: sec.descricao, principal: false });
        }
      }
      const opcoes: CnaeOpcao[] = [];
      for (const t of todos) {
        const c7 = codigo7De(t.codigo);
        let tabela: CnaeAnexo | null = null;
        try {
          tabela = (await db.cnae.get(c7)) ?? null;
        } catch {
          tabela = null;
        }
        const anexos = normalizarListaAnexosSimples(tabela?.anexos ?? []);
        const exigeFatorR = Boolean(tabela && (tabela.fatorR || anexos.includes('V')));
        // Mesma regra do CNPJ Serviços (09-04): camada 1 sempre + camada 2
        // best-effort (cache por NBS). Nunca quebra a lista se falhar.
        let regras: RegraCnae | null = null;
        try {
          regras = await regrasDoCnae(c7);
        } catch {
          regras = null;
        }
        let estadoNbs: EstadoNbsAtividade = 'sem-mapeamento-NBS';
        let nbsLista: VereditoNbs[] = [];
        let nbsComBeneficio = 0;
        let maisProvavel: string | null = null;
        try {
          const c = await consultarPorCnae(c7, { anoReferencia: ano });
          estadoNbs = c.estadoNbs;
          nbsLista = c.vereditos;
          nbsComBeneficio = c.vereditos.filter((v) => v.temBeneficio).length;
          maisProvavel = c.maisProvavel;
        } catch {
          estadoNbs = regras?.estado === 'ok' && regras.ehBens ? 'bens→NCM' : 'sem-mapeamento-NBS';
        }
        opcoes.push({
          cnae7: c7,
          codigoFormatado: tabela?.codigoFormatado ?? t.codigo,
          descricao: tabela?.descricao ?? t.descricao ?? 'CNAE fora da tabela viva',
          principal: t.principal,
          tabela,
          anexos,
          exigeFatorR,
          regras,
          nbsLista,
          nbsComBeneficio,
          maisProvavel,
          estadoNbs,
          anoReferencia: ano,
        });
      }
      // Fluxo sem scroll: NÃO pré-seleciona. O usuário escolhe 1 CNAE na lista
      // ("Qual atividade usar?") e só então o Passo 2 aparece. Isso oculta os
      // cálculos inicialmente e evita rolagem com todas as atividades + campos.
      get().set({
        empresaNome: dados.razaoSocial,
        opcaoSimples: dados.opcaoSimples,
        opcoes,
        cnaeEscolhido: '',
        relatorioVisivel: false,
        convencional: null,
        hibrido: null,
      });
      if (!opcoes.length) toast('CNPJ sem CNAEs retornados pela BrasilAPI.', 'warn');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'err');
    } finally {
      get().set({ buscandoCnpj: false });
    }
  },

  escolherCnae: (cnae7) => {
    const s = get();
    const op = s.opcoes.find((o) => o.cnae7 === cnae7);
    if (!op) {
      get().set({ cnaeEscolhido: cnae7, relatorioVisivel: false });
      return;
    }
    const validos = normalizarListaAnexosSimples(op.anexos).filter((a) => (ANEXOS_SIMPLES as Record<string, unknown>)[a]);
    let sugerido: AnexoSimplesId = s.anexoId;
    if (validos.length === 1) {
      sugerido = validos[0] as AnexoSimplesId;
    } else if (validos.includes('V')) {
      // Base V; Fator R (folha) decide III vs V no cálculo.
      sugerido = 'V';
    } else if (validos.length > 1) {
      sugerido = (validos[0] as AnexoSimplesId) ?? s.anexoId;
    }
    // Trocar CNAE NÃO apaga a folha (nem as flags de auditoria): apenas
    // recalcula a sujeição a partir do CNAE. Opt-out explícito (Anexo III
    // puro) deve ser reaplicado via `set({ sujeitaFatorR: false })` depois
    // da escolha.
    const usaFatorR = validos.includes('III') || validos.includes('V') || op.exigeFatorR || Boolean(op.tabela?.fatorR);
    get().set({
      cnaeEscolhido: cnae7,
      anexoId: sugerido,
      sujeitaFatorR: usaFatorR,
      relatorioVisivel: false,
    });
  },

  limpar: () =>
    get().set({
      anexoId: 'I',
      escolheuAnexo: false,
      rbt12: 0,
      receitaMes: 0,
      folha12: 0,
      folhaInformada: false,
      semFolhaConfirmado: false,
      sujeitaFatorR: true,
      rba: 0,
      usarRba: false,
      aliqRefICMS: null,
      aliqRefISS: null,
      compararHibrido: false,
      convencional: null,
      hibrido: null,
      relatorioVisivel: false,
      segAtivo: false,
      segParcelas: [],
      opcoes: [],
      cnaeEscolhido: '',
      empresaNome: '',
    }),
}));

registrarLimpeza('simples', () => useSimples.getState().limpar());

export function creditoDeDespesa(valor: number, regra: RegraCreditoCBS, cbsRef: number): number {
  return creditoCBS(valor, regra, cbsRef);
}
