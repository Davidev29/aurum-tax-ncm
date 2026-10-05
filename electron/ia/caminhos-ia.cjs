'use strict'

/**
 * caminhos-ia.cjs — Resolução central de caminhos dos artefatos IA (06-07 / IA-07).
 *
 * Regra única, usada pelo main (`ia-service.cjs`, bundlado em
 * `electron/dist/main.js`) e pelo worker (`ia-worker.cjs`, copiado para
 * `electron/dist/` — NUNCA bundlado, pois `utilityProcess.fork()` exige um
 * arquivo real):
 *
 *   - Dev (`app.isPackaged === false` ou heurística fora do asar):
 *     `<raiz-do-projeto>/recursos-ia/...`
 *   - Prod (empacotado): `<process.resourcesPath>/recursos-ia/...`
 *     (via `extraResources` do electron-builder — ver `package.json` → build).
 *   - Fallback: se o diretório primário não existir, tenta os demais
 *     candidatos em ordem e registra `console.warn` (nunca lança).
 *
 * Módulo sem estado e sem dependências além de `node:fs`/`node:path`, para
 * funcionar identicamente bundlado (main) e copiado (worker). O esbuild
 * (`electron/esbuild.mjs`) copia este arquivo para `electron/dist/` junto ao
 * worker; o `require('./caminhos-ia.cjs')` do worker resolve no `dist/`.
 *
 * Deliberadamente FORA do pacote (ver `extraResources`):
 *   - `recursos-ia/modelo/*.gguf` — ausente offline (modo mock 06-05);
 *   - `recursos-ia/embedding/*` — pesos ainda não adquiridos (06-03 pendente).
 */

const fs = require('node:fs')
const path = require('node:path')

const NOME_GGUF = 'Qwen3-0.6B-Q8_0.gguf'

/**
 * CAMADA DE COMPATIBILIDADE (modelo agnóstico): `NOME_GGUF` acima é o nome
 * LEGADO, mantido para compatibilidade. A descoberta efetiva delega a
 * `perfil-modelo.cjs` (`descobrirModelo`): manifesto `modelo.json` → env
 * `AURUM_IA_MODEL` → legado → qualquer `*.gguf`. Trocar de modelo = trocar o
 * arquivo `.gguf` em `recursos-ia/modelo/` — nenhum código muda.
 */
let perfilModelo = null
try {
  perfilModelo = require('./perfil-modelo.cjs')
} catch (_) {
  perfilModelo = null
}

/** `true` quando rodando dentro do app empacotado. */
function ehEmpacotado(app) {
  try {
    if (app && typeof app.isPackaged === 'boolean') return app.isPackaged
  } catch (_) {
    // sem app (worker) — cai na heurística abaixo
  }
  const dir = typeof __dirname === 'string' ? __dirname : process.cwd()
  return dir.includes('app.asar') || String(dir).includes('resources')
}

/**
 * Raiz do projeto em dev: este arquivo mora em `electron/ia/` (fonte) ou
 * `electron/dist/` (copiado) — a raiz está dois níveis acima em ambos.
 */
function raizProjetoDev() {
  return path.resolve(__dirname, '..', '..')
}

/**
 * Diretório `recursos-ia` efetivo (prod → dev → cwd), com fallback e aviso.
 * Nunca lança: devolve o melhor candidato mesmo que inexistente.
 */
function dirRecursosIa(app) {
  const candidatos = []
  if (ehEmpacotado(app)) {
    // Prod: `extraResources` espelha `recursos-ia/` em `<resources>/recursos-ia`.
    candidatos.push(path.join(process.resourcesPath, 'recursos-ia'))
  }
  candidatos.push(path.join(raizProjetoDev(), 'recursos-ia'))
  candidatos.push(path.join(process.cwd(), 'recursos-ia'))
  for (const c of candidatos) {
    try {
      if (fs.existsSync(c)) return c
    } catch (_) {
      // ignora e tenta o próximo
    }
  }
  console.warn(`[ia] diretório recursos-ia não encontrado; usando fallback ${candidatos[0]}`)
  return candidatos[0]
}

/** Raiz que contém `recursos-ia/` (pai do diretório efetivo). */
function raizProjeto(app) {
  return path.resolve(dirRecursosIa(app), '..')
}

/** Índice lexical RAG (`indice-lexical.json`, fallback offline 06-03). */
function caminhoIndiceLexical(app) {
  return path.join(dirRecursosIa(app), 'indice-ncm', 'indice-lexical.json')
}

