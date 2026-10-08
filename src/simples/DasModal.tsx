/**
 * Simples Nacional — modal DAS (Documento de Arrecadação).
 *
 * Réplica fiel do DAS oficial PGDAS ( CK: caixas separadas, labels fora do
 * verde, tabela com célula Multa/Juros vazia, SENDA 1.8.0, autenticação +
 * canhoto com ITF real ). Documento sempre branco, sem dark-mode.
 */
import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { fmtCnpj, fmtMoeda } from '@/domain/services/format';
import { empilharEscapeModal, ehTopoEscapeModal } from '@/ui/kit';
import type { ResultadoConvencional } from './calculo';
import type { TributoSimples } from './tabelas';

/** Código oficial por tributo (1004/1005 reaproveitados p/ CBS/IBS da reforma). */
export const CODIGO_DAS: Record<TributoSimples, string> = {
  IRPJ: '1001',
  CSLL: '1002',
  CBS: '1004',
  IBS: '1005',
  CPP: '1006',
  ICMS: '1007',
  IPI: '1008',
  ISS: '1010',
};

export const DENOMINACAO_DAS: Record<TributoSimples, string> = {
  IRPJ: 'IRPJ - SIMPLES NACIONAL',
  CSLL: 'CSLL - SIMPLES NACIONAL',
  CBS: 'CBS - SIMPLES NACIONAL',
  IBS: 'IBS - SIMPLES NACIONAL',
  CPP: 'CPP - SIMPLES NACIONAL',
  ICMS: 'ICMS - SIMPLES NACIONAL',
  IPI: 'IPI - SIMPLES NACIONAL',
  ISS: 'ISS - SIMPLES NACIONAL',
};

export interface ItemDas {
  codigo: string;
  denominacao: string;
  principal: number;
  /** Segunda linha da denominação (ex.: "09/2026" ou "FORTALEZA (CE) - 09/2026"). */
  detalhe?: string;
}

export interface DadosDas {
  empresa: string;
  cnpj: string | null;
  periodoApuracao: string;
  competenciaCurta: string;
  vencimento: string;
  numeroDocumento: string;
  itens: ItemDas[];
  total: number;
  observacoes: string;
  emitidoEm: string;
}

const ORDEM: TributoSimples[] = ['IRPJ', 'CSLL', 'CBS', 'IBS', 'CPP', 'ICMS', 'IPI', 'ISS'];

/** Apenas número com vírgula, sem "R$" (padrão do DAS). */
export const val = (n: number): string => fmtMoeda(n).replace('R$', '').replace(/\s/g, '');

function periodoAnterior(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth() - 1, 1);
}

function nomeMesLower(d: Date): string {
  return d.toLocaleString('pt-BR', { month: 'long' }).toLowerCase();
}

function gerarNumero(conv: ResultadoConvencional): string {
  const base = `${String(conv.faixa)}${String(conv.cenario)}${String(Math.round(conv.das * 100))}`;
  const dig = (base + Date.now().toString()).replace(/\D+/g, '').padEnd(16, '0').slice(0, 16);
  const dv = Number(dig.slice(-2)) % 10;
  return `07.20.${dig.slice(0, 5)}.${dig.slice(5, 12)}-${dig.slice(12, 13)}${dv}`;
}

