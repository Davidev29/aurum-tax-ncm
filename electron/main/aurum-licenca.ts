/**
 * Cofre da licença Aurumbit no processo main — Aurum Tax NCM.
 *
 * O que guarda (NUNCA a chave `AURUM-…` — ela só trafega no POST de ativação):
 *   - `identidade.dat`: `{ app_instance_id: UUIDv4 }` gerado 1×;
 *   - `licenca.dat`: `{ licenseId, productId, app_instance_id, device_hash,
 *      offlineToken, lic_exp, grace_until, off_exp, token_version, ... }`;
 *   - `sessao.dat`: `{ token, email }` da conta (Bearer de `/api/me/*`).
 *
 * Criptografia: `safeStorage` (DPAPI no Windows, Keychain no macOS, Keystore/
 * Secret Service no Linux). Sem `safeStorage` disponível (ex.: Linux sem
 * Secret Service), grava em base64 simples com `enc:'plain'` e avisa no log —
 * continua funcional em dev, mas sem a garantia de cofre do SO.
 *
 * Compilado pelo esbuild junto ao `main.ts` (`electron` externo).
 */
import type { App, IpcMain, IpcMainInvokeEvent } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { safeStorage, shell } from 'electron'

/** Formato do estado persistido após a ativação (espelha `src/aurum/types.ts`). */
export interface EstadoLicencaPersistido {
  licenseId: string
  productId: string
  app_instance_id: string
  device_hash: string
  offlineToken: string
  lic_exp: number
  grace_until: number
  off_exp: number
  token_version: number
  status?: string
  keyMasked?: string
  updatedAt?: number
  lastValidateAt?: number | null
}

export interface SessaoContaPersistida {
  token: string
  email: string
  obtidoEm: number
}

function diretorioCofre(app: App): string {
  return path.join(app.getPath('userData'), 'aurum')
}

function garantirDiretorio(app: App): string {
  const dir = diretorioCofre(app)
  mkdirSync(dir, { recursive: true })
  return dir
}

function caminhoArquivo(app: App, nome: string): string {
  return path.join(garantirDiretorio(app), nome)
}

/** Lê um envelope `{ enc, payload }` do disco; `null` se ausente/ilegível. */
function lerEnvelope<T>(caminho: string): T | null {
  try {
    if (!existsSync(caminho)) return null
    const bruto = readFileSync(caminho, 'utf8')
    const env = JSON.parse(bruto) as { enc?: unknown; payload?: unknown }
    if (typeof env.payload !== 'string') return null
    const buf = Buffer.from(env.payload, 'base64')
    const aberto =
      env.enc === 'safeStorage' && safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(buf)
        : buf.toString('utf8')
    return JSON.parse(aberto) as T
  } catch {
    return null
  }
}

/** Grava o envelope criptografado (ou `plain` com aviso quando sem cofre do SO). */
function gravarEnvelope(caminho: string, valor: unknown): void {
  const texto = JSON.stringify(valor)
  if (safeStorage.isEncryptionAvailable()) {
    const cifrado = safeStorage.encryptString(texto)
    writeFileSync(caminho, JSON.stringify({ enc: 'safeStorage', payload: cifrado.toString('base64') }), 'utf8')
  } else {
    console.warn('[aurum] safeStorage indisponível — gravando sem criptografia do SO (apenas dev).')
    writeFileSync(caminho, JSON.stringify({ enc: 'plain', payload: Buffer.from(texto, 'utf8').toString('base64') }), 'utf8')
  }
}

/** Valida a forma do estado antes de persistir (inclui a trava anti-chave). */
function validarEstado(v: unknown): v is EstadoLicencaPersistido {
  if (!v || typeof v !== 'object') return false
  const e = v as Record<string, unknown>
  const textoOk = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 4096
  const numOk = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
  if (!textoOk(e.licenseId) || !textoOk(e.productId) || !textoOk(e.app_instance_id)) return false
  if (typeof e.device_hash !== 'string' || !/^[0-9a-f]{64}$/i.test(e.device_hash)) return false
  if (!textoOk(e.offlineToken)) return false
  if (!numOk(e.lic_exp) || !numOk(e.grace_until) || !numOk(e.off_exp) || !numOk(e.token_version)) return false
  // TRAVA: a chave integral `AURUM-XXXX-XXXX-XXXX` NUNCA é persistida.
  try {
    if (/AURUM-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/.test(JSON.stringify(v))) return false
  } catch {
    return false
  }
  return true
}

