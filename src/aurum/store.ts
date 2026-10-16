/**
 * Store da licença Aurumbit — boot, ativação, revalidação e sessão da conta.
 *
 * Fluxo:
 *   - `boot()`: lê cofre → avalia gate offline-first → se online e devido,
 *     revalida (`POST /v1/licenses/:id/validate`) → agenda o próximo ciclo
 *     (6h; backoff 30min→24h em `5xx`/timeout, NUNCA auto-bloqueia);
 *   - `loginConta()`: conta primeiro (`/api/auth/login` + activate); SÓ em
 *     `ACCOUNT_NO_LICENSE` libera `ativarComChave()` (regex antes do POST);
 *   - `renovar()`: re-activate com a sessão guardada (pós-pagamento);
 *   - `sair()`: limpa sessão (401, revogação, troca de conta).
 *
 * Contrato de chave (modo chave, promo/bonificação):
 *   - `app_instance_id` gerado 1× (main) e reutilizado — reativar na mesma
 *     máquina retorna `deviceCreated:false` sem consumir slot;
 *   - `activate`/`validate` levam o IPv4 local (`ip`) — o backend agrupa por
 *     IP EXATO; sem ele, atrás de NAT todas as máquinas parecem uma só;
 *   - `validate` (`allow`/`degraded`/`reason`): `allow` ou `degraded` libera;
 *     `deny` exibe o motivo amigável (NUNCA "bloqueada" genérico);
 *   - `429 RATE_LIMITED`: aguarda `Retry-After`, sem retry-storm;
 *   - refresh do JWT offline (7 dias) via `offline-token` quando o atual
 *     vence em <48h e o validate não trouxe um novo.
 *
 * A chave integral só existe como argumento transitório de `ativarComChave`
 * — nunca é persistida nem logada (erros usam `••••-WXYZ`).
 */
import { create } from 'zustand';
import { BACKOFF_INICIAL_MS, BACKOFF_TETO_MS, REVALIDAR_MS, produtoPadrao } from './config';
import { ErroAurum, ativarPorChave, ativarPorConta, atualizarTokenOffline, loginConta, validarLicenca } from './api';
import { avaliarGate, estadoDeActivation, motivoDeNegacao, paraMs, textoNegacao } from './gate';
import { obterIpLocal } from './rede';
import { limparEstado, limparSessao, lerEstado, lerSessao, obterAppInstanceId, salvarEstado, salvarSessao } from './storage';
import type { LicencaEstado, ResultadoGate, SessaoConta } from './types';

export interface EstadoLicencaStore {
  booted: boolean;
  carregando: boolean;
  erro: string | null;
  estado: LicencaEstado | null;
  gate: ResultadoGate;
  email: string | null;
  online: boolean;
  ultimaRevalidacao: number | null;
  boot: () => Promise<void>;
  /** Conta primeiro: resolve `productId`/`label` por baixo dos panos. */
  loginConta: (email: string, senha: string) => Promise<{ precisaChave: boolean }>;
  /** Fallback por chave (só após `ACCOUNT_NO_LICENSE`). */
  ativarComChave: (key: string) => Promise<void>;
  renovar: () => Promise<void>;
  revalidar: () => Promise<void>;
  sair: () => Promise<void>;
  /** Apaga a licença local (troca de licença/revogação) — mantém a conta. */
  limparLicenca: () => Promise<void>;
}

const GATE_INICIAL: ResultadoGate = { decisao: 'DENY', motivo: 'NO_LICENSE', bloquearSensiveis: true, limparSessao: false };

let timerRevalidacao: ReturnType<typeof setInterval> | null = null;
let backoffMs = BACKOFF_INICIAL_MS;
/**
 * Nada de retry-storm: após `429` (ou sempre que o servidor pedir espera via
 * `Retry-After`), nenhuma revalidação parte antes deste instante.
 */
let proximaTentativaApos = 0;

/** IPv4 local p/ `activate`/`validate` — `null` sem rede (campo omitido). */
async function ipAtual(): Promise<string | null> {
  try {
    return await obterIpLocal();
  } catch {
    return null;
  }
}