/** Hash semântico do MANIFEST que versiona o índice (gatilho 06-03). */
function caminhoManifestHash(app) {
  return path.join(dirRecursosIa(app), 'indice-ncm', '.manifest-hash')
}

/** Base unificada 2335 NCMs (06-02). */
function caminhoBaseIa(app) {
  return path.join(dirRecursosIa(app), 'dados-brutos', 'ncm-para-ia.json')
}

/** Diretório `recursos-ia/modelo/` efetivo (qualquer `*.gguf` + `modelo.json`). */
function caminhoDirModelo(app) {
  return path.join(dirRecursosIa(app), 'modelo')
}

/** GGUF do LLM local (agnóstico: descoberta via perfil-modelo; ausente → `null`, modo mock). */
function caminhoModeloGguf(app) {
  try {
    if (perfilModelo && typeof perfilModelo.descobrirModelo === 'function') {
      const achado = perfilModelo.descobrirModelo(caminhoDirModelo(app))
      if (achado && achado.caminho) {
        try {
          if (fs.existsSync(achado.caminho)) return achado.caminho
        } catch (_) {
          // ignora
        }
      }
    }
  } catch (_) {
    // cai no legado abaixo
  }
  const alvo = path.join(dirRecursosIa(app), 'modelo', NOME_GGUF)
  try {
    if (fs.existsSync(alvo)) return alvo
  } catch (_) {
    // ignora
  }
  return null
}

/**
 * Descoberta detalhada do modelo (`{ caminho, arquivo, origem }`).
 * `origem`: 'manifesto' | 'env' | 'legado' | 'descoberta' | null.
 */
function descobrirGgufEfetivo(app) {
  try {
    if (perfilModelo && typeof perfilModelo.descobrirModelo === 'function') {
      return perfilModelo.descobrirModelo(caminhoDirModelo(app))
    }
  } catch (_) {
    // fallback abaixo
  }
  const alvo = path.join(dirRecursosIa(app), 'modelo', NOME_GGUF)
  try {
    if (fs.existsSync(alvo)) return { caminho: alvo, arquivo: NOME_GGUF, origem: 'legado' }
  } catch (_) {
    // ignora
  }
  return { caminho: null, arquivo: null, origem: null }
}

/**
 * Perfil efetivo do modelo (`{ gguf, perfil }` — ver perfil-modelo.cjs).
 * Nunca lança; sem GGUF devolve perfil genérico com `gguf: null`.
 */
function perfilModeloEfetivo(app) {
  try {
    if (perfilModelo && typeof perfilModelo.perfilEfetivo === 'function') {
      return perfilModelo.perfilEfetivo(caminhoDirModelo(app))
    }
  } catch (_) {
    // fallback abaixo
  }
  const gguf = descobrirGgufEfetivo(app)
  return {
    gguf: gguf.caminho ? gguf : null,
    perfil: perfilModelo && perfilModelo.PERFIL_GENERICO
      ? { ...perfilModelo.PERFIL_GENERICO }
      : { familia: 'generico', templateChat: 'generico', contextSize: 4096 },
  }
}

// ---------------------------------------------------------------------------
// Layout protegido 06-08 (IA-08): `assets/aux.dat` + `assets/idx/`.
// Aditivo e sem quebra: o legado (`recursos-ia/...`) continua funcionando.
// A troca física de diretórios + `extraResources` é passo UAT documentado
// em `docs/seguranca-ia.md` §5; aqui só a RESOLUÇÃO (prod → dev), que aceita
// os dois layouts e prefere o protegido.
// ---------------------------------------------------------------------------

/** Nome do modelo cifrado (AES-256-GCM, ver scripts/criptografar-modelo-ia.mjs). */
const NOME_MODELO_CIFRADO = 'aux.dat'

/** Diretório dos artefatos protegidos (relativo à raiz ou a resources/). */
const DIR_ATIVOS_PROTEGIDOS = 'assets'

/** Subdiretório do índice RAG protegido (equivale a `recursos-ia/indice-ncm/`). */
const DIR_INDICE_PROTEGIDO = 'idx'

const NOME_INDICE_LEXICAL = 'indice-lexical.json'

/**
 * Diretórios-base candidatos (prod empacotado → dev → cwd), para o layout
 * protegido. Nunca lança; devolve `null` quando nenhum existe.
 */
