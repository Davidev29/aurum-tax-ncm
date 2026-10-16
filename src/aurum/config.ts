/**
 * Config da camada Aurumbit — endpoints, produto e janelas de revalidação.
 *
 * Dois prefixos, possivelmente dois hosts (conta × licenças):
 *   - `/api/me/*` e `/api/auth/*` → `apiBase`;
 *   - `/v1/*`                     → `licBase`.
 * Por padrão ambos apontam para `VITE_AURUM_API_BASE`. A tela de login
 * permite sobrescrever (persistido em `aurum:api-base` / `aurum:lic-base`)
 * sem rebuild — útil para staging/on-premise.
 */

function semBarraFinal(v: string): string {
  return v.endsWith('/') ? v.slice(0, -1) : v
}

function baseEnv(nome: string, padrao: string): string {
  try {
    const v = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[nome]
    if (typeof v === 'string' && v.trim()) return semBarraFinal(v.trim())
  } catch {
    /* fora do Vite (testes node): cai no padrão */
  }
  return padrao
}

export const API_BASE_PADRAO = 'https://api.aurumbitlabs.com.br';

export function lerApiBase(): string {
  try {
    const salvo = localStorage.getItem('aurum:api-base');
    if (salvo && salvo.trim()) return semBarraFinal(salvo.trim());
  } catch {
    /* sem storage: segue o env */
  }
  return baseEnv('VITE_AURUM_API_BASE', API_BASE_PADRAO);
}

export function lerLicBase(): string {
  try {
    const salvo = localStorage.getItem('aurum:lic-base');
    if (salvo && salvo.trim()) return semBarraFinal(salvo.trim());
  } catch {
    /* sem storage: segue o env */
  }
  return baseEnv('VITE_AURUM_LIC_BASE', lerApiBase());
}

export function salvarBases(apiBase: string, licBase?: string): void {
  try {
    localStorage.setItem('aurum:api-base', semBarraFinal(apiBase.trim()));
    if (licBase !== undefined) {
      if (licBase.trim()) localStorage.setItem('aurum:lic-base', semBarraFinal(licBase.trim()));
      else localStorage.removeItem('aurum:lic-base');
    }
  } catch {
    /* storage indisponível: vale só na sessão */
  }
}

/** URL do painel onde o usuário libera slots (`409 DEVICE_LIMIT`). */
export function urlPainelSistemas(): string {
  try {
    const v = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.['VITE_AURUM_DASHBOARD_URL'];
    if (typeof v === 'string' && v.trim()) return `${semBarraFinal(v.trim())}/dashboard/sistemas`;
  } catch {
    /* ignora */
  }
  return `${lerApiBase()}/dashboard/sistemas`;
}

/** Produto deste app (enviado como `productId` na ativação por conta). */
export function produtoPadrao(): string {
  try {
    const v = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.['VITE_AURUM_PRODUCT_ID'];
    if (typeof v === 'string' && v.trim()) return v.trim();
  } catch {
    /* ignora */
  }
  return 'aurum-tax-ncm';
}

/** Canal declarado no feature gating (`access/check`). */
export const CANAL_ACESSO = 'desktop';

/** Revalidação online: boot + a cada 6h (janela 4–24h da spec). */
export const REVALIDAR_MS = 6 * 60 * 60 * 1000;
/** Backoff em falha de rede/5xx: 30min → … → teto 24h. Nunca auto-bloqueia. */
export const BACKOFF_INICIAL_MS = 30 * 60 * 1000;
export const BACKOFF_TETO_MS = 24 * 60 * 60 * 1000;
/** Tolerância extra após `grace_until` no modo degradado (spec: graça + 3d). */
export const GRACA_EXTRA_MS = 3 * 24 * 60 * 60 * 1000;
/** Timeout HTTP das chamadas Aurumbit. */
export const HTTP_TIMEOUT_MS = 15_000;
/** Teto do `check-batch` (spec: ≤ 50 códigos por chamada). */
export const LOTE_ACESSO_MAX = 50;
/** Poll do checkout: 5s, até 10min. PENDING nunca libera. */
export const CHECKOUT_POLL_MS = 5_000;
export const CHECKOUT_TETO_MS = 10 * 60 * 1000;