/** Reagenda o ciclo respeitando a espera (pós-`429`/falha), sem tempestade. */
function reagendarApos(esperaMs: number): void {
  try {
    if (timerRevalidacao) clearInterval(timerRevalidacao);
  } catch {
    /* sem timer: ignora */
  }
  try {
    timerRevalidacao = setInterval(() => {
      void useLicenca.getState().revalidar();
    }, Math.max(esperaMs, REVALIDAR_MS));
  } catch {
    /* ambiente sem setInterval: próxima abertura tenta de novo */
  }
}

function proximoOnline(): boolean {
  try {
    return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  } catch {
    return true;
  }
}

function agendarRevalidacao(): void {
  try {
    if (timerRevalidacao) clearInterval(timerRevalidacao);
  } catch {
    /* sem timer: ignora */
  }
  try {
    timerRevalidacao = setInterval(() => {
      void useLicenca.getState().revalidar();
    }, REVALIDAR_MS);
  } catch {
    /* ambiente sem setInterval: boot cobre */
  }
}

export const useLicenca = create<EstadoLicencaStore>((set, get) => ({
  booted: false,
  carregando: false,
  erro: null,
  estado: null,
  gate: GATE_INICIAL,
  email: null,
  online: proximoOnline(),
  ultimaRevalidacao: null,

  boot: async () => {
    if (get().booted) return;
    set({ carregando: true, erro: null });
    try {
      const [estado, sessao] = await Promise.all([lerEstado(), lerSessao()]);
      set({
        estado,
        gate: avaliarGate(estado),
        email: sessao?.email ?? null,
        online: proximoOnline(),
        booted: true,
        carregando: false,
      });
      agendarRevalidacao();
      // Revalidação de boot quando online e devida (nunca trava o boot).
      void get().revalidar().catch(() => undefined);
    } catch (e) {
      set({
        booted: true,
        carregando: false,
        erro: e instanceof Error ? e.message : String(e),
        gate: avaliarGate(get().estado),
      });
    }
  },

  loginConta: async (email, senha) => {
    set({ carregando: true, erro: null });
    try {
      const { token } = await loginConta(email, senha);
      const sessao: SessaoConta = { token, email: email.trim(), obtidoEm: Date.now() };
      await salvarSessao(sessao);
      set({ email: sessao.email });
      const appInstanceId = await obterAppInstanceId();
      const ip = await ipAtual();
      try {
        const ativ = await ativarPorConta({
          token,
          productId: produtoPadrao(),
          appInstanceId,
          label: rotuloDispositivo(),
          ...(ip ? { ip } : {}),
        });
        const estado = estadoDeActivation(ativ, appInstanceId);
        await salvarEstado(estado);
        backoffMs = BACKOFF_INICIAL_MS;
        set({ estado, gate: avaliarGate(estado), carregando: false, ultimaRevalidacao: Date.now() });
        return { precisaChave: false };
      } catch (e) {
        if (e instanceof ErroAurum && e.code === 'ACCOUNT_NO_LICENSE') {
          set({ carregando: false });
          return { precisaChave: true };
        }
        throw e;
      }
    } catch (e) {
      if (e instanceof ErroAurum && e.code === 'AUTH') {
        await limparSessao().catch(() => undefined);
        set({ email: null });
      }
      set({ carregando: false, erro: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  },

  ativarComChave: async (key) => {
    set({ carregando: true, erro: null });
    try {
      const sessao = await lerSessao().catch(() => null);
      const appInstanceId = await obterAppInstanceId();
      const ip = await ipAtual();
      // key integral só neste escopo — nenhum log a registra.
      const ativ = await ativarPorChave({ token: sessao?.token ?? null, key, appInstanceId, label: rotuloDispositivo(), ...(ip ? { ip } : {}) });
      const estado = estadoDeActivation(ativ, appInstanceId);
      await salvarEstado(estado);
      backoffMs = BACKOFF_INICIAL_MS;
      set({ estado, gate: avaliarGate(estado), carregando: false, ultimaRevalidacao: Date.now() });
    } catch (e) {
      set({ carregando: false, erro: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  },

  /** Re-activate com a sessão guardada (pós-pagamento do checkout). */
  renovar: async () => {
    const sessao = await lerSessao();
    if (!sessao) throw new ErroAurum('AUTH', 'Entre novamente para reativar.');
    set({ carregando: true, erro: null });
    try {
      const appInstanceId = await obterAppInstanceId();
      const ip = await ipAtual();
      const produto = get().estado?.productId || produtoPadrao();
      const ativ = await ativarPorConta({ token: sessao.token, productId: produto, appInstanceId, label: rotuloDispositivo(), ...(ip ? { ip } : {}) });
      const estado = estadoDeActivation(ativ, appInstanceId);
      await salvarEstado(estado);
      set({ estado, gate: avaliarGate(estado), carregando: false, ultimaRevalidacao: Date.now() });
    } catch (e) {
      if (e instanceof ErroAurum && e.code === 'AUTH') {
        await get().sair().catch(() => undefined);
      }
      set({ carregando: false, erro: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  },

  /**
   * Revalidação online (boot + 6h). `5xx`/timeout/rede: MANTÉM o estado e
   * reagenda com backoff — nunca auto-bloqueia. `429`: aguarda `Retry-After`
   * (sem retry-storm). `deny` com motivo terminal (revogação, suspensão,
   * bloqueio, dispositivo desconhecido, clone, licença inativa…): aplica o
   * `DENY` específico com texto amigável — nunca "bloqueada" genérico.
   */
  revalidar: async () => {
    const { estado } = get();
    if (!estado) return;
    if (!proximoOnline()) {
      set({ online: false });
      return;
    }
    // Respeita a janela pós-`429` (anti retry-storm) e o ciclo normal.
    if (Date.now() < proximaTentativaApos) return;
    const ultima = get().ultimaRevalidacao ?? estado.lastValidateAt ?? 0;
    if (Date.now() - ultima < REVALIDAR_MS) return;
    try {
      const sessao = await lerSessao().catch(() => null);
      const ip = await ipAtual();
      const r = await validarLicenca(estado.licenseId, estado.device_hash, sessao?.token ?? null, ip ? { ip } : undefined);
      // `allow` pleno ou `degraded` (graça no servidor): libera.
      if (r.allow || r.degraded) {
        const proximo: LicencaEstado = {
          ...estado,
          ...(r.expiresAt ? { lic_exp: paraMs(r.expiresAt) } : {}),
          ...(r.graceUntil ? { grace_until: paraMs(r.graceUntil) } : {}),
          ...(r.off_exp !== undefined ? { off_exp: paraMs(r.off_exp) } : {}),
          ...(typeof r.token_version === 'number' ? { token_version: r.token_version } : {}),
          ...(typeof r.offlineToken === 'string' ? { offlineToken: r.offlineToken } : {}),
          ...(typeof r.status === 'string' ? { status: r.status } : {}),
          updatedAt: Date.now(),
          lastValidateAt: Date.now(),
        };
        // Refresh do JWT offline (7 dias): o validate pode não trazer
        // `offlineToken` — se o atual vence em <48h, busca o novo (best-effort,
        // nunca falha a validação por causa dele).
        if (typeof r.offlineToken !== 'string' && proximo.off_exp - Date.now() < 48 * 60 * 60 * 1000) {
          try {
            const novo = await atualizarTokenOffline(estado.licenseId, estado.device_hash);
            proximo.offlineToken = novo.offlineToken;
            proximo.off_exp = paraMs(novo.off_exp);
            if (typeof novo.token_version === 'number') proximo.token_version = novo.token_version;
          } catch {
            /* mantém o token atual */
          }
        }
        await salvarEstado(proximo);
        backoffMs = BACKOFF_INICIAL_MS;
        set({ estado: proximo, gate: avaliarGate(proximo), online: true, ultimaRevalidacao: Date.now(), erro: null });
        return;
      }
      // deny: classifica pelo motivo do servidor (não é tudo "bloqueada").
      const agora = Date.now();
      const bruto = String(r.reason ?? r.code ?? r.status ?? '');
      const motivoForcado = motivoDeNegacao(bruto);
      const textoServidor = textoNegacao(bruto);
      if (motivoForcado && motivoForcado !== 'EXPIRED') {
        const revogado = motivoForcado === 'REVOKED';
        const suspenso = motivoForcado === 'SUSPENDED';
        const tvDivergente = motivoForcado === 'TOKEN_MISMATCH';
        const statusFinal = revogado ? 'REVOKED' : suspenso ? 'SUSPENDED' : (r.status ?? estado.status);
        const proximo: LicencaEstado = {
          ...estado,
          ...(typeof statusFinal === 'string' ? { status: statusFinal } : {}),
          ...(typeof r.token_version === 'number' ? { token_version: r.token_version } : {}),
          lastValidateAt: agora,
        };
        await salvarEstado(proximo).catch(() => undefined);
        if (revogado || suspenso || tvDivergente) {
          await limparSessao().catch(() => undefined);
          set({
            email: null,
            estado: proximo,
            gate: {
              decisao: 'DENY',
              motivo: revogado ? 'REVOKED' : suspenso ? 'SUSPENDED' : 'TOKEN_MISMATCH',
              bloquearSensiveis: true,
              limparSessao: true,
            },
            online: true,
            ultimaRevalidacao: agora,
            erro: textoServidor,
          });
          return;
        }
        // Bloqueio/dispositivo licenciado (DEVICE_BLOCKED, UNKNOWN_DEVICE,
        // CLONE_SUSPECT, LICENSE_INACTIVE): DENY específico, sessão mantida
        // (o usuário pode reativar com a chave sem novo login).
        set({
          estado: proximo,
          gate: { decisao: 'DENY', motivo: motivoForcado, bloquearSensiveis: true, limparSessao: false },
          online: true,
          ultimaRevalidacao: agora,
          erro: textoServidor,
        });
        return;
      }
      // `EXPIRED` ou motivo desconhecido: o gate local classifica pelo
      // relógio (graça + 3d), com o motivo do servidor em `erro`.
      const proximo: LicencaEstado = {
        ...estado,
        ...(typeof r.status === 'string' ? { status: r.status } : {}),
        ...(typeof r.token_version === 'number' ? { token_version: r.token_version } : {}),
        lastValidateAt: agora,
      };
      await salvarEstado(proximo).catch(() => undefined);
      set({
        estado: proximo,
        gate: avaliarGate(proximo, agora),
        online: true,
        ultimaRevalidacao: agora,
        ...(bruto ? { erro: textoServidor } : {}),
      });
    } catch (e) {
      // `429`: aguarda `Retry-After` (sem retry-storm), mantendo TUDO.
      if (e instanceof ErroAurum && e.code === 'RATE_LIMITED') {
        const esperaMs = typeof e.retryAfterSeg === 'number' && e.retryAfterSeg > 0
          ? Math.min(e.retryAfterSeg * 1000, BACKOFF_TETO_MS)
          : backoffMs;
        proximaTentativaApos = Date.now() + esperaMs;
        backoffMs = Math.min(backoffMs * 2, BACKOFF_TETO_MS);
        reagendarApos(esperaMs);
        set({ online: true });
        return;
      }
      // Rede/5xx: mantém TUDO, só reagenda com backoff.
      set({ online: false });
      backoffMs = Math.min(backoffMs * 2, BACKOFF_TETO_MS);
      reagendarApos(backoffMs);
      void e;
    }
  },

  sair: async () => {
    await limparSessao().catch(() => undefined);
    set({ email: null, erro: null });
  },

  limparLicenca: async () => {
    await limparEstado().catch(() => undefined);
    set({ estado: null, gate: GATE_INICIAL, ultimaRevalidacao: null });
  },
}));

/** Rótulo do dispositivo enviado na ativação (`label`). */
export function rotuloDispositivo(): string {
  try {
    const ua = typeof navigator !== 'undefined' ? navigator.platform || navigator.userAgent : '';
    const curto = String(ua).slice(0, 40).trim();
    return curto ? `Desktop ${curto}` : 'Desktop';
  } catch {
    return 'Desktop';
  }
}
