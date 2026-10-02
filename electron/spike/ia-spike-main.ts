/**
 * ia-spike-main.ts — Spike IA-00 (Phase 6, plan 06-00).
 *
 * Lado principal (main process) do spike: spawn do worker via
 * `utilityProcess.fork()` pós-`whenReady()` + round-trip IPC
 * `init` → `classificar` → `encerrar`, com timeouts e kill de segurança.
 *
 * SPIKE-ONLY: não é importado por `electron/main.ts`. O módulo real
 * (`electron/ia/ia-service.cjs`, plan 06-05) será derivado daqui se GO.
 *
 * Uso pelo harness headless (`electron/spike/ia-spike-electron-run.cjs`):
 *   `runSpikeRoundTrip(workerPath)` → `SpikeReport` (JSON no stdout).
 */

import { utilityProcess, type UtilityProcess } from 'electron'

/** Candidato NCM oferecido ao worker (Top-5 RAG no plano real; fixo no spike). */
export interface CandidatoSpike {
  codigo: string
  descricao: string
}

/** Relatório de uma volta completa, serializável em JSON. */
export interface SpikeReport {
  goParcial: boolean
  plataforma: string
  arch: string
  electron: string
  workerPath: string
  transporte: string
  workerPid: number | null
  msSpawnAtePronto: number
  msLoadMock: number
  ramMockMB: number | null
  casos: Array<{
    descricao: string
    codigo: string
    confianca: number
    msIpc: number
  }>
  msEncerrar: number
  workerVivoAposKill: boolean
  erros: string[]
}

interface MsgResposta {
  id: number | null
  ok: boolean
  cmd: string
  [chave: string]: unknown
}

const TIMEOUT_MS = 15_000

let seq = 1
const pendentes = new Map<number, { resolver: (m: MsgResposta) => void; timer: NodeJS.Timeout }>()

function proximoId(): number {
  seq += 1
  return seq
}

/** Envia um comando e aguarda a resposta correlacionada por `id`. */
export function rpc(proc: UtilityProcess, cmd: string, carga: Record<string, unknown> = {}): Promise<MsgResposta> {
  return new Promise((resolver, rejeitar) => {
    const id = proximoId()
    const timer = setTimeout(() => {
      pendentes.delete(id)
      rejeitar(new Error(`timeout (${TIMEOUT_MS}ms) no comando "${cmd}"`))
    }, TIMEOUT_MS)
    pendentes.set(id, {
      resolver,
      timer,
    })
    try {
      proc.postMessage({ id, cmd, ...carga })
    } catch (erro) {
      clearTimeout(timer)
      pendentes.delete(id)
      rejeitar(erro instanceof Error ? erro : new Error(String(erro)))
    }
  })
}

/** Distribui mensagens do worker para os `rpc()` pendentes. */
function ligarRoteador(proc: UtilityProcess, aoPronto: (m: MsgResposta) => void): void {
  proc.on('message', (msg: unknown) => {
    const m = (msg as { data?: MsgResposta })?.data ?? (msg as MsgResposta)
    if (!m || typeof m !== 'object') return
    if (m.cmd === 'pronto' && m.id === null) {
      aoPronto(m as MsgResposta)
      return
    }
    const pend = typeof m.id === 'number' ? pendentes.get(m.id) : undefined
    if (pend) {
      clearTimeout(pend.timer)
      pendentes.delete(m.id as number)
      pend.resolver(m as MsgResposta)
    }
  })
}

/** Candidatos fixos do spike (RAG mock — Vectra real só em 06-03/06-05). */
const CANDIDATOS_SPIKE: CandidatoSpike[] = [
  { codigo: '01012100', descricao: 'Cavalos reprodutores de raça pura vivos' },
  { codigo: '01022911', descricao: 'Frangos vivos para abate criação doméstica' },
  { codigo: '10063021', descricao: 'Arroz branco polido em embalagem' },
  { codigo: '84713012', descricao: 'Notebook computador portátil com processador' },
  { codigo: '09012100', descricao: 'Café torrado moído em pó' },
]

/**
 * Executa a volta completa: spawn → pronto → init(mock) → 3 classificações
 * → encerrar → kill. Chamado pós-`whenReady()` pelo harness.
 */
