/**
 * Portão Aurumbit — gate no boot (item 3 da spec).
 *
 * Envolve o app em `App.tsx`: splash enquanto lê o cofre → `DENY` exibe a
 * tela de bloqueio (login + faturas p/ renovar) → `ALLOW`/`GRACE` libera o
 * conteúdo (a graça entra com banner via `BannerLicenca` no `Layout`).
 */
import { useEffect } from 'react';
import { useLicenca } from '../store';
import { TelaBloqueio } from './TelaBloqueio';

function Splash() {
  return (
    <main
      style={{ fontFamily: 'system-ui', padding: 48, maxWidth: 480, margin: '10vh auto', textAlign: 'center' }}
      aria-busy="true"
      aria-label="Verificando licença"
    >
      <div style={{ fontSize: 40 }} aria-hidden="true">🛡</div>
      <h1 style={{ fontSize: 18, margin: '12px 0 6px' }}>Verificando licença…</h1>
      <p style={{ fontSize: 13, opacity: 0.7 }}>Lendo o cofre local (funciona offline até o vencimento).</p>
    </main>
  );
}

export function PortaoAurum({ children }: { children: React.ReactNode }) {
  const booted = useLicenca((s) => s.booted);
  const decisao = useLicenca((s) => s.gate.decisao);

  useEffect(() => {
    void useLicenca.getState().boot();
  }, []);

  if (!booted) return <Splash />;
  if (decisao === 'DENY') return <TelaBloqueio />;
  return <>{children}</>;
}