/** Monta os dados do documento a partir do cálculo + origem (CNPJ x manual). */
export function montarDadosDas(
  conv: ResultadoConvencional,
  opts: { modo: 'manual' | 'cnpj'; empresaNome: string; cnpj: string; cnae: string; rbt12: number; receitaMes: number; st?: { tributo: string; valorST: number; deducao: number; detalhe?: string }; seg?: { anexos: string[]; temResto: boolean; redir: string[] } },
): DadosDas {
  const hoje = new Date();
  const per = periodoAnterior(hoje);
  const periodoApuracao = `${nomeMesLower(per)}/${per.getFullYear()}`;
  const competenciaCurta = `${String(per.getMonth() + 1).padStart(2, '0')}/${per.getFullYear()}`;
  const vencimento = `20/${String(hoje.getMonth() + 1).padStart(2, '0')}/${hoje.getFullYear()}`;
  // Com excesso de sublimite a guia DAS NÃO contém ICMS/ISS/IBS do sublimite:
  // o documento usa só a repartição da guia.
  const repGuia = conv.reparticaoGuia ?? conv.reparticao;
  const totalGuia = conv.dasGuia ?? conv.das;
  const itens: ItemDas[] = ORDEM.filter((t) => repGuia[t] > 0.005).map((t) => ({
    codigo: CODIGO_DAS[t],
    denominacao: DENOMINACAO_DAS[t],
    principal: repGuia[t],
    detalhe: competenciaCurta,
  }));
  const viaCnpj = opts.modo === 'cnpj' && opts.empresaNome.trim().length > 0;
  const empresa = viaCnpj ? opts.empresaNome.trim().toUpperCase() : 'CONTRIBUINTE — CÁLCULO MANUAL';
  const cnpj = viaCnpj ? opts.cnpj : null;
  const obsBase = `Anexo ${conv.anexoId} · ${conv.faixa}ª faixa · RBT12 ${fmtMoeda(opts.rbt12)} · Receita ${fmtMoeda(opts.receitaMes)}`;
  const obsSub = conv.excedeSublimite
    ? ` · Sublimite cen. ${conv.cenario}: ${conv.tributosFora.join('+')} por fora (${fmtMoeda(conv.foraSublimite.total)}) — guia sem esses tributos`
    : '';
  const obsSeg = opts.seg
    ? ` · Segregado ${opts.seg.anexos.join(' + ')}${opts.seg.temResto ? ' (inclui restante automático)' : ''}${opts.seg.redir.length > 0 ? ` (${opts.seg.redir.join(', ')})` : ''}`
    : '';
  const obsST = opts.st && opts.st.deducao > 0
    ? ` · ${opts.st.detalhe || `ST ${opts.st.tributo} ${fmtMoeda(opts.st.valorST)} (deduzido ${fmtMoeda(opts.st.deducao)})`}`
    : '';
  const observacoes =
    viaCnpj && opts.cnae
      ? `${obsBase}${obsSub}${obsSeg}${obsST} · CNAE ${opts.cnae} · Documento elaborado pelo Aurum TAX`
      : `${obsBase}${obsSub}${obsSeg}${obsST} · Documento elaborado pelo Aurum TAX – sem validade fiscal`;
  return {
    empresa,
    cnpj,
    periodoApuracao,
    competenciaCurta,
    vencimento,
    numeroDocumento: gerarNumero(conv),
    itens,
    total: totalGuia,
    observacoes,
    emitidoEm: hoje.toLocaleString('pt-BR'),
  };
}

/* ------------------------------- ITF / QR ------------------------------- */

/** Dígito verificador módulo 10 (pesos 2,1 da direita para a esquerda). */
function mod10(campo: string): string {
  let s = 0;
  for (let i = 0; i < campo.length; i++) {
    const d = Number(campo[i]) * ((campo.length - i) % 2 === 1 ? 2 : 1);
    s += d > 9 ? d - 9 : d;
  }
  return String((10 - (s % 10)) % 10);
}

/**
 * 4 grupos de arrecadação 11+1 DV — zerados (simulação, sem pagamento real).
 * Mantém a quantidade de dígitos do layout oficial: 4 × (11 + 1 DV).
 */
export function gruposArrecadacao(_d: Pick<DadosDas, 'total' | 'competenciaCurta' | 'numeroDocumento' | 'cnpj'>): { n: string; dv: string }[] {
  const n = '00000000000';
  return [0, 1, 2, 3].map(() => ({ n, dv: mod10(n) }));
}

/** Padrões ITF (par de dígitos → sequência barra/espaço). Tabela padrão 0–99. */
const ITF_D: Record<string, string> = {
  '0': '00110', '1': '10001', '2': '01001', '3': '11000', '4': '00101',
  '5': '10100', '6': '01100', '7': '00011', '8': '10010', '9': '01010',
};

/** Codifica dígitos em larguras narrow(1)/wide(3), intercalando barras+espaços. */
function largurasITF(digitos: string): number[] {
  const d = digitos.length % 2 === 1 ? `0${digitos}` : digitos;
  const out: number[] = [1, 1, 1, 1]; // start
  for (let i = 0; i < d.length; i += 2) {
    const b = ITF_D[d[i]];
    const s = ITF_D[d[i + 1]];
    for (let k = 0; k < 5; k++) {
      out.push(b[k] === '1' ? 3 : 1);
      out.push(s[k] === '1' ? 3 : 1);
    }
  }
  out.push(3, 1, 1); // stop
  return out;
}

