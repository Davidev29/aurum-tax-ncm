/**
 * Casca da aplicação: navegação lateral, cabeçalho com sessão da empresa,
 * alternância de tema, toasts e os modais globais.
 *
 * A view ativa é renderizada pelo `App`; aqui ficam apenas o que é comum a
 * todas as telas (SPEC §10.1).
 */
import { useEffect, useState } from 'react'
import { BANNER_KEY, LINK_LC214 } from '@/domain/constants'
import { fmtCnpj } from '@/domain/services/format'
import { bridge } from '@/infrastructure/bridge'
import { dispararExportacao } from '@/infrastructure/pdf/menu-exportacao'
import { useSessao } from '@/store/sessao'
import { useUi, VIEW_META, type ViewId } from '@/store/ui'
import { Btn, Icone, Toasts, type NomeIcone } from './kit'
import { MarcaSidebar } from './Marca'
import { DialogoGlass } from './dialogos'
import { ModaisGlobais } from '@/modais/globais'

/** Grupos do menu lateral — a ordem e os ícones espelham o sistema anterior. */
const NAV: { secao?: string; itens: { id: ViewId; icone: NomeIcone; rotulo: string }[] }[] = [
  {
    secao: 'Trabalho',
    itens: [
      { id: 'calculadora', icone: 'calculadora', rotulo: 'Calculadora' },
      { id: 'consulta', icone: 'lupa', rotulo: 'Consulta NCM' },
      { id: 'classificar', icone: 'documento', rotulo: 'Classificação' },
      { id: 'lote', icone: 'pasta', rotulo: 'Classificação em lote' },
      { id: 'sped', icone: 'documento', rotulo: 'SPED Fiscal' },
      { id: 'nfe', icone: 'nota', rotulo: 'Notas Fiscais (XML)' },
    ],
  },
  {
    secao: 'Dados',
    itens: [
      { id: 'produtos', icone: 'caixa', rotulo: 'Produtos' },
      { id: 'auxiliares', icone: 'livros', rotulo: 'Tabelas auxiliares' },
    ],
  },
  {
    secao: 'Referência',
    itens: [{ id: 'legislacao', icone: 'documento', rotulo: 'Legislação' }],
  },
]

