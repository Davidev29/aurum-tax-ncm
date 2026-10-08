/**
 * Append JSONL com rotação + scrub — integrado em `anexarConsultaIaJsonl`
 * (`src/infrastructure/ia/classificacao-ia-repo.ts`).
 *
 * - Teto 5 MiB por arquivo, 3 gerações (`base`, `base.1`, `base.2`, `base.3`);
 * - `descricao` passa por `removerPII` antes de persistir (C-008);
 * - só roda em Node (scripts/Electron-main/vitest); no renderer é no-op;
 * - nunca lança.
 */
import { removerPII } from '@/ai/guards'

/** Teto por arquivo antes de rodar (5 MiB). */
export const LIMITE_BYTES_LOG = 5 * 1024 * 1024
/** Gerações mantidas além do arquivo base. */
export const GERACOES_LOG = 3

interface FsMinimo {
  mkdir: (dir: string, opts?: { recursive: boolean }) => Promise<unknown>
  stat: (caminho: string) => Promise<{ size: number }>
  rename: (de: string, para: string) => Promise<void>
  rm: (caminho: string, opts?: { force: boolean }) => Promise<void>
  appendFile: (caminho: string, dados: string, cod: string) => Promise<void>
}

function ehNode(): boolean {
  try {
    return typeof process !== 'undefined' && !!(process as unknown as { versions?: { node?: string } }).versions?.node
  } catch {
    return false
  }
}

/** Nome da geração `g` (1..3) de um arquivo base. Puro — testável sem disco. */
export function nomeGeracao(base: string, g: number): string {
  return `${base}.${g}`
}

/** Copia higienizada: `descricao` sem PII. Puro — nunca lança. */
export function higienizarRegistro(entrada: Record<string, unknown>): Record<string, unknown> {
  try {
    const copia = { ...entrada }
    if (typeof copia.descricao === 'string') copia.descricao = removerPII(copia.descricao)
    return copia
  } catch {
    return { scrubFalhou: true }
  }
}

async function rodarSePreciso(fs: FsMinimo, alvo: string): Promise<void> {
  let tamanho = 0
  try {
    tamanho = (await fs.stat(alvo)).size
  } catch {
    return
  }
  if (!Number.isFinite(tamanho) || tamanho < LIMITE_BYTES_LOG) return
  try {
    await fs.rm(nomeGeracao(alvo, GERACOES_LOG), { force: true })
  } catch {
    /* geração ausente: segue */
  }
  for (let g = GERACOES_LOG - 1; g >= 1; g -= 1) {
    const de = g === 1 ? alvo : nomeGeracao(alvo, g - 1)
    const para = nomeGeracao(alvo, g)
    try {
      await fs.rename(de, para)
    } catch {
      /* geração ausente: segue */
    }
  }
}

/**
 * Acrescenta uma linha JSONL higienizada, rodando o arquivo se ≥ 5 MiB.
 * `dir` padrão: `<cwd>/logs`. No-op fora do Node. Nunca lança.
 */
export async function acrescentarLog(
  nome: string,
  entrada: Record<string, unknown>,
  opts?: { dir?: string },
): Promise<void> {
  if (!ehNode()) return
  try {
    const fs = (await import(/* @vite-ignore */ 'node:fs/promises')) as unknown as FsMinimo
    const path = (await import(/* @vite-ignore */ 'node:path')) as unknown as {
      join: (...partes: string[]) => string
    }
    const cwd = typeof process.cwd === 'function' ? process.cwd() : '.'
    const dir = opts?.dir ?? path.join(cwd, 'logs')
    await fs.mkdir(dir, { recursive: true })
    const alvo = path.join(dir, nome)
    await rodarSePreciso(fs, alvo)
    await fs.appendFile(alvo, `${JSON.stringify(higienizarRegistro(entrada))}\n`, 'utf-8')
  } catch {
    /* trilha em disco é best-effort; o audit_log já cobre a auditoria */
  }
}
