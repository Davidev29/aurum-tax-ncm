/**
 * Tela **SPED Fiscal** (SPEC §4).
 *
 * Upload de EFD, detecção automática de tipo, análise das **saídas** e
 * gravação em massa dos produtos encontrados. Painéis: vazio, incompatível,
 * sem saída, erro e ok — mais a variante **modo resumo** (só C190).
 *
 * Regras preservadas da v1:
 * - somente saídas são analisadas; entradas aparecem só como estatística;
 * - modo resumo quando não há C170/A170/D170 nas saídas;
 * - recusa explícita de Reinf/e-Social/ECD/ECF;
 * - alíquotas de referência **próprias** desta tela (corrige o `[BUG] L973`);
 * - tabela de detalhamento renderiza no máximo `ROWS_LIMIT` linhas;
 * - "Produtos com Alíquota Zero" mostra o `totalTributos` real (corrige o
 *   `[BUG] L1560`, que imprimia R$ 0,00 fixo).
 */
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import { RENDER_LIMITS, ROWS_LIMIT } from '@/domain/constants'
import { EMITENTE_PADRAO } from '@/domain/entities'
import { fmtCarga, fmtMoeda, fmtNcm, fmtNum } from '@/domain/services/format'
import {
  confrontoRegimesSped,
  distribuicaoPorAnexoSped,
  evolucaoMensalSped,
  indicadoresResumoSped,
  indicadoresSped,
  topCfopSped,
  topCstIcmsSped,
  topCstSped,
  topNcmSped,
} from '@/application/sped-insights'
import { exportarSpedCSV, exportarSpedPDF, totaisSped } from '@/infrastructure/exporters/relatorios'
import { registrarExportador } from '@/infrastructure/pdf/menu-exportacao'
import { ehResumo } from '@/infrastructure/sped/tipos'
import type { ResultadoItem, ResultadoResumo, SpedStats, SpedTipo } from '@/infrastructure/sped/tipos'
import { ModalDetalheSped } from '@/modais/pagina'
import { useSessao } from '@/store/sessao'
import { useSped } from '@/store/sped'
import { toast } from '@/store/ui'
import { Olho } from '@/ui/detalhes'
import { CartaoStat, ZonaArquivo } from '@/ui/cartoes'
import { AnexoBadge, Btn, IconeBadge, Painel, Pill, Texto } from '@/ui/kit'

/** Gráficos sob demanda: o Chart.js só é baixado quando a análise os mostra. */
const GraficosSped = lazy(() => import('@/ui/graficos'))
const ANEXOS = ['0', '80', '70', '60', '50', '40', '30', 'misto', 'isento'] as const
const ROTULOS_ANEXO = ['Alíquota Zero', 'Redução 80%', 'Redução 70%', 'Redução 60%', 'Redução 50%', 'Redução 40%', 'Redução 30%', 'IBS ≠ CBS', 'Sem redução']

ChartJS.register(ArcElement, BarElement, CategoryScale, Filler, LinearScale, LineElement, PointElement, Tooltip, Legend)

const TOOLTIP_ESCURO_SPED = {
  backgroundColor: 'rgba(15, 23, 42, 0.94)',
  titleFont: { size: 11, weight: 'bold' as const },
  bodyFont: { size: 11 },
  padding: 10,
  cornerRadius: 10,
  displayColors: true,
  boxWidth: 10,
  boxHeight: 10,
  boxPadding: 3,
}

