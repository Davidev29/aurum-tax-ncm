/**
 * IP local no renderer — via IPC `aurum:ip-local` (o main lê
 * `os.networkInterfaces()` e devolve o primeiro IPv4 não interno).
 *
 * Cache em memória por sessão: o IP é resolvido 1× e reutilizado em todas
 * as ativações/validações (o backend agrupa por IP EXATO — flapping de IP
 * entre chamadas gastaria slots à toa). Mudança real de rede exige
 * reiniciar o app, o que é aceitável para um campo de agrupamento.
 *
 * Sem Electron/bridge (web) ou sem rede: `null` — o chamador OMITE o campo
 * `ip` e o backend usa o IP da conexão. Nunca lança, nunca loga nada.
 */
import { bridge, type LicencaPonte } from '@/infrastructure/bridge';

let cacheIp: string | null | undefined;

function ponteLicenca(): LicencaPonte | null {
  try {
    const dinamica = (globalThis as { window?: { aurum?: { licenca?: LicencaPonte } } }).window?.aurum?.licenca;
    if (dinamica) return dinamica;
  } catch {
    /* sem window: cai no bridge */
  }
  try {
    return bridge?.licenca ?? null;
  } catch {
    return null;
  }
}

/** IP local (IPv4) da máquina ou `null` quando indisponível. */
export async function obterIpLocal(): Promise<string | null> {
  if (cacheIp !== undefined) return cacheIp;
  try {
    const r = await ponteLicenca()?.ipLocal?.();
    cacheIp = r && typeof r.ip === 'string' && r.ip ? r.ip : null;
  } catch {
    cacheIp = null;
  }
  return cacheIp;
}

/** Descarta o cache em memória (só p/ testes). */
export function limparCacheIp(): void {
  cacheIp = undefined;
}
