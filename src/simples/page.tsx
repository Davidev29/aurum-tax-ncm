/**
 * Simples Nacional — página isolada (novo recurso, sem impacto na Calculadora).
 *
 * Layout em wizard (tela única) + resultado rico lado a lado no desktop:
 * - Passo 1: valores base (RBT12 + receita + folha opcional).
 * - Passo 2: anexo (manual) ou CNPJ → 1 CNAE; depois segregação e avançado.
 * - Passo 3: hero DAS → memória | desmembramentos lado a lado → gráficos →
 *   repartição e ações; com restart. Mobile empilha.
 * - Insights IA vivem no InsightsModal (botão ✦), não mais inline.
 * - Responsivo: stack <lg, aside 360px em lg+, tabelas com scroll-x.
 */
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ANEXO_LABEL, SUBLIMITE, type AnexoSimplesId } from './tabelas';
import { calcularConvencional, calcularHibrido, fatorR, type RegraCreditoCBS } from './calculo';
import { orquestrarRelatorio } from './relatorio-analitico';
import { gerarInsightsFallback } from './ia-insights';
import { InsightsModal } from './InsightsModal';
import { exportarRelatorioAnaliticoPDF } from './export-relatorio-analitico';
import { creditoDaDespesa, envolveAnexoV, etapa1Pronta, normalizarListaAnexosSimples, preverAnexoFatorR, rbaEfetiva, refsForaDoAnexo, sublimiteEstourado, useSimples, type DespesaSimples } from './store';
import { tributoSTDoAnexo } from './segregacao-st';
import { calcularSegregado, pseudoConvDoSegregado, somaParcelas, anexoEfetivoParcela, type ParcelaSegEntrada } from './segregacao-receita';
import { EMITENTE_PADRAO } from '@/domain/entities';
import { useSessao } from '@/store/sessao';
import { exportarSimplesCSV, exportarSimplesJSON } from './export';
import { BotaoReparticao, DasModal, montarDadosDas } from './DasModal';
import { GraficosDAS } from './Graficos';
import { NumeroAnimado } from '@/simples-projection/NumeroAnimado';
import { useProjecaoDividida } from '@/simples-projection/store';
import { ModalDivisao as ModalDivisaoView } from '@/simples-projection/ModalDivisao';
import { fmtCarga, fmtCnpj, fmtMoeda, fmtNbs, parseMoeda } from '@/domain/services/format';
import { rotuloAnexoSimples } from '@/domain/services/cnae';
import { Btn, IconeBadge, Painel, Selecao, Texto, useAcaoTatil } from '@/ui/kit';
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
      <span className="field-label field-label--lg">{rotulo}</span>
      <Texto
        mono
        mask="moeda"
        inputMode="decimal"
        className="field num-input h-12 !py-2 text-base"
        placeholder={placeholder ?? 'R$ 0,00'}
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          onValor(parseMoeda(e.target.value));
        }}
        onBlur={() => setTexto((t) => (parseMoeda(t) > 0 ? `R$ ${parseMoeda(t).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : t))}
      />
      {dica ? <span className="mt-1 block text-[13px] leading-snug text-slate-600 dark:text-slate-300" title={dica}>{dica}</span> : null}
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
      className="field field-sm mono w-28 !py-1 text-right !text-[13px]"
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
  { id: 'red30', curto: 'Red. 30% → 70%', completo: 'Red. 30% → 70% da alíquota vira crédito', detalhe: 'Aproveita 70% da CBS como crédito — ex.: aluguel' },
  { id: 'red60', curto: 'Red. 60% → 40%', completo: 'Red. 60% → 40% da alíquota vira crédito', detalhe: 'Aproveita 40% da CBS como crédito' },
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
        className="field field-sm select-glass flex w-[154px] items-center justify-between gap-1 !py-1 text-left text-[13px]"
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

function Barra({ partes }: { partes: { rotulo: string; valor: number; classe: string; cor?: string }[] }) {
  const total = partes.reduce((a, p) => a + p.valor, 0);
  return (
    <div>
      <div className="calc-bar" aria-hidden="true">
        {partes.map((p) => (
          <span key={p.rotulo} className={p.classe} style={{ width: `${total > 0 ? (p.valor / total) * 100 : 0}%`, ...(p.cor ? { backgroundColor: p.cor } : {}) }} title={`${p.rotulo}: ${fmtMoeda(p.valor)}`} />
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[13px] text-slate-600 sm:flex sm:flex-wrap dark:text-slate-300">
        {partes.filter((p) => p.valor > 0).map((p) => (
          <span key={p.rotulo}><span aria-hidden="true" style={p.cor ? { color: p.cor } : undefined}>■</span> {p.rotulo}: {fmtMoeda(p.valor)}</span>
        ))}
      </div>
    </div>
  );
}

function Passo({ n, titulo, desc, feito }: { n: string; titulo: string; desc: string; feito?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-black ${feito ? 'bg-emerald-600 text-white' : 'calc-step-dot !h-7 !w-7 !text-[13px]'}`}>{feito ? '✓' : n}</span>
      <span className="min-w-0">
        <span className="block truncate text-xl font-extrabold tracking-tight">{titulo}</span>
        <span className="block truncate text-[13px] text-slate-600 dark:text-slate-300" title={desc}>{desc}</span>
      </span>
    </div>
  );
}

