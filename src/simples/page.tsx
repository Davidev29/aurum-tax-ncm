/**
 * Simples Nacional — página isolada (novo recurso, sem impacto na Calculadora).
 *
 * Layout enxuto em 3 etapas + resultado:
 * - Passo 1: Anexo (manual) ou CNPJ → 1 CNAE ("Qual usar?").
 * - Passo 2: valores agrupados (Receitas / Folha-Fator R / Avançado colapsável).
 * - Passo 3: CTA compacto (sticky no mobile) → aside DAS + analítico.
 * - Insights IA vivem no InsightsModal (botão ✦), não mais inline.
 * - Responsivo: stack <lg, aside 360px em lg+, tabelas com scroll-x.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ANEXO_LABEL, type AnexoSimplesId } from './tabelas';
import { fatorR, type RegraCreditoCBS } from './calculo';
import { orquestrarRelatorio } from './relatorio-analitico';
import { gerarInsightsFallback } from './ia-insights';
import { InsightsModal } from './InsightsModal';
import { exportarRelatorioAnaliticoPDF } from './export-relatorio-analitico';
import { creditoDaDespesa, envolveAnexoV, etapa1Pronta, normalizarListaAnexosSimples, preverAnexoFatorR, temDuploAnexoFatorR, useSimples, type DespesaSimples } from './store';
import { EMITENTE_PADRAO } from '@/domain/entities';
import { useSessao } from '@/store/sessao';
import { exportarSimplesCSV, exportarSimplesJSON } from './export';
import { BotaoReparticao, DasModal, montarDadosDas } from './DasModal';
import { useProjecaoDividida } from '@/simples-projection/store';
import { ModalDivisao as ModalDivisaoView } from '@/simples-projection/ModalDivisao';
import { fmtCarga, fmtCnpj, fmtMoeda, fmtNbs, parseMoeda } from '@/domain/services/format';
import { rotuloAnexoSimples } from '@/domain/services/cnae';
import { Btn, IconeBadge, Painel, Texto, useAcaoTatil } from '@/ui/kit';
import { Entrada, Secao } from '@/ui/motion';
import { toast, useUi } from '@/store/ui';

const ANEXOS: AnexoSimplesId[] = ['I', 'II', 'III', 'IV', 'V'];

function CampoMoeda({
  rotulo,
  valor,
  onValor,
  placeholder,
  dica,
}: {
  rotulo: string;
  valor: number;
  onValor: (v: number) => void;
  placeholder?: string;
  dica?: string;
}) {
  const [texto, setTexto] = useState(() => (valor > 0 ? `R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : ''));
  useEffect(() => {
    if (valor === 0) setTexto('');
  }, [valor]);
  return (
    <label className="block min-w-0">
      <span className="field-label">{rotulo}</span>
      <Texto
        mono
        mask="moeda"
        inputMode="decimal"
        className="field num-input !py-2 text-[13px]"
        placeholder={placeholder ?? 'R$ 0,00'}
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          onValor(parseMoeda(e.target.value));
        }}
        onBlur={() => setTexto((t) => (parseMoeda(t) > 0 ? `R$ ${parseMoeda(t).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : t))}
      />
      {dica ? <span className="mt-0.5 block truncate text-[10px] text-slate-400" title={dica}>{dica}</span> : null}
    </label>
  );
}

function DespesaValor({
  valor,
  onValor,
}: {
  valor: number;
  onValor: (v: number) => void;
}) {
  const fmt = (v: number) => (v > 0 ? `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '');
  const [texto, setTexto] = useState(() => fmt(valor));
  const [foco, setFoco] = useState(false);
  // Sincroniza quando o valor muda por fora (ex.: limpar) e o campo não está em edição.
  useEffect(() => {
    if (!foco) setTexto(fmt(valor));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor, foco]);
  return (
    <Texto
      mono
      mask="moeda"
      inputMode="decimal"
      aria-label="Valor da despesa em reais por mês"
      title="Valor mensal da despesa em R$ — base para o crédito de CBS"
      className="field field-sm mono w-28 !py-1 text-right !text-[12px]"
      placeholder="R$ 0,00"
      value={texto}
      onChange={(e) => {
        setTexto(e.target.value);
        onValor(parseMoeda(e.target.value));
      }}
      onFocus={() => setFoco(true)}
      onBlur={() => {
        setFoco(false);
        setTexto(fmt(parseMoeda(texto)));
      }}
    />
  );
}

/**
 * Seletor custom de regra de crédito CBS — substitui o `<select>` nativo,
 * cujo popup do SO cortava o rótulo na largura da coluna (`w-32`).
 *
 * Botão compacto em vidro + menu em portal (`position: fixed`, 300px) com
 * texto completo por opção (título + detalhe), navegação por teclado
 * (↑↓ Enter Esc) e fechamento em clique-fora/scroll. A tabela ao redor foi
 * alargada em 20% (`min-w 420→504`, colunas `w-32→w-[154px]`).
 */
const OPCOES_REGRA: Array<{ id: RegraCreditoCBS; curto: string; completo: string; detalhe: string }> = [
  { id: 'integral', curto: 'Integral · 100%', completo: 'Integral · 100% da alíquota vira crédito', detalhe: 'Aproveita 100% da CBS como crédito' },
  { id: 'red30', curto: 'Red. 30% · 70%', completo: 'Red. 30% · 70% da alíquota vira crédito', detalhe: 'Alíquota reduzida em 30% — ex.: aluguel' },
  { id: 'red60', curto: 'Red. 60% · 40%', completo: 'Red. 60% · 40% da alíquota vira crédito', detalhe: 'Alíquota reduzida em 60%' },
  { id: 'zero', curto: 'Zero · 0%', completo: 'Zero · alíquota zerada — 0% de crédito', detalhe: 'Nenhum crédito gerado' },
  { id: 'semCredito', curto: 'S/ crédito · 0%', completo: 'S/ crédito · despesa sem direito a crédito', detalhe: '0% de crédito por vedação' },
];

const LARGURA_MENU_REGRA = 300;

