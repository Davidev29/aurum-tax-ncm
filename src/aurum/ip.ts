/**
 * IP local da máquina — campo `ip` de `activate-by-key`/`validate`.
 *
 * O backend agrupa devices por IP EXATO (regra promo): mesmo IP +
 * `app_instance_id` novo = mesmo device (`deviceCreated:false`, sem gastar
 * slot); IP distinto = slot novo. Sem o campo, o backend usa o IP da conexão
 * e, atrás de proxy/NAT, todas as máquinas parecem uma só.
 *
 * Módulo PURO e sem imports (bundlado no main E no renderer): a leitura de
 * `os.networkInterfaces()` acontece no chamador (main) ou chega via IPC.
 * A chave integral e o token NUNCA passam por aqui — só o IP local.
 */

/** Subconjunto de `os.NetworkInterfaceInfo` suficiente p/ a seleção. */
export interface InfoInterfaceRede {
  address?: unknown;
  family?: unknown;
  internal?: unknown;
}

/**
 * Normaliza um endereço para IPv4 pontuado (`::ffff:1.2.3.4` → `1.2.3.4`).
 * `null` para IPv6, loopback, indefinido ou qualquer valor inválido.
 */
export function normalizarIp(ip: unknown): string | null {
  if (typeof ip !== 'string') return null;
  let s = ip.trim();
  if (!s) return null;
  if (s.startsWith('::ffff:')) s = s.slice('::ffff:'.length);
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return null;
  const partes = s.split('.').map(Number);
  if (!partes.every((p) => Number.isInteger(p) && p >= 0 && p <= 255)) return null;
  // Loopback (`127.x`) e indefinido (`0.0.0.0`) não identificam a máquina.
  if (partes[0] === 127 || partes.every((p) => p === 0)) return null;
  return s;
}

/**
 * Primeiro IPv4 não interno das interfaces (ordem do SO).
 * `null` quando só há loopback/interno/IPv6 — o chamador OMITE o campo `ip`
 * (o backend cai no IP da conexão) em vez de enviar lixo.
 */
export function selecionarIpLocal(
  interfaces: Record<string, Array<InfoInterfaceRede | null | undefined> | null | undefined> | null | undefined,
): string | null {
  if (!interfaces || typeof interfaces !== 'object') return null;
  for (const nome of Object.keys(interfaces)) {
    const lista = interfaces[nome];
    if (!Array.isArray(lista)) continue;
    for (const nic of lista) {
      if (!nic || typeof nic !== 'object') continue;
      if (nic.internal === true) continue;
      const fam = typeof nic.family === 'string' ? nic.family.toLowerCase() : nic.family;
      if (fam !== 'ipv4' && fam !== 4) continue;
      const ip = normalizarIp(nic.address);
      if (ip) return ip;
    }
  }
  return null;
}
