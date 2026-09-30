/**
 * Processo principal do Electron — Aurum Tax NCM.
 *
 * Responsabilidades:
 *   - criar a janela principal (dev via Vite, produção via `dist/index.html`);
 *   - registrar os canais IPC consumidos por `window.aurum`
 *     (ver `electron/preload.ts` e `src/infrastructure/bridge.ts`);
 *   - montar o menu nativo, com atalhos de teclado e ações de tema/exportação.
 *
 * Este arquivo é compilado pelo esbuild (`electron/esbuild.mjs`), não pelo
 * `tsc` do projeto — o `tsconfig.json` raiz não inclui a pasta `electron/`.
 */

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  type MenuItemConstructorOptions,
} from 'electron'
import { existsSync, promises as fsp } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { autoUpdater } from 'electron-updater'

/** URL do servidor Vite, definida pelo script `dev:electron` (cross-env). */
const URL_DEV = process.env.VITE_DEV_SERVER_URL ?? ''

/**
 * Hosts oficiais autorizados para leitura interna de legislação.
 * (A tabela NCM/Siscomex foi removida: as bases agora viajam embutidas em
 * `dist/base` e são atualizadas junto com o programa via electron-updater.)
 */
const HOSTS_LEGISLACAO = new Set([
  'www.planalto.gov.br',
  'planalto.gov.br',
  'www4.planalto.gov.br',
  'www.cgibs.gov.br',
  'cgibs.gov.br',
])

/** Todos os hosts autorizados no canal `rede:buscar-texto`. */
const HOSTS_REDE = new Set([...HOSTS_LEGISLACAO])

/** Modo de desenvolvimento: existe servidor Vite ativo? */
const EM_DESENVOLVIMENTO = URL_DEV.length > 0

const TITULO = 'Aurum Tax NCM — Classificador Fiscal'
const URL_LC_214 = 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm'
const INDEX_PRODUCAO = path.join(__dirname, '../../dist/index.html')

/** Filtro de diálogo de arquivo no formato pedido pelo renderer. */
interface FiltroEscolha {
  nome: string
  extensoes: string[]
}

/** Mesmo filtro no formato esperado pelo Electron. */
interface FiltroElectron {
  name: string
  extensions: string[]
}

let janelaPrincipal: BrowserWindow | null = null

function mensagemDeErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro)
}

function semBarraFinal(valor: string): string {
  return valor.endsWith('/') ? valor.slice(0, -1) : valor
}

// ---------------------------------------------------------------------------
// Diretório base (arquivos de apoio da aplicação)
// ---------------------------------------------------------------------------

/**
 * Raiz dos arquivos base:
 *   - desenvolvimento: `<projeto>/public/base`;
 *   - produção: `resources/app.asar.unpacked/dist/base` (se existir),
 *     senão `<app>/dist/base` dentro do asar (leitura via fs do Electron).
 */
function diretorioBase(): string {
  if (!app.isPackaged) {
    return path.join(app.getAppPath(), 'public', 'base')
  }

  const candidatos = [
    path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'base'),
    path.join(app.getAppPath(), 'dist', 'base'),
  ]

  return candidatos.find((caminho) => existsSync(caminho)) ?? candidatos[1]
}

/**
 * Resolve um caminho relativo dentro do diretório base.
 * Recusa caminhos absolutos e qualquer tentativa de traversão (`..`).
 */
function resolverNoBase(caminhoRelativo: string): string {
  if (typeof caminhoRelativo !== 'string' || !caminhoRelativo.trim()) {
    throw new Error('Caminho do arquivo base não informado.')
  }

  const normalizado = caminhoRelativo.replace(/\\/g, '/')

  if (normalizado.startsWith('/') || /^[a-zA-Z]:/.test(normalizado)) {
    throw new Error(`Caminho absoluto não é permitido: "${caminhoRelativo}".`)
  }

  if (normalizado.split('/').some((parte) => parte === '..')) {
    throw new Error(`Acesso negado: "${caminhoRelativo}" sai do diretório base.`)
  }

  const base = path.resolve(diretorioBase())
  const completo = path.resolve(base, normalizado)

  if (completo !== base && !completo.startsWith(base + path.sep)) {
    throw new Error(`Acesso negado: "${caminhoRelativo}" sai do diretório base.`)
  }

  return completo
}

