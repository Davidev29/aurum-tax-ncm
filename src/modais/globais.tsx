/**
 * Modais globais: **Empresas**, **Configurações** (emitente + bases de dados +
 * CFF Sync + atualização do programa + backup) e a edição genérica de registros
 * das tabelas auxiliares.
 *
 * As bases tributárias (NCM, CST, cClassTrib, nomenclatura) podem ser atualizadas
 * manualmente na aba "Bases" (uma base por vez, com validação) e o programa em
 * si é renovado pela atualização geral (electron-updater).
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { fmtCnpj } from '@/domain/services/format'
import { baixarModeloEmpresas } from '@/infrastructure/exporters/relatorios'
import { contarTodos } from '@/infrastructure/db/schema'
import { AUX_META, DOCUMENTOS_AUX, type CampoAux } from '@/application/aux-meta'
import { ehBackup, montarBackup, restaurarBackup, type Backup } from '@/application/backup'
import { SISTEMAS_CFF } from '@/domain/constants/cff-apis'
import { fingerprintBase, infoBase, type TipoBase } from '@/infrastructure/base/formatos'
import {
  normalizarAnexosCff,
  normalizarClassTribCff,
  normalizarNomenclatura,
  normalizarReferencia,
} from '@/infrastructure/base/normalizacao'
import { normalizarCor, processarLogo } from '@/application/emitente'
import { statusSincronizacao, coberturaTabelasProduto } from '@/application/cff-sync'
import { baixarAtualizacao, instalarAtualizacao, versaoInstalada, verificarAtualizacaoManual } from '@/application/atualizacao'
import { bridge, type EventoAtualizacao } from '@/infrastructure/bridge'
import type { Emitente } from '@/domain/entities'
import { EMITENTE_PADRAO } from '@/domain/entities'
import type { DadosCnpjBrasilApi } from '@/infrastructure/receita/brasilapi'
import { useBase } from '@/store/base'
import { confirmar } from '@/store/dialogo'
import { useAuxiliares } from '@/store/auxiliares'
import { useSessao } from '@/store/sessao'
import { useUi, toast } from '@/store/ui'
import { Area, BarraProgresso, Btn, Campo, Check, Modal, Painel, Texto, useAcaoTatil } from '@/ui/kit'
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

  // Giro nos botões de ação: BrasilAPI, cadastro e importação demoram —
  // o usuário nunca fica sem feedback entre o toque e o toast.
  const acaoEnviar = useAcaoTatil(enviar)
  const acaoConfirmar = useAcaoTatil(confirmarCadastro)
  const acaoEnviarLote = useAcaoTatil(enviarLote)
  const acaoArquivo = useAcaoTatil(escolherArquivo)

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
              <Btn variante="primary" carregando={buscando} onClick={() => void buscar()}>
                {buscando ? 'Buscando…' : '🔍 Buscar'}
              </Btn>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400">
              Razão social, endereço e contatos vêm da BrasilAPI. IE/IM são completados
              ao importar XML.
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
                  <Btn
                    variante="primary"
                    tam="sm"
                    carregando={acaoConfirmar.carregando}
                    onClick={acaoConfirmar.executar}
                  >
                    {acaoConfirmar.carregando ? 'Cadastrando…' : '✓ Confirmar cadastro'}
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
                  <Btn
                    variante="primary"
                    tam="sm"
                    carregando={acaoEnviar.carregando}
                    onClick={acaoEnviar.executar}
                  >
                    {acaoEnviar.carregando ? 'Cadastrando…' : 'Cadastrar empresa'}
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
              <Btn
                variante="primary"
                tam="sm"
                carregando={acaoEnviarLote.carregando}
                onClick={acaoEnviarLote.executar}
              >
                {acaoEnviarLote.carregando ? 'Buscando…' : '🔍 Buscar e cadastrar'}
              </Btn>
              <Btn tam="sm" carregando={acaoArquivo.carregando} onClick={() => inputArquivo.current?.click()}>
                {acaoArquivo.carregando ? 'Importando…' : '📥 Planilha CSV/XLSX'}
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
              onChange={(e) => acaoArquivo.executar(e.target.files?.[0] ?? null)}
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

/** Milhares em pt-BR (`15156` → `15.156`); `—` quando ausente. */
function fmtQtd(valor: number | null | undefined): string {
  return valor == null ? '—' : valor.toLocaleString('pt-BR')
}