/** Código de barras ITF real a partir dos dígitos (barras pretas, fundo branco). */
export function BarrasITF({ digitos, altura = 48, className = '' }: { digitos: string; altura?: number; className?: string }) {
  const seq = useMemo(() => largurasITF(digitos.replace(/\D+/g, '') || '0'), [digitos]);
  const total = seq.reduce((a, b) => a + b, 0);
  let x = 0;
  const rects: { x: number; w: number }[] = [];
  seq.forEach((w, i) => {
    if (i % 2 === 0) rects.push({ x, w });
    x += w;
  });
  return (
    <svg viewBox={`0 0 ${total} ${altura}`} preserveAspectRatio="none" className={className} style={{ height: altura, width: '100%', background: '#fff' }} aria-hidden="true">
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={0} width={r.w} height={altura} fill="#000" />
      ))}
    </svg>
  );
}

/** QR placeholder determinístico (finder patterns + módulos do hash). Sem dependências. */
export function QrFake({ seed, tamanho = 90 }: { seed: string; tamanho?: number }) {
  const n = 25;
  let h = 2166136261;
  for (const c of seed) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  const rnd = (i: number): boolean => {
    h = Math.imul(h ^ (i * 2246822519), 3266489917);
    return ((h >>> 8) & 1) === 1;
  };
  const finder = (r: number, c: number): boolean => {
    const regs = [[0, 0], [0, n - 7], [n - 7, 0]];
    for (const [fr, fc] of regs) {
      if (r >= fr && r < fr + 7 && c >= fc && c < fc + 7) {
        const lr = r - fr;
        const lc = c - fc;
        if (lr === 0 || lr === 6 || lc === 0 || lc === 6) return true;
        if (lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4) return true;
        return false;
      }
    }
    return false;
  };
  const cells: boolean[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const inFinder = r < 8 && c < 8 || r < 8 && c >= n - 8 || r >= n - 8 && c < 8;
      cells.push(inFinder ? finder(r, c) : rnd(r * n + c));
    }
  }
  const u = 100 / n;
  return (
    <svg viewBox="0 0 100 100" width={tamanho} height={tamanho} style={{ background: '#fff' }} aria-label="QR PIX">
      {cells.map((on, i) =>
        on ? <rect key={i} x={(i % n) * u} y={Math.floor(i / n) * u} width={u + 0.2} height={u + 0.2} fill="#000" /> : null,
      )}
    </svg>
  );
}

/* --------------------------------- campos --------------------------------- */

function Caixa({ rotulo, valor, centro, className = '' }: { rotulo: string; valor: string; centro?: boolean; className?: string }) {
  return (
    <div className={`rounded-lg border-[1.5px] border-[#1F3A6E] bg-white px-2 pb-1.5 pt-0.5 ${className}`}>
      <span className="block text-[9px] font-normal leading-tight text-[#1F3A6E]">{rotulo}</span>
      <span className={`block truncate font-sans text-[15px] font-bold leading-snug text-black ${centro ? 'text-center' : 'text-left'}`}>
        {valor}
      </span>
    </div>
  );
}