/** Converte os filtros do renderer para o formato do Electron. */
function paraFiltrosElectron(filtros?: FiltroEscolha[]): FiltroElectron[] {
  if (!Array.isArray(filtros)) return []

  return filtros
    .filter((f) => f && typeof f.nome === 'string' && Array.isArray(f.extensoes))
    .map((f) => ({
      name: f.nome,
      extensions: f.extensoes
        .map((extensao) => String(extensao).replace(/^\./, '').trim().toLowerCase())
        .filter(Boolean),
    }))
    .filter((f) => f.extensions.length > 0)
}

// ---------------------------------------------------------------------------
// Canais IPC (contrato com electron/preload.ts)
// ---------------------------------------------------------------------------

function registrarIpc(): void {
  /** `base:ler` — conteúdo UTF-8 de um arquivo relativo ao diretório base. */
  ipcMain.handle('base:ler', async (_evento, caminhoRelativo: string) => {
    const caminho = resolverNoBase(caminhoRelativo)
    try {
      return await fsp.readFile(caminho, 'utf8')
    } catch (erro) {
      throw new Error(
        `Não foi possível ler o arquivo base "${caminhoRelativo}": ${mensagemDeErro(erro)}`,
      )
    }
  })

  /** `base:ler-base64` — mesmo arquivo, transportado em base64. */
  ipcMain.handle('base:ler-base64', async (_evento, caminhoRelativo: string) => {
    const caminho = resolverNoBase(caminhoRelativo)
    try {
      const buffer = await fsp.readFile(caminho)
      return buffer.toString('base64')
    } catch (erro) {
      throw new Error(
        `Não foi possível ler o arquivo base "${caminhoRelativo}": ${mensagemDeErro(erro)}`,
      )
    }
  })

  /**
   * `rede:buscar-texto` — baixa HTML de norma oficial **dentro do sistema**
   * (modal de legislação).
   *
   * O renderer sofre restrição de CORS (o Planalto bloqueia `iframe` com
   * `X-Frame-Options`); aqui no processo principal o `fetch` do Node não tem
   * restrição de origem. Travas de segurança: só HTTPS, só hosts oficiais
   * (Planalto/CGIBS), sem fragmento, teto de 15 MB e timeout de 90 s.
   */
  ipcMain.handle('rede:buscar-texto', async (_evento, urlAlvo: string) => {
    if (typeof urlAlvo !== 'string' || !urlAlvo.trim()) {
      throw new Error('URL não informada para leitura da legislação.')
    }
    let u: URL
    try {
      u = new URL(urlAlvo.trim())
    } catch {
      throw new Error('URL inválida para leitura da legislação.')
    }
    if (u.protocol !== 'https:') throw new Error('Somente URLs HTTPS são permitidas.')
    const host = u.hostname.toLowerCase()
    if (!HOSTS_REDE.has(host)) {
      throw new Error(`Host não autorizado para leitura interna: "${u.hostname}".`)
    }
    u.hash = ''
    let resposta: Response
    try {
      resposta = await fetch(u.toString(), {
        signal: AbortSignal.timeout(90000),
        headers: {
          'User-Agent': 'AurumTaxNCM/1.0 (leitura de legislacao)',
          Accept: 'text/html,application/xhtml+xml,application/json,*/*',
        },
      })
    } catch (erro) {
      throw new Error(`Falha de rede ao buscar a norma: ${mensagemDeErro(erro)}`)
    }
    if (!resposta.ok) {
      const ra = resposta.headers.get('retry-after')
      // `status`/`retryAfter` extras nem sempre atravessam o IPC — o valor
      // vai também na mensagem para o renderer reconstruir o ErroHttpSiscomex.
      const detalheRa = ra ? `, Retry-After: ${String(ra).split(',')[0].trim()}` : ''
      const erro = new Error(`Documento indisponível (HTTP ${resposta.status}${detalheRa}).`)
      ;(erro as unknown as Record<string, unknown>).status = resposta.status
      if (ra) (erro as unknown as Record<string, unknown>).retryAfter = ra
      throw erro
    }
    const bruto = Buffer.from(await resposta.arrayBuffer())
    if (bruto.length > 15_000_000) {
      throw new Error('Documento grande demais para leitura dentro do sistema.')
    }
    // O Planalto serve em ISO-8859-1: `Response.text()` (UTF-8 forçado)
    // garlaria os acentos — decodifica pelo charset do `Content-Type`.
    const tipo = resposta.headers.get('content-type') ?? ''
    const charset = /charset=([^;]+)/i.exec(tipo)?.[1]?.trim().toLowerCase() ?? 'utf-8'
    const rotulo =
      charset.includes('8859') || charset.includes('latin') || charset.includes('1252')
        ? 'iso-8859-1'
        : 'utf-8'
    return {
      ok: true,
      status: resposta.status,
      urlFinal: resposta.url || u.toString(),
      contentType: tipo,
      texto: new TextDecoder(rotulo).decode(bruto),
    }
  })

  /** `arquivo:escolher` — abre o seletor de arquivo e devolve o conteúdo em base64. */
  ipcMain.handle(
    'arquivo:escolher',
    async (_evento, filtros: FiltroEscolha[]): Promise<{ caminho: string; nome: string; conteudo: string } | null> => {
      const filtrosElectron = paraFiltrosElectron(filtros)
      const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        ...(filtrosElectron.length ? { filters: filtrosElectron } : {}),
      })

      if (canceled || filePaths.length === 0) return null

      const caminho = filePaths[0]
      try {
        const buffer = await fsp.readFile(caminho)
        return { caminho, nome: path.basename(caminho), conteudo: buffer.toString('base64') }
      } catch (erro) {
        throw new Error(`Não foi possível ler o arquivo "${caminho}": ${mensagemDeErro(erro)}`)
      }
    },
  )

  /** `arquivo:escolher-pasta` — seleciona uma pasta (ou `null` se cancelado). */
  ipcMain.handle('arquivo:escolher-pasta', async (): Promise<string | null> => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    })
    return canceled || filePaths.length === 0 ? null : filePaths[0]
  })

  /** `arquivo:salvar` — grava conteúdo base64 no caminho escolhido pelo usuário. */
  ipcMain.handle(
    'arquivo:salvar',
    async (
      _evento,
      opcao: { nome?: string; conteudo?: string; filtro?: FiltroEscolha[] },
    ): Promise<string | null> => {
      if (!opcao || typeof opcao.conteudo !== 'string') {
        throw new Error('Conteúdo inválido para gravação.')
      }

      const nome =
        typeof opcao.nome === 'string' && opcao.nome.trim() ? opcao.nome.trim() : 'relatorio.txt'
      const filtrosElectron = paraFiltrosElectron(opcao.filtro)

      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: nome,
        ...(filtrosElectron.length ? { filters: filtrosElectron } : {}),
      })

      if (canceled || !filePath) return null

      try {
        await fsp.writeFile(filePath, Buffer.from(opcao.conteudo, 'base64'))
      } catch (erro) {
        throw new Error(`Não foi possível gravar "${filePath}": ${mensagemDeErro(erro)}`)
      }

      return filePath
    },
  )

  /** `xml:salvar` — guarda o XML da nota em `userData/xml/<cnpj>/<chave>.xml`. */
  ipcMain.handle(
    'xml:salvar',
    async (
      _evento,
      opcao: { cnpj?: string; chave?: string; conteudo?: string },
    ): Promise<string> => {
      const cnpj = String(opcao?.cnpj ?? '').replace(/\D/g, '')
      const chave = String(opcao?.chave ?? '').trim()
      const conteudo = String(opcao?.conteudo ?? '')
      if (!cnpj) throw new Error('CNPJ da empresa não informado para guardar o XML.')
      if (!/^\d{44}$/.test(chave)) throw new Error('Chave de acesso inválida para guardar o XML.')
      if (!conteudo) throw new Error('Conteúdo do XML vazio.')

      const relativo = `${cnpj}/${chave}.xml`
      const destino = resolverNoXml(relativo)
      await fsp.mkdir(path.dirname(destino), { recursive: true })
      try {
        await fsp.writeFile(destino, conteudo, 'utf8')
      } catch (erro) {
        throw new Error(`Não foi possível guardar o XML "${relativo}": ${mensagemDeErro(erro)}`)
      }
      return relativo
    },
  )

  /** `xml:ler` — lê um XML guardado (caminho relativo). */
  ipcMain.handle('xml:ler', async (_evento, caminhoRelativo: string): Promise<string> => {
    const caminho = resolverNoXml(caminhoRelativo)
    try {
      return await fsp.readFile(caminho, 'utf8')
    } catch (erro) {
      throw new Error(
        `Não foi possível ler o XML "${caminhoRelativo}": ${mensagemDeErro(erro)}`,
      )
    }
  })

  /** `xml:remover` — remove um XML guardado; inexistente não é erro. */
  ipcMain.handle('xml:remover', async (_evento, caminhoRelativo: string): Promise<void> => {
    const caminho = resolverNoXml(caminhoRelativo)
    try {
      await fsp.unlink(caminho)
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        throw new Error(
          `Não foi possível remover o XML "${caminhoRelativo}": ${mensagemDeErro(erro)}`,
        )
      }
    }
  })

  /** `atualizacao:versao` — versão instalada + plataforma (para a aba Atualização). */
  ipcMain.handle('atualizacao:versao', () => ({
    versao: app.getVersion(),
    empacotado: app.isPackaged,
  }))

  /** `atualizacao:verificar` — consulta o GitHub Releases (só no app instalado). */
  ipcMain.handle('atualizacao:verificar', async () => {
    if (!app.isPackaged) {
      return { disponivel: false, mensagem: 'Verificação disponível apenas no app instalado.' }
    }
    try {
      const r = await autoUpdater.checkForUpdates()
      const info = r?.updateInfo
      return {
        disponivel: autoUpdater.currentVersion.compare(info?.version ?? '') < 0,
        versao: info?.version ?? null,
        notas: notasVersao(info?.releaseNotes),
      }
    } catch (erro) {
      throw new Error(`Não foi possível verificar atualizações: ${mensagemDeErro(erro)}`)
    }
  })

  /** `atualizacao:baixar` — baixa a versão encontrada em background. */
  ipcMain.handle('atualizacao:baixar', async () => {
    if (!app.isPackaged) throw new Error('Download disponível apenas no app instalado.')
    try {
      await autoUpdater.downloadUpdate()
      return { ok: true }
    } catch (erro) {
      throw new Error(`Não foi possível baixar a atualização: ${mensagemDeErro(erro)}`)
    }
  })

  /** `atualizacao:instalar` — fecha o app e aplica a versão baixada. */
  ipcMain.handle('atualizacao:instalar', () => {
    if (!app.isPackaged) throw new Error('Instalação disponível apenas no app instalado.')
    autoUpdater.quitAndInstall(false, true)
    return { ok: true }
  })
}

