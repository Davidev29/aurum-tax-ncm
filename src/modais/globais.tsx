/**
 * Modais globais: **Empresas**, **Configurações** (emitente + base) e a
 * edição genérica de registros das tabelas auxiliares.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { fmtCnpj } from '@/domain/services/format'
import { baixarModeloEmpresas } from '@/infrastructure/exporters/relatorios'
import { contarTodos } from '@/infrastructure/db/schema'
import { AUX_META, DOCUMENTOS_AUX, type CampoAux } from '@/application/aux-meta'
import { ehBackup, montarBackup, restaurarBackup, type Backup } from '@/application/backup'
import { normalizarCor, processarLogo } from '@/application/emitente'
import { ARQUIVOS_BASE } from '@/application/base'
import type { Emitente } from '@/domain/entities'
import { EMITENTE_PADRAO } from '@/domain/entities'
import type { DadosCnpjBrasilApi } from '@/infrastructure/receita/brasilapi'
import { useBase } from '@/store/base'
import { confirmar } from '@/store/dialogo'
import { useAuxiliares } from '@/store/auxiliares'
import { useSessao } from '@/store/sessao'
import { useUi, toast } from '@/store/ui'
import { Area, BarraProgresso, Btn, Campo, Check, Modal, Painel, Texto } from '@/ui/kit'
import { ModalCalculadora } from './pagina'

/* ------------------------------------------------------------- empresas --- */

