/**
 * prisma-generate.cjs — `prisma generate` com retentativa anti-EPERM (Windows).
 *
 * No Windows, o `prisma generate` renomeia a DLL do motor
 * (`query_engine-windows.dll.node`) e qualquer bloqueio momentâneo
 * (antivírus escaneando o arquivo novo, `electron.exe` zumbi da sessão
 * anterior ainda com a DLL mapeada) derruba a geração com:
 * `EPERM: operation not permitted, rename '....tmpNNNN' -> '....node'`.
 * O erro é transitório — a segunda tentativa passa — mas quebrava o
 * `npm run dev` inteiro (o `dev:electron` saía com código 1).
 *
 * Estratégia: até 4 tentativas com 2 s de intervalo; antes de repetir,
 * remove resíduos `*.tmp*` de `node_modules/.prisma/client` e orienta o
 * usuário quando o bloqueio persiste (provável processo prendendo a DLL).
 *
 * Uso: `node scripts/prisma-generate.cjs` (chamado por `db:generate`).
 * `DATABASE_URL` default: `file:./prisma/dev.db` (override por env).
 */
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const RAIZ = path.resolve(__dirname, '..')
const DIR_CLIENT = path.join(RAIZ, 'node_modules', '.prisma', 'client')
const TENTATIVAS = 4
const ESPERA_MS = 2000

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'file:./prisma/dev.db'
}

function dormir(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function limparTmps() {
  let removidos = 0
  try {
    for (const nome of fs.readdirSync(DIR_CLIENT)) {
      if (!nome.includes('.tmp')) continue
      try {
        fs.rmSync(path.join(DIR_CLIENT, nome), { force: true })
        removidos += 1
      } catch {
        /* travado: a próxima tentativa decide */
      }
    }
  } catch {
    /* pasta ainda não existe (primeira geração): nada a limpar */
  }
  return removidos
}

function ehBloqueioTransitório(saída) {
  return /EPERM|EBUSY|EPERM.*rename|operation not permitted/i.test(String(saída ?? ''))
}

async function main() {
  let últimaSaída = ''
  for (let t = 1; t <= TENTATIVAS; t += 1) {
    const r = spawnSync('npx prisma generate', {
      cwd: RAIZ,
      shell: true,
      encoding: 'utf-8',
    })
    const saída = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
    últimaSaída = saída
    if (r.status === 0) {
      if (t > 1) console.log(`[prisma-generate] ok na tentativa ${t}/${TENTATIVAS}`)
      return
    }
    if (t < TENTATIVAS && ehBloqueioTransitório(saída)) {
      const n = limparTmps()
      console.warn(
        `[prisma-generate] tentativa ${t}/${TENTATIVAS} bloqueada pelo SO (EPERM/EBUSY, ` +
          `${n} tmp(s) removido(s)) — repetindo em ${ESPERA_MS / 1000}s…`,
      )
      await dormir(ESPERA_MS)
      continue
    }
    break
  }
  console.error(últimaSaída.trim())
  console.error(
    '\n[prisma-generate] FALHOU. Se o erro for EPERM/EBUSY persistente: ' +
      'feche o app instalado/em dev (`electron.exe` zumbi prende a DLL), ' +
      'pausie o antivírus na pasta do projeto ou rode `npm run dev` de novo.',
  )
  process.exit(1)
}

main().catch((e) => {
  console.error(`[prisma-generate] erro interno: ${e?.message ?? e}`)
  process.exit(1)
})