function SeletorRegraCredito({
  valor,
  onChange,
}: {
  valor: RegraCreditoCBS;
  onChange: (v: RegraCreditoCBS) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [pos, setPos] = useState({ esquerda: 0, topo: 0 });
  const [foco, setFoco] = useState(() => Math.max(0, OPCOES_REGRA.findIndex((o) => o.id === valor)));
  const botaoRef = useRef<HTMLButtonElement>(null);

  const atual = OPCOES_REGRA.find((o) => o.id === valor) ?? OPCOES_REGRA[0];

  const abrir = () => {
    const r = botaoRef.current?.getBoundingClientRect();
    if (!r) return;
    const esquerda = Math.max(12, Math.min(r.right - LARGURA_MENU_REGRA, window.innerWidth - LARGURA_MENU_REGRA - 12));
    const alturaEstimada = OPCOES_REGRA.length * 64 + 16;
    const cabeAbaixo = r.bottom + 8 + alturaEstimada <= window.innerHeight;
    setPos({
      esquerda,
      topo: cabeAbaixo ? r.bottom + 8 : Math.max(12, r.top - alturaEstimada - 8),
    });
    setFoco(Math.max(0, OPCOES_REGRA.findIndex((o) => o.id === valor)));
    setAberto(true);
  };

  // Clique-fora, scroll e resize fecham (posição é snapshot do `rect`).
  useEffect(() => {
    if (!aberto) return;
    const aoMousedown = (e: MouseEvent) => {
      const alvo = e.target as HTMLElement | null;
      if (botaoRef.current?.contains(alvo)) return;
      if (alvo?.closest?.('[data-regra-menu]')) return;
      setAberto(false);
    };
    const aoTecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAberto(false);
        botaoRef.current?.focus();
      }
    };
    const fechar = () => setAberto(false);
    document.addEventListener('mousedown', aoMousedown);
    document.addEventListener('keydown', aoTecla);
    window.addEventListener('scroll', fechar, true);
    window.addEventListener('resize', fechar);
    return () => {
      document.removeEventListener('mousedown', aoMousedown);
      document.removeEventListener('keydown', aoTecla);
      window.removeEventListener('scroll', fechar, true);
      window.removeEventListener('resize', fechar);
    };
  }, [aberto]);

  const escolher = (id: RegraCreditoCBS) => {
    onChange(id);
    setAberto(false);
    botaoRef.current?.focus();
  };

  return (
    <>
      <button
        ref={botaoRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={aberto}
        title="Regra de crédito: Integral 100% · Red. 30% 70% · Red. 60% 40% · Zero/Sem crédito 0%"
        onClick={() => (aberto ? setAberto(false) : abrir())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !aberto) {
            e.preventDefault();
            abrir();
          }
        }}
        className="field field-sm select-glass flex w-[154px] items-center justify-between gap-1 !py-1 text-left text-[11px]"
      >
        <span className="truncate">{atual.curto}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`shrink-0 text-aurum-600 transition-transform duration-200 dark:text-aurum-300 ${aberto ? 'rotate-180' : ''}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {aberto && typeof document !== 'undefined'
        ? createPortal(
            <div
              data-regra-menu
              role="listbox"
              aria-label="Regra de crédito — quanto da alíquota CBS vira crédito"
              className="regra-menu fixed z-[90]"
              style={{ left: pos.esquerda, top: pos.topo, width: LARGURA_MENU_REGRA }}
            >
              {OPCOES_REGRA.map((o, i) => (
                <button
                  key={o.id}
                  type="button"
                  role="option"
                  aria-selected={o.id === valor}
                  autoFocus={i === foco}
                  className={`regra-opt ${o.id === valor ? 'is-ativo' : ''}`}
                  onClick={() => escolher(o.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      const p = (i + 1) % OPCOES_REGRA.length;
                      setFoco(p);
                      document.querySelectorAll('[data-regra-menu] .regra-opt')[p]?.scrollIntoView({ block: 'nearest' });
                      (document.querySelectorAll('[data-regra-menu] .regra-opt')[p] as HTMLElement)?.focus();
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      const p = (i - 1 + OPCOES_REGRA.length) % OPCOES_REGRA.length;
                      setFoco(p);
                      (document.querySelectorAll('[data-regra-menu] .regra-opt')[p] as HTMLElement)?.focus();
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      escolher(o.id);
                    }
                  }}
                  onMouseEnter={() => setFoco(i)}
                >
                  <span className="regra-check" aria-hidden="true">{o.id === valor ? '✓' : ''}</span>
                  <span className="min-w-0">
                    <span className="regra-opt-titulo">{o.completo}</span>
                    <span className="regra-opt-detalhe">{o.detalhe}</span>
                  </span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function Barra({ partes }: { partes: { rotulo: string; valor: number; classe: string }[] }) {
  const total = partes.reduce((a, p) => a + p.valor, 0);
  return (
    <div>
      <div className="calc-bar" aria-hidden="true">
        {partes.map((p) => (
          <span key={p.rotulo} className={p.classe} style={{ width: `${total > 0 ? (p.valor / total) * 100 : 0}%` }} title={`${p.rotulo}: ${fmtMoeda(p.valor)}`} />
        ))}
      </div>
      <div className="mt-1 hidden flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-slate-400 sm:flex">
        {partes.filter((p) => p.valor > 0).map((p) => (
          <span key={p.rotulo}>■ {p.rotulo}: {fmtMoeda(p.valor)}</span>
        ))}
      </div>
    </div>
  );
}

function Passo({ n, titulo, desc, feito }: { n: string; titulo: string; desc: string; feito?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-black ${feito ? 'bg-emerald-600 text-white' : 'calc-step-dot !h-5 !w-5 !text-[10px]'}`}>{feito ? '✓' : n}</span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-black tracking-tight">{titulo}</span>
        <span className="block truncate text-[11px] text-slate-500" title={desc}>{desc}</span>
      </span>
    </div>
  );
}