function ModalEmpresas({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const empresas = useSessao((s) => s.empresas)
  const ativa = useSessao((s) => s.ativa)
  const criar = useSessao((s) => s.criar)
  const criarPorCnpj = useSessao((s) => s.criarPorCnpj)
  const importarLoteCnpjs = useSessao((s) => s.importarLoteCnpjs)
  const selecionar = useSessao((s) => s.selecionar)
  const excluir = useSessao((s) => s.excluir)
  const importar = useSessao((s) => s.importar)

  const [aba, setAba] = useState<'cnpj' | 'lote'>('cnpj')
  const [cnpj, setCnpj] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [preview, setPreview] = useState<DadosCnpjBrasilApi | null>(null)
  const [manual, setManual] = useState(false)
  const [razao, setRazao] = useState('')
  const [fantasia, setFantasia] = useState('')
  const [loteTexto, setLoteTexto] = useState('')
  const [loteProg, setLoteProg] = useState<{ feito: number; total: number } | null>(null)
  const [loteResumo, setLoteResumo] = useState<string | null>(null)
  const [filtro, setFiltro] = useState('')
  const inputArquivo = useRef<HTMLInputElement>(null)

  const lista = useMemo(() => {
    const f = filtro.trim().toLowerCase()
    if (!f) return empresas
    return empresas.filter((e) =>
      `${e.razaoSocial} ${e.cnpj ?? ''} ${e.fantasia ?? ''}`.toLowerCase().includes(f),
    )
  }, [empresas, filtro])

  const enviar = async () => {
    const ok = await criar({ razaoSocial: razao, cnpj, fantasia })
    if (ok) {
      setRazao('')
      setCnpj('')
      setFantasia('')
    }
  }

  /** Busca o CNPJ na BrasilAPI e mostra o preview para confirmação. */
  const buscar = async () => {
    setBuscando(true)
    setPreview(null)
    try {
      const { buscarCnpj } = await import('@/infrastructure/receita/brasilapi')
      const dados = await buscarCnpj(cnpj)
      setPreview(dados)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setBuscando(false)
    }
  }

  const confirmarCadastro = async () => {
    const ok = await criarPorCnpj(cnpj)
    if (ok) {
      setCnpj('')
      setPreview(null)
    }
  }

  /** Lote: extrai CNPJs do texto, busca na BrasilAPI e grava idempotente. */
  const enviarLote = async () => {
    const { extrairCnpjsDeTexto } = await import('@/infrastructure/receita/brasilapi')
    const cnpjs = extrairCnpjsDeTexto(loteTexto)
    if (!cnpjs.length) {
      toast('Nenhum CNPJ de 14 dígitos encontrado no texto.', 'warn')
      return
    }
    setLoteProg({ feito: 0, total: cnpjs.length })
    setLoteResumo(null)
    try {
      const r = await importarLoteCnpjs(cnpjs, (feito, total) => setLoteProg({ feito, total }))
      const partes = [`${r.novas} nova(s)`]
      if (r.atualizadas) partes.push(`${r.atualizadas} atualizada(s)`)
      if (r.erros) partes.push(`${r.erros} erro(s) — veja o toast`)
      setLoteResumo(partes.join(' · '))
      setLoteTexto('')
      toast(`Lote: ${partes.join(' · ')}.`, r.erros ? 'warn' : 'ok')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setLoteProg(null)
    }
  }

  const escolherArquivo = async (file: File | null) => {
    if (!file) return
    try {
      const n = await importar(file)
      toast(`${n} empresa(s) importada(s).`, 'ok')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'err')
    }
  }

  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo="Empresas"
      subtitulo="Cadastre pelo CNPJ — buscamos os dados na BrasilAPI."
      largura="max-w-2xl"
      rodape={
        <Btn onClick={onFechar} variante="primary">
          Concluir
        </Btn>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {(['cnpj', 'lote'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setAba(t)}
              className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                aba === t
                  ? 'bg-white text-brand-700 shadow-card dark:bg-slate-900 dark:text-brand-300'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
              }`}
            >
              {t === 'cnpj' ? '🔍 Por CNPJ' : '📋 Em lote'}
            </button>
          ))}
        </div>

        {aba === 'cnpj' ? (
          <Painel className="p-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="flex-1">
                <Texto
                  mask="cnpj"
                  value={cnpj}
                  onChange={(e) => {
                    setCnpj(e.target.value)
                    setPreview(null)
                  }}
                  placeholder="CNPJ — 00.000.000/0000-00"
                  grande
                  mono
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void buscar()
                  }}
                />
              </div>
              <Btn variante="primary" onClick={() => void buscar()}>
                {buscando ? '⏳ Buscando…' : '🔍 Buscar'}
              </Btn>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400">
              Razão social, endereço e contatos vêm da BrasilAPI. IE/IM são completados
              ao importar SPED/XML.
            </p>

            {preview ? (
              <div className="mt-3 animate-fade-up rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-xs dark:border-emerald-900 dark:bg-emerald-950/30">
                <div className="font-bold">{preview.razaoSocial}</div>
                {preview.fantasia ? <div className="text-slate-500">{preview.fantasia}</div> : null}
                <div className="mt-1 font-mono text-[11px] text-slate-500">
                  {[preview.endereco, preview.cidade && preview.uf ? `${preview.cidade}/${preview.uf}` : preview.cidade, preview.cep]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                <div className="mt-2">
                  <Btn variante="primary" tam="sm" onClick={() => void confirmarCadastro()}>
                    ✓ Confirmar cadastro
                  </Btn>
                </div>
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => setManual((m) => !m)}
              className="mt-3 text-[11px] font-semibold text-slate-400 hover:text-brand-600"
            >
              {manual ? '▾ Ocultar cadastro manual' : '▸ Sem internet? Cadastrar manualmente'}
            </button>
            {manual ? (
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Campo label="Razão social" obrigatorio className="sm:col-span-2">
                  <Texto value={razao} onChange={(e) => setRazao(e.target.value)} placeholder="Razão social *" />
                </Campo>
                <Campo label="CNPJ">
                  <Texto mask="cnpj" value={cnpj} onChange={(e) => setCnpj(e.target.value)} placeholder="00.000.000/0000-00" />
                </Campo>
                <Campo label="Nome fantasia">
                  <Texto value={fantasia} onChange={(e) => setFantasia(e.target.value)} placeholder="Nome fantasia" />
                </Campo>
                <div className="sm:col-span-2">
                  <Btn variante="primary" tam="sm" onClick={() => void enviar()}>
                    Cadastrar empresa
                  </Btn>
                </div>
              </div>
            ) : null}
          </Painel>
        ) : (
          <Painel className="p-4">
            <span className="field-label">CNPJs (um por linha, ou cole da planilha)</span>
            <Area
              rows={4}
              value={loteTexto}
              onChange={(e) => setLoteTexto(e.target.value)}
              placeholder={'11.222.333/0001-81\n04.252.011/0001-10\n…'}
              className="font-mono text-xs"
            />
            {loteProg ? (
              <div className="mt-2">
                <BarraProgresso
                  pct={Math.round((loteProg.feito / Math.max(1, loteProg.total)) * 100)}
                  etapa={`Buscando ${Math.min(loteProg.feito, loteProg.total)} de ${loteProg.total}…`}
                />
              </div>
            ) : null}
            {loteResumo ? <p className="mt-2 text-xs font-semibold text-emerald-600">{loteResumo}</p> : null}
            <div className="mt-2 flex flex-wrap gap-2">
              <Btn variante="primary" tam="sm" onClick={() => void enviarLote()}>
                🔍 Buscar e cadastrar
              </Btn>
              <Btn tam="sm" onClick={() => inputArquivo.current?.click()}>
                📥 Planilha CSV/XLSX
              </Btn>
              <Btn
                tam="sm"
                onClick={() => {
                  baixarModeloEmpresas()
                  toast('Modelo baixado.', 'ok')
                }}
              >
                ⬇ Modelo
              </Btn>
            </div>
            <input
              ref={inputArquivo}
              type="file"
              accept=".csv,.xls,.xlsx,.txt"
              className="hidden"
              onChange={(e) => void escolherArquivo(e.target.files?.[0] ?? null)}
            />
          </Painel>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold">Empresas cadastradas</h3>
            <input
              className="field field-sm w-44"
              placeholder="Buscar…"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
            />
          </div>
          <div className="modal-scroll scroll-elegante max-h-56 space-y-2 pr-1">
            {lista.length === 0 ? (
              <div className="rounded-xl bg-slate-50 p-6 text-center text-xs text-slate-500 dark:bg-slate-950/40">
                {filtro ? 'Nenhum resultado.' : 'Nenhuma empresa cadastrada ainda.'}
              </div>
            ) : (
              lista.map((e) => {
              const ehAtiva = ativa?.id === e.id
              return (
                <div
                  key={e.id}
                  className={`card-hover flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5 ${
                    ehAtiva
                      ? 'border-brand-500 bg-brand-50/70 dark:border-aurum-800 dark:bg-brand-900/20'
                      : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{e.razaoSocial}</span>
                      {ehAtiva ? (
                        <span className="pill bg-brand-600 text-white">ATIVA</span>
                      ) : null}
                      {e.regimeTributario === 'simples' || e.regimeTributario === 'mei' ? (
                        <span
                          className="pill bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                          title={
                            e.regimeTributario === 'mei'
                              ? 'MEI — notas não transferem crédito de IBS/CBS'
                              : 'Simples Nacional — notas não transferem crédito de IBS/CBS'
                          }
                        >
                          {e.regimeTributario === 'mei' ? 'MEI' : 'Simples'}
                        </span>
                      ) : null}
                    </div>
                    <div className="font-mono text-[11px] text-slate-400">
                      {e.cnpj ? fmtCnpj(e.cnpj) : 'sem CNPJ'}
                      {e.fantasia ? ` · ${e.fantasia}` : ''}
                    </div>
                  </div>
                  {ehAtiva ? (
                    <span className="rounded-lg bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                      ✓ Em uso
                    </span>
                  ) : (
                    <Btn
                      tam="sm"
                      variante="primary"
                      onClick={async () => {
                        await selecionar(e.id ?? null)
                        toast('Empresa ativa definida.', 'ok')
                        onFechar()
                      }}
                    >
                      Selecionar
                    </Btn>
                  )}
                  <Btn
                    tam="sm"
                    variante="danger"
                    onClick={() => {
                      void (async () => {
                        const ok = await confirmar(
                          'Excluir empresa?',
                          `A empresa "${e.razaoSocial}" será removida. Os produtos vinculados ficarão sem empresa.`,
                          { icone: '🗑', confirmar: 'Excluir', perigo: true },
                        )
                        if (!ok) return
                        void excluir(e.id ?? -1)
                      })()
                    }}
                  >
                    🗑
                  </Btn>
                </div>
              )
            })
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

