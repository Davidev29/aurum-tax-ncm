/**
 * Tela **Classificação em lote** (SPEC §6) — com Aurum AI assistida.
 *
 * Fluxo 1 · 2 · 3:
 * 1. Enviar CSV/XLSX (COD/SKU, NOME DO PRODUTO, NCM, CFOP, CST, PIS, COFINS);
 * 2. Revisar com a IA — nome + NCM = tributação provável. Com 1 opção a IA
 *    confirma; com N opções ela explica por que há N
 *    e pré-seleciona a mais provável — a decisão final é do usuário;
 * 3. Salvar todos como produtos (upsert por SKU).
 *
 * Paridade v1: "Salvar todos" grava só linhas com SKU **e** classificação.
 * Anti-alucinação: todo comentário da IA vem de `analiseIA` (template sobre
 * CST/cClassTrib/redução/anexo/base legal oficiais) — nenhum artigo é inferido.
 * Garantia de revisão: nada é gravado sem o modal "Revisar antes de salvar"
 * (o que será salvo × o que ficará de fora + aceite explícito do usuário).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { NOME_IA } from '@/domain/aurum-ai'
import { EMITENTE_PADRAO } from '@/domain/entities'
import { fmtNcm } from '@/domain/services/format'
import type { AnaliseLoteIA } from '@/domain/services/analise-lote-ia'
import { baixarModeloLote, exportarLotePDF } from '@/infrastructure/exporters/relatorios'
import { registrarExportador } from '@/infrastructure/pdf/menu-exportacao'
import type { LinhaLote } from '@/infrastructure/exporters/relatorios'
import type { ItemLote, ResumoLote } from '@/infrastructure/parsers/lote'
import { dividirLoteParaSalvamento, origemLinhaLote } from '@/domain/services/salvamento-lote'
import { useLote } from '@/store/lote'
import { useSessao } from '@/store/sessao'
import { useUi, toast } from '@/store/ui'
import {
  AvisoDiferimento,
  AvisoManual,
  AvisoNcmExtinto,
  BotaoVerLegislacao,
  ZonaArquivo,
} from '@/ui/cartoes'
import {
  AtribuicaoAurumAI,
  BarraConfiancaAurumAI,
  FontesAurumAI,
  MolduraAurumAI,
  SeloAurumAI,
} from '@/ui/aurum-ai'
import { BarraProgresso, Btn, Check, Modal, Painel, Texto } from '@/ui/kit'
import { Entrada, Revelar } from '@/ui/motion'
import { AurinhaLote } from '@/ui/aurinha-lote'
import { Campo, Olho, Secao, SecaoInformacoesAdicionais } from '@/ui/detalhes'

/**
 * Primeira tela do lote: página 1 com todos os produtos (filtro `todos`).
 * 50 linhas por página mantêm o DOM leve; o usuário folheia até cobrir tudo.
 */
const LOTE_POR_PAGINA = 50

type FiltroLote = 'todos' | 'multiplas' | 'regra-geral' | 'invalidos' | 'unicas'

