/**
 * Tela de bloqueio — gate `DENY` (item 3 da spec).
 *
 * Expirado/offline-expirado/sem licença/revogado: bloqueia o app, mas mantém
 * os dois caminhos de saída (critério de pronto):
 *   - aba "Entrar": login por conta ou por chave (reativa);
 *   - aba "Faturas": lista/paga/renova (visível com sessão ativa).
 * `DEVICE_LIMIT` orienta a liberar slot em `/dashboard/sistemas`.
 */
import { useState } from 'react';
import { useLicenca } from '../store';
import type { MotivoGate } from '../types';
import { Login } from '../pages/Login';
import { Faturas } from '../pages/Faturas';

const TEXTO_BLOQUEIO: Record<MotivoGate, { titulo: string; texto: string }> = {
  OK: { titulo: 'Licença verificada', texto: '' },
  GRACE: { titulo: 'Período de graça', texto: '' },
  NO_LICENSE: {
    titulo: 'Ative sua licença',
    texto: 'Este dispositivo ainda não tem licença ativa. Entre com sua conta ou use uma chave AURUM-… para começar.',
  },
  EXPIRED: {
    titulo: 'Assinatura vencida',
    texto: 'O período de graça terminou. Renove na aba Faturas ou reative com sua conta/chave para voltar a usar.',
  },
  OFFLINE_EXPIRED: {
    titulo: 'Token offline vencido',
    texto: 'Muito tempo sem validar online. Conecte-se à internet e reative — a validação leva segundos.',
  },
  REVOKED: {
    titulo: 'Licença revogada',
    texto: 'Esta licença foi revogada. Fale com o suporte ou ative outra licença.',
  },
  SUSPENDED: {
    titulo: 'Licença suspensa',
    texto: 'Esta licença está suspensa (ex.: pagamento pendente). Quite na aba Faturas ou fale com o suporte.',
  },
  TOKEN_MISMATCH: {
    titulo: 'Sessão inválida',
    texto: 'Os dados locais divergem do servidor. Entre novamente para sincronizar.',
  },
};

export function TelaBloqueio() {
  const motivo = useLicenca((s) => s.gate.motivo);
  const email = useLicenca((s) => s.email);
  const sair = useLicenca((s) => s.sair);
  const [aba, setAba] = useState<'entrar' | 'faturas'>('entrar');
  const info = TEXTO_BLOQUEIO[motivo] ?? TEXTO_BLOQUEIO.NO_LICENSE;

  return (
    <main className="flex min-h-dvh items-center justify-center overflow-y-auto bg-[var(--surface)] px-4 py-10">
      <div className="w-full max-w-2xl">
        <div className="mb-5 text-center">
          <div className="text-5xl" aria-hidden="true">🛡</div>
          <h1 className="mt-2 text-2xl font-black tracking-tight">{info.titulo}</h1>
          <p className="mx-auto mt-1 max-w-lg text-sm text-slate-500">{info.texto}</p>
          {email ? (
            <p className="mt-2 text-xs text-slate-400">
              Conta: <strong>{email}</strong>{' '}
              <button type="button" onClick={() => void sair()} className="underline hover:text-brand-600">
                trocar conta
              </button>
            </p>
          ) : null}
        </div>
        <div className="mb-4 flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {(['entrar', 'faturas'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setAba(t)}
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-bold transition ${
                aba === t
                  ? 'bg-white text-brand-700 shadow-card dark:bg-slate-900 dark:text-brand-300'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
              }`}
            >
              {t === 'entrar' ? '🔑 Entrar / Reativar' : '🧾 Faturas'}
            </button>
          ))}
        </div>
        {aba === 'entrar' ? <Login /> : <Faturas />}
        <p className="mt-4 text-center text-[11px] text-slate-400">
          Seus dados locais estão preservados — nada foi apagado. O app volta sozinho após a reativação.
        </p>
      </div>
    </main>
  );
}
