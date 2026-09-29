/**
 * kill-port.mjs
 * =============
 * Libera uma porta TCP antes de subir o dev server (`predev`).
 *
 * Motivo: se um `vite dev` anterior ficou zumbi, o novo `vite --strictPort`
 * morre com "Port 5173 is already in use" e o `concurrently -s first` mata
 * o Electron junto — o programa nunca abre. Rodando como `predev`, o
 * `npm run dev` sempre parte do zero e a janela abre.
 *
 * Uso: node scripts/kill-port.mjs 5173
 * Seguro: só age na porta informada; se não houver nada ouvindo, sai em 0.
 */
import { execSync } from 'node:child_process'

const porta = Number(process.argv[2])

if (!Number.isInteger(porta) || porta <= 0 || porta > 65535) {
  console.error('Uso: node scripts/kill-port.mjs <porta>')
  process.exit(2)
}

function pidsNaPorta() {
  try {
    const saida = execSync(`netstat -ano -p TCP`, { encoding: 'utf8', windowsHide: true })
    const pids = new Set()
    for (const linha of saida.split('\n')) {
      // Ex.: TCP  127.0.0.1:5173  0.0.0.0:0  LISTENING  1234
      const m = linha.match(/TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i)
      if (m && Number(m[1]) === porta) pids.add(Number(m[2]))
    }
    return [...pids].filter((p) => p !== process.pid)
  } catch {
    return []
  }
}

const pids = process.platform === 'win32' ? pidsNaPorta() : []

if (!pids.length) {
  console.log(`Porta ${porta} livre.`)
  process.exit(0)
}

for (const pid of pids) {
  try {
    execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore', windowsHide: true })
    console.log(`Processo ${pid} na porta ${porta} finalizado.`)
  } catch {
    console.warn(`Não foi possível finalizar o PID ${pid} (pode já ter saído).`)
  }
}
