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
  MASK,
  fmtCarga,
  fmtMoeda,
  fmtNcm,
  fmtNum,
  fmtPct,
  norm,
  parseMoeda,
  parseQtd,
} from '@/domain/services/format'
import { salvarProduto, type EntradaProduto } from '@/application/produtos'
import { useCalculadora } from '@/store/calculadora'
import { useProdutos } from '@/store/produtos'
import { useSessao } from '@/store/sessao'
import { confirmar as confirmarDialogo } from '@/store/dialogo'
import { useSped } from '@/store/sped'
import { toast, useUi, type FonteCalc } from '@/store/ui'
import { Btn, Campo, Modal, Painel, Pill, Texto, TituloSecao } from '@/ui/kit'
import { SelectAux } from '@/ui/opcoes'
import { ListaObservacoes, AvisoManual } from '@/ui/cartoes'

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
}: {
  aberto: boolean
  onFechar: () => void
  classificacao: Classificacao | null
}) {
  const [form, setForm] = useState<FormSalvarClass>(FORM_INICIAL)
  const [salvando, setSalvando] = useState(false)

  // Abertura sempre parte de um formulário limpo (paridade com a v1).
  useEffect(() => {
    if (aberto) setForm(FORM_INICIAL)
  }, [aberto])

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
      let rSalvar = await salvarProduto(entrada)
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
      toast('Produto salvo com a classificação da Reforma.', 'ok')
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
      titulo="💾 Salvar classificação"
      subtitulo="A Reforma já está classificada. Informe os demais dados."
      largura="max-w-3xl"
      rodape={
        <>
          <Btn onClick={onFechar}>Cancelar</Btn>
          <Btn variante="primary" disabled={salvando} onClick={() => void confirmar()}>
            💾 Salvar produto
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
              ['Red. IBS', fmtPct(redIBS)],
              ['Red. CBS', fmtPct(redCBS)],
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
        ? '⚠ Sem classificação específica — regra geral (tributação integral, alíquota cheia).'
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
                      className={`mb-2 block w-full cursor-pointer rounded-lg border-2 p-2.5 text-left transition ${
                        sel
                          ? 'border-brand-500 bg-brand-50/70 dark:border-aurum-700 dark:bg-brand-900/30'
                          : 'border-slate-200 bg-white hover:border-brand-300 dark:border-slate-700 dark:bg-slate-900'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-bold">
                          CST {cl.cst} · {cl.cClassTrib}
                        </span>
                        <span
                          className="pill bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                          title={`Redução de alíquota IBS/CBS aplicada sobre a referência (${fmtPct(rateIBS)} / ${fmtPct(rateCBS)})`}
                        >
                          Red. {fmtPct(redIBS)} / {fmtPct(redCBS)}
                        </span>
                      </div>
                      <div className="mt-1 text-xs">
                        {rr.descricaoCClassTrib || cl.baseLegal || '—'}
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
                        <span>Opção {i + 1}</span>
                        <span className="font-mono font-semibold text-slate-500 dark:text-slate-400">
                          Alíquota efetiva {fmtCarga(aliqIBS)} / {fmtCarga(aliqCBS)}
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
  const bcUnica = Math.abs(c.bcIBS - c.bcCBS) < 0.005
  const temReducao = (Number(redIBS) || 0) > 0 || (Number(redCBS) || 0) > 0

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-3 dark:border-aurum-900 dark:bg-brand-950/20">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-base">🧮</span>
        <h4 className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Prévia
        </h4>
        {temReducao ? (
          <span className="ml-auto font-mono text-[10px] text-slate-500">
            BC {bcUnica ? fmtMoeda(c.bcIBS) : `${fmtMoeda(c.bcIBS)} / ${fmtMoeda(c.bcCBS)}`}
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div>
          <div className="text-[10px] font-bold uppercase text-slate-500">Operação</div>
          <div className="font-mono text-sm font-bold">{fmtMoeda(c.base)}</div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase text-slate-500">
            IBS ({fmtCarga(c.aliqIBS)})
          </div>
          <div className="font-mono text-sm font-bold text-brand-700 dark:text-aurum-200">
            {fmtMoeda(c.vIBS)}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase text-slate-500">
            CBS ({fmtCarga(c.aliqCBS)})
          </div>
          <div className="font-mono text-sm font-bold text-brand-700 dark:text-aurum-200">
            {fmtMoeda(c.vCBS)}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase text-slate-500">Total</div>
          <div className="font-mono text-sm font-bold text-emerald-700 dark:text-emerald-400">
            {fmtMoeda(c.total)}
          </div>
          <div className="font-mono text-[10px] text-slate-500">
            carga {base > 0 ? fmtCarga(c.carga) : fmtCarga(rateIBS + rateCBS)}
          </div>
        </div>
      </div>
      {regraGeral ? (
        <div className="mt-2 text-[11px] text-slate-600 dark:text-slate-400">
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
    setValor(p?.valorUnitario ? MASK.moeda(String(Math.round(p.valorUnitario * 100))) : '')
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
    fechar()
  }

  return (
    <Modal
      aberto={fonte !== null}
      onFechar={fechar}
      titulo="🧮 Adicionar à calculadora"
      subtitulo={
        dados
          ? `NCM ${fmtNcm(dados.ncm)} · defina quantidade e valor antes de confirmar`
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
                ['Red. IBS', fmtPct(dados.redIBS)],
                ['Red. CBS', fmtPct(dados.redCBS)],
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
            adição — reimportar a base não altera esta simulação.
          </p>
        </div>
      ) : null}
    </Modal>
  )
}

/* ------------------------------------------------------- detalhe SPED ------ */

export function ModalDetalheSped() {
  const item = useSped((s) => s.detalheAberto)
  const fechar = useSped((s) => s.fecharDetalhe)
  const salvarProdutoSped = useSped((s) => s.salvarProduto)
  const [processando, setProcessando] = useState(false)

  const ehResumo = item ? '_isResumo' in item : false
  const c = item?.classificacao
  const r = c?.resumo
  const cstDet = c?.cstDetalhes
  const observacoes = item?.observacoes ?? []

  const confirmar = async () => {
    if (!item) return
    if (ehResumo) {
      toast('Análise resumida não permite salvar produtos individuais (falta NCM).', 'warn')
      return
    }
    setProcessando(true)
    try {
      await salvarProdutoSped(item)
    } finally {
      setProcessando(false)
    }
  }

  return (
    <Modal
      aberto={Boolean(item)}
      onFechar={fechar}
      titulo={item ? `Código: ${item.codItem}` : ''}
      subtitulo={item ? item.descricaoProduto : undefined}
      largura="max-w-4xl"
      rodape={
        <>
          <Btn onClick={fechar}>Fechar</Btn>
          {!ehResumo ? (
            <Btn variante="primary" disabled={processando} onClick={() => void confirmar()}>
              💾 Salvar produto
            </Btn>
          ) : null}
        </>
      }
    >
      {item && c ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Pill cor="brand">Código: {item.codItem}</Pill>
            <Pill cor="emerald">SAÍDA</Pill>
            {item.tipoDoc ? <Pill>Doc {item.tipoDoc}</Pill> : null}
            <Pill>Nota: {item.numDoc}</Pill>
            <Pill>Data: {item.data}</Pill>
          </div>

          <div>
            <h3 className="text-lg font-bold">{item.descricaoProduto}</h3>
            <div className="mt-1 font-mono text-sm text-brand-700 dark:text-aurum-200">
              {fmtNcm(item.ncm)}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/40">
              <div className="text-[10px] font-bold uppercase text-slate-500">Quantidade</div>
              <div className="font-mono text-lg font-bold">{fmtNum(item.qtd)}</div>
              <div className="text-[10px] text-slate-500">{item.unid}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/40">
              <div className="text-[10px] font-bold uppercase text-slate-500">Valor Total</div>
              <div className="font-mono text-lg font-bold">{fmtMoeda(item.vlItem)}</div>
              <div className="text-[10px] text-slate-500">Base de cálculo</div>
            </div>
            <div className="rounded-xl bg-brand-50 p-3 dark:bg-brand-950/30">
              <div className="text-[10px] font-bold uppercase text-brand-600 dark:text-aurum-200">
                IBS Estimado
              </div>
              <div className="font-mono text-lg font-bold text-brand-700 dark:text-aurum-200">
                {fmtMoeda(item.ibs)}
              </div>
              <div className="text-[10px] text-slate-500">Redução: {fmtPct(item.redIBS)}</div>
            </div>
            <div className="rounded-xl bg-brand-50 p-3 dark:bg-brand-950/30">
              <div className="text-[10px] font-bold uppercase text-brand-600 dark:text-aurum-200">
                CBS Estimado
              </div>
              <div className="font-mono text-lg font-bold text-brand-700 dark:text-aurum-200">
                {fmtMoeda(item.cbs)}
              </div>
              <div className="text-[10px] text-slate-500">Redução: {fmtPct(item.redCBS)}</div>
            </div>
          </div>

          {/*
            ICMS do regime anterior: no SPED o item traz CST/CFOP, base,
            alíquota e valor — informações que a Reforma não substitui e que
            sustentam o crédito de entrada. Só renderiza quando há destaque.
          */}
          {item.cstIcms || item.vlIcms || item.vlBcIcms ? (
            <Painel className="border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-950/30">
              <h4 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                <span>🧾</span> ICMS (regime anterior)
              </h4>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-500">CST ICMS</div>
                  <div className="font-mono text-sm font-bold">{item.cstIcms || '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-500">CFOP</div>
                  <div className="font-mono text-sm font-bold">{item.cfop || '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-500">Base de cálculo</div>
                  <div className="font-mono text-sm font-bold">{fmtMoeda(item.vlBcIcms)}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-500">Alíquota</div>
                  <div className="font-mono text-sm font-bold">{fmtPct(item.aliqIcms)}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-500">Valor ICMS</div>
                  <div className="font-mono text-sm font-bold text-slate-700 dark:text-slate-200">
                    {fmtMoeda(item.vlIcms)}
                  </div>
                </div>
              </div>
            </Painel>
          ) : null}

          {item.cstPis || item.cstCofins ? (
            <Painel className="border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-800 dark:bg-amber-950/20">
              <h4 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                <span>📊</span> Tributação PIS/COFINS (pré-reforma)
              </h4>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-500">CST PIS</div>
                  <div className="font-mono text-sm font-bold">{item.cstPis || '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-500">Valor PIS</div>
                  <div className="font-mono text-sm font-bold text-red-600 dark:text-red-400">
                    {fmtMoeda(item.vlPis ?? 0)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-500">CST COFINS</div>
                  <div className="font-mono text-sm font-bold">{item.cstCofins || '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-500">Valor COFINS</div>
                  <div className="font-mono text-sm font-bold text-red-600 dark:text-red-400">
                    {fmtMoeda(item.vlCofins ?? 0)}
                  </div>
                </div>
              </div>
            </Painel>
          ) : null}

          <Painel className="border border-brand-200 bg-brand-50/50 p-4 dark:border-aurum-900 dark:bg-brand-950/20">
            <h4 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-brand-600 dark:text-aurum-200">
              <span>⚡</span> Classificação Tributária da Reforma
            </h4>
            {('manual' in (item as object) && (item as { manual?: boolean }).manual) || c.manual ? (
              <div className="mb-3">
                <AvisoManual compact fonteDescricao={c.manual?.fonteDescricao} fonteUrl={c.manual?.fonteUrl} />
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div>
                <div className="text-[10px] font-bold uppercase text-slate-500">CST</div>
                <div className="font-mono text-sm font-bold">{c.cst || '—'}</div>
                <div className="text-[10px] text-slate-500">{cstDet?.descricao ?? ''}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase text-slate-500">cClassTrib</div>
                <div className="font-mono text-sm font-bold">{c.cClassTrib || '—'}</div>
              </div>
              <div className="col-span-2">
                <div className="text-[10px] font-bold uppercase text-slate-500">Classificação</div>
                <div className="text-xs font-semibold">
                  {r?.descricaoCClassTrib || c.baseLegal || '—'}
                </div>
              </div>
            </div>
          </Painel>

          <ListaObservacoes itens={observacoes} />
        </div>
      ) : null}
    </Modal>
  )
}