const fmtCompactoSped = (v: number): string =>
  v >= 1000000
    ? `R$ ${(v / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
    : v >= 1000
      ? `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`
      : fmtMoeda(v)

const ROTULO_ANEXO_SPED: Record<string, string> = {
  isento: 'Integral',
  '0': 'Alíq. zero',
  '80': 'Red. 80%',
  '70': 'Red. 70%',
  '60': 'Red. 60%',
  '50': 'Red. 50%',
  '40': 'Red. 40%',
  '30': 'Red. 30%',
  misto: 'IBS≠CBS',
}

export function Sped() {
  const painel = useSped((s) => s.painel)
  const processando = useSped((s) => s.processando)
  const etapa = useSped((s) => s.etapa)
  const modo = useSped((s) => s.modo)
  const processar = useSped((s) => s.processar)
  const limpar = useSped((s) => s.limpar)

  const [nomeArquivo, setNomeArquivo] = useState('')

  const aoEnviar = (f: File) => {
    setNomeArquivo(f.name)
    void processar(f)
  }

  const aoLimpar = () => {
    limpar()
    setNomeArquivo('')
    toast('Análise SPED limpa.', 'warn')
  }

  const temAnalise = painel.tipo === 'ok'

  // Menu nativo (Ctrl+E): registra o exportador de PDF desta view.
  useEffect(() => registrarExportador('sped', () => void exportarPdf(nomeArquivo)), [nomeArquivo])

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-4">
      <Painel>
        <div className="border-b border-slate-100 p-5 dark:border-slate-800">
          <h2 className="flex items-center gap-2.5 text-base font-bold">
            <IconeBadge nome="documento" tom="brand" /> Importar SPED
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Envie o arquivo SPED. O sistema detecta automaticamente o{' '}
            <strong>tipo de arquivo</strong> e escolhe o parser adequado.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              ✅ EFD ICMS/IPI (SPED Fiscal)
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              ✅ EFD Contribuições (PIS/COFINS)
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              ⛔ Reinf · e-Social · ECD · ECF
            </span>
          </div>
        </div>

        <div className="space-y-4 p-5">
          <ZonaArquivo
            onArquivo={aoEnviar}
            accept=".txt"
            rotulo="Arraste o arquivo SPED"
            dica="Aceita arquivos .txt no layout EFD"
            desabilitada={processando}
            icone={<IconeBadge nome="documento" tom="brand" tamanho="lg" />}
          />

          {processando ? (
            <div className="space-y-1.5">
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div className="h-full w-1/3 animate-shimmer rounded-full bg-gradient-to-r from-brand-600 to-brand-400" />
              </div>
              <div className="text-[11px] text-slate-500">{etapa ?? 'Processando…'}</div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/40">
            <CampoTaxaSped tributo="IBS" />
            <CampoTaxaSped tributo="CBS" />
            <p className="min-w-[240px] flex-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              Alíquotas de referência usadas <strong>somente nesta análise</strong>. Alterá-las não
              afeta a Calculadora nem os relatórios de produtos.
            </p>
          </div>

          {temAnalise ? (
            <div className="flex flex-wrap gap-2">
              <Btn onClick={aoLimpar}>🗑 Limpar análise</Btn>
              <Btn onClick={() => void exportarPdf(nomeArquivo)}>📕 Exportar relatório PDF</Btn>
              <Btn onClick={exportarCsv}>📊 Exportar CSV</Btn>
              {modo !== 'resumo' ? (
                <Btn variante="primary" onClick={() => void aoSalvarTodos()}>
                  💾 Salvar produtos na empresa
                </Btn>
              ) : null}
            </div>
          ) : null}
        </div>
      </Painel>

      <PainelResultado />

      <ModalDetalheSped />
    </div>
  )

  async function exportarPdf(nome: string) {
    try {
      const { dados, detalhe } = useSped.getState()
      if (!dados.length) return
      // Recarrega o emitente do banco na hora de gerar: garante que o timbrado
      // do PDF reflita as Configurações, mesmo se a sessão ainda não concluiu
      // o `iniciar()` ou o usuário acabou de salvar.
      const { carregarEmitente } = await import('@/application/emitente')
      const salvo = await carregarEmitente().catch(() => null)
      const emitente = salvo ?? useSessao.getState().emitente ?? EMITENTE_PADRAO
      await exportarSpedPDF({
        resultados: dados,
        emitente,
        tipo: detalhe?.tipo === 'contribuicoes' ? 'contribuicoes' : 'icmsipi',
        arquivo: nome,
      })
      toast('PDF do SPED gerado.', 'ok')
    } catch (e) {
      toast(`Erro ao gerar PDF: ${e instanceof Error ? e.message : String(e)}`, 'err')
    }
  }

  function exportarCsv() {
    const { dados } = useSped.getState()
    if (!dados.length) return
    exportarSpedCSV(dados)
    toast('CSV do SPED gerado.', 'ok')
  }

  async function aoSalvarTodos() {
    await useSped.getState().salvarTodos()
  }
}

/* ------------------------------------------------------------- alíquotas --- */

/** Campo de alíquota da tela SPED (texto local, só grava número parseável). */
function CampoTaxaSped({ tributo }: { tributo: 'IBS' | 'CBS' }) {
  const valor = useSped((s) => (tributo === 'IBS' ? s.refIBS : s.refCBS))
  const setRef = useSped((s) => s.setRef)
  const [texto, setTexto] = useState(() => String(valor))

  const numero = (t: string): number => Number(t.replace(',', '.')) || 0

  return (
    <label className="block w-28">
      <span className="field-label">{tributo} (%)</span>
      <Texto
        type="number"
        step="0.01"
        min={0}
        max={100}
        mono
        className="num-input"
        value={texto}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.,]/g, '')
          setTexto(t)
          setRef(tributo, numero(t))
        }}
      />
    </label>
  )
}

/* -------------------------------------------------------------- painéis --- */

function PainelResultado() {
  const painel = useSped((s) => s.painel)

  switch (painel.tipo) {
    case 'erro':
      return (
        <Painel className="border border-red-200 bg-red-50/60 p-5 dark:border-red-900 dark:bg-red-950/30">
          <div className="text-sm font-bold text-red-800 dark:text-red-200">
            ❌ Erro ao processar SPED
          </div>
          <div className="mt-2 break-words text-xs text-red-700 dark:text-red-300">
            {painel.mensagem}
          </div>
        </Painel>
      )
    case 'incompativel':
      return <PainelIncompativel detalhe={painel.detalhe} />
    case 'semSaida':
      return (
        <PainelSemSaida
          stats={painel.stats}
          nome={painel.nome}
          apenasEntradas={painel.apenasEntradas}
          contrib={painel.contrib}
        />
      )
    case 'ok':
      return <PainelAnalise />
    default:
      return null
  }
}

function PainelIncompativel({ detalhe }: { detalhe: SpedTipo }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      <div className="mb-2 flex items-center gap-2 text-base font-bold">
        <span className="text-2xl">⛔</span> Tipo de arquivo não suportado
      </div>
      <p className="mb-2 text-sm">
        Detectamos um arquivo do tipo <strong>{detalhe.nome}</strong>.
      </p>
      <p className="mb-3 text-sm leading-relaxed">
        {detalhe.motivo ?? 'Este módulo processa apenas EFD ICMS/IPI e EFD Contribuições.'}
      </p>
      {detalhe.codVer ? (
        <p className="mb-3 font-mono text-[11px]">
          Versão do leiaute: {detalhe.codVer}
        </p>
      ) : null}

      <div className="mt-4 rounded-lg bg-white p-4 text-[12px] text-slate-700 dark:bg-slate-900 dark:text-slate-300">
        <div className="mb-2 font-bold uppercase tracking-wide text-slate-500">
          Tipos aceitos por este módulo
        </div>
        <ul className="space-y-1.5">
          <li className="flex items-start gap-2">
            <span>✅</span>
            <div>
              <strong>EFD ICMS/IPI</strong> (SPED Fiscal) — registros C100/C170/C190
            </div>
          </li>
          <li className="flex items-start gap-2">
            <span>✅</span>
            <div>
              <strong>EFD Contribuições</strong> (PIS/COFINS) — registros A100/A170, C100/C170,
              D100/D170
            </div>
          </li>
        </ul>
        <div className="mt-3 border-t border-slate-200 pt-3 text-slate-500 dark:border-slate-800">
          <strong>Não suportados:</strong> EFD Reinf, e-Social, ECD, ECF, NF-e XML, Bloco K
          isolado.
        </div>
      </div>
    </div>
  )
}

function PainelSemSaida({
  stats,
  nome,
  apenasEntradas,
  contrib,
}: {
  stats: SpedStats
  nome: string
  apenasEntradas: boolean
  contrib: boolean
}) {
  const rotulo = (n: string, v: number) => (
    <div key={n}>
      <span className="text-slate-500">{n}:</span>{' '}
      <strong>{fmtNum(v)}</strong>
    </div>
  )

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <div className="mb-1 flex items-center gap-2 text-base font-bold">
        <span className="text-lg">⚠</span>
        {apenasEntradas
          ? `Arquivo ${nome} contém apenas operações de ENTRADA`
          : 'Nenhum item de saída encontrado no arquivo'}
      </div>
      <p className="text-sm leading-relaxed">
        {apenasEntradas ? (
          <>
            Detectamos apenas notas de entrada. Como a simulação é feita sobre as{' '}
            <strong>saídas</strong>, não há dados para analisar.
          </>
        ) : (
          <>
            O arquivo {nome} não contém itens detalhados ({contrib ? 'A170/C170/D170' : 'C170'}) nem
            resumo {contrib ? '' : '(C190) '}para as saídas.
          </>
        )}
      </p>

      <div className="mt-4 rounded-xl bg-white p-3 text-[11px] text-slate-600 dark:bg-slate-900 dark:text-slate-300">
        <div className="mb-2 font-bold uppercase tracking-wide text-slate-500">
          Estatísticas do arquivo ({nome})
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {rotulo('Linhas totais', stats.linhasTotais)}
          {rotulo('Registros 0200', stats.registros0200)}
          {contrib ? rotulo('A100', stats.registrosA100) : null}
          {contrib ? rotulo('A170', stats.registrosA170) : null}
          {rotulo('C100', stats.registrosC100)}
          {rotulo('C170', stats.registrosC170)}
          {contrib ? rotulo('D100', stats.registrosD100) : null}
          {contrib ? rotulo('D170', stats.registrosD170) : null}
          {contrib ? null : rotulo('C190', stats.registrosC190)}
          {rotulo('Notas entrada', stats.notasEntrada)}
          {rotulo('Notas saída', stats.notasSaida)}
          {rotulo('Itens entrada', stats.itensEntrada)}
          {rotulo('Itens saída', stats.itensSaida)}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- análise --- */

function PainelAnalise() {
  const dados = useSped((s) => s.dados)
  const stats = useSped((s) => s.stats)
  const detalhe = useSped((s) => s.detalhe)
  const resumoModo = ehResumo(dados)

  return (
    <div className="animate-fade-up xml-stack">
      {stats && !resumoModo ? (
        <BannerIdentificado stats={stats} tipo={detalhe?.tipo ?? 'icmsipi'} />
      ) : null}

      {resumoModo ? (
        <VisaoResumo linhas={dados as ResultadoResumo[]} />
      ) : (
        <VisaoItens itens={dados as ResultadoItem[]} />
      )}
    </div>
  )
}

/* ------------------------------------------------- banner do arquivo ------ */

function BannerIdentificado({ stats, tipo }: { stats: SpedStats; tipo: SpedTipo['tipo'] }) {
  const contrib = tipo === 'contribuicoes'
  return (
    <div className="rounded-2xl border border-brand-200 bg-gradient-to-r from-brand-50 to-white p-4 dark:border-aurum-900 dark:from-brand-950/40 dark:to-slate-900">
      <div className="flex items-start gap-3">
        <IconeBadge nome="documento" tom="brand" />
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="text-sm font-bold text-brand-800 dark:text-brand-200">
              O que foi identificado no arquivo SPED
            </div>
            <Pill cor={contrib ? 'emerald' : 'brand'}>
              📊 {contrib ? 'EFD Contribuições' : 'EFD ICMS/IPI'}
            </Pill>
          </div>

          <div className="grid grid-cols-2 gap-3 text-[11px] md:grid-cols-4">
            <div className="rounded-lg bg-white p-2 dark:bg-slate-900">
              <div className="text-[9px] font-bold uppercase text-slate-500">Notas de entrada</div>
              <div className="text-lg font-black text-slate-700 dark:text-slate-200">
                {stats.notasEntrada}
              </div>
              <div className="text-[9px] text-slate-400">(IGNORADAS)</div>
            </div>
            <div className="rounded-lg bg-white p-2 dark:bg-slate-900">
              <div className="text-[9px] font-bold uppercase text-slate-500">Notas de saída</div>
              <div className="text-lg font-black text-brand-700 dark:text-aurum-200">
                {stats.notasSaida}
              </div>
              <div className="text-[9px] text-slate-400">(ANALISADAS)</div>
            </div>
            <div className="rounded-lg bg-white p-2 dark:bg-slate-900">
              <div className="text-[9px] font-bold uppercase text-slate-500">Itens de entrada</div>
              <div className="text-lg font-black text-slate-700 dark:text-slate-200">
                {stats.itensEntrada}
              </div>
              <div className="text-[9px] text-slate-400">descartados</div>
            </div>
            <div className="rounded-lg bg-white p-2 dark:bg-slate-900">
              <div className="text-[9px] font-bold uppercase text-slate-500">Itens de saída</div>
              <div className="text-lg font-black text-emerald-700 dark:text-emerald-400">
                {stats.itensSaida}
              </div>
              <div className="text-[9px] text-slate-400">processados</div>
            </div>
          </div>

          {contrib ? (
            <div className="mt-2 text-[11px] text-brand-700 dark:text-brand-300">
              ℹ️ <strong>EFD Contribuições</strong>: processamos A170 (serviços), C170 (mercadorias) e
              D170 (transporte).
            </div>
          ) : null}
          <div className="mt-2 text-[11px] text-brand-700 dark:text-brand-300">
            ✅ <strong>Apenas as saídas foram consideradas</strong> — entradas não impactam a
            simulação.
            {stats.itensOrfaos ? ` · ${stats.itensOrfaos} item(ns) ignorado(s).` : ''}
            {stats.itensSemCadastro0200
              ? ` · ${stats.itensSemCadastro0200} item(ns) sem cadastro 0200.`
              : ''}
            {stats.notasCanceladas
              ? ` · ${stats.notasCanceladas} nota(s) cancelada(s)/denegada(s) descartada(s) (${stats.itensCancelados} item(ns)).`
              : ''}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------ visão por itens --- */

function VisaoItens({ itens }: { itens: ResultadoItem[] }) {
  const abrirDetalhe = useSped((s) => s.abrirDetalhe)
  const tot = useMemo(() => totaisSped(itens), [itens])
  const zero = useMemo(() => itens.filter((r) => r.redIBS >= 100 && r.redCBS >= 100), [itens])
  const grupos = useMemo(() => agruparPorAnexo(itens), [itens])
  const top = useMemo(() => topProdutos(itens), [itens])

  if (!itens.length) {
    return (
      <Painel className="p-8 text-center text-sm text-slate-500">
        Nenhum item de saída encontrado no arquivo.
      </Painel>
    )
  }

  return (
    <>
      <FaixaEstatisticas
        cartoes={[
          { rotulo: 'Itens (saída)', valor: itens.length, cor: 'text-2xl' },
          { rotulo: 'Base total', valor: fmtMoeda(tot.base) },
          { rotulo: 'IBS estimado', valor: fmtMoeda(tot.ibs), cor: 'text-brand-700 dark:text-aurum-200' },
          { rotulo: 'CBS estimado', valor: fmtMoeda(tot.cbs), cor: 'text-brand-700 dark:text-aurum-200' },
          { rotulo: 'Total tributos', valor: fmtMoeda(tot.trib), cor: 'text-emerald-700 dark:text-emerald-400' },
          { rotulo: 'Carga média', valor: `${tot.carga.toFixed(2).replace('.', ',')}%` },
        ]}
      />

      <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-[11px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        <div className="flex items-start gap-2.5">
          <IconeBadge nome="alerta" tom="amber" />
          <div>
            <div className="font-bold">Escopo da análise</div>
            <div className="mt-0.5 leading-relaxed">
              Esta análise considera <strong>apenas as operações de saída</strong>. As{' '}
              <strong>entradas foram identificadas e descartadas automaticamente</strong>. Os
              valores são <strong>estimativas</strong>.
            </div>
          </div>
        </div>
      </div>

      <Painel className="overflow-hidden border-2 border-brand-300 dark:border-aurum-800">
        <div className="border-b border-brand-200 bg-gradient-to-r from-brand-50 to-white px-5 py-4 dark:border-aurum-900 dark:from-brand-950/40 dark:to-slate-900">
          <div className="flex items-start gap-2.5">
            <IconeBadge nome="moeda" tom="brand" />
            <div>
              <div className="text-sm font-bold text-brand-800 dark:text-brand-200">
                Com base nas saídas analisadas, você pagaria na Reforma Tributária
              </div>
              <div className="mt-1 text-3xl font-black text-brand-700 dark:text-aurum-200">
                {fmtMoeda(tot.trib)}
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                em IBS ({fmtMoeda(tot.ibs)}) + CBS ({fmtMoeda(tot.cbs)}) sobre uma base de{' '}
                {fmtMoeda(tot.base)}
              </div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-3">
          <CartaoTaxa rotulo="IBS Estimado" valor={fmtMoeda(tot.ibs)} base={tot.base} parte={tot.ibs} />
          <CartaoTaxa rotulo="CBS Estimado" valor={fmtMoeda(tot.cbs)} base={tot.base} parte={tot.cbs} />
          <div className="rounded-xl bg-emerald-50 p-4 dark:bg-emerald-950/30">
            <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
              Carga Efetiva
            </div>
            <div className="mt-1 text-xl font-black text-emerald-700 dark:text-emerald-400">
              {tot.carga.toFixed(2).replace('.', ',')}%
            </div>
            <div className="mt-0.5 text-[10px] text-slate-500">Sobre o valor total das saídas</div>
          </div>
        </div>
      </Painel>

      <IndicadoresSpedSecao itens={itens} />

      <ComparativoMensalSped itens={itens} />

      <RegimeAntigoVsNovoSped itens={itens} />

      {zero.length ? <TabelaAliquotaZero itens={zero} /> : null}

      <Painel>
        <div className="border-b border-slate-100 px-5 py-3 dark:border-slate-800">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <IconeBadge nome="pasta" tom="slate" /> Separação por Anexo
          </h3>
        </div>
        <div className="grid grid-cols-1 gap-3 p-5 md:grid-cols-2 lg:grid-cols-4">
          {ANEXOS.map((anexo) => {
            const lista = grupos[anexo]
            const valor = lista.reduce((a, r) => a + (Number(r.vlItem) || 0), 0)
            const trib = lista.reduce((a, r) => a + r.totalTributos, 0)
            return (
              <div
                key={anexo}
                className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
              >
                <AnexoBadge anexo={anexo} />
                <div className="mt-3 space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Itens:</span>
                    <span className="font-bold">{lista.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Valor:</span>
                    <span className="font-mono font-bold">{fmtMoeda(valor)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Tributos:</span>
                    <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                      {fmtMoeda(trib)}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </Painel>

      <TopProdutosSped itens={itens} />

      <RankingsSped itens={itens} />

      <QualidadeSped itens={itens} />

      <Suspense
        fallback={
          <Painel className="p-5 text-sm text-slate-500">Carregando gráficos…</Painel>
        }
      >
        <GraficosSped
          anexo={{
            rotulos: ROTULOS_ANEXO,
            valores: ANEXOS.map((a) =>
              grupos[a].reduce((s, r) => s + (Number(r.vlItem) || 0), 0),
            ),
          }}
          top={{
            rotulos: top.map((p) => (p.descricao || p.codItem).slice(0, 30)),
            valores: top.map((p) => p.total),
          }}
        />
      </Suspense>

      <Painel className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-slate-800">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <IconeBadge nome="caixa" tom="brand" /> Detalhamento por Produto (saídas)
          </h3>
          <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[10px] font-bold text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
            {itens.length} itens · botão Tributos abre todos os tributos
          </span>
        </div>
        <div className="max-h-[60vh] overflow-auto">
          <table className="tbl w-full">
            <thead>
              <tr>
                <th>Código</th>
                <th>Produto</th>
                <th>NCM</th>
                <th>Reforma</th>
                <th className="th-r">Total</th>
                <th className="th-r">Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {itens.slice(0, ROWS_LIMIT).map((r, i) => (
                <tr
                  key={`${r.codItem}-${r.numDoc}-${i}`}
                  className="cursor-pointer transition-colors hover:bg-brand-50/50"
                  onClick={() => abrirDetalhe(r)}
                  title="Ver todos os tributos (regime anterior + Reforma)"
                >
                  <td className="font-mono font-bold">{r.codItem}</td>
                  <td className="max-w-[260px] truncate" title={r.descricaoProduto}>
                    {r.descricaoProduto}
                  </td>
                  <td className="font-mono">{fmtNcm(r.ncm)}</td>
                  <td
                    className="max-w-[200px] font-mono text-[11px]"
                    title={`${r.classificacao.cst || '—'} · ${r.classificacao.cClassTrib || '—'} · CST ${r.cstIcms} · CFOP ${r.cfop}`}
                  >
                    <span className="block truncate font-bold">
                      {r.classificacao.cst || '—'} · {r.classificacao.cClassTrib || '—'}
                      {r.manual || r.classificacao.manual ? ' ✋' : null}
                    </span>
                    {r.manual || r.classificacao.manual ? (
                      <span className="block truncate text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                        Manual · usuário
                      </span>
                    ) : null}
                  </td>
                  <td className="text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">
                    {fmtMoeda(r.totalTributos)}
                  </td>
                  <td className="text-right" onClick={(e) => e.stopPropagation()}>
                    <Olho
                      onClick={() => abrirDetalhe(r)}
                      titulo="Ver todos os tributos (regime anterior + Reforma)"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {itens.length > ROWS_LIMIT ? (
          <div className="border-t border-slate-100 p-3 text-center text-[11px] text-slate-500 dark:border-slate-800">
            Mostrando {ROWS_LIMIT} de {itens.length} itens · PDF e CSV exportam a lista completa.
          </div>
        ) : null}
      </Painel>
    </>
  )
}

/* ---------------------------------------------------------- top produtos --- */

/**
 * Top produtos das saídas analisadas — espelha a seção Top produtos do
 * módulo XML. Como o SPED analisa só saídas, os quadros lado a lado mostram
 * os mais vendidos (por valor) e os de maior IBS+CBS (por tributo), sempre
 * com os tributos da Reforma por item.
 */
function TopProdutosSped({ itens }: { itens: ResultadoItem[] }) {
  const dados = useMemo(() => {
    const mapa = new Map<string, {
      codigo: string; nome: string; ncm: string; cfop: string;
      qtd: number; base: number; ibs: number; cbs: number; trib: number;
      cst: string; cClassTrib: string;
    }>()
    for (const r of itens) {
      const atual = mapa.get(r.codItem) ?? {
        codigo: r.codItem,
        nome: r.descricaoProduto || r.codItem,
        ncm: r.ncm,
        cfop: r.cfop || '—',
        qtd: 0, base: 0, ibs: 0, cbs: 0, trib: 0,
        cst: r.classificacao.cst || '—',
        cClassTrib: r.classificacao.cClassTrib || '—',
      }
      atual.qtd += Number(r.qtd) || 0
      atual.base += Number(r.vlItem) || 0
      atual.ibs += Number(r.ibs) || 0
      atual.cbs += Number(r.cbs) || 0
      atual.trib += Number(r.totalTributos) || 0
      mapa.set(r.codItem, atual)
    }
    const todos = [...mapa.values()]
    return {
      porValor: [...todos].sort((a, b) => b.base - a.base).slice(0, 5),
      porTributo: [...todos].sort((a, b) => b.trib - a.trib).slice(0, 5),
    }
  }, [itens])

  if (!itens.length) return null
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <QuadroTopSped
        titulo="Mais vendidos"
        subtitulo="Saídas do arquivo · top 5 por valor"
        tom="brand"
        lista={dados.porValor}
      />
      <QuadroTopSped
        titulo="Maior IBS + CBS"
        subtitulo="Saídas do arquivo · top 5 por tributo"
        tom="emerald"
        lista={dados.porTributo}
      />
    </div>
  )
}

function QuadroTopSped({
  titulo,
  subtitulo,
  tom,
  lista,
}: {
  titulo: string
  subtitulo: string
  tom: 'emerald' | 'brand'
  lista: { codigo: string; nome: string; ncm: string; cfop: string; qtd: number; base: number; ibs: number; cbs: number; trib: number; cst: string; cClassTrib: string }[]
}) {
  const max = lista.reduce((m, p) => Math.max(m, p.base), 0)
  const barra = tom === 'emerald' ? 'from-emerald-600 to-teal-400' : 'from-brand-600 to-brand-400'
  const valor = tom === 'emerald' ? 'text-emerald-700 dark:text-emerald-400' : 'text-brand-700 dark:text-aurum-200'
  return (
    <Painel className="flex h-full flex-col overflow-hidden p-0">
      <div className="shrink-0 border-b border-slate-100 bg-gradient-to-r from-brand-50/80 to-white px-4 py-2 dark:border-slate-800 dark:from-brand-950/30 dark:to-slate-900">
        <h3 className="flex items-center gap-1.5 text-xs font-bold">
          <IconeBadge nome="trofeu" tom={tom} tamanho="sm" />
          {titulo}
        </h3>
        <p className="mt-0.5 pl-8 text-[10px] text-slate-500 dark:text-slate-400">{subtitulo}</p>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
        {!lista.length ? (
          <p className="py-4 text-center text-[11px] text-slate-500">Sem itens no arquivo.</p>
        ) : lista.map((p, i) => (
          <div
            key={p.codigo}
            className="rounded-lg border border-transparent p-2 transition-all hover:border-slate-200 hover:bg-slate-50 hover:shadow-card dark:hover:border-slate-700 dark:hover:bg-slate-950/40"
            title={`${p.nome} · NCM ${fmtNcm(p.ncm)} · CFOP ${p.cfop} · CST ${p.cst} · ${p.cClassTrib}`}
          >
            <div className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-slate-100 font-mono text-[10px] font-black text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  {i + 1}
                </span>
                <span className="truncate font-semibold">{p.nome}</span>
              </span>
              <span className={`shrink-0 font-mono font-bold ${valor}`}>{fmtMoeda(p.base)}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${barra} transition-all`}
                style={{ width: `${max > 0 ? Math.max(4, (p.base / max) * 100) : 0}%` }}
              />
            </div>
            <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px]">
              <span className="truncate font-mono text-slate-400">
                {p.codigo} · {fmtNcm(p.ncm)} · qtd {fmtNum(p.qtd)}
              </span>
              <span className="shrink-0 font-mono text-slate-500 dark:text-slate-400">
                IBS {fmtMoeda(p.ibs)} + CBS {fmtMoeda(p.cbs)} = <strong className={valor}>{fmtMoeda(p.trib)}</strong>
              </span>
            </div>
            <div className="mt-1">
              <Pill cor={tom === 'emerald' ? 'emerald' : 'brand'}>CST {p.cst} · {p.cClassTrib}</Pill>
            </div>
          </div>
        ))}
      </div>
    </Painel>
  )
}

