/**
 * Modais **pertencentes a uma página** (page-owned).
 *
 * Ficam fora do host global (`useUi.modal`) de propósito: assim podem ser
 * empilhados sobre um modal global (ex.: cadastro rápido de CFOP aberto a
 * partir daqui) sem que um fechamento feche o outro.
 */
import { useEffect, useRef, useState } from 'react'
import type { Classificacao } from '@/domain/entities'
import { calcularTributos } from '@/domain/services/calculo'
import { resolverClassificacoes } from '@/infrastructure/base/classificacao-repo'
import {
  fmtCarga,
  fmtMoeda,
  fmtNcm,
  fmtNum,
  fmtPct,
  formatarMoedaInput,
  norm,
  parseMoeda,
  parseQtd,
} from '@/domain/services/format'
import { salvarProduto, type EntradaProduto } from '@/application/produtos'
import { useCalculadora } from '@/store/calculadora'
import { useProdutos } from '@/store/produtos'
import { useSessao } from '@/store/sessao'
import { confirmar as confirmarDialogo } from '@/store/dialogo'
import { toast, useUi, type FonteCalc } from '@/store/ui'
import type { PrefillSalvar } from '@/store/consulta'
import { Btn, Campo, Modal, Pill, Texto, TituloSecao } from '@/ui/kit'
import { SelectAux } from '@/ui/opcoes'

/* ------------------------------------------------------- salvar classe ---- */

interface FormSalvarClass {
  codigo: string
  nome: string
  qtd: string
  valor: string
  cfop: string
  cstIcms: string
  pis: string
  cofins: string
}

const FORM_INICIAL: FormSalvarClass = {
  codigo: '',
  nome: '',
  qtd: '',
  valor: '',
  cfop: '',
  cstIcms: '',
  pis: '',
  cofins: '',
}

