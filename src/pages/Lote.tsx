/**
 * Tela **Classificação em lote** (SPEC §6).
 *
 * Envio de CSV/XLSX, resolução da classificação linha a linha, troca manual
 * em NCMs ambíguos e gravação em massa (upsert por SKU).
 *
 * Paridade com a v1:
 * - colunas aceitas: COD/SKU, NOME DO PRODUTO, NCM, CFOP, CST, PIS, COFINS;
 * - tabela renderiza no máximo `ROWS_LIMIT` linhas;
 * - "Salvar todos" grava somente linhas com SKU **e** classificação escolhida.
 */
import { useEffect, useState } from 'react'
import { ROWS_LIMIT } from '@/domain/constants'
import { EMITENTE_PADRAO } from '@/domain/entities'
import { fmtNcm } from '@/domain/services/format'
import { baixarModeloLote, exportarLotePDF } from '@/infrastructure/exporters/relatorios'
import { registrarExportador } from '@/infrastructure/pdf/menu-exportacao'
import type { LinhaLote } from '@/infrastructure/exporters/relatorios'
import type { ItemLote, ResumoLote } from '@/infrastructure/parsers/lote'
import { useLote } from '@/store/lote'
import { useSessao } from '@/store/sessao'
import { useUi, toast } from '@/store/ui'
import { ZonaArquivo, AvisoDiferimento, AvisoManual, AvisoNcmExtinto } from '@/ui/cartoes'
import { BarraProgresso, Btn, Modal, Painel, Pill } from '@/ui/kit'
import { Campo, Olho, Secao } from '@/ui/detalhes'

