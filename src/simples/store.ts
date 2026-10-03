/**
 * Simples Nacional — store isolada (Zustand).
 * NÃO importa `@/store/calculadora`. Reusa apenas CNPJ/CNAE + UI.
 *
 * Fluxo em etapas (refino):
 * - Passo 1: escolher Anexo (manual) ou CNPJ+CNAE (automático).
 *   Restante só aparece após essa escolha.
 * - Folha (Fator R) só aparece quando Anexo V está envolvido:
 *   manual com V, ou CNAE que traz V.
 * - Relatório lateral só após "Visualizar cálculo com Aurum AI".
 * - Híbrido só quando o usuário opta por comparar.
 */
import { create } from 'zustand';
import { ANEXOS_SIMPLES, CBS_REF_PADRAO, type AnexoSimplesId } from './tabelas';
import {
  calcularConvencional,
  calcularHibrido,
  debitoCBS,
  creditoCBS,
  fatorR,
  type RegraCreditoCBS,
  type ResultadoConvencional,
  type ResultadoHibrido,
} from './calculo';
import { codigo7De } from '@/domain/services/cnae';
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

export interface CnaeOpcao {
  cnae7: string;
  codigoFormatado: string;
  descricao: string;
  principal: boolean;
  tabela: CnaeAnexo | null;
  anexos: string[];
  exigeFatorR: boolean;
}

interface SimplesState {
  modo: ModoSimples;
  anexoId: AnexoSimplesId;
  /** Passo 1 manual concluído (clicou num Anexo). */
  escolheuAnexo: boolean;
  rbt12: number;
  receitaMes: number;
  folha12: number;
  rba: number;
  usarRba: boolean;
  cbsRef: number;
  despesas: DespesaSimples[];
  compararHibrido: boolean;
  // CNPJ
  cnpj: string;
  buscandoCnpj: boolean;
  empresaNome: string;
  opcaoSimples: boolean | null;
  opcoes: CnaeOpcao[];
  cnaeEscolhido: string;
  // resultado (só visível após botão Aurum AI)
  relatorioVisivel: boolean;
  convencional: ResultadoConvencional | null;
  hibrido: ResultadoHibrido | null;
  debitosCBS: number;
  creditosCBS: number;

  set: (p: Partial<SimplesState>) => void;
  setAnexo: (a: AnexoSimplesId) => void;
  setDespesas: (d: DespesaSimples[]) => void;
  tocarEntrada: () => void;
  calcular: () => void;
  buscarPorCnpj: () => Promise<void>;
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

export function fatorDespesa(d: DespesaSimples): number {
  if (/aluguel/i.test(d.rotulo)) return 0.3;
  if (d.regra === 'integral') return 1;
  if (d.regra === 'red30') return 0.7;
  if (d.regra === 'red60') return 0.4;
  return 0;
}

/** Normaliza `anexos` vindos do Dexie/JSON em lista limpa `['III','V']`.
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

export const useSimples = create<SimplesState>((set, get) => ({
  modo: 'manual',
  anexoId: 'I',
  escolheuAnexo: false,
  rbt12: 0,
  receitaMes: 0,
  folha12: 0,
  rba: 0,
  usarRba: false,
  cbsRef: CBS_REF_PADRAO,
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

  set: (p) => {
    // Trocar de modo esconde o relatório (novo passo 1).
    if (p.modo && p.modo !== get().modo) {
      set({ ...p, relatorioVisivel: false });
      return;
    }
    set(p);
  },

  setAnexo: (a) => {
    set({ anexoId: a, escolheuAnexo: true, relatorioVisivel: false });
  },

  setDespesas: (d) => {
    set({ despesas: d, relatorioVisivel: false });
  },

  tocarEntrada: () => set({ relatorioVisivel: false }),

  calcular: () => {
    const s = get();
    if (!(s.rbt12 > 0) || !(s.receitaMes > 0)) {
      set({ convencional: null, hibrido: null, debitosCBS: 0, creditosCBS: 0, relatorioVisivel: false });
      return;
    }
    // Fator R SOMENTE quando Anexo V envolvido.
    let anexoEfetivo = s.anexoId;
    if (envolveAnexoV(s) && s.folha12 > 0 && s.rbt12 > 0) {
      anexoEfetivo = fatorR(s.folha12, s.rbt12).anexo;
    }
    const conv = calcularConvencional({
      anexoId: anexoEfetivo,
      rbt12: s.rbt12,
      receitaMes: s.receitaMes,
      rba: s.usarRba ? s.rba : s.rbt12,
    });
    if (!s.compararHibrido) {
      set({ convencional: conv, hibrido: null, debitosCBS: 0, creditosCBS: 0, relatorioVisivel: true });
      return;
    }
    const debitos = debitoCBS(s.receitaMes, 'cheia', s.cbsRef);
    const creditos =
      Math.round(s.despesas.reduce((acc, d) => acc + (Number(d.valor) || 0) * (Number(s.cbsRef) || 0) * fatorDespesa(d), 0) * 100) / 100;
    const hib = calcularHibrido({ convencional: conv, debitosCBS: debitos, creditosCBS: creditos });
    set({ convencional: conv, hibrido: hib, debitosCBS: debitos, creditosCBS: creditos, relatorioVisivel: true });
  },

  buscarPorCnpj: async () => {
    const s = get();
    const dig = s.cnpj.replace(/\D+/g, '');
    if (dig.length !== 14) {
      toast('Informe um CNPJ com 14 dígitos.', 'warn');
      return;
    }
    set({ buscandoCnpj: true });
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
        opcoes.push({
          cnae7: c7,
          codigoFormatado: tabela?.codigoFormatado ?? t.codigo,
          descricao: tabela?.descricao ?? t.descricao ?? 'CNAE fora da tabela viva',
          principal: t.principal,
          tabela,
          anexos,
          exigeFatorR,
        });
      }
      // Fluxo sem scroll: NÃO pré-seleciona. O usuário escolhe 1 CNAE na lista
      // ("Qual atividade usar?") e só então o Passo 2 aparece. Isso oculta os
      // cálculos inicialmente e evita rolagem com todas as atividades + campos.
      set({
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
      set({ buscandoCnpj: false });
    }
  },

  escolherCnae: (cnae7) => {
    const s = get();
    const op = s.opcoes.find((o) => o.cnae7 === cnae7);
    if (!op) {
      set({ cnaeEscolhido: cnae7, relatorioVisivel: false });
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
    set({ cnaeEscolhido: cnae7, anexoId: sugerido, relatorioVisivel: false });
  },

  limpar: () =>
    set({
      anexoId: 'I',
      escolheuAnexo: false,
      rbt12: 0,
      receitaMes: 0,
      folha12: 0,
      rba: 0,
      usarRba: false,
      compararHibrido: false,
      convencional: null,
      hibrido: null,
      relatorioVisivel: false,
      opcoes: [],
      cnaeEscolhido: '',
      empresaNome: '',
    }),
}));

registrarLimpeza('simples', () => useSimples.getState().limpar());

export function creditoDeDespesa(valor: number, regra: RegraCreditoCBS, cbsRef: number): number {
  return creditoCBS(valor, regra, cbsRef);
}
