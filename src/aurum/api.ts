/**
 * Cliente HTTP Aurumbit — ativação, validação, feature gating, faturas e checkout.
 *
 * Regras da spec implementadas aqui:
 *   - `401` → `AUTH` (re-login, sessão limpa pelo chamador);
 *   - `404 ACCOUNT_NO_LICENSE` → único caso que libera o fallback por chave;
 *   - `409 DEVICE_LIMIT` → orientar `/dashboard/sistemas`;
 *   - `502`/timeout/rede → `REDE` (banner offline, NUNCA auto-bloqueia);
 *   - `access/check(-batch)` com `5xx`/timeout mantém estado (erro `REDE`
 *     para o chamador decidir pelo cache);
 *   - a chave integral só sai no corpo de `activate-by-key` e nunca é logada.
 */
import { CANAL_ACESSO, CHECKOUT_POLL_MS, CHECKOUT_TETO_MS, HTTP_TIMEOUT_MS, LOTE_ACESSO_MAX, urlAuth, urlConta, urlNest } from './config';
import type { ActivationResult, CheckoutCriado, CheckoutStatus, Fatura, Plano } from './types';

/** Chave `AURUM-XXXX-XXXX-XXXX` (sem I/O/O/0/1 para evitar confusão). */
export const REGEX_CHAVE = /^AURUM-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

/** Exibição segura: `••••-WXYZ` (últimos 4). Nunca exponha a chave integral. */
export function mascararChave(keyMaskedOuChave: string): string {
  const limpa = String(keyMaskedOuChave ?? '').trim();
  if (!limpa) return '••••-????';
  if (limpa.includes('•')) return limpa;
  return `••••-${limpa.slice(-4)}`;
}

export type CodigoErroAurum =
  | 'AUTH'
  | 'ACCOUNT_NO_LICENSE'
  | 'DEVICE_LIMIT'
  | 'DEVICE_CONFLICT'
  | 'KEY_INVALID'
  | 'LICENSE_INACTIVE'
  | 'DEVICE_BLOCKED'
  | 'REDE'
  | 'SERVIDOR'
  | 'RESPOSTA_INVALIDA';

