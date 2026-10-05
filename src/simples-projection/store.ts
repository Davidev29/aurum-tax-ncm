/**
 * Simples Projection — store da simulação de divisão (camada ADITIVA).
 *
 * Padrão do projeto: Zustand isolado por domínio (espelha `src/simples/store.ts`).
 * Não toca `useSimples`. Apenas lê dele via `hidratarDoSimples` para
 * pré-preencher o cenário real do cliente (CNPJ, anexo, RBT12, receita, folha).
 *
 * Reatividade: o resultado é derivado por `simularCenarioDividido` (puro e
 * síncrono) via `useMemo` na view — qualquer edição de receita/percentual/
 * anexo/custo recalcula instantaneamente faixa, alíquota, DAS e payback.
 */
import { create } from 'zustand';
import type { AnexoSimplesId } from '@/simples/tabelas';
import type { MesReceita } from './types';

export interface ContextoSimplesReal {
  cnpj: string;
  empresaNome: string;
  opcaoSimples: boolean | null;
  cnaeEscolhido: string;
  anexoSugerido: AnexoSimplesId;
  rbt12: number;
  receitaMes: number;
  folha12: number;
}

export type ModoReceita = 'mensal' | 'global';

interface ProjecaoDivididaState {
  aberto: boolean;
  contexto: ContextoSimplesReal | null;
  mesInicio: string;
  horizonte: number;
  modoReceita: ModoReceita;
  /** Série TOTAL projetada (editável mês a mês no modo 'mensal'). */
  receitaTotalMensal: MesReceita[];
  /** Valor global usado no modo 'global' (replicado mês a mês). */
  receitaGlobal: number;
  /** Histórico 12m da mãe anterior ao mesInicio (cenário real). */
  historicoMae12: MesReceita[];
  percentualNova: number;
  anexoMae: AnexoSimplesId;
  anexoNova: AnexoSimplesId;
  folha12Mae: number;
  folha12Nova: number;
  custoMensalNova: number;
  mesesAtividadeNova: number;

  abrir: (ctx: ContextoSimplesReal) => void;
  fechar: () => void;
  set: (p: Partial<ProjecaoDivididaState>) => void;
  setReceitaMes: (mes: string, valor: number) => void;
  setHistoricoMaeMes: (mes: string, valor: number) => void;
  usarReceitaAtualComoBase: () => void;
  distribuirGlobal: () => void;
}

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function somarMeses(base: string, delta: number): string {
  const [a, m] = base.split('-').map(Number);
  const d = new Date(Date.UTC(a, (m ?? 1) - 1 + delta, 1));
  const y = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${mm}`;
}

export function gerarSequencia(mesInicio: string, n: number, valor: number): MesReceita[] {
  const out: MesReceita[] = [];
  for (let i = 0; i < n; i++) out.push({ mes: somarMeses(mesInicio, i), receita: valor });
  return out;
}

function mesAtualRef(): string {
  const d = new Date();
  const prox = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return `${prox.getFullYear()}-${String(prox.getMonth() + 1).padStart(2, '0')}`;
}

function historicoProporcional(rbt12: number): MesReceita[] {
  const inicio = somarMeses(mesAtualRef(), -12);
  const media = Math.round(((Number(rbt12) || 0) / 12) * 100) / 100;
  return gerarSequencia(inicio, 12, media);
}

export function mesInicioValido(v: string): boolean {
  return MES_RE.test(v);
}

export const useProjecaoDividida = create<ProjecaoDivididaState>((set, get) => ({
  aberto: false,
  contexto: null,
  mesInicio: mesAtualRef(),
  horizonte: 12,
  modoReceita: 'mensal',
  receitaTotalMensal: [],
  receitaGlobal: 0,
  historicoMae12: [],
  percentualNova: 0.3,
  anexoMae: 'III',
  anexoNova: 'III',
  folha12Mae: 0,
  folha12Nova: 0,
  custoMensalNova: 0,
  mesesAtividadeNova: 0,

  abrir: (ctx) => {
    const mesInicio = mesAtualRef();
    const receitaBase = Number(ctx.receitaMes) || 0;
    const horizonte = 12;
    set({
      aberto: true,
      contexto: ctx,
      mesInicio,
      horizonte,
      modoReceita: 'mensal',
      receitaTotalMensal: gerarSequencia(mesInicio, horizonte, receitaBase),
      receitaGlobal: receitaBase,
      historicoMae12: historicoProporcional(ctx.rbt12),
      percentualNova: 0.3,
      anexoMae: ctx.anexoSugerido,
      anexoNova: ctx.anexoSugerido,
      folha12Mae: Number(ctx.folha12) || 0,
      folha12Nova: 0,
      custoMensalNova: 0,
      mesesAtividadeNova: 0,
    });
  },

  fechar: () => set({ aberto: false }),

  set: (p) => {
    const s = get();
    const next = { ...p };
    // Trocar mesInicio/horizonte realinha as séries preservando valores digitados.
    if (p.mesInicio !== undefined || p.horizonte !== undefined) {
      const mi = (p.mesInicio ?? s.mesInicio).trim();
      const hz = Math.max(1, Math.min(24, Math.round(p.horizonte ?? s.horizonte)));
      if (mesInicioValido(mi)) {
        const antiga = new Map(s.receitaTotalMensal.map((r) => [r.mes, r.receita]));
        const novaSerie: MesReceita[] = [];
        for (let i = 0; i < hz; i++) {
          const mes = somarMeses(mi, i);
          novaSerie.push({ mes, receita: antiga.get(mes) ?? s.receitaGlobal ?? 0 });
        }
        (next as Partial<ProjecaoDivididaState>).receitaTotalMensal = novaSerie;
        (next as Partial<ProjecaoDivididaState>).horizonte = hz;
        (next as Partial<ProjecaoDivididaState>).mesInicio = mi;
      }
    }
    if (p.receitaGlobal !== undefined) {
      (next as Partial<ProjecaoDivididaState>).receitaGlobal = Math.max(0, Number(p.receitaGlobal) || 0);
    }
    if (p.percentualNova !== undefined) {
      const v = Number(p.percentualNova);
      (next as Partial<ProjecaoDivididaState>).percentualNova = Number.isFinite(v)
        ? Math.min(0.95, Math.max(0.05, v))
        : s.percentualNova;
    }
    set(next);
  },

  setReceitaMes: (mes, valor) =>
    set((st) => ({
      receitaTotalMensal: st.receitaTotalMensal.map((r) => (r.mes === mes ? { ...r, receita: Math.max(0, Number(valor) || 0) } : r)),
    })),

  setHistoricoMaeMes: (mes, valor) =>
    set((st) => ({
      historicoMae12: st.historicoMae12.map((r) => (r.mes === mes ? { ...r, receita: Math.max(0, Number(valor) || 0) } : r)),
    })),

  usarReceitaAtualComoBase: () => {
    const s = get();
    const base = Number(s.contexto?.receitaMes) || 0;
    set({
      receitaGlobal: base,
      receitaTotalMensal: gerarSequencia(s.mesInicio, s.horizonte, base),
      historicoMae12: historicoProporcional(Number(s.contexto?.rbt12) || 0),
    });
  },

  distribuirGlobal: () => {
    const s = get();
    set({ receitaTotalMensal: gerarSequencia(s.mesInicio, s.horizonte, Math.max(0, Number(s.receitaGlobal) || 0)) });
  },
}));
