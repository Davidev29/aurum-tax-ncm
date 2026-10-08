/**
 * Modal **Escolher tributação** — lista as regras oficiais do NCM com base
 * na LEI (base oficial + LC 214/2025) para o usuário escolher qual se aplica
 * à operação em análise.
 *
 * - Fonte: `resolverClassificacoes` (mesmo motor da Consulta/Produtos/XML) —
 *   NCM ambíguo lista as N opções oficiais; cada uma mostra CST·cClassTrib,
 *   reduções, base legal e link da legislação, com ficha fiscal completa
 *   (`ModalDetalheFiscal`) por opção.
 * - "Usar esta tributação" salva como reclassificação manual (responsabilidade
 *   do usuário, sinalizada) e propaga para todas as telas — mesmo mecanismo
 *   do modal "Reclassificar manualmente", mas partindo das regras do próprio
 *   NCM em vez de busca livre no sistema.
 */
import { useEffect, useRef, useState } from 'react'
import type { Classificacao, NomenclaturaNcm } from '@/domain/entities'
import { fmtNcm, fmtPct, norm } from '@/domain/services/format'
import { resolverClassificacoes } from '@/infrastructure/base/classificacao-repo'
import {
  buscarReclassificacaoManual,
  removerReclassificacaoManual,
  salvarReclassificacaoManual,
} from '@/infrastructure/base/reclassificacao-repo'
import { propagarClassificacaoNcm } from '@/application/reclassificacao'
import { toast } from '@/store/ui'
import { Btn, Campo, Modal, Pill, Texto } from '@/ui/kit'
import { AvisoManual, BotaoVerLegislacao } from '@/ui/cartoes'
import { BotaoDetalhePremium, ModalDetalheFiscal } from '@/ui/consulta-premium'