function dirAtivosProtegidos(app) {
  const candidatos = []
  if (ehEmpacotado(app)) {
    try {
      candidatos.push(path.join(process.resourcesPath, DIR_ATIVOS_PROTEGIDOS))
    } catch (_) {
      // sem process.resourcesPath (worker puro) — segue para dev
    }
  }
  candidatos.push(path.join(raizProjetoDev(), DIR_ATIVOS_PROTEGIDOS))
  try {
    candidatos.push(path.join(process.cwd(), DIR_ATIVOS_PROTEGIDOS))
  } catch (_) {
    // sem cwd — ignora
  }
  for (const c of candidatos) {
    try {
      if (fs.existsSync(c)) return c
    } catch (_) {
      // ignora e tenta o próximo
    }
  }
  return null
}

/** `assets/aux.dat` efetivo, ou `null` (legado/cifragem pendente). */
function caminhoModeloCifrado(app) {
  const dir = dirAtivosProtegidos(app)
  if (!dir) return null
  const alvo = path.join(dir, NOME_MODELO_CIFRADO)
  try {
    if (fs.existsSync(alvo)) return alvo
  } catch (_) {
    // ignora
  }
  return null
}

/** Índice lexical efetivo: `assets/idx/` primeiro, legado como fallback. */
function caminhoIndiceProtegido(app) {
  const dir = dirAtivosProtegidos(app)
  if (dir) {
    const alvo = path.join(dir, DIR_INDICE_PROTEGIDO, NOME_INDICE_LEXICAL)
    try {
      if (fs.existsSync(alvo)) return alvo
    } catch (_) {
      // ignora e cai no legado
    }
  }
  return caminhoIndiceLexical(app)
}

/**
 * Modelo efetivo: `{caminho, formato}` com `formato` em
 * `'cifrado' | 'gguf' | null`. O worker (`lerModeloSeguro`) prefere o
 * cifrado; o GGUF legado mantém o modo mock/real de 06-04/06-05.
 */
function resolverModeloEfetivo(app) {
  const cifrado = caminhoModeloCifrado(app)
  if (cifrado) return { caminho: cifrado, formato: 'cifrado' }
  const gguf = caminhoModeloGguf(app)
  if (gguf) return { caminho: gguf, formato: 'gguf' }
  return { caminho: null, formato: null }
}

/**
 * Caminho do worker para `utilityProcess.fork()`.
 * Dev: `electron/dist/ia-worker.cjs` (copiado pelo esbuild) ou a fonte
 * `electron/ia/ia-worker.cjs`. Prod: junto ao bundle (dentro do asar para o
 * JS — `fork()` de `.cjs` puro funciona no asar; binários nativos ficam em
 * `app.asar.unpacked` via `asarUnpack`, ver `package.json`).
 */
function resolverWorkerPath(app) {
  const dirAqui = typeof __dirname === 'string' ? __dirname : process.cwd()
  const desempacotado = String(dirAqui).includes('app.asar')
    ? path.join(String(dirAqui).replace('app.asar', 'app.asar.unpacked'), 'ia-worker.cjs')
    : null
  const candidatos = [
    path.join(dirAqui, 'ia-worker.cjs'),
    desempacotado,
    app ? path.join(app.getAppPath(), 'electron', 'dist', 'ia-worker.cjs') : null,
    app ? path.join(app.getAppPath(), 'electron', 'ia', 'ia-worker.cjs') : null,
  ].filter(Boolean)
  for (const c of candidatos) {
    try {
      if (fs.existsSync(c)) {
        console.log(`[ia] worker resolvido: ${c}`)
        return c
      }
    } catch (_) {
      // ignora e tenta o próximo
    }
  }
  console.warn(`[ia] worker não encontrado; usando fallback ${candidatos[0]}`)
  return candidatos[0]
}

module.exports = {
  NOME_GGUF,
  NOME_MODELO_CIFRADO,
  DIR_ATIVOS_PROTEGIDOS,
  DIR_INDICE_PROTEGIDO,
  ehEmpacotado,
  raizProjetoDev,
  dirRecursosIa,
  raizProjeto,
  caminhoIndiceLexical,
  caminhoManifestHash,
  caminhoBaseIa,
  caminhoModeloGguf,
  caminhoDirModelo,
  descobrirGgufEfetivo,
  perfilModeloEfetivo,
  dirAtivosProtegidos,
  caminhoModeloCifrado,
  caminhoIndiceProtegido,
  resolverModeloEfetivo,
  resolverWorkerPath,
}
