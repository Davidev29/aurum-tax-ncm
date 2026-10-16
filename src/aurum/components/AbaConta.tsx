/**
 * Aba Conta — seção financeira das Configurações (licença + pagamentos).
 *
 * Mora em Configurações → Conta: status da licença, faturas/renovação e
 * sessão da conta. A tela inicial e o topo do app NÃO expõem financeiro —
 * o deep-link (`abrirContaEmConfig`) traz o usuário até aqui.
 */
import { useState } from 'react';
import { nomeProduto } from '../config';
import { diasParaVencer } from '../gate';
import { useLicenca } from '../store';
import { confirmar } from '@/store/dialogo';
import { useUi } from '@/store/ui';
import { Btn } from '@/ui/kit';
import { EmblemaLicenca } from '../pages/Login';
import { Faturas } from '../pages/Faturas';

function fmtData(ms: number | undefined | null): string {
  if (!ms || !Number.isFinite(ms)) return '—';
  try {
    return new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return '—';
  }
}

function Fato({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-950/40">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{rotulo}</div>
      <div className={`mt-0.5 truncate text-xs ${destaque ? 'font-black' : 'font-semibold'}`} title={valor}>
        {valor}
      </div>
    </div>
  );
}

export function AbaContaPagamentos() {
  const estado = useLicenca((s) => s.estado);
  const gate = useLicenca((s) => s.gate);
  const email = useLicenca((s) => s.email);
  const sair = useLicenca((s) => s.sair);
  const toast = useUi((s) => s.toast);
  const [saindo, setSaindo] = useState(false);

  const dias = diasParaVencer(estado);
  const emGraca = gate.motivo === 'GRACE';
  const tomPill = !estado
    ? 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
    : emGraca
      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
      : gate.decisao === 'DENY'
        ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300'
        : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300';
  const rotuloStatus = !estado
    ? 'sem licença'
    : emGraca
      ? 'período de graça'
      : gate.decisao === 'DENY'
        ? 'bloqueada'
        : 'ativa';

  const irParaFaturas = () => {
    try {
      document.getElementById('aurum-faturas')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      /* sem scroll programático: segue */
    }
  };

  const desconectar = () => {
    if (saindo) return;
    setSaindo(true);
    void (async () => {
      try {
        const ok = await confirmar(
          'Desconectar conta?',
          `A conta ${email ?? ''} será desconectada deste PC. A licença ativa continua valendo.`,
          { icone: '👤', confirmar: 'Desconectar' },
        );
        if (!ok) return;
        await sair();
        toast('Conta desconectada.', 'ok', 4500);
      } catch {
        toast('Não foi possível desconectar agora — tente de novo.', 'err', 6000);
      } finally {
        setSaindo(false);
      }
    })();
  };

  return (
    <div className="space-y-4">
      {/* Status da licença */}
      <section>
        <h3 className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-wide text-slate-500">
          Licença
          <span className={`pill ${tomPill}`}>{rotuloStatus}</span>
        </h3>
        <div className="overflow-hidden rounded-2xl border border-[var(--line)]">
          <div className="flex items-center gap-3 bg-gradient-to-br from-brand-800 via-brand-900 to-slate-900 px-4 py-3 text-white">
            <EmblemaLicenca />
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-aurum-300">
                {nomeProduto()}
              </div>
              <div className="truncate font-mono text-sm font-bold">
                {estado?.keyMasked ?? '••••-????'}
              </div>
            </div>
            <div className="ml-auto shrink-0">
              {(emGraca || gate.decisao === 'DENY') && estado ? (
                <Btn tam="sm" variante="primary" onClick={irParaFaturas}>
                  {emGraca ? 'Renovar' : 'Regularizar'}
                </Btn>
              ) : null}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 bg-[var(--surface-2)] p-3 sm:grid-cols-4">
            <Fato rotulo="Válida até" valor={fmtData(estado?.lic_exp)} destaque />
            <Fato rotulo="Graça até" valor={fmtData(estado?.grace_until)} />
            <Fato rotulo="Offline até" valor={fmtData(estado?.off_exp)} />
            <Fato
              rotulo="Situação"
              valor={!estado ? 'sem licença' : dias !== null && dias >= 0 ? `${dias} dia(s) restantes` : 'vencida'}
              destaque
            />
          </div>
        </div>
        {emGraca ? (
          <p className="mt-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            <strong>Período de graça até {fmtData(estado?.grace_until)}.</strong> Excluir, exportar e
            trocar a empresa ativa estão bloqueados — renove abaixo para voltar ao pleno.
          </p>
        ) : null}
      </section>

      {/* Faturas + renovação */}
      <section id="aurum-faturas" className="scroll-mt-4">
        <h3 className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">
          Faturas e renovação
        </h3>
        <Faturas />
      </section>

      {/* Sessão da conta */}
      <section>
        <h3 className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Conta</h3>
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-100 text-sm font-black text-brand-700 dark:bg-brand-950 dark:text-brand-300">
            {(email ?? '?').slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{email ?? 'Sem conta conectada'}</div>
            <div className="text-[11px] text-slate-400">
              {email ? 'Cobranças e licença vinculadas a esta conta.' : 'Entre pela tela de bloqueio para vincular.'}
            </div>
          </div>
          {email ? (
            <Btn tam="sm" carregando={saindo} onClick={desconectar}>
              {saindo ? 'Saindo…' : 'Desconectar'}
            </Btn>
          ) : null}
        </div>
      </section>
    </div>
  );
}