function Olho({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function BotaoReparticao({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="btn btn-press btn-soft flex w-full items-center justify-center gap-2 !border-dashed"
    >
      <Olho className="h-4 w-4" />
      Visualizar repartição dos tributos
    </button>
  );
}

/* ---------------------------------- modal ---------------------------------- */

export function DasModal({ aberto, onFechar, dados }: { aberto: boolean; onFechar: () => void; dados: DadosDas | null }) {
  // FIX sobreposição/scroll: trava body + Escape em pilha (igual InsightsModal).
  // Antes o fundo continuava rolando atrás do DAS e Esc não fechava.
  useEffect(() => {
    if (!aberto) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && ehTopoEscapeModal(onKey)) onFechar();
    };
    window.addEventListener('keydown', onKey);
    const desempilhar = empilharEscapeModal(onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      desempilhar();
      document.body.style.overflow = prevOverflow;
    };
  }, [aberto, onFechar]);
  const grupos = useMemo(() => (dados ? gruposArrecadacao(dados) : []), [dados]);
  if (!aberto || !dados) return null;
  if (typeof document === 'undefined') return null;
  const cnpjFmt = dados.cnpj ? fmtCnpj(dados.cnpj) : '—';
  const linhaArrecadacao = grupos.map((g) => `${g.n} ${g.dv}`).join('  ');
  // Portal no `document.body`: garante centralização na viewport mesmo quando
  // a tela do Simples está dentro de `Pagina`/`Entrada` (transform). Mesmo
  // motivo do `Modal` em `kit.tsx`.
  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-2 backdrop-blur-sm sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onFechar();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Documento de Arrecadação do Simples Nacional"
    >
      <div className="max-h-[92vh] w-full max-w-[820px] overflow-y-auto rounded-2xl bg-white text-black shadow-2xl [color-scheme:light]">
        {/* FIX: header sólido (sem backdrop-blur) — blur em sticky dentro de
            scroller força recomposição a cada scroll */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2 print:hidden">
          <span className="text-xs font-bold text-slate-500">Pré-visualização · DAS Simples Nacional</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => window.print()} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold hover:bg-slate-50">
              🖨 Imprimir
            </button>
            <button type="button" onClick={onFechar} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-700">
              Fechar ✕
            </button>
          </div>
        </div>

        <div className="bg-white p-3 font-sans text-black sm:p-6">
          {/* Cabeçalho */}
          <div className="flex items-start justify-between gap-4 pb-3">
            <div className="flex select-none items-center gap-2" aria-label="Simples Nacional">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-[#1B7A2B] via-[#7ED321] to-[#FFD200] text-[28px] font-black leading-none text-white">
                S
              </span>
              <span className="leading-none">
                <span className="block text-[32px] font-bold tracking-normal text-[#1B7A2B]">SIMPLES</span>
                <span className="block text-[14px] font-bold tracking-[0.35em] text-[#8BC34A]">NACIONAL</span>
              </span>
            </div>
            <h2 className="max-w-[320px] text-right text-[20px] font-bold leading-tight text-[#0A2A6B]">
              Documento de Arrecadação do Simples Nacional
            </h2>
          </div>

          {/* Linha 1 */}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Caixa rotulo="CNPJ" valor={cnpjFmt} centro className="sm:w-[190px] sm:shrink-0" />
            <Caixa rotulo="Razão Social" valor={dados.empresa} className="min-w-0 flex-1 uppercase" />
          </div>

          {/* Linha 2 */}
          <div className="mt-2 flex flex-col gap-2 lg:flex-row">
            <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
              <Caixa rotulo="Período de Apuração" valor={dados.periodoApuracao} centro />
              <Caixa rotulo="Data de Vencimento" valor={dados.vencimento} centro />
              <Caixa rotulo="Número do Documento" valor={dados.numeroDocumento} centro />
            </div>
            <div className="flex flex-col lg:w-[190px] lg:shrink-0">
              <span className="mb-0.5 block text-right text-[10px] font-normal text-[#0A2A6B]">Pagar este documento até</span>
              <div className="flex h-[48px] items-center justify-end rounded-md bg-[#7CB342] px-3 font-mono text-[19px] font-bold tabular-nums text-white">{dados.vencimento}</div>
            </div>
          </div>

          {/* Linha 3 */}
          <div className="mt-2 flex flex-col items-stretch gap-2 sm:flex-row">
            <div className="min-h-[64px] min-w-0 flex-1 rounded-lg border-[1.5px] border-[#1F3A6E] bg-white px-2 pb-1.5 pt-0.5">
              <span className="block text-[9px] font-normal leading-tight text-[#1F3A6E]">Observações</span>
              <span className="block text-[11px] font-normal leading-snug text-black">{dados.observacoes || ' '}</span>
            </div>
            <div className="flex flex-col sm:w-[190px] sm:shrink-0">
              <span className="mb-0.5 block text-right text-[10px] font-normal text-[#0A2A6B]">Valor Total do Documento</span>
              <div className="flex h-[48px] items-center justify-end rounded-md bg-[#7CB342] px-3 font-mono text-[19px] font-bold tabular-nums text-white">{val(dados.total)}</div>
            </div>
          </div>

          {/* Composição */}
          <div className="mt-3 flex min-h-[650px] flex-col overflow-hidden rounded-xl border-[1.5px] border-[#1F3A6E]">
            <div className="bg-[#0A2463] py-1 pl-3 text-left text-xs font-bold text-white">Composição do Documento de Arrecadação</div>
            <div className="flex-1 overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse font-mono text-[11px]">
                <thead>
                  <tr className="border-b border-[#0A2A6B] text-left text-[11px] font-bold text-[#0A2A6B]">
                    <th className="w-[60px] px-1.5 py-1 font-bold">Código</th>
                    <th className="px-1.5 py-1 font-bold">Denominação</th>
                    <th className="w-[90px] px-1.5 py-1 text-right font-bold">Principal</th>
                    <th className="w-[90px] px-1.5 py-1 text-right font-bold">Multa</th>
                    <th className="w-[90px] px-1.5 py-1 text-right font-bold">Juros</th>
                    <th className="w-[90px] px-1.5 py-1 text-right font-bold">Total</th>
                  </tr>
                </thead>
                <tbody className="text-black">
                  {dados.itens.map((i) => (
                    <tr key={i.codigo} className="border-b border-[#E5E7EB]">
                      <td className="px-1.5 py-1 text-[12px]">{i.codigo}</td>
                      <td className="px-1.5 py-1 font-sans text-[11px] uppercase leading-tight">
                        {i.denominacao}
                        <span className="block font-mono text-[10px] normal-case leading-tight text-slate-700">{i.detalhe ?? dados.competenciaCurta}</span>
                      </td>
                      <td className="px-1.5 py-1 text-right text-[12px] tabular-nums">{val(i.principal)}</td>
                      <td className="px-1.5 py-1 text-right" />
                      <td className="px-1.5 py-1 text-right" />
                      <td className="px-1.5 py-1 text-right text-[12px] font-bold tabular-nums">{val(i.principal)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-[#0A2A6B] font-bold">
                    <td colSpan={2} className="px-1.5 py-1 font-sans">Totais</td>
                    <td className="px-1.5 py-1 text-right tabular-nums">{val(dados.total)}</td>
                    <td className="px-1.5 py-1 text-right" />
                    <td className="px-1.5 py-1 text-right" />
                    <td className="px-1.5 py-1 text-right tabular-nums">{val(dados.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="mt-auto grid grid-cols-[1fr_auto_1fr] items-center border-t border-[#E5E7EB] px-2 py-1 font-mono text-[10px] text-slate-600">
              <span className="justify-self-start">SENDA (Versão:1.8.0)</span>
              <span className="text-center">Página: 1 / 1</span>
              <span className="justify-self-end">{dados.emitidoEm}</span>
            </div>
          </div>

          {/* Autenticação */}
          <div className="mt-2 flex items-baseline justify-between gap-3 text-black">
            <span className="font-mono text-[11px] font-normal tabular-nums">{linhaArrecadacao}</span>
            <span className="shrink-0 text-[13px] font-normal uppercase">Autenticação mecânica</span>
          </div>

          {/* Canhoto */}
          <div className="mt-3 border-t border-dashed border-gray-400 pt-3 text-black">
            <div className="text-[16px] font-bold text-[#0A2A6B]">Documento de Arrecadação do Simples Nacional</div>
            <div className="mt-2 flex flex-col gap-4 lg:flex-row lg:items-start">
              <div className="min-w-0 flex-1">
                <div className="flex gap-1">
                  {grupos.map((g) => (
                    <div key={g.n} className="border border-black px-1 pt-0.5 text-center">
                      <span className="block font-mono text-[9px] leading-none">{g.n} {g.dv}</span>
                    </div>
                  ))}
                </div>
                <BarrasITF digitos={grupos.map((g) => `${g.n}${g.dv}`).join('')} altura={48} className="mt-0.5 border border-black" />
                <div className="mt-1 grid grid-cols-1 gap-x-6 gap-y-1 text-[12px] sm:grid-cols-2">
                  <span className="flex items-baseline gap-2">
                    <span className="font-normal">CNPJ:</span>
                    <span className="ml-auto font-mono tabular-nums">{cnpjFmt}</span>
                  </span>
                  <span className="flex items-baseline gap-2">
                    <span className="font-normal">Número:</span>
                    <span className="ml-auto font-mono tabular-nums">{dados.numeroDocumento}</span>
                  </span>
                  <span className="flex items-baseline gap-2">
                    <span className="font-normal">Pagar até:</span>
                    <span className="ml-auto font-mono tabular-nums">{dados.vencimento}</span>
                  </span>
                  <span className="flex items-baseline gap-2">
                    <span className="font-normal">Valor:</span>
                    <span className="ml-auto font-mono tabular-nums">{val(dados.total)}</span>
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-center">
                <span className="text-[10px] font-bold">Pague com o PIX</span>
                <QrFake seed={`${dados.numeroDocumento}|${dados.total}`} tamanho={90} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