export function ModalEscolhaTributacao({
  aberto,
  ncm,
  nomenclatura: nomenclaturaProp = null,
  vigente = null,
  onFechar,
  onSalvo,
}: {
  aberto: boolean
  /** NCM de 8 dígitos (com ou sem máscara). */
  ncm: string
  nomenclatura?: NomenclaturaNcm | null
  /** Tributação aplicada hoje (para selo "Aplicada atualmente"). */
  vigente?: { cst: string; cClassTrib: string } | null
  onFechar: () => void
  /** Chamado após salvar/excluir para a tela recarregar a classificação vigente. */
  onSalvo: () => void
}) {
  const codigo = norm(ncm)
  const [opcoes, setOpcoes] = useState<Classificacao[]>([])
  const [nomenclatura, setNomenclatura] = useState<NomenclaturaNcm | null>(nomenclaturaProp)
  const [ehRegraGeral, setEhRegraGeral] = useState(false)
  const [temManual, setTemManual] = useState(false)
  const [selecionada, setSelecionada] = useState<Classificacao | null>(null)
  const [fiscalAberta, setFiscalAberta] = useState<Classificacao | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  // Sem link oficial na regra: pede fonte + link antes de confirmar.
  const [semLink, setSemLink] = useState(false)
  const [descricao, setDescricao] = useState('')
  const [fonteDescricao, setFonteDescricao] = useState('')
  const [fonteUrl, setFonteUrl] = useState('')
  const seq = useRef(0)

  useEffect(() => {
    if (!aberto) return
    const id = ++seq.current
    setOpcoes([])
    setNomenclatura(nomenclaturaProp)
    setEhRegraGeral(false)
    setTemManual(false)
    setSelecionada(null)
    setFiscalAberta(null)
    setErro(null)
    setSemLink(false)
    setDescricao('')
    setFonteDescricao('')
    setFonteUrl('')
    setCarregando(true)
    void (async () => {
      try {
        const [r, manual] = await Promise.all([
          resolverClassificacoes(codigo),
          buscarReclassificacaoManual(codigo),
        ])
        if (seq.current !== id) return
        setOpcoes(r.lista)
        if (!nomenclaturaProp) setNomenclatura(r.nomenclatura)
        setEhRegraGeral(r.regraGeral)
        setTemManual(r.manual || manual != null)
        const alvo = r.lista.find(
          (cl) =>
            vigente &&
            cl.cst === String(vigente.cst ?? '').trim() &&
            cl.cClassTrib === String(vigente.cClassTrib ?? '').trim(),
        )
        setSelecionada(alvo ?? r.lista[0] ?? null)
      } catch (e) {
        if (seq.current !== id) return
        setErro(e instanceof Error ? e.message : String(e))
      } finally {
        if (seq.current === id) setCarregando(false)
      }
    })()
  }, [aberto, codigo]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Fonte automática a partir da regra oficial (base legal da LEI). */
  const fonteDaRegra = (cl: Classificacao) => {
    const url = cl.resumo.urlLegislacao ?? cl.referencia?.urlLegislacao ?? ''
    const fonte = cl.cstClassTribDetalhes?.lcRef || cl.baseLegal || cl.referencia?.lcRef || 'Base oficial — LC 214/2025'
    const desc =
      cl.resumo.descricaoCClassTrib ||
      cl.cstClassTribDetalhes?.descricao ||
      cl.baseLegal ||
      `CST ${cl.cst} · ${cl.cClassTrib}`
    return { url, fonte, desc }
  }

  const propagar = async (): Promise<string> => {
    const prop = await propagarClassificacaoNcm(codigo)
    try {
      const { useProdutos } = await import('@/store/produtos')
      await useProdutos.getState().carregar().catch(() => undefined)
    } catch { /* sem cadastro — nada a recarregar */ }
    try {
      const { useNfe } = await import('@/store/nfe')
      const st = useNfe.getState()
      await st.carregar().catch(() => undefined)
      const aberta = useNfe.getState().notaAberta
      if (aberta?.id != null) {
        const fresca = useNfe.getState().notas.find((x) => x.id === aberta.id) ?? null
        useNfe.setState({ notaAberta: fresca })
      }
    } catch { /* sem notas — nada a recarregar */ }
    const partes = []
    if (prop.produtos) partes.push(`${prop.produtos} produto(s)`)
    if (prop.itens) partes.push(`${prop.itens} item(ns) em ${prop.notas} nota(s)`)
    return partes.length ? ` — atualizados: ${partes.join(' · ')}.` : ''
  }

  const confirmar = async (cl: Classificacao | null, forcarFormulario: { descricao: string; fonteDescricao: string; fonteUrl: string } | null) => {
    if (!cl) return toast('Escolha uma das regras listadas.', 'warn')
    const auto = fonteDaRegra(cl)
    const payload = forcarFormulario ?? {
      descricao: auto.desc,
      fonteDescricao: auto.fonte,
      fonteUrl: auto.url,
    }
    // Regra sem link oficial: exige fonte + link antes de salvar.
    if (!payload.fonteUrl.trim()) {
      setSemLink(true)
      setDescricao((d) => d || payload.descricao)
      setFonteDescricao((f) => f || payload.fonteDescricao)
      return toast('Esta regra não traz link oficial — informe a fonte e o link da legislação para confirmar.', 'warn')
    }
    setSalvando(true)
    try {
      const r = await salvarReclassificacaoManual({
        ncm: codigo,
        cst: cl.cst,
        cClassTrib: cl.cClassTrib,
        descricao: payload.descricao,
        fonteDescricao: payload.fonteDescricao,
        fonteUrl: payload.fonteUrl,
      })
      if (!r.ok) {
        toast(r.motivo, 'warn')
        return
      }
      const impacto = await propagar()
      toast(`Tributação aplicada — CST ${cl.cst} · ${cl.cClassTrib} passa a valer nas importações${impacto} Apuração recalculada.`, 'ok')
      onSalvo()
      onFechar()
    } catch (e) {
      toast(`Erro: ${e instanceof Error ? e.message : String(e)}`, 'err')
    } finally {
      setSalvando(false)
    }
  }

  const excluir = async () => {
    setSalvando(true)
    try {
      await removerReclassificacaoManual(codigo)
      const impacto = await propagar()
      toast(`Escolha removida — voltou à regra oficial${impacto}`, 'warn')
      onSalvo()
      onFechar()
    } catch (e) {
      toast(`Erro: ${e instanceof Error ? e.message : String(e)}`, 'err')
    } finally {
      setSalvando(false)
    }
  }

  const ehAplicada = (cl: Classificacao) =>
    vigente != null &&
    cl.cst === String(vigente.cst ?? '').trim() &&
    cl.cClassTrib === String(vigente.cClassTrib ?? '').trim()

  return (
    <>
      <Modal
        aberto={aberto}
        onFechar={onFechar}
        titulo="🔀 Escolher tributação"
        subtitulo={`NCM ${fmtNcm(codigo)} · regras da LEI para este NCM — sua escolha vale em todas as telas`}
        largura="max-w-3xl"
        rodape={
          <>
            {temManual ? (
              <Btn variante="danger" carregando={salvando} onClick={() => void excluir()}>
                {salvando ? 'Removendo…' : '🗑 Remover minha escolha'}
              </Btn>
            ) : null}
            <Btn onClick={onFechar}>Cancelar</Btn>
            <Btn
              variante="primary"
              carregando={salvando}
              disabled={carregando || !selecionada}
              onClick={() =>
                void confirmar(
                  selecionada,
                  semLink ? { descricao, fonteDescricao, fonteUrl } : null,
                )
              }
            >
              {salvando ? 'Aplicando…' : '✓ Usar esta tributação'}
            </Btn>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-xl border border-[var(--line)] bg-slate-50 p-3 dark:bg-slate-950/40">
            <div className="flex flex-wrap items-center gap-2">
              <Pill cor="brand">NCM {fmtNcm(codigo)}</Pill>
              {ehRegraGeral ? (
                <Pill cor="amber">⚠ Sem vínculo oficial — regra geral</Pill>
              ) : (
                <Pill cor="emerald">
                  {opcoes.length} regra{opcoes.length === 1 ? '' : 's'} da LEI
                </Pill>
              )}
              {temManual ? <Pill cor="amber">👤 Com escolha sua</Pill> : null}
            </div>
            {nomenclatura?.descricao ? (
              <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">{nomenclatura.descricao}</div>
            ) : null}
          </div>

          <AvisoManual compact />

          {carregando ? (
            <p className="py-6 text-center text-xs text-slate-500">Buscando as regras oficiais deste NCM…</p>
          ) : erro ? (
            <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              Não foi possível carregar as regras: {erro}
            </p>
          ) : !opcoes.length ? (
            <p className="py-6 text-center text-xs text-slate-500">Nenhuma regra encontrada para este NCM.</p>
          ) : (
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {opcoes.map((cl, i) => {
                const sel = selecionada?.id === cl.id || (selecionada === cl)
                const ehFallback = cl.integralFallback === true
                const aplicada = ehAplicada(cl)
                const rIBS = Number(cl.resumo.percentualReducaoIBS ?? 0)
                const rCBS = Number(cl.resumo.percentualReducaoCBS ?? 0)
                const url = cl.resumo.urlLegislacao ?? cl.referencia?.urlLegislacao ?? null
                const base = cl.cstClassTribDetalhes?.lcRef || cl.baseLegal || cl.referencia?.lcRef || '—'
                return (
                  <div
                    key={cl.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setSelecionada(cl)
                      setSemLink(false)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setSelecionada(cl)
                        setSemLink(false)
                      }
                    }}
                    aria-pressed={sel}
                    className={`block w-full cursor-pointer rounded-xl border-2 p-3 text-left transition ${
                      sel
                        ? ehFallback
                          ? 'border-slate-500 bg-slate-100 shadow-card dark:border-slate-400 dark:bg-slate-800'
                          : 'border-brand-500 bg-brand-50/70 shadow-card dark:border-aurum-500 dark:bg-brand-900/30'
                        : ehFallback
                          ? 'border-dashed border-slate-400 bg-slate-50 hover:border-slate-500 dark:bg-slate-900'
                          : 'border-[var(--line)] bg-white hover:border-brand-300 dark:bg-slate-900'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 font-mono text-[10px] font-black ${
                          sel ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 text-transparent'
                        }`}
                      >
                        ✓
                      </span>
                      <span className="font-mono text-xs font-black">
                        Opção {i + 1} · CST {cl.cst} · {cl.cClassTrib}
                      </span>
                      {aplicada ? (
                        <span className="pill bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                          Aplicada atualmente
                        </span>
                      ) : null}
                      {cl.regraGeral ? (
                        <span className="pill bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                          Regra geral
                        </span>
                      ) : null}
                      {ehFallback ? (
                        <span className="pill ml-auto bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                          🛡 Integral · segurança
                        </span>
                      ) : (
                        <span className="pill ml-auto bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          −{fmtPct(rIBS)} / −{fmtPct(rCBS)}
                        </span>
                      )}
                    </div>
                    {ehFallback ? (
                      <div className="mt-1.5 rounded-lg border border-slate-300 bg-slate-100 p-1.5 text-[11px] leading-snug text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        🛡 Não se encaixa nessa qualificação? Aplique a tributação integral — vale quando o produto não atender (propósito, descrição ou destinação).
                      </div>
                    ) : null}
                    <div className="mt-1.5 line-clamp-2 text-xs font-medium leading-snug">
                      {cl.resumo.descricaoCClassTrib || cl.baseLegal || '—'}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400" title={cl.baseLegal || undefined}>
                      📜 Base legal: <strong>{base}</strong>
                      {!url ? ' · sem link oficial (informe a fonte ao confirmar)' : ''}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                      <BotaoDetalhePremium
                        icone="📖"
                        rotulo="Ler regra"
                        titulo="Abre a ficha fiscal completa desta opção"
                        onClick={() => setFiscalAberta(cl)}
                      />
                      {url ? (
                        <BotaoVerLegislacao
                          url={url}
                          titulo={base}
                          referencia={base}
                          texto={cl.resumo.descricaoCClassTrib ?? null}
                          rotulo="Legislação"
                          className="btn-detalhe-premium"
                        />
                      ) : null}
                      {!sel ? (
                        <button
                          type="button"
                          className="btn-detalhe-premium"
                          onClick={() => {
                            setSelecionada(cl)
                            setSemLink(false)
                          }}
                          title="Selecionar esta regra da LEI"
                        >
                          ✓ Usar esta
                        </button>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {semLink && selecionada ? (
            <div className="space-y-2.5 rounded-xl border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-800 dark:bg-amber-950/20">
              <p className="text-[11px] leading-relaxed text-amber-900 dark:text-amber-200">
                A regra <strong>CST {selecionada.cst} · {selecionada.cClassTrib}</strong> não traz link
                oficial — complete a fonte para aplicar (exigido pela auditoria da escolha manual).
              </p>
              <Campo label="Justificativa" obrigatorio>
                <Texto
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  placeholder="Por que esta tributação se aplica à operação"
                />
              </Campo>
              <Campo label="Fonte (descrição)" obrigatorio>
                <Texto
                  value={fonteDescricao}
                  onChange={(e) => setFonteDescricao(e.target.value)}
                  placeholder="Ex.: LC 214/2025, art. …"
                />
              </Campo>
              <Campo label="Link da legislação" obrigatorio>
                <Texto
                  value={fonteUrl}
                  onChange={(e) => setFonteUrl(e.target.value)}
                  placeholder="https://…"
                />
              </Campo>
            </div>
          ) : null}
        </div>
      </Modal>
      {fiscalAberta ? (
        <ModalDetalheFiscal
          aberto
          onFechar={() => setFiscalAberta(null)}
          cl={fiscalAberta}
          nomenclatura={nomenclatura}
        />
      ) : null}
    </>
  )
}