/** Extrai texto das notas de release (string | array de releases). */
function notasVersao(notas: unknown): string | null {
  if (!notas) return null
  if (typeof notas === 'string') return notas.slice(0, 2000) || null
  if (Array.isArray(notas)) {
    const texto = notas
      .map((r) => (typeof r === 'string' ? r : (r as { note?: unknown })?.note))
      .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
      .join('\n\n')
    return texto.slice(0, 2000) || null
  }
  return null
}

// ---------------------------------------------------------------------------
// Auto-atualização do programa (electron-updater + GitHub Releases)
// ---------------------------------------------------------------------------

/**
 * As bases tributárias (NCM, CST, cClassTrib, nomenclatura) viajam embutidas
 * em `dist/base` — é aqui, na atualização do programa, que elas são renovadas.
 * Verificação automática 30 s após abrir + a cada 6 h; eventos seguem para o
 * renderer pelo canal `atualizacao:evento`.
 */
function configurarAtualizador(): void {
  if (!app.isPackaged) return
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  const enviar = (tipo: string, dados?: Record<string, unknown>) => {
    janelaPrincipal?.webContents.send('atualizacao:evento', { tipo, ...(dados ?? {}) })
  }

  autoUpdater.on('checking-for-update', () => enviar('verificando'))
  autoUpdater.on('update-available', (info) =>
    enviar('disponivel', { versao: info?.version ?? null, notas: notasVersao(info?.releaseNotes) }),
  )
  autoUpdater.on('update-not-available', () => enviar('em-dia'))
  autoUpdater.on('download-progress', (p) =>
    enviar('baixando', {
      pct: Math.round(p?.percent ?? 0),
      baixado: p?.transferred ?? 0,
      total: p?.total ?? 0,
    }),
  )
  autoUpdater.on('update-downloaded', (info) =>
    enviar('baixada', { versao: info?.version ?? null }),
  )
  autoUpdater.on('error', (erro) => enviar('erro', { mensagem: mensagemDeErro(erro) }))

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => undefined)
  }, 30_000)
  setInterval(
    () => {
      autoUpdater.checkForUpdates().catch(() => undefined)
    },
    6 * 60 * 60 * 1000,
  )
}

