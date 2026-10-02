'use strict'

/**
 * ofuscar-ia.cjs — Ofuscação do worker IA (06-08 / IA-08).
 *
 * Pós-build, sobre `electron/dist/ia-worker.cjs` (copiado pelo esbuild,
 * NUNCA bundlado — `utilityProcess.fork()` exige arquivo real).
 *
 * Dois modos (offline-first):
 *
 *   1. PACOTE REAL (`javascript-obfuscator` instalado): preset médio —
 *      compact + stringArray. NUNCA `selfDefending`/`debugProtection`
 *      (quebram o fork no Electron) e NUNCA `renameGlobals`.
 *   2. LEVE PRÓPRIA (pacote ausente — ambiente offline atual): strip de
 *      comentários (full-line + bloco, com lexer ciente de strings),
 *      rename consistente de ~20 símbolos INTERNOS via mapa fixo (aplicado
 *      SOMENTE fora de strings) e colapso de linhas vazias. NÃO toca em
 *      campos do protocolo IPC (`codigo`, `confianca`, `candidatos`, ...),
 *      NÃO toca em `require` nem em nomes importados (`dirRecursosIa`).
 *
 * Em AMBOS os modos, a saída é validada antes de confirmar:
 *   - `node --check` (sintaxe);
 *   - smoke real: fork do worker → `init{mpck}` → `buscar "frango vivo"`
 *     (top-1 cap. 01) → `classificar "frango vivo"` → `encerrar`.
 * Se qualquer validação falhar, o arquivo original é RESTAURADO e o
 * processo sai com código 1. O worker nunca é deixado quebrado.
 *
 * Uso:
 *   node scripts/ofuscar-ia.cjs [--entrada <path>] [--saida <path>] [--check]
 *
 *   --check   só valida o worker (sintaxe + smoke), sem modificar nada.
 *   Padrão: entrada = saída = electron/dist/ia-worker.cjs (in-place).
 *
 * UAT (com rede + pacote real):
 *   npm i --no-save javascript-obfuscator
 *   node scripts/ofuscar-ia.cjs   # aplica o preset médio e valida igual
 *
 * Sem dependências além de `node:` quando o pacote está ausente.
 */

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync, fork } = require('node:child_process')

const RAIZ = path.resolve(__dirname, '..')
const WORKER_PADRAO = path.join(RAIZ, 'electron', 'dist', 'ia-worker.cjs')

const MARCADOR = '__AURUM_IA_OFUSCADO__'

/**
 * Mapa fixo de rename LEVE. Somente símbolos internos do worker, nunca
 * serializados no protocolo IPC e nunca importados de outro módulo.
 * (Campos como `codigo`/`confianca`/`candidatos`/`descricao` são o contrato
 * com o main e JAMAIS entram aqui.)
 */
const MAPA_RENOME = {
  normalizar: '_ia0',
  stem: '_ia1',
  tokenizar: '_ia2',
  expandirConsulta: '_ia3',
  buscarIndice: '_ia4',
  carregarIndice: '_ia5',
  enriquecer: '_ia6',
  selecionarMock: '_ia7',
  montarPromptRigido: '_ia8',
  selecionarReal: '_ia9',
  agoraMs: '_ia10',
  ramMB: '_ia11',
  raizProjeto: '_ia12',
  tratar: '_ia13',
  canal: '_ia14',
  canalTipo: '_ia15',
  enviar: '_ia16',
  ouvir: '_ia17',
  modelo: '_ia18',
  indice: '_ia19',
  mapaDescricoes: '_ia20',
  STOPWORDS: '_ia21',
  SINONIMOS: '_ia22',
  GRUPOS_SINONIMOS: '_ia23',
  MODELO_SIMBOLICO: '_ia24',
  LIMIAR_NAO_SEI: '_ia25',
}