export function Lote() {
  const resumo = useLote((s) => s.resumo)
  const processando = useLote((s) => s.processando)
  const progresso = useLote((s) => s.progresso)
  const erro = useLote((s) => s.erro)
  const processar = useLote((s) => s.processar)
  const salvarTodos = useLote((s) => s.salvarTodos)
  const limpar = useLote((s) => s.limpar)

  const emitente = useSessao((s) => s.emitente)
  const trocarView = useUi((s) => s.trocarView)
  const [salvando, setSalvando] = useState(false)

  const aoSalvar = async () => {
    setSalvando(true)
    try {
      const ok = await salvarTodos()
      if (ok) trocarView('produtos')
    } finally {
      setSalvando(false)
    }
  }

  const exportarPdf = async () => {
    if (!resumo) return
    try {
      await exportarLotePDF(
        resumo.itens.map(paraLinhaLote),
        emitente ?? EMITENTE_PADRAO,
        resumo.nomeArquivo,
      )
      toast('PDF do lote gerado.', 'ok')
    } catch (e) {
      toast(`Erro ao gerar PDF: ${e instanceof Error ? e.message : String(e)}`, 'err')
    }
  }

  // Menu nativo (Ctrl+E): registra o exportador de PDF desta view.
  useEffect(() => registrarExportador('lote', () => void exportarPdf()), [exportarPdf])

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Painel>
        <div className="border-b border-slate-100 p-5 dark:border-slate-800">
          <h2 className="flex items-center gap-2 text-base font-bold">
            <span className="text-lg">📁</span> Classificação em lote
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Envie CSV/Excel com colunas COD/SKU, NOME DO PRODUTO, NCM, CFOP, CST, PIS, COFINS.
          </p>
        </div>

        <div className="p-5">
          <ZonaArquivo
            onArquivo={(f) => void processar(f)}
            accept=".csv,.xlsx,.xls,.txt"
            rotulo="Arraste o arquivo"
            dica="Aceita CSV, XLSX e XLS"
            desabilitada={processando}
            icone="📄"
          />

          {processando ? (
            <div className="mt-4">
              <BarraProgresso pct={progresso} etapa="Processando arquivo…" />
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <Btn onClick={baixarModeloLote}>⬇ Baixar modelo CSV</Btn>
            {resumo ? (
              <Btn
                onClick={() => {
                  limpar()
                  toast('Resultados do lote limpos.', 'warn')
                }}
              >
                🗑 Limpar análise
              </Btn>
            ) : null}
          </div>

          {erro ? (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {erro}
            </div>
          ) : null}
        </div>
      </Painel>

      {resumo ? (
        <Painel className="animate-fade-up overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4 dark:border-slate-800">
            <Pill>📄 {resumo.nomeArquivo}</Pill>
            <Pill>{resumo.itens.length} linhas</Pill>
            <Pill cor="emerald">{resumo.comClassificacao} classificadas</Pill>
            {resumo.regraGeral ? <Pill cor="amber">{resumo.regraGeral} em regra geral</Pill> : null}
            {'manuais' in resumo && (resumo as { manuais?: number }).manuais ? (
              <Pill cor="amber">✋ {(resumo as { manuais?: number }).manuais} manuais · usuário</Pill>
            ) : null}
            {resumo.ambiguos ? (
              <Pill cor="amber">{resumo.ambiguos} com múltiplas opções</Pill>
            ) : null}
            {resumo.semNcm ? <Pill cor="red">{resumo.semNcm} inválidos</Pill> : null}
            <div className="flex-1" />
            <Btn onClick={() => void exportarPdf()}>📕 PDF</Btn>
            <Btn variante="primary" disabled={salvando} onClick={() => void aoSalvar()}>
              💾 Salvar todos como produtos
            </Btn>
          </div>

          <TabelaLote resumo={resumo} />
        </Painel>
      ) : null}
    </div>
  )
}

/* --------------------------------------------------------------- tabela ---- */

function TabelaLote({ resumo }: { resumo: ResumoLote }) {
  const visiveis = resumo.itens.slice(0, ROWS_LIMIT)
  // 👁 Detalhe compacto: regime anterior + Reforma + valores do item.
  const [detalhe, setDetalhe] = useState<ItemLote | null>(null)

  return (
    <>
    <div className="max-h-[60vh] overflow-auto">
      <table className="tbl w-full">
        <thead>
          <tr>
            <th>SKU</th>
            <th>Nome</th>
            <th>NCM</th>
            <th>Reforma</th>
            <th className="th-r">👁</th>
          </tr>
        </thead>
        <tbody>
          {visiveis.map((it, i) => (
            <LinhaTabela key={`${it.indice}-${i}`} item={it} indice={i} onDetalhe={() => setDetalhe(it)} />
          ))}
          {resumo.itens.length > ROWS_LIMIT ? (
            <tr>
              <td colSpan={5} className="px-3 py-3 text-center text-[11px] text-slate-500">
                Exibindo as primeiras {ROWS_LIMIT} de {resumo.itens.length} linhas. 👁 abre CFOP · CST · PIS · COFINS.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
    <ModalLoteDetalhe item={detalhe} onFechar={() => setDetalhe(null)} />
    </>
  )
}

function LinhaTabela({ item, indice, onDetalhe }: { item: ItemLote; indice: number; onDetalhe: () => void }) {
  const escolher = useLote((s) => s.escolher)

  return (
    <tr className="cursor-pointer" onClick={onDetalhe} title="👁 Ver CFOP · CST · PIS · COFINS e Reforma">
      <td className="whitespace-nowrap font-mono font-bold">{item.codigo || '—'}</td>
      <td className="max-w-[280px] truncate" title={item.nome}>
        {item.nome || '—'}
      </td>
      <td className="whitespace-nowrap font-mono">{fmtNcm(item.ncm) || item.ncm || '—'}</td>
      <td onClick={(e) => e.stopPropagation()}>{celulaLote(item, indice, escolher)}</td>
      <td className="text-right" onClick={(e) => e.stopPropagation()}>
        <Olho onClick={onDetalhe} titulo="Ver todos os tributos do item" />
      </td>
    </tr>
  )
}

/** Modal compacto do item do lote — regime anterior + Reforma. */
function ModalLoteDetalhe({ item, onFechar }: { item: ItemLote | null; onFechar: () => void }) {
  const c = item?.escolhida
  return (
    <Modal
      aberto={item !== null}
      onFechar={onFechar}
      titulo={item ? `${item.codigo || '—'} · ${item.nome || '—'}` : ''}
      subtitulo={item ? `NCM ${fmtNcm(item.ncm) || item.ncm || '—'} · CST ${c?.cst || '—'} · cClassTrib ${c?.cClassTrib || '—'}` : ''}
      largura="max-w-lg"
      rodape={null}
    >
      {item ? (
        <div className="space-y-3">
          <AvisoNcmExtinto nomenclatura={item.nomenclatura} />
          <Secao titulo="Regime anterior" icone="🧾">
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
              <Campo rotulo="CFOP" valor={item.cfop || '—'} mono />
              <Campo rotulo="CST ICMS" valor={item.cstIcms || '—'} mono />
              <Campo rotulo="PIS" valor={item.pis || '—'} mono />
              <Campo rotulo="COFINS" valor={item.cofins || '—'} mono />
            </div>
          </Secao>
          <Secao titulo="Reforma" icone="💠">
            {c?.manual ? (
              <div className="mb-2">
                <AvisoManual compact fonteDescricao={c.manual.fonteDescricao} fonteUrl={c.manual.fonteUrl} />
              </div>
            ) : null}
            {c ? (
              <div className="mb-2">
                <AvisoDiferimento cl={c} />
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
              <Campo rotulo="CST" valor={c?.cst || '—'} mono />
              <Campo rotulo="cClassTrib" valor={c?.cClassTrib || '—'} mono />
              <Campo rotulo="NCM sugerido" valor={c?.codigo ? fmtNcm(c.codigo) : '—'} mono />
            </div>
            {c?.resumo?.descricaoCClassTrib || c?.baseLegal ? (
              <p className="mt-2 text-[11px] text-slate-500">
                {c?.resumo?.descricaoCClassTrib || c?.baseLegal}
              </p>
            ) : null}
          </Secao>
        </div>
      ) : null}
    </Modal>
  )
}

/**
 * Célula "Classificação Reforma" — 3 estados da v1 (SPEC R6.10):
 * NCM inválido → regra geral (âmbar) → uma opção → seletor de N opções.
 */
function celulaLote(
  item: ItemLote,
  indice: number,
  escolher: (linha: number, opcao: number) => void,
) {
  const c = item.escolhida
  const r = c?.resumo
  const indiceEscolhido = Math.max(
    0,
    item.classificacoes.findIndex(
      (x) => x.id === c?.id && x.cst === c?.cst,
    ),
  )

  if (item.ncm.length !== 8) {
    return <span className="text-red-500">NCM inválido</span>
  }
  const seloExtinto = item.nomenclatura?.dataFim ? (
    <div className="mt-1 inline-block rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-black text-red-800 dark:bg-red-950/60 dark:text-red-200" title={`Extinto em ${item.nomenclatura.dataFim}`}>
      ⛔ extinto
    </div>
  ) : null
  if (item.manual && c) {
    return (
      <div className="rounded-lg bg-amber-50 px-2 py-1 dark:bg-amber-950/30">
        <div className="font-mono text-[11px] font-bold text-amber-800 dark:text-amber-300">
          {c.cst} · {c.cClassTrib} ✋
        </div>
        <div className="text-[10px] text-amber-700 dark:text-amber-400" title={c.manual?.fonteDescricao}>
          Manual · usuário — isenta o sistema
        </div>
        {seloExtinto}
      </div>
    )
  }
  if (item.regraGeral) {
    return (
      <div className="rounded-lg bg-amber-50 px-2 py-1 dark:bg-amber-950/30">
        <div className="font-mono text-[11px] font-bold text-amber-800 dark:text-amber-300">
          CST 000 · 000001
        </div>
        <div className="text-[10px] text-amber-700 dark:text-amber-400">
          ⚡ {r?.descricaoCClassTrib || 'Tributação integral'}
        </div>
        {seloExtinto}
      </div>
    )
  }
  if (item.classificacoes.length === 1 && c) {
    return (
      <div className="min-w-[170px]">
        <div className="font-mono text-[11px] font-bold">
          {c.cst} · {c.cClassTrib}
        </div>
        <div className="truncate text-[10px] text-slate-500" title={r?.descricaoCClassTrib}>
          {r?.descricaoCClassTrib || c.baseLegal}
        </div>
        {seloExtinto}
      </div>
    )
  }
  return (
    <div className="min-w-[210px]">
      <div className="mb-1 text-[10px] font-bold text-amber-700 dark:text-amber-300">
        ⚠ {item.classificacoes.length} opções
      </div>
      <select
        className="field field-sm field-mono w-full"
        value={indiceEscolhido}
        onChange={(e) => escolher(indice, Number(e.target.value))}
      >
        {item.classificacoes.map((op, j) => (
          <option key={`${op.id}-${j}`} value={j}>
            {op.cst} · {op.cClassTrib} —{' '}
            {(op.resumo?.descricaoCClassTrib || op.baseLegal || '').slice(0, 60)}
          </option>
        ))}
      </select>
    </div>
  )
}

/* ------------------------------------------------------------- exportação -- */

function paraLinhaLote(it: ItemLote): LinhaLote {
  const c = it.escolhida
  const situacao =
    it.ncm.length !== 8
      ? 'sem NCM válido'
      : it.manual
        ? 'manual · usuário (isenta o sistema)'
        : it.regraGeral
          ? 'regra geral'
          : it.classificacoes.length > 1
            ? `${it.classificacoes.length} opções · escolhida manualmente`
            : 'classificada'

  return {
    linha: it.indice,
    sku: it.codigo,
    produto: it.nome,
    ncmOriginal: it.ncm,
    ncmSugerido: c?.codigo ?? '',
    cfop: it.cfop,
    cst: c?.cst ?? '',
    cClassTrib: c?.cClassTrib ?? '',
    situacao,
    regraGeral: it.regraGeral,
    manual: it.manual,
  }
}