/* -------------------------------------------------------------- config --- */

function Contador({ rotulo, valor }: { rotulo: string; valor: number | string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-950/40">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{rotulo}</div>
      <div className="num font-mono text-sm font-bold">{valor}</div>
    </div>
  )
}

function ModalConfig({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const status = useBase((s) => s.status)
  const progresso = useBase((s) => s.progresso)
  const recarregarStatus = useBase((s) => s.recarregar)
  const resemear = useBase((s) => s.resemear)
  const restaurarPadrao = useBase((s) => s.restaurar)
  const apagarBase = useBase((s) => s.apagar)
  const importarBase = useBase((s) => s.importar)
  const emitente = useSessao((s) => s.emitente)
  const persistirEmitente = useSessao((s) => s.persistirEmitente)

  const [contagens, setContagens] = useState<Record<string, number>>({})
  // Começa do padrão em vez de `null`: se o emitente ainda não carregou da
  // sessão, o modal continua utilizável e assume o salvo assim que chegar.
  const [form, setForm] = useState<Emitente>({ ...EMITENTE_PADRAO })
  const [cor, setCor] = useState('#0f215c')
  const [mostrarPreview, setMostrarPreview] = useState(false)
  const [aba, setAba] = useState<'emitente' | 'base' | 'backup'>('emitente')
  const [buscandoCnpj, setBuscandoCnpj] = useState(false)
  const inputBase = useRef<HTMLInputElement>(null)
  const inputBackup = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!aberto) return
    void contarTodos().then(setContagens)
    void recarregarStatus()
  }, [aberto, recarregarStatus])

  useEffect(() => {
    if (emitente) {
      setForm({ ...EMITENTE_PADRAO, ...emitente })
      setCor(emitente.cor || '#0f215c')
    }
  }, [emitente])

  const campo = <K extends keyof Emitente>(nome: K, valor: Emitente[K]) =>
    setForm((f) => ({ ...f, [nome]: valor }))

  const salvarEmitente = async () => {
    const corFinal = normalizarCor(cor) ?? '#0f215c'
    await persistirEmitente({ ...form, cor: corFinal })
    sessionStorage.removeItem('aurum_preview_pendente')
    toast('Emitente salvo.', 'ok')
  }

  /** Puxa razão social, endereço e contatos da BrasilAPI pelo CNPJ digitado. */
  const buscarEmitente = async () => {
    setBuscandoCnpj(true)
    try {
      const { buscarCnpj } = await import('@/infrastructure/receita/brasilapi')
      const d = await buscarCnpj(form.cnpj)
      setForm((f) => ({
        ...f,
        razaoSocial: d.razaoSocial || f.razaoSocial,
        endereco: d.endereco || f.endereco,
        cidade: d.cidade && d.uf ? `${d.cidade}/${d.uf}` : d.cidade || f.cidade,
        cep: d.cep || f.cep,
        telefone: d.telefone || f.telefone,
        email: d.email || f.email,
      }))
      toast('Dados do emitente completados via BrasilAPI.', 'ok')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setBuscandoCnpj(false)
    }
  }

  const importarJson = async (file: File | null) => {
    if (!file) return
    try {
      const json = JSON.parse(await file.text())
      const ok = await importarBase(json, file.name)
      if (ok) void contarTodos().then(setContagens)
    } catch (e) {
      toast(`Erro ao ler o JSON: ${e instanceof Error ? e.message : String(e)}`, 'err')
    }
  }

  const baixarBackup = async () => {
    const b = await montarBackup()
    const blob = new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `backup_aurum_tax_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    toast('Backup gerado.', 'ok')
  }

  const restaurarBackupArquivo = async (file: File | null) => {
    if (!file) return
    try {
      const dado: unknown = JSON.parse(await file.text())
      if (!ehBackup(dado)) {
        toast('Arquivo de backup inválido.', 'err')
        return
      }
      const ok = await confirmar(
        'Restaurar backup?',
        'Substituir TODA a base atual pelo backup?',
        { icone: '⬆', confirmar: 'Restaurar', perigo: true },
      )
      if (!ok) return
      await restaurarBackup(dado as Backup)
      await useAuxiliares.getState().recarregarTudo()
      await useSessao.getState().iniciar()
      void contarTodos().then(setContagens)
      toast('Backup restaurado.', 'ok')
    } catch (e) {
      toast(`Erro ao restaurar: ${e instanceof Error ? e.message : String(e)}`, 'err')
    }
  }

  // O formulário nasce do padrão (nunca `null`): o modal abre mesmo antes
  // da sessão concluir o carregamento do emitente salvo.
  // Compacto: `max-w-2xl` + abas + scroll elegante (antes era `max-w-4xl`
  // com todas as seções empilhadas numa página longa).
  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo="Configurações"
      subtitulo="Emitente dos relatórios, base tributária e backup"
      largura="max-w-2xl"
      rodape={
        <>
          <Btn onClick={onFechar}>Fechar</Btn>
          <Btn variante="primary" onClick={() => void salvarEmitente()}>
            💾 Salvar emitente
          </Btn>
        </>
      }
    >
      <div className="mb-3 flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
        {(
          [
            ['emitente', '🏷 Emitente'],
            ['base', '🧱 Base'],
            ['backup', '💾 Backup'],
          ] as const
        ).map(([t, rotulo]) => (
          <button
            key={t}
            type="button"
            onClick={() => setAba(t)}
            className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              aba === t
                ? 'bg-white text-brand-700 shadow-card dark:bg-slate-900 dark:text-brand-300'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
            }`}
          >
            {rotulo}
          </button>
        ))}
      </div>
      <div className="space-y-4">
        {aba === 'emitente' ? (
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-wide text-slate-500">
            Emitente (timbrado dos PDFs)
            <span
              className={`pill ${
                form.razaoSocial
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                  : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
              }`}
            >
              {form.razaoSocial ? 'configurado' : 'não configurado'}
            </span>
          </h3>
          <div className="mb-2 flex flex-col gap-2 sm:flex-row">
            <div className="flex-1">
              <Texto mask="cnpj" mono value={form.cnpj} onChange={(e) => campo('cnpj', e.target.value)} placeholder="CNPJ — buscar na BrasilAPI" />
            </div>
            <Btn tam="sm" onClick={() => void buscarEmitente()}>
              {buscandoCnpj ? '⏳ Buscando…' : '🔍 Puxar dados'}
            </Btn>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Campo label="Razão social" className="sm:col-span-2">
              <Texto
                value={form.razaoSocial}
                onChange={(e) => campo('razaoSocial', e.target.value)}
                placeholder="Aurum Bit Labs & Studios LTDA"
              />
            </Campo>
            <Campo label="Inscrição estadual">
              <Texto value={form.ie} onChange={(e) => campo('ie', e.target.value)} />
            </Campo>
            <Campo label="Endereço" dica="IE completada via SPED/XML">
              <Texto value={form.endereco} onChange={(e) => campo('endereco', e.target.value)} />
            </Campo>
            <Campo label="Cidade/UF">
              <Texto value={form.cidade} onChange={(e) => campo('cidade', e.target.value)} />
            </Campo>
            <Campo label="CEP">
              <Texto value={form.cep} onChange={(e) => campo('cep', e.target.value)} />
            </Campo>
            <Campo label="Telefone">
              <Texto value={form.telefone} onChange={(e) => campo('telefone', e.target.value)} />
            </Campo>
            <Campo label="E-mail">
              <Texto value={form.email} onChange={(e) => campo('email', e.target.value)} />
            </Campo>
            <Campo label="Site" className="sm:col-span-2">
              <Texto value={form.site} onChange={(e) => campo('site', e.target.value)} />
            </Campo>
            <Campo label="Rodapé do relatório" className="sm:col-span-2">
              <Texto
                value={form.rodape}
                onChange={(e) => campo('rodape', e.target.value)}
                placeholder="(vazio = razão social)"
              />
            </Campo>
            <Campo label="Cor de destaque">
              <div className="flex gap-2">
                <input
                  type="color"
                  value={cor}
                  onChange={(e) => setCor(e.target.value)}
                  className="h-10 w-12 cursor-pointer rounded border border-[var(--line)] bg-transparent p-1"
                />
                <Texto value={cor} onChange={(e) => setCor(e.target.value)} className="field-mono" />
              </div>
            </Campo>
            <Campo label="Logo (PNG/JPG até 3 MB)">
              <div className="logo-drop flex items-center gap-2 rounded-xl p-2.5">
                {form.logo ? (
                  <img src={form.logo} alt="Logo" className="h-12 w-auto max-w-[8rem] object-contain" />
                ) : null}
                <div className="flex flex-wrap gap-1.5">
                  <Btn
                    tam="sm"
                    onClick={() => {
                      const input = document.createElement('input')
                      input.type = 'file'
                      input.accept = 'image/*'
                      input.onchange = async () => {
                        const f = input.files?.[0]
                        if (!f) return
                        try {
                          campo('logo', await processarLogo(f))
                        } catch (e) {
                          toast(e instanceof Error ? e.message : String(e), 'warn')
                        }
                      }
                      input.click()
                    }}
                  >
                    Enviar
                  </Btn>
                  {form.logo ? <Btn tam="sm" onClick={() => campo('logo', null)}>✕</Btn> : null}
                  <Btn tam="sm" onClick={() => setMostrarPreview(true)}>
                    👁 Ver
                  </Btn>
                </div>
              </div>
            </Campo>
          </div>
        </section>
        ) : null}

        {aba === 'base' ? (
        <section>
          <h3 className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">
            Base tributária
          </h3>
          <Painel className="p-3">
            <div className="grid grid-cols-3 gap-1.5">
              <Contador rotulo="NCM" valor={status?.ncm ?? '—'} />
              <Contador rotulo="CST" valor={status?.cst ?? '—'} />
              <Contador rotulo="cClassTrib" valor={status?.cstClassTrib ?? '—'} />
              <Contador rotulo="Referência" valor={status?.referencia ?? '—'} />
              <Contador rotulo="Nomenclatura" valor={status?.nomenclatura ?? '—'} />
              <Contador rotulo="NBS" valor={status?.nbs ?? '—'} />
              <Contador rotulo="CFOP" valor={contagens.cfop ?? '—'} />
              <Contador rotulo="CST ICMS" valor={contagens.cstIcms ?? '—'} />
              <Contador rotulo="PIS/COFINS" valor={contagens.cstPisCofins ?? '—'} />
              <Contador rotulo="Empresas" valor={contagens.empresas ?? '—'} />
              <Contador rotulo="Produtos" valor={contagens.produtos ?? '—'} />
              <Contador
                rotulo="Origem"
                valor={status?.embutida ? 'embutida' : status?.ultimaImportacao ? 'importada' : '—'}
              />
            </div>

            {progresso ? (
              <div className="mt-2">
                <BarraProgresso pct={progresso.pct} etapa={progresso.etapa} />
              </div>
            ) : null}

            <div className="mt-2 flex flex-wrap gap-1.5">
              <Btn tam="sm" onClick={() => inputBase.current?.click()}>⬆ Importar JSON</Btn>
              <Btn
                tam="sm"
                onClick={() => {
                  void (async () => {
                    const ok = await confirmar(
                      'Reler base embutida?',
                      'Reler a base embutida e substituir os dados atuais?',
                      { icone: '🔄', confirmar: 'Reler base' },
                    )
                    if (ok) void resemear()
                  })()
                }}
              >
                🔄 Reler base
              </Btn>
              <Btn
                tam="sm"
                onClick={() => {
                  void (async () => {
                    const ok = await confirmar(
                      'Restaurar padrão?',
                      'Restaurar a base padrão embutida?',
                      { icone: '♻', confirmar: 'Restaurar' },
                    )
                    if (ok) void restaurarPadrao()
                  })()
                }}
              >
                ♻ Padrão
              </Btn>
              <Btn
                tam="sm"
                onClick={() => {
                  void (async () => {
                    const ok = await confirmar(
                      'Apagar base importada?',
                      'Apagar a base importada (NCM, CST, cClassTrib, Nomenclatura, NBS)? ' +
                        'Empresas, produtos, CFOP, CST ICMS e PIS/COFINS serão mantidos.',
                      { icone: '🗑', confirmar: 'Apagar', perigo: true },
                    )
                    if (ok) void apagarBase().then(() => void contarTodos().then(setContagens))
                  })()
                }}
              >
                🗑 Apagar
              </Btn>
            </div>

            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
              Aceita <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">reforma_tributaria_por_ncm.json</code>,{' '}
              <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">Tabela_NCM_Vigente_*.json</code> e{' '}
              <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">classificacao_tributaria.json</code>.
              O mesmo conteúdo já vem embutido ({ARQUIVOS_BASE.join(' · ')}).
            </p>

            <input
              ref={inputBase}
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => void importarJson(e.target.files?.[0] ?? null)}
            />
          </Painel>
        </section>
        ) : null}

        {aba === 'backup' ? (
        <section>
          <h3 className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">
            Backup e restauração
          </h3>
          <Painel className="space-y-2 p-3">
            <p className="text-[11px] leading-relaxed text-slate-400">
              O backup inclui empresas, produtos, notas XML e o emitente num único JSON.
            </p>
            <div className="flex flex-wrap gap-1.5">
              <Btn tam="sm" variante="danger" onClick={() => void baixarBackup()}>
                ⬇ Backup completo
              </Btn>
              <Btn tam="sm" onClick={() => inputBackup.current?.click()}>⬆ Restaurar backup</Btn>
            </div>
            <input
              ref={inputBackup}
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => void restaurarBackupArquivo(e.target.files?.[0] ?? null)}
            />
          </Painel>
        </section>
        ) : null}
      </div>

      <Modal
        aberto={mostrarPreview}
        onFechar={() => setMostrarPreview(false)}
        titulo="Pré-visualização do timbrado"
        largura="max-w-3xl"
      >
        <div className="rounded-lg border border-[var(--line)] bg-white p-6 text-slate-800 shadow-card">
          <div className="h-3 w-full rounded" style={{ background: cor }} />
          <div className="mt-4 flex gap-4">
            {form.logo ? <img src={form.logo} alt="" className="h-20 w-auto max-w-[12rem] object-contain" /> : null}
            <div className="min-w-0">
              <div className="text-lg font-bold">{form.razaoSocial || 'Aurum Tax NCM'}</div>
              <div className="text-xs text-slate-500">
                {form.cnpj ? `CNPJ ${fmtCnpj(form.cnpj)}` : ''}
                {form.ie ? ` · IE ${form.ie}` : ''}
              </div>
              <div className="text-xs text-slate-500">
                {[form.endereco, form.cidade, form.cep].filter(Boolean).join(' · ')}
              </div>
              <div className="text-xs text-slate-500">
                {[form.telefone, form.email, form.site].filter(Boolean).join(' · ')}
              </div>
            </div>
          </div>
          <div className="mt-6 space-y-2 text-xs text-slate-400">
            <div className="h-2 w-full rounded bg-slate-100" />
            <div className="h-2 w-11/12 rounded bg-slate-100" />
            <div className="h-2 w-4/5 rounded bg-slate-100" />
          </div>
          <div className="mt-8 text-center text-[10px] text-slate-400">
            {form.rodape || form.razaoSocial || 'Aurum Tax NCM'}
          </div>
        </div>
      </Modal>
    </Modal>
  )
}

