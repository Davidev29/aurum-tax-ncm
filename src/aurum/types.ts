/**
 * Tipos da camada Aurumbit — contratos com o backend de licenças/conta.
 *
 * Convenções:
 *   - tempos em **ms epoch** no renderer (`licExp`, `graceUntil`, `offExp`);
 *     o backend trafega ISO (`expiresAt`, `graceUntil`, `off_exp`);
 *   - a chave integral `AURUM-…` NUNCA aparece nestes tipos — só `keyMasked`
 *     (`••••-WXYZ`) para exibição.
 */

/** Resposta de `POST /api/me/licenses/activate` e `POST /v1/licenses/activate-by-key`. */
export interface ActivationResult {
  mode: 'account' | 'key';
  licenseId: string;
  keyMasked: string;
  productId: string;
  expiresAt: string;
  graceUntil: string;
  device_hash: string;
  offlineToken: string;
  off_exp: string | number;
  token_version: number;
  status?: string;
}

/** Estado persistido no cofre após ativação (item 1 da spec). */
export interface LicencaEstado {
  licenseId: string;
  productId: string;
  app_instance_id: string;
  device_hash: string;
  offlineToken: string;
  lic_exp: number;
  grace_until: number;
  off_exp: number;
  token_version: number;
  status?: string;
  keyMasked?: string;
  updatedAt: number;
  lastValidateAt?: number | null;
}

/** Decisão do gate (`canRun` — item 3 da spec). */
export type DecisaoGate = 'ALLOW' | 'ALLOW_DEGRADED' | 'DENY';

export type MotivoGate =
  | 'OK'
  | 'GRACE'
  | 'NO_LICENSE'
  | 'EXPIRED'
  | 'OFFLINE_EXPIRED'
  | 'REVOKED'
  | 'SUSPENDED'
  | 'TOKEN_MISMATCH';

export interface ResultadoGate {
  decisao: DecisaoGate;
  motivo: MotivoGate;
  /** `true` em `ALLOW_DEGRADED`: banner + bloqueia excluir/exportar/trocar titular. */
  bloquearSensiveis: boolean;
  /** `true` em REVOKED/SUSPENDED/TOKEN_MISMATCH: o chamador limpa a sessão. */
  limparSessao: boolean;
}

/** Ações sensíveis bloqueadas no modo degradado. */
export type AcaoSensivel = 'excluir' | 'exportar' | 'trocar-titular';

/** Fatura de `GET /api/me/invoices`. */
export interface Fatura {
  id: string;
  numero?: string;
  descricao?: string;
  valor?: number;
  moeda?: string;
  vencimento?: string;
  status: string;
  pdfUrl?: string;
  boletoUrl?: string;
  linhaDigitavel?: string;
}

/** Checkout Asaas (`POST /api/me/checkout` → poll `GET /api/me/checkout?id=`). */
export interface CheckoutCriado {
  checkoutId: string;
  status: string;
  asaasUrl?: string;
}

export type StatusCheckout = 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED' | string;

export interface CheckoutStatus {
  checkoutId: string;
  status: StatusCheckout;
  paidAt?: string | null;
}

/** Sessão da conta (Bearer de `/api/me/*`), guardada no cofre do main. */
export interface SessaoConta {
  token: string;
  email: string;
  obtidoEm: number;
}