// ---------------------------------------------------------------------------
// Diretório de XMLs importados (userData — gravável e preservado no update)
// ---------------------------------------------------------------------------

/**
 * Raiz dos XMLs: `<userData>/xml` (`%APPDATA%` no Windows, equivalente nas
 * demais plataformas). A pasta de instalação (`.asar`/`Program Files`) é
 * somente-leitura — nunca é usada para dados.
 */
function diretorioXml(): string {
  return path.join(app.getPath('userData'), 'xml')
}

/**
 * Resolve um caminho relativo (`<cnpj>/<chave>.xml`) dentro do diretório de
 * XMLs, com a mesma trava anti-traversão do diretório base.
 */
function resolverNoXml(caminhoRelativo: string): string {
  if (typeof caminhoRelativo !== 'string' || !caminhoRelativo.trim()) {
    throw new Error('Caminho do XML não informado.')
  }
  const normalizado = caminhoRelativo.replace(/\\/g, '/')
  if (normalizado.startsWith('/') || /^[a-zA-Z]:/.test(normalizado)) {
    throw new Error(`Caminho absoluto não é permitido: "${caminhoRelativo}".`)
  }
  if (
    normalizado.split('/').some((parte) => parte === '..' || parte === '' || parte === '.')
  ) {
    throw new Error(`Acesso negado: "${caminhoRelativo}" sai do diretório de XMLs.`)
  }
  const base = path.resolve(diretorioXml())
  const completo = path.resolve(base, normalizado)
  if (completo !== base && !completo.startsWith(base + path.sep)) {
    throw new Error(`Acesso negado: "${caminhoRelativo}" sai do diretório de XMLs.`)
  }
  return completo
}

