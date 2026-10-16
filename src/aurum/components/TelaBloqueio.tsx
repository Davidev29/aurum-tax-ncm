/**
 * Tela de bloqueio — gate `DENY` (item 3 da spec).
 *
 * Bloqueia o app. O financeiro NÃO mora aqui: instalação limpa vê só o login.
 * A aba Faturas aparece apenas com sessão ativa (renovação de quem já paga) —
 * o financeiro completo vive em Configurações → Conta.
 */
import { useState } from 'react';
import { nomeProduto } from '../config';
import { useLicenca } from '../store';
import type { MotivoGate } from '../types';
import { EmblemaLicenca, Login } from '../pages/Login';
import { Faturas } from '../pages/Faturas';

const TEXTO_BLOQUEIO: Record<MotivoGate, { titulo: string; texto: string }> = {
  OK: { titulo: 'Licença verificada', texto: '' },
  GRACE: { titulo: 'Período de graça', texto: '' },
  NO_LICENSE: {
    titulo: 'Ative sua licença',
    texto: 'Este dispositivo ainda não tem licença ativa. Entre com sua conta ou use uma chave para começar — o resto é automático.',
  },
  EXPIRED: {
    titulo: 'Assinatura vencida',
    texto: 'O período de graça terminou. Renove em Faturas ou entre de novo para reativar.',
  },
  OFFLINE_EXPIRED: {
    titulo: 'Hora de reconectar',
    texto: 'Muito tempo sem validar online. Conecte-se e entre de novo — leva segundos.',
  },
  REVOKED: {
    titulo: 'Licença revogada',
    texto: 'Esta licença foi revogada. Fale com o suporte ou ative outra licença.',
  },
  SUSPENDED: {
    titulo: 'Licença suspensa',
    texto: 'Pagamento pendente? Quite em Faturas ou fale com o suporte.',
  },
  TOKEN_MISMATCH: {
    titulo: 'Sessão dessincronizada',
    texto: 'Os dados locais divergem do servidor. Entre novamente para sincronizar.',
  },
};

export function TelaBloqueio() {
  const motivo = useLicenca((s) => s.gate.motivo);
  const email = useLicenca((s) => s.email);
  const sair = useLicenca((s) => s.sair);
  const [aba, setAba] = useState<'entrar' | 'faturas'>('entrar');
  const info = TEXTO_BLOQUEIO[motivo] ?? TEXTO_BLOQUEIO.NO_LICENSE;
  // Sem sessão (instalação limpa), só o login — sem botão de financeiro.
  const mostraFaturas = email !== null;

  return (
    <main className="flex min-h-dvh items-start justify-center overflow-y-auto bg-[var(--surface)] px-4 py-10 sm:items-center">
      <div className="w-full max-w-xl">
        <div className="mb-6 text-center">
          <div className="mb-3 flex justify-center">
            <EmblemaLicenca tamanho="lg" />
          </div>
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
            {nomeProduto()}
          </div>
          <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">{info.titulo}</h1>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-slate-500">{info.texto}</p>
          {email ? (
            <p className="mt-2 text-xs text-slate-400">
              {email} ·{' '}
              <button type="button" onClick={() => void sair()} className="font-semibold underline hover:text-brand-600">
                trocar conta
              </button>
            </p>
          ) : null}
        </div>

        {mostraFaturas ? (
          <div
            role="tablist"
            aria-label="Acesso ou faturas"
            className="mx-auto mb-4 grid max-w-md grid-cols-2 gap-1 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-1"
          >
            {(['entrar', 'faturas'] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={aba === t}
                type="button"
                onClick={() => setAba(t)}
                className={`rounded-xl px-3 py-2 text-xs font-black transition ${
                  aba === t
                    ? 'bg-white text-brand-700 shadow-card dark:bg-slate-900 dark:text-brand-300'
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                }`}
              >
                {t === 'entrar' ? '🔑 Entrar' : '🧾 Faturas'}
              </button>
            ))}
          </div>
        ) : null}

        <div className="mx-auto max-w-md">
          {aba === 'faturas' && mostraFaturas ? <Faturas /> : <Login />}
        </div>

        <p className="mt-5 text-center text-[11px] text-slate-400">
          Seus dados locais estão preservados — nada foi apagado. O app volta sozinho após a reativação.
        </p>
      </div>
    </main>
  );
}