/** Cartão de estatística da aba CFF Sync (ícone + número grande). */
function StatTabela({ icone, rotulo, valor, chip }: { icone: string; rotulo: string; valor: number | string; chip: string }) {
  return (
    <div className="card-hover rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-2.5 shadow-card">
      <div className="flex items-center gap-1.5">
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-sm ${chip}`}>{icone}</span>
        <span className="truncate text-[10px] font-bold uppercase tracking-wide text-slate-500">{rotulo}</span>
      </div>
      <div className="num mt-1.5 font-mono text-lg font-black tracking-tight">{valor}</div>
    </div>
  )
}

/** Aparência por status do serviço CFF (ponto da timeline + selo). */
const STATUS_CFF: Record<string, { rotulo: string; ponto: string; selo: string }> = {
  ok: {
    rotulo: '✓ Atualizado',
    ponto: 'bg-emerald-500 ring-emerald-200 dark:ring-emerald-900',
    selo: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  },
  certificado: {
    rotulo: '🔐 Certificado',
    ponto: 'bg-amber-500 ring-amber-200 dark:ring-amber-900',
    selo: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  },
  erro: {
    rotulo: '✕ Erro',
    ponto: 'bg-red-500 ring-red-200 dark:ring-red-900',
    selo: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  },
  nunca: {
    rotulo: '○ Nunca',
    ponto: 'bg-slate-300 ring-slate-200 dark:bg-slate-600 dark:ring-slate-800',
    selo: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  },
}

/** Cobertura local das tabelas por sistema (totais + negados + data). Leitura local, sem rede. */
function CoberturaTabelas() {
  const [cobertura, setCobertura] = useState<Awaited<ReturnType<typeof coberturaTabelasProduto>> | null>(null)

  useEffect(() => {
    void coberturaTabelasProduto().then(setCobertura)
  }, [])

  if (!cobertura?.length) {
    return (
      <p className="mt-2 text-[10px] text-slate-400">
        Nenhuma tabela por DFe carregada — os cartões de classificação não exibem selos de DFe.
      </p>
    )
  }

  return (
    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {cobertura.map((c) => (
        <div key={c.sistema} className="card-hover overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] shadow-card">
          <div className="h-1 w-full bg-gradient-to-r from-brand-500 to-aurum-500" />
          <div className="p-2.5">
            <div className="flex items-center gap-1.5">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-100 text-[11px] font-black text-brand-700 dark:bg-brand-950/60 dark:text-brand-300">
                {c.sistema.slice(0, 2)}
              </span>
              <span className="truncate text-xs font-black">{c.sistema}</span>
            </div>
            <div className="num mt-1.5 font-mono text-base font-black">
              {c.total.toLocaleString('pt-BR')}{' '}
              <span className="text-[10px] font-bold text-slate-400">cClassTrib</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-slate-400">
              <span>📅 {c.sincronizadoEm ? new Date(c.sincronizadoEm).toLocaleDateString('pt-BR') : '—'}</span>
              {c.negados ? (
                <span className="rounded-full bg-red-100 px-1.5 py-0.5 font-bold text-red-700 dark:bg-red-950/60 dark:text-red-300">
                  ⛔ {c.negados}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

/* --------------------------------- bases de dados (importação manual) --- */

/* Ordem fixa de aplicação (último escritor vence por store): vínculos e
   nomenclatura primeiro; referências por último para que a fonte mais
   completa (API CFF, 164) prevaleça sobre os auxiliares da Reforma (132).
   Catálogos e versionados fecham a fila. */
const ORDEM_APLICACAO: TipoBase[] = [
  'reforma',
  'nomenclatura',
  'referencia-dfe',
  'classtrib-cff',
  'anexos-cff',
  'credito-presumido-cff',
  'indoper-cff',
  'classprod-cff',
]

interface ArquivoReconhecido {
  id: number
  nome: string
  tamanho: number
  tipo: TipoBase
  totalPrevisto: number
  sistema: string
  json: unknown
  estado: 'pronto' | 'aplicado' | 'erro'
  mensagem: string | null
}

let seqArquivoBase = 0

/** Prévia pura (sem gravar): quantos registros aproveitáveis o arquivo tem. */
function previaPorTipo(tipo: TipoBase, json: unknown): number {
  switch (tipo) {
    case 'nomenclatura':
      return normalizarNomenclatura(json).length
    case 'reforma': {
      const j = json as Record<string, unknown>
      const l = (Array.isArray(j.NCM) ? j.NCM : Array.isArray(j.ncm) ? j.ncm : []) as unknown[]
      return l.length
    }
    case 'referencia-dfe':
      return normalizarReferencia(json).length
    case 'classtrib-cff':
      return normalizarClassTribCff(json).referencia.length
    case 'anexos-cff':
      return normalizarAnexosCff(json).length
    case 'credito-presumido-cff':
    case 'indoper-cff':
    case 'classprod-cff':
      return Array.isArray(json) ? json.length : 0
    default:
      return 0
  }
}

function NucleoImportacaoBases() {
  const progresso = useBase((s) => s.progresso)
  const [arquivos, setArquivos] = useState<ArquivoReconhecido[]>([])
  const [lendo, setLendo] = useState(false)
  const [aplicando, setAplicando] = useState(false)
  const [resultado, setResultado] = useState<string | null>(null)
  const inputMultiplo = useRef<HTMLInputElement | null>(null)

  const escolherVarios = async (lista: FileList | null) => {
    if (!lista?.length) return
    setLendo(true)
    setResultado(null)
    const novos: ArquivoReconhecido[] = []
    for (const file of Array.from(lista)) {
      try {
        const texto = await file.text()
        let json: unknown
        try {
          json = JSON.parse(texto)
        } catch {
          throw new Error('não é um JSON válido')
        }
        const tipo = fingerprintBase(json)
        if (tipo === 'desconhecido') {
          throw new Error('estrutura não reconhecida para nenhuma base')
        }
        const total = previaPorTipo(tipo, json)
        if (!total) {
          throw new Error('válido, mas sem registros aproveitáveis')
        }
        novos.push({
          id: ++seqArquivoBase,
          nome: file.name,
          tamanho: file.size,
          tipo,
          totalPrevisto: total,
          sistema: '',
          json,
          estado: 'pronto',
          mensagem: null,
        })
      } catch (e) {
        toast(`"${file.name}" rejeitado: ${e instanceof Error ? e.message : String(e)}.`, 'err')
      }
    }
    if (novos.length) {
      setArquivos((atual) => [...atual, ...novos])
      toast(`${novos.length} arquivo(s) reconhecido(s). Confira o sistema dos produtos por DFe e clique em Atualizar.`, 'ok')
    }
    setLendo(false)
    if (inputMultiplo.current) inputMultiplo.current.value = ''
  }

  const remover = (id: number) => {
    setArquivos((atual) => atual.filter((a) => a.id !== id))
  }

  const definirSistema = (id: number, sistema: string) => {
    setArquivos((atual) => atual.map((a) => (a.id === id ? { ...a, sistema } : a)))
  }

  const pendentes = [...arquivos]
    .filter((a) => a.estado === 'pronto')
    .sort((a, b) => ORDEM_APLICACAO.indexOf(a.tipo) - ORDEM_APLICACAO.indexOf(b.tipo))
  const atualizando = aplicando || progresso !== null
  const faltaSistema = pendentes.some((a) => infoBase(a.tipo).precisaSistema && !a.sistema)

  const atualizar = async () => {
    if (!pendentes.length) {
      toast('Selecione ao menos um arquivo para atualizar.', 'warn')
      return
    }
    if (faltaSistema) {
      toast('Informe o sistema (NFCom, NFAg, NF3e ou NFGas) em cada arquivo de produtos por DFe.', 'warn')
      return
    }
    const ok = await confirmar(
      'Atualizar bases de dados?',
      `Serão importados ${pendentes.length} arquivo(s), um por vez, na ordem: ${pendentes.map((a) => infoBase(a.tipo).rotulo).join(' → ')}. Recomenda-se ter um backup (aba Backup). Continuar?`,
      { icone: '🗂', confirmar: 'Atualizar bases' },
    )
    if (!ok) return
    setAplicando(true)
    setResultado(null)
    const aplicados: string[] = []
    try {
      for (const arq of pendentes) {
        const importado = await useBase.getState().importar(arq.json, arq.nome, arq.sistema || undefined)
        if (!importado) {
          throw new Error(`"${arq.nome}" (${infoBase(arq.tipo).rotulo}): importação recusada — veja o aviso na tela.`)
        }
        aplicados.push(`${infoBase(arq.tipo).rotulo} (${arq.totalPrevisto.toLocaleString('pt-BR')})`)
        setArquivos((atual) => atual.map((a) => (a.id === arq.id ? { ...a, estado: 'aplicado' as const } : a)))
      }
      await useBase.getState().recarregar()
      setArquivos((atual) => atual.filter((a) => a.estado !== 'aplicado'))
      setResultado(`Bases atualizadas: ${aplicados.join(' · ')}. Classificações de produtos e notas foram revalidadas.`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setResultado(`Interrompido após ${aplicados.length} base(s). ${msg} As anteriores continuam valendo.`)
      toast(msg, 'err')
    } finally {
      setAplicando(false)
    }
  }

  return (
    <div>
      <h3 className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">
        🗂 Atualização manual das bases
      </h3>
      <p className="mb-2 text-[11px] leading-relaxed text-slate-400">
        Selecione <strong>todos os arquivos de uma vez</strong> — o sistema reconhece cada um pelo
        conteúdo, mostra o destino e importa <strong>um por vez</strong> na ordem correta. Nada é
        gravado até você clicar em <strong>Atualizar bases de dados</strong>.
      </p>
      <div className="mb-3 rounded-xl border border-dashed border-[var(--line)] p-2.5 text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
        <strong>Arquivos aceitos:</strong> Tabela NCM vigente (Siscomex) · classificação tributária
        (portal DFe <em>ou</em> API CFF <span className="font-mono">classTrib.json</span>) · Reforma por
        NCM/NBS (vínculos) · anexos · crédito presumido · locais de operação · produtos por DFe
        (exige informar o sistema: NFCom, NFAg, NF3e ou NFGas).
      </div>

      <div className="mb-2 flex flex-wrap gap-1.5">
        <Btn tam="sm" variante="primary" disabled={lendo || atualizando} onClick={() => inputMultiplo.current?.click()}>
          {lendo ? '⏳ Reconhecendo…' : '📂 Selecionar arquivos'}
        </Btn>
        {arquivos.length ? (
          <Btn
            tam="sm"
            disabled={atualizando}
            onClick={() => {
              setArquivos([])
              setResultado(null)
            }}
          >
            Limpar todos
          </Btn>
        ) : null}
      </div>
      <input
        ref={inputMultiplo}
        type="file"
        accept=".json,application/json"
        multiple
        className="hidden"
        onChange={(e) => void escolherVarios(e.target.files)}
      />

      {arquivos.length ? (
        <div className="grid grid-cols-1 gap-2">
          {pendentes.map((a) => {
            const info = infoBase(a.tipo)
            return (
              <div key={a.id} className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 shadow-card">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[11px] font-bold" title={a.nome}>
                      {a.nome} · {(a.tamanho / 1024 / 1024).toFixed(2)} MB
                    </div>
                    <div className="mt-0.5 text-[10px] text-slate-400">
                      → {info.rotulo} · {a.totalPrevisto.toLocaleString('pt-BR')} registros · destino: {info.destino}
                    </div>
                  </div>
                  <span className="pill bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                    ✓ reconhecido
                  </span>
                  <Btn tam="sm" onClick={() => remover(a.id)} disabled={atualizando}>
                    ✕
                  </Btn>
                </div>
                {info.precisaSistema ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-bold text-amber-700 dark:text-amber-300">
                      Sistema de origem (o arquivo não informa):
                    </span>
                    <select
                      className="field field-sm max-w-[12rem]"
                      value={a.sistema}
                      disabled={atualizando}
                      onChange={(e) => definirSistema(a.id, e.target.value)}
                      aria-label={`Sistema de origem de ${a.nome}`}
                    >
                      <option value="">— selecione —</option>
                      {(SISTEMAS_CFF as readonly string[]).map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : (
        <p className="rounded-xl bg-slate-100 p-3 text-center text-[11px] text-slate-400 dark:bg-slate-800">
          Nenhum arquivo selecionado. Baixe as fontes em <strong>Legislação → Portais para atualização</strong>.
        </p>
      )}

      {progresso ? (
        <div className="mt-3">
          <BarraProgresso etapa={progresso.etapa} pct={progresso.pct} />
        </div>
      ) : null}

      {resultado ? (
        <p className="mt-2 rounded-lg bg-slate-100 p-2 text-[11px] leading-relaxed text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {resultado}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Btn variante="primary" carregando={atualizando} disabled={!pendentes.length} onClick={() => void atualizar()}>
          {atualizando ? 'Atualizando…' : `🗂 Atualizar bases de dados${pendentes.length ? ` (${pendentes.length})` : ''}`}
        </Btn>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
        A ordem de aplicação é fixa (vínculos → nomenclatura → referências → anexos → catálogos;
        a fonte mais completa vence por tabela) e cada base só é apagada depois que a nova foi
        validada. Se algo falhar, as anteriores ficam valendo. Após importar, produtos e notas XML
        são revalidados automaticamente.
      </p>
    </div>
  )
}

function ModalConfig({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const status = useBase((s) => s.status)
  const recarregarStatus = useBase((s) => s.recarregar)
  const emitente = useSessao((s) => s.emitente)
  const persistirEmitente = useSessao((s) => s.persistirEmitente)

  // Começa do padrão em vez de `null`: se o emitente ainda não carregou da
  // sessão, o modal continua utilizável e assume o salvo assim que chegar.
  const [form, setForm] = useState<Emitente>({ ...EMITENTE_PADRAO })
  const [cor, setCor] = useState('#0f215c')
  const [mostrarPreview, setMostrarPreview] = useState(false)
  const [contagens, setContagens] = useState<Record<string, number>>({})
  const [aba, setAba] = useState<'emitente' | 'bases' | 'backup' | 'atualizacao'>('emitente')
  const [buscandoCnpj, setBuscandoCnpj] = useState(false)
  const [cffStatus, setCffStatus] = useState<Awaited<ReturnType<typeof statusSincronizacao>> | null>(null)
  const [versao, setVersao] = useState<string>('—')
  const [verificando, setVerificando] = useState(false)
  const [versaoNova, setVersaoNova] = useState<string | null>(null)
  const [notasVersao, setNotasVersao] = useState<string | null>(null)
  const [baixando, setBaixando] = useState<{ pct: number } | null>(null)
  const [atualizacaoPronta, setAtualizacaoPronta] = useState<string | null>(null)
  const inputBackup = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!aberto) return
    void contarTodos().then(setContagens)
    void recarregarStatus()
    void statusSincronizacao().then(setCffStatus)
    void versaoInstalada().then(setVersao)
  }, [aberto, recarregarStatus])

  // Eventos do auto-updater (verificação automática em background no instalado).
  useEffect(() => {
    if (!aberto || !bridge) return
    bridge.onAtualizacao((ev: EventoAtualizacao) => {
      if (ev.tipo === 'disponivel') {
        setVersaoNova(ev.versao ?? 'nova versão')
        setNotasVersao(ev.notas ?? null)
        toast(`⬇ Nova versão do programa disponível: ${ev.versao ?? ''}. Veja a aba Atualização.`, 'ok')
      } else if (ev.tipo === 'baixando') {
        setBaixando({ pct: ev.pct })
      } else if (ev.tipo === 'baixada') {
        setBaixando(null)
        setAtualizacaoPronta(ev.versao ?? 'nova versão')
        toast('✅ Atualização baixada. Reinicie para aplicar.', 'ok')
      } else if (ev.tipo === 'erro') {
        setBaixando(null)
        setVerificando(false)
      } else if (ev.tipo === 'em-dia') {
        setVerificando(false)
      } else if (ev.tipo === 'verificando') {
        setVerificando(true)
      }
    })
    return () => bridge?.onAtualizacao(() => undefined)
  }, [aberto])

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

  // Giro nos botões de ação (salvar, backup, restauração).
  const acaoSalvarEmitente = useAcaoTatil(salvarEmitente)
  const acaoBackup = useAcaoTatil(baixarBackup)
  const acaoRestaurar = useAcaoTatil(restaurarBackupArquivo)

  // O formulário nasce do padrão (nunca `null`): o modal abre mesmo antes
  // da sessão concluir o carregamento do emitente salvo.
  // Compacto: `max-w-2xl` + abas + scroll elegante (antes era `max-w-4xl`
  // com todas as seções empilhadas numa página longa).
  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo="Configurações"
      subtitulo="Emitente, bases de dados, sincronização CFF, atualização do programa e backup"
      largura="max-w-2xl"
      rodape={
        <>
          <Btn onClick={onFechar}>Fechar</Btn>
          <Btn
            variante="primary"
            carregando={acaoSalvarEmitente.carregando}
            onClick={acaoSalvarEmitente.executar}
          >
            {acaoSalvarEmitente.carregando ? 'Salvando…' : '💾 Salvar emitente'}
          </Btn>
        </>
      }
    >
      <div className="mb-3 flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
        {(
          [
            ['emitente', '🏷 Emitente'],
            ['bases', '🗂 Bases de dados'],
            ['atualizacao', '🔄 Atualização'],
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
            <Btn tam="sm" carregando={buscandoCnpj} onClick={() => void buscarEmitente()}>
              {buscandoCnpj ? 'Buscando…' : '🔍 Puxar dados'}
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
            <Campo label="Endereço" dica="IE completada via XML">
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

        {aba === 'bases' ? (
        <section>
          <div className="mb-3 overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 via-teal-700 to-cyan-800 p-4 text-white shadow-card dark:from-emerald-950 dark:via-teal-950 dark:to-cyan-950 dark:ring-1 dark:ring-emerald-900">
            <div className="flex flex-wrap items-center gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/20 text-2xl shadow-inner backdrop-blur">
                🛡
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-black tracking-tight">Tabelas tributárias em vigor</div>
                <div className="mt-0.5 text-[11px] leading-relaxed text-emerald-50/90 dark:text-slate-300">
                  Base gerada em{' '}
                  <strong>{status?.geradoEm ? new Date(status.geradoEm).toLocaleDateString('pt-BR') : '—'}</strong>
                  {' '}· programa v{versao} · dados atualizados manualmente abaixo
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAba('atualizacao')}
                className="btn-press shrink-0 rounded-xl bg-white/95 px-3 py-1.5 text-xs font-black text-emerald-800 shadow transition hover:bg-white"
              >
                🔄 Atualização
              </button>
            </div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatTabela icone="🔢" rotulo="NCM" valor={fmtQtd(status?.ncm)} chip="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" />
            <StatTabela icone="🧾" rotulo="CST" valor={fmtQtd(status?.cst)} chip="bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300" />
            <StatTabela icone="🏷" rotulo="cClassTrib" valor={fmtQtd(status?.cstClassTrib)} chip="bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300" />
            <StatTabela icone="📚" rotulo="Referência" valor={fmtQtd(status?.referencia)} chip="bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300" />
            <StatTabela icone="📖" rotulo="Nomenclatura" valor={fmtQtd(status?.nomenclatura)} chip="bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300" />
            <StatTabela icone="🧮" rotulo="NBS" valor={fmtQtd(status?.nbs)} chip="bg-cyan-100 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300" />
            <StatTabela icone="🏢" rotulo="Empresas" valor={fmtQtd(contagens.empresas)} chip="bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300" />
            <StatTabela icone="📦" rotulo="Produtos" valor={fmtQtd(contagens.produtos)} chip="bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300" />
            <StatTabela icone="📎" rotulo="Anexos" valor={fmtQtd(status?.anexos)} chip="bg-lime-100 text-lime-800 dark:bg-lime-950/60 dark:text-lime-300" />
            <StatTabela icone="🏭" rotulo="Produtos DFe" valor={fmtQtd(status?.produtosDfe)} chip="bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300" />
          </div>

          <NucleoImportacaoBases />

          <div className="mb-2 mt-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">
              🕘 Histórico de atualizações
            </h3>
            {cffStatus ? (
              <span className="pill bg-brand-100 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300">
                {cffStatus.endpoints.filter((e) => e.status === 'ok').length}/{cffStatus.endpoints.length} serviços atualizados
              </span>
            ) : null}
          </div>
          <Painel className="mb-3 p-3">
            <p className="text-[11px] leading-relaxed text-slate-400">
              Monitoramento das atualizações que realmente foram aplicadas à base local.
              As bases acima são atualizadas <strong>manualmente</strong>; o programa em si
              é renovado pela <strong>atualização do programa</strong>.
            </p>

            {cffStatus ? (
              <div className="mt-3">
                <div className="mb-2 flex items-center gap-1.5 text-[11px] text-slate-500">
                  <span className="font-bold uppercase tracking-wide">Última atualização registrada:</span>
                  <span className="font-mono font-bold text-slate-700 dark:text-slate-200">
                    {cffStatus.ultimaVerificacaoGeral
                      ? new Date(cffStatus.ultimaVerificacaoGeral).toLocaleString('pt-BR')
                      : 'nunca'}
                  </span>
                </div>
                <div className="relative ml-1.5 space-y-2 border-l-2 border-slate-200 pl-4 dark:border-slate-700">
                  {cffStatus.endpoints.map((ep) => {
                    const conf = STATUS_CFF[ep.status] ?? STATUS_CFF.nunca
                    return (
                      <div key={ep.endpoint.servico} className="relative">
                        <span
                          className={`absolute -left-[23px] top-3.5 h-3 w-3 rounded-full ring-4 ${conf.ponto}`}
                          aria-hidden="true"
                        />
                        <div className="card-hover rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-2.5 shadow-card">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xs font-black">{ep.endpoint.servico}</div>
                              <div className="truncate text-[10px] text-slate-400">{ep.endpoint.descricao}</div>
                            </div>
                            <span className={`pill shrink-0 ${conf.selo}`}>{conf.rotulo}</span>
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-400">
                            <span title="Data da atualização aplicada">
                              📅 {ep.ultimaSinc ? new Date(ep.ultimaSinc).toLocaleString('pt-BR') : '—'}
                            </span>
                            <span title="Registros aplicados">📊 {ep.totalRegistros != null ? ep.totalRegistros.toLocaleString('pt-BR') : '—'}</span>
                            {ep.totalNegados != null ? <span title="Negados">⛔ {ep.totalNegados}</span> : null}
                            {ep.hash ? (
                              <span title={ep.hash} className="font-mono">#️⃣ {ep.hash.slice(0, 8)}…</span>
                            ) : null}
                          </div>
                          {ep.status === 'certificado' || (ep.precisaCert && ep.ultimoErro) ? (
                            <div className="mt-1 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
                              🔐 {ep.ultimoErro ?? 'Exige certificado digital ICP-Brasil.'}
                            </div>
                          ) : ep.status === 'erro' && ep.ultimoErro ? (
                            <div className="mt-1 text-[10px] leading-relaxed text-red-600 dark:text-red-300">
                              {ep.ultimoErro}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className="mt-2 flex items-center justify-center gap-2 py-4 text-xs text-slate-400">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
                Carregando histórico…
              </div>
            )}
          </Painel>

          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">
              📑 Cobertura por documento fiscal
            </h3>
          </div>
          <Painel className="p-3">
            <CoberturaTabelas />
          </Painel>
        </section>
        ) : null}

        {aba === 'atualizacao' ? (
        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">
              🚀 Atualização do programa
            </h3>
            {verificando || baixando ? (
              <span className="pill bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-500" />
                trabalhando…
              </span>
            ) : null}
          </div>
          <div
            className={`borda-fluida ${verificando || baixando ? 'borda-fluida-viva' : ''}`}
            style={{ '--cor-fluxo-1': '#22d3ee', '--cor-fluxo-2': '#818cf8', '--cor-fluxo-3': '#e879f9' } as CSSProperties}
          >
          <div className="space-y-3 rounded-[14px] bg-[var(--surface-2)] p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-cyan-500 to-indigo-600 text-xl text-white shadow">
                🚀
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-black tracking-tight">
                  {atualizacaoPronta
                    ? `Versão ${atualizacaoPronta} pronta`
                    : versaoNova
                      ? `Versão ${versaoNova} disponível`
                      : `Programa v${versao}`}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                  <span
                    className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                      verificando || baixando
                        ? 'animate-ping bg-indigo-500'
                        : atualizacaoPronta || versaoNova
                          ? 'bg-amber-500'
                          : 'bg-emerald-500'
                    }`}
                  />
                  {verificando
                    ? 'Consultando novidades…'
                    : baixando
                      ? `Baixando… ${baixando.pct}%`
                      : atualizacaoPronta
                        ? 'Baixada — reinicie para aplicar'
                        : versaoNova
                          ? 'Nova versão encontrada'
                          : 'Tudo em dia'}
                </div>
              </div>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-400">
              As tabelas tributárias (NCM, CST, cClassTrib, nomenclatura vigente) vêm
              embutidas no programa e são renovadas aqui, na atualização geral.
              A verificação automática ocorre ao abrir o sistema (app instalado).
            </p>

            <div className="grid grid-cols-2 gap-1.5">
              <Contador rotulo="Versão instalada" valor={versao} />
              <Contador
                rotulo="Canal"
                valor={bridge ? `desktop (${bridge.plataforma})` : 'navegador'}
              />
              {versaoNova ? <Contador rotulo="Nova versão" valor={versaoNova} /> : null}
              {atualizacaoPronta ? <Contador rotulo="Pronta p/ instalar" valor={atualizacaoPronta} /> : null}
            </div>

            {notasVersao ? (
              <p className="max-h-28 overflow-y-auto whitespace-pre-wrap text-[10px] leading-relaxed text-slate-400">
                {notasVersao}
              </p>
            ) : null}

            {baixando ? (
              <div className="space-y-1.5">
                <div className="relative h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-indigo-500 to-fuchsia-500 transition-[width] duration-300"
                    style={{ width: `${Math.max(2, Math.min(100, baixando.pct))}%` }}
                  />
                  <div className="animate-shimmer pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/60 to-transparent bg-[length:200%_100%]" />
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>Baixando atualização…</span>
                  <span className="num font-mono">{baixando.pct}%</span>
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-1.5">
              {!bridge ? (
                <p className="text-[11px] text-slate-400">
                  Atualização automática disponível apenas no app instalado (Electron).
                </p>
              ) : (
                <>
                  <Btn
                    tam="sm"
                    variante="primary"
                    carregando={verificando}
                    onClick={() => {
                      void (async () => {
                        setVerificando(true)
                        setVersaoNova(null)
                        setNotasVersao(null)
                        try {
                          const r = await verificarAtualizacaoManual()
                          if (r?.disponivel) {
                            setVersaoNova(r.versao ?? 'nova versão')
                            setNotasVersao(r.notas ?? null)
                          }
                        } finally {
                          setVerificando(false)
                        }
                      })()
                    }}
                  >
                    {verificando ? 'Verificando…' : '🔄 Verificar atualizações'}
                  </Btn>
                  {versaoNova && !atualizacaoPronta ? (
                    <button
                      type="button"
                      disabled={baixando !== null}
                      onClick={() => {
                        void (async () => {
                          setBaixando({ pct: 0 })
                          const ok = await baixarAtualizacao()
                          if (!ok) setBaixando(null)
                        })()
                      }}
                      className="btn-press rounded-lg bg-gradient-to-r from-cyan-600 to-indigo-600 px-3 py-1.5 text-xs font-bold text-white shadow transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {baixando ? '⬇ Baixando…' : '⬇ Baixar atualização'}
                    </button>
                  ) : null}
                  {atualizacaoPronta ? (
                    <button
                      type="button"
                      onClick={() => {
                        void (async () => {
                          const ok = await confirmar(
                            'Reiniciar e atualizar?',
                            `O programa será fechado para aplicar a versão ${atualizacaoPronta}.`,
                            { icone: '🔄', confirmar: 'Reiniciar e atualizar' },
                          )
                          if (ok) void instalarAtualizacao()
                        })()
                      }}
                      className="btn-press animate-pulse-soft rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-3 py-1.5 text-xs font-bold text-white shadow transition hover:brightness-110"
                    >
                      🔄 Reiniciar e atualizar
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </div>
          </div>
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
              <Btn
                tam="sm"
                variante="danger"
                carregando={acaoBackup.carregando}
                onClick={acaoBackup.executar}
              >
                {acaoBackup.carregando ? 'Gerando…' : '⬇ Backup completo'}
              </Btn>
              <Btn tam="sm" carregando={acaoRestaurar.carregando} onClick={() => inputBackup.current?.click()}>
                {acaoRestaurar.carregando ? 'Restaurando…' : '⬆ Restaurar backup'}
              </Btn>
            </div>
            <input
              ref={inputBackup}
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => acaoRestaurar.executar(e.target.files?.[0] ?? null)}
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

  // Giro nos botões de ação (salvar/excluir o registro).
  const acaoSalvarAux = useAcaoTatil(enviar)
  const acaoExcluirAux = useAcaoTatil(async () => {
    if (chaveOriginal == null) return
    const ok = await confirmar(
      `Excluir ${meta.singular}?`,
      `Excluir este registro de ${meta.titulo}?`,
      { icone: '🗑', confirmar: 'Excluir', perigo: true },
    )
    if (!ok) return
    await useAuxiliares.getState().excluir(meta.tipo, chaveOriginal)
    fecharTudo()
  })

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
              carregando={acaoExcluirAux.carregando}
              onClick={acaoExcluirAux.executar}
            >
              {acaoExcluirAux.carregando ? 'Excluindo…' : '🗑 Excluir'}
            </Btn>
          ) : null}
          <Btn onClick={fecharTudo}>Cancelar</Btn>
          <Btn
            variante="primary"
            carregando={acaoSalvarAux.carregando}
            onClick={acaoSalvarAux.executar}
          >
            {acaoSalvarAux.carregando ? 'Salvando…' : 'Salvar'}
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