const FILTROS: { id: FiltroLote; rotulo: string; dica: string }[] = [
  { id: 'todos', rotulo: 'Todos', dica: 'Todas as linhas processadas' },
  { id: 'multiplas', rotulo: 'Escolha assistida', dica: 'NCM com 2+ tributações — a IA sugere a mais provável' },
  { id: 'regra-geral', rotulo: 'Regra geral', dica: 'Sem vínculo oficial — tributação integral vigente' },
  { id: 'invalidos', rotulo: 'Inválidos', dica: 'NCM fora do padrão de 8 dígitos' },
  { id: 'unicas', rotulo: 'Únicas', dica: 'Tributação única confirmada' },
]

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
  // PDF do lote: giro no botão enquanto o pdfMake monta o documento.
  const [gerandoPdf, setGerandoPdf] = useState(false)
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<FiltroLote>('todos')
  const [pagina, setPagina] = useState(1)
  const [expandidos, setExpandidos] = useState<Set<number>>(new Set())
  const resultadosRef = useRef<HTMLElement>(null)
  // Garantia de revisão: o salvamento só acontece dentro do modal de
  // confirmação — abrir a tabela não salva nada sozinho.
  const [revisaoAberta, setRevisaoAberta] = useState(false)

  const aoConfirmarSalvar = async () => {
    setSalvando(true)
    try {
      const ok = await salvarTodos()
      if (ok) {
        setRevisaoAberta(false)
        trocarView('produtos')
      }
    } finally {
      setSalvando(false)
    }
  }

  const exportarPdf = async () => {
    if (!resumo || gerandoPdf) return
    setGerandoPdf(true)
    try {
      await exportarLotePDF(
        resumo.itens.map(paraLinhaLote),
        emitente ?? EMITENTE_PADRAO,
        resumo.nomeArquivo,
      )
      toast('PDF do lote gerado.', 'ok')
    } catch (e) {
      toast(`Erro ao gerar PDF: ${e instanceof Error ? e.message : String(e)}`, 'err')
    } finally {
      setGerandoPdf(false)
    }
  }

  useEffect(() => registrarExportador('lote', () => void exportarPdf()), [exportarPdf])
  // Nova análise: sempre entrega o usuário na PRIMEIRA tela com TODOS os
  // produtos — filtro `todos`, página 1, busca zerada. Nunca cai filtrado.
  const nomeResumo = resumo?.nomeArquivo
  useEffect(() => {
    if (resumo) {
      setBusca('')
      setFiltro('todos')
      setPagina(1)
      setExpandidos(new Set())
    }
  }, [nomeResumo]) // eslint-disable-line react-hooks/exhaustive-deps
  // Trocar busca/filtro volta para a primeira página.
  useEffect(() => {
    setPagina(1)
  }, [busca, filtro])
  // Ao concluir, leva o usuário para a primeira tela de resultados, com todos
  // os produtos. A lâmpada de conclusão acende NO PET da sidebar (eureka).
  useEffect(() => {
    if (!resumo || processando) return
    window.requestAnimationFrame(() => {
      resultadosRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [nomeResumo, processando]) // eslint-disable-line react-hooks/exhaustive-deps

  const etapa = !resumo ? 1 : processando ? 1 : 3

  return (
    <div className="lote mx-auto max-w-6xl space-y-5">
      {/* ------------------------------------------------ HERO + stepper -- */}
      <Entrada>
      <Painel className="lote-hero overflow-hidden">
        <div className="lote-hero-faixa" aria-hidden="true" />
        <div className="flex flex-wrap items-start gap-4 p-5 sm:p-6">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="lote-hero-icone" aria-hidden="true">📁</span>
              <h2 className="text-base font-black tracking-tight sm:text-lg">
                Classificação em lote
              </h2>
              <SeloAurumAI variante="compacto" titulo={`${NOME_IA} assistida: nome + NCM = tributação provável, sempre validada pela base oficial`} />
            </div>
            <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Envie CSV/Excel com colunas COD/SKU, NOME DO PRODUTO, NCM, CFOP, CST, PIS, COFINS.
              A {NOME_IA} lê o <strong>nome + NCM</strong> de cada linha: com 1 tributação ela confirma;
              com 2+ ela explica <strong>por que há várias</strong> e
              <strong> pré-seleciona a mais provável</strong> — você confere e confirma.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <AtribuicaoAurumAI detalhe="nome + NCM = tributação provável" />
              <span className="lote-garantia" title="A Aurum AI roda 100% local neste computador: lê o nome + NCM e sugere entre as tributações oficiais da base do sistema.">
                💻 Aurum AI — sua inteligência artificial rodando local
              </span>
            </div>
          </div>
          <ol className="lote-steps" aria-label="Etapas da importação em lote">
            {['Enviar', 'Revisar IA', 'Salvar'].map((rot, i) => {
              const n = i + 1
              const estado = n < etapa || (resumo && n === 2) ? 'feito' : n === etapa ? 'atual' : 'todo'
              return (
                <li key={rot} className={`lote-step lote-step--${estado}`}>
                  <span className="lote-step-num" aria-hidden="true">
                    {estado === 'feito' ? '✓' : n}
                  </span>
                  <span className="lote-step-rot">{rot}</span>
                  {i < 2 ? <span className="lote-step-linha" aria-hidden="true" /> : null}
                </li>
              )
            })}
          </ol>
        </div>
      </Painel>
      </Entrada>

      {/* ---------------------------------------------------------- envio -- */}
      <Revelar>
      <Painel>
        <div className="p-5">
          <ZonaArquivo
            onArquivo={(f) => void processar(f)}
            accept=".csv,.xlsx,.xls,.txt"
            rotulo="Arraste a planilha"
            dica="Aceita CSV, XLSX e XLS · o NCM manda, o nome assiste"
            desabilitada={processando}
            icone="📄"
          />

          {processando ? (
            <div className="lote-processando mt-4" role="status" aria-live="polite">
              <AurinhaLote progresso={progresso} />
              <div className="mt-2">
                <BarraProgresso pct={progresso} etapa="Nada é salvo antes da sua revisão — pode acompanhar." />
              </div>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <Btn onClick={baixarModeloLote}>⬇ Baixar modelo CSV</Btn>
            {resumo ? (
              <Btn
                onClick={() => {
                  limpar()
                  setBusca('')
                  setFiltro('todos')
                  setPagina(1)
                  setExpandidos(new Set())
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

          {!resumo && !processando && !erro ? (
            <div className="lote-como-funciona mt-4 grid gap-2 sm:grid-cols-3">
              {[
                { t: '1 · NCM manda', d: 'Cada linha é resolvida pelo motor único (vínculos oficiais ou regra geral).' },
                { t: '2 · Nome assiste', d: 'Com 2+ opções, a IA ordena pela aderência do nome e explica cada base legal.' },
                { t: '3 · Você decide', d: 'A sugestão já vem pré-selecionada — troque se a operação pedir e salve.' },
              ].map((c) => (
                <div key={c.t} className="lote-mini">
                  <div className="text-[11px] font-black">{c.t}</div>
                  <div className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{c.d}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </Painel>
      </Revelar>

      {resumo ? (
        <section ref={resultadosRef} className="scroll-mt-20 space-y-4" aria-label="Resultados da análise em lote" tabIndex={-1}>
          <Revelar><ResumoHero resumo={resumo} /></Revelar>
          <Revelar atraso={0.05}>
          <BarraFerramentas
            resumo={resumo}
            busca={busca}
            onBusca={setBusca}
            filtro={filtro}
            onFiltro={(f) => { setFiltro(f); setPagina(1) }}
            onExportar={() => void exportarPdf()}
            exportandoPdf={gerandoPdf}
            onSalvar={() => setRevisaoAberta(true)}
            salvando={salvando}
          />
          </Revelar>
          <Revelar atraso={0.1}>
          <TabelaLote
            resumo={resumo}
            busca={busca}
            filtro={filtro}
            pagina={pagina}
            onPagina={setPagina}
            expandidos={expandidos}
            onAlternar={(idx) =>
              setExpandidos((ant) => {
                const nx = new Set(ant)
                if (nx.has(idx)) nx.delete(idx)
                else nx.add(idx)
                return nx
              })
            }
          />
          </Revelar>
          <ModalRevisaoSalvamento
            aberto={revisaoAberta}
            resumo={resumo}
            salvando={salvando}
            onFechar={() => !salvando && setRevisaoAberta(false)}
            onConfirmar={() => void aoConfirmarSalvar()}
          />
        </section>
      ) : null}
    </div>
  )
}

/* ---------------------------------------------------------- resumo hero -- */

function ResumoHero({ resumo }: { resumo: ResumoLote }) {
  const assistidas = resumo.assistidas ?? resumo.itens.filter((i) => (i.analiseIA?.confianca ?? 0) >= 0.6 && i.analiseIA?.situacao === 'multipla').length
  const unicas = resumo.unicas ?? resumo.itens.filter((i) => i.analiseIA?.situacao === 'unica').length
  const cards = [
    { rot: 'Linhas', val: resumo.itens.length, sub: resumo.nomeArquivo, tom: '' as const, icone: '📄' },
    { rot: 'Classificadas', val: resumo.comClassificacao, sub: `${unicas} únicas confirmadas`, tom: 'ok' as const, icone: '✅' },
    { rot: `✨ ${NOME_IA} sugere`, val: resumo.ambiguos, sub: `${assistidas} com sugestão forte`, tom: 'ia' as const, icone: '✨' },
    { rot: 'Regra geral', val: resumo.regraGeral, sub: 'tributação integral vigente', tom: 'warn' as const, icone: '⚡' },
    { rot: 'Revisar', val: resumo.semNcm, sub: `${resumo.semNcm} inválidos`, tom: 'err' as const, icone: '👁' },
  ]
  return (
    <div className="lote-stats" role="status" aria-live="polite">
      {cards.map((c, i) => (
        <div
          key={c.rot}
          className={`lote-stat lote-stat--${c.tom || 'base'} animate-fade-up`}
          style={{ animationDelay: `${Math.min(i * 60, 300)}ms` }}
          title={c.sub}
        >
          <span className="lote-stat-icone" aria-hidden="true">{c.icone}</span>
          <span className="lote-stat-num num">{c.val}</span>
          <span className="lote-stat-rot">{c.rot}</span>
          <span className="lote-stat-sub">{c.sub}</span>
        </div>
      ))}
    </div>
  )
}

/* ---------------------------------------------------------- ferramentas -- */

function BarraFerramentas({
  resumo,
  busca,
  onBusca,
  filtro,
  onFiltro,
  onExportar,
  exportandoPdf,
  onSalvar,
  salvando,
}: {
  resumo: ResumoLote
  busca: string
  onBusca: (v: string) => void
  filtro: FiltroLote
  onFiltro: (f: FiltroLote) => void
  onExportar: () => void
  exportandoPdf: boolean
  onSalvar: () => void
  salvando: boolean
}) {
  const cont = useMemo(() => contarFiltros(resumo), [resumo])
  return (
    <Painel className="lote-toolbar">
      <div className="flex flex-wrap items-center gap-2 p-4">
        <div className="lote-busca">
          <Texto
            value={busca}
            onChange={(e) => onBusca(e.target.value)}
            placeholder="🔍 Buscar SKU, produto ou NCM…"
            aria-label="Buscar por SKU, produto ou NCM"
            className="field-sm"
          />
        </div>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filtrar linhas do lote">
          {FILTROS.map((f) => {
            const n = cont[f.id] ?? 0
            const ativo = filtro === f.id
            return (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={ativo}
                title={f.dica}
                onClick={() => onFiltro(f.id)}
                className={`lote-filtro${ativo ? ' is-ativo' : ''}`}
              >
                {f.rotulo}
                <span className="lote-filtro-num num">{n}</span>
              </button>
            )
          })}
        </div>
        <div className="flex flex-1 flex-wrap justify-end gap-2">
          <Btn tam="sm" carregando={exportandoPdf} onClick={onExportar}>
            {exportandoPdf ? 'Gerando…' : '📕 PDF'}
          </Btn>
          <Btn variante="primary" tam="sm" carregando={salvando} onClick={onSalvar} title="Abre a revisão completa antes de salvar — nada é gravado sem o seu aceite">
            {salvando ? 'Salvando…' : '💾 Revisar e salvar…'}
          </Btn>
        </div>
      </div>
      <p className="lote-toolbar-dica">
        ✨ A sugestão da {NOME_IA} já vem <strong>pré-selecionada</strong> em cada linha — abra a linha, leia o porquê e confirme ou troque. <strong>Nada é salvo sem a sua revisão e aceite no “Revisar e salvar…”.</strong>
      </p>
    </Painel>
  )
}

/* --------------------------------------------- revisão antes de salvar -- */

/**
 * Modal obrigatório "Revisar antes de salvar".
 *
 * Mostra exatamente o que será gravado × o que ficará de fora (com motivo
 * por linha ignorada) + alertas (NCM extinto, regra geral,
 * sugestão trocada) e só libera o botão após o aceite explícito.
 * Sem aceite, `salvarTodos` nunca é chamado.
 */
function ModalRevisaoSalvamento({
  aberto,
  resumo,
  salvando,
  onFechar,
  onConfirmar,
}: {
  aberto: boolean
  resumo: ResumoLote
  salvando: boolean
  onFechar: () => void
  onConfirmar: () => void
}) {
  const [aceite, setAceite] = useState(false)
  useEffect(() => {
    if (aberto) setAceite(false)
  }, [aberto, resumo.nomeArquivo])

  const { gravaveis, ignorados } = useMemo(
    () => dividirLoteParaSalvamento(resumo.itens),
    [resumo],
  )
  const alertas = useMemo(() => {
    const extintos = gravaveis.filter((i) => i.nomenclatura?.dataFim)
    const regraGeral = gravaveis.filter((i) => i.regraGeral)
    const trocadas = gravaveis.filter((i) => {
      const a = i.analiseIA
      if (!a || a.situacao !== 'multipla') return false
      const idx = Math.max(
        0,
        i.classificacoes.findIndex((x) => x.id === i.escolhida?.id && x.cst === i.escolhida?.cst),
      )
      return idx !== a.maisProvavelIndice
    })
    return { extintos, regraGeral, trocadas }
  }, [gravaveis])

  const preview = gravaveis.slice(0, 8)
  const ignoradosPreview = ignorados.slice(0, 8)

  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo="Revisar antes de salvar"
      subtitulo={`${resumo.nomeArquivo} · ${gravaveis.length} para salvar · ${ignorados.length} ficarão de fora`}
      largura="max-w-2xl"
      rodape={
        <>
          <Btn tam="sm" onClick={onFechar} disabled={salvando}>
            Voltar e revisar
          </Btn>
          <Btn
            variante="primary"
            tam="sm"
            disabled={!aceite || !gravaveis.length}
            carregando={salvando}
            onClick={onConfirmar}
            title={
              !gravaveis.length
                ? 'Nada para salvar — todas as linhas estão sem SKU ou sem classificação'
                : !aceite
                  ? 'Marque o aceite abaixo após revisar os dados'
                  : `Confirmar e salvar ${gravaveis.length} produtos`
            }
          >
            {salvando ? 'Salvando…' : `✓ Confirmar e salvar ${gravaveis.length}`}
          </Btn>
        </>
      }
    >
      <div className="lote-confirm space-y-3">
        <div className="lote-confirm-nums" role="status" aria-live="polite">
          <span className="lote-confirm-num lote-confirm-num--ok">✓ {gravaveis.length} serão salvos</span>
          <span className="lote-confirm-num lote-confirm-num--fora">{ignorados.length} ficarão de fora</span>
          <span className="lote-confirm-num">{resumo.itens.length} linhas no arquivo</span>
        </div>

        {!gravaveis.length ? (
          <p className="lote-confirm-vazio">
            ⛔ Nada para salvar: todas as linhas estão sem SKU ou sem classificação válida.
            Corrija a planilha (COD/SKU + NCM de 8 dígitos) e reimporte.
          </p>
        ) : (
          <div className="lote-confirm-bloco">
            <div className="lote-confirm-titulo">📦 O que será salvo ({gravaveis.length})</div>
            <div className="max-h-56 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="tbl w-full">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Produto</th>
                    <th>NCM</th>
                    <th>CST · cClassTrib</th>
                    <th>Origem</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((it) => (
                    <tr key={`${it.indice}-${it.codigo}`}>
                      <td className="whitespace-nowrap font-mono font-bold">{it.codigo}</td>
                      <td className="max-w-[180px] truncate" title={it.nome}>{it.nome || '—'}</td>
                      <td className="whitespace-nowrap font-mono">{fmtNcm(it.ncm)}</td>
                      <td className="whitespace-nowrap font-mono text-[11px]">
                        {it.escolhida?.cst} · {it.escolhida?.cClassTrib}
                      </td>
                      <td className="text-[11px]">{origemLinhaLote(it)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {gravaveis.length > preview.length ? (
              <p className="lote-confirm-mais">…e mais {gravaveis.length - preview.length} linhas com o mesmo padrão (SKU + classificação exibida).</p>
            ) : null}
          </div>
        )}

        {ignorados.length ? (
          <div className="lote-confirm-bloco">
            <div className="lote-confirm-titulo">🚫 O que ficará de fora ({ignorados.length}) — nada será gravado destas linhas</div>
            <ul className="lote-confirm-lista">
              {ignoradosPreview.map(({ item, motivo }) => (
                <li key={`${item.indice}-${item.codigo || 'sem-sku'}`}>
                  <span className="font-mono font-bold">{item.codigo || `(linha ${item.indice})`}</span>
                  {' · '}{item.nome ? `${item.nome.slice(0, 50)} · ` : ''}{motivo}
                </li>
              ))}
            </ul>
            {ignorados.length > ignoradosPreview.length ? (
              <p className="lote-confirm-mais">…e mais {ignorados.length - ignoradosPreview.length} linhas ignoradas pelo mesmo motivo.</p>
            ) : null}
          </div>
        ) : null}

        {alertas.extintos.length || alertas.regraGeral.length || alertas.trocadas.length ? (
          <div className="lote-confirm-bloco lote-confirm-bloco--alerta">
            <div className="lote-confirm-titulo">⚠ Pontos de atenção antes de confirmar</div>
            <ul className="lote-confirm-lista">
              {alertas.extintos.length ? (
                <li>⛔ {alertas.extintos.length} com NCM extinto — a tributação é só referência histórica, confira o NCM substituto.</li>
              ) : null}
              {alertas.regraGeral.length ? (
                <li>⚡ {alertas.regraGeral.length} em regra geral (tributação integral vigente — sem vínculo oficial).</li>
              ) : null}
              {alertas.trocadas.length ? (
                <li>✨ {alertas.trocadas.length} onde você trocou a sugestão da {NOME_IA} — vale a sua escolha.</li>
              ) : null}
            </ul>
          </div>
        ) : null}

        <Check
          label={`Revisei os ${gravaveis.length} produtos acima (CST · cClassTrib · origem) e autorizo salvar — ${ignorados.length} linhas ficarão de fora.`}
          checked={aceite}
          onChange={(e) => setAceite(e.target.checked)}
        />
        <p className="lote-confirm-nota">
          Upsert por SKU: se o SKU já existir no cadastro, ele será atualizado com a classificação exibida.
        </p>
      </div>
    </Modal>
  )
}

function contarFiltros(resumo: ResumoLote): Record<FiltroLote, number> {
  const itens = resumo.itens
  return {
    todos: itens.length,
    multiplas: itens.filter((i) => i.classificacoes.length > 1).length,
    'regra-geral': itens.filter((i) => i.regraGeral).length,
    invalidos: itens.filter((i) => i.ncm.length !== 8).length,
    unicas: itens.filter((i) => i.analiseIA?.situacao === 'unica').length,
  }
}

/* --------------------------------------------------------------- tabela -- */

function TabelaLote({
  resumo,
  busca,
  filtro,
  pagina,
  onPagina,
  expandidos,
  onAlternar,
}: {
  resumo: ResumoLote
  busca: string
  filtro: FiltroLote
  pagina: number
  onPagina: (p: number) => void
  expandidos: Set<number>
  onAlternar: (indiceOriginal: number) => void
}) {
  const [detalhe, setDetalhe] = useState<{ item: ItemLote; indiceOriginal: number } | null>(null)

  const linhas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return resumo.itens
      .map((item, indiceOriginal) => ({ item, indiceOriginal }))
      .filter(({ item }) => {
        if (filtro === 'multiplas' && item.classificacoes.length <= 1) return false
        if (filtro === 'regra-geral' && !item.regraGeral) return false
        if (filtro === 'invalidos' && item.ncm.length === 8) return false
        if (filtro === 'unicas' && item.analiseIA?.situacao !== 'unica') return false
        if (!q) return true
        const alvo = `${item.codigo} ${item.nome} ${item.ncm}`.toLowerCase()
        return alvo.includes(q)
      })
  }, [resumo, busca, filtro])

  // Primeira tela primeiro: página 1 com todos os produtos; o usuário folheia
  // para cobrir o restante sem perder o filtro/busca.
  const totalPag = Math.max(1, Math.ceil(linhas.length / LOTE_POR_PAGINA))
  const pg = Math.min(Math.max(1, pagina), totalPag)
  const inicio = (pg - 1) * LOTE_POR_PAGINA
  const visiveis = linhas.slice(inicio, inicio + LOTE_POR_PAGINA)
  const fim = Math.min(inicio + visiveis.length, linhas.length)

  if (!linhas.length) {
    return (
      <Painel className="p-8 text-center">
        <div className="text-3xl opacity-60" aria-hidden="true">🔍</div>
        <div className="mt-2 text-sm font-bold">Nenhuma linha neste filtro</div>
        <p className="mt-1 text-xs text-slate-500">
          Ajuste a busca ou escolha outro filtro — a análise completa continua salva acima.
        </p>
      </Painel>
    )
  }

  return (
    <>
      <Painel className="lote-tabela overflow-hidden">
        <div className="lote-tabela-rolagem max-h-[62vh] overflow-auto">
          <table className="tbl lote-tbl w-full">
            <thead>
              <tr>
                <th>SKU · Produto · NCM</th>
                <th>Tributação</th>
                <th>
                  <span className="inline-flex items-center gap-1">✨ {NOME_IA}</span>
                </th>
                <th className="th-r">Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map(({ item, indiceOriginal }, i) => {
                const aberto = expandidos.has(indiceOriginal)
                return (
                  <LinhaLote
                    key={`${item.indice}-${indiceOriginal}`}
                    item={item}
                    indiceOriginal={indiceOriginal}
                    aberto={aberto}
                    atraso={Math.min(i * 25, 400)}
                    onAlternar={() => onAlternar(indiceOriginal)}
                    onDetalhe={() => setDetalhe({ item, indiceOriginal })}
                  />
                )
              })}
              {linhas.length > LOTE_POR_PAGINA ? (
                <tr>
                  <td colSpan={4} className="px-0 py-0">
                    <div className="lote-paginacao">
                      <span className="lote-paginacao-cont num">
                        Mostrando {linhas.length ? inicio + 1 : 0}–{fim} de {linhas.length} linhas
                        {filtro !== 'todos' || busca.trim() ? ' (filtro)' : ''} · {resumo.itens.length} no arquivo
                      </span>
                      <span className="lote-paginacao-nav">
                        <button
                          type="button"
                          className="lote-paginacao-btn"
                          disabled={pg <= 1}
                          onClick={() => onPagina(pg - 1)}
                          aria-label="Página anterior"
                        >
                          ‹ Anterior
                        </button>
                        <span className="lote-paginacao-pag num" aria-live="polite">
                          Página {pg} de {totalPag}
                        </span>
                        <button
                          type="button"
                          className="lote-paginacao-btn"
                          disabled={pg >= totalPag}
                          onClick={() => onPagina(pg + 1)}
                          aria-label="Próxima página"
                        >
                          Próxima ›
                        </button>
                      </span>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr>
                  <td colSpan={4} className="px-3 py-3 text-center text-[11px] text-slate-500">
                    Exibindo todas as {linhas.length} linhas filtradas ({resumo.itens.length} no arquivo).
                    A seta abre a análise da {NOME_IA}; 👁 abre CFOP · CST · PIS · COFINS e Reforma.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Painel>
      <ModalLoteDetalhe
        item={detalhe?.item ?? null}
        indiceOriginal={detalhe?.indiceOriginal ?? 0}
        onFechar={() => setDetalhe(null)}
      />
    </>
  )
}

function LinhaLote({
  item,
  indiceOriginal,
  aberto,
  atraso,
  onAlternar,
  onDetalhe,
}: {
  item: ItemLote
  indiceOriginal: number
  aberto: boolean
  atraso: number
  onAlternar: () => void
  onDetalhe: () => void
}) {
  const escolher = useLote((s) => s.escolher)
  const analise = item.analiseIA
  const c = item.escolhida
  const sugerida = analise ? analise.maisProvavelIndice : 0
  const indiceEscolhido = Math.max(
    0,
    item.classificacoes.findIndex((x) => x.id === c?.id && x.cst === c?.cst),
  )
  const trocouSugestao = analise && analise.totalOpcoes > 1 && indiceEscolhido !== sugerida
  const precisaRevisao = item.ncm.length !== 8 || item.classificacoes.length > 1

  return (
    <>
      <tr
        className={`lote-linha animate-fade-up${aberto ? ' is-aberta' : ''}${precisaRevisao ? ' precisa-revisao' : ''}`}
        style={{ animationDelay: `${atraso}ms` }}
      >
        <td className="min-w-[220px]">
          <button type="button" onClick={onAlternar} className="lote-expansor" aria-expanded={aberto} title={aberto ? 'Recolher análise da IA' : 'Expandir análise da IA'}>
            <span className={`lote-chevron${aberto ? ' is-aberto' : ''}`} aria-hidden="true">▸</span>
            <span className="min-w-0 text-left">
              <span className="block truncate font-mono text-[11px] font-black">{item.codigo || '—'}</span>
              <span className="block max-w-[260px] truncate text-xs font-semibold" title={item.nome}>{item.nome || '—'}</span>
              <span className="block font-mono text-[10px] text-slate-500">NCM {fmtNcm(item.ncm) || item.ncm || '—'}</span>
            </span>
          </button>
        </td>
        <td onClick={(e) => e.stopPropagation()} className="min-w-[190px]">
          {celulaLote(item, indiceOriginal, escolher)}
        </td>
        <td className="min-w-[170px]">
          <CelulaIA item={item} indiceEscolhido={indiceEscolhido} trocouSugestao={Boolean(trocouSugestao)} />
        </td>
        <td className="text-right" onClick={(e) => e.stopPropagation()}>
          <Olho onClick={onDetalhe} titulo="Ver todos os tributos do item + análise da IA" />
        </td>
      </tr>
      {aberto ? (
        <tr className="lote-expansao">
          <td colSpan={4}>
            <PainelAnaliseIA item={item} indiceOriginal={indiceOriginal} indiceEscolhido={indiceEscolhido} onDetalhe={onDetalhe} />
          </td>
        </tr>
      ) : null}
    </>
  )
}

/** Selo compacto da IA na grade: confiança + estado da sugestão. */
function CelulaIA({ item, indiceEscolhido, trocouSugestao }: { item: ItemLote; indiceEscolhido: number; trocouSugestao: boolean }) {
  const a = item.analiseIA
  if (!a) return <span className="text-[11px] text-slate-400">—</span>
  if (a.situacao === 'invalida') {
    return (
      <span className="lote-ia lote-ia--erro" title={a.resumo}>
        <span aria-hidden="true">⛔</span> corrigir NCM
      </span>
    )
  }
  if (a.situacao === 'extinta') {
    return (
      <span className="lote-ia lote-ia--erro" title={a.resumo}>
        <span aria-hidden="true">⛔</span> NCM extinto
      </span>
    )
  }
  if (a.situacao === 'manual') {
    return (
      <span className="lote-ia lote-ia--manual" title={a.resumo}>
        <span aria-hidden="true">👤</span> sua regra
      </span>
    )
  }
  if (a.situacao === 'regra-geral') {
    return (
      <span className="lote-ia lote-ia--geral" title={a.resumo}>
        <span aria-hidden="true">⚡</span> regra geral
      </span>
    )
  }
  if (a.situacao === 'unica') {
    return (
      <span className="lote-ia lote-ia--ok" title={a.resumo}>
        <span aria-hidden="true">✓</span> única · confirmada
        <BarraConfiancaAurumAI valor={a.confianca} compact />
      </span>
    )
  }
  return (
    <span className="lote-ia lote-ia--multi" title={a.resumo}>
      <span aria-hidden="true">✨</span> sugere Opção {a.maisProvavelIndice + 1}/{a.totalOpcoes}
      <BarraConfiancaAurumAI valor={a.confianca} compact />
      {trocouSugestao ? (
        <span className="lote-ia-trocou" title={`Você escolheu a Opção ${indiceEscolhido + 1}; a IA sugeria a Opção ${a.maisProvavelIndice + 1}. A decisão final é sua.`}>
          você optou pela {indiceEscolhido + 1}
        </span>
      ) : (
        <span className="lote-ia-ok" title="A sugestão da IA está selecionada — confira a análise abrindo a linha.">
          pré-selecionada ✓
        </span>
      )}
    </span>
  )
}

/* -------------------------------------------------- análise expandida -- */

/** Painel inline da linha: porquê das N opções + cards de escolha assistida. */
function PainelAnaliseIA({
  item,
  indiceOriginal,
  indiceEscolhido,
  onDetalhe,
}: {
  item: ItemLote
  indiceOriginal: number
  indiceEscolhido: number
  onDetalhe: () => void
}) {
  const escolher = useLote((s) => s.escolher)
  const a: AnaliseLoteIA | null | undefined = item.analiseIA
  if (!a) return null
  const sugerida = a.maisProvavelIndice

  return (
    <div className="lote-analise animate-fade-up" aria-label={`Análise da ${NOME_IA} para ${item.codigo || 'item'}`}>
      <div className="lote-analise-cab">
        <SeloAurumAI variante="compacto" />
        <span className="text-[11px] font-black uppercase tracking-wide">{a.titulo}</span>
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <BarraConfiancaAurumAI valor={a.confianca} />
          <button type="button" onClick={onDetalhe} className="lote-link" title="Abrir o cartão completo (regime anterior + Reforma + análise)">
            👁 cartão completo
          </button>
        </span>
      </div>

      <p className="lote-analise-resumo">{a.resumo}</p>

      {a.porqueMultiplas ? (
        <div className="lote-porque">
          <div className="lote-porque-titulo">💬 Por que {a.totalOpcoes} tributações?</div>
          <p>{a.porqueMultiplas}</p>
        </div>
      ) : null}

      {a.alertas.length ? (
        <ul className="lote-alertas">
          {a.alertas.map((al, i) => (
            <li key={i}>⚠ {al}</li>
          ))}
        </ul>
      ) : null}

      {a.opcoes.length > 1 ? (
        <div className="lote-opcoes" role="radiogroup" aria-label={`Opções oficiais para o NCM ${fmtNcm(item.ncm)}`}>
          {a.opcoes.map((op) => {
            const selecionada = op.indice === indiceEscolhido
            const ehSugerida = op.indice === sugerida
            return (
              <div
                key={op.indice}
                role="radio"
                aria-checked={selecionada}
                tabIndex={0}
                onClick={() => escolher(indiceOriginal, op.indice)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    escolher(indiceOriginal, op.indice)
                  }
                }}
                className={`lote-opcao${selecionada ? ' is-selecionada' : ''}${ehSugerida ? ' is-sugerida' : ''}`}
                aria-label={`Opção ${op.indice + 1}: CST ${op.cst}, cClassTrib ${op.cClassTrib}${ehSugerida ? ' (sugestão da IA)' : ''}`}
              >
                <span className="lote-opcao-topo">
                  <span className="lote-opcao-radio" aria-hidden="true">{selecionada ? '●' : '○'}</span>
                  <span className="font-mono text-[11px] font-black">
                    Opção {op.indice + 1} · {op.cst} · {op.cClassTrib}
                  </span>
                  {ehSugerida ? (
                    <span className="lote-opcao-selo" title="Sugestão da IA pela aderência do nome — confira a base legal antes de salvar.">
                      ✨ sugere a {NOME_IA}
                    </span>
                  ) : null}
                  {selecionada && !ehSugerida ? (
                    <span className="lote-opcao-selo lote-opcao-selo--sua" title="Você trocou a sugestão da IA — a decisão final é sua e fica registrada.">
                      sua escolha
                    </span>
                  ) : null}
                </span>
                <span className="lote-opcao-comentario">{op.comentario}</span>
                <span className="lote-opcao-acoes" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                  {op.urlLegislacao ? (
                    <BotaoVerLegislacao
                      url={op.urlLegislacao}
                      titulo={`Base legal — CST ${op.cst}/${op.cClassTrib}`}
                      referencia={op.baseLegal}
                      texto={op.descricao}
                      rotulo="Ver base legal"
                      className="lote-link"
                    />
                  ) : (
                    <span className="text-[10px] text-slate-400" title="A base oficial não traz URL de legislação para este enquadramento — a fundamentação exibida é o texto da base.">
                      Base: {op.baseLegal.slice(0, 80)}
                    </span>
                  )}
                  {!selecionada ? (
                    <button
                      type="button"
                      className="lote-link lote-link--forte"
                      onClick={() => escolher(indiceOriginal, op.indice)}
                    >
                      escolher esta →
                    </button>
                  ) : null}
                </span>
              </div>
            )
          })}
        </div>
      ) : null}

      <p className="lote-orientacao">🧭 {a.orientacaoEscolha}</p>
      <FontesAurumAI fontes={a.fontes} />
    </div>
  )
}

/** Modal compacto do item do lote — regime anterior + Reforma + análise IA. */
function ModalLoteDetalhe({ item, indiceOriginal, onFechar }: { item: ItemLote | null; indiceOriginal: number; onFechar: () => void }) {
  const escolher = useLote((s) => s.escolher)
  const c = item?.escolhida
  const a = item?.analiseIA
  const indiceEscolhido = item
    ? Math.max(0, item.classificacoes.findIndex((x) => x.id === c?.id && x.cst === c?.cst))
    : 0
  return (
    <Modal
      aberto={item !== null}
      onFechar={onFechar}
      titulo={item ? `${item.codigo || '—'} · ${item.nome || '—'}` : ''}
      subtitulo={item ? `NCM ${fmtNcm(item.ncm) || item.ncm || '—'} · CST ${c?.cst || '—'} · cClassTrib ${c?.cClassTrib || '—'}` : ''}
      largura="max-w-2xl"
      rodape={null}
    >
      {item && a ? (
        <div className="space-y-3">
          <AvisoNcmExtinto nomenclatura={item.nomenclatura} />
          <MolduraAurumAI detalhe={a.titulo}>
            <p className="text-xs leading-relaxed">{a.resumo}</p>
            {a.porqueMultiplas ? (
              <p className="mt-2 text-xs leading-relaxed"><strong>💬 Por que {a.totalOpcoes}?</strong> {a.porqueMultiplas}</p>
            ) : null}
            {a.opcoes.length > 1 ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold">Trocar enquadramento:</span>
                <select
                  className="field field-sm field-mono max-w-full"
                  value={indiceEscolhido}
                  onChange={(e) => escolher(indiceOriginal, Number(e.target.value))}
                  aria-label="Escolher entre as tributações oficiais"
                >
                  {item.classificacoes.map((op, j) => (
                    <option key={`${op.id}-${j}`} value={j}>
                      {j === a.maisProvavelIndice ? '✨ ' : ''}Opção {j + 1}: {op.cst} · {op.cClassTrib} —{' '}
                      {(op.resumo?.descricaoCClassTrib || op.baseLegal || '').slice(0, 60)}
                    </option>
                  ))}
                </select>
                <BarraConfiancaAurumAI valor={a.confianca} compact />
              </div>
            ) : null}
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">🧭 {a.orientacaoEscolha}</p>
            <FontesAurumAI fontes={a.fontes} />
          </MolduraAurumAI>
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
            {c?.resumo?.urlLegislacao || c?.referencia?.urlLegislacao ? (
              <BotaoVerLegislacao
                url={c.resumo?.urlLegislacao ?? c.referencia?.urlLegislacao}
                titulo={`Base legal — CST ${c.cst}/${c.cClassTrib}`}
                referencia={c.baseLegal}
                texto={c.resumo?.descricaoCClassTrib ?? null}
                rotulo="Visualizar legislação no trecho citado"
                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline dark:text-aurum-200 cursor-pointer"
              />
            ) : null}
            {c ? (
              <SecaoInformacoesAdicionais
                ncm={c.codigo || item.ncm}
                temCredito={
                  c.referencia?.creditoPresumido === true ||
                  c.referencia?.creditoPresumido === 'Sim' ||
                  c.cstClassTribDetalhes?.indCredPres === 1
                }
              />
            ) : null}
          </Secao>
        </div>
      ) : null}
    </Modal>
  )
}

/**
 * Célula "Classificação Reforma" — 3 estados da v1 (SPEC R6.10) + selo IA:
 * NCM inválido → regra geral (âmbar) → uma opção → seletor de N opções
 * (agora com ✨ na sugestão da IA).
 */
function celulaLote(
  item: ItemLote,
  indice: number,
  escolher: (linha: number, opcao: number) => void,
) {
  const c = item.escolhida
  const r = c?.resumo
  const a = item.analiseIA
  const indiceEscolhido = Math.max(
    0,
    item.classificacoes.findIndex(
      (x) => x.id === c?.id && x.cst === c?.cst,
    ),
  )

  if (item.ncm.length !== 8) {
    return <span className="lote-invalido">⛔ NCM inválido — corrija na planilha</span>
  }
  const seloExtinto = item.nomenclatura?.dataFim ? (
    <div className="mt-1 inline-block rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-black text-red-800 dark:bg-red-950/60 dark:text-red-200" title={`Extinto em ${item.nomenclatura.dataFim}`}>
      ⛔ extinto — só histórico
    </div>
  ) : null
  if (item.manual && c) {
    return (
      <div className="lote-celula lote-celula--manual">
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
      <div className="lote-celula lote-celula--geral">
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
      <div className="lote-celula min-w-[170px]">
        <div className="font-mono text-[11px] font-bold">
          {c.cst} · {c.cClassTrib} <span className="lote-ok" title={a?.resumo ?? 'Tributação única oficial.'}>✓ IA</span>
        </div>
        <div className="truncate text-[10px] text-slate-500" title={r?.descricaoCClassTrib}>
          {r?.descricaoCClassTrib || c.baseLegal}
        </div>
        {seloExtinto}
      </div>
    )
  }
  return (
    <div className="lote-celula min-w-[210px]">
      <div className="mb-1 flex items-center gap-1 text-[10px] font-bold text-amber-700 dark:text-amber-300">
        <span title={a?.porqueMultiplas ?? `${item.classificacoes.length} vínculos oficiais distintos para este NCM.`}>
          ⚠ {item.classificacoes.length} opções
        </span>
        {a ? (
          <span className="lote-sugere" title={`A ${NOME_IA} sugere a Opção ${a.maisProvavelIndice + 1} pelo nome — já pré-selecionada. ${a.resumo}`}>
            ✨ sugere {a.maisProvavelIndice + 1}
          </span>
        ) : null}
      </div>
      <select
        className="field field-sm field-mono lote-select w-full"
        value={indiceEscolhido}
        onChange={(e) => escolher(indice, Number(e.target.value))}
        aria-label={`Escolher entre as ${item.classificacoes.length} tributações oficiais`}
      >
        {item.classificacoes.map((op, j) => (
          <option key={`${op.id}-${j}`} value={j}>
            {j === a?.maisProvavelIndice ? '✨ ' : ''}{op.cst} · {op.cClassTrib} —{' '}
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
  const a = it.analiseIA
  const situacao =
    it.ncm.length !== 8
      ? 'sem NCM válido'
      : it.manual
        ? 'manual · usuário (isenta o sistema)'
        : it.regraGeral
          ? 'regra geral'
          : it.classificacoes.length > 1
            ? `${it.classificacoes.length} opções · ${NOME_IA} sugere Opção ${(a?.maisProvavelIndice ?? 0) + 1} · escolha do usuário`
            : `classificada${a ? ` · ${NOME_IA} confirma` : ''}`

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
