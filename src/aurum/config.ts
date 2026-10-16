/**
 * Config da camada Aurumbit — TUDO resolvido em build-time (inferido do produto).
 *
 * O usuário nunca preenche nada disto em tela (só e-mail/senha ou a chave).
 *
 * Contrato real (bases incluem o prefixo):
 *   - `VITE_AURUM_BFF_URL`   (ex.: `https://seu-portal/api/me`) → BFF do portal
 *     para CONTA: `POST /licenses/activate {productId}`, `/invoices`,
 *     `/checkout` e `/auth/*` (login, forgot);
 *   - `VITE_AURUM_API_URL`   (ex.: `https://api.aurumbit.com/v1`) → Nest DIRETO
 *     para `/v1/*`: activate-by-key, validate, access/check, products/plans.
 *
 * Identidade (case-sensitive, confere com o `code` do admin em /produtos):
 *   - `VITE_AURUM_PRODUCT_ID`   = `VITE_AURUM_PRODUCT_CODE` = code exato
 *     (ex.: `AURUM_TAX_NCM`); NAME é só display; PLAN_ID vazio = pede plano.
 */

function semBarraFinal(v: string): string {
  return v.endsWith('/') ? v.slice(0, -1) : v
}

function env(nome: string): string {
  try {
    const v = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[nome]
    if (typeof v === 'string' && v.trim()) return v.trim()
  } catch {
    /* fora do Vite (testes node): cai no padrão */
  }
  return ''
}

/** BFF do portal p/ conta — base JÁ inclui `/api/me`. */
export function baseBff(): string {
  return semBarraFinal(env('VITE_AURUM_BFF_URL') || 'https://seu-portal/api/me');
}

/** Nest direto p/ `/v1/*` — base JÁ inclui `/v1`. */
export function baseApi(): string {
  return semBarraFinal(env('VITE_AURUM_API_URL') || 'https://api.aurumbit.com/v1');
}

/** Recurso de conta: `${BFF}/licenses/activate`, `/invoices`, `/checkout`. */
export function urlConta(caminho: string): string {
  return `${baseBff()}${caminho}`;
}

/**
 * Raiz do portal (BFF sem o `/api/me` final): `${raiz}/auth/*` e o dashboard.
 * Se a base não terminar em `/me`, usa a base como está.
 */
function raizPortal(): string {
  const bff = baseBff();
  const semMe = bff.endsWith('/me') ? bff.slice(0, -3) : bff;
  return semBarraFinal(semMe);
}

/** Auth do portal: `${raiz}/auth/login`, `/auth/password/forgot`. */
export function urlAuth(caminho: string): string {
  return `${raizPortal()}${caminho}`;
}

/** Recurso Nest: `${API}/licenses/...`, `/access/...`, `/products/...`. */
export function urlNest(caminho: string): string {
  return `${baseApi()}${caminho}`;
}

/** URL do painel onde o usuário libera slots (`409 DEVICE_LIMIT`). */
export function urlPainelSistemas(): string {
  const dash = env('VITE_AURUM_DASHBOARD_URL');
  if (dash) return `${semBarraFinal(dash)}/dashboard/sistemas`;
  return `${raizPortal()}/dashboard/sistemas`;
}

/**
 * Produto deste app — code EXATO do admin (`/produtos`), case-sensitive
 * (ex.: `AURUM_TAX_NCM`). Filtra `l.productId === body.productId`.
 */
export function produtoPadrao(): string {
  return env('VITE_AURUM_PRODUCT_ID') || 'AURUM_TAX_NCM';
}

/** Nome de exibição do produto (cabeçalho das telas de licença). */
export function nomeProduto(): string {
  return env('VITE_AURUM_PRODUCT_NAME') || 'Aurum Tax NCM';
}

/** Código do produto no checkout (nunca digitado — vem do build). */
export function codigoProduto(): string {
  return env('VITE_AURUM_PRODUCT_CODE') || produtoPadrao();
}

/** Plano padrão da renovação (`''` = o usuário informa na tela de faturas). */
export function planoPadrao(): string {
  return env('VITE_AURUM_PLAN_ID') || '';
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