function Sidebar() {
  const view = useUi((s) => s.view)
  const trocarView = useUi((s) => s.trocarView)
  const aberta = useUi((s) => s.sidebarAberta)
  const fechar = useUi((s) => s.fecharSidebar)

  // Drawer móvel: `Escape` fecha sem obrigar o usuário a mirar o botão ✕.
  useEffect(() => {
    if (!aberta) return
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fechar()
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [aberta, fechar])

  return (
    <>
      {aberta ? (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm lg:hidden"
          onClick={fechar}
          aria-hidden="true"
        />
      ) : null}
      <aside
        id="menu-lateral"
        aria-label="Menu principal"
        className={`fixed inset-y-0 left-0 z-50 flex w-[min(16rem,82vw)] flex-col border-r border-[var(--line)] bg-[var(--surface-2)] shadow-drawer transition-transform duration-200 lg:static lg:h-full lg:w-64 lg:translate-x-0 lg:shadow-none ${
          aberta ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-[var(--line)] px-4 py-4">
          <MarcaSidebar />
          <button
            type="button"
            onClick={fechar}
            className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden"
            aria-label="Fechar menu"
          >
            ✕
          </button>
        </div>

        {/* O menu é fixo: só rola internamente se não couber na altura da
            janela (desktop com zoom alto / viewport curto). */}
        <nav
          className="scroll-elegante min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-4"
          aria-label="Seções do sistema"
        >
          {NAV.map((grupo) => (
            <div key={grupo.secao}>
              <div className="mb-2 mt-4 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 first:mt-0 dark:text-slate-500">
                {grupo.secao}
              </div>
              {grupo.itens.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="side-btn"
                  data-active={view === item.id}
                  aria-current={view === item.id ? 'page' : undefined}
                  onClick={() => trocarView(item.id)}
                >
                  <span className="side-ico" aria-hidden="true">
                    <Icone nome={item.icone} />
                  </span>
                  <span className="truncate">{item.rotulo}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-[var(--line)] px-4 py-3 text-[10px] leading-relaxed text-slate-400">
          <a
            href={LINK_LC214}
            target="_blank"
            rel="noreferrer"
            className="font-semibold hover:text-brand-600 hover:underline dark:hover:text-aurum-300"
          >
            LC 214/2025 · CST · cClassTrib
          </a>
          <br />
          Aurum Bit Labs &amp; Studios LTDA
        </div>
      </aside>
    </>
  )
}

function ChipEmpresa() {
  const ativa = useSessao((s) => s.ativa)
  const limpar = useSessao((s) => s.limparSessao)
  if (!ativa) return null
  return (
    <div className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-2)] py-1 pl-3 pr-1.5 text-xs shadow-card">
      <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-100 text-[10px] font-black text-brand-700 dark:bg-brand-950 dark:text-brand-300">
        {ativa.razaoSocial.slice(0, 1).toUpperCase()}
      </span>
      <span className="max-w-[10rem] truncate font-semibold">{ativa.razaoSocial}</span>
      <span className="hidden text-slate-400 sm:inline">{ativa.cnpj ? fmtCnpj(ativa.cnpj) : 'sem CNPJ'}</span>
      <button
        type="button"
        onClick={() => void limpar()}
        className="grid h-6 w-6 place-items-center rounded-full text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
        title="Remover empresa ativa"
      >
        ✕
      </button>
    </div>
  )
}

function BannerSemEmpresa() {
  const ativa = useSessao((s) => s.ativa)
  const abrirModal = useUi((s) => s.abrirModal)
  const [dispensado, setDispensado] = useState(
    () => sessionStorage.getItem(BANNER_KEY) === '1',
  )
  if (ativa || dispensado) return null
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-brand-200 bg-gradient-to-r from-brand-50 to-white px-4 py-2.5 text-xs text-brand-800 shadow-card dark:border-aurum-900 dark:from-brand-950/40 dark:to-slate-900 dark:text-brand-200">
      <span className="text-base">💡</span>
      <div className="min-w-[180px] flex-1">
        Você está no <strong>modo visualização</strong>. Selecione ou cadastre uma empresa para
        organizar seus produtos por cliente.
      </div>
      <div className="flex items-center gap-2">
        <Btn tam="sm" variante="primary" onClick={() => abrirModal('empresas')}>
          Escolher empresa
        </Btn>
        <button
          type="button"
          onClick={() => {
            sessionStorage.setItem(BANNER_KEY, '1')
            setDispensado(true)
          }}
          className="rounded-md p-1 text-brand-700 hover:bg-brand-100 dark:text-brand-300 dark:hover:bg-brand-900/40"
          title="Dispensar"
        >
          ✕
        </button>
      </div>
    </div>
  )
}

export function Layout({ children }: { children: React.ReactNode }) {
  const view = useUi((s) => s.view)
  const tema = useUi((s) => s.tema)
  const alternarTema = useUi((s) => s.alternarTema)
  const abrirModal = useUi((s) => s.abrirModal)
  const toggleSidebar = useUi((s) => s.toggleSidebar)
  const sidebarAberta = useUi((s) => s.sidebarAberta)
  const meta = VIEW_META[view]

  // Atalhos de teclado do menu nativo (Electron) — via canal IPC `menu:acao`.
  // No navegador (sem bridge) o menu nativo não existe e os atalhos são
  // acionados pelos próprios botões de cada tela.
  useEffect(() => {
    if (!bridge) return
    bridge.onMenu((acao) => {
      if (acao === 'abrir') abrirModal('config')
      if (acao === 'exportar') dispararExportacao(useUi.getState().view)
      if (acao === 'tema') alternarTema()
    })
  }, [abrirModal, alternarTema])

  return (
    <div className="flex h-dvh min-h-0 w-full overflow-hidden bg-[var(--surface)] text-[var(--ink)]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="z-30 shrink-0 border-b border-[var(--line)] bg-[var(--surface)]/90 backdrop-blur">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:gap-3 sm:px-6">
            <button
              type="button"
              onClick={toggleSidebar}
              className="btn btn-press btn-ghost btn-sm lg:hidden"
              aria-label="Abrir menu"
              aria-controls="menu-lateral"
              aria-expanded={sidebarAberta}
            >
              ☰
            </button>
            <div className="min-w-0 flex-1 basis-40">
              <h1 className="truncate text-base font-black tracking-tight sm:text-lg">{meta.titulo}</h1>
              <p className="hidden truncate text-xs text-slate-500 sm:block">{meta.subtitulo}</p>
            </div>
            <ChipEmpresa />
            <button
              type="button"
              onClick={() => abrirModal('empresas')}
              className="btn btn-press btn-ghost btn-sm"
              title="Empresas"
            >
              <Icone nome="empresa" className="h-5 w-5" /><span className="hidden sm:inline"> Empresas</span>
            </button>
            <button
              type="button"
              onClick={alternarTema}
              className="btn btn-press btn-ghost btn-sm text-lg leading-none"
              title="Alternar tema"
              aria-label={tema === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
            >
              {tema === 'dark' ? '☀' : '◐'}
            </button>
            <button
              type="button"
              onClick={() => abrirModal('config')}
              className="btn btn-press btn-ghost btn-sm text-lg leading-none"
              title="Configurações"
            >
              ⚙
            </button>
          </div>
        </header>

        {/* Única área com scroll: o menu e o cabeçalho permanecem fixos. */}
        <main
          id="conteudo"
          tabIndex={-1}
          className="scroll-elegante min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6"
        >
          <div key={view} className="mx-auto w-full max-w-[1400px] animate-fade-up">
            <BannerSemEmpresa />
            {children}
          </div>
        </main>
      </div>

      <ModaisGlobais />
      <DialogoGlass />
      <Toasts />
    </div>
  )
}