function Stepper({ etapa }: { etapa: 1 | 2 | 3 }) {
  const itens = [
    { n: '1', rotulo: 'Origem' },
    { n: '2', rotulo: 'Valores' },
    { n: '3', rotulo: 'Resultado' },
  ];
  return (
    <ol className="flex items-center gap-1 px-3 py-2 sm:gap-2" aria-label="Etapas">
      {itens.map((it, i) => {
        const idx = (i + 1) as 1 | 2 | 3;
        const ativo = idx === etapa;
        const feito = idx < etapa;
        return (
          <li key={it.n} className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-black ${feito ? 'bg-emerald-600 text-white' : ativo ? 'bg-brand-700 text-white' : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-300'}`}>
              {feito ? '✓' : it.n}
            </span>
            <span className={`truncate text-[11px] ${ativo ? 'font-black' : 'font-semibold text-slate-500'}`}>{it.rotulo}</span>
            {i < itens.length - 1 ? <span className="h-px min-w-3 flex-1 bg-[var(--line)]" aria-hidden="true" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function SubCard({ titulo, children, aside }: { titulo: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-slate-50/40 p-3 dark:bg-slate-950/20">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-[11px] font-black uppercase tracking-wider text-slate-500">{titulo}</h4>
        {aside}
      </div>
      {children}
    </div>
  );
}

export function SimplesNacional() {
  const s = useSimples();
  const [gerando, setGerando] = useState(false);
  const [dasAberto, setDasAberto] = useState(false);
  const [insightsAberto, setInsightsAberto] = useState(false);
  const [reparticaoAberta, setReparticaoAberta] = useState(false);
  // Lista de CNAEs: aberta para perguntar "qual usar?"; fecha ao escolher.
  // `true` = usuário pediu para trocar / simular com outra atividade.
  const [forcarLista, setForcarLista] = useState(false);
  const passo2Ref = useRef<HTMLDivElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const relatorioRef = useRef<HTMLElement>(null);

  // Trocar de modo sempre recomeça com a lista fechada / sem forçar.
  useEffect(() => {
    setForcarLista(false);
    setReparticaoAberta(false);
  }, [s.modo]);

  const pronta1 = etapa1Pronta(s);
  const comFolha = envolveAnexoV(s);
  const ehDuploAnexo = temDuploAnexoFatorR(s);
  const previsaoFR = useMemo(
    () => (comFolha ? preverAnexoFatorR(s.rbt12, s.folha12) : null),
    [comFolha, s.rbt12, s.folha12],
  );
  const dadosDas = useMemo(
    () =>
      s.convencional
        ? montarDadosDas(s.convencional, {
            modo: s.modo,
            empresaNome: s.empresaNome,
            cnpj: s.cnpj,
            cnae: s.cnaeEscolhido,
            rbt12: s.rbt12,
            receitaMes: s.receitaMes,
          })
        : null,
    [s.convencional, s.modo, s.empresaNome, s.cnpj, s.cnaeEscolhido, s.rbt12, s.receitaMes],
  );
  const fr = useMemo(
    () => (comFolha && s.rbt12 > 0 && s.folha12 > 0 ? fatorR(s.folha12, s.rbt12) : null),
    [comFolha, s.folha12, s.rbt12],
  );
  const podeVisualizar = pronta1 && s.rbt12 > 0 && s.receitaMes > 0 && !gerando;
  const mostrando = s.relatorioVisivel && s.convencional;
  // Relatório fica OCULTO até o usuário apertar Calcular (manual e automático).
  // Durante o "pensar" da Aurum AI mostra skeleton; antes disso, nada.
  const relatorioAtivo = Boolean(mostrando || gerando);
  // Relatório analítico: mesmos inputs, sem recálculo na IA/UI.
  // Matriz III×V só em CNPJ cujo CNAE tem dois anexos; senão, duelo Conv × Hib do anexo efetivo.
  const relatorioAnalitico = useMemo(
    () => {
      if (!mostrando || !s.convencional) return null;
      const opAtiva = s.modo === 'cnpj' ? (s.opcoes.find((o) => o.cnae7 === s.cnaeEscolhido) ?? null) : null;
      const elegiveis = s.modo === 'cnpj'
        ? normalizarListaAnexosSimples(opAtiva?.anexos ?? []).filter((a): a is AnexoSimplesId => ['I', 'II', 'III', 'IV', 'V'].includes(a))
        : [s.convencional.anexoId];
      return orquestrarRelatorio({
        empresa: {
          origem: s.modo === 'manual' ? 'MANUAL' : 'CNPJ_API',
          razaoSocial: s.modo === 'cnpj' && s.empresaNome ? s.empresaNome : 'Contribuinte — cálculo manual',
          cnpj: s.modo === 'cnpj' ? s.cnpj : null,
          cnaePrincipal: s.modo === 'cnpj' ? s.cnaeEscolhido || null : null,
          cnaesSecundarios: s.modo === 'cnpj' ? s.opcoes.filter((o) => o.cnae7 !== s.cnaeEscolhido).map((o) => o.cnae7) : [],
          regimeAtual: s.modo === 'cnpj' && s.opcaoSimples != null ? (s.opcaoSimples ? 'Optante do Simples' : 'Não optante (simulação)') : null,
        },
        competencia: new Date().toISOString().slice(0, 7),
        exercicioReferencia: new Date().getFullYear(),
        rbt12: s.rbt12,
        rba: s.usarRba ? s.rba : s.rbt12,
        receitaMes: s.receitaMes,
        folha12: s.folha12,
        cbsRef: s.cbsRef,
        despesas: s.despesas.map((d) => ({ rotulo: d.rotulo, valor: d.valor, regra: d.regra })),
        contexto: {
          modo: s.modo,
          anexoSelecionado: s.convencional.anexoId,
          anexosElegiveis: elegiveis.length > 0 ? elegiveis : [s.convencional.anexoId],
        },
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mostrando, s.modo, s.empresaNome, s.cnpj, s.cnaeEscolhido, s.opcoes, s.rbt12, s.receitaMes, s.folha12, s.cbsRef, s.despesas, s.usarRba, s.rba, s.convencional],
  );
  const insightsAnaliticos = useMemo(
    () => (relatorioAnalitico ? gerarInsightsFallback(relatorioAnalitico) : []),
    [relatorioAnalitico],
  );
  const pdfAnalitico = useAcaoTatil(async () => {
    if (!relatorioAnalitico) {
      toast('Visualize o cálculo antes de exportar.', 'warn');
      return;
    }
    const emitente = useSessao.getState().emitente ?? EMITENTE_PADRAO;
    await exportarRelatorioAnaliticoPDF(relatorioAnalitico, insightsAnaliticos, emitente);
    toast('Relatório analítico em PDF gerado.', 'ok');
  });

  const cnaeAtivo = s.modo === 'cnpj' ? (s.opcoes.find((o) => o.cnae7 === s.cnaeEscolhido) ?? null) : null;
  const mostrarListaCnae = s.modo === 'cnpj' && s.opcoes.length > 0 && (!s.cnaeEscolhido || forcarLista);
  const mostrarCnaeFocado = s.modo === 'cnpj' && cnaeAtivo && !mostrarListaCnae;

  const rolarPara = (ref: React.RefObject<HTMLDivElement | HTMLElement | null>) => {
    window.requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const aoEscolherAnexo = (a: AnexoSimplesId) => {
    s.setAnexo(a);
    rolarPara(passo2Ref);
  };

  const aoEscolherCnae = (cnae7: string) => {
    s.escolherCnae(cnae7);
    setForcarLista(false);
    rolarPara(passo2Ref);
  };

  const aoTrocarAtividade = () => {
    setForcarLista(true);
    rolarPara(listaRef);
  };

  const visualizar = () => {
    if (!podeVisualizar) {
      toast('Informe RBT12 e receita do mês.', 'warn');
      return;
    }
    setGerando(true);
    setReparticaoAberta(false);
    // Micro-interação Aurum AI: pensa antes de revelar. O aside já abre aqui
    // em modo skeleton, e o resultado entra com slide-in.
    window.requestAnimationFrame(() => {
      relatorioRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    window.setTimeout(() => {
      s.calcular();
      setGerando(false);
      window.requestAnimationFrame(() => {
        relatorioRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }, 750);
  };

  const payload = () =>
    s.convencional
      ? {
          anexoId: s.convencional.anexoId,
          rbt12: s.rbt12,
          receitaMes: s.receitaMes,
          folha12: s.folha12,
          rba: s.usarRba ? s.rba : s.rbt12,
          cbsRef: s.cbsRef,
          conv: s.convencional,
          hib: s.hibrido,
          debitosCBS: s.debitosCBS,
          creditosCBS: s.creditosCBS,
          empresa: s.empresaNome,
          cnae: s.cnaeEscolhido,
        }
      : null;

  const editarDespesa = (id: string, patch: Partial<DespesaSimples>) => {
    s.setDespesas(s.despesas.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  const etapaAtual: 1 | 2 | 3 = !pronta1 ? 1 : relatorioAtivo ? 3 : 2;
  const reparticao = s.convencional?.reparticao;
  const reparticaoItens = (reparticao ? (['IRPJ', 'CSLL', 'CBS', 'IBS', 'CPP', 'ICMS', 'IPI', 'ISS'] as const).filter((t) => reparticao[t] > 0) : []);
  const reparticaoVisiveis = reparticaoAberta ? reparticaoItens : reparticaoItens.slice(0, 4);

  return (
    <div className="mx-auto w-full max-w-[840px]">
    <div className={`grid grid-cols-1 gap-3 transition-all duration-500 ${relatorioAtivo ? 'xl:grid-cols-[minmax(0,1fr)_320px]' : ''}`}>
      <div className="min-w-0 space-y-3">
        <Entrada>
        <Painel className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-[var(--line)] p-3">
            <IconeBadge nome="calculadora" tom="brand" tamanho="sm" />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[13px] font-black tracking-tight">Simples Nacional <span className="ml-1 rounded-full bg-brand-100 px-1.5 py-px align-middle text-[10px] font-bold text-brand-700 dark:bg-aurum-500/15 dark:text-aurum-200">NOVO</span></h2>
              <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                LC 123/2006 + Reforma (CBS/IBS) · 2027–2028
              </p>
            </div>
          </div>

          <div className="flex gap-1.5 border-b border-[var(--line)] bg-slate-50/60 px-3 py-2 dark:bg-slate-950/40">
            {(['manual', 'cnpj'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => s.set({ modo: m })}
                aria-pressed={s.modo === m}
                className={`btn btn-press flex-1 !py-1.5 text-xs transition-all duration-200 ${s.modo === m ? 'btn-primary' : 'btn-ghost'}`}
              >
                {m === 'manual' ? 'Manual · Anexo' : 'Automático · CNPJ'}
              </button>
            ))}
          </div>
          <Stepper etapa={etapaAtual} />

          <div className="space-y-3 p-3" key={s.modo}>
            {/* PASSO 1 */}
            <Entrada atraso={0.05}>
            <section className="space-y-2">
              <Passo n="1" titulo={s.modo === 'manual' ? 'Anexo para simular' : 'CNPJ da empresa'} desc={s.modo === 'manual' ? 'Toque num Anexo para liberar o restante.' : 'Busque e escolha 1 atividade.'} feito={pronta1} />
              {s.modo === 'manual' ? (
                <div>
                  <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
                    {ANEXOS.map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => aoEscolherAnexo(a)}
                        aria-pressed={s.anexoId === a && s.escolheuAnexo}
                        className={`rounded-lg border px-2 py-1.5 text-left transition-all duration-200 btn-press ${
                          s.anexoId === a && s.escolheuAnexo
                            ? 'border-brand-700 bg-brand-700 text-white shadow-pop scale-[1.02]'
                            : 'border-[var(--line)] bg-white hover:border-aurum-500 hover:scale-[1.01] active:scale-[0.99] dark:bg-slate-900'
                        }`}
                      >
                        <span className={`block font-mono text-xs font-black ${s.anexoId === a && s.escolheuAnexo ? 'text-aurum-200' : 'text-brand-700 dark:text-aurum-200'}`}>{a}</span>
                        <span className={`block truncate text-[10px] ${s.anexoId === a && s.escolheuAnexo ? 'text-white/80' : 'text-slate-500'}`}>
                          {a === 'I' ? 'Comércio' : a === 'II' ? 'Indústria' : a === 'III' ? 'Serviços' : a === 'IV' ? 'S/ CPP' : 'Fator R'}
                        </span>
                      </button>
                    ))}
                  </div>
                  {s.escolheuAnexo ? (
                    <p className="mt-1 animate-fade-up truncate text-[11px] text-emerald-600">{ANEXO_LABEL[s.anexoId]} ✓</p>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-2 rounded-xl border border-[var(--line)] bg-slate-50/50 p-3 dark:bg-slate-950/30">
                  <div className="flex flex-row items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <span className="field-label">CNPJ</span>
                      <Texto mono mask="cnpj" placeholder="00.000.000/0000-00" value={s.cnpj} onChange={(e) => s.set({ cnpj: e.target.value })} className="!h-[38px]" />
                    </div>
                    <div className="shrink-0 pb-px">
                      <Btn variante="primary" carregando={s.buscandoCnpj} onClick={() => void s.buscarPorCnpj()} className="!h-[38px] whitespace-nowrap px-4">
                        {s.buscandoCnpj ? 'Buscando…' : 'Buscar'}
                      </Btn>
                    </div>
                  </div>
                  {s.empresaNome ? (
                    <div className="animate-fade-up truncate text-xs">
                      <strong>{s.empresaNome}</strong> <span className="font-mono text-slate-500">{fmtCnpj(s.cnpj)}</span>{' '}
                      {s.opcaoSimples == null ? null : s.opcaoSimples ? (
                        <span className="rounded-full bg-emerald-100 px-1.5 py-px text-[10px] font-bold text-emerald-800">Simples optante</span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-bold text-amber-800">Não optante</span>
                      )}
                    </div>
                  ) : null}

                  {/* Pergunta qual CNAE usar — lista aberta só neste momento */}
                  {mostrarListaCnae ? (
                    <div ref={listaRef as React.RefObject<HTMLDivElement>} className="animate-fade-up scroll-mt-24 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="field-label">Qual atividade usar? · {s.opcoes.length}</span>
                        <span className="hidden text-[10px] text-slate-400 sm:block">Toque para focar e liberar os cálculos</span>
                      </div>
                      <div className="max-h-56 space-y-1.5 overflow-y-auto pr-0.5">
                        {s.opcoes.map((o) => {
                          const anexosNorm = normalizarListaAnexosSimples(o.anexos);
                          const ehDuplo = anexosNorm.includes('III') && anexosNorm.includes('V');
                          return (
                          <button
                            key={o.cnae7}
                            type="button"
                            onClick={() => aoEscolherCnae(o.cnae7)}
                            aria-pressed={s.cnaeEscolhido === o.cnae7}
                            className="btn-press flex w-full items-start gap-2 rounded-lg border border-[var(--line)] bg-white p-2 text-left transition-all duration-200 hover:border-aurum-500 dark:bg-slate-900"
                          >
                            <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 border-slate-300 text-transparent">
                              <span className="text-[9px]">✓</span>
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-1">
                                <span className="font-mono text-[11px] font-black">{o.codigoFormatado}</span>
                                {o.principal ? <span className="rounded-full bg-brand-100 px-1.5 py-px text-[10px] font-bold text-brand-700">principal</span> : null}
                                {anexosNorm.length ? (
                                  <span className="rounded-full bg-slate-100 px-1.5 py-px text-[10px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">{rotuloAnexoSimples(anexosNorm)}</span>
                                ) : (
                                  <span className="rounded-full bg-red-100 px-1.5 py-px text-[10px] font-bold text-red-700">s/ anexo</span>
                                )}
                                {ehDuplo ? (
                                  <span className="rounded-full bg-sky-100 px-1.5 py-px text-[10px] font-bold text-sky-800 dark:bg-sky-950/50 dark:text-sky-200">III × V</span>
                                ) : o.exigeFatorR ? (
                                  <span className="rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-bold text-amber-800">Fator R</span>
                                ) : null}
                              </span>
                              <span className="mt-0.5 block truncate text-[11px] text-slate-600 dark:text-slate-300" title={o.descricao}>{o.descricao}</span>
                            </span>
                          </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {/* Atividade focada — demais ocultas + botão trocar */}
                  {mostrarCnaeFocado ? (
                    <div className="animate-pop-in space-y-2" key={cnaeAtivo!.cnae7}>
                      <div className="flex items-start gap-2 rounded-xl border border-brand-700/70 bg-brand-50/60 p-2.5 shadow-card dark:bg-brand-950/25">
                        <span className="grid h-5 w-5 shrink-0 animate-pop-in place-items-center rounded-full bg-brand-700 text-[10px] font-black text-white">✓</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="font-mono text-[11px] font-black">{cnaeAtivo!.codigoFormatado}</span>
                            {cnaeAtivo!.principal ? <span className="rounded-full bg-brand-100 px-1.5 py-px text-[10px] font-bold text-brand-700">principal</span> : null}
                            {(() => {
                              const anexosFoco = normalizarListaAnexosSimples(cnaeAtivo!.anexos);
                              return anexosFoco.length ? (
                              <span className="rounded-full bg-slate-100 px-1.5 py-px text-[10px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">{rotuloAnexoSimples(anexosFoco)}</span>
                            ) : (
                              <span className="rounded-full bg-red-100 px-1.5 py-px text-[10px] font-bold text-red-700">s/ anexo</span>
                              );
                            })()}
                            <span className="rounded-full bg-emerald-100 px-1.5 py-px text-[10px] font-bold text-emerald-800">em simulação</span>
                          </div>
                          <p className="mt-0.5 truncate text-[11px] text-slate-600 dark:text-slate-300" title={cnaeAtivo!.descricao}>{cnaeAtivo!.descricao}</p>
                          {s.opcoes.length > 1 ? (
                            <p className="mt-0.5 text-[10px] text-slate-400">+ {s.opcoes.length - 1} oculta{s.opcoes.length - 1 === 1 ? '' : 's'}</p>
                          ) : null}
                        </div>
                      </div>
                      {/* NBS informativos — sempre colapsados para enxugar */}
                      {cnaeAtivo!.estadoNbs === 'bens→NCM' ? (
                        <div
                          className="rounded-xl border border-sky-300 bg-sky-50 px-2.5 py-1.5 text-[11px] text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200"
                          role="note"
                        >
                          <p className="font-bold">Sem NBS — atividade de bens (ver NCM)</p>
                          <div className="mt-1">
                            <Btn tam="sm" onClick={() => useUi.getState().trocarView('consulta')}>
                              Ir à Consulta NCM
                            </Btn>
                          </div>
                        </div>
                      ) : cnaeAtivo!.estadoNbs === 'mapeado' && cnaeAtivo!.nbsLista.length ? (
                        <details className="rounded-xl border border-slate-200 bg-slate-50/60 px-2.5 py-1.5 text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
                          <summary className="cursor-pointer font-bold">
                            NBS: {cnaeAtivo!.nbsLista.length} ({cnaeAtivo!.nbsComBeneficio} c/ benefício) — informativo
                          </summary>
                          {cnaeAtivo!.maisProvavel ? (
                            <p className="mt-1">
                              ★ Mais provável:{' '}
                              <span className="font-mono font-black text-brand-700 dark:text-aurum-200">
                                {fmtNbs(cnaeAtivo!.maisProvavel)}
                              </span>
                            </p>
                          ) : null}
                          <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto pr-1">
                            {cnaeAtivo!.nbsLista.map((v) => (
                              <li key={v.nbs} className="flex items-center gap-1.5 text-[10px]">
                                <span className="font-mono font-bold text-brand-700 dark:text-aurum-200">{v.nbsFormatado}</span>
                                <span className="min-w-0 flex-1 truncate" title={v.descricao ?? ''}>{v.descricao ?? '—'}</span>
                                {v.temBeneficio ? (
                                  <span className="rounded-full bg-emerald-100 px-1.5 py-px text-[10px] font-black text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">benefício</span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : cnaeAtivo!.estadoNbs === 'sem-mapeamento-NBS' ? (
                        <p
                          className="rounded-xl border border-slate-200 bg-slate-50/60 px-2.5 py-1.5 text-[10px] text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400"
                          role="note"
                        >
                          Regra do Simples acima · ref. {cnaeAtivo!.anoReferencia}.
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-1.5">
                        <Btn tam="sm" className="btn-press" onClick={aoTrocarAtividade}>
                          Trocar atividade
                        </Btn>
                        <Btn
                          tam="sm"
                          variante="primary"
                          title="Simular divisão do faturamento em duas empresas"
                          onClick={() => useProjecaoDividida.getState().abrir({
                            cnpj: s.cnpj,
                            empresaNome: s.empresaNome,
                            opcaoSimples: s.opcaoSimples,
                            cnaeEscolhido: s.cnaeEscolhido,
                            anexoSugerido: s.anexoId,
                            rbt12: s.rbt12,
                            receitaMes: s.receitaMes,
                            folha12: s.folha12,
                          })}
                        >
                          ✂ Dividir faturamento
                        </Btn>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </section>
            </Entrada>

            {/* PASSO 2 — oculto até o passo 1 (sem scroll inicial) */}
            {pronta1 ? (
              <Secao>
              <section ref={passo2Ref} className="scroll-mt-24 space-y-2.5 border-t border-[var(--line)] pt-3">
                <Passo n="2" titulo="Valores" desc="RBT12 e receita. Folha só no Fator R." feito={relatorioAtivo} />
                <SubCard titulo="Receitas">
                  <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
                    <CampoMoeda rotulo="RBT12 — 12 meses" valor={s.rbt12} onValor={(v) => { s.set({ rbt12: v }); s.tocarEntrada(); }} dica="Soma 12m (teto 4,8M)" />
                    <CampoMoeda rotulo="Receita do mês" valor={s.receitaMes} onValor={(v) => { s.set({ receitaMes: v }); s.tocarEntrada(); }} dica="Base do DAS" />
                  </div>
                </SubCard>
                {comFolha ? (
                  <SubCard
                    titulo={ehDuploAnexo ? 'Folha · Fator R (III × V)' : 'Folha · Fator R'}
                    aside={previsaoFR?.definido ? (
                      <span className={`rounded-full px-2 py-px text-[10px] font-bold ${previsaoFR.anexo === 'III' ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200' : 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200'}`}>
                        {previsaoFR.anexo} · {(previsaoFR.indice * 100).toFixed(2)}%
                      </span>
                    ) : <span className="text-[10px] text-slate-400">anexo V provisório</span>}
                  >
                    <CampoMoeda
                      rotulo="Folha de salários 12m"
                      valor={s.folha12}
                      onValor={(v) => { s.set({ folha12: v }); s.tocarEntrada(); }}
                      dica={fr ? `Fator R ${(fr.indice * 100).toFixed(2)}% → ${fr.anexo === 'III' ? 'III (≥ 28%)' : 'V (< 28%)'}` : 'Salários + pró-labore + FGTS 12m'}
                    />
                  </SubCard>
                ) : (
                  <p className="text-[10px] text-slate-400">
                    {s.modo === 'manual' && (s.anexoId === 'III' || s.anexoId === 'IV')
                      ? 'Anexo sem Fator R: folha dispensada.'
                      : 'Sem Anexo V: folha dispensada.'}
                  </p>
                )}

                <details className="rounded-xl border border-dashed border-[var(--line)] px-3 py-2">
                  <summary className="cursor-pointer text-xs font-bold">
                    Avançado — RBA e regime híbrido
                    {s.usarRba || s.compararHibrido ? <span className="ml-1 rounded-full bg-brand-100 px-1.5 py-px text-[10px] text-brand-700">ativo</span> : null}
                  </summary>
                  <div className="mt-2 space-y-2">
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold">
                      <input type="checkbox" className="h-4 w-4 accent-brand-700" checked={s.usarRba} onChange={(e) => { s.set({ usarRba: e.target.checked }); s.tocarEntrada(); }} />
                      RBA diferente do RBT12 (sublimite R$ 3,6M)
                    </label>
                    {s.usarRba ? (
                      <div className="animate-fade-up">
                        <CampoMoeda rotulo="RBA — acumulada no ano" valor={s.rba} onValor={(v) => { s.set({ rba: v }); s.tocarEntrada(); }} dica="Excedente = MIN(receita, MAX(0, RBA − 3,6M))" />
                      </div>
                    ) : null}
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-bold">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-brand-700"
                        checked={s.compararHibrido}
                        onChange={(e) => { s.set({ compararHibrido: e.target.checked }); s.tocarEntrada(); }}
                      />
                      Comparar com o regime híbrido?
                    </label>
                    {s.compararHibrido ? (
                      <div className="animate-fade-up space-y-2">
                        <div>
                          <span className="field-label">CBS referência (%)</span>
                          <Texto
                            type="number" step="0.01" min={0} max={30} mono className="field num-input !py-2 text-[13px]"
                            value={String((s.cbsRef * 100).toFixed(2))}
                            onChange={(e) => { const v = Number(e.target.value.replace(',', '.')) || 0; s.set({ cbsRef: v / 100 }); s.tocarEntrada(); }}
                          />
                          <span className="mt-0.5 block text-[10px] text-slate-400">Padrão 8,80%</span>
                        </div>
                        <div className="space-y-1.5">
                          <span className="field-label">Despesas (crédito CBS)</span>
                          <p className="text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
                            <strong>Valor (R$/mês):</strong> quanto a empresa gasta no mês com o item — é a base do crédito.
                            O crédito de cada linha = valor × CBS {(s.cbsRef * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}% × fator da regra.
                          </p>
                          <p className="text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
                            <strong>Regra de crédito:</strong> quanto da alíquota vira crédito — Integral 100%, Red. 30% (70%),
                            Red. 60% (40%), Zero / S/ crédito (0%). Ex.: aluguel usa 30% da alíquota por padrão.
                          </p>
                          <div className="overflow-x-auto rounded-lg border border-[var(--line)]">
                            <table className="tbl tbl-compacta w-full min-w-[504px]">
                              <thead>
                                <tr className="border-b border-[var(--line)] text-left text-[10px] uppercase tracking-wide text-slate-400">
                                  <th className="px-2 py-1 font-bold" title="Item da despesa e crédito gerado abaixo do nome">Despesa · crédito</th>
                                  <th className="w-[154px] px-2 py-1 text-right font-bold" title="Valor mensal da despesa em R$ — base para o crédito de CBS">Valor (R$/mês)</th>
                                  <th className="w-[154px] px-2 py-1 font-bold" title="Regra: quanto da alíquota CBS vira crédito — Integral 100%, Red. 30% 70%, Red. 60% 40%, Zero/Sem crédito 0%">Regra de crédito</th>
                                  <th className="w-8" />
                                </tr>
                              </thead>
                              <tbody>
                                {s.despesas.map((dd) => {
                                  const cred = creditoDaDespesa(dd, s.cbsRef);
                                  return (
                                    <tr key={dd.id} className="border-t border-[var(--line)] first:border-0">
                                      <td className="max-w-[168px] px-2">
                                        <span className="block truncate text-[11px] font-semibold" title={dd.rotulo}>{dd.rotulo}</span>
                                        <span className={`font-mono text-[10px] ${cred > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-300'}`} title={`Crédito = valor × CBS × fator da regra (${dd.regra})`}>{fmtMoeda(cred)} crédito</span>
                                      </td>
                                      <td className="w-[154px] px-2 text-right">
                                        <DespesaValor valor={dd.valor} onValor={(v) => editarDespesa(dd.id, { valor: v })} />
                                      </td>
                                      <td className="w-[154px] px-2">
                                        <SeletorRegraCredito
                                          valor={dd.regra}
                                          onChange={(v) => editarDespesa(dd.id, { regra: v })}
                                        />
                                      </td>
                                      <td className="w-8 text-center">
                                        <button type="button" className="text-slate-300 transition hover:text-red-500" title="Remover" onClick={() => s.setDespesas(s.despesas.filter((x) => x.id !== dd.id))}>✕</button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                          <Btn tam="sm" onClick={() => s.setDespesas([...s.despesas, { id: `s${Date.now()}`, rotulo: 'Outra despesa', valor: 0, regra: 'integral' }])}>
                            + Despesa
                          </Btn>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </details>

                {/* PASSO 3 */}
                <div className="sticky bottom-2 z-20 rounded-xl bg-gradient-to-r from-brand-700 to-brand-600 p-3 text-white shadow-pop sm:static">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-black">Passo 3 · Ver cálculo</div>
                      <div className="truncate text-[10px] text-white/70">O relatório aparece após este botão.</div>
                    </div>
                    <Btn
                      variante="primary"
                      tam="sm"
                      className="btn-press !border-aurum-300 !bg-gradient-to-r !from-aurum-400 !to-aurum-500 !text-brand-950 transition-all duration-200 hover:brightness-110 active:scale-95 disabled:opacity-60"
                      carregando={gerando}
                      disabled={!podeVisualizar}
                      onClick={visualizar}
                    >
                      {gerando ? 'Calculando…' : '✦ Visualizar'}
                    </Btn>
                  </div>
                  {gerando ? <div className="loading-bar mt-2 h-1 w-1/3 rounded-full bg-aurum-300/80" /> : null}
                </div>
              </section>
              </Secao>
            ) : (
              <p className="rounded-xl border border-dashed border-[var(--line)] bg-slate-50/50 px-3 py-2.5 text-center text-[11px] text-slate-400 dark:bg-slate-950/30">
                {s.modo === 'manual'
                  ? '↑ Escolha um Anexo acima para liberar os cálculos.'
                  : s.opcoes.length === 0
                    ? '↑ Busque o CNPJ — os cálculos ficam ocultos até você escolher 1 atividade.'
                    : '↑ Escolha 1 atividade — as demais somem e os cálculos aparecem.'}
              </p>
            )}
          </div>
        </Painel>
        </Entrada>
      </div>

      {/* Relatório — OCULTO até Calcular (manual e automático). */}
      {relatorioAtivo ? (
        <aside ref={relatorioRef} className="scroll-mt-24 space-y-2.5 xl:sticky xl:top-4 xl:h-fit" aria-live="polite">
          {gerando && !mostrando ? (
            <div className="animate-slide-in overflow-hidden rounded-2xl border border-[var(--line)] bg-white dark:bg-slate-900">
              <div className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-2.5">
                <span className="grid h-7 w-7 animate-pulse-soft place-items-center rounded-lg bg-gradient-to-br from-brand-700 to-brand-600 text-white">✨</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-black">Aurum AI calculando…</div>
                  <div className="truncate text-[10px] text-slate-500">Cruzando RBT12, faixa e repartição…</div>
                </div>
              </div>
              <div className="space-y-2 p-3">
                <div className="skeleton h-7 w-2/3" />
                <div className="skeleton h-3 w-full" />
                <div className="skeleton h-12 w-full" />
              </div>
            </div>
          ) : mostrando ? (
            <div className="animate-slide-in space-y-2.5" key={`${s.convencional!.anexoId}-${s.convencional!.das}`}>
              <div className="calc-hero overflow-hidden rounded-2xl">
                <div className="px-3 pb-3 pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="calc-hero-rotulo truncate">DAS · {ANEXO_LABEL[s.convencional!.anexoId]} · {s.convencional!.faixa}ª faixa</span>
                    <span className="shrink-0 rounded-full bg-white/15 px-1.5 py-px font-mono text-[10px] font-bold text-white">
                      {s.convencional!.cenario === 1 ? 's/ sublimite' : `cen. ${s.convencional!.cenario}`}
                    </span>
                  </div>
                  <div className="calc-hero-valor mt-0.5 truncate text-xl leading-tight text-white">DAS: {fmtMoeda(s.convencional!.das)}</div>
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-white/75">
                    <span className="truncate">CBS {fmtMoeda(s.convencional!.cbsDentroDAS)}</span>
                    <span className="shrink-0 rounded-full bg-aurum-400/25 px-1.5 py-px font-mono font-bold text-aurum-200">
                      {fmtCarga(s.convencional!.aliquotaEfetiva * 100)}
                    </span>
                  </div>
                  <div className="mt-2">
                    <Barra
                      partes={[
                        { rotulo: 'IRPJ', valor: s.convencional!.reparticao.IRPJ, classe: 'calc-bar-ibs' },
                        { rotulo: 'CSLL', valor: s.convencional!.reparticao.CSLL, classe: 'calc-bar-ibs' },
                        { rotulo: 'CBS', valor: s.convencional!.reparticao.CBS, classe: 'calc-bar-cbs' },
                        { rotulo: 'IBS', valor: s.convencional!.reparticao.IBS, classe: 'calc-bar-ibs' },
                        { rotulo: 'CPP', valor: s.convencional!.reparticao.CPP, classe: 'calc-bar-cbs' },
                        { rotulo: 'ICMS/IPI/ISS', valor: s.convencional!.reparticao.ICMS + s.convencional!.reparticao.IPI + s.convencional!.reparticao.ISS, classe: 'calc-bar-ibs' },
                      ]}
                    />
                  </div>
                </div>
                <div className="space-y-1 bg-white px-3 py-2.5 text-sm dark:bg-slate-900">
                  {reparticaoVisiveis.map((t) => (
                    <div key={t} className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-500">{t}</span>
                      <span className="font-mono font-semibold">{fmtMoeda(s.convencional!.reparticao[t])}</span>
                    </div>
                  ))}
                  {reparticaoItens.length > 4 ? (
                    <button type="button" onClick={() => setReparticaoAberta((v) => !v)} className="text-[11px] font-bold text-brand-700 dark:text-aurum-200">
                      {reparticaoAberta ? '▾ Recolher' : `▸ Ver todos os ${reparticaoItens.length} tributos`}
                    </button>
                  ) : null}
                  {s.convencional!.excedenteISS > 0 ? (
                    <p className="rounded-lg bg-amber-50 px-2 py-1 text-[10px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                      ISS travado em 5% (excedente redistribuído).
                    </p>
                  ) : null}
                  {s.convencional!.cenario !== 1 ? (
                    <p className="rounded-lg bg-sky-50 px-2 py-1 text-[10px] text-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
                      Sublimite cen. {s.convencional!.cenario} · {fmtMoeda(s.convencional!.detalhes.receitaNaoExcedente)} + {fmtMoeda(s.convencional!.detalhes.receitaExcedente)}.
                    </p>
                  ) : null}
                  {fr && comFolha ? (
                    <p className={`rounded-lg px-2 py-1 text-[10px] ${fr.anexo === 'III' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'}`}>
                      Fator R {(fr.indice * 100).toFixed(2)}% → {fr.anexo === 'III' ? 'III (≥ 28%)' : 'V (< 28%)'}.
                    </p>
                  ) : comFolha ? (
                    <p className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      Sem folha — provisório no V. Informe a folha p/ o Fator R.
                    </p>
                  ) : null}
                  <div className="space-y-1.5 pt-1">
                    <BotaoReparticao onClick={() => setDasAberto(true)} />
                    {relatorioAnalitico ? (
                      <button
                        type="button"
                        onClick={() => setInsightsAberto(true)}
                        className="btn btn-press btn-soft flex w-full items-center justify-center gap-2"
                      >
                        ✦ Relatório Analítico e Inteligente
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 bg-white px-3 pb-3 dark:bg-slate-900">
                  <Btn tam="sm" className="flex-1" onClick={() => { s.limpar(); setForcarLista(false); toast('Simulação limpa.', 'warn'); }}>Limpar</Btn>
                  <Btn tam="sm" variante="primary" className="flex-[2]" carregando={pdfAnalitico.carregando} onClick={() => pdfAnalitico.executar()}>
                    {pdfAnalitico.carregando ? 'Gerando…' : 'PDF analítico'}
                  </Btn>
                </div>
              </div>

              {s.compararHibrido && s.hibrido ? (
                <Painel>
                  <div className="border-b border-[var(--line)] px-3 py-2">
                    <h3 className="text-[11px] font-black text-slate-500">⚖ Convencional × Híbrido</h3>
                  </div>
                  <div className="space-y-1.5 p-3 text-[11px]">
                    <div className="flex justify-between"><span className="text-slate-500">DAS conv.</span><strong className="font-mono">{fmtMoeda(s.convencional!.das)}</strong></div>
                    <div className="flex justify-between"><span className="text-slate-500">DAS reduzido</span><strong className="font-mono">{fmtMoeda(s.hibrido.dasReduzido)}</strong></div>
                    <div className="flex justify-between"><span className="text-slate-500">CBS fora</span><strong className="font-mono">{fmtMoeda(s.hibrido.cbsFora)}</strong></div>
                    <div className="flex justify-between border-t border-[var(--line)] pt-1.5"><span className="font-bold">Total híbrido</span><strong className="font-mono">{fmtMoeda(s.hibrido.total)}</strong></div>
                    <div className={`rounded-xl px-2.5 py-1.5 text-center text-[11px] font-bold ${
                      s.hibrido.melhor === 'hibrido' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200'
                      : s.hibrido.melhor === 'convencional' ? 'bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200'
                      : 'bg-slate-100 text-slate-600'}`}>
                      {s.hibrido.melhor === 'empate' ? 'Empate técnico' : s.hibrido.melhor === 'hibrido'
                        ? `Híbrido − ${fmtMoeda(Math.abs(s.hibrido.economiaVsConvencional))}`
                        : `Convencional − ${fmtMoeda(Math.abs(s.hibrido.economiaVsConvencional))}`}
                    </div>
                  </div>
                </Painel>
              ) : null}

              <div className="flex flex-wrap gap-1.5">
                <Btn tam="sm" className="flex-1" onClick={() => { const p = payload(); if (p) exportarSimplesCSV(p); }}>CSV</Btn>
                <Btn tam="sm" className="flex-1" onClick={() => { const p = payload(); if (p) exportarSimplesJSON(p); }}>JSON</Btn>
                {s.modo === 'cnpj' && s.empresaNome && s.cnaeEscolhido ? (
                  <Btn
                    tam="sm"
                    className="flex-[2]"
                    onClick={() => useProjecaoDividida.getState().abrir({
                      cnpj: s.cnpj,
                      empresaNome: s.empresaNome,
                      opcaoSimples: s.opcaoSimples,
                      cnaeEscolhido: s.cnaeEscolhido,
                      anexoSugerido: s.anexoId,
                      rbt12: s.rbt12,
                      receitaMes: s.receitaMes,
                      folha12: s.folha12,
                    })}
                  >
                    ✂ Dividir em 2
                  </Btn>
                ) : null}
              </div>
              <p className="px-1 text-[10px] leading-relaxed text-slate-400">
                Planilhas 2027–2028 · confirme com o contador.
              </p>
            </div>
          ) : null}
        </aside>
      ) : null}
      </div>

      <DasModal aberto={dasAberto} onFechar={() => setDasAberto(false)} dados={dadosDas} />
      {relatorioAnalitico ? (
        <InsightsModal report={relatorioAnalitico} insights={insightsAnaliticos} aberto={insightsAberto} onFechar={() => setInsightsAberto(false)} />
      ) : null}
      <ModalDivisaoView />
    </div>
  );
}
