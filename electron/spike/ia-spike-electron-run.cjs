/**
 * ia-spike-electron-run.cjs — Harness headless do spike IA-00.
 *
 * Main script MÍNIMO do Electron (sem BrowserWindow): aguarda `whenReady()`,
 * executa `runSpikeRoundTrip()` (spawn via `utilityProcess` + IPC
 * init/classificar/encerrar), imprime o `SpikeReport` como JSON no stdout
 * e encerra com exit code 0 (GO parcial) ou 1.
 *
 * Execução (a partir da raiz do repo):
 *   npx esbuild electron/spike/ia-spike-main.ts --bundle --platform=node ^
 *     --format=cjs --external:electron --outfile="%TEMP%\ia-spike\ia-spike-main.cjs"
 *   npx electron electron/spike/ia-spike-electron-run.cjs
 *
 * SPIKE-ONLY: não é referenciado por `electron/main.ts` nem pelo build.
 */

const path = require('node:path')
const fs = require('node:fs')

// Compilado do `ia-spike-main.ts` via esbuild (ver cabeçalho). Procura no
// TEMP primeiro (fluxo documentado) e depois ao lado deste arquivo.
function carregarModuloSpike() {
  const candidatos = [
    path.join(process.env.TEMP || process.env.TMP || '/tmp', 'ia-spike', 'ia-spike-main.cjs'),
    path.join(__dirname, 'dist', 'ia-spike-main.cjs'),
  ]
  for (const c of candidatos) {
    if (fs.existsSync(c)) return require(c)
  }
  throw new Error(`módulo compilado ia-spike-main.cjs não encontrado em: ${candidatos.join(' | ')}`)
}

async function main() {
  const { app } = require('electron')
  await app.whenReady()
  const workerPath = path.join(__dirname, 'ia-spike-worker.cjs')
  let relatorio
  try {
    const { runSpikeRoundTrip } = carregarModuloSpike()
    relatorio = await runSpikeRoundTrip(workerPath)
  } catch (erro) {
    relatorio = {
      goParcial: false,
      plataforma: process.platform,
      arch: process.arch,
      electron: (process.versions && process.versions.electron) || 'desconhecida',
      workerPath,
      transporte: 'n/a',
      workerPid: null,
      msSpawnAtePronto: -1,
      msLoadMock: -1,
      ramMockMB: null,
      casos: [],
      msEncerrar: -1,
      workerVivoAposKill: false,
      erros: [erro instanceof Error ? erro.stack || erro.message : String(erro)],
    }
  }
  process.stdout.write(JSON.stringify(relatorio, null, 2) + '\n')
  const pendentes = relatorio.goParcial ? 0 : 1
  // Saída limpa: garante que o worker morreu junto (verificação de órfãos
  // complementada por `tasklist` no shell após o término).
  app.exit(pendentes)
}

main().catch((e) => {
  process.stderr.write(`FALHA NO HARNESS: ${(e && e.stack) || e}\n`)
  try {
    require('electron').app.exit(2)
  } catch (_) {
    process.exit(2)
  }
})