// ---------------------------------------------------------------------------
// Menu nativo
// ---------------------------------------------------------------------------

/** Envia uma ação de menu para a janela do renderer (canal `menu:acao`). */
function enviarAcaoMenu(acao: 'abrir' | 'exportar' | 'tema' | 'atualizar'): void {
  const destino = BrowserWindow.getFocusedWindow() ?? janelaPrincipal
  destino?.webContents.send('menu:acao', { acao })
}

function criarMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [{ role: 'appMenu' as const, label: app.name }]
      : []),
    {
      label: 'Arquivo',
      submenu: [
        { label: 'Abrir…', accelerator: 'CmdOrCtrl+O', click: () => enviarAcaoMenu('abrir') },
        {
          label: 'Exportar relatório…',
          accelerator: 'CmdOrCtrl+E',
          click: () => enviarAcaoMenu('exportar'),
        },
        { type: 'separator' },
        process.platform === 'darwin'
          ? { role: 'close', label: 'Fechar' }
          : { role: 'quit', label: 'Sair' },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Desfazer' },
        { role: 'redo', label: 'Refazer' },
        { type: 'separator' },
        { role: 'cut', label: 'Recortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        { type: 'separator' },
        { role: 'selectAll', label: 'Selecionar tudo' },
      ],
    },
    {
      label: 'Exibir',
      submenu: [
        { role: 'reload', label: 'Recarregar' },
        { role: 'toggleDevTools', label: 'Ferramentas do desenvolvedor' },
        { type: 'separator' },
        {
          label: 'Alternar tema',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => enviarAcaoMenu('tema'),
        },
      ],
    },
    {
      label: 'Janela',
      submenu: [
        { role: 'minimize', label: 'Minimizar' },
        {
          label: 'Maximizar/Restaurar',
          click: (_item, janela) => {
            if (!janela) return
            if (janela.isMaximized()) janela.unmaximize()
            else janela.maximize()
          },
        },
        { type: 'separator' },
        { role: 'close', label: 'Fechar' },
      ],
    },
    {
      label: 'Ajuda',
      submenu: [
        {
          label: 'Verificar atualizações…',
          click: () => enviarAcaoMenu('atualizar'),
        },
        { type: 'separator' },
        {
          label: 'Site da LC 214/2025',
          click: () => {
            void shell.openExternal(URL_LC_214)
          },
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---------------------------------------------------------------------------
// Janela principal
// ---------------------------------------------------------------------------

async function criarJanela(): Promise<void> {
  const janela = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#0b1220',
    title: TITULO,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      // Repassa a versão do app ao preload (lida em electron/preload.ts).
      additionalArguments: [`--aurum-versao=${app.getVersion()}`],
    },
  })

  janelaPrincipal = janela
  janela.setTitle(TITULO)

  // Ícone do aplicativo no Linux (Windows/macOS usam o do empacotador).
  // Candidatos: empacote (`build/`), fontes (`public/`) e saída web (`dist/`).
  if (process.platform === 'linux') {
    const candidatosIcone = [
      path.join(app.getAppPath(), 'build', 'icon.png'),
      path.join(app.getAppPath(), 'public', 'escudo.png'),
      path.join(app.getAppPath(), 'public', 'icone.png'),
      path.join(app.getAppPath(), 'dist', 'escudo.png'),
      path.join(app.getAppPath(), 'dist', 'icone.png'),
    ]
    const achado = candidatosIcone.find((c) => existsSync(c))
    if (achado) janela.setIcon(nativeImage.createFromPath(achado))
  }

  janela.once('ready-to-show', () => {
    janela.show()
    if (EM_DESENVOLVIMENTO) janela.webContents.openDevTools({ mode: 'detach' })
  })

  // Nenhuma nova janela é criada pelo renderer: links externos abrem no navegador.
  janela.webContents.setWindowOpenHandler(({ url: urlAlvo }) => {
    if (/^https?:\/\//i.test(urlAlvo)) void shell.openExternal(urlAlvo)
    return { action: 'deny' }
  })

  // Bloqueia navegação interna: só o servidor de dev (ou o próprio index) vale.
  janela.webContents.on('will-navigate', (evento, urlAlvo) => {
    const permitida = EM_DESENVOLVIMENTO
      ? semBarraFinal(urlAlvo) === semBarraFinal(URL_DEV)
      : semBarraFinal(urlAlvo) === semBarraFinal(pathToFileURL(INDEX_PRODUCAO).href)

    if (!permitida) evento.preventDefault()
  })

  janela.on('closed', () => {
    if (janelaPrincipal === janela) janelaPrincipal = null
  })

  if (EM_DESENVOLVIMENTO) {
    await janela.loadURL(URL_DEV)
  } else {
    await janela.loadFile(INDEX_PRODUCAO)
  }
}

// ---------------------------------------------------------------------------
// Ciclo de vida do aplicativo
// ---------------------------------------------------------------------------

const instanciaUnica = app.requestSingleInstanceLock()

if (!instanciaUnica) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!janelaPrincipal) return
    if (janelaPrincipal.isMinimized()) janelaPrincipal.restore()
    janelaPrincipal.focus()
  })

  app
    .whenReady()
    .then(async () => {
      registrarIpc()
      criarMenu()
      await criarJanela()
      configurarAtualizador()
    })
    .catch((erro) => {
      console.error(`Falha ao iniciar o Aurum Tax NCM: ${mensagemDeErro(erro)}`)
      app.quit()
    })

  // macOS: reabrir a janela ao clicar no ícone do Dock.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void criarJanela()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

export {}
