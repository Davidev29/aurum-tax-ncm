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
import { distribuirRTB12 } from './baseline';
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
export type ModoRTB12 = 'manual' | 'automatico';
export type ModoComparacao = 'segregada' | 'unica';

/** Parcela da receita da empresa tributada em um anexo (segregação intra-empresa). */
export interface ComposicaoAnexoExtra {
  anexoId: AnexoSimplesId;
  /** 0..1 — fração da receita da empresa neste anexo (resto fica no anexo principal). */
  percentual: number;
}

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
  /** Modo de entrada da RTB12: manual (mês a mês) ou automático (distribuído). */
  modoRTB12: ModoRTB12;
  /** Total da RTB12 no modo automático. */
  rtb12Total: number;
  /** Curva de distribuição no modo automático. */
  curvaDistribuicao: 'igual' | 'crescente' | 'sazonal';
  percentualNova: number;
  anexoMae: AnexoSimplesId;
  anexoNova: AnexoSimplesId;
  /** Segundo anexo da receita (null = 100% no principal). Ex.: mãe 60% I + 40% III. */
  composicaoExtraMae: ComposicaoAnexoExtra | null;
  composicaoExtraNova: ComposicaoAnexoExtra | null;
  folha12Mae: number;
  folha12Nova: number;
  /** false = Anexo III puro (sem Fator R). Default true (sujeita). */
  sujeitaFatorRMae: boolean;
  sujeitaFatorRNova: boolean;
  custoMensalNova: number;
  custoInicialNova: number;
  margemEmpate: number;
  /** Toggle Empresa única ↔ Segregada (comparativo com crossfade). */
  modoComparacao: ModoComparacao;
  mesesAtividadeNova: number;
  /** Meses de atividade da MÃE na abertura (12+ = regime cheio; <12 = proporcional). */
  mesesAtividadeMae: number;
  /** Receita da competência em curso — base que semeia a projeção (tela 1). */
  receitaMesAtual: number;
  /** true quando o usuário editou a projeção (semeadura automática desativada). */
  projecaoSuja: boolean;

  abrir: (ctx: ContextoSimplesReal) => void;
  fechar: () => void;
  set: (p: Partial<ProjecaoDivididaState>) => void;
  setReceitaMes: (mes: string, valor: number) => void;
  setHistoricoMaeMes: (mes: string, valor: number) => void;
  usarReceitaAtualComoBase: () => void;
  distribuirGlobal: () => void;
  /** Distribui rtb12Total pelos 12 meses do histórico (modo automático). */
  distribuirRTB12Historico: () => void;
  /** Preenche a projeção com a média mensal do histórico (puxa histórico → projeção). */
  puxarMediaHistorico: () => void;
  /** Semeia a projeção (mês atual, senão média) se o usuário ainda não a editou. */
  semearProjecaoSeLimpa: () => void;
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

/**
 * Início da projeção = competência em curso (mês atual do calendário).
 * A RBT12 de cada mês projetado cobre [t-12, t-1]: termina no "Atual − 1"
 * e nunca inclui a competência em curso — cada competência só entra na
 * RBT12 a partir do mês seguinte (LC 123/2006, art. 18).
 */
