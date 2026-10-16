/**
 * Portão Aurumbit — gate no boot (item 3 da spec).
 *
 * Envolve o app em `App.tsx`: splash enquanto lê o cofre → `DENY` exibe a
 * tela de bloqueio (login + faturas p/ renovar) → `ALLOW`/`GRACE` libera o
 * conteúdo (a graça entra com banner via `BannerLicenca` no `Layout`).
 *
 * O splash respeita um tempo mínimo de exibição (marca + fade): sem ele, um
 * boot rápido (leitura local) piscaria a tela e a entrada pareceria brusca.
 */
import { useEffect, useState } from 'react';
import { useLicenca } from '../store';
import { SplashAurum } from './SplashAurum';
import { TelaBloqueio } from './TelaBloqueio';

/** Tempo mínimo do splash — suficiente p/ ler a marca, curto p/ não atrasar. */
const SPLASH_MIN_MS = 750;

export function PortaoAurum({ children }: { children: React.ReactNode }) {
  const booted = useLicenca((s) => s.booted);
  const decisao = useLicenca((s) => s.gate.decisao);
  const [tempoOk, setTempoOk] = useState(false);

  useEffect(() => {
    void useLicenca.getState().boot();
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setTempoOk(true), SPLASH_MIN_MS);
    return () => window.clearTimeout(t);
  }, []);

  if (!booted || !tempoOk) return <SplashAurum />;
  if (decisao === 'DENY') return <TelaBloqueio />;
  return <>{children}</>;
}