export function ModalSalvarClass({
  aberto,
  onFechar,
  classificacao,
  inicial,
}: {
  aberto: boolean
  onFechar: () => void
  classificacao: Classificacao | null
  /** Pré-preenchimento (edição vinda da tela Produtos). */
  inicial?: PrefillSalvar | null
}) {
  const [form, setForm] = useState<FormSalvarClass>(FORM_INICIAL)
  const [salvando, setSalvando] = useState(false)
  const editando = inicial?.editarId != null

  // Abertura sempre parte de um formulário limpo — ou do pré-preenchimento
  // da edição (paridade com a v1).
  useEffect(() => {
    if (aberto) setForm({ ...FORM_INICIAL, ...(inicial ?? {}) })
  }, [aberto, inicial])

  if (!classificacao) return null

  const cl = classificacao
  const r = cl.resumo
  const redIBS = r.percentualReducaoIBS ?? cl.cstClassTribDetalhes?.pRedIBS ?? 0
  const redCBS = r.percentualReducaoCBS ?? cl.cstClassTribDetalhes?.pRedCBS ?? 0
  const descricao = r.descricaoCClassTrib || cl.baseLegal || '—'

  const campo = <K extends keyof FormSalvarClass>(k: K, v: string) =>
    setForm((f) => ({ ...f, [k]: v }))

  const confirmar = async () => {
    const codigo = form.codigo.trim()
    const nome = form.nome.trim()
    if (!codigo) return toast('Informe o SKU.', 'warn')
    if (!nome) return toast('Informe o nome do produto.', 'warn')

    const ativa = useSessao.getState().ativa
    const entrada: EntradaProduto = {
      empresaId: ativa?.id ?? null,
      codigo,
      nome,
      ncm: cl.codigo,
      cfop: form.cfop,
      cstIcms: form.cstIcms,
      pis: form.pis,
      cofins: form.cofins,
      quantidade: parseQtd(form.qtd),
      valorUnitario: parseMoeda(form.valor),
      classificacao: cl,
    }

    setSalvando(true)
    try {
      // Em edição (`editarId`) atualiza o registro original; no cadastro faz
      // upsert por SKU com confirmação de sobrescrita.
      let rSalvar = await salvarProduto(entrada, editando ? { editarId: inicial?.editarId ?? null } : undefined)
      if (!rSalvar.ok && rSalvar.motivo.includes('Já existe o SKU')) {
        const sobrescrever = await confirmarDialogo('Sobrescrever produto?', rSalvar.motivo, {
          icone: '⚠',
          confirmar: 'Sobrescrever',
          perigo: true,
        })
        if (!sobrescrever) return
        rSalvar = await salvarProduto(entrada, { forcar: true })
      }
      if (!rSalvar.ok) {
        toast(rSalvar.motivo, 'warn')
        return
      }
      await useProdutos.getState().carregar()
      toast(editando ? 'Produto atualizado.' : 'Produto salvo com a classificação da Reforma.', 'ok')
      onFechar()
    } catch (e) {
      toast(`Erro: ${e instanceof Error ? e.message : String(e)}`, 'err')
    } finally {
      setSalvando(false)
    }
  }

  const noEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void confirmar()
  }

  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo={editando ? '✏️ Editar produto' : '💾 Salvar classificação'}
      subtitulo={
        editando
          ? 'Ajuste os dados e confirme para atualizar o produto.'
          : 'A Reforma já está classificada. Informe os demais dados.'
      }
      largura="max-w-3xl"
      rodape={
        <>
          <Btn onClick={onFechar}>Cancelar</Btn>
          <Btn variante="primary" carregando={salvando} onClick={() => void confirmar()}>
            {salvando ? 'Salvando…' : editando ? '💾 Salvar alterações' : '💾 Salvar produto'}
          </Btn>
        </>
      }
    >
      <div className="space-y-5">
        <div className="rounded-xl border border-[var(--line)] bg-slate-50 p-4 dark:bg-slate-950/40">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Pill cor="brand">Classificação da Reforma</Pill>
            {cl.regraGeral ? <Pill cor="amber">⚠ Regra geral</Pill> : null}
            {cl.manual ? <Pill cor="amber">✋ Manual · usuário</Pill> : null}
          </div>
          <div className="font-mono text-xl font-black text-brand-700 dark:text-aurum-200">
            {cl.codigoFormatado || fmtNcm(cl.codigo)}
          </div>
          <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">{cl.descricao || '—'}</div>
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              ['CST', cl.cst],
              ['cClassTrib', cl.cClassTrib],
              ['Redução IBS', fmtPct(redIBS)],
              ['Redução CBS', fmtPct(redCBS)],
            ].map(([rot, val]) => (
              <div key={rot} className="rounded-lg bg-white p-2 dark:bg-slate-900">
                <div className="text-[9px] font-bold uppercase text-slate-500">{rot}</div>
                <div className="font-mono text-sm font-bold">{val}</div>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[11px] text-slate-600 dark:text-slate-400">
            <strong>Classificação:</strong> {descricao}
          </div>
        </div>

        <section>
          <TituloSecao>Identificação</TituloSecao>
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Campo label="SKU / Código interno" obrigatorio>
              <Texto
                mono
                value={form.codigo}
                placeholder="SKU-0001"
                className="field-sm"
                onChange={(e) => campo('codigo', e.target.value)}
                onKeyDown={noEnter}
              />
            </Campo>
            <Campo label="Nome do produto" obrigatorio>
              <Texto
                value={form.nome}
                placeholder="Ex.: Queijo Minas"
                className="field-sm"
                onChange={(e) => campo('nome', e.target.value)}
                onKeyDown={noEnter}
              />
            </Campo>
            <Campo label="Quantidade">
              <Texto
                mask="qtd"
                mono
                value={form.qtd}
                placeholder="0,000"
                className="field-sm num-input"
                onChange={(e) => campo('qtd', e.target.value)}
                onKeyDown={noEnter}
              />
            </Campo>
            <Campo label="Valor unitário (R$)">
              <Texto
                mask="moeda"
                mono
                value={form.valor}
                placeholder="R$ 0,00"
                className="field-sm num-input"
                onChange={(e) => campo('valor', e.target.value)}
                onKeyDown={noEnter}
              />
            </Campo>
          </div>
        </section>

        <section>
          <TituloSecao>Tributação anterior (pré-reforma)</TituloSecao>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <Campo label="CFOP">
              <SelectAux tipo="cfop" valor={form.cfop} onChange={(v) => campo('cfop', v)} />
            </Campo>
            <Campo label="CST ICMS">
              <SelectAux tipo="csticms" valor={form.cstIcms} onChange={(v) => campo('cstIcms', v)} />
            </Campo>
            <Campo label="PIS">
              <SelectAux
                tipo="cstpiscofins"
                valor={form.pis}
                onChange={(v) => campo('pis', v)}
                rotuloAdicionar="Cadastrar novo CST PIS/COFINS"
              />
            </Campo>
            <Campo label="COFINS">
              <SelectAux
                tipo="cstpiscofins"
                valor={form.cofins}
                onChange={(v) => campo('cofins', v)}
                rotuloAdicionar="Cadastrar novo CST PIS/COFINS"
              />
            </Campo>
          </div>
        </section>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------ item manual -------- */

export function ModalCalcCustom({
  aberto,
  onFechar,
  ncmInicial = '',
}: {
  aberto: boolean
  onFechar: () => void
  /** Pré-preenche o NCM (busca "NCM direto" da calculadora). */
  ncmInicial?: string
}) {
  const adicionarManual = useCalculadora((s) => s.adicionarManual)
  const rateIBS = useCalculadora((s) => s.rateIBS)
  const rateCBS = useCalculadora((s) => s.rateCBS)
  const [ncm, setNcm] = useState('')
  const [qtd, setQtd] = useState('1,000')
  const [valor, setValor] = useState('')
  const [opcoes, setOpcoes] = useState<Classificacao[]>([])
  const [escolhida, setEscolhida] = useState<Classificacao | null>(null)
  const [descricaoNcm, setDescricaoNcm] = useState('')
  const [aviso, setAviso] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  // Guarda anti-corrida: digitação rápida gera várias resoluções assíncronas;
  // só a última pode escrever no estado (reatividade sem "piscar" opção velha).
  const seqBusca = useRef(0)
  const ultimoCarregado = useRef('')

  const carregar = async (texto: string) => {
    const digits = norm(texto)
    if (digits.length !== 8) {
      setOpcoes([])
      setEscolhida(null)
      setDescricaoNcm('')
      setAviso('Informe um NCM de 8 dígitos.')
      ultimoCarregado.current = ''
      return
    }
    if (digits === ultimoCarregado.current && opcoes.length) return
    const seq = ++seqBusca.current
    setCarregando(true)
    const r = await resolverClassificacoes(digits)
    if (seq !== seqBusca.current) return
    ultimoCarregado.current = digits
    setOpcoes(r.lista)
    setEscolhida(r.lista[0] ?? null)
    setDescricaoNcm(r.nomenclatura?.descricao ?? '')
    setAviso(
      r.regraGeral
        ? '⚠ Sem vínculo oficial — regra geral (tributação integral vigente, alíquota cheia).'
        : r.lista.length > 1
          ? `${r.lista.length} classificações disponíveis`
          : null,
    )
    setCarregando(false)
  }

  // Ao abrir, o formulário sempre parte limpo (paridade com a v1).
  useEffect(() => {
    if (!aberto) return
    seqBusca.current = 0
    ultimoCarregado.current = ''
    setNcm(ncmInicial)
    setQtd('1,000')
    setValor('')
    setOpcoes([])
    setEscolhida(null)
    setDescricaoNcm('')
    setAviso(null)
    if (norm(ncmInicial).length === 8) {
      ultimoCarregado.current = norm(ncmInicial)
      void carregar(ncmInicial)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto])

  // Debounce de 300 ms no campo NCM (paridade com a v1).
  useEffect(() => {
    if (!aberto) return
    const t = window.setTimeout(() => {
      if (norm(ncm).length === 8) void carregar(ncm)
    }, 300)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ncm, aberto])

  const adicionar = () => {
    if (!escolhida) return toast('Informe um NCM válido.', 'warn')
    adicionarManual(escolhida, parseQtd(qtd) || 1, parseMoeda(valor))
    onFechar()
  }

  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo="➕ Item por NCM"
      subtitulo="Classifique rapidamente um NCM."
      largura="max-w-2xl"
      rodape={
        <>
          <Btn onClick={onFechar}>Cancelar</Btn>
          <Btn variante="primary" onClick={adicionar}>
            ➕ Adicionar à calculadora
          </Btn>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Campo label="NCM (8 dígitos)" obrigatorio className="md:col-span-2">
            <Texto
              mask="ncm"
              mono
              grande
              value={ncm}
              placeholder="0000.00.00"
              onChange={(e) => setNcm(e.target.value)}
              onBlur={() => {
                if (norm(ncm).length === 8) void carregar(ncm)
              }}
            />
          </Campo>
          <Campo label="Quantidade">
            <Texto
              mask="qtd"
              mono
              value={qtd}
              placeholder="1,000"
              className="num-input"
              onChange={(e) => setQtd(e.target.value)}
            />
          </Campo>
          <Campo label="Valor unitário (R$)">
            <Texto
              mask="moeda"
              mono
              value={valor}
              placeholder="R$ 0,00"
              className="num-input"
              onChange={(e) => setValor(e.target.value)}
            />
          </Campo>
        </div>

        <div className="rounded-xl border border-[var(--line)] bg-slate-50 p-4 dark:bg-slate-950/40">
          {carregando ? (
            <div className="text-xs text-slate-500">Carregando classificações…</div>
          ) : opcoes.length === 0 ? (
            <div className="text-xs text-slate-500">
              {aviso ?? 'Informe o NCM para carregar as classificações.'}
            </div>
          ) : (
            <>
              {aviso ? (
                <div
                  className={`mb-2 rounded-lg border p-2 text-[11px] ${
                    aviso.startsWith('⚠')
                      ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
                      : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                  }`}
                >
                  {aviso}
                </div>
              ) : null}
              {descricaoNcm ? (
                <div className="mb-2 text-[11px] text-slate-500">{descricaoNcm}</div>
              ) : null}
              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {opcoes.map((cl, i) => {
                  const sel = escolhida === cl
                  const rr = cl.resumo
                  const redIBS = rr.percentualReducaoIBS ?? 0
                  const redCBS = rr.percentualReducaoCBS ?? 0
                  const aliqIBS = rateIBS * (1 - redIBS / 100)
                  const aliqCBS = rateCBS * (1 - redCBS / 100)
                  return (
                    <button
                      key={cl.id}
                      type="button"
                      onClick={() => setEscolhida(cl)}
                      aria-pressed={sel}
                      className={`block w-full cursor-pointer rounded-xl border-2 p-3 text-left transition ${
                        sel
                          ? 'border-brand-500 bg-brand-50/70 shadow-card dark:border-aurum-500 dark:bg-brand-900/30'
                          : 'border-[var(--line)] bg-white hover:border-brand-300 dark:bg-slate-900'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 font-mono text-[10px] font-black ${sel ? 'border-brand-600 bg-brand-600 text-white dark:border-aurum-400 dark:bg-aurum-400 dark:text-brand-950' : 'border-slate-300 text-transparent'}`}>
                          ✓
                        </span>
                        <span className="font-mono text-xs font-black">
                          CST {cl.cst} · {cl.cClassTrib}
                        </span>
                        <span
                          className="pill ml-auto bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                          title={`Redução de alíquota IBS/CBS aplicada sobre a referência (${fmtPct(rateIBS)} / ${fmtPct(rateCBS)})`}
                        >
                          Redução: −{fmtPct(redIBS)} / −{fmtPct(redCBS)}
                        </span>
                      </div>
                      <div className="mt-1.5 text-xs font-medium leading-snug">
                        {rr.descricaoCClassTrib || cl.baseLegal || '—'}
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-dashed border-slate-200 pt-1.5 text-[10px] text-slate-400 dark:border-slate-700">
                        <span className="font-bold uppercase tracking-wide">Opção {i + 1}</span>
                        <span className="font-mono font-bold text-brand-700 dark:text-aurum-200">
                          Efetiva {fmtCarga(aliqIBS)} / {fmtCarga(aliqCBS)}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>

        <PreviaItem
          classificacao={escolhida}
          qtd={qtd}
          valor={valor}
          rateIBS={rateIBS}
          rateCBS={rateCBS}
        />
      </div>
    </Modal>
  )
}

/**
 * Prévia reativa do item (SPEC R7.14 — mesmo motor do simulador rápido).
 *
 * Recalcula a cada render: troca de opção, digitação de qtd/valor ou edição
 * das alíquotas de referência na Calculadora. Com valor zerado a base é
 * R$ 0,00 (tributos zerados, correto), mas as **alíquotas efetivas** continuam
 * visíveis — é o que diferencia "tributação integral" de "alíquota zero".
 */
function PreviaCalculo({
  redIBS,
  redCBS,
  regraGeral,
  qtd,
  valor,
  rateIBS,
  rateCBS,
}: {
  redIBS: number
  redCBS: number
  regraGeral: boolean
  qtd: string
  valor: string
  rateIBS: number
  rateCBS: number
}) {
  const base = (parseQtd(qtd) || 0) * parseMoeda(valor)
  const c = calcularTributos(base, redIBS, redCBS, rateIBS, rateCBS)
  const temReducao = (Number(redIBS) || 0) > 0 || (Number(redCBS) || 0) > 0
  const totalTributos = c.total
  const totalItem = c.base + c.total
  const pctIBS = totalTributos > 0 ? (c.vIBS / totalTributos) * 100 : 50
  const temValor = c.base > 0

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--line)]">
      <div className="flex items-center gap-2 bg-gradient-to-r from-brand-50/90 to-white px-4 py-2.5 dark:from-brand-950/40 dark:to-slate-900">
        <span className="calc-step text-slate-500"><span className="calc-step-dot">3</span> Prévia do item</span>
        {temReducao ? (
          <span className="ml-auto font-mono text-[10px] text-slate-500" title="Alíquota de referência já com a redução aplicada; BC = valor cheio da operação">
            Alíq. {fmtCarga(c.aliqIBS)} / {fmtCarga(c.aliqCBS)}
          </span>
        ) : (
          <span className="ml-auto font-mono text-[10px] text-slate-400">Alíq. cheia</span>
        )}
      </div>
      <div className="p-4">
        <div className="calc-bar" aria-hidden="true">
          <span className="calc-bar-ibs" style={{ width: `${pctIBS}%` }} />
          <span className="calc-bar-cbs" style={{ width: `${100 - pctIBS}%` }} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2.5 md:grid-cols-4">
          <div className="calc-kpi">
            <div className="text-[10px] font-bold uppercase text-slate-500">Operação</div>
            <div className="font-mono text-sm font-black">{fmtMoeda(c.base)}</div>
            <div className="font-mono text-[10px] text-slate-400">BC cheia</div>
          </div>
          <div className="calc-kpi">
            <div className="text-[10px] font-bold uppercase text-slate-500">
              Valor do IBS · {fmtCarga(c.aliqIBS)}
            </div>
            <div className="font-mono text-sm font-black text-brand-700 dark:text-aurum-200">
              {fmtMoeda(c.vIBS)}
            </div>
            <div className="font-mono text-[10px] text-slate-400">azul na barra</div>
          </div>
          <div className="calc-kpi">
            <div className="text-[10px] font-bold uppercase text-slate-500">
              Valor da CBS · {fmtCarga(c.aliqCBS)}
            </div>
            <div className="font-mono text-sm font-black text-brand-700 dark:text-aurum-200">
              {fmtMoeda(c.vCBS)}
            </div>
            <div className="font-mono text-[10px] text-slate-400">dourado na barra</div>
          </div>
          <div className="calc-hero rounded-xl p-3">
            <div className="calc-hero-rotulo">Total item · operação + tributos</div>
            <div className="calc-hero-valor text-lg text-white">{fmtMoeda(totalItem)}</div>
            <div className="font-mono text-[10px] text-white/70">
              tributos {fmtMoeda(totalTributos)} · carga {temValor ? fmtCarga(c.carga) : fmtCarga(rateIBS + rateCBS)}
            </div>
          </div>
        </div>
      </div>
      {regraGeral ? (
        <div className="border-t border-[var(--line)] bg-amber-50/60 px-4 py-2 text-[11px] text-slate-600 dark:bg-amber-950/20 dark:text-slate-400">
          Regra geral: sem redução — BC cheia, alíquota cheia (
          {fmtCarga(rateIBS)} / {fmtCarga(rateCBS)}).
        </div>
      ) : null}
    </div>
  )
}

/** Prévia a partir de uma `Classificacao` já escolhida. */
function PreviaItem({
  classificacao,
  qtd,
  valor,
  rateIBS,
  rateCBS,
}: {
  classificacao: Classificacao | null
  qtd: string
  valor: string
  rateIBS: number
  rateCBS: number
}) {
  if (!classificacao) return null
  const rr = classificacao.resumo
  return (
    <PreviaCalculo
      redIBS={Number(rr.percentualReducaoIBS ?? 0)}
      redCBS={Number(rr.percentualReducaoCBS ?? 0)}
      regraGeral={classificacao.regraGeral}
      qtd={qtd}
      valor={valor}
      rateIBS={rateIBS}
      rateCBS={rateCBS}
    />
  )
}

/* ------------------------------------------- adicionar à calculadora ------ */

/** Resumo comum exibido no modal (produto já cadastrado ou classificação). */
interface DadosCalc {
  ncm: string
  nome: string
  cst: string
  cClassTrib: string
  descClass: string
  redIBS: number
  redCBS: number
  regraGeral: boolean
}

function dadosCalc(fonte: FonteCalc): DadosCalc {
  if (fonte.tipo === 'classificacao') {
    const cl = fonte.classificacao
    const r = cl.resumo
    const cct = cl.cstClassTribDetalhes
    return {
      ncm: cl.codigo,
      nome: cl.descricao || cl.codigoFormatado || 'Item',
      cst: cl.cst,
      cClassTrib: cl.cClassTrib,
      descClass: r.descricaoCClassTrib || cl.baseLegal || '—',
      redIBS: Number(r.percentualReducaoIBS ?? cct?.pRedIBS ?? 0),
      redCBS: Number(r.percentualReducaoCBS ?? cct?.pRedCBS ?? 0),
      regraGeral: cl.regraGeral,
    }
  }
  const p = fonte.produto
  return {
    ncm: p.ncm,
    nome: p.nome,
    cst: p.cstReforma,
    cClassTrib: p.cClassTrib,
    descClass: p.descClass,
    redIBS: p.redIBS,
    redCBS: p.redCBS,
    regraGeral: p.regraGeral,
  }
}

/**
 * Modal **Adicionar à calculadora**.
 *
 * Em vez de arrastar o usuário para a tela da Calculadora no meio de uma
 * pesquisa, quem clica em "Adicionar à calculadora" ganha um modal com a
 * quantidade, o valor unitário e a prévia do IBS/CBS daquele item — o
 * cálculo acontece no contexto do produto que motivou o clique.
 * Ao confirmar, o item é adicionado e o usuário é levado à Calculadora
 * para conferência imediata (sem isso, parecia que nada tinha acontecido).
 *
 * Registrado como modal global: qualquer tela abre com
 * `useUi.getState().abrirCalc(fonte)`.
 */
export function ModalCalculadora() {
  const fonte = useUi((s) => s.fonteCalc)
  const trocarView = useUi((s) => s.trocarView)
  const rateIBS = useCalculadora((s) => s.rateIBS)
  const rateCBS = useCalculadora((s) => s.rateCBS)
  const adicionarClassificacao = useCalculadora((s) => s.adicionarClassificacao)
  const adicionarProduto = useCalculadora((s) => s.adicionarProduto)

  const [qtd, setQtd] = useState('1,000')
  const [valor, setValor] = useState('')
  // Última fonte: mantém o conteúdo na tela durante a animação de saída.
  const [ultima, setUltima] = useState<FonteCalc | null>(null)

  // Toda abertura parte de um formulário limpo e já preenchido com o item.
  useEffect(() => {
    if (!fonte) return
    setUltima(fonte)
    const p = fonte.tipo === 'produto' ? fonte.produto : null
    setQtd(p?.quantidade ? fmtNum(p.quantidade) : '1,000')
    setValor(p?.valorUnitario ? formatarMoedaInput(p.valorUnitario) : '')
  }, [fonte])

  const fechar = () => useUi.getState().abrirCalc(null)
  const visivel = fonte ?? ultima
  const dados = visivel ? dadosCalc(visivel) : null

  const adicionar = () => {
    if (!visivel || !dados) return
    const quantidade = parseQtd(qtd) || 1
    const valorUnitario = parseMoeda(valor)
    if (visivel.tipo === 'produto') {
      adicionarProduto(visivel.produto, { quantidade, valorUnitario })
      toast(`"${visivel.produto.nome}" adicionado à calculadora.`, 'ok')
    } else {
      adicionarClassificacao(visivel.classificacao, { quantidade, valorUnitario })
      toast('Item adicionado à calculadora.', 'ok')
    }
    // Gestão da interação: confirmar leva à Calculadora para conferência
    // imediata do item (antes o modal só fechava e parecia que nada aconteceu).
    trocarView('calculadora')
  }

  return (
    <Modal
      aberto={fonte !== null}
      onFechar={fechar}
      titulo="🧮 Adicionar à calculadora"
      subtitulo={
        dados
          ? `NCM ${fmtNcm(dados.ncm)} · confirme para adicionar e ver na Calculadora`
          : 'Defina quantidade e valor antes de confirmar'
      }
      largura="max-w-2xl"
      rodape={
        <>
          <Btn onClick={fechar}>Cancelar</Btn>
          <Btn
            onClick={() => {
              fechar()
              trocarView('calculadora')
            }}
          >
            Ver calculadora
          </Btn>
          <Btn variante="primary" onClick={adicionar}>
            ➕ Adicionar
          </Btn>
        </>
      }
    >
      {dados ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-[var(--line)] bg-slate-50 p-4 dark:bg-slate-950/40">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Pill cor="brand">
                {visivel?.tipo === 'produto' ? 'Produto cadastrado' : 'Classificação da Reforma'}
              </Pill>
              {dados.regraGeral ? <Pill cor="amber">⚠ Regra geral</Pill> : null}
            </div>
            <div className="font-mono text-xl font-black text-brand-700 dark:text-aurum-200">
              {fmtNcm(dados.ncm)}
            </div>
            <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">{dados.nome}</div>
            <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
              {[
                ['CST', dados.cst || '—'],
                ['cClassTrib', dados.cClassTrib || '—'],
                ['Redução IBS', fmtPct(dados.redIBS)],
                ['Redução CBS', fmtPct(dados.redCBS)],
              ].map(([rot, val]) => (
                <div key={rot} className="rounded-lg bg-white p-2 dark:bg-slate-900">
                  <div className="text-[9px] font-bold uppercase text-slate-500">{rot}</div>
                  <div className="font-mono text-sm font-bold">{val}</div>
                </div>
              ))}
            </div>
            <div className="mt-2 text-[11px] text-slate-600 dark:text-slate-400">
              <strong>Classificação:</strong> {dados.descClass}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Campo label="Quantidade">
              <Texto
                mask="qtd"
                mono
                inputMode="decimal"
                value={qtd}
                placeholder="1,000"
                className="num-input"
                onChange={(e) => setQtd(e.target.value)}
              />
            </Campo>
            <Campo label="Valor unitário (R$)">
              <Texto
                mask="moeda"
                mono
                inputMode="decimal"
                value={valor}
                placeholder="R$ 0,00"
                className="num-input"
                onChange={(e) => setValor(e.target.value)}
              />
            </Campo>
          </div>

          <PreviaCalculo
            redIBS={dados.redIBS}
            redCBS={dados.redCBS}
            regraGeral={dados.regraGeral}
            qtd={qtd}
            valor={valor}
            rateIBS={rateIBS}
            rateCBS={rateCBS}
          />

          <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            O item entra na lista da Calculadora com as reduções de alíquota congeladas na
            adição — reimportar a base não altera esta simulação. Ao confirmar, você é
            levado à Calculadora para conferir o item.
          </p>
        </div>
      ) : null}
    </Modal>
  )
}