export async function runSpikeRoundTrip(workerPath: string): Promise<SpikeReport> {
  const erros: string[] = []
  const tSpawn = Date.now()
  const proc: UtilityProcess = utilityProcess.fork(workerPath)
  const workerPid: number | null = typeof proc.pid === 'number' ? proc.pid : null

  const pronto = await new Promise<MsgResposta>((resolver, rejeitar) => {
    const timer = setTimeout(() => rejeitar(new Error('timeout esperando "pronto" do worker')), TIMEOUT_MS)
    ligarRoteador(proc, (m) => {
      clearTimeout(timer)
      resolver(m)
    })
  }).catch((e: unknown) => {
    erros.push(e instanceof Error ? e.message : String(e))
    return null
  })

  const msSpawnAtePronto = Date.now() - tSpawn
  const transporte = pronto && typeof pronto.transporte === 'string' ? pronto.transporte : 'desconhecido'

  let msLoadMock = -1
  let ramMockMB: number | null = null
  const casos: SpikeReport['casos'] = []

  try {
    const rInit = await rpc(proc, 'init', { mock: true })
    if (!rInit.ok) throw new Error(`init falhou: ${String(rInit.erro ?? 'desconhecido')}`)
    msLoadMock = typeof rInit.msLoad === 'number' ? rInit.msLoad : -1
    ramMockMB = typeof rInit.ramMB === 'number' ? rInit.ramMB : null

    const descricoes = ['frango vivo para abate', 'notebook com processador', 'xyzq blorp inexistente']
    for (const descricao of descricoes) {
      const t0 = Date.now()
      const r = await rpc(proc, 'classificar', { descricao, candidatos: CANDIDATOS_SPIKE })
      if (!r.ok) throw new Error(`classificar falhou: ${String(r.erro ?? 'desconhecido')}`)
      casos.push({
        descricao,
        codigo: String(r.codigo ?? '?'),
        confianca: typeof r.confianca === 'number' ? r.confianca : -1,
        msIpc: Date.now() - t0,
      })
    }
  } catch (e: unknown) {
    erros.push(e instanceof Error ? e.message : String(e))
  }

  let msEncerrar = -1
  try {
    const t0 = Date.now()
    const rFim = await rpc(proc, 'encerrar', {})
    msEncerrar = Date.now() - t0
    if (!rFim.ok) erros.push(`encerrar respondeu ok=false: ${String(rFim.erro ?? '')}`)
  } catch (e: unknown) {
    erros.push(e instanceof Error ? `encerrar: ${e.message}` : String(e))
  }

  // Kill de segurança (espelha o `before-quit` do plano real) + verificação.
  try {
    proc.kill()
  } catch (_) {
    /* já morto — ok */
  }
  await new Promise((r) => setTimeout(r, 500))
  let workerVivoAposKill = false
  try {
    if (workerPid !== null) {
      process.kill(workerPid, 0)
      workerVivoAposKill = true
      erros.push(`worker pid=${workerPid} sobreviveu ao kill (órfão)`)
    }
  } catch (_) {
    workerVivoAposKill = false
  }

  for (const [, p] of pendentes) clearTimeout(p.timer)
  pendentes.clear()

  const ipcMax = casos.reduce((m, c) => Math.max(m, c.msIpc), -1)
  const goParcial =
    erros.length === 0 &&
    msSpawnAtePronto < 10_000 &&
    msLoadMock >= 0 &&
    msLoadMock < 10_000 &&
    ipcMax >= 0 &&
    ipcMax < 50 &&
    !workerVivoAposKill

  return {
    goParcial,
    plataforma: process.platform,
    arch: process.arch,
    electron: process.versions.electron ?? 'desconhecida',
    workerPath,
    transporte,
    workerPid,
    msSpawnAtePronto,
    msLoadMock,
    ramMockMB,
    casos,
    msEncerrar,
    workerVivoAposKill,
    erros,
  }
}

/** Kill de segurança para ligar em `app.on('before-quit')` no módulo real. */
export function killIaSpikeWorker(proc: UtilityProcess | null): void {
  try {
    proc?.kill()
  } catch (_) {
    /* worker já encerrado */
  }
}

export {}
