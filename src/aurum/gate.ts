/**
 * Gate `canRun` — decisão offline-first sobre o estado persistido (item 3).
 *
 * Pura e síncrona (testável sem I/O). O chamador (`store.boot` + `guards`)
 * avalia no boot E antes de cada ação sensível:
 *
 *   now <= lic_exp && now <= off_exp                    → ALLOW
 *   lic_exp < now <= grace_until + 3d (e now <= off_exp) → ALLOW degradado
 *       (banner + bloqueia excluir/exportar/trocar titular)
 *   now > grace_until + 3d                               → DENY EXPIRED
 *   now > off_exp                                        → DENY OFFLINE_EXPIRED
 *   status REVOKED/SUSPENDED ou tv != esperado            → DENY + limpa sessão
 *
 * `off_exp` tem precedência sobre a graça: sem token offline válido não há
 * operação offline, mesmo dentro da janela de graça (fail-closed).
 */
import { GRACA_EXTRA_MS } from './config';
import type { LicencaEstado, ResultadoGate } from './types';

/** Normaliza ISO/string/number para ms epoch (`NaN` se ilegível). */
export function paraMs(valor: string | number | undefined | null): number {
  if (typeof valor === 'number') return valor;
  if (typeof valor !== 'string' || !valor.trim()) return NaN;
  const n = Number(valor);
  if (Number.isFinite(n) && valor.trim() !== '') return n;
  const t = Date.parse(valor);
  return Number.isFinite(t) ? t : NaN;
}

/**
 * Monta o `LicencaEstado` a partir de um `ActivationResult` (tempos ISO→ms).
 * Nunca recebe nem registra a chave integral.
 */
export function estadoDeActivation(r: {
  licenseId: string;
  productId: string;
  expiresAt: string;
  graceUntil: string;
  device_hash: string;
  offlineToken: string;
  off_exp: string | number;
  token_version: number;
  status?: string;
  keyMasked?: string;
}, appInstanceId: string): LicencaEstado {
  return {
    licenseId: r.licenseId,
    productId: r.productId,
    app_instance_id: appInstanceId,
    device_hash: r.device_hash,
    offlineToken: r.offlineToken,
    lic_exp: paraMs(r.expiresAt),
    grace_until: paraMs(r.graceUntil),
    off_exp: paraMs(r.off_exp),
    token_version: Number(r.token_version) || 1,
    ...(r.status ? { status: r.status } : {}),
    ...(r.keyMasked ? { keyMasked: r.keyMasked } : {}),
    updatedAt: Date.now(),
    lastValidateAt: null,
  };
}

/**
 * `canRun` — avalia o estado persistido. `esperadoTv` vem da última
 * validação online (quando o servidor informa rotação de `token_version`).
 */
export function avaliarGate(
  estado: LicencaEstado | null,
  agora: number = Date.now(),
  esperadoTv?: number,
): ResultadoGate {
  if (!estado) {
    return { decisao: 'DENY', motivo: 'NO_LICENSE', bloquearSensiveis: true, limparSessao: false };
  }
  const status = String(estado.status ?? '').toUpperCase();
  if (status === 'REVOKED') {
    return { decisao: 'DENY', motivo: 'REVOKED', bloquearSensiveis: true, limparSessao: true };
  }
  if (status === 'SUSPENDED') {
    return { decisao: 'DENY', motivo: 'SUSPENDED', bloquearSensiveis: true, limparSessao: true };
  }
  if (esperadoTv !== undefined && Number(estado.token_version) !== Number(esperadoTv)) {
    return { decisao: 'DENY', motivo: 'TOKEN_MISMATCH', bloquearSensiveis: true, limparSessao: true };
  }
  if (!Number.isFinite(estado.lic_exp) || !Number.isFinite(estado.grace_until) || !Number.isFinite(estado.off_exp)) {
    return { decisao: 'DENY', motivo: 'NO_LICENSE', bloquearSensiveis: true, limparSessao: false };
  }
  // Token offline vencido trava tudo (fail-closed offline).
  if (agora > estado.off_exp) {
    return { decisao: 'DENY', motivo: 'OFFLINE_EXPIRED', bloquearSensiveis: true, limparSessao: false };
  }
  // Vigente: operação plena.
  if (agora <= estado.lic_exp) {
    return { decisao: 'ALLOW', motivo: 'OK', bloquearSensiveis: false, limparSessao: false };
  }
  // Graça (+3d de tolerância): opera degradado com banner.
  if (agora <= estado.grace_until + GRACA_EXTRA_MS) {
    return { decisao: 'ALLOW', motivo: 'GRACE', bloquearSensiveis: true, limparSessao: false };
  }
  return { decisao: 'DENY', motivo: 'EXPIRED', bloquearSensiveis: true, limparSessao: false };
}

/** Dias restantes até `lic_exp` (negativo = já vencido). */
export function diasParaVencer(estado: LicencaEstado | null, agora: number = Date.now()): number | null {
  if (!estado || !Number.isFinite(estado.lic_exp)) return null;
  return Math.floor((estado.lic_exp - agora) / (24 * 60 * 60 * 1000));
}
