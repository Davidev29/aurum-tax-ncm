/**
 * Storage da camada Aurumbit — cofre no Electron, `localStorage` no web.
 *
 * No Electron (`window.aurum.licenca`), tudo passa pelos canais `aurum:*`
 * do main (safeStorage: DPAPI/Keychain/Keystore). No navegador puro cai no
 * `localStorage` — funcional para dev web, SEM garantia de cofre do SO.
 *
 * Invariantes:
 *   - `app_instance_id` é UUIDv4 gerado 1× (main) e reutilizado em todas as
 *     ativações/validações deste dispositivo;
 *   - a chave integral `AURUM-…` NUNCA é persistida nem logada por aqui.
 */
import { bridge } from '@/infrastructure/bridge';
import type { LicencaEstado, SessaoConta } from './types';

const CHAVE_ESTADO = 'aurum:licenca-estado';
const CHAVE_INSTANCIA = 'aurum:instancia-id';
const CHAVE_SESSAO = 'aurum:sessao-conta';

function lerLocal<T>(chave: string): T | null {
  try {
    const bruto = localStorage.getItem(chave);
    if (!bruto) return null;
    return JSON.parse(bruto) as T;
  } catch {
    return null;
  }
}

function gravarLocal(chave: string, valor: unknown): void {
  try {
    if (valor === null || valor === undefined) localStorage.removeItem(chave);
    else localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    /* storage indisponível: segue em memória */
  }
}

/** UUIDv4 1× — do cofre no Electron, gerado localmente só no fallback web. */
export async function obterAppInstanceId(): Promise<string> {
  const ponte = bridge?.licenca;
  if (ponte) {
    const r = await ponte.instanciaId();
    if (r?.id) return r.id;
  }
  let atual: { id?: unknown } | null = null;
  try {
    atual = lerLocal(CHAVE_INSTANCIA);
  } catch {
    atual = null;
  }
  if (atual && typeof atual.id === 'string' && atual.id.length >= 8) return atual.id;
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  gravarLocal(CHAVE_INSTANCIA, { id });
  return id;
}

export async function lerEstado(): Promise<LicencaEstado | null> {
  const ponte = bridge?.licenca;
  if (ponte) {
    try {
      const r = await ponte.ler();
      return r?.estado ?? null;
    } catch {
      return null;
    }
  }
  return lerLocal<LicencaEstado>(CHAVE_ESTADO);
}

export async function salvarEstado(estado: LicencaEstado): Promise<void> {
  const ponte = bridge?.licenca;
  if (ponte) {
    await ponte.salvar(estado);
    return;
  }
  gravarLocal(CHAVE_ESTADO, estado);
}

export async function limparEstado(): Promise<void> {
  const ponte = bridge?.licenca;
  if (ponte) {
    try {
      await ponte.limpar();
    } catch {
      /* best-effort */
    }
    return;
  }
  gravarLocal(CHAVE_ESTADO, null);
}

export async function lerSessao(): Promise<SessaoConta | null> {
  const ponte = bridge?.licenca;
  if (ponte) {
    try {
      const r = await ponte.sessaoLer();
      return r?.sessao ?? null;
    } catch {
      return null;
    }
  }
  return lerLocal<SessaoConta>(CHAVE_SESSAO);
}

export async function salvarSessao(sessao: SessaoConta): Promise<void> {
  const ponte = bridge?.licenca;
  if (ponte) {
    await ponte.sessaoSalvar(sessao);
    return;
  }
  gravarLocal(CHAVE_SESSAO, sessao);
}

export async function limparSessao(): Promise<void> {
  const ponte = bridge?.licenca;
  if (ponte) {
    try {
      await ponte.sessaoLimpar();
    } catch {
      /* best-effort */
    }
    return;
  }
  gravarLocal(CHAVE_SESSAO, null);
}

/** Abre URL HTTPS no navegador (checkout Asaas, painel de slots). */
export async function abrirUrlExterna(url: string): Promise<void> {
  if (bridge?.abrirUrl) {
    await bridge.abrirUrl(url);
    return;
  }
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch {
    /* sem janela: ignora */
  }
}