function mesAtualRef(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function historicoProporcional(rbt12: number, mesInicio?: string): MesReceita[] {
  const ref = mesInicio ?? mesAtualRef();
  const inicio = somarMeses(ref, -12);
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
  modoRTB12: 'automatico',
  rtb12Total: 0,
  curvaDistribuicao: 'igual',
  percentualNova: 0.3,
  anexoMae: 'III',
  anexoNova: 'III',
  composicaoExtraMae: null,
  composicaoExtraNova: null,
  folha12Mae: 0,
  folha12Nova: 0,
  sujeitaFatorRMae: true,
  sujeitaFatorRNova: true,
  custoMensalNova: 0,
  custoInicialNova: 0,
  margemEmpate: 1000,
  modoComparacao: 'segregada',
  mesesAtividadeNova: 0,
  mesesAtividadeMae: 12,
  receitaMesAtual: 0,
  projecaoSuja: false,

  abrir: (ctx) => {
    const mesInicio = mesAtualRef();
    const rtb12 = Number(ctx.rbt12) || 0;
    // Se a receita do mês veio zerada, usa a média do histórico para não
    // abrir o wizard com a projeção vazia (steps seguintes sem valores).
    const receitaBase = Number(ctx.receitaMes) || Math.round((rtb12 / 12) * 100) / 100 || 0;
    const horizonte = 12;
    set({
      aberto: true,
      contexto: ctx,
      mesInicio,
      horizonte,
      modoReceita: 'mensal',
      receitaTotalMensal: gerarSequencia(mesInicio, horizonte, receitaBase),
      receitaGlobal: receitaBase,
      historicoMae12: historicoProporcional(rtb12, mesInicio),
      modoRTB12: 'automatico',
      rtb12Total: rtb12,
      curvaDistribuicao: 'igual',
      percentualNova: 0.3,
      anexoMae: ctx.anexoSugerido,
      anexoNova: ctx.anexoSugerido,
      composicaoExtraMae: null,
      composicaoExtraNova: null,
      folha12Mae: Number(ctx.folha12) || 0,
      folha12Nova: 0,
      sujeitaFatorRMae: true,
      sujeitaFatorRNova: true,
      custoMensalNova: 0,
      custoInicialNova: 0,
      margemEmpate: 1000,
      modoComparacao: 'segregada',
      mesesAtividadeNova: 0,
      mesesAtividadeMae: 12,
      receitaMesAtual: receitaBase,
      projecaoSuja: false,
    });
    // Persiste a RTB12 herdada por CNPJ/período (best-effort).
    try {
      if (ctx?.cnpj) {
        import('./persistencia').then((m) => {
          const s = get();
          if (s.historicoMae12.length) m.salvarRTB12(ctx.cnpj, mesInicio, s.historicoMae12);
        }).catch(() => undefined);
      }
    } catch {
      /* sem persistência */
    }
  },

  fechar: () => set({ aberto: false }),

  set: (p) => {
    const s = get();
    const next = { ...p };
    const mesInicioNovo = p.mesInicio !== undefined || p.horizonte !== undefined;
    // Trocar mesInicio/horizonte realinha as séries preservando valores digitados.
    if (mesInicioNovo) {
      const mi = (p.mesInicio ?? s.mesInicio).trim();
      const hz = Math.max(1, Math.min(24, Math.round(p.horizonte ?? s.horizonte)));
      if (mesInicioValido(mi)) {
        const antiga = new Map(s.receitaTotalMensal.map((r) => [r.mes, r.receita]));
        const baseGlobal = p.receitaGlobal ?? s.receitaGlobal ?? 0;
        const novaSerie: MesReceita[] = [];
        for (let i = 0; i < hz; i++) {
          const mes = somarMeses(mi, i);
          novaSerie.push({ mes, receita: antiga.get(mes) ?? baseGlobal });
        }
        (next as Partial<ProjecaoDivididaState>).receitaTotalMensal = novaSerie;
        (next as Partial<ProjecaoDivididaState>).horizonte = hz;
        (next as Partial<ProjecaoDivididaState>).mesInicio = mi;
        // O histórico acompanha o mesInicio (12 meses anteriores), preservando
        // valores já digitados por rótulo de mês. No modo automático,
        // redistribui o total nos novos rótulos em vez de carregar zeros.
        const modoHist = (p.modoRTB12 ?? s.modoRTB12);
        const totalAuto = Math.max(0, Number(p.rtb12Total ?? s.rtb12Total) || 0);
        if (modoHist === 'automatico' && totalAuto > 0 && p.rtb12Total === undefined && p.curvaDistribuicao === undefined) {
          const mesesAuto: string[] = [];
          for (let i = 12; i >= 1; i--) mesesAuto.push(somarMeses(mi, -i));
          try {
            (next as Partial<ProjecaoDivididaState>).historicoMae12 = distribuirRTB12(
              totalAuto, mesesAuto, (p.curvaDistribuicao ?? s.curvaDistribuicao),
            );
          } catch {
            const histAntigo = new Map(s.historicoMae12.map((r) => [r.mes, r.receita]));
            const histNovo: MesReceita[] = [];
            for (let i = 12; i >= 1; i--) {
              const mes = somarMeses(mi, -i);
              histNovo.push({ mes, receita: histAntigo.get(mes) ?? 0 });
            }
            (next as Partial<ProjecaoDivididaState>).historicoMae12 = histNovo;
          }
        } else {
          const histAntigo = new Map(s.historicoMae12.map((r) => [r.mes, r.receita]));
          const histNovo: MesReceita[] = [];
          for (let i = 12; i >= 1; i--) {
            const mes = somarMeses(mi, -i);
            histNovo.push({ mes, receita: histAntigo.get(mes) ?? 0 });
          }
          (next as Partial<ProjecaoDivididaState>).historicoMae12 = histNovo;
        }
      }
    }
    if (p.receitaGlobal !== undefined) {
      const g = Math.max(0, Number(p.receitaGlobal) || 0);
      (next as Partial<ProjecaoDivididaState>).receitaGlobal = g;
      (next as Partial<ProjecaoDivididaState>).projecaoSuja = true;
      // Automático: no modo global, digitar o valor já replica nos meses.
      const modo = (p.modoReceita ?? s.modoReceita);
      if (modo === 'global') {
        const mi = mesInicioValido(String(p.mesInicio ?? s.mesInicio)) ? String(p.mesInicio ?? s.mesInicio) : s.mesInicio;
        const hz = Math.max(1, Math.min(24, Math.round(p.horizonte ?? s.horizonte)));
        (next as Partial<ProjecaoDivididaState>).receitaTotalMensal = gerarSequencia(mi, hz, g);
      }
    }
    if (p.receitaMesAtual !== undefined) {
      const v = Math.max(0, Number(p.receitaMesAtual) || 0);
      (next as Partial<ProjecaoDivididaState>).receitaMesAtual = v;
      // Semeia a projeção com o mês atual enquanto o usuário não a editou.
      if (!s.projecaoSuja && v > 0) {
        const mi = mesInicioValido(String(p.mesInicio ?? next.mesInicio ?? s.mesInicio))
          ? String(p.mesInicio ?? (next as Partial<ProjecaoDivididaState>).mesInicio ?? s.mesInicio)
          : s.mesInicio;
        const hz = Math.max(1, Math.min(24, Math.round(p.horizonte ?? s.horizonte)));
        (next as Partial<ProjecaoDivididaState>).receitaGlobal = v;
        (next as Partial<ProjecaoDivididaState>).receitaTotalMensal = gerarSequencia(mi, hz, v);
      }
    }
    if (p.modoReceita !== undefined && p.modoReceita === 'global' && p.receitaGlobal === undefined) {
      // Trocar para global replica o valor atual automaticamente.
      const g = Math.max(0, Number(s.receitaGlobal) || 0);
      const mi = mesInicioValido(String(p.mesInicio ?? s.mesInicio)) ? String(p.mesInicio ?? s.mesInicio) : s.mesInicio;
      const hz = Math.max(1, Math.min(24, Math.round(p.horizonte ?? s.horizonte)));
      (next as Partial<ProjecaoDivididaState>).receitaTotalMensal = gerarSequencia(mi, hz, g);
    }
    if (p.percentualNova !== undefined) {
      const v = Number(p.percentualNova);
      // Slider dinâmico 0–100%: extremos válidos (0 = tudo na mãe, 1 = tudo na nova).
      (next as Partial<ProjecaoDivididaState>).percentualNova = Number.isFinite(v)
        ? Math.min(1, Math.max(0, v))
        : s.percentualNova;
    }
    if (p.custoInicialNova !== undefined) {
      (next as Partial<ProjecaoDivididaState>).custoInicialNova = Math.max(0, Number(p.custoInicialNova) || 0);
    }
    if (p.margemEmpate !== undefined) {
      (next as Partial<ProjecaoDivididaState>).margemEmpate = Math.max(0, Number(p.margemEmpate) || 0);
    }
    if (p.rtb12Total !== undefined) {
      const t = Math.max(0, Number(p.rtb12Total) || 0);
      (next as Partial<ProjecaoDivididaState>).rtb12Total = t;
      // Automático: digitar o total já distribui pelos 12 meses (sem clique).
      const modo = (p.modoRTB12 ?? s.modoRTB12);
      if (modo === 'automatico' && t > 0) {
        const mi = mesInicioValido(String(p.mesInicio ?? next.mesInicio ?? s.mesInicio))
          ? String(p.mesInicio ?? (next as Partial<ProjecaoDivididaState>).mesInicio ?? s.mesInicio)
          : s.mesInicio;
        const meses: string[] = [];
        for (let i = 12; i >= 1; i--) meses.push(somarMeses(mi, -i));
        try {
          (next as Partial<ProjecaoDivididaState>).historicoMae12 = distribuirRTB12(
            t, meses, (p.curvaDistribuicao ?? s.curvaDistribuicao),
          );
        } catch {
          /* validação exibe o erro na UI */
        }
      }
    }
    if ((p.curvaDistribuicao !== undefined || p.modoRTB12 === 'automatico') && p.rtb12Total === undefined) {
      // Trocar a curva (ou voltar ao automático) redistribui o total atual.
      const t = Math.max(0, Number(s.rtb12Total) || 0);
      if (t > 0) {
        const mi = mesInicioValido(String(p.mesInicio ?? next.mesInicio ?? s.mesInicio))
          ? String(p.mesInicio ?? (next as Partial<ProjecaoDivididaState>).mesInicio ?? s.mesInicio)
          : s.mesInicio;
        const meses: string[] = [];
        for (let i = 12; i >= 1; i--) meses.push(somarMeses(mi, -i));
        try {
          (next as Partial<ProjecaoDivididaState>).historicoMae12 = distribuirRTB12(
            t, meses, (p.curvaDistribuicao ?? s.curvaDistribuicao),
          );
        } catch {
          /* validação exibe o erro na UI */
        }
      }
    }
    set(next);
  },

  setReceitaMes: (mes, valor) =>
    set((st) => ({
      // Edição manual de um mês implica modo mensal (não deixa o global
      // sobrescrever o ajuste fino na próxima digitação).
      modoReceita: 'mensal',
      projecaoSuja: true,
      receitaTotalMensal: st.receitaTotalMensal.map((r) => (r.mes === mes ? { ...r, receita: Math.max(0, Number(valor) || 0) } : r)),
    })),

  setHistoricoMaeMes: (mes, valor) =>
    set((st) => {
      const historicoMae12 = st.historicoMae12.map((r) => (r.mes === mes ? { ...r, receita: Math.max(0, Number(valor) || 0) } : r));
      // Mantém o total sincronizado para alternar manual ↔ automático sem perda.
      const rtb12Total = Math.round(historicoMae12.reduce((a, r) => a + (Number(r.receita) || 0), 0) * 100) / 100;
      // Edição manual de um mês distribuído implica modo manual — protege o
      // ajuste fino de ser apagado pela próxima redistribuição automática.
      return { historicoMae12, rtb12Total, modoRTB12: 'manual' as const };
    }),

  usarReceitaAtualComoBase: () => {
    // Só a projeção é refeita — o histórico digitado na tela 1 é preservado.
    const s = get();
    const base = Number(s.contexto?.receitaMes) || Number(s.receitaMesAtual) || Math.round((Number(s.rtb12Total) / 12) * 100) / 100 || 0;
    set({
      receitaGlobal: base,
      receitaMesAtual: base,
      receitaTotalMensal: gerarSequencia(s.mesInicio, s.horizonte, base),
      projecaoSuja: false,
    });
  },

  distribuirGlobal: () => {
    const s = get();
    set({
      receitaTotalMensal: gerarSequencia(s.mesInicio, s.horizonte, Math.max(0, Number(s.receitaGlobal) || 0)),
      projecaoSuja: true,
    });
  },

  distribuirRTB12Historico: () => {
    const s = get();
    const total = Math.max(0, Number(s.rtb12Total) || 0);
    if (!(total > 0)) return;
    try {
      const meses: string[] = [];
      for (let i = 12; i >= 1; i--) meses.push(somarMeses(s.mesInicio, -i));
      set({ historicoMae12: distribuirRTB12(total, meses, s.curvaDistribuicao) });
    } catch {
      /* validação exibe o erro na UI */
    }
  },

  puxarMediaHistorico: () => {
    const s = get();
    if (!s.historicoMae12.length) return;
    const media = Math.round((s.historicoMae12.reduce((a, r) => a + (Number(r.receita) || 0), 0) / s.historicoMae12.length) * 100) / 100;
    set({
      receitaGlobal: media,
      receitaMesAtual: media,
      receitaTotalMensal: gerarSequencia(s.mesInicio, s.horizonte, media),
      projecaoSuja: false,
    });
  },

  semearProjecaoSeLimpa: () => {
    const s = get();
    if (s.projecaoSuja) return;
    const histTotal = s.historicoMae12.reduce((a, r) => a + (Number(r.receita) || 0), 0);
    if (!(histTotal > 0)) return;
    const base = (Number(s.receitaMesAtual) > 0 ? Number(s.receitaMesAtual) : 0)
      || Math.round((histTotal / Math.max(1, s.historicoMae12.length)) * 100) / 100;
    if (!(base > 0)) return;
    set({
      receitaGlobal: base,
      receitaTotalMensal: gerarSequencia(s.mesInicio, s.horizonte, base),
    });
  },
}));
