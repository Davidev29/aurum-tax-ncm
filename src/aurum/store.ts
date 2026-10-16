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
 * A chave integral só existe como argumento transitório de `ativarComChave`
 * — nunca é persistida nem logada (erros usam `••••-WXYZ`).
 */
import { create } from 'zustand';
import { BACKOFF_INICIAL_MS, BACKOFF_TETO_MS, REVALIDAR_MS, produtoPadrao } from './config';
import { ErroAurum, ativarPorChave, ativarPorConta, loginConta, validarLicenca } from './api';
import { avaliarGate, estadoDeActivation, paraMs } from './gate';
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
      try {
        const ativ = await ativarPorConta({
          token,
          productId: produtoPadrao(),
          appInstanceId,
          label: rotuloDispositivo(),
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
      // key integral só neste escopo — nenhum log a registra.
      const ativ = await ativarPorChave({ token: sessao?.token ?? null, key, appInstanceId, label: rotuloDispositivo() });
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
      const produto = get().estado?.productId || produtoPadrao();
      const ativ = await ativarPorConta({ token: sessao.token, productId: produto, appInstanceId, label: rotuloDispositivo() });
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
   * reagenda com backoff — nunca auto-bloqueia. `deny` com REVOKED/
   * SUSPENDED/TV: atualiza o estado e limpa a sessão.
   */
  revalidar: async () => {
    const { estado } = get();
    if (!estado) return;
    if (!proximoOnline()) {
      set({ online: false });
      return;
    }
    const ultima = get().ultimaRevalidacao ?? estado.lastValidateAt ?? 0;
    if (Date.now() - ultima < REVALIDAR_MS) return;
    try {
      const sessao = await lerSessao().catch(() => null);
      const r = await validarLicenca(estado.licenseId, estado.device_hash, sessao?.token ?? null);
      if (r.allow) {
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
        await salvarEstado(proximo);
        backoffMs = BACKOFF_INICIAL_MS;
        set({ estado: proximo, gate: avaliarGate(proximo), online: true, ultimaRevalidacao: Date.now(), erro: null });
        return;
      }
      // deny: classifica; revogação/suspensão/tv limpam a sessão.
      const agora = Date.now();
      const code = String(r.code ?? r.status ?? '').toUpperCase();
      const revogado = code.includes('REVOK');
      const suspenso = code.includes('SUSP');
      const tvDivergente = code.includes('TOKEN') || code.includes('TV_') || code.includes('VERSION');
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
        });
        return;
      }
      // Demais denies (ex.: EXPIRED): o gate local classifica pelo relógio.
      set({ estado: proximo, gate: avaliarGate(proximo, agora), online: true, ultimaRevalidacao: agora });
    } catch (e) {
      // Rede/5xx: mantém TUDO, só reagenda com backoff.
      set({ online: false });
      backoffMs = Math.min(backoffMs * 2, BACKOFF_TETO_MS);
      try {
        if (timerRevalidacao) clearInterval(timerRevalidacao);
        timerRevalidacao = setInterval(() => {
          void useLicenca.getState().revalidar();
        }, Math.max(backoffMs, REVALIDAR_MS));
      } catch {
        /* sem timer: próxima abertura tenta de novo */
      }
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