function Stepper({ etapa, onIr, podeIr3 }: { etapa: 1 | 2 | 3; onIr: (n: 1 | 2 | 3) => void; podeIr3: boolean }) {
  const itens = [
    { n: '1', rotulo: 'Valores' },
    { n: '2', rotulo: 'Anexo' },
    { n: '3', rotulo: 'Resultado' },
  ];
  return (
    <ol className="flex items-center gap-1 px-3 py-2 sm:gap-2" aria-label="Etapas">
      {itens.map((it, i) => {
        const idx = (i + 1) as 1 | 2 | 3;
        const ativo = idx === etapa;
        const feito = idx < etapa || (idx === 3 && podeIr3 && !ativo);
        const bloqueado = idx === 3 && !podeIr3;
        return (
          <li key={it.n} className="flex min-w-0 flex-1 items-center gap-1.5">
            <button
              type="button"
              onClick={() => onIr(idx)}
              disabled={bloqueado}
              aria-current={ativo ? 'step' : undefined}
              title={bloqueado ? 'Calcule para ver o resultado' : `Ir para ${it.rotulo}`}
              className={`btn-press flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1 py-0.5 text-left transition-all duration-200 ${bloqueado ? 'min-h-[44px] cursor-not-allowed opacity-50' : 'min-h-[44px] hover:bg-slate-100 dark:hover:bg-slate-800'}`}
            >
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-black ${feito ? 'bg-emerald-600 text-white' : ativo ? 'bg-brand-700 text-white' : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                {feito ? '✓' : it.n}
              </span>
              <span className={`truncate text-[13px] ${ativo ? 'font-black' : 'font-semibold text-slate-600 dark:text-slate-300'}`}>{it.rotulo}</span>
            </button>
            {i < itens.length - 1 ? <span className="h-px min-w-3 flex-1 bg-[var(--line)]" aria-hidden="true" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function SubCard({ titulo, children, aside }: { titulo: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-xl font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-200">{titulo}</h4>
        {aside}
      </div>
      {children}
    </div>
  );
}

/** Contenção de falha dos gráficos: nunca derruba a tela de resultado. */
class LimiteErroGrafico extends Component<{ children: ReactNode }, { falhou: boolean }> {
  state = { falhou: false };
  static getDerivedStateFromError(): { falhou: boolean } {
    return { falhou: true };
  }
  render() {
    if (this.state.falhou) {
      return (
        <p className="rounded-2xl border border-[var(--line)] bg-white px-4 py-6 text-center text-[13px] text-slate-600 dark:bg-slate-900">
          Gráficos indisponíveis neste momento — os valores acima seguem válidos.
        </p>
      );
    }
    return this.props.children;
  }
}

export function SimplesNacional() {
  const s = useSimples();
  const [gerando, setGerando] = useState(false);
  const [dasAberto, setDasAberto] = useState(false);
  const [insightsAberto, setInsightsAberto] = useState(false);
  const [reparticaoAberta, setReparticaoAberta] = useState(false);
  // Wizard em tela única: 1 dados · 2 anexos e segregações · 3 resultado.
  const [etapa, setEtapa] = useState<1 | 2 | 3>(1);
  // Lista de CNAEs: aberta para perguntar "qual usar?"; fecha ao escolher.
  // `true` = usuário pediu para trocar / simular com outra atividade.
  const [forcarLista, setForcarLista] = useState(false);
  const ctaRef = useRef<HTMLDivElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);

  // Trocar de modo sempre recomeça com a lista fechada / sem forçar.
  useEffect(() => {
    setForcarLista(false);
    setReparticaoAberta(false);
  }, [s.modo]);

  const pronta1 = etapa1Pronta(s);
  /** Passo 1 concluído: RBT12 + receita do mês informados (antes do anexo). */
  const valoresOk = s.rbt12 > 0 && s.receitaMes > 0;
  /** Sublimite estadual detectado já no passo 1 (RBT12/RBA > R$ 3,6M). */
  const estouradoPasso1 = sublimiteEstourado(s);
  const rbaPasso1 = rbaEfetiva(s);
  const comFolha = envolveAnexoV(s);
  // Folha também quando a segregação envolve o Anexo V (Fator R só se
  // calcula sobre o V — III puro já é III, sem decisão).
  const segTemFatorR = s.segAtivo && s.segParcelas.some((p) => p.anexoId === 'V');
  const precisaFolha = comFolha || segTemFatorR;
  const previsaoFR = useMemo(
    () => (precisaFolha ? preverAnexoFatorR(s.rbt12, s.folha12) : null),
    [precisaFolha, s.rbt12, s.folha12],
  );
  // Segregação de receita: cada desmembramento usa a RBT12 TOTAL na sua
  // tabela; checkbox ST por parcela deduz o ICMS/ISS daquela parcela.
  // Segregação PARCIAL: o que não for segregado vira "restante" calculado
  // normalmente no anexo efetivo (bruto). Só barra se a soma ULTRAPASSAR.
  const segSoma = useMemo(() => somaParcelas(s.segParcelas.map((p) => ({ valor: p.valor }))), [s.segParcelas]);
  const segExcesso = s.segAtivo && segSoma > s.receitaMes + 0.01;
  const segValida = !s.segAtivo || (s.segParcelas.filter((p) => p.valor > 0).length > 0 && !segExcesso);
  const segRestoAnexo = s.convencional?.anexoId ?? s.anexoId;
  const segResto = s.segAtivo ? Math.round((s.receitaMes - segSoma) * 100) / 100 : 0;
  const segResultado = useMemo(() => {
    if (!s.segAtivo || !s.convencional) return null;
    const validas = s.segParcelas.filter((p) => p.valor > 0);
    if (validas.length === 0 || segSoma > s.receitaMes + 0.01) return null;
    const parcelas: ParcelaSegEntrada[] = validas.map((p) => ({ anexoId: p.anexoId, receitaMes: p.valor, st: p.st }));
    const resto = Math.round((s.receitaMes - segSoma) * 100) / 100;
    if (resto > 0) parcelas.push({ anexoId: segRestoAnexo, receitaMes: resto, st: false, resto: true, escolhido: s.anexoId });
    try {
      // Folha compartilhada: vale p/ todas as parcelas (Fator R no V).
      return calcularSegregado(s.rbt12, parcelas, s.usarRba ? s.rba : s.rbt12, s.folha12, { aliqRefICMS: s.aliqRefICMS, aliqRefISS: s.aliqRefISS });
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.segAtivo, s.convencional, s.segParcelas, segSoma, s.receitaMes, s.rbt12, s.usarRba, s.rba, s.folha12, segRestoAnexo, s.aliqRefICMS, s.aliqRefISS]);
  // Base de exibição: segregado (pseudo-conv) ou convencional único.
  // A ST já vem deduzida por parcela dentro do segregado — sem ajuste global.
  const convBase = useMemo(
    () => (segResultado && s.convencional ? pseudoConvDoSegregado(segResultado, s.convencional) : s.convencional),
    [segResultado, s.convencional],
  );
  // Bruto normal (sem segregar) × final (segregado): a diferença é a economia.
  // Com excesso de sublimite a exibição é a GUIA (sem ICMS/ISS/IBS fora);
  // a carga total (guia + fora) aparece em bloco próprio.
  const convExib = convBase;
  const dasExib = convBase?.dasGuia ?? convBase?.das ?? 0;
  const cargaTotalExib = convBase?.cargaTotal ?? convBase?.das ?? 0;
  const repExib = convBase?.reparticaoGuia ?? convBase?.reparticao;
  const dasBruto = s.convencional?.dasGuia ?? s.convencional?.das ?? 0;
  /** Dedução ST por tributo (p/ riscado). Chave ausente = sem ST naquele tributo. */
  const deducaoSTPorTributo = useMemo(() => {
    const out: Partial<Record<'ICMS' | 'ISS', number>> = {};
    if (!segResultado?.temST) return out;
    for (const d of segResultado.parcelas) {
      if (d.st && d.tributoST && d.deducaoST > 0) {
        out[d.tributoST] = Math.round(((out[d.tributoST] ?? 0) + d.deducaoST) * 100) / 100;
      }
    }
    return out;
  }, [segResultado]);
  /** Detalhe ST por tributo p/ tooltip: quais parcelas deduziram. */
  const infoSTPorTributo = useMemo(() => {
    const out: Partial<Record<'ICMS' | 'ISS', string>> = {};
    if (!segResultado?.temST) return out;
    for (const t of segResultado.tributosST) {
      out[t] = segResultado.parcelas
        .filter((d) => d.st && d.tributoST === t && d.deducaoST > 0)
        .map((d) => `${d.resto ? 'restante · ' : ''}Anexo ${d.escolhido}${d.anexoCalculado !== d.escolhido ? `→${d.anexoCalculado}` : ''} (${fmtMoeda(d.receitaMes)})`)
        .join(' + ');
    }
    return out;
  }, [segResultado]);
  const repBrutaExib = segResultado?.temST ? segResultado.reparticaoBrutaGuia : convBase?.reparticaoGuia;
  /** Resumo ST p/ guia/exports/legendas (null sem ST com dedução). */
  const stResumo = useMemo(() => {
    if (!segResultado?.temST) return null;
    const valorST = Math.round(segResultado.parcelas.filter((d) => d.st).reduce((a, d) => a + d.receitaMes, 0) * 100) / 100;
    const detalhe = segResultado.stDetalhe
      .map((d) => `ST ${d.tributo} s/ ${fmtMoeda(d.valorST)} (−${fmtMoeda(d.deducao)})`)
      .join(' + ');
    return { tributo: segResultado.tributosST.join('+'), valorST, deducao: segResultado.deducaoST, detalhe };
  }, [segResultado]);
  /** Híbrido coerente com o exibido: com seg ativa, reaplica a fórmula sobre
      os totais segregados (mesmos débitos/créditos CBS); sem seg, é o da store. */
  const hibExib = useMemo(
    () =>
      s.compararHibrido && s.hibrido && convExib
        ? calcularHibrido({ convencional: convExib, debitosCBS: s.debitosCBS, creditosCBS: s.creditosCBS })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.compararHibrido, s.hibrido, convExib, s.debitosCBS, s.creditosCBS],
  );
  const dadosDas = useMemo(
    () =>
      convExib
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
        : null,
    [convExib, stResumo, segResultado, s.modo, s.empresaNome, s.cnpj, s.cnaeEscolhido, s.rbt12, s.receitaMes],
  );
  const fr = useMemo(
    () => (precisaFolha && s.rbt12 > 0 && s.folha12 > 0 ? fatorR(s.folha12, s.rbt12) : null),
    [precisaFolha, s.folha12, s.rbt12],
  );
  /**
   * Anexos efetivos do cálculo (p/ saber quais referências fora da guia
   * mostrar): com segregação, a união das parcelas; sem, o anexo efetivo
   * (Fator R já aplicado quando houver folha).
   */
  const anexosEfetivosRefs = useMemo((): AnexoSimplesId[] => {
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
  }, [s.segAtivo, s.segParcelas, s.anexoId, s.rbt12, s.folha12, precisaFolha]);
  const mostraRefICMS = estouradoPasso1 && anexosEfetivosRefs.some((a) => refsForaDoAnexo(a).includes('ICMS'));
  const mostraRefISS = estouradoPasso1 && anexosEfetivosRefs.some((a) => refsForaDoAnexo(a).includes('ISS'));
  /** Prévia do convencional (só p/ exibir as alíquotas automáticas do fora). */
  const previaConv = useMemo(() => {
    if (!(s.rbt12 > 0) || !(s.receitaMes > 0) || !estouradoPasso1) return null;
    try {
      let anexoEff = anexosEfetivosRefs[0] ?? s.anexoId;
      return calcularConvencional({
        anexoId: anexoEff,
        rbt12: s.rbt12,
        receitaMes: s.receitaMes,
        rba: s.usarRba ? s.rba : s.rbt12,
      });
    } catch {
      return null;
    }
  }, [s.rbt12, s.receitaMes, s.usarRba, s.rba, estouradoPasso1, anexosEfetivosRefs, s.anexoId]);
  const podeVisualizar = pronta1 && s.rbt12 > 0 && s.receitaMes > 0 && segValida && !gerando;
  const mostrando = s.relatorioVisivel && s.convencional;
  // Resultado em tela cheia na etapa 3; skeleton breve durante o "pensar".
  // Relatório analítico: mesmos inputs, sem recálculo na IA/UI.
  // Matriz III×V só em CNPJ cujo CNAE tem dois anexos; senão, duelo Conv × Hib do anexo efetivo.
  const relatorioAnalitico = useMemo(
    () => {
      if (!mostrando || !s.convencional) return null;
      const opAtiva = s.modo === 'cnpj' ? (s.opcoes.find((o) => o.cnae7 === s.cnaeEscolhido) ?? null) : null;
      const elegiveis = segResultado
        ? segResultado.anexos
        : s.modo === 'cnpj'
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
        aliqRefICMS: s.aliqRefICMS,
        aliqRefISS: s.aliqRefISS,
        contexto: {
          modo: s.modo,
          anexoSelecionado: s.convencional.anexoId,
          anexosElegiveis: elegiveis.length > 0 ? elegiveis : [s.convencional.anexoId],
        },
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mostrando, s.modo, s.empresaNome, s.cnpj, s.cnaeEscolhido, s.opcoes, s.rbt12, s.receitaMes, s.folha12, s.cbsRef, s.despesas, s.usarRba, s.rba, s.convencional, segResultado, s.aliqRefICMS, s.aliqRefISS],
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
  /** Anexos da atividade escolhida (CNPJ) — marcados com ★ ao segregar. */
  const anexosSugeridosCnpj = useMemo(
    () => (s.modo === 'cnpj' && cnaeAtivo ? normalizarListaAnexosSimples(cnaeAtivo.anexos) : []),
    [s.modo, cnaeAtivo],
  );
  const mostrarListaCnae = s.modo === 'cnpj' && s.opcoes.length > 0 && (!s.cnaeEscolhido || forcarLista);
  const mostrarCnaeFocado = s.modo === 'cnpj' && cnaeAtivo && !mostrarListaCnae;

  const rolarPara = (ref: React.RefObject<HTMLDivElement | HTMLElement | null>) => {
    window.requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const aoEscolherAnexo = (a: AnexoSimplesId) => {
    s.setAnexo(a);
    rolarPara(ctaRef);
  };

  const aoEscolherCnae = (cnae7: string) => {
    s.escolherCnae(cnae7);
    setForcarLista(false);
    rolarPara(ctaRef);
  };

  const aoTrocarAtividade = () => {
    setForcarLista(true);
    rolarPara(listaRef);
  };

  const visualizar = () => {
    if (!podeVisualizar) {
      if (s.segAtivo && segSoma > s.receitaMes + 0.01) {
        toast(`Segregação soma ${fmtMoeda(segSoma)} — ultrapassa a receita de ${fmtMoeda(s.receitaMes)}.`, 'warn');
      } else {
        toast('Informe RBT12 e receita do mês.', 'warn');
      }
      return;
    }
    setGerando(true);
    setReparticaoAberta(false);
    setEtapa(3);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // Micro-interação: skeleton breve antes de revelar o resultado.
    window.setTimeout(() => {
      s.calcular();
      setGerando(false);
    }, 750);
  };

  const irPara = (n: 1 | 2 | 3) => {
    if (gerando) return;
    if (n === 3 && !mostrando) {
      toast('Calcule antes de ver o resultado.', 'warn');
      return;
    }
    setEtapa(n);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const continuar1 = () => {
    if (!valoresOk) {
      toast('Informe RBT12 e receita do mês.', 'warn');
      return;
    }
    // Sublimite estourado no passo 1 → o híbrido passa a ser comparado
    // sozinho (o usuário pode desmarcar no passo 2).
    if (estouradoPasso1 && !s.compararHibrido) s.set({ compararHibrido: true });
    setEtapa(2);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const reiniciar = () => {
    s.limpar();
    setForcarLista(false);
    setReparticaoAberta(false);
    setEtapa(1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast('Simulação reiniciada.', 'ok');
  };

  const payload = () =>
    s.convencional && convExib
      ? {
          anexoId: s.convencional.anexoId,
          rbt12: s.rbt12,
          receitaMes: s.receitaMes,
          folha12: s.folha12,
          rba: s.usarRba ? s.rba : s.rbt12,
          cbsRef: s.cbsRef,
          conv: convExib,
          hib: hibExib ?? s.hibrido,
          debitosCBS: s.debitosCBS,
          creditosCBS: s.creditosCBS,
          empresa: s.empresaNome,
          cnae: s.cnaeEscolhido,
          /** Referência sem segregar (anexo único) — p/ linha própria no CSV. */
          dasReferencia: dasBruto,
          st: stResumo
            ? { ativo: true as const, tributo: stResumo.tributo, valorST: stResumo.valorST, deducao: stResumo.deducao, detalhe: stResumo.detalhe, detalhePorTributo: segResultado?.stDetalhe.map((d) => ({ tributo: d.tributo, valorST: d.valorST, deducao: d.deducao })) ?? [], dasIntegral: segResultado?.dasBrutoGuia ?? dasBruto, dasFinal: dasExib }
            : { ativo: false as const, tributo: '', valorST: 0, deducao: 0, detalhe: '', detalhePorTributo: [] as Array<{ tributo: string; valorST: number; deducao: number }>, dasIntegral: dasBruto, dasFinal: dasExib },
          seg: segResultado
            ? { ativo: true as const, anexos: segResultado.anexos, dasBruto: segResultado.dasBrutoGuia, parcelas: segResultado.parcelas.map((d) => ({ anexoId: d.anexoId, anexoCalculado: d.anexoCalculado, escolhido: d.escolhido, receitaMes: d.receitaMes, faixa: d.faixa, aliquotaEfetiva: d.aliquotaEfetiva, das: d.dasGuia, dasBruto: d.dasBrutoGuia, st: d.st, tributoST: d.tributoST, deducaoST: d.deducaoST, resto: d.resto })) }
            : { ativo: false as const, anexos: [], dasBruto: 0, parcelas: [] },
        }
      : null;

  const editarDespesa = (id: string, patch: Partial<DespesaSimples>) => {
    s.setDespesas(s.despesas.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  const reparticao = repExib;
  const reparticaoItens = (reparticao ? (['IRPJ', 'CSLL', 'CBS', 'IBS', 'CPP', 'ICMS', 'IPI', 'ISS'] as const).filter((t) => ((deducaoSTPorTributo[t as 'ICMS' | 'ISS'] ?? 0) > 0 ? (repBrutaExib?.[t] ?? 0) > 0 : (reparticao[t] ?? 0) > 0)) : []);
  const reparticaoVisiveis = reparticaoAberta ? reparticaoItens : reparticaoItens.slice(0, 4);

  return (
    <div className="simples-escopo mx-auto w-full max-w-[1400px]">
      <div className="min-w-0 space-y-3">
        <Entrada>
        <Painel className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-[var(--line)] p-3">
            <IconeBadge nome="calculadora" tom="brand" tamanho="sm" />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-xl font-extrabold tracking-tight">Simples Nacional <span className="ml-1 rounded-full bg-brand-100 px-1.5 py-px align-middle text-[13px] font-bold text-brand-700 dark:bg-aurum-500/15 dark:text-aurum-200">NOVO</span></h2>
              <p className="truncate text-[13px] text-slate-600 dark:text-slate-300">
                LC 123/2006 + Reforma (CBS/IBS) · 2027–2028
              </p>
            </div>
          </div>

          {etapa !== 3 ? (
          <div className="flex gap-1.5 border-b border-[var(--line)] bg-slate-50/60 px-3 py-2 dark:bg-slate-950/40">
            {(['manual', 'cnpj'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { if (s.modo !== m) { s.set({ modo: m }); setEtapa(1); } }}
                aria-pressed={s.modo === m}
                className={`btn btn-press h-12 flex-1 !py-1.5 text-sm font-bold transition-all duration-200 ${s.modo === m ? 'btn-primary' : 'btn-ghost'}`}
              >
                {m === 'manual' ? 'Manual · Anexo' : 'Automático · CNPJ'}
              </button>
            ))}
          </div>
          ) : null}
          <Stepper etapa={etapa} onIr={irPara} podeIr3={!!mostrando} />

          {etapa !== 3 ? (
          <div className="space-y-5 p-6 sm:p-8" key={`${s.modo}-${etapa}`}>
            {etapa === 1 ? (
            <>
            {/* PASSO 1 — VALORES BASE (sempre visível, antes do anexo) */}
            <Entrada atraso={0.05}>
            <section className="space-y-2">
              <Passo n="1" titulo="Valores base" desc="RBT12 e receita do mês — antes do anexo." feito={valoresOk} />
              <SubCard titulo="Receitas">
                <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
                  <CampoMoeda rotulo="RBT12 — 12 meses" valor={s.rbt12} onValor={(v) => { s.set({ rbt12: v }); s.tocarEntrada(); }} dica="Soma 12m (teto 4,8M)" />
                  <CampoMoeda rotulo="Receita do mês" valor={s.receitaMes} onValor={(v) => { s.set({ receitaMes: v }); s.tocarEntrada(); }} dica="Base do DAS" />
                </div>
              </SubCard>
              <SubCard
                titulo="Sublimite estadual · R$ 3,6M"
                aside={s.rbt12 > 0 ? (
                  <span className={`rounded-full px-2 py-px text-[13px] font-bold ${estouradoPasso1 ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200' : 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200'}`}>
                    {estouradoPasso1 ? 'acima do sublimite' : 'dentro do sublimite'}
                  </span>
                ) : <span className="text-[13px] text-slate-600">RBT12 define</span>}
              >
                <label className="flex cursor-pointer items-center gap-2 text-[13px] font-semibold">
                  <input type="checkbox" className="h-4 w-4 accent-brand-700" checked={s.usarRba} onChange={(e) => { s.set({ usarRba: e.target.checked }); s.tocarEntrada(); }} />
                  RBA do ano diferente do RBT12
                </label>
                {s.usarRba ? (
                  <div className="animate-fade-up mt-2">
                    <CampoMoeda rotulo="RBA — acumulada no ano" valor={s.rba} onValor={(v) => { s.set({ rba: v }); s.tocarEntrada(); }} dica="Só quando a receita do ano difere do RBT12" />
                  </div>
                ) : null}
                <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
                  {estouradoPasso1
                    ? `RBT12 ${fmtMoeda(s.rbt12)}${s.usarRba ? ` · RBA ${fmtMoeda(rbaPasso1)}` : ''} acima de ${fmtMoeda(SUBLIMITE)}: ICMS/ISS/IBS saem da guia DAS e o híbrido é ativado sozinho.`
                    : `Abaixo de ${fmtMoeda(SUBLIMITE)}: tudo dentro da guia DAS.`}
                </p>
              </SubCard>
              <SubCard
                titulo="Folha · Fator R (opcional)"
                aside={previsaoFR?.definido ? (
                  <span className={`rounded-full px-2 py-px text-[13px] font-bold ${previsaoFR.anexo === 'III' ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200' : 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200'}`}>
                    {previsaoFR.anexo} · {(previsaoFR.indice * 100).toFixed(2)}%
                  </span>
                ) : <span className="text-[13px] text-slate-600">pode ficar em branco</span>}
              >
                <CampoMoeda
                  rotulo="Folha de salários 12m"
                  valor={s.folha12}
                  onValor={(v) => { s.set({ folha12: v }); s.tocarEntrada(); }}
                  dica="Só entra no Fator R (Anexo V). Depois daqui não se preenche mais."
                />
              </SubCard>
              <div className="flex justify-end pt-1">
                <Btn variante="primary" tam="sm" onClick={continuar1}>
                  Continuar →
                </Btn>
              </div>
            </section>
            </Entrada>
            </>
            ) : etapa === 2 ? (
            <>

            {/* PASSO 2 — ANEXO: liberado após os valores base */}
            {valoresOk ? (
              <Secao>
              <section className="scroll-mt-24 space-y-2.5 border-t border-[var(--line)] pt-3">
                <Passo n="2" titulo={s.modo === 'manual' ? 'Anexo' : 'Atividade (CNPJ)'} desc="Individual no mesmo anexo ou segregado por anexo." feito={!!mostrando} />
                {s.modo === 'manual' ? (
                  <div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                      {ANEXOS.map((a) => (
                        <button
                          key={a}
                          type="button"
                          onClick={() => aoEscolherAnexo(a)}
                          aria-pressed={s.anexoId === a && s.escolheuAnexo}
                          className={`rounded-lg border px-2 py-2.5 text-left transition-all duration-200 btn-press min-h-[88px] ${
                            s.anexoId === a && s.escolheuAnexo
                              ? 'simples-anexo-ativo simples-anexo-' + a
                              : 'simples-anexo-' + a + ' border-[var(--line)] hover:scale-[1.01] active:scale-[0.99]'
                          }`}
                        >
                          <span className={`block font-mono text-sm font-black ${s.anexoId === a && s.escolheuAnexo ? 'text-white' : 'text-brand-700 dark:text-aurum-200'}`}>{a}</span>
                          <span className={`block truncate text-[13px] ${s.anexoId === a && s.escolheuAnexo ? 'text-white/85' : 'text-slate-600 dark:text-slate-300'}`}>
                            {a === 'I' ? 'Comércio' : a === 'II' ? 'Indústria' : a === 'III' ? 'Serviços' : a === 'IV' ? 'S/ CPP' : 'Fator R'}
                          </span>
                        </button>
                      ))}
                    </div>
                    {s.escolheuAnexo ? (
                      <p className="mt-1 animate-fade-up truncate text-[13px] text-emerald-600">{ANEXO_LABEL[s.anexoId]} ✓</p>
                    ) : null}
                  </div>
                ) : (
                  <div className="space-y-2 rounded-xl border border-[var(--line)] bg-slate-50/50 p-3 dark:bg-slate-950/30">
                    <div className="flex flex-row items-end gap-2">
                      <div className="min-w-0 flex-1">
                        <span className="field-label">CNPJ</span>
                        <Texto mono mask="cnpj" placeholder="00.000.000/0000-00" value={s.cnpj} onChange={(e) => s.set({ cnpj: e.target.value })} className="h-12 text-base" />
                      </div>
                      <div className="shrink-0 pb-px">
                        <Btn variante="primary" carregando={s.buscandoCnpj} onClick={() => void s.buscarPorCnpj()} className="h-12 whitespace-nowrap px-4">
                          {s.buscandoCnpj ? 'Buscando…' : 'Buscar'}
                        </Btn>
                      </div>
                    </div>
                    {s.empresaNome ? (
                      <div className="animate-fade-up truncate text-[13px]">
                        <strong>{s.empresaNome}</strong> <span className="font-mono text-slate-600">{fmtCnpj(s.cnpj)}</span>{' '}
                        {s.opcaoSimples == null ? null : s.opcaoSimples ? (
                          <span className="rounded-full bg-emerald-100 px-1.5 py-px text-[13px] font-bold text-emerald-800">Simples optante</span>
                        ) : (
                          <span className="rounded-full bg-amber-100 px-1.5 py-px text-[13px] font-bold text-amber-800">Não optante</span>
                        )}
                      </div>
                    ) : null}

                    {/* Pergunta qual CNAE usar — lista aberta só neste momento */}
                    {mostrarListaCnae ? (
                      <div ref={listaRef as React.RefObject<HTMLDivElement>} className="animate-fade-up scroll-mt-24 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="field-label">Qual atividade usar? · {s.opcoes.length}</span>
                          <span className="hidden text-[13px] text-slate-600 sm:block">Toque para focar e liberar os cálculos</span>
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
                              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-slate-300 text-transparent">
                                <span className="text-[13px]">✓</span>
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex flex-wrap items-center gap-1">
                                  <span className="font-mono text-[13px] font-black">{o.codigoFormatado}</span>
                                  {o.principal ? <span className="rounded-full bg-brand-100 px-1.5 py-px text-[13px] font-bold text-brand-700">principal</span> : null}
                                  {anexosNorm.length ? (
                                    <span className="rounded-full bg-slate-100 px-1.5 py-px text-[13px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">{rotuloAnexoSimples(anexosNorm)}</span>
                                  ) : (
                                    <span className="rounded-full bg-red-100 px-1.5 py-px text-[13px] font-bold text-red-700">s/ anexo</span>
                                  )}
                                  {ehDuplo ? (
                                    <span className="rounded-full bg-sky-100 px-1.5 py-px text-[13px] font-bold text-sky-800 dark:bg-sky-950/50 dark:text-sky-200">III × V</span>
                                  ) : o.exigeFatorR ? (
                                    <span className="rounded-full bg-amber-100 px-1.5 py-px text-[13px] font-bold text-amber-800">Fator R</span>
                                  ) : null}
                                </span>
                                <span className="mt-0.5 block truncate text-[13px] text-slate-600 dark:text-slate-300" title={o.descricao}>{o.descricao}</span>
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
                          <span className="grid h-5 w-5 shrink-0 animate-pop-in place-items-center rounded-full bg-brand-700 text-[13px] font-black text-white">✓</span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1">
                              <span className="font-mono text-[13px] font-black">{cnaeAtivo!.codigoFormatado}</span>
                              {cnaeAtivo!.principal ? <span className="rounded-full bg-brand-100 px-1.5 py-px text-[13px] font-bold text-brand-700">principal</span> : null}
                              {(() => {
                                const anexosFoco = normalizarListaAnexosSimples(cnaeAtivo!.anexos);
                                return anexosFoco.length ? (
                                <span className="rounded-full bg-slate-100 px-1.5 py-px text-[13px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">{rotuloAnexoSimples(anexosFoco)}</span>
                              ) : (
                                <span className="rounded-full bg-red-100 px-1.5 py-px text-[13px] font-bold text-red-700">s/ anexo</span>
                                );
                              })()}
                              <span className="rounded-full bg-emerald-100 px-1.5 py-px text-[13px] font-bold text-emerald-800">em simulação</span>
                            </div>
                            <p className="mt-0.5 truncate text-[13px] text-slate-600 dark:text-slate-300" title={cnaeAtivo!.descricao}>{cnaeAtivo!.descricao}</p>
                            {s.opcoes.length > 1 ? (
                              <p className="mt-0.5 text-[13px] text-slate-600">+ {s.opcoes.length - 1} oculta{s.opcoes.length - 1 === 1 ? '' : 's'}</p>
                            ) : null}
                          </div>
                        </div>
                        {/* NBS informativos — sempre colapsados para enxugar */}
                        {cnaeAtivo!.estadoNbs === 'bens→NCM' ? (
                          <div
                            className="rounded-xl border border-sky-300 bg-sky-50 px-2.5 py-1.5 text-[13px] text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200"
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
                          <details className="rounded-xl border border-slate-200 bg-slate-50/60 px-2.5 py-1.5 text-[13px] text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
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
                                <li key={v.nbs} className="flex items-center gap-1.5 text-[13px]">
                                  <span className="font-mono font-bold text-brand-700 dark:text-aurum-200">{v.nbsFormatado}</span>
                                  <span className="min-w-0 flex-1 truncate" title={v.descricao ?? ''}>{v.descricao ?? '—'}</span>
                                  {v.temBeneficio ? (
                                    <span className="rounded-full bg-emerald-100 px-1.5 py-px text-[13px] font-black text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">benefício</span>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          </details>
                        ) : cnaeAtivo!.estadoNbs === 'sem-mapeamento-NBS' ? (
                          <p
                            className="rounded-xl border border-slate-200 bg-slate-50/60 px-2.5 py-1.5 text-[13px] text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300"
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
                {pronta1 ? (
                <>
                {/* SEGREGAÇÃO DE RECEITA — manual e CNPJ em 1 fluxo: valor por
                    parcela (mesmo anexo ou outro) + checkbox ST (ICMS/ISS). */}
                <SubCard
                  titulo="Segregação de receita"
                  aside={s.segAtivo ? (
                    <span className="rounded-full bg-sky-100 px-2 py-px text-[13px] font-bold text-sky-900 dark:bg-sky-950/50 dark:text-sky-200">
                      {s.segParcelas.filter((p) => p.valor > 0).length} parcela(s)
                      {segResultado?.temST ? ` · ST ${segResultado.tributosST.join('+')}` : ''}
                    </span>
                  ) : undefined}
                >
                  {!s.segAtivo ? (
                    <button
                      type="button"
                      onClick={() => {
                        s.set({ segAtivo: true, segParcelas: [{ id: `g${Date.now()}`, anexoId: s.anexoId, valor: 0, st: false }] });
                        s.tocarEntrada();
                      }}
                      className="btn btn-press btn-soft flex w-full items-center justify-center gap-2 !border-dashed"
                      title="Segregar a receita do mês por anexo, com ST opcional por parcela"
                    >
                      ＋ Segregar receita
                    </button>
                  ) : (
                    <div className="animate-fade-up space-y-2">
                      <p className="text-[13px] leading-relaxed text-slate-600">
                        Informe o valor de cada parcela — no <strong>mesmo anexo</strong> ou em <strong>outro</strong>.
                        Cada linha usa a <strong>RBT12 total</strong> ({fmtMoeda(s.rbt12)}) na tabela do seu anexo;
                        marque <strong>ST</strong> quando o ICMS/ISS da parcela já foi recolhido por substituição.
                        Anexo V com Fator R ≥ 28% calcula como III (mesma regra do cálculo normal).
                        O que não for segregado é calculado sozinho no anexo principal (restante).
                      </p>
                      {s.segParcelas.map((p, i) => {
                        // Rótulo ST segue o anexo EFETIVO (V redirecionado → III deduz ISS).
                        const anexoEfetivoUI = anexoEfetivoParcela(p.anexoId, s.rbt12, s.folha12).anexo;
                        const rotuloST = tributoSTDoAnexo(anexoEfetivoUI) === 'ICMS' ? 'ST ICMS' : 'ST ISS';
                        return (
                        <div key={p.id} className="rounded-xl border border-[var(--line)] bg-white p-2 dark:bg-slate-900">
                          <div className="mb-1.5 flex items-center gap-2">
                            <span className="text-[13px] font-black tracking-wide">Atividade {i + 1}</span>
                            {p.anexoId === 'V' ? (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[13px] font-bold text-amber-800 dark:bg-amber-950/50 dark:text-amber-200" title="Anexo V: o Fator R decide (folha ÷ RBT12 ≥ 28% → III)">Fator R</span>
                            ) : null}
                          </div>
                          <div className="flex items-end gap-2">
                            <label className="block w-28 shrink-0">
                              <span className="field-label">Anexo</span>
                              <Selecao
                                value={p.anexoId}
                                onChange={(e) => {
                                  const anexoId = e.target.value as AnexoSimplesId;
                                  s.set({ segParcelas: s.segParcelas.map((x) => (x.id === p.id ? { ...x, anexoId } : x)) });
                                  s.tocarEntrada();
                                }}
                              >
                                {ANEXOS.map((a) => <option key={a} value={a}>Anexo {a}{anexosSugeridosCnpj.includes(a) ? ' ★' : ''}</option>)}
                              </Selecao>
                            </label>
                            <div className="min-w-0 flex-1">
                              <CampoMoeda
                                rotulo={`Receita · Anexo ${p.anexoId}`}
                                valor={p.valor}
                                onValor={(v) => {
                                  s.set({ segParcelas: s.segParcelas.map((x) => (x.id === p.id ? { ...x, valor: Math.max(0, v) } : x)) });
                                  s.tocarEntrada();
                                }}
                              />
                            </div>
                            <button
                              type="button"
                              disabled={s.segParcelas.length <= 1}
                              title={s.segParcelas.length <= 1 ? 'Mínimo 1 parcela' : 'Remover parcela'}
                              aria-label={s.segParcelas.length <= 1 ? 'Mínimo 1 parcela' : `Remover parcela ${i + 1}`}
                              onClick={() => { s.set({ segParcelas: s.segParcelas.filter((x) => x.id !== p.id) }); s.tocarEntrada(); }}
                              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-[var(--line)] text-slate-600 transition hover:border-red-500 hover:text-red-500 disabled:opacity-30 dark:text-slate-300"
                            >
                              ✕
                            </button>
                          </div>
                          <label className="mt-1.5 flex cursor-pointer items-center gap-2 text-[13px] font-bold text-slate-600 dark:text-slate-300" title={`${rotuloST}: o ${rotuloST === 'ST ICMS' ? 'ICMS' : 'ISS'} desta parcela sai da guia (já recolhido pelo substituto)`}>
                            <input
                              type="checkbox"
                              className="h-4 w-4 shrink-0 accent-amber-600"
                              checked={p.st}
                              onChange={(e) => {
                                s.set({ segParcelas: s.segParcelas.map((x) => (x.id === p.id ? { ...x, st: e.target.checked } : x)) });
                                s.tocarEntrada();
                              }}
                            />
                            {rotuloST} — substituição tributária nesta parcela
                          </label>
                        </div>
                        );
                      })}
                      <div className={`rounded-xl px-2.5 py-1.5 font-mono text-[13px] tabular-nums ${segExcesso ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200' : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'}`}>
                        Segregado {fmtMoeda(segSoma)} de {fmtMoeda(s.receitaMes)}
                        {segExcesso
                          ? ` · ultrapassa ${fmtMoeda(segSoma - s.receitaMes)} — reduza`
                          : segResto > 0
                            ? ` · restante ${fmtMoeda(segResto)} no Anexo ${segRestoAnexo} ✓`
                            : ' · tudo segregado ✓'}
                      </div>
                      {segTemFatorR ? (
                        <div className="rounded-xl border border-[var(--line)] bg-slate-50/60 p-2.5 dark:bg-slate-950/40">
                          <div className="mb-1.5 flex items-center justify-between gap-2">
                            <span className="text-[13px] font-black uppercase tracking-wider text-slate-600">Fator R (III × V)</span>
                            {previsaoFR?.definido ? (
                              <span className={`rounded-full px-2 py-px text-[13px] font-bold ${previsaoFR.anexo === 'III' ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200' : 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200'}`}>
                                {previsaoFR.anexo} · {(previsaoFR.indice * 100).toFixed(2)}%
                              </span>
                            ) : <span className="text-[13px] text-slate-600">anexo V provisório</span>}
                          </div>
                          <div className="flex items-center justify-between gap-2 text-[13px]">
                            <span className="shrink-0 text-slate-600">Folha 12m (etapa 1)</span>
                            <span className="font-mono font-semibold">{s.folha12 > 0 ? fmtMoeda(s.folha12) : 'não informada'}</span>
                          </div>
                          {s.folha12 > 0 ? null : (
                            <p className="mt-1 text-[13px] leading-relaxed text-slate-600">Sem folha, o V fica provisório — volte à etapa 1 se quiser informar.</p>
                          )}
                        </div>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {s.segParcelas.length < 5 ? (
                          <Btn tam="sm" onClick={() => { s.set({ segParcelas: [...s.segParcelas, { id: `g${Date.now()}`, anexoId: s.anexoId, valor: 0, st: false }] }); s.tocarEntrada(); }}>
                            + Parcela
                          </Btn>
                        ) : null}
                        <button type="button" onClick={() => { s.set({ segAtivo: false, segParcelas: [] }); s.tocarEntrada(); }} className="text-[13px] font-bold text-red-600 hover:underline">
                          Remover segregação
                        </button>
                      </div>
                    </div>
                  )}
                </SubCard>
                <details className="rounded-xl border border-dashed border-[var(--line)] px-3 py-2">
                  <summary className="cursor-pointer text-[13px] font-bold">
                    Avançado — sublimite e regime híbrido
                    {s.compararHibrido || estouradoPasso1 ? <span className="ml-1 rounded-full bg-brand-100 px-1.5 py-px text-[13px] text-brand-700">ativo</span> : null}
                  </summary>
                  <div className="mt-2 space-y-2">
                    <p className={`rounded-xl px-2.5 py-1.5 text-[13px] leading-relaxed ${estouradoPasso1 ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200' : 'bg-slate-50 text-slate-600 dark:bg-slate-950/40 dark:text-slate-300'}`}>
                      {estouradoPasso1
                        ? `Sublimite estourado na etapa 1 (RBT12 ${fmtMoeda(s.rbt12)}${s.usarRba ? ` · RBA ${fmtMoeda(rbaPasso1)}` : ''} > ${fmtMoeda(SUBLIMITE)}). Para ajustar, volte à etapa 1 — aqui se informa só a alíquota de fora.`
                        : `Dentro do sublimite (${fmtMoeda(SUBLIMITE)}). Para informar RBA, volte à etapa 1.`}
                    </p>
                    {estouradoPasso1 && (mostraRefICMS || mostraRefISS) ? (
                      <div className="animate-fade-up space-y-2 rounded-xl border border-amber-200 bg-amber-50/50 p-2.5 dark:border-amber-900 dark:bg-amber-950/20">
                        <span className="field-label">Fora da guia (sublimite) — alíquota de referência</span>
                        {mostraRefICMS ? (
                          <div>
                            <span className="field-label">ICMS fora da guia (%)</span>
                            <Texto
                              type="number" step="0.01" min={0} max={30} mono className="field num-input h-12 text-base"
                              value={s.aliqRefICMS != null ? String((s.aliqRefICMS * 100).toFixed(2)) : previaConv ? String((previaConv.aliquotasFora.icms * 100).toFixed(2)) : ''}
                              placeholder={previaConv ? `Auto ${(previaConv.aliquotasFora.icms * 100).toFixed(2)}%` : 'Ex.: 18,00'}
                              onChange={(e) => { const t = e.target.value.replace(',', '.'); const v = t === '' ? null : Number(t) / 100; s.set({ aliqRefICMS: v == null || !(v >= 0) ? null : v }); s.tocarEntrada(); }}
                            />
                            <span className="mt-0.5 block text-[13px] text-slate-600">
                              {s.aliqRefICMS != null ? 'Manual — vale a alíquota informada.' : `Automático 5ª faixa (${previaConv ? (previaConv.aliquotasFora.icms * 100).toFixed(2) : '—'}%).`} <button type="button" className="font-bold underline" onClick={() => { s.set({ aliqRefICMS: null }); s.tocarEntrada(); }}>restaurar auto</button>
                            </span>
                          </div>
                        ) : null}
                        {mostraRefISS ? (
                          <div>
                            <span className="field-label">ISS fora da guia (%)</span>
                            <Texto
                              type="number" step="0.01" min={0} max={30} mono className="field num-input h-12 text-base"
                              value={s.aliqRefISS != null ? String((s.aliqRefISS * 100).toFixed(2)) : previaConv ? String((previaConv.aliquotasFora.iss * 100).toFixed(2)) : ''}
                              placeholder={previaConv ? `Auto ${(previaConv.aliquotasFora.iss * 100).toFixed(2)}%` : 'Ex.: 5,00'}
                              onChange={(e) => { const t = e.target.value.replace(',', '.'); const v = t === '' ? null : Number(t) / 100; s.set({ aliqRefISS: v == null || !(v >= 0) ? null : v }); s.tocarEntrada(); }}
                            />
                            <span className="mt-0.5 block text-[13px] text-slate-600">
                              {s.aliqRefISS != null ? 'Manual — vale a alíquota informada.' : `Automático 5ª faixa (${previaConv ? (previaConv.aliquotasFora.iss * 100).toFixed(2) : '—'}%).`} <button type="button" className="font-bold underline" onClick={() => { s.set({ aliqRefISS: null }); s.tocarEntrada(); }}>restaurar auto</button>
                            </span>
                          </div>
                        ) : null}
                        <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
                          O fora = receita do mês × referência. A guia DAS não muda — só o bloco “fora da guia” e a carga total.
                        </p>
                      </div>
                    ) : null}
                    <label className="flex cursor-pointer items-center gap-2 text-[13px] font-bold">
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
                            type="number" step="0.01" min={0} max={30} mono className="field num-input h-12 text-base"
                            value={String((s.cbsRef * 100).toFixed(2))}
                            onChange={(e) => { const v = Number(e.target.value.replace(',', '.')) || 0; s.set({ cbsRef: v / 100 }); s.tocarEntrada(); }}
                          />
                          <span className="mt-0.5 block text-[13px] text-slate-600">Padrão 8,80%</span>
                        </div>
                        <div className="space-y-1.5">
                          <span className="field-label">Despesas (crédito CBS)</span>
                          <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
                            <strong>Valor (R$/mês):</strong> quanto a empresa gasta no mês com o item — é a base do crédito.
                            O crédito de cada linha = valor × CBS {(s.cbsRef * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}% × fator da regra.
                          </p>
                          <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
                            <strong>Regra de crédito:</strong> quanto da alíquota vira crédito — Integral 100%, Red. 30% (70%),
                            Red. 60% (40%), Zero / S/ crédito (0%). Ex.: aluguel usa 30% da alíquota por padrão.
                          </p>
                          <div className="hidden overflow-x-auto rounded-2xl border-2 border-[var(--line)] sm:block">
                            <table className="tbl tbl-compacta simples-tabela w-full min-w-[504px]">
                              <thead>
                                <tr className="border-b border-[var(--line)] text-left text-[13px] uppercase tracking-wide text-slate-600">
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
                                        <span className="block truncate text-[13px] font-semibold" title={dd.rotulo}>{dd.rotulo}</span>
                                        <span className={`font-mono text-[13px] ${cred > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-300'}`} title={`Crédito = valor × CBS × fator da regra (${dd.regra})`}>{fmtMoeda(cred)} crédito</span>
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
                                        <button type="button" className="text-slate-500 transition hover:text-red-500 dark:text-slate-300" title="Remover" onClick={() => s.setDespesas(s.despesas.filter((x) => x.id !== dd.id))}>✕</button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                              <tfoot>
                                <tr className="border-t-2 border-[var(--line)]">
                                  <td className="px-2 font-bold">Total</td>
                                  <td className="w-[154px] px-2 text-right font-mono font-black tabular-nums">{fmtMoeda(s.despesas.reduce((a, d) => a + d.valor, 0))}</td>
                                  <td className="w-[154px] px-2 font-mono text-[13px] font-black tabular-nums text-emerald-700 dark:text-emerald-300">{fmtMoeda(s.despesas.reduce((a, d) => a + creditoDaDespesa(d, s.cbsRef), 0))} crédito</td>
                                  <td className="w-8" />
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                          <div className="space-y-2 sm:hidden">
                            {s.despesas.map((dd) => {
                              const credMobile = creditoDaDespesa(dd, s.cbsRef);
                              return (
                                <div key={dd.id} className="rounded-xl border border-[var(--line)] p-2.5">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="truncate text-[13px] font-semibold" title={dd.rotulo}>{dd.rotulo}</p>
                                      <p className={`font-mono text-[13px] ${credMobile > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-600'}`}>{fmtMoeda(credMobile)} crédito</p>
                                    </div>
                                    <button type="button" aria-label={`Remover ${dd.rotulo}`} title="Remover" onClick={() => s.setDespesas(s.despesas.filter((x) => x.id !== dd.id))} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-600 transition hover:text-red-500 dark:text-slate-300">✕</button>
                                  </div>
                                  <div className="mt-2 flex items-center justify-between gap-2">
                                    <DespesaValor valor={dd.valor} onValor={(v) => editarDespesa(dd.id, { valor: v })} />
                                    <SeletorRegraCredito valor={dd.regra} onChange={(v) => editarDespesa(dd.id, { regra: v })} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <Btn tam="sm" onClick={() => s.setDespesas([...s.despesas, { id: `s${Date.now()}`, rotulo: 'Outra despesa', valor: 0, regra: 'integral' }])}>
                            + Despesa
                          </Btn>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </details>

                {/* NAVEGAÇÃO ETAPA 2 */}
                <div ref={ctaRef} className="flex scroll-mt-24 flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-white/95 p-3 shadow-pop backdrop-blur sm:static sm:bg-slate-50/50 sm:shadow-none sm:backdrop-blur-0 dark:bg-slate-900/95 dark:sm:bg-slate-950/30">
                  <Btn tam="sm" onClick={() => irPara(1)}>← Dados</Btn>
                  <Btn tam="sm" variante="primary" carregando={gerando} onClick={visualizar}>
                    {gerando ? 'Calculando…' : '✦ Ver resultado'}
                  </Btn>
                </div>
                </>
                ) : (
                  <p className="rounded-xl border border-dashed border-[var(--line)] bg-slate-50/50 px-3 py-2.5 text-center text-[13px] text-slate-600 dark:bg-slate-950/30">
                    {s.modo === 'manual'
                      ? '↑ Escolha um Anexo acima para liberar segregação e cálculo.'
                      : s.opcoes.length === 0
                        ? '↑ Busque o CNPJ — escolha 1 atividade para liberar o restante.'
                        : '↑ Escolha 1 atividade — as demais somem.'}
                  </p>
                )}
              </section>
              </Secao>
            ) : (
              <p className="rounded-xl border border-dashed border-[var(--line)] bg-slate-50/50 px-3 py-2.5 text-center text-[13px] text-slate-600 dark:bg-slate-950/30">
                ↑ Informe RBT12 e receita do mês acima para liberar o anexo.
              </p>
            )}
            </>
            ) : null}
          </div>
          ) : null}
        </Painel>
        </Entrada>
      </div>

      {/* ETAPA 3 — RESULTADO rico: memória, DAS, gráficos e extras */}
      {etapa === 3 ? (
        <div className="animate-slide-in mt-2 space-y-4" aria-live="polite">
          {gerando && !mostrando ? (
            <div className="animate-slide-in overflow-hidden rounded-2xl border border-[var(--line)] bg-white dark:bg-slate-900">
              <div className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-2.5">
                <span className="grid h-7 w-7 animate-pulse-soft place-items-center rounded-lg bg-gradient-to-br from-brand-700 to-brand-600 text-white">✨</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-black">Aurum AI calculando…</div>
                  <div className="truncate text-[13px] text-slate-600">Cruzando RBT12, faixa e repartição…</div>
                </div>
              </div>
              <div className="space-y-2 p-3">
                <div className="skeleton h-10 w-2/3" />
                <div className="skeleton h-10 w-full" />
                <div className="skeleton h-10 w-full" />
              </div>
            </div>
          ) : mostrando ? (
            <div className="animate-slide-in space-y-3" key={`${s.convencional!.anexoId}-${convExib!.das}-${segResultado?.deducaoST ?? 0}-${segResultado?.das ?? 0}`}>
              {/* MEMÓRIA lado a lado (mesma altura): base | desmembramentos + fechamento */}
              <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[1fr_1fr]">
              <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white dark:bg-slate-900">
                <div className="border-b border-[var(--line)] px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xl font-extrabold tracking-tight">Memória de cálculo</h3>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span className="rounded-full bg-brand-100 px-2 py-px text-[13px] font-bold text-brand-700 dark:bg-aurum-500/15 dark:text-aurum-200">
                        {segResultado ? `Segregado ${segResultado.anexos.join(' + ')}` : ANEXO_LABEL[convBase!.anexoId]}
                      </span>
                      <button
                        type="button"
                        onClick={() => irPara(1)}
                        title="Voltar e ajustar os dados (o resultado é mantido até recalcular)"
                        className="btn-press rounded-full border border-[var(--line)] px-2 py-px text-[13px] font-bold text-slate-600 transition-all hover:border-brand-700 hover:text-brand-700 dark:text-slate-300"
                      >
                        ‹ Editar
                      </button>
                    </span>
                  </div>
                  {s.modo === 'cnpj' && s.empresaNome ? (
                    <p className="mt-1.5 truncate text-[13px] text-slate-600" title={`${s.empresaNome} · ${fmtCnpj(s.cnpj)}${s.cnaeEscolhido && cnaeAtivo ? ` · ${cnaeAtivo.codigoFormatado}` : ''}`}>
                      <strong className="text-slate-700 dark:text-slate-200">{s.empresaNome}</strong>
                      {' · '}{fmtCnpj(s.cnpj)}
                      {s.cnaeEscolhido && cnaeAtivo ? ` · CNAE ${cnaeAtivo.codigoFormatado}` : ''}
                    </p>
                  ) : null}
                </div>
                <dl className="space-y-2.5 px-4 py-4 text-[13px] leading-relaxed">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="shrink-0 text-slate-600">Receita 12 meses</dt>
                    <dd className="font-mono font-black">{fmtMoeda(s.rbt12)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="shrink-0 text-slate-600">Receita do mês</dt>
                    <dd className="font-mono font-black">{fmtMoeda(s.receitaMes)}</dd>
                  </div>
                  {precisaFolha ? (
                    <div className="flex items-center justify-between gap-3">
                      <dt className="shrink-0 text-slate-600">Folha 12m</dt>
                      <dd className="font-mono font-semibold">{s.folha12 > 0 ? fmtMoeda(s.folha12) : '—'}</dd>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between gap-3">
                    <dt className="shrink-0 text-slate-600">Alíquota aplicada</dt>
                    <dd className="font-mono font-bold text-brand-700 dark:text-aurum-200" title={segResultado ? 'Média ponderada = DAS total ÷ receita total (cada parcela tem a sua abaixo)' : undefined}>
                      {segResultado ? `${fmtCarga(segResultado.aliquotaMedia * 100)} · média ponderada` : fmtCarga(convBase!.aliquotaEfetiva * 100)}
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-3 border-t border-[var(--line)] pt-2.5">
                    <dt className="shrink-0 text-slate-600">Anexos</dt>
                    <dd className="text-right font-bold">
                      {segResultado
                        ? segResultado.anexos.map((a) => `Anexo ${a}`).join(' + ')
                        : ANEXO_LABEL[convBase!.anexoId]}
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white dark:bg-slate-900">
                <div className="border-b border-[var(--line)] px-4 py-3">
                  <h3 className="text-xl font-extrabold tracking-tight">Desmembramentos e fechamento</h3>
                </div>
                {segResultado ? (
                  <div className="px-4 py-3">
                    <p className="mb-2 text-[13px] font-bold uppercase tracking-wider text-slate-600">Desmembramentos no faturamento mensal</p>
                    <div className="space-y-2">
                      {segResultado.parcelas.map((d, idx) => (
                        <div key={`${d.anexoId}-${idx}`} style={segResultado ? { animationDelay: `${Math.min(idx, 6) * 90}ms` } : undefined} className="animate-fade-up rounded-xl bg-slate-50/70 px-3 py-2 dark:bg-slate-950/40">
                          <div className="flex items-center justify-between gap-2 text-[13px]">
                            <strong>
                              {d.anexoCalculado !== d.escolhido
                                ? `Anexo ${d.escolhido} → ${d.anexoCalculado}`
                                : d.resto ? `Restante · Anexo ${d.anexoId}` : `Anexo ${d.anexoId}`}
                              {d.anexoCalculado !== d.escolhido ? <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-px text-[13px] font-bold text-amber-800 dark:bg-amber-950/50 dark:text-amber-200" title="Fator R ≥ 28%: Anexo V tributado como III">Fator R</span> : null}
                              {d.st && d.deducaoST > 0 ? <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-px text-[13px] font-bold text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">ST {d.tributoST}</span> : null}
                              {d.st && d.deducaoST <= 0 ? <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-px text-[13px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300" title={d.excedeSublimite && d.tributosFora.includes(d.tributoST ?? '') ? 'ST marcada, mas o tributo já está fora da guia pelo sublimite — nada a deduzir' : 'ST marcada, mas o tributo é zerado nesta faixa — nada a deduzir'}>ST sem dedução</span> : null}
                            </strong>
                            <span className="font-mono">
                              {d.st && d.deducaoST > 0 ? <span className="mr-1.5 text-slate-600 line-through" title="Guia da parcela antes da ST">{fmtMoeda(d.dasBrutoGuia)}</span> : null}
                              <strong className="font-black">{fmtMoeda(d.dasGuia)}</strong>
                            </span>
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center justify-between gap-2 font-mono text-[13px] text-slate-600">
                            <span>Receita {fmtMoeda(d.receitaMes)}</span>
                            <span>{d.faixa}ª faixa · {fmtCarga(d.aliquotaEfetiva * 100)}</span>
                          </div>
                        </div>
                      ))}
                      <p className="pt-0.5 text-[13px] leading-relaxed text-slate-600">
                        Cada parcela usa a RBT12 total ({fmtMoeda(segResultado.rbt12)}) na sua tabela; o DAS é a soma.
                      </p>
                    </div>
                  </div>
                ) : null}
                {/* FECHAMENTO — a conta em 3 linhas: bruto, ST, a pagar */}
                <div className="border-t border-[var(--line)] px-4 py-3">
                  <p className="mb-2 text-[13px] font-bold uppercase tracking-wider text-slate-600">Fechamento</p>
                  {segResultado ? (
                    <div className="space-y-1 text-[13px]">
                      <div className="flex items-center justify-between gap-3">
                        <span className="shrink-0 text-slate-600">1 · Guia bruta (sem ST)</span>
                        <span className="font-mono font-semibold">{fmtMoeda(segResultado.dasBrutoGuia)}</span>
                      </div>
                      {segResultado.tributosST.map((t) => (
                        <div key={t} className="flex items-center justify-between gap-3" title={infoSTPorTributo[t] ?? t}>
                          <span className="shrink-0 text-slate-600">2 · − ST {t}</span>
                          <span className="font-mono font-semibold text-amber-700">− {fmtMoeda(deducaoSTPorTributo[t] ?? 0)}</span>
                        </div>
                      ))}
                      {!segResultado.temST && segResultado.parcelas.some((d) => d.st) ? (
                        <div className="flex items-center justify-between gap-3" title="ST marcada, mas o tributo é zerado nesta faixa — nada a deduzir">
                          <span className="shrink-0 text-slate-600">2 · − ST</span>
                          <span className="font-mono font-semibold text-slate-600">R$ 0,00 (sem dedução)</span>
                        </div>
                      ) : null}
                      <div className="flex items-center justify-between gap-3 border-t border-[var(--line)] pt-1.5">
                        <span className="font-black">{segResultado.temST ? '3 · Guia DAS a pagar' : '2 · Guia DAS a pagar'}</span>
                        <span className="font-mono font-black">{fmtMoeda(segResultado.dasGuia)}</span>
                      </div>
                      {segResultado.excedeSublimite ? (
                        <div className="flex items-center justify-between gap-3">
                          <span className="shrink-0 text-slate-600">+ fora sublimite</span>
                          <span className="font-mono font-semibold">{fmtMoeda(segResultado.foraSublimite.total)}</span>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3 text-[13px]">
                      <span className="font-black">{convBase?.excedeSublimite ? 'Guia DAS a pagar' : 'DAS a pagar'}</span>
                      <span className="font-mono font-black">{fmtMoeda(convBase?.dasGuia ?? convBase?.das ?? 0)}</span>
                    </div>
                  )}
                </div>
              </div>
              </div>
              <div className="calc-hero simples-hero overflow-hidden rounded-2xl lg:sticky lg:top-4">
                <div className="px-4 pb-4 pt-4" role="status" aria-live="polite">
                  <div className="flex items-center justify-between gap-2">
                    <span className="calc-hero-rotulo truncate">DAS · {segResultado ? `Segregado ${segResultado.anexos.join(' + ')}` : `${ANEXO_LABEL[convBase!.anexoId]} · ${convBase!.faixa}ª faixa`}{stResumo ? ` · ST ${stResumo.tributo}` : ''}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span className="rounded-full bg-white/15 px-2 py-0.5 text-[13px] font-bold text-white">
                        {s.modo === 'manual' ? 'Manual' : 'CNPJ'} · Anexo {convBase!.anexoId}
                      </span>
                      <span className="shrink-0 rounded-full bg-white/15 px-1.5 py-px font-mono text-[13px] font-bold text-white">
                        {convBase!.cenario === 1 ? 's/ sublimite' : `cen. ${convBase!.cenario}`}
                      </span>
                    </span>
                  </div>
                  <NumeroAnimado valor={dasExib} formatar={(n) => `${convExib!.excedeSublimite ? 'Guia DAS' : 'DAS'}: ${fmtMoeda(n)}`} className="calc-hero-valor mt-0.5 block truncate font-mono text-3xl font-black tabular-nums leading-tight text-white sm:text-4xl" />
                  {convExib!.excedeSublimite ? (
                    <div className="mt-0.5 text-[13px] leading-relaxed text-white/75">
                      Guia sem {convExib!.tributosFora.join(' + ')} · fora {fmtMoeda(convExib!.foraSublimite.total)} → carga {fmtMoeda(cargaTotalExib)}
                    </div>
                  ) : null}
                  {s.segAtivo && segResultado ? (
                    <div className="mt-0.5 text-[13px] leading-relaxed text-white/75">
                      Bruto {fmtMoeda(segResultado.dasBrutoGuia)} − diferença {fmtMoeda(segResultado.dasBrutoGuia - dasExib)}
                      {stResumo ? ` (ST ${stResumo.tributo})` : ''} = Final
                    </div>
                  ) : null}
                  {s.segAtivo && segResultado && s.convencional && Math.abs(dasBruto - segResultado.dasBrutoGuia) > 0.005 ? (
                    <div className="mt-0.5 text-[13px] leading-relaxed text-white/60">
                      Sem segregar ({ANEXO_LABEL[s.convencional.anexoId]}): {fmtMoeda(dasBruto)} — referência
                    </div>
                  ) : null}
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-[13px] text-white/75">
                    <span className="truncate">CBS {fmtMoeda(convBase!.cbsDentroDAS)}</span>
                    <span className="shrink-0 rounded-full bg-aurum-400/25 px-1.5 py-px font-mono font-bold text-aurum-200">
                      {fmtCarga(convBase!.aliquotaEfetiva * 100)}
                    </span>
                  </div>
                  <div className="mt-2">
                    <Barra
                      partes={[
                        { rotulo: 'IRPJ', valor: repExib!.IRPJ, classe: 'calc-bar-ibs', cor: '#2b3f63' },
                        { rotulo: 'CSLL', valor: repExib!.CSLL, classe: 'calc-bar-ibs', cor: '#475569' },
                        { rotulo: 'CBS', valor: repExib!.CBS, classe: 'calc-bar-cbs', cor: '#be9433' },
                        { rotulo: 'IBS', valor: repExib!.IBS, classe: 'calc-bar-ibs', cor: '#eab308' },
                        { rotulo: 'CPP', valor: repExib!.CPP, classe: 'calc-bar-cbs', cor: '#047857' },
                        { rotulo: 'ICMS/IPI/ISS', valor: repExib!.ICMS + repExib!.IPI + repExib!.ISS, classe: 'calc-bar-ibs', cor: '#0284c7' },
                      ]}
                    />
                  </div>
                </div>
                <div className="space-y-1.5 bg-white px-4 py-3.5 text-sm leading-relaxed dark:bg-slate-900">
                  {reparticaoVisiveis.map((t) => {
                    const dedST = deducaoSTPorTributo[t as 'ICMS' | 'ISS'] ?? 0;
                    const ehST = dedST > 0;
                    return (
                      <div key={t} className="flex items-center justify-between gap-2 text-[13px]">
                        <span className="text-slate-600">
                          {t}
                          {ehST ? <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-px text-[13px] font-bold text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">ST</span> : null}
                        </span>
                        {ehST ? (
                          <span className="text-right font-mono">
                            <strong className="font-semibold">{fmtMoeda(repExib![t])}</strong>
                            <span className="ml-1.5 text-amber-700 line-through" title={`ST: − ${fmtMoeda(dedST)} da parcela ${infoSTPorTributo[t as 'ICMS' | 'ISS'] ?? t} — as demais receitas seguem normais na guia`}>− {fmtMoeda(dedST)}</span>
                          </span>
                        ) : (
                          <span className="font-mono font-semibold">{fmtMoeda(repExib![t])}</span>
                        )}
                      </div>
                    );
                  })}
                  {reparticaoItens.length > 4 ? (
                    <button type="button" onClick={() => setReparticaoAberta((v) => !v)} className="text-[13px] font-bold text-brand-700 dark:text-aurum-200">
                      {reparticaoAberta ? '▾ Recolher' : `▸ Ver todos os ${reparticaoItens.length} tributos`}
                    </button>
                  ) : null}
                  {convBase!.excedenteISS > 0 ? (
                    <p className="rounded-lg bg-amber-50 px-2 py-1 text-[13px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                      ISS travado em 5% (excedente redistribuído).
                    </p>
                  ) : null}
                  {convBase!.cenario !== 1 ? (
                    <p className="rounded-lg bg-sky-50 px-2 py-1 text-[13px] text-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
                      Sublimite cen. {convBase!.cenario} · guia {fmtMoeda(dasExib)} + fora {fmtMoeda(convBase!.foraSublimite.total)} = carga {fmtMoeda(cargaTotalExib)}.
                    </p>
                  ) : null}
                  {convExib!.excedeSublimite ? (
                    <div className="space-y-1 rounded-lg bg-amber-50 px-2 py-1.5 text-[13px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                      <p className="font-bold">Fora da guia (sublimite){convExib!.usouReferencia.icms || convExib!.usouReferencia.iss ? ' · referência manual' : ' · automático 5ª faixa'}</p>
                      {convExib!.foraSublimite.icms > 0 ? <div className="flex justify-between"><span>ICMS {(convExib!.aliquotasFora.icms * 100).toFixed(2)}%</span><strong className="font-mono">{fmtMoeda(convExib!.foraSublimite.icms)}</strong></div> : null}
                      {convExib!.foraSublimite.iss > 0 ? <div className="flex justify-between"><span>ISS {(convExib!.aliquotasFora.iss * 100).toFixed(2)}%</span><strong className="font-mono">{fmtMoeda(convExib!.foraSublimite.iss)}</strong></div> : null}
                      {convExib!.foraSublimite.ibs > 0 ? <div className="flex justify-between"><span>IBS {(convExib!.aliquotasFora.ibs * 100).toFixed(2)}%</span><strong className="font-mono">{fmtMoeda(convExib!.foraSublimite.ibs)}</strong></div> : null}
                      <div className="flex justify-between border-t border-amber-200 pt-1 font-bold"><span>Carga total do mês</span><span className="font-mono">{fmtMoeda(cargaTotalExib)}</span></div>
                    </div>
                  ) : null}
                  {fr && precisaFolha ? (
                    <p className={`rounded-lg px-2 py-1 text-[13px] ${fr.anexo === 'III' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'}`}>
                      Fator R {(fr.indice * 100).toFixed(2)}% → {fr.anexo === 'III' ? 'III (≥ 28%)' : 'V (< 28%)'}.
                    </p>
                  ) : precisaFolha ? (
                    <p className="rounded-lg bg-slate-100 px-2 py-1 text-[13px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
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
                <div className="flex flex-wrap gap-1.5 bg-white px-4 pb-4 dark:bg-slate-900">
                  <Btn tam="sm" className="flex-1" onClick={reiniciar}>↺ Reiniciar</Btn>
                  <Btn tam="sm" variante="primary" className="flex-[2]" carregando={pdfAnalitico.carregando} onClick={() => pdfAnalitico.executar()}>
                    {pdfAnalitico.carregando ? 'Gerando…' : 'PDF analítico'}
                  </Btn>
                </div>
              </div>

              <div key={`graf-${segResultado?.dasGuia ?? 0}-${stResumo?.deducao ?? 0}`} className={segResultado ? 'animate-fade-up' : undefined}>
                <LimiteErroGrafico>
                  <GraficosDAS
                    final={repExib!}
                    bruta={segResultado?.temST ? segResultado.reparticaoBrutaGuia : undefined}
                    dasBruto={segResultado?.dasBrutoGuia ?? dasExib}
                    dasFinal={dasExib}
                    temST={!!stResumo}
                  />
                </LimiteErroGrafico>
              </div>

              {s.compararHibrido && hibExib ? (
                <Painel>
                  <div className="border-b border-[var(--line)] px-3 py-2">
                    <h3 className="text-[13px] font-black text-slate-600">⚖ Convencional × Híbrido{segResultado ? ' (seg.)' : ''}{convExib!.excedeSublimite ? ' · guia' : ''}</h3>
                  </div>
                  <div className="space-y-1.5 p-3 text-[13px]">
                    <div className="flex justify-between"><span className="text-slate-600">Guia conv.{stResumo ? ' (c/ ST)' : ''}</span><strong className="font-mono">{fmtMoeda(dasExib)}</strong></div>
                    <div className="flex justify-between"><span className="text-slate-600">DAS reduzido (guia s/ CBS)</span><strong className="font-mono">{fmtMoeda(hibExib.dasReduzido)}</strong></div>
                    <div className="flex justify-between"><span className="text-slate-600">CBS fora</span><strong className="font-mono">{fmtMoeda(hibExib.cbsFora)}</strong></div>
                    <div className="flex justify-between border-t border-[var(--line)] pt-1.5"><span className="font-bold">Total híbrido (guia)</span><strong className="font-mono">{fmtMoeda(hibExib.total)}</strong></div>
                    {convExib!.excedeSublimite ? (
                      <>
                        <div className="flex justify-between"><span className="text-slate-600">+ fora sublimite ({convExib!.tributosFora.join('+')})</span><strong className="font-mono">{fmtMoeda(convExib!.foraSublimite.total)}</strong></div>
                        <div className="flex justify-between"><span className="font-bold">Carga híbrida total</span><strong className="font-mono">{fmtMoeda(hibExib.cargaTotal)}</strong></div>
                      </>
                    ) : null}
                    <div className={`rounded-xl px-2.5 py-1.5 text-center text-[13px] font-bold ${
                      hibExib.melhor === 'hibrido' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200'
                      : hibExib.melhor === 'convencional' ? 'bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200'
                      : 'bg-slate-100 text-slate-600'}`}>
                      {hibExib.melhor === 'empate' ? 'Empate técnico' : hibExib.melhor === 'hibrido'
                        ? `Híbrido − ${fmtMoeda(Math.abs(hibExib.economiaVsConvencional))}`
                        : `Convencional − ${fmtMoeda(Math.abs(hibExib.economiaVsConvencional))}`}
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
              <p className="px-1 text-[13px] leading-relaxed text-slate-600">
                Planilhas 2027–2028 · confirme com o contador.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      <DasModal aberto={dasAberto} onFechar={() => setDasAberto(false)} dados={dadosDas} />
      {relatorioAnalitico ? (
        <InsightsModal report={relatorioAnalitico} insights={insightsAnaliticos} aberto={insightsAberto} onFechar={() => setInsightsAberto(false)} />
      ) : null}
      <ModalDivisaoView />
    </div>
  );
}