function validarSessao(v: unknown): v is SessaoContaPersistida {
  if (!v || typeof v !== 'object') return false
  const s = v as Record<string, unknown>
  return (
    typeof s.token === 'string' && s.token.length > 0 && s.token.length <= 8192 &&
    typeof s.email === 'string' && s.email.length <= 320 &&
    typeof s.obtidoEm === 'number' && Number.isFinite(s.obtidoEm)
  )
}

/** Registra os canais `aurum:*`. Chamado por `registrarIpc()` no `main.ts`. */
export function registrarIpcAurum(ipcMain: IpcMain, app: App): void {
  /** `aurum:instancia-id` — UUIDv4 gerado 1× e persistido no cofre. */
  ipcMain.handle('aurum:instancia-id', (): { id: string } => {
    const caminho = caminhoArquivo(app, 'identidade.dat')
    const atual = lerEnvelope<{ app_instance_id?: unknown }>(caminho)
    if (atual && typeof atual.app_instance_id === 'string' && atual.app_instance_id.length >= 8) {
      return { id: atual.app_instance_id }
    }
    const id = randomUUID()
    gravarEnvelope(caminho, { app_instance_id: id, criadoEm: Date.now() })
    return { id }
  })

  /** `aurum:licenca:ler` — estado persistido ou `null` (instalação limpa). */
  ipcMain.handle('aurum:licenca:ler', (): { estado: EstadoLicencaPersistido | null } => {
    const estado = lerEnvelope<EstadoLicencaPersistido>(caminhoArquivo(app, 'licenca.dat'))
    return { estado: estado && validarEstado(estado) ? estado : null }
  })

  /** `aurum:licenca:salvar` — persiste o estado pós-ativação/validação. */
  ipcMain.handle(
    'aurum:licenca:salvar',
    (_evento: IpcMainInvokeEvent, estado: unknown): { ok: boolean } => {
      if (!validarEstado(estado)) throw new Error('aurum:estado-invalido')
      gravarEnvelope(caminhoArquivo(app, 'licenca.dat'), estado)
      return { ok: true }
    },
  )

  /** `aurum:licenca:limpar` — apaga o estado (revogação/troca de licença). */
  ipcMain.handle('aurum:licenca:limpar', (): { ok: boolean } => {
    try {
      gravarEnvelope(caminhoArquivo(app, 'licenca.dat'), null)
    } catch {
      /* best-effort */
    }
    return { ok: true }
  })

  /** `aurum:sessao:ler` — token da conta ou `null` (deslogado). */
  ipcMain.handle('aurum:sessao:ler', (): { sessao: SessaoContaPersistida | null } => {
    const sessao = lerEnvelope<SessaoContaPersistida>(caminhoArquivo(app, 'sessao.dat'))
    return { sessao: sessao && validarSessao(sessao) ? sessao : null }
  })

  /** `aurum:sessao:salvar` — guarda o Bearer da conta no cofre. */
  ipcMain.handle(
    'aurum:sessao:salvar',
    (_evento: IpcMainInvokeEvent, sessao: unknown): { ok: boolean } => {
      if (!validarSessao(sessao)) throw new Error('aurum:sessao-invalida')
      gravarEnvelope(caminhoArquivo(app, 'sessao.dat'), sessao)
      return { ok: true }
    },
  )

  /** `aurum:sessao:limpar` — logout (401, revogação, troca de conta). */
  ipcMain.handle('aurum:sessao:limpar', (): { ok: boolean } => {
    try {
      gravarEnvelope(caminhoArquivo(app, 'sessao.dat'), null)
    } catch {
      /* best-effort */
    }
    return { ok: true }
  })

  /**
   * `aurum:abrir-url` — abre checkout Asaas / `/dashboard/sistemas` no
   * navegador. Só HTTPS com host válido; o renderer nunca ganha shell livre.
   */
  ipcMain.handle('aurum:abrir-url', async (_evento: IpcMainInvokeEvent, url: unknown): Promise<{ ok: boolean }> => {
    if (typeof url !== 'string') throw new Error('aurum:url-invalida')
    let u: URL
    try {
      u = new URL(url.trim())
    } catch {
      throw new Error('aurum:url-invalida')
    }
    if (u.protocol !== 'https:') throw new Error('aurum:url-invalida')
    await shell.openExternal(u.toString())
    return { ok: true }
  })
}