export class ErroAurum extends Error {
  code: CodigoErroAurum;
  status?: number;
  constructor(code: CodigoErroAurum, message: string, status?: number) {
    super(message);
    this.name = 'ErroAurum';
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

interface OpcaoChamada {
  token?: string | null;
  corpo?: unknown;
  metodo?: 'GET' | 'POST';
}

/** `fetch` com timeout + envelope de erro padronizado (nunca auto-bloqueia). */
async function chamar<T>(url: string, op: OpcaoChamada = {}): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(url, {
      method: op.metodo ?? (op.corpo !== undefined ? 'POST' : 'GET'),
      headers: {
        'Content-Type': 'application/json',
        ...(op.token ? { Authorization: `Bearer ${op.token}` } : {}),
      },
      ...(op.corpo !== undefined ? { body: JSON.stringify(op.corpo) } : {}),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch {
    throw new ErroAurum('REDE', 'Sem conexão com o servidor de licenças. O app segue no modo offline permitido.');
  }
  let corpo: unknown = null;
  try {
    corpo = await resposta.json();
  } catch {
    corpo = null;
  }
  if (resposta.ok) return corpo as T;
  const code = (corpo as { code?: unknown } | null)?.code;
  const msg = (corpo as { message?: unknown; erro?: unknown } | null)?.message
    ?? (corpo as { message?: unknown; erro?: unknown } | null)?.erro;
  const texto = typeof msg === 'string' && msg.trim() ? msg.trim() : `Servidor respondeu HTTP ${resposta.status}.`;
  // Mapeamento fiel da spec (códigos de corpo têm precedência sobre o status).
  if (resposta.status === 401) throw new ErroAurum('AUTH', 'Sessão expirada — entre novamente.', 401);
  if (url.includes('activate-by-key')) {
    if (resposta.status === 404) throw new ErroAurum('KEY_INVALID', 'Chave inválida — confira os 3 blocos.', 404);
  } else if (url.includes('/licenses/activate')) {
    if (resposta.status === 404 || code === 'ACCOUNT_NO_LICENSE') {
      throw new ErroAurum('ACCOUNT_NO_LICENSE', 'Esta conta não tem licença ativa — use uma chave ou assine.', 404);
    }
  }
  if (resposta.status === 403) {
    if (code === 'DEVICE_BLOCKED') throw new ErroAurum('DEVICE_BLOCKED', 'Este dispositivo foi bloqueado — fale com o suporte.', 403);
    throw new ErroAurum('LICENSE_INACTIVE', 'Licença inativa — regularize a assinatura.', 403);
  }
  if (resposta.status === 409) {
    if (code === 'DEVICE_CONFLICT') throw new ErroAurum('DEVICE_CONFLICT', 'Esta chave já está em outro dispositivo.', 409);
    throw new ErroAurum('DEVICE_LIMIT', 'Limite de dispositivos — libere um slot no painel.', 409);
  }
  if (resposta.status === 502 || resposta.status === 503 || resposta.status === 504) {
    throw new ErroAurum('REDE', 'Servidor indisponível — seguindo no modo offline permitido.', resposta.status);
  }
  if (resposta.status >= 500) throw new ErroAurum('SERVIDOR', texto, resposta.status);
  throw new ErroAurum('SERVIDOR', texto, resposta.status);
}

/** Valida a forma mínima do `ActivationResult` (fail-closed em resposta ruim). */
function validarActivation(v: unknown): ActivationResult {
  const r = (v ?? {}) as Record<string, unknown>;
  const texto = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
  if ((r.mode !== 'account' && r.mode !== 'key') || !texto(r.licenseId) || !texto(r.productId)) {
    throw new ErroAurum('RESPOSTA_INVALIDA', 'Ativação retornou dados incompletos.');
  }
  if (!texto(r.expiresAt) || !texto(r.graceUntil) || !texto(r.device_hash) || !texto(r.offlineToken)) {
    throw new ErroAurum('RESPOSTA_INVALIDA', 'Ativação retornou dados incompletos.');
  }
  const offExp = r.off_exp as unknown;
  if (typeof offExp !== 'string' && typeof offExp !== 'number') {
    throw new ErroAurum('RESPOSTA_INVALIDA', 'Ativação retornou dados incompletos.');
  }
  if (!/^[0-9a-f]{64}$/i.test(String(r.device_hash))) {
    throw new ErroAurum('RESPOSTA_INVALIDA', 'Ativação retornou device_hash inválido.');
  }
  return {
    mode: r.mode,
    licenseId: String(r.licenseId),
    keyMasked: typeof r.keyMasked === 'string' ? r.keyMasked : '••••-????',
    productId: String(r.productId),
    expiresAt: String(r.expiresAt),
    graceUntil: String(r.graceUntil),
    device_hash: String(r.device_hash),
    offlineToken: String(r.offlineToken),
    off_exp: offExp as string | number,
    token_version: Number(r.token_version ?? 1) || 1,
    ...(typeof r.status === 'string' ? { status: r.status } : {}),
  };
}

/** Login da conta → Bearer de `/me/*` (BFF do portal). */
export async function loginConta(email: string, senha: string): Promise<{ token: string }> {
  const r = await chamar<{ token?: unknown }>(urlAuth('/auth/login'), {
    corpo: { email: email.trim(), password: senha },
  });
  if (!r || typeof r.token !== 'string' || !r.token) {
    throw new ErroAurum('RESPOSTA_INVALIDA', 'Login retornou resposta incompleta.');
  }
  return { token: r.token };
}

/**
 * Redefinição de senha — envia o link para o e-mail
 * (`POST /api/auth/password/forgot`). Não revela se a conta existe
 * (o servidor responde 200 nos dois casos).
 */
export async function solicitarRedefinicaoSenha(email: string): Promise<void> {
  const limpo = email.trim();
  if (!/.+@.+\..+/.test(limpo)) throw new ErroAurum('RESPOSTA_INVALIDA', 'Informe um e-mail válido.');
  await chamar<unknown>(urlAuth('/auth/password/forgot'), {
    corpo: { email: limpo },
  });
}

/** Ativação por conta (tentar SEMPRE primeiro — filtra `productId` exato). */
export async function ativarPorConta(args: {
  token: string;
  productId?: string;
  appInstanceId: string;
  label: string;
}): Promise<ActivationResult> {
  const r = await chamar<unknown>(urlConta('/licenses/activate'), {
    token: args.token,
    corpo: {
      ...(args.productId ? { productId: args.productId } : {}),
      app_instance_id: args.appInstanceId,
      label: args.label,
    },
  });
  return validarActivation(r);
}

/** Fallback por chave — SÓ após `ACCOUNT_NO_LICENSE` (regex validada antes). */
export async function ativarPorChave(args: {
  token?: string | null;
  key: string;
  appInstanceId: string;
  label: string;
}): Promise<ActivationResult> {
  const chave = args.key.trim().toUpperCase();
  if (!REGEX_CHAVE.test(chave)) {
    throw new ErroAurum('KEY_INVALID', 'Formato inválido — use AURUM-XXXX-XXXX-XXXX.');
  }
  // A chave integral sai SÓ neste corpo; nenhum log a registra (ver store).
  const r = await chamar<unknown>(urlNest('/licenses/activate-by-key'), {
    ...(args.token ? { token: args.token } : {}),
    corpo: { key: chave, app_instance_id: args.appInstanceId, label: args.label },
  });
  return validarActivation(r);
}

export interface ResultadoValidacao {
  allow: boolean;
  code?: string;
  token_version?: number;
  status?: string;
  expiresAt?: string;
  graceUntil?: string;
  off_exp?: string | number;
  offlineToken?: string;
  device_hash?: string;
}

/**
 * Revalidação online (item 4): `200` sempre, corpo `allow/deny`.
 * `5xx`/timeout → `ErroAurum('REDE'|'SERVIDOR')` e o chamador MANTÉM o estado.
 */
export async function validarLicenca(licenseId: string, deviceHash: string, token?: string | null): Promise<ResultadoValidacao> {
  const r = await chamar<Record<string, unknown>>(urlNest(`/licenses/${encodeURIComponent(licenseId)}/validate`), {
    ...(token ? { token } : {}),
    corpo: { device_hash: deviceHash },
  });
  return {
    allow: r.allow === true,
    ...(typeof r.code === 'string' ? { code: r.code } : {}),
    ...(typeof r.token_version === 'number' ? { token_version: r.token_version } : {}),
    ...(typeof r.status === 'string' ? { status: r.status } : {}),
    ...(typeof r.expiresAt === 'string' ? { expiresAt: r.expiresAt } : {}),
    ...(typeof r.graceUntil === 'string' ? { graceUntil: r.graceUntil } : {}),
    ...((typeof r.off_exp === 'string' || typeof r.off_exp === 'number') ? { off_exp: r.off_exp as string | number } : {}),
    ...(typeof r.offlineToken === 'string' ? { offlineToken: r.offlineToken } : {}),
    ...(typeof r.device_hash === 'string' ? { device_hash: r.device_hash } : {}),
  };
}

export interface CheckAcesso {
  allow: boolean;
  origem: 'rede' | 'cache-rede';
}

/** Feature gating unitário (`GET /v1/access/check?...`). */
export async function checkAcesso(args: {
  ownerId: string;
  productId: string;
  featureCode: string;
  token?: string | null;
}): Promise<CheckAcesso> {
  const q = new URLSearchParams({
    ownerType: 'CUSTOMER',
    ownerId: args.ownerId,
    productId: args.productId,
    featureCode: args.featureCode,
    channel: CANAL_ACESSO,
  });
  const r = await chamar<{ allow?: unknown }>(urlNest(`/access/check?${q.toString()}`), {
    ...(args.token ? { token: args.token } : {}),
  });
  return { allow: r.allow !== false, origem: 'rede' };
}

/** Feature gating em lote (`POST /v1/access/check-batch`, teto 50). */
export async function checkAcessoLote(args: {
  ownerId: string;
  productId: string;
  featureCodes: string[];
  token?: string | null;
}): Promise<Record<string, boolean>> {
  const codigos = [...new Set(args.featureCodes)].slice(0, LOTE_ACESSO_MAX);
  if (!codigos.length) return {};
  const r = await chamar<{ results?: Record<string, unknown> }>(urlNest('/access/check-batch'), {
    ...(args.token ? { token: args.token } : {}),
    corpo: {
      ownerType: 'CUSTOMER',
      ownerId: args.ownerId,
      productId: args.productId,
      channel: CANAL_ACESSO,
      features: codigos,
    },
  });
  const out: Record<string, boolean> = {};
  for (const c of codigos) out[c] = (r.results?.[c] as boolean) !== false;
  return out;
}

/** Faturas da conta (`GET {BFF}/invoices` — lista/baixa). */
export async function listarFaturas(token: string): Promise<Fatura[]> {
  const r = await chamar<{ invoices?: unknown; items?: unknown }>(urlConta('/invoices'), { token });
  const lista = Array.isArray(r.invoices) ? r.invoices : Array.isArray(r.items) ? r.items : [];
  return (lista as Array<Record<string, unknown>>).map((f) => ({
    id: String(f.id ?? ''),
    ...(typeof f.numero === 'string' || typeof f.number === 'string' ? { numero: String(f.numero ?? f.number) } : {}),
    ...(typeof f.descricao === 'string' || typeof f.description === 'string' ? { descricao: String(f.descricao ?? f.description) } : {}),
    ...(typeof f.valor === 'number' || typeof f.amount === 'number' ? { valor: Number(f.valor ?? f.amount) } : {}),
    ...(typeof f.moeda === 'string' || typeof f.currency === 'string' ? { moeda: String(f.moeda ?? f.currency) } : {}),
    ...(typeof f.vencimento === 'string' || typeof f.dueDate === 'string' ? { vencimento: String(f.vencimento ?? f.dueDate) } : {}),
    status: String(f.status ?? 'UNKNOWN'),
    ...(typeof f.pdfUrl === 'string' ? { pdfUrl: f.pdfUrl } : {}),
    ...(typeof f.boletoUrl === 'string' ? { boletoUrl: f.boletoUrl } : {}),
    ...(typeof f.linhaDigitavel === 'string' ? { linhaDigitavel: f.linhaDigitavel } : {}),
  })).filter((f) => f.id);
}

export interface ItemCheckout {
  productCode: string;
  planId: string;
}

/**
 * Planos do produto (`GET {Nest}/products/:productCode/plans`).
 * O checkout exige `p.id === planId && ACTIVE` — por isso só ACTIVE volta.
 */
export async function listarPlanos(productCode: string, token?: string | null): Promise<Plano[]> {
  const r = await chamar<unknown>(urlNest(`/products/${encodeURIComponent(productCode)}/plans`), {
    ...(token ? { token } : {}),
  });
  const bruta: unknown[] = Array.isArray(r)
    ? r
    : Array.isArray((r as { plans?: unknown }).plans)
      ? (r as { plans: unknown[] }).plans
      : Array.isArray((r as { items?: unknown }).items)
        ? (r as { items: unknown[] }).items
        : [];
  return (bruta as Array<Record<string, unknown>>)
    .filter((p) => {
      if (typeof p.status === 'string') return p.status.toUpperCase() === 'ACTIVE';
      if (typeof p.active === 'boolean') return p.active;
      if (typeof p.isActive === 'boolean') return p.isActive;
      return true;
    })
    .map((p) => ({
      id: String(p.id ?? ''),
      ...(typeof p.name === 'string' || typeof p.nome === 'string' ? { nome: String(p.nome ?? p.name) } : {}),
      ...(typeof p.price === 'number' || typeof p.preco === 'number' ? { preco: Number(p.preco ?? p.price) } : {}),
      ...(typeof p.currency === 'string' || typeof p.moeda === 'string' ? { moeda: String(p.moeda ?? p.currency) } : {}),
      ...(typeof p.interval === 'string' || typeof p.intervalo === 'string' ? { intervalo: String(p.intervalo ?? p.interval) } : {}),
    }))
    .filter((p) => p.id);
}

/** Abre checkout (`POST {BFF}/checkout` → `{ asaasUrl }`). */
export async function criarCheckout(token: string, items: ItemCheckout[], orderId?: string): Promise<CheckoutCriado> {
  const r = await chamar<{ checkoutId?: unknown; id?: unknown; status?: unknown; asaasUrl?: unknown; paymentUrl?: unknown }>(
    urlConta('/checkout'),
    { token, corpo: { items, ...(orderId ? { orderId } : {}) } },
  );
  const checkoutId = typeof r.checkoutId === 'string' ? r.checkoutId : typeof r.id === 'string' ? r.id : '';
  if (!checkoutId) throw new ErroAurum('RESPOSTA_INVALIDA', 'Checkout retornou resposta incompleta.');
  const asaasUrl = typeof r.asaasUrl === 'string' ? r.asaasUrl : typeof r.paymentUrl === 'string' ? r.paymentUrl : undefined;
  return { checkoutId, status: typeof r.status === 'string' ? r.status : 'PENDING', ...(asaasUrl ? { asaasUrl } : {}) };
}

/** Estado do checkout (`GET {BFF}/checkout?id=`). */
export async function obterCheckout(token: string, checkoutId: string): Promise<CheckoutStatus> {
  const r = await chamar<{ checkoutId?: unknown; id?: unknown; status?: unknown; paidAt?: unknown }>(
    urlConta(`/checkout?id=${encodeURIComponent(checkoutId)}`), { token },
  );
  return {
    checkoutId: typeof r.checkoutId === 'string' ? r.checkoutId : checkoutId,
    status: typeof r.status === 'string' ? r.status : 'PENDING',
    ...(typeof r.paidAt === 'string' ? { paidAt: r.paidAt } : {}),
  };
}

/**
 * Aguarda `PAID` com poll de 5s (teto 10min). `PENDING` nunca libera —
 * resolve `true` SÓ em `PAID`; `EXPIRED`/`CANCELLED`/teto → `false`.
 */
export async function aguardarPagamento(token: string, checkoutId: string): Promise<boolean> {
  const inicio = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, CHECKOUT_POLL_MS));
    if (Date.now() - inicio > CHECKOUT_TETO_MS) return false;
    let st: CheckoutStatus;
    try {
      st = await obterCheckout(token, checkoutId);
    } catch (e) {
      if (e instanceof ErroAurum && (e.code === 'REDE' || e.code === 'SERVIDOR')) continue;
      throw e;
    }
    if (st.status === 'PAID') return true;
    if (st.status === 'EXPIRED' || st.status === 'CANCELLED') return false;
    // PENDING/outros: segue o poll sem liberar.
  }
}