function TabelaAliquotaZero({ itens }: { itens: ResultadoItem[] }) {
  const visiveis = itens.slice(0, RENDER_LIMITS.aliquotaZero)
  return (
    <Painel className="overflow-hidden">
      <div className="border-b border-emerald-200 bg-gradient-to-r from-emerald-50 to-white px-5 py-3 dark:border-emerald-900 dark:from-emerald-950/40 dark:to-slate-900">
        <h3 className="flex items-center gap-2 text-sm font-bold text-emerald-800 dark:text-emerald-200">
          <IconeBadge nome="moeda" tom="emerald" /> Produtos com Alíquota Zero ({itens.length})
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="tbl w-full">
          <thead>
            <tr>
              <th>Código</th>
              <th>Produto</th>
              <th>NCM</th>
              <th className="th-r">Qtd</th>
              <th className="th-r">Valor</th>
              <th className="th-r">Tributos</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((r, i) => (
              <tr key={`${r.codItem}-${i}`} className="hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20">
                <td className="font-mono font-bold">{r.codItem}</td>
                <td>{r.descricaoProduto}</td>
                <td className="font-mono">{fmtNcm(r.ncm)}</td>
                <td className="text-right">{fmtNum(r.qtd)}</td>
                <td className="text-right font-mono">{fmtMoeda(r.vlItem)}</td>
                <td className="text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">
                  {fmtMoeda(r.totalTributos)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {itens.length > RENDER_LIMITS.aliquotaZero ? (
        <div className="border-t border-slate-100 p-3 text-center text-[11px] text-slate-500 dark:border-slate-800">
          Mostrando {RENDER_LIMITS.aliquotaZero} de {itens.length} produtos.
        </div>
      ) : null}
    </Painel>
  )
}

/* -------------------------------------------------------- modo resumo ----- */

function VisaoResumo({ linhas }: { linhas: ResultadoResumo[] }) {
  const tot = useMemo(() => totaisSped(linhas), [linhas])
  const notas = useMemo(() => linhas.reduce((a, r) => a + r.qtdNotas, 0), [linhas])

  if (!linhas.length) {
    return (
      <Painel className="p-8 text-center text-sm text-slate-500">
        Nenhum registro C190 de saída encontrado no arquivo.
      </Painel>
    )
  }

  return (
    <>
      <div className="rounded-2xl border border-amber-300 bg-amber-50/80 p-5 dark:border-amber-800 dark:bg-amber-950/40">
        <div className="flex items-start gap-3">
          <IconeBadge nome="alerta" tom="amber" />
          <div className="flex-1">
            <div className="text-sm font-bold text-amber-900 dark:text-amber-200">
              Modo RESUMO ativado
            </div>
            <div className="mt-1 text-[12px] leading-relaxed text-amber-800 dark:text-amber-300">
              Este arquivo SPED <strong>não contém C170 nas saídas</strong>, apenas{' '}
              <strong>C190</strong> (agrupado por CST ICMS + CFOP). Como não temos{' '}
              <strong>NCM</strong>, aplicamos a <strong>regra geral (alíquota cheia)</strong> como
              estimativa.
              <br />
              <br />💡 <strong>Para classificação precisa:</strong> exporte um SPED com os C170 das
              saídas, ou use a aba <strong>Classificação em Lote</strong>.
            </div>
          </div>
        </div>
      </div>

      <FaixaEstatisticas
        cartoes={[
          { rotulo: 'Grupos CST+CFOP', valor: linhas.length, cor: 'text-2xl' },
          { rotulo: 'Notas (C190)', valor: notas },
          { rotulo: 'Base total', valor: fmtMoeda(tot.base) },
          { rotulo: 'IBS estimado', valor: fmtMoeda(tot.ibs), cor: 'text-brand-700 dark:text-aurum-200' },
          { rotulo: 'CBS estimado', valor: fmtMoeda(tot.cbs), cor: 'text-brand-700 dark:text-aurum-200' },
          { rotulo: 'Carga média', valor: `${tot.carga.toFixed(2).replace('.', ',')}%` },
        ]}
      />

      <Painel className="overflow-hidden border-2 border-brand-300 dark:border-aurum-800">
        <div className="border-b border-brand-200 bg-gradient-to-r from-brand-50 to-white px-5 py-4 dark:border-aurum-900 dark:from-brand-950/40 dark:to-slate-900">
          <div className="flex items-start gap-2.5">
            <IconeBadge nome="moeda" tom="brand" />
            <div>
              <div className="text-sm font-bold text-brand-800 dark:text-brand-200">
                Estimativa (regra geral) sobre as saídas
              </div>
              <div className="mt-1 text-3xl font-black text-brand-700 dark:text-aurum-200">
                {fmtMoeda(tot.trib)}
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                em IBS ({fmtMoeda(tot.ibs)}) + CBS ({fmtMoeda(tot.cbs)}) sobre uma base de{' '}
                {fmtMoeda(tot.base)}
              </div>
            </div>
          </div>
        </div>
      </Painel>

      <ResumoComparativo linhas={linhas} />

      <Painel className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-slate-800">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <IconeBadge nome="documento" tom="slate" /> Detalhamento por CST ICMS + CFOP
          </h3>
          <span className="text-[10px] text-slate-500">{linhas.length} grupos</span>
        </div>
        <div className="overflow-auto">
          <table className="tbl w-full">
            <thead>
              <tr>
                <th>CST ICMS</th>
                <th>CFOP</th>
                <th className="th-r">Notas</th>
                <th className="th-r">Valor Operação</th>
                <th className="th-r">BC ICMS</th>
                <th className="th-r">ICMS</th>
                <th className="th-r">IBS</th>
                <th className="th-r">CBS</th>
                <th className="th-r">Total</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((r, i) => (
                <tr key={`${r.cstIcms}-${r.cfop}-${i}`}>
                  <td className="font-mono font-bold">{r.cstIcms}</td>
                  <td className="font-mono font-bold">{r.cfop}</td>
                  <td className="text-right">{r.qtdNotas}</td>
                  <td className="text-right font-mono">{fmtMoeda(r.totalOperacao)}</td>
                  <td className="text-right font-mono text-slate-500">{fmtMoeda(r.totalBcIcms)}</td>
                  <td className="text-right font-mono text-slate-500">{fmtMoeda(r.totalIcms)}</td>
                  <td className="text-right font-mono text-brand-700 dark:text-aurum-200">
                    {fmtMoeda(r.ibs)}
                  </td>
                  <td className="text-right font-mono text-brand-700 dark:text-aurum-200">
                    {fmtMoeda(r.cbs)}
                  </td>
                  <td className="text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">
                    {fmtMoeda(r.totalTributos)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="font-bold">
                  TOTAL
                </td>
                <td className="text-right font-mono font-bold">{fmtMoeda(tot.base)}</td>
                <td />
                <td />
                <td className="text-right font-mono font-bold text-brand-700 dark:text-aurum-200">
                  {fmtMoeda(tot.ibs)}
                </td>
                <td className="text-right font-mono font-bold text-brand-700 dark:text-aurum-200">
                  {fmtMoeda(tot.cbs)}
                </td>
                <td className="text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">
                  {fmtMoeda(tot.trib)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Painel>
    </>
  )
}

/* --------------------------------------- novas seções de visualização --- */

/**
 * Indicadores executivos do arquivo: ticket médio por item, maior item,
 * carga efetiva, NCMs distintos e qualidade da classificação
 * (regra geral × oficial × manual).
 */
function IndicadoresSpedSecao({ itens }: { itens: ResultadoItem[] }) {
  const ind = useMemo(() => indicadoresSped(itens), [itens])
  if (!itens.length) return null
  const cards = [
    { rotulo: 'Ticket médio', valor: fmtMoeda(ind.ticketMedio), sub: `${ind.qtd} itens · base ${fmtCompactoSped(ind.base)}` },
    { rotulo: 'Maior item', valor: ind.maiorItem ? fmtMoeda(ind.maiorItem.valor) : '—', sub: ind.maiorItem ? `${ind.maiorItem.codigo} · ${ind.maiorItem.descricao.slice(0, 28)}` : '—' },
    { rotulo: 'Carga efetiva', valor: fmtCarga(ind.carga), sub: `IBS+CBS ${fmtCompactoSped(ind.trib)}` },
    { rotulo: 'NCMs distintos', valor: String(ind.ncmsDistintos), sub: 'nomenclaturas no arquivo' },
    { rotulo: 'Regra geral', valor: String(ind.regraGeral), sub: ind.regraGeral ? 'alíquota cheia aplicada' : 'tudo classificado' },
    { rotulo: 'Manuais', valor: String(ind.manuais), sub: 'reclassificados pelo usuário' },
  ]
  return (
    <Painel className="overflow-hidden p-0">
      <div className="border-b border-slate-100 bg-gradient-to-r from-brand-50/80 to-white px-5 py-3.5 dark:border-slate-800 dark:from-brand-950/30 dark:to-slate-900">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <IconeBadge nome="moeda" tom="brand" />
          Indicadores do arquivo
        </h3>
        <p className="mt-0.5 pl-9 text-[11px] text-slate-500 dark:text-slate-400">
          Tickets, carga e qualidade da classificação — sobre as saídas analisadas
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <div key={c.rotulo} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/40">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{c.rotulo}</div>
            <div className="mt-0.5 truncate font-mono text-sm font-black" title={`${c.valor} · ${c.sub}`}>{c.valor}</div>
            <div className="truncate text-[10px] text-slate-400" title={c.sub}>{c.sub}</div>
          </div>
        ))}
      </div>
    </Painel>
  )
}

/**
 * Evolução mensal das saídas com alternância de visualização
 * (barras / linha / tabela): base, IBS+CBS e regime antigo no tempo.
 */
function ComparativoMensalSped({ itens }: { itens: ResultadoItem[] }) {
  const [modo, setModo] = useState<'barras' | 'linha' | 'tabela'>('barras')
  const evo = useMemo(() => evolucaoMensalSped(itens), [itens])
  if (!itens.length || !evo.length) return null
  const labels = evo.map((p) => p.rotulo)
  return (
    <Painel className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-gradient-to-r from-brand-50/80 to-white px-5 py-3.5 dark:border-slate-800 dark:from-brand-950/30 dark:to-slate-900">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <IconeBadge nome="grafico" tom="brand" />
            Saídas por mês
          </h3>
          <p className="mt-0.5 pl-9 text-[11px] text-slate-500 dark:text-slate-400">
            Base e IBS+CBS · últimos {evo.length} mese(s) do arquivo
          </p>
        </div>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-[11px] font-bold dark:bg-slate-800">
          {(['barras', 'linha', 'tabela'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setModo(m)}
              className={`rounded-md px-2.5 py-1 capitalize transition ${modo === m ? 'bg-white text-brand-700 shadow-sm dark:bg-slate-900 dark:text-aurum-200' : 'text-slate-500'}`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <div className="p-4">
        {modo === 'tabela' ? (
          <div className="overflow-x-auto">
            <table className="tbl w-full">
              <thead>
                <tr>
                  <th>Mês</th>
                  <th className="th-r">Base</th>
                  <th className="th-r">IBS + CBS</th>
                  <th className="th-r">Antigo</th>
                  <th className="th-r">Itens</th>
                </tr>
              </thead>
              <tbody>
                {evo.map((p) => (
                  <tr key={p.mes}>
                    <td className="font-mono font-bold">{p.rotulo}</td>
                    <td className="text-right font-mono">{fmtMoeda(p.base)}</td>
                    <td className="text-right font-mono text-emerald-700 dark:text-emerald-400">{fmtMoeda(p.trib)}</td>
                    <td className="text-right font-mono text-slate-500">{fmtMoeda(p.antigo)}</td>
                    <td className="text-right font-mono text-slate-500">{p.qtd}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : modo === 'linha' ? (
          <div className="h-72">
            <Line
              data={{
                labels,
                datasets: [
                  { label: 'Base', data: evo.map((p) => p.base), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.12)', fill: true, tension: 0.4, pointRadius: 3 },
                  { label: 'IBS + CBS', data: evo.map((p) => p.trib), borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.12)', fill: true, tension: 0.4, pointRadius: 3 },
                  { label: 'Antigo', data: evo.map((p) => p.antigo), borderColor: '#94a3b8', borderDash: [6, 4], tension: 0.4, pointRadius: 3 },
                ],
              }}
              options={{
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom', labels: { font: { size: 10, weight: 'bold' as const }, boxWidth: 10, boxHeight: 10, padding: 10, color: '#64748b' } }, tooltip: { ...TOOLTIP_ESCURO_SPED, callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmtMoeda(Number(ctx.raw))}` } } },
                scales: {
                  x: { ticks: { font: { size: 9 }, color: '#94a3b8' }, grid: { display: false }, border: { display: false } },
                  y: { ticks: { font: { size: 9 }, color: '#94a3b8', maxTicksLimit: 5, callback: (v) => fmtCompactoSped(Number(v)) }, grid: { color: 'rgba(148,163,184,0.14)' }, border: { display: false } },
                },
              }}
            />
          </div>
        ) : (
          <div className="h-72">
            <Bar
              data={{
                labels,
                datasets: [
                  { label: 'Base', data: evo.map((p) => p.base), backgroundColor: '#3b82f6', borderRadius: 6, borderSkipped: false, maxBarThickness: 26 },
                  { label: 'IBS + CBS', data: evo.map((p) => p.trib), backgroundColor: '#10b981', borderRadius: 6, borderSkipped: false, maxBarThickness: 26 },
                ],
              }}
              options={{
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom', labels: { font: { size: 10, weight: 'bold' as const }, boxWidth: 10, boxHeight: 10, padding: 10, color: '#64748b' } }, tooltip: { ...TOOLTIP_ESCURO_SPED, callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmtMoeda(Number(ctx.raw))}`, afterLabel: (ctx) => { const p = evo[ctx.dataIndex]; return p ? ` Antigo ${fmtMoeda(p.antigo)} · ${p.qtd} item(ns)` : '' } } } },
                scales: {
                  x: { ticks: { font: { size: 9 }, color: '#94a3b8' }, grid: { display: false }, border: { display: false } },
                  y: { ticks: { font: { size: 9 }, color: '#94a3b8', maxTicksLimit: 5, callback: (v) => fmtCompactoSped(Number(v)) }, grid: { color: 'rgba(148,163,184,0.14)' }, border: { display: false } },
                },
              }}
            />
          </div>
        )}
      </div>
    </Painel>
  )
}

/**
 * Confronto regime antigo × novo no SPED: ICMS+PIS+COFINS destacados nos
 * itens contra IBS+CBS estimados, mês a mês + veredito.
 */
function RegimeAntigoVsNovoSped({ itens }: { itens: ResultadoItem[] }) {
  const evo = useMemo(() => evolucaoMensalSped(itens), [itens])
  const conf = useMemo(() => confrontoRegimesSped(itens), [itens])
  if (!itens.length || !evo.length) return null
  const variacao = conf.variacaoPct
  return (
    <Painel className="overflow-hidden p-0">
      <div className="border-b border-slate-100 bg-gradient-to-r from-amber-50/80 to-white px-5 py-3.5 dark:border-slate-800 dark:from-amber-950/30 dark:to-slate-900">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <IconeBadge nome="calculadora" tom="amber" />
          Regime antigo × Reforma
        </h3>
        <p className="mt-0.5 pl-9 text-[11px] text-slate-500 dark:text-slate-400">
          ICMS + PIS + COFINS destacados × IBS + CBS estimados · diferença{' '}
          <strong className={conf.delta >= 0 ? 'text-red-600' : 'text-emerald-600'}>
            {conf.delta >= 0 ? '+' : ''}{fmtMoeda(conf.delta)}
            {variacao != null ? ` (${variacao >= 0 ? '+' : ''}${variacao.toFixed(1).replace('.', ',')}%)` : ''}
          </strong>
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[1fr_240px]">
        <div className="h-64">
          <Bar
            data={{
              labels: evo.map((p) => p.rotulo),
              datasets: [
                { label: 'Antigo (ICMS+PIS+COFINS)', data: evo.map((p) => p.antigo), backgroundColor: '#94a3b8', borderRadius: 6, borderSkipped: false, maxBarThickness: 26 },
                { label: 'Novo (IBS+CBS)', data: evo.map((p) => p.trib), backgroundColor: '#3a5dff', borderRadius: 6, borderSkipped: false, maxBarThickness: 26 },
              ],
            }}
            options={{
              responsive: true, maintainAspectRatio: false,
              plugins: { legend: { position: 'bottom', labels: { font: { size: 10, weight: 'bold' as const }, boxWidth: 10, boxHeight: 10, padding: 10, color: '#64748b' } }, tooltip: { ...TOOLTIP_ESCURO_SPED, callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmtMoeda(Number(ctx.raw))}` } } },
              scales: {
                x: { ticks: { font: { size: 9 }, color: '#94a3b8' }, grid: { display: false }, border: { display: false } },
                y: { ticks: { font: { size: 9 }, color: '#94a3b8', maxTicksLimit: 5, callback: (v) => fmtCompactoSped(Number(v)) }, grid: { color: 'rgba(148,163,184,0.14)' }, border: { display: false } },
              },
            }}
          />
        </div>
        <div className="space-y-2 text-xs">
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/40">
            <div className="text-[10px] font-bold uppercase text-slate-500">Antigo destacado</div>
            <div className="font-mono text-base font-black">{fmtMoeda(conf.antigo)}</div>
            <div className="mt-0.5 text-[11px] text-slate-500">ICMS {fmtMoeda(conf.icms)} · PIS/COFINS {fmtMoeda(conf.pisCofins)}</div>
          </div>
          <div className="rounded-xl bg-brand-50/60 p-3 dark:bg-brand-950/20">
            <div className="text-[10px] font-bold uppercase text-brand-600 dark:text-aurum-200">Novo estimado</div>
            <div className="font-mono text-base font-black text-brand-700 dark:text-aurum-200">{fmtMoeda(conf.novo)}</div>
            <div className="mt-0.5 text-[11px] text-slate-500">IBS {fmtMoeda(conf.ibs)} · CBS {fmtMoeda(conf.cbs)}</div>
          </div>
          <p className="px-1 text-[10px] leading-relaxed text-slate-400">
            O antigo é o que veio destacado nos itens do SPED; o novo é a estimativa do sistema (LC 214/2025).
          </p>
        </div>
      </div>
    </Painel>
  )
}

/**
 * Rankings complementares: rosca por benefício + barras de CST da Reforma,
 * CFOP e top NCMs — leituras que os gráficos padrão (anexo + top produtos)
 * não cobrem.
 */
function RankingsSped({ itens }: { itens: ResultadoItem[] }) {
  const anexo = useMemo(() => distribuicaoPorAnexoSped(itens), [itens])
  const csts = useMemo(() => topCstSped(itens), [itens])
  const cfops = useMemo(() => topCfopSped(itens), [itens])
  const ncms = useMemo(() => topNcmSped(itens), [itens])
  if (!itens.length) return null
  const totalAnexo = anexo.reduce((s, l) => s + l.trib, 0)
  const CORES = ['#10b981', '#8b5cf6', '#f59e0b', '#3b82f6', '#94a3b8', '#06b6d4']
  const maxNcm = ncms.reduce((m, l) => Math.max(m, l.base), 0)
  return (
    <>
      <div className="grid grid-cols-1 items-stretch gap-8 lg:grid-cols-3">
        <Painel className="overflow-hidden p-0">
          <div className="border-b border-slate-100 bg-gradient-to-r from-emerald-50/80 to-white px-5 py-3.5 dark:border-slate-800 dark:from-emerald-950/30 dark:to-slate-900">
            <h3 className="flex items-center gap-2 text-sm font-bold">
              <IconeBadge nome="rosca" tom="emerald" />
              IBS+CBS por benefício
            </h3>
            <p className="mt-0.5 pl-9 text-[11px] text-slate-500 dark:text-slate-400">Tributos por anexo</p>
          </div>
          <div className="relative h-64 p-4">
            {totalAnexo > 0 ? (
              <>
                <Doughnut
                  data={{
                    labels: anexo.map((l) => ROTULO_ANEXO_SPED[l.chave] ?? l.rotulo),
                    datasets: [{ data: anexo.map((l) => l.trib), backgroundColor: CORES, hoverOffset: 10, borderWidth: 3, borderColor: '#ffffff', spacing: 2, borderRadius: 6 }],
                  }}
                  options={{
                    responsive: true, maintainAspectRatio: false, cutout: '68%',
                    plugins: {
                      legend: { position: 'bottom', labels: { font: { size: 10, weight: 'bold' as const }, boxWidth: 10, boxHeight: 10, borderRadius: 3, useBorderRadius: true, padding: 12, color: '#64748b' } },
                      tooltip: { ...TOOLTIP_ESCURO_SPED, callbacks: { label: (ctx) => { const v = Number(ctx.raw) || 0; const pct = totalAnexo > 0 ? ((v / totalAnexo) * 100).toFixed(1).replace('.', ',') : '0,0'; return ` ${fmtMoeda(v)} (${pct}%)` }, afterLabel: (ctx) => { const l = anexo[ctx.dataIndex]; return l ? ` ${l.qtd} item(ns) · base ${fmtCompactoSped(l.base)}` : '' } } },
                    },
                  }}
                />
                <div className="pointer-events-none absolute inset-x-0 top-0 flex h-[calc(100%-52px)] flex-col items-center justify-center">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">IBS+CBS</span>
                  <span className="text-lg font-black text-slate-800 dark:text-slate-100">{fmtCompactoSped(totalAnexo)}</span>
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-slate-400">Sem tributos no arquivo.</div>
            )}
          </div>
        </Painel>

        <Painel className="overflow-hidden p-0">
          <div className="border-b border-slate-100 bg-gradient-to-r from-brand-50/80 to-white px-5 py-3.5 dark:border-slate-800 dark:from-brand-950/30 dark:to-slate-900">
            <h3 className="flex items-center gap-2 text-sm font-bold">
              <IconeBadge nome="trofeu" tom="brand" />
              Por CST da Reforma
            </h3>
            <p className="mt-0.5 pl-9 text-[11px] text-slate-500 dark:text-slate-400">Top {csts.length || 6} · IBS+CBS</p>
          </div>
          <div className="h-64 p-4">
            {csts.length ? (
              <Bar
                data={{ labels: csts.map((c) => c.rotulo), datasets: [{ data: csts.map((c) => c.trib), backgroundColor: '#3a5dff', borderRadius: 7, borderSkipped: false, maxBarThickness: 22 }] }}
                options={{
                  responsive: true, maintainAspectRatio: false, indexAxis: 'y',
                  plugins: { legend: { display: false }, tooltip: { ...TOOLTIP_ESCURO_SPED, callbacks: { label: (ctx) => ` ${fmtMoeda(Number(ctx.raw))}`, afterLabel: (ctx) => { const c = csts[ctx.dataIndex]; return c ? ` ${c.sub} · ${c.qtd} item(ns)` : '' } } } },
                  scales: {
                    x: { ticks: { font: { size: 9 }, color: '#94a3b8', maxTicksLimit: 4, callback: (v) => fmtCompactoSped(Number(v)) }, grid: { color: 'rgba(148,163,184,0.14)' }, border: { display: false } },
                    y: { ticks: { font: { size: 9, weight: 'bold' as const }, color: '#475569' }, grid: { display: false }, border: { display: false } },
                  },
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-slate-400">Sem CST no arquivo.</div>
            )}
          </div>
        </Painel>

        <Painel className="overflow-hidden p-0">
          <div className="border-b border-slate-100 bg-gradient-to-r from-amber-50/80 to-white px-5 py-3.5 dark:border-slate-800 dark:from-amber-950/30 dark:to-slate-900">
            <h3 className="flex items-center gap-2 text-sm font-bold">
              <IconeBadge nome="caixa" tom="amber" />
              Por CFOP
            </h3>
            <p className="mt-0.5 pl-9 text-[11px] text-slate-500 dark:text-slate-400">Top {cfops.length || 6} · valor da operação</p>
          </div>
          <div className="h-64 p-4">
            {cfops.length ? (
              <Bar
                data={{ labels: cfops.map((c) => c.rotulo.replace('CFOP ', '')), datasets: [{ data: cfops.map((c) => c.base), backgroundColor: '#f59e0b', borderRadius: 7, borderSkipped: false, maxBarThickness: 22 }] }}
                options={{
                  responsive: true, maintainAspectRatio: false, indexAxis: 'y',
                  plugins: { legend: { display: false }, tooltip: { ...TOOLTIP_ESCURO_SPED, callbacks: { label: (ctx) => ` ${fmtMoeda(Number(ctx.raw))}`, afterLabel: (ctx) => { const c = cfops[ctx.dataIndex]; return c ? ` ${c.qtd} item(ns) · IBS+CBS ${fmtMoeda(c.trib)}` : '' } } } },
                  scales: {
                    x: { ticks: { font: { size: 9 }, color: '#94a3b8', maxTicksLimit: 4, callback: (v) => fmtCompactoSped(Number(v)) }, grid: { color: 'rgba(148,163,184,0.14)' }, border: { display: false } },
                    y: { ticks: { font: { size: 9, weight: 'bold' as const }, color: '#475569' }, grid: { display: false }, border: { display: false } },
                  },
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-slate-400">Sem CFOP no arquivo.</div>
            )}
          </div>
        </Painel>
      </div>

      <Painel className="overflow-hidden p-0">
        <div className="border-b border-slate-100 bg-gradient-to-r from-brand-50/80 to-white px-5 py-3.5 dark:border-slate-800 dark:from-brand-950/30 dark:to-slate-900">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <IconeBadge nome="lupa" tom="brand" />
            Top NCMs por valor
          </h3>
          <p className="mt-0.5 pl-9 text-[11px] text-slate-500 dark:text-slate-400">
            Onde está concentrada a base · top {ncms.length || 8} do arquivo
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2 p-4 md:grid-cols-2">
          {!ncms.length ? (
            <p className="py-4 text-center text-[11px] text-slate-500 md:col-span-2">Sem itens no arquivo.</p>
          ) : ncms.map((l, i) => (
            <div key={l.chave} className="rounded-lg border border-transparent p-2 transition-all hover:border-slate-200 hover:bg-slate-50 dark:hover:border-slate-700 dark:hover:bg-slate-950/40" title={`${l.sub ?? ''} · IBS+CBS ${fmtMoeda(l.trib)}`}>
              <div className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-slate-100 font-mono text-[10px] font-black text-slate-500 dark:bg-slate-800 dark:text-slate-400">{i + 1}</span>
                  <span className="truncate font-mono font-bold">{fmtNcm(l.rotulo)}</span>
                  <span className="truncate text-slate-400">{l.sub}</span>
                </span>
                <span className="shrink-0 font-mono font-bold text-brand-700 dark:text-aurum-200">{fmtMoeda(l.base)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div className="h-full rounded-full bg-gradient-to-r from-brand-600 to-brand-400" style={{ width: `${maxNcm > 0 ? Math.max(4, (l.base / maxNcm) * 100) : 0}%` }} />
              </div>
              <div className="mt-0.5 flex justify-between text-[10px] text-slate-400">
                <span className="font-mono">{l.qtd} item(ns)</span>
                <span className="font-mono">IBS+CBS <strong className="text-emerald-700 dark:text-emerald-400">{fmtMoeda(l.trib)}</strong></span>
              </div>
            </div>
          ))}
        </div>
      </Painel>
    </>
  )
}

/**
 * Qualidade da classificação no SPED: regra geral × oficial × manual —
 * termômetro de quanto da estimativa veio de enquadramento específico.
 */
function QualidadeSped({ itens }: { itens: ResultadoItem[] }) {
  const q = useMemo(() => {
    let regraGeral = 0
    let manuais = 0
    for (const it of itens) {
      if (it?.regraGeral) regraGeral++
      if (it?.manual || it?.classificacao?.manual) manuais++
    }
    return { total: itens.length, regraGeral, manuais, oficial: itens.length - regraGeral }
  }, [itens])
  if (!itens.length) return null
  const pctOficial = q.total > 0 ? (q.oficial / q.total) * 100 : 0
  return (
    <Painel className="overflow-hidden p-0">
      <div className="border-b border-slate-100 bg-gradient-to-r from-emerald-50/80 to-white px-5 py-3.5 dark:border-slate-800 dark:from-emerald-950/30 dark:to-slate-900">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <IconeBadge nome="alerta" tom="emerald" />
          Qualidade da classificação
        </h3>
        <p className="mt-0.5 pl-9 text-[11px] text-slate-500 dark:text-slate-400">
          {q.oficial} de {q.total} item(ns) com enquadramento específico ({pctOficial.toFixed(1).replace('.', ',')}%)
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
        <div className="rounded-xl bg-slate-50 p-3 text-center dark:bg-slate-950/40">
          <div className="font-mono text-xl font-black">{q.total}</div>
          <div className="text-[10px] font-bold uppercase text-slate-500">Itens</div>
        </div>
        <div className="rounded-xl bg-emerald-50 p-3 text-center dark:bg-emerald-950/30">
          <div className="font-mono text-xl font-black text-emerald-700 dark:text-emerald-300">{q.oficial}</div>
          <div className="text-[10px] font-bold uppercase text-emerald-600">Específicos ✓</div>
        </div>
        <div className="rounded-xl bg-amber-50 p-3 text-center dark:bg-amber-950/30">
          <div className="font-mono text-xl font-black text-amber-700 dark:text-amber-300">{q.regraGeral}</div>
          <div className="text-[10px] font-bold uppercase text-amber-600">Regra geral ⚠</div>
        </div>
        <div className="rounded-xl bg-slate-50 p-3 text-center dark:bg-slate-950/40">
          <div className="font-mono text-xl font-black">{q.manuais}</div>
          <div className="text-[10px] font-bold uppercase text-slate-500">Manuais ✋</div>
        </div>
      </div>
      {q.regraGeral > 0 ? (
        <p className="px-5 pb-4 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
          Itens em <strong>regra geral</strong> usam alíquota cheia por falta de enquadramento oficial para o NCM —
          reclassifique manualmente quando souber a regra correta.
        </p>
      ) : null}
    </Painel>
  )
}

/**
 * Comparativo do modo resumo (só C190): ICMS total × IBS+CBS estimados +
 * ranking de CST ICMS e CFOP por valor de operação.
 */
function ResumoComparativo({ linhas }: { linhas: ResultadoResumo[] }) {
  const ind = useMemo(() => indicadoresResumoSped(linhas), [linhas])
  const csts = useMemo(() => topCstIcmsSped(linhas), [linhas])
  const cfops = useMemo(() => topCfopSped(linhas), [linhas])
  const conf = useMemo(() => confrontoRegimesSped(linhas), [linhas])
  if (!linhas.length) return null
  const max = csts.reduce((m, l) => Math.max(m, l.base), 0)
  return (
    <>
      <Painel className="overflow-hidden p-0">
        <div className="border-b border-slate-100 bg-gradient-to-r from-amber-50/80 to-white px-5 py-3.5 dark:border-slate-800 dark:from-amber-950/30 dark:to-slate-900">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <IconeBadge nome="calculadora" tom="amber" />
            ICMS × Reforma (modo resumo)
          </h3>
          <p className="mt-0.5 pl-9 text-[11px] text-slate-500 dark:text-slate-400">
            ICMS total {fmtMoeda(ind.icms)} × IBS+CBS {fmtMoeda(ind.trib)} · diferença{' '}
            <strong className={conf.delta >= 0 ? 'text-red-600' : 'text-emerald-600'}>
              {conf.delta >= 0 ? '+' : ''}{fmtMoeda(conf.delta)}
            </strong>
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-3 text-center dark:bg-slate-950/40">
            <div className="font-mono text-base font-black">{ind.grupos}</div>
            <div className="text-[10px] font-bold uppercase text-slate-500">Grupos CST×CFOP</div>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 text-center dark:bg-slate-950/40">
            <div className="font-mono text-base font-black">{fmtCompactoSped(ind.icms)}</div>
            <div className="text-[10px] font-bold uppercase text-slate-500">ICMS total</div>
          </div>
          <div className="rounded-xl bg-brand-50/60 p-3 text-center dark:bg-brand-950/20">
            <div className="font-mono text-base font-black text-brand-700 dark:text-aurum-200">{fmtCompactoSped(ind.trib)}</div>
            <div className="text-[10px] font-bold uppercase text-brand-600">IBS + CBS</div>
          </div>
          <div className="rounded-xl bg-emerald-50 p-3 text-center dark:bg-emerald-950/30">
            <div className="font-mono text-base font-black text-emerald-700 dark:text-emerald-300">{fmtCarga(ind.carga)}</div>
            <div className="text-[10px] font-bold uppercase text-emerald-600">Carga efetiva</div>
          </div>
        </div>
      </Painel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Painel className="overflow-hidden p-0">
          <div className="border-b border-slate-100 bg-gradient-to-r from-brand-50/80 to-white px-5 py-3.5 dark:border-slate-800 dark:from-brand-950/30 dark:to-slate-900">
            <h3 className="flex items-center gap-2 text-sm font-bold">
              <IconeBadge nome="trofeu" tom="brand" />
              CST ICMS por valor
            </h3>
            <p className="mt-0.5 pl-9 text-[11px] text-slate-500 dark:text-slate-400">Top {csts.length || 8} grupos do C190</p>
          </div>
          <div className="space-y-2 p-4">
            {csts.map((l, i) => (
              <div key={l.chave} title={`${l.qtd} grupo(s) · IBS+CBS ${fmtMoeda(l.trib)}`}>
                <div className="flex items-baseline justify-between gap-2 text-[11px]">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-slate-100 font-mono text-[10px] font-black text-slate-500 dark:bg-slate-800 dark:text-slate-400">{i + 1}</span>
                    <span className="truncate font-mono font-bold">{l.rotulo}</span>
                  </span>
                  <span className="shrink-0 font-mono font-bold">{fmtMoeda(l.base)}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className="h-full rounded-full bg-gradient-to-r from-brand-600 to-brand-400" style={{ width: `${max > 0 ? Math.max(4, (l.base / max) * 100) : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Painel>
        <Painel className="overflow-hidden p-0">
          <div className="border-b border-slate-100 bg-gradient-to-r from-amber-50/80 to-white px-5 py-3.5 dark:border-slate-800 dark:from-amber-950/30 dark:to-slate-900">
            <h3 className="flex items-center gap-2 text-sm font-bold">
              <IconeBadge nome="caixa" tom="amber" />
              CFOP por valor
            </h3>
            <p className="mt-0.5 pl-9 text-[11px] text-slate-500 dark:text-slate-400">Top {cfops.length || 6} operações do C190</p>
          </div>
          <div className="h-64 p-4">
            {cfops.length ? (
              <Bar
                data={{ labels: cfops.map((c) => c.rotulo.replace('CFOP ', '')), datasets: [{ data: cfops.map((c) => c.base), backgroundColor: '#f59e0b', borderRadius: 7, borderSkipped: false, maxBarThickness: 22 }] }}
                options={{
                  responsive: true, maintainAspectRatio: false, indexAxis: 'y',
                  plugins: { legend: { display: false }, tooltip: { ...TOOLTIP_ESCURO_SPED, callbacks: { label: (ctx) => ` ${fmtMoeda(Number(ctx.raw))}` } } },
                  scales: {
                    x: { ticks: { font: { size: 9 }, color: '#94a3b8', maxTicksLimit: 4, callback: (v) => fmtCompactoSped(Number(v)) }, grid: { color: 'rgba(148,163,184,0.14)' }, border: { display: false } },
                    y: { ticks: { font: { size: 9, weight: 'bold' as const }, color: '#475569' }, grid: { display: false }, border: { display: false } },
                  },
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-slate-400">Sem CFOP no arquivo.</div>
            )}
          </div>
        </Painel>
      </div>
    </>
  )
}

/* -------------------------------------------------------------- apoio ----- */

function FaixaEstatisticas({
  cartoes,
}: {
  cartoes: { rotulo: string; valor: string | number; cor?: string }[]
}) {
  return (
    <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-6">
      {cartoes.map((c) => (
        <CartaoStat key={c.rotulo} rotulo={c.rotulo} valor={c.valor} cor={c.cor} />
      ))}
    </div>
  )
}

function CartaoTaxa({
  rotulo,
  valor,
  base,
  parte,
}: {
  rotulo: string
  valor: string
  base: number
  parte: number
}) {
  const media = base > 0 ? ((parte / base) * 100).toFixed(2).replace('.', ',') : '0,00'
  return (
    <div className="rounded-xl bg-brand-50 p-4 dark:bg-brand-950/30">
      <div className="text-[10px] font-bold uppercase tracking-wide text-brand-600 dark:text-aurum-200">
        {rotulo}
      </div>
      <div className="mt-1 text-xl font-black text-brand-700 dark:text-aurum-200">{valor}</div>
      <div className="mt-0.5 text-[10px] text-slate-500">Alíquota média: {media}%</div>
    </div>
  )
}

function agruparPorAnexo(itens: ResultadoItem[]): Record<(typeof ANEXOS)[number], ResultadoItem[]> {
  const mapa = { '0': [], '80': [], '70': [], '60': [], '50': [], '40': [], '30': [], misto: [], isento: [] } as Record<
    (typeof ANEXOS)[number],
    ResultadoItem[]
  >
  for (const r of itens) {
    const chave = (ANEXOS as readonly string[]).includes(r.anexo)
      ? (r.anexo as (typeof ANEXOS)[number])
      : 'isento'
    mapa[chave].push(r)
  }
  return mapa
}

function topProdutos(itens: ResultadoItem[]) {
  const mapa = new Map<string, { codItem: string; descricao: string; total: number }>()
  for (const r of itens) {
    const atual = mapa.get(r.codItem) ?? {
      codItem: r.codItem,
      descricao: r.descricaoProduto,
      total: 0,
    }
    atual.total += r.totalTributos
    mapa.set(r.codItem, atual)
  }
  return [...mapa.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, RENDER_LIMITS.topProdutos)
}
