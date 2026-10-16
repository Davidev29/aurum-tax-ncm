/**
 * kill-electron.mjs
 * =================
 * Finaliza `electron.exe` ZUMBIS deste projeto antes de (re)gerar o Prisma
 * ou compilar o main (`prebuild:electron`).
 *
 * Motivo: o `electron.exe` de uma sessão `dev` anterior mantém a DLL do
 * Prisma (`query_engine-windows.dll.node`) mapeada e o `prisma generate`
 * morre com EPERM persistente no `rename` — as 4 retentativas do
 * `prisma-generate.cjs` nunca passam porque o bloqueio não é transitório.
 * O mesmo zumbi ainda sequestra a próxima sessão `dev` (single-instance
 * lock: o Electron novo só foca o velho e sai).
 *
 * Seguro: SÓ mata processos cujo executável é exatamente o
 * `node_modules/electron/dist/electron.exe` DESTE checkout — nunca o app
 * instalado, nunca o Electron de outro projeto. Best-effort: qualquer falha
 * aqui só avisa e sai em 0 (nunca quebra o build).
 *
 * Uso: node scripts/kill-electron.mjs (chamado pelo `prebuild:electron`).
 */
import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR_ELECTRON = path.join(RAIZ, 'node_modules', 'electron', 'dist').toLowerCase()

/** PIDs de `electron.exe` rodando a partir DESTE checkout (vazio fora do win32). */
function pidsDesteProjeto() {
  if (process.platform !== 'win32') return []
  try {
    const saida = execSync(`wmic process where "name='electron.exe'" get ProcessId,ExecutablePath /format:csv`, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 20000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const pids = []
    for (const linha of saida.split('\n')) {
      // CSV: Node,ExecutablePath,ProcessId
      const partes = linha.trim().split(',')
      if (partes.length < 3) continue
      const exe = (partes[1] || '').trim().toLowerCase()
      const pid = Number((partes[2] || '').trim())
      if (!exe || !Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue
      if (exe.startsWith(DIR_ELECTRON)) pids.push(pid)
    }
    return [...new Set(pids)]
  } catch {
    return []
  }
}

const pids = pidsDesteProjeto()

if (!pids.length) {
  console.log('[kill-electron] nenhum electron.exe zumbi deste projeto.')
  process.exit(0)
}

for (const pid of pids) {
  try {
    execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore', windowsHide: true })
    console.log(`[kill-electron] electron.exe ${pid} finalizado.`)
  } catch {
    console.warn(`[kill-electron] não foi possível finalizar o PID ${pid} (pode já ter saído).`)
  }
}
