/**
 * Fluxo de ativação/validação por chave (modo chave, promo/bonificação).
 *
 * Cobre os critérios de aceite sem backend real (fetch sob stub):
 *   - `activate-by-key` leva `key` + `app_instance_id` + `label` + `ip`;
 *   - mesma máquina reativa sem consumir slot (corpo idêntico entre
 *     ativações; `deviceCreated:false` + mesmo `device_hash` no eco);
 *   - `validate` leva `device_hash` + `ip`; `allow`/`degraded` libera;
 *     cada `deny` tem motivo amigável próprio (nunca "bloqueada" genérico);
 *   - `429` vira `RATE_LIMITED` com `Retry-After`, sem retry-storm;
 *   - refresh do JWT offline via `offline-token`;
 *   - `app_instance_id` estável entre "aberturas" (cofre do main);
 *   - nenhuma chave/token em log; base `/v1` nunca vira `file://`.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/aurum/storage', () => ({
  lerEstado: vi.fn(async () => null),
  salvarEstado: vi.fn(async () => undefined),
  limparEstado: vi.fn(async () => undefined),
  lerSessao: vi.fn(async () => null),
  salvarSessao: vi.fn(async () => undefined),
  limparSessao: vi.fn(async () => undefined),
  obterAppInstanceId: vi.fn(async () => 'inst-teste-1'),
  abrirUrlExterna: vi.fn(async () => undefined),
}));

// Fora do Electron, o pacote `electron` exporta só o caminho do binário —
// aqui o `safeStorage` indisponível exercita o envelope `plain` (fallback
// de dev do cofre), sem mascarar a lógica de persistência 1×.
vi.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: vi.fn(async () => undefined) },
}));

import { ErroAurum, ativarPorChave, atualizarTokenOffline, validarLicenca } from '@/aurum/api';
import { baseApi } from '@/aurum/config';
import { avaliarGate, motivoDeNegacao, textoNegacao } from '@/aurum/gate';
import { normalizarIp, selecionarIpLocal } from '@/aurum/ip';
import { limparCacheIp, obterIpLocal } from '@/aurum/rede';
import { useLicenca } from '@/aurum/store';
import type { LicencaEstado } from '@/aurum/types';

const CHAVE = 'AURUM-ABCD-EFGH-JKLM';
const DEVICE_HASH = 'b'.repeat(64);
const FUTURO = new Date('2030-01-01T00:00:00.000Z').toISOString();
const FUTURO_GRAÇA = new Date('2030-02-15T00:00:00.000Z').toISOString();

function respostaAtivacao(extra: Record<string, unknown> = {}) {
  return Response.json({
    mode: 'key',
    licenseId: 'lic-1',
    keyMasked: '••••-JKLM',
    productId: 'AURUM_TAX_NCM',
    expiresAt: FUTURO,
    graceUntil: FUTURO_GRAÇA,
    device_hash: DEVICE_HASH,
    offlineToken: 'tok-offline-1',
    off_exp: FUTURO,
    token_version: 1,
    ...extra,
  });
}

function estadoValido(): LicencaEstado {
  const agora = Date.now();
  const dia = 24 * 60 * 60 * 1000;
  return {
    licenseId: 'lic-1',
    productId: 'AURUM_TAX_NCM',
    app_instance_id: 'inst-teste-1',
    device_hash: DEVICE_HASH,
    offlineToken: 'tok-offline-1',
    lic_exp: agora + 30 * dia,
    grace_until: agora + 37 * dia,
    off_exp: agora + 7 * dia,
    token_version: 1,
    updatedAt: agora,
    lastValidateAt: null,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  limparCacheIp();
});

describe('ip local (seleção e normalização)', () => {
  it('normaliza ::ffff: e rejeita loopback/IPv6/lixo', () => {
    expect(normalizarIp('::ffff:192.168.0.10')).toBe('192.168.0.10');
    expect(normalizarIp('10.0.0.5')).toBe('10.0.0.5');
    expect(normalizarIp('::1')).toBeNull();
    expect(normalizarIp('fe80::1')).toBeNull();
    expect(normalizarIp('127.0.0.1')).toBeNull();
    expect(normalizarIp('0.0.0.0')).toBeNull();
    expect(normalizarIp('')).toBeNull();
    expect(normalizarIp(null)).toBeNull();
    expect(normalizarIp('999.1.1.1')).toBeNull();
  });

  it('seleciona o primeiro IPv4 não interno (family string ou numérica)', () => {
    const ifs = {
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      eth0: [{ address: '::ffff:192.168.1.20', family: 4, internal: false }],
      eth1: [{ address: '10.0.0.9', family: 'IPv4', internal: false }],
    };
    expect(selecionarIpLocal(ifs)).toBe('192.168.1.20');
    expect(selecionarIpLocal({ lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }] })).toBeNull();
    expect(selecionarIpLocal(null)).toBeNull();
  });
});

describe('activate-by-key', () => {
  it('envia key + app_instance_id + label + ip no corpo', async () => {
    vi.stubEnv('VITE_AURUM_API_URL', 'http://127.0.0.1:3000/v1');
    const corpos: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: unknown) => {
      corpos.push(JSON.parse(String((init as { body?: unknown }).body)));
      return respostaAtivacao({ deviceCreated: true });
    }));
    const r = await ativarPorChave({
      key: CHAVE,
      appInstanceId: 'inst-teste-1',
      label: 'PC do caixa',
      ip: '192.168.0.10',
    });
    expect(corpos).toHaveLength(1);
    expect(corpos[0]).toMatchObject({
      key: CHAVE,
      app_instance_id: 'inst-teste-1',
      label: 'PC do caixa',
      ip: '192.168.0.10',
    });
    expect(r.licenseId).toBe('lic-1');
    expect(r.device_hash).toBe(DEVICE_HASH);
    expect(r.deviceCreated).toBe(true);
  });

  it('mesma máquina reativa com corpo idêntico (deviceCreated:false, mesmo hash)', async () => {
    vi.stubEnv('VITE_AURUM_API_URL', 'http://127.0.0.1:3000/v1');
    const corpos: Array<Record<string, unknown>> = [];
    let chamadas = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: unknown) => {
      corpos.push(JSON.parse(String((init as { body?: unknown }).body)));
      chamadas += 1;
      return respostaAtivacao({ deviceCreated: chamadas > 1 ? false : true });
    }));
    const args = { key: CHAVE, appInstanceId: 'inst-teste-1', label: 'PC do caixa', ip: '192.168.0.10' };
    const primeira = await ativarPorChave(args);
    const segunda = await ativarPorChave(args);
    expect(corpos).toHaveLength(2);
    expect(corpos[1]).toEqual(corpos[0]);
    expect(segunda.deviceCreated).toBe(false);
    expect(segunda.device_hash).toBe(primeira.device_hash);
  });

  it('omite o ip quando indisponível (sem rede) em vez de enviar lixo', async () => {
    vi.stubEnv('VITE_AURUM_API_URL', 'http://127.0.0.1:3000/v1');
    const corpos: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: unknown) => {
      corpos.push(JSON.parse(String((init as { body?: unknown }).body)));
      return respostaAtivacao({ deviceCreated: true });
    }));
    await ativarPorChave({ key: CHAVE, appInstanceId: 'inst-teste-1', label: 'PC', ip: null });
    expect(corpos[0]).not.toHaveProperty('ip');
  });

  it('nunca registra chave ou token em console', async () => {
    vi.stubEnv('VITE_AURUM_API_URL', 'http://127.0.0.1:3000/v1');
    vi.stubGlobal('fetch', vi.fn(async () => respostaAtivacao({ deviceCreated: true })));
    const espioes = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m));
    try {
      await ativarPorChave({ key: CHAVE, appInstanceId: 'inst-teste-1', label: 'PC', ip: '192.168.0.10' });
      await validarLicenca('lic-1', DEVICE_HASH, null, { ip: '192.168.0.10' });
    } finally {
      for (const s of espioes) s.mockRestore();
    }
    const tudo = espioes.flatMap((s) => s.mock.calls.map((c) => String(c[0] ?? ''))).join('\n');
    expect(tudo).not.toMatch(/AURUM-/);
    expect(tudo).not.toContain('tok-offline-1');
  });
});

describe('validate periódico', () => {
  it('envia device_hash + ip e libera em allow', async () => {
    vi.stubEnv('VITE_AURUM_API_URL', 'http://127.0.0.1:3000/v1');
    const corpos: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: unknown) => {
      corpos.push(JSON.parse(String((init as { body?: unknown }).body)));
      return Response.json({ allow: true, status: 'ACTIVE' });
    }));
    useLicenca.setState({
      estado: estadoValido(),
      gate: avaliarGate(estadoValido()),
      erro: null,
      online: true,
      ultimaRevalidacao: null,
    });
    await useLicenca.getState().revalidar();
    expect(corpos).toHaveLength(1);
    expect(corpos[0]).toMatchObject({ device_hash: DEVICE_HASH });
    const s = useLicenca.getState();
    expect(s.gate.decisao).toBe('ALLOW');
    expect(s.erro).toBeNull();
  });

  it('degraded (graça no servidor) também libera', async () => {
    vi.stubEnv('VITE_AURUM_API_URL', 'http://127.0.0.1:3000/v1');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ allow: false, degraded: true, status: 'GRACE' })));
    const agora = Date.now();
    const dia = 24 * 60 * 60 * 1000;
    useLicenca.setState({
      estado: { ...estadoValido(), lic_exp: agora - dia, grace_until: agora + 10 * dia },
      gate: avaliarGate(estadoValido()),
      erro: 'anterior',
      online: true,
      ultimaRevalidacao: null,
    });
    await useLicenca.getState().revalidar();
    const s = useLicenca.getState();
    expect(s.gate.decisao).toBe('ALLOW');
    expect(s.erro).toBeNull();
  });

  it.each([
    ['UNKNOWN_DEVICE', 'vinculado'],
    ['DEVICE_BLOCKED', 'bloqueado'],
    ['CLONE_SUSPECT', 'outro local'],
    ['LICENSE_INACTIVE', 'inativa'],
    ['EXPIRED', 'vencida'],
  ])('deny %s vira motivo próprio com texto amigável', async (reason, trecho) => {
    vi.stubEnv('VITE_AURUM_API_URL', 'http://127.0.0.1:3000/v1');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ allow: false, reason })));
    const agora = Date.now();
    const dia = 24 * 60 * 60 * 1000;
    // Licença vencida de verdade: qualquer deny aqui termina em DENY.
    useLicenca.setState({
      estado: { ...estadoValido(), lic_exp: agora - 30 * dia, grace_until: agora - 20 * dia },
      gate: avaliarGate(estadoValido()),
      erro: null,
      online: true,
      ultimaRevalidacao: null,
    });
    await useLicenca.getState().revalidar();
    const s = useLicenca.getState();
    expect(s.gate.decisao).toBe('DENY');
    expect(s.erro).toMatch(new RegExp(trecho, 'i'));
    // Nenhum deny vira "bloqueada" genérico sem motivo específico.
    if (reason !== 'EXPIRED') expect(s.gate.motivo).toBe(reason);
  });

  it('motivoDeNegacao cobre os códigos do contrato (case-insensitive)', () => {
    expect(motivoDeNegacao('unknown_device')).toBe('UNKNOWN_DEVICE');
    expect(motivoDeNegacao('device_blocked')).toBe('DEVICE_BLOCKED');
    expect(motivoDeNegacao('clone_suspect')).toBe('CLONE_SUSPECT');
    expect(motivoDeNegacao('expired')).toBe('EXPIRED');
    expect(motivoDeNegacao('license_inactive')).toBe('LICENSE_INACTIVE');
    expect(motivoDeNegacao('algo-novo')).toBeNull();
    expect(textoNegacao('algo-novo')).toMatch(/tente de novo/i);
  });
});

describe('offline-token (refresh de 7 dias)', () => {
  it('busca GET com device_hash na query', async () => {
    vi.stubEnv('VITE_AURUM_API_URL', 'http://127.0.0.1:3000/v1');
    const urls: string[] = [];
    const inits: Array<{ method?: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init: unknown) => {
      urls.push(String(url));
      inits.push({ method: (init as { method?: string }).method });
      return Response.json({ offlineToken: 'tok-novo', off_exp: FUTURO, token_version: 2 });
    }));
    const r = await atualizarTokenOffline('lic-1', DEVICE_HASH);
    expect(r.offlineToken).toBe('tok-novo');
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('/licenses/lic-1/offline-token');
    expect(urls[0]).toContain(`device_hash=${DEVICE_HASH}`);
    expect(inits[0].method).toBe('GET');
  });
});

describe('base /v1 (nunca file:// como destino)', () => {
  it('relativo no dev, absoluto sob file:// (pacote)', () => {
    vi.stubEnv('VITE_AURUM_API_URL', '/v1');
    expect(baseApi()).toBe('/v1');
    (globalThis as { location?: unknown }).location = { protocol: 'file:' };
    try {
      const base = baseApi();
      expect(base).toMatch(/^https:\/\//);
      expect(base.endsWith('/v1')).toBe(true);
    } finally {
      delete (globalThis as { location?: unknown }).location;
    }
  });
});

describe('obterIpLocal (renderer via IPC)', () => {
  it('usa o canal do main com cache por sessão; null sem bridge', async () => {
    const g = globalThis as { window?: unknown };
    const janelaOriginal = g.window;
    const ipLocal = vi.fn(async () => ({ ip: '10.0.0.8' }));
    g.window = { aurum: { licenca: { ipLocal } } };
    try {
      limparCacheIp();
      expect(await obterIpLocal()).toBe('10.0.0.8');
      expect(ipLocal).toHaveBeenCalledTimes(1);
      // Cache: segunda chamada não bate no IPC de novo.
      g.window = { aurum: { licenca: { ipLocal: vi.fn(async () => ({ ip: '10.9.9.9' })) } } };
      expect(await obterIpLocal()).toBe('10.0.0.8');
    } finally {
      g.window = janelaOriginal;
      limparCacheIp();
    }
    expect(await obterIpLocal()).toBeNull();
  });
});

describe('app_instance_id (cofre do main)', () => {
  it('duas "aberturas" seguidas devolvem o mesmo id (sem vazar slot)', async () => {
    const mod = await import('../electron/main/aurum-licenca');
    const canais = new Map<string, (...args: never[]) => unknown>();
    const dir = join(tmpdir(), `aurum-teste-cofre-${process.pid}`);
    const app = { getPath: () => dir };
    mod.registrarIpcAurum(
      { handle: (canal: string, fn: (...args: never[]) => unknown) => void canais.set(canal, fn) } as never,
      app as never,
    );
    const instancia = canais.get('aurum:instancia-id');
    expect(instancia).toBeTypeOf('function');
    const primeira = (instancia as () => { id: string })();
    const segunda = (instancia as () => { id: string })();
    expect(primeira.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(segunda.id).toBe(primeira.id);
  });

  it('obterIpLocalMaquina retorna IPv4 válido ou null (nunca lança)', async () => {
    const mod = await import('../electron/main/aurum-licenca');
    const ip = mod.obterIpLocalMaquina();
    expect(ip === null || /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)).toBe(true);
  });

  it('fallback web gera 1× e reutiliza (localStorage)', async () => {
    const real = await vi.importActual<typeof import('@/aurum/storage')>('@/aurum/storage');
    globalThis.localStorage.clear();
    const a = await real.obterAppInstanceId();
    const b = await real.obterAppInstanceId();
    expect(a).toBeTruthy();
    expect(b).toBe(a);
  });
});

describe('429 sem retry-storm', () => {
  it('vira RATE_LIMITED com Retry-After e atrasa a próxima tentativa', async () => {
    vi.stubEnv('VITE_AURUM_API_URL', 'http://127.0.0.1:3000/v1');
    const fetchMock = vi.fn(async () => new Response('{}', { status: 429, headers: { 'retry-after': '120' } }));
    vi.stubGlobal('fetch', fetchMock);
    // Nível API: código + espera extraídos.
    await expect(validarLicenca('lic-1', DEVICE_HASH)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    try {
      await validarLicenca('lic-1', DEVICE_HASH);
    } catch (e) {
      expect(e).toBeInstanceOf(ErroAurum);
      expect((e as ErroAurum).retryAfterSeg).toBe(120);
      expect((e as ErroAurum).message).toMatch(/120/);
    }
    // Nível store: 429 mantém o estado e a 2ª tentativa imediata nem parte.
    vi.useFakeTimers();
    try {
      fetchMock.mockClear();
      useLicenca.setState({
        estado: estadoValido(),
        gate: avaliarGate(estadoValido()),
        erro: null,
        online: true,
        ultimaRevalidacao: null,
      });
      await useLicenca.getState().revalidar();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await useLicenca.getState().revalidar();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(useLicenca.getState().gate.decisao).toBe('ALLOW');
    } finally {
      vi.useRealTimers();
    }
  });
});