/* ------------------------------------------------- edição de auxiliares --- */

function ModalAuxEdicao({ aberto }: { aberto: boolean }) {
  const edicao = useAuxiliares((s) => s.edicao)
  const salvar = useAuxiliares((s) => s.salvar)
  const fechar = useAuxiliares((s) => s.fecharEdicao)
  const [dados, setDados] = useState<Record<string, unknown>>({})
  const [erros, setErros] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (edicao) {
      setDados(edicao.dados)
      setErros({})
    }
  }, [edicao])

  if (!edicao || !aberto) return null
  const { meta, chaveOriginal } = edicao
  const editando = chaveOriginal != null

  const set = (nome: string, valor: unknown) => setDados((d) => ({ ...d, [nome]: valor }))

  const enviar = async () => {
    const obrigatorios = meta.campos.filter((c) => c.required)
    const faltando: Record<string, boolean> = {}
    for (const c of obrigatorios) {
      const v = dados[c.nome]
      if (v == null || String(v).trim() === '') faltando[c.nome] = true
    }
    setErros(faltando)
    if (Object.keys(faltando).length) {
      const primeiro = obrigatorios.find((c) => faltando[c.nome])
      toast(`Campo "${primeiro?.label}" é obrigatório.`, 'warn')
      return
    }
    const ok = await salvar(dados)
    if (ok) fecharTudo()
  }

  const colSpan = (c: CampoAux) => (c.colSpan === 2 ? 'sm:col-span-2' : '')

  /** Fecha o modal de edição e o host global ao mesmo tempo. */
  const fecharTudo = () => {
    fechar()
    useUi.getState().abrirModal(null)
  }

  return (
    <Modal
      aberto={aberto}
      onFechar={fecharTudo}
      titulo={editando ? `Editar ${meta.singular}` : `Novo ${meta.singular}`}
      subtitulo={meta.titulo}
      largura="max-w-2xl"
      rodape={
        <>
          {editando ? (
            <Btn
              variante="danger"
              onClick={() => {
                void (async () => {
                  const ok = await confirmar(
                    `Excluir ${meta.singular}?`,
                    `Excluir este registro de ${meta.titulo}?`,
                    { icone: '🗑', confirmar: 'Excluir', perigo: true },
                  )
                  if (!ok) return
                  void useAuxiliares.getState().excluir(meta.tipo, chaveOriginal)
                  fecharTudo()
                })()
              }}
            >
              🗑 Excluir
            </Btn>
          ) : null}
          <Btn onClick={fecharTudo}>Cancelar</Btn>
          <Btn variante="primary" onClick={() => void enviar()}>
            Salvar
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {meta.campos.map((c) => {
          const bloqueado = editando && c.readOnlyOnEdit
          if (c.tipo === 'boolean') {
            return (
              <div key={c.nome} className={colSpan(c)}>
                <Check
                  label={c.label}
                  checked={Boolean(dados[c.nome])}
                  onChange={(e) => set(c.nome, e.target.checked ? 1 : 0)}
                />
              </div>
            )
          }
          if (c.tipo === 'docs') {
            const docs = (dados.docs ?? {}) as Record<string, boolean>
            return (
              <div key={c.nome} className="sm:col-span-2">
                <span className="field-label">{c.label}</span>
                <div className="flex flex-wrap gap-3 rounded-lg border border-[var(--line)] p-3">
                  {DOCUMENTOS_AUX.map((d) => (
                    <Check
                      key={d}
                      label={d}
                      checked={Boolean(docs[d])}
                      onChange={(e) => set('docs', { ...docs, [d]: e.target.checked })}
                    />
                  ))}
                </div>
              </div>
            )
          }
          if (c.tipo === 'select') {
            return (
              <Campo key={c.nome} label={c.label} obrigatorio={c.required} className={colSpan(c)}>
                <select
                  className="field"
                  value={String(dados[c.nome] ?? '')}
                  onChange={(e) => set(c.nome, e.target.value)}
                >
                  <option value="">— selecione —</option>
                  {(c.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </Campo>
            )
          }
          if (c.tipo === 'textarea') {
            return (
              <Campo key={c.nome} label={c.label} obrigatorio={c.required} className={colSpan(c)}>
                <Area
                  rows={3}
                  className={erros[c.nome] ? 'field-err' : ''}
                  value={String(dados[c.nome] ?? '')}
                  onChange={(e) => set(c.nome, e.target.value)}
                />
              </Campo>
            )
          }
          if (c.tipo === 'number') {
            return (
              <Campo key={c.nome} label={c.label} obrigatorio={c.required} className={colSpan(c)}>
                <input
                  type="number"
                  step="0.01"
                  className={`field field-mono ${erros[c.nome] ? 'field-err' : ''}`}
                  value={dados[c.nome] == null ? '' : String(dados[c.nome])}
                  onChange={(e) =>
                    set(c.nome, e.target.value === '' ? null : Number(e.target.value))
                  }
                />
              </Campo>
            )
          }
          return (
            <Campo key={c.nome} label={c.label} obrigatorio={c.required} className={colSpan(c)}>
              <Texto
                mask={c.mask}
                mono={c.mono}
                maxLength={c.maxLength}
                readOnly={bloqueado}
                className={`${erros[c.nome] ? 'field-err' : ''} ${bloqueado ? 'opacity-60' : ''}`}
                value={String(dados[c.nome] ?? '')}
                onChange={(e) => set(c.nome, e.target.value)}
              />
            </Campo>
          )
        })}
      </div>
    </Modal>
  )
}

/* --------------------------------------------------------------- raiz ----- */

export function ModaisGlobais() {
  const modal = useUi((s) => s.modal)
  const fechar = () => useUi.getState().abrirModal(null)

  return (
    <>
      <ModalEmpresas aberto={modal === 'empresas'} onFechar={fechar} />
      <ModalConfig aberto={modal === 'config'} onFechar={fechar} />
      <ModalAuxEdicao aberto={modal === 'auxEdit'} />
      <ModalCalculadora />
    </>
  )
}

/** Dispara o modal de edição de um registro auxiliar. */
export function abrirEdicaoAux(tipo: keyof typeof AUX_META, chave?: string | number | null): void {
  const st = useAuxiliares.getState()
  if (chave == null) st.novo(tipo)
  else st.editar(tipo, chave)
  useUi.getState().abrirModal('auxEdit')
}
