/**
 * Simples Nacional — seletor custom da regra de crédito CBS, com menu em portal.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { RegraCreditoCBS } from '@/simples/calculo'

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

export { OPCOES_REGRA, SeletorRegraCredito }