/**
 * Single-pass sobre a fonte: copia strings verbatim (com escapes; backticks
 * com interpolação aninhada), REMOVE comentários de linha e de bloco, e
 * devolve o código com strings trocadas por placeholders.
 *
 * Um passe único é obrigatório (e não lexer em duas fases): os comentários
 * do worker contêm backticks (ex. process.resourcesPath entre crases), que um
 * lexer de strings rodado antes do strip entenderia como string — foi
 * exatamente o bug que o validador pegou (FAIL + restore) na 1ª versão.
 */
function separarCodigoEStrings(fonte) {
  const strings = []
  let codigo = ''
  const n = fonte.length
  let i = 0
  function copiarString(quote) {
    // Copia do quote de abertura até o fechamento correspondente.
    let str = quote
    i += 1
    if (quote !== '`') {
      while (i < n) {
        const c = fonte[i]
        str += c
        if (c === '\\') {
          if (i + 1 < n) { str += fonte[i + 1]; i += 2 } else { i += 1 }
          continue
        }
        i += 1
        if (c === quote) break
      }
      return str
    }
    // Backtick: suporta `${...}` com chaves/strings aninhadas.
    let prof = 0
    while (i < n) {
      const c = fonte[i]
      str += c
      if (c === '\\') {
        if (i + 1 < n) { str += fonte[i + 1]; i += 2 } else { i += 1 }
        continue
      }
      if (c === '$' && fonte[i + 1] === '{') { str += '{'; prof += 1; i += 2; continue }
      if (c === '{' && prof > 0) { prof += 1; i += 1; continue }
      if (c === '}' && prof > 0) { prof -= 1; i += 1; continue }
      if ((c === "'" || c === '"') && prof > 0) {
        // String aninhada dentro de ${...}: consome até fechar.
        const q2 = c
        i += 1
        while (i < n) {
          const e2 = fonte[i]
          str += e2
          if (e2 === '\\') {
            if (i + 1 < n) { str += fonte[i + 1]; i += 2 } else { i += 1 }
            continue
          }
          i += 1
          if (e2 === q2) break
        }
        continue
      }
      i += 1
      if (c === '`' && prof === 0) break
    }
    return str
  }
  while (i < n) {
    const ch = fonte[i]
    const prox = i + 1 < n ? fonte[i + 1] : ''
    if (ch === '/' && prox === '/') {
      // Comentário de linha: pula até EOL (mantém a quebra).
      while (i < n && fonte[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && prox === '*') {
      // Comentário de bloco: pula até */.
      i += 2
      while (i < n && !(fonte[i] === '*' && fonte[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const idx = strings.length
      strings.push(copiarString(ch))
      codigo += `\x00${idx}\x00`
      continue
    }
    codigo += ch
    i += 1
  }
  return { codigo, strings }
}

/** Reinsere as strings nos placeholders `\x00<n>\x00`. */
function rejuntar(codigo, strings) {
  return codigo.replace(/\x00(\d+)\x00/g, (_, d) => strings[Number(d)])
}

function montarSaidaLeve(fonteOriginal) {
  // Guarda: nenhum alvo ofuscado pode pré-existir (evita colisão/renome duplo).
  for (const destino of Object.values(MAPA_RENOME)) {
    if (new RegExp(`\\b${destino}\\b`).test(fonteOriginal)) {
      throw new Error(
        `colisão de rename: "${destino}" já existe na fonte (worker já ofuscado? restaure via build).`,
      )
    }
  }
  let { codigo, strings } = separarCodigoEStrings(fonteOriginal)
  for (const [origem, destino] of Object.entries(MAPA_RENOME)) {
    codigo = codigo.replace(new RegExp(`\\b${origem}\\b`, 'g'), destino)
  }
  let saida = rejuntar(codigo, strings)
  // Colapso de linhas vazias (só fora de strings — segmentos já separados).
  saida = saida
    .split('\n')
    .map((l) => (l.trim() === '' ? '' : l.replace(/[ \t]+$/g, '')))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
  const banner =
    `'use strict'\n` +
    `/*${MARCADOR}:leve-offline 06-08 — comentários removidos + ${Object.keys(MAPA_RENOME).length} ` +
    `símbolos internos renomeados. Protocolo IPC intacto. UAT: preset médio com javascript-obfuscator.*/\n`
  // A fonte já começa com 'use strict' — troca pelo banner (evita duplicar).
  saida = saida.replace(/^\s*'use strict'\s*\n/, '')
  return banner + saida.trimStart().replace(/\s+$/, '') + '\n'
}

function checarSintaxe(arquivo) {
  const r = spawnSync(process.execPath, ['--check', arquivo], { encoding: 'utf8' })
  return { ok: r.status === 0, saida: (r.stdout || '') + (r.stderr || '') }
}

/** Smoke real contra o worker: pronto → init → buscar → classificar → encerrar. */
function smokeWorker(caminhoWorker, tempoLimiteMs = 25000) {
  return new Promise((resolve) => {
    const detalhe = { etapas: [] }
    let finalizado = false
    function concluir(ok, erro) {
      if (finalizado) return
      finalizado = true
      clearTimeout(timer)
      try { filho.kill() } catch (_) { /* best-effort */ }
      resolve({ ok, erro, detalhe })
    }
    let filho
    try {
      filho = fork(caminhoWorker, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
    } catch (e) {
      concluir(false, `fork falhou: ${e && e.message ? e.message : e}`)
      return
    }
    const timer = setTimeout(() => concluir(false, 'timeout do smoke (>25s sem concluir)'), tempoLimiteMs)
    const pendentes = new Map()
    let proximoId = 1
    function enviar(cmd, extra) {
      return new Promise((res, rej) => {
        const id = proximoId++
        pendentes.set(id, { res, rej })
        filho.send({ id, cmd, ...(extra || {}) })
      })
    }
    filho.on('message', (msg) => {
      void (async () => {
        try {
          if (msg && msg.cmd === 'pronto' && msg.id == null) {
            detalhe.etapas.push('pronto')
            const ini = await enviar('init', { mock: true })
            if (!ini.ok) throw new Error(`init mock falhou: ${ini.erro || '?'}`)
            detalhe.etapas.push('init-mock')
            const bus = await enviar('buscar', { consulta: 'frango vivo para abate', k: 5 })
            if (!bus.ok || !Array.isArray(bus.candidatos) || !bus.candidatos.length) {
              throw new Error(`buscar "frango vivo" sem candidatos: ${bus.erro || '?'}`)
            }
            detalhe.top1 = bus.candidatos[0] && bus.candidatos[0].codigo
            detalhe.etapas.push(`buscar:top1=${detalhe.top1}`)
            if (!/^0105/.test(String(detalhe.top1 || '').replace(/\D/g, ''))) {
              throw new Error(`buscar "frango vivo" top-1 fora do cap. 01: ${detalhe.top1}`)
            }
            const cla = await enviar('classificar', { descricao: 'frango vivo para abate' })
            if (!cla.ok || !cla.codigo) {
              throw new Error(`classificar "frango vivo" falhou: ${cla.erro || '?'}`)
            }
            detalhe.codigo = cla.codigo
            detalhe.etapas.push(`classificar:${cla.codigo}`)
            await enviar('encerrar', {})
            detalhe.etapas.push('encerrar')
            concluir(true, null)
          } else if (msg && msg.id != null && pendentes.has(msg.id)) {
            pendentes.get(msg.id).res(msg)
            pendentes.delete(msg.id)
          }
        } catch (e) {
          concluir(false, e && e.message ? e.message : String(e))
        }
      })()
    })
    filho.on('error', (e) => concluir(false, `erro no worker: ${e && e.message ? e.message : e}`))
    filho.on('exit', (code) => {
      if (!finalizado && detalhe.etapas.length < 4) {
        concluir(false, `worker saiu cedo (code=${code}) após [${detalhe.etapas.join(', ')}]`)
      }
    })
  })
}

async function validar(caminhoWorker) {
  const sint = checarSintaxe(caminhoWorker)
  if (!sint.ok) return { ok: false, fase: 'node --check', detalhe: sint.saida.trim().slice(0, 500) }
  const smoke = await smokeWorker(caminhoWorker)
  if (!smoke.ok) {
    return { ok: false, fase: 'smoke', detalhe: `${smoke.erro} [${smoke.detalhe.etapas.join(' → ')}]` }
  }
  return { ok: true, fase: 'ok', detalhe: `etapas [${smoke.detalhe.etapas.join(' → ')}]` }
}

async function main() {
  const args = process.argv.slice(2)
  function op(nome) {
    const i = args.indexOf(nome)
    return i >= 0 && args[i + 1] ? args[i + 1] : null
  }
  const entrada = path.resolve(op('--entrada') || WORKER_PADRAO)
  const saida = path.resolve(op('--saida') || entrada)
  const soCheck = args.includes('--check')

  if (!fs.existsSync(entrada)) {
    console.error(`[ofuscar-ia] worker não encontrado: ${entrada} (rode "node electron/esbuild.mjs" antes)`)
    process.exit(1)
  }

  if (soCheck) {
    console.log(`[ofuscar-ia] --check: validando ${entrada}`)
    const v = await validar(entrada)
    console.log(`[ofuscar-ia] ${v.ok ? 'PASS' : 'FAIL'} (${v.fase}): ${v.detalhe}`)
    process.exit(v.ok ? 0 : 1)
  }

  const original = fs.readFileSync(entrada, 'utf8')
  const bytesAntes = Buffer.byteLength(original, 'utf8')

  // Tentativa com o pacote real (preset médio). Ausência offline → modo leve.
  let modo = 'leve-offline'
  let ofuscado = null
  let obfuscator = null
  try {
    // require dinâmico proposital: pacote OPCIONAL, nunca no package.json.
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    obfuscator = require('javascript-obfuscator')
  } catch (_) {
    obfuscator = null
  }

  if (obfuscator) {
    modo = 'obfuscator-medio'
    console.log('[ofuscar-ia] javascript-obfuscator detectado — aplicando preset médio (UAT).')
    try {
      const res = obfuscator.obfuscate(original, {
        compact: true,
        simplify: true,
        stringArray: true,
        stringArrayThreshold: 0.75,
        renameGlobals: false,
        selfDefending: false,
        debugProtection: false,
        controlFlowFlattening: false,
        deadCodeInjection: false,
      })
      ofuscado = String(res.getObfuscatedCode())
      if (!ofuscado.includes(MARCADOR)) {
        ofuscado = `/*${MARCADOR}:obfuscator-medio 06-08*/\n${ofuscado}`
      }
    } catch (e) {
      console.error(`[ofuscar-ia] preset médio falhou (${e && e.message ? e.message : e}) — abortando sem tocar o worker.`)
      process.exit(1)
    }
  } else {
    console.log('[ofuscar-ia] javascript-obfuscator AUSENTE (offline) — aplicando ofuscação LEVE própria.')
    console.log('[ofuscar-ia] UAT pendente: npm i --no-save javascript-obfuscator && node scripts/ofuscar-ia.cjs')
    try {
      ofuscado = montarSaidaLeve(original)
    } catch (e) {
      console.error(`[ofuscar-ia] ofuscação leve falhou (${e && e.message ? e.message : e}) — worker intacto.`)
      process.exit(1)
    }
  }

  fs.writeFileSync(saida, ofuscado, 'utf8')
  const bytesDepois = Buffer.byteLength(ofuscado, 'utf8')
  console.log(`[ofuscar-ia] modo=${modo} bytes ${bytesAntes} → ${bytesDepois} — validando...`)

  const v = await validar(saida)
  if (!v.ok) {
    fs.writeFileSync(saida, original, 'utf8')
    console.error(`[ofuscar-ia] FAIL (${v.fase}): ${v.detalhe}`)
    console.error('[ofuscar-ia] original RESTAURADO — worker intacto.')
    process.exit(1)
  }
  console.log(`[ofuscar-ia] PASS (${v.fase}): ${v.detalhe}`)
  console.log(`[ofuscar-ia] worker ofuscado OK: ${saida}`)
}

main().catch((e) => {
  console.error(`[ofuscar-ia] erro fatal: ${e && e.message ? e.message : e}`)
  process.exit(1)
})
