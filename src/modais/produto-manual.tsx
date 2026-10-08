/**
 * Modal **Produto manual** — cadastro direto pela tela Produtos.
 *
 * - Identificação e regime anterior: preenchimento manual (SKU, nome, qtd,
 *   valor, CFOP, CST ICMS, PIS, COFINS).
 * - NCM: digitação com máscara + sugestão por nome
 *   (`buscarNomenclaturaPorTexto`) — clicar preenche o NCM.
 * - Tributos da Reforma: 100% automáticos via `resolverClassificacoes`.
 *   N > 1 regras → lista de escolha com botão de leitura
 *   (`ModalDetalheFiscal` + `BotaoVerLegislacao`) por opção; o usuário
 *   escolhe qual legislação aplicar e o sistema congela essa escolha.
 */
import { useEffect, useRef, useState } from 'react'
import type { Classificacao, NomenclaturaNcm } from '@/domain/entities'
import { fmtNcm, fmtPct, norm, parseMoeda, parseQtd } from '@/domain/services/format'
import {
  buscarNomenclaturaPorTexto,
  resolverClassificacoes,
  type ResultadoBuscaTexto,
} from '@/infrastructure/base/classificacao-repo'
import { salvarProduto, normalizarFluxo, type EntradaProduto } from '@/application/produtos'
import { validarProdutoMultiagente, primeiroBloqueio } from '@/domain/services/validacao-produto'
import { useProdutos, type ProdutoLinha } from '@/store/produtos'
import { useSessao } from '@/store/sessao'
import { confirmar as confirmarDialogo } from '@/store/dialogo'
import { toast } from '@/store/ui'
import { Btn, Campo, Modal, Pill, Texto, TituloSecao } from '@/ui/kit'
import { CampoTributoAntigo } from '@/ui/tributo-antigo'
import { BotaoVerLegislacao } from '@/ui/cartoes'
import { BotaoDetalhePremium, ModalDetalheFiscal } from '@/ui/consulta-premium'

interface FormManual {
  codigo: string
  nome: string
  qtd: string
  valor: string
  cfopEntrada: string
  cfopSaida: string
  cstIcmsEntrada: string
  cstIcmsSaida: string
  pisEntrada: string
  pisSaida: string
  cofinsEntrada: string
  cofinsSaida: string
}

const FORM_VAZIO: FormManual = {
  codigo: '',
  nome: '',
  qtd: '',
  valor: '',
  cfopEntrada: '',
  cfopSaida: '',
  cstIcmsEntrada: '',
  cstIcmsSaida: '',
  pisEntrada: '',
  pisSaida: '',
  cofinsEntrada: '',
  cofinsSaida: '',
}

export function ModalProdutoManual({
  aberto,
  onFechar,
  editando = null,
}: {
  aberto: boolean
  onFechar: () => void
  /** Quando informado, o modal abre preenchido e salva via `editarId`. */
  editando?: ProdutoLinha | null
}) {
  const [form, setForm] = useState<FormManual>(FORM_VAZIO)
  const [ncm, setNcm] = useState('')
  const [buscaNome, setBuscaNome] = useState('')
  const [sugestoesNome, setSugestoesNome] = useState<ResultadoBuscaTexto[]>([])
  const [buscandoNome, setBuscandoNome] = useState(false)
  const [nomenclatura, setNomenclatura] = useState<NomenclaturaNcm | null>(null)
  const [opcoes, setOpcoes] = useState<Classificacao[]>([])
  const [escolhida, setEscolhida] = useState<Classificacao | null>(null)
  const [regraGeral, setRegraGeral] = useState(false)
  const [carregandoNcm, setCarregandoNcm] = useState(false)
  const [avisoNcm, setAvisoNcm] = useState<string | null>(null)
  const [fiscalAberta, setFiscalAberta] = useState<Classificacao | null>(null)
  const [salvando, setSalvando] = useState(false)
  const seqNcm = useRef(0)
  const seqNome = useRef(0)
  const ehEdicao = editando?.id != null

  // Abertura: limpa ou pré-preenche (edição vinda da linha da tabela).
  useEffect(() => {
    if (!aberto) return
    seqNcm.current = 0
    seqNome.current = 0
    if (editando) {
      const fluxo = normalizarFluxo(editando as unknown as EntradaProduto)
      setForm({
        codigo: editando.codigo ?? '',
        nome: editando.nome ?? '',
        qtd: editando.quantidade ? String(editando.quantidade).replace('.', ',') : '',
        valor: editando.valorUnitario ? String(editando.valorUnitario).replace('.', ',') : '',
        cfopEntrada: (editando as unknown as Record<string, unknown>).cfopEntrada as string ?? fluxo.cfopEntrada ?? (editando.cfop ?? ''),
        cfopSaida: (editando as unknown as Record<string, unknown>).cfopSaida as string ?? fluxo.cfopSaida ?? '',
        cstIcmsEntrada: (editando as unknown as Record<string, unknown>).cstIcmsEntrada as string ?? fluxo.cstIcmsEntrada ?? (editando.cstIcms ?? ''),
        cstIcmsSaida: (editando as unknown as Record<string, unknown>).cstIcmsSaida as string ?? fluxo.cstIcmsSaida ?? '',
        pisEntrada: (editando as unknown as Record<string, unknown>).pisEntrada as string ?? fluxo.pisEntrada ?? (editando.pis ?? ''),
        pisSaida: (editando as unknown as Record<string, unknown>).pisSaida as string ?? fluxo.pisSaida ?? '',
        cofinsEntrada: (editando as unknown as Record<string, unknown>).cofinsEntrada as string ?? fluxo.cofinsEntrada ?? (editando.cofins ?? ''),
        cofinsSaida: (editando as unknown as Record<string, unknown>).cofinsSaida as string ?? fluxo.cofinsSaida ?? '',
      })
      setNcm(fmtNcm(editando.ncm) || editando.ncm || '')
      setBuscaNome('')
      setSugestoesNome([])
      void resolver(editando.ncm, editando)
    } else {
      setForm(FORM_VAZIO)
      setNcm('')
      setBuscaNome('')
      setSugestoesNome([])
      setNomenclatura(null)
      setOpcoes([])
      setEscolhida(null)
      setRegraGeral(false)
      setAvisoNcm(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto])

  async function resolver(textoNcm: string, prodEdicao?: ProdutoLinha | null) {
    const dig = norm(textoNcm)
    const seq = ++seqNcm.current
    if (dig.length !== 8) {
      setNomenclatura(null)
      setOpcoes([])
      setEscolhida(null)
      setRegraGeral(false)
      setAvisoNcm(dig.length === 0 ? null : 'Informe um NCM de 8 dígitos.')
      return
    }
    setCarregandoNcm(true)
    try {
      const r = await resolverClassificacoes(dig)
      if (seq !== seqNcm.current) return
      setNomenclatura(r.nomenclatura)
      setOpcoes(r.lista)
      setRegraGeral(r.regraGeral)
      if (!r.nomenclatura && !r.lista.length) {
        setAvisoNcm('NCM não encontrado na nomenclatura — confira os dígitos.')
        setEscolhida(null)
        return
      }
      if (r.regraGeral) {
        setEscolhida(r.lista[0] ?? null)
        setAvisoNcm('⚠ Sem vínculo oficial — regra geral (tributação integral, alíquota cheia).')
        return
      }
      if (r.lista.length === 1) {
        setEscolhida(r.lista[0])
        setAvisoNcm(null)
        return
      }
      // N > 1: preserva a escolha da edição quando ainda válida; senão exige
      // escolha explícita (primeira pré-selecionada, mas trocável).
      const alvo = prodEdicao ?? editando
      const anterior =
        alvo && r.lista.some((c) => c.cst === alvo.cstReforma && c.cClassTrib === alvo.cClassTrib)
          ? (r.lista.find((c) => c.cst === alvo.cstReforma && c.cClassTrib === alvo.cClassTrib) ?? null)
          : null
      setEscolhida(anterior ?? r.lista[0] ?? null)
      setAvisoNcm(`⚡ ${r.lista.length} regras encontradas — leia e escolha qual legislação aplicar.`)
    } finally {
      if (seq === seqNcm.current) setCarregandoNcm(false)
    }
  }

  // Sugestão de NCM por nome (debounce 350 ms, top-8, só leitura).
  useEffect(() => {
    const termo = buscaNome.trim()
    if (termo.length < 2) {
      setSugestoesNome([])
      setBuscandoNome(false)
      return
    }
    const seq = ++seqNome.current
    setBuscandoNome(true)
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const lista = await buscarNomenclaturaPorTexto(termo, 8)
          if (seq !== seqNome.current) return
          // Produto = NCM (8 dígitos). NBS (9 dígitos, serviços) nunca entra
          // aqui — defesa em profundidade além do filtro do índice.
          setSugestoesNome(lista.filter((s) => String(s.codigo ?? '').replace(/\D/g, '').length === 8))
        } catch {
          if (seq === seqNome.current) setSugestoesNome([])
        } finally {
          if (seq === seqNome.current) setBuscandoNome(false)
        }
      })()
    }, 350)
    return () => window.clearTimeout(t)
  }, [buscaNome])

  // NCM digitado: resolve com debounce de 400 ms + no blur.
  useEffect(() => {
    if (!aberto) return
    const dig = norm(ncm)
    if (dig.length !== 8) {
      // Limpa parcial sem piscar durante a digitação.
      if (dig.length === 0) {
        setOpcoes([])
        setEscolhida(null)
        setNomenclatura(null)
        setAvisoNcm(null)
      }
      return
    }
    const t = window.setTimeout(() => void resolver(ncm), 400)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ncm, aberto])

  const campo = <K extends keyof FormManual>(k: K, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const confirmar = async () => {
    const codigo = form.codigo.trim()
    const nome = form.nome.trim()
    if (!codigo) return toast('Informe o SKU.', 'warn')
    if (!nome) return toast('Informe o nome do produto.', 'warn')
    if (norm(ncm).length !== 8) return toast('Informe um NCM de 8 dígitos.', 'warn')
    if (!escolhida) return toast('Aguarde a tributação da Reforma ou escolha uma regra.', 'warn')

    const ativa = useSessao.getState().ativa
    const entrada: EntradaProduto = {
      empresaId: ativa?.id ?? null,
      codigo,
      nome,
      ncm: norm(ncm),
      cfop: form.cfopEntrada || form.cfopSaida,
      cstIcms: form.cstIcmsEntrada || form.cstIcmsSaida,
      pis: form.pisEntrada || form.pisSaida,
      cofins: form.cofinsEntrada || form.cofinsSaida,
      cfopEntrada: form.cfopEntrada.trim(),
      cfopSaida: form.cfopSaida.trim(),
      cstIcmsEntrada: form.cstIcmsEntrada.trim(),
      cstIcmsSaida: form.cstIcmsSaida.trim(),
      pisEntrada: form.pisEntrada.trim(),
      pisSaida: form.pisSaida.trim(),
      cofinsEntrada: form.cofinsEntrada.trim(),
      cofinsSaida: form.cofinsSaida.trim(),
      quantidade: parseQtd(form.qtd),
      valorUnitario: parseMoeda(form.valor),
      classificacao: escolhida,
    }

    // Blindagem multiagente antes de tocar no banco.
    const veredito = await validarProdutoMultiagente(entrada)
    if (!veredito.ok) {
      toast(primeiroBloqueio(veredito) ?? 'Dados inválidos.', 'warn')
      return
    }

    setSalvando(true)
    try {
      let r = await salvarProduto(entrada, ehEdicao ? { editarId: editando?.id ?? null } : undefined)
      if (!r.ok && r.motivo.includes('Já existe o SKU')) {
        const ok = await confirmarDialogo('Sobrescrever produto?', r.motivo, {
          icone: '⚠',
          confirmar: 'Sobrescrever',
          perigo: true,
        })
        if (!ok) return
        r = await salvarProduto(entrada, { forcar: true })
      }
      if (!r.ok) {
        toast(r.motivo, 'warn')
        return
      }
      await useProdutos.getState().carregar()
      toast(ehEdicao ? 'Produto atualizado.' : 'Produto salvo com a tributação da Reforma.', 'ok')
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

  const redIBS = Number(escolhida?.resumo.percentualReducaoIBS ?? 0)
  const redCBS = Number(escolhida?.resumo.percentualReducaoCBS ?? 0)

  return (
    <>
      <Modal
        aberto={aberto}
        onFechar={onFechar}
        titulo={ehEdicao ? '✏️ Editar produto' : '➕ Novo produto'}
        subtitulo="Preencha os dados manualmente — a Reforma é automática pelo NCM."
        largura="max-w-3xl"
        rodape={
          <>
            <Btn onClick={onFechar}>Cancelar</Btn>
            <Btn variante="primary" carregando={salvando} onClick={() => void confirmar()}>
              {salvando ? 'Salvando…' : ehEdicao ? '💾 Salvar alterações' : '💾 Salvar produto'}
            </Btn>
          </>
        }
      >
        <div className="space-y-5">
          <section>
            <TituloSecao>Identificação (manual)</TituloSecao>
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
            <TituloSecao>NCM — sugestão e tributação automática</TituloSecao>
            <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
              <Campo label="NCM (8 dígitos)" obrigatorio dica="A Reforma preenche sozinha ao completar.">
                <Texto
                  mask="ncm"
                  mono
                  grande
                  value={ncm}
                  placeholder="0000.00.00"
                  onChange={(e) => setNcm(e.target.value)}
                  onBlur={() => {
                    if (norm(ncm).length === 8) void resolver(ncm)
                  }}
                />
              </Campo>
              <Campo label="Sugerir NCM pelo nome" dica="Digite o nome — clique preenche o NCM.">
                <Texto
                  value={buscaNome}
                  placeholder="Ex.: queijo mozarela"
                  className="field-sm"
                  autoComplete="off"
                  onChange={(e) => setBuscaNome(e.target.value)}
                />
              </Campo>
            </div>

            {buscaNome.trim().length >= 2 ? (
              <div className="mt-2 rounded-xl border border-[var(--line)] bg-slate-50 p-2 dark:bg-slate-950/40">
                {buscandoNome && !sugestoesNome.length ? (
                  <div className="p-2 text-xs text-slate-500">Buscando NCM…</div>
                ) : sugestoesNome.length ? (
                  <ul className="max-h-44 space-y-1 overflow-y-auto">
                    {sugestoesNome.map((s) => (
                      <li key={s.codigo}>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-white dark:hover:bg-slate-900"
                          title={`${s.caminhoTexto} — ${s.totalClassificacoes} regra(s)`}
                          onClick={() => {
                            setNcm(fmtNcm(s.codigo))
                            void resolver(s.codigo)
                            setBuscaNome('')
                            setSugestoesNome([])
                          }}
                        >
                          <span className="font-mono text-xs font-black text-brand-700 dark:text-aurum-200">
                            {fmtNcm(s.codigo)}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-xs text-slate-600 dark:text-slate-300">
                            {s.descricao}
                          </span>
                          <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {s.totalClassificacoes} regra{s.totalClassificacoes === 1 ? '' : 's'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="p-2 text-xs text-slate-500">Nenhum NCM para “{buscaNome.trim()}”.</div>
                )}
              </div>
            ) : null}

            <div className="mt-3 rounded-xl border border-[var(--line)] bg-slate-50 p-4 dark:bg-slate-950/40">
              {carregandoNcm ? (
                <div className="text-xs text-slate-500">Consultando a Reforma…</div>
              ) : !escolhida ? (
                <div className="text-xs text-slate-500">
                  {avisoNcm ?? 'Complete o NCM para o sistema preencher CST, cClassTrib e reduções.'}
                  {nomenclatura?.descricao ? (
                    <div className="mt-1 font-semibold text-slate-600 dark:text-slate-300">{nomenclatura.descricao}</div>
                  ) : null}
                </div>
              ) : (
                <>
                  {avisoNcm ? (
                    <div
                      className={`mb-2 rounded-lg border p-2 text-[11px] ${
                        avisoNcm.startsWith('⚠')
                          ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
                          : 'border-brand-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                      }`}
                    >
                      {avisoNcm}
                    </div>
                  ) : null}
                  {nomenclatura?.descricao ? (
                    <div className="mb-2 text-[11px] text-slate-500">{nomenclatura.descricao}</div>
                  ) : null}

                  {opcoes.length > 1 && !regraGeral ? (
                    <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                      {opcoes.map((cl, i) => {
                        const sel = escolhida === cl
                        const ehFallback = cl.integralFallback === true
                        const rIBS = Number(cl.resumo.percentualReducaoIBS ?? 0)
                        const rCBS = Number(cl.resumo.percentualReducaoCBS ?? 0)
                        const url = cl.resumo.urlLegislacao ?? cl.referencia?.urlLegislacao ?? null
                        const base = cl.cstClassTribDetalhes?.lcRef || cl.baseLegal || '—'
                        return (
                          <div
                            key={cl.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => setEscolhida(cl)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                setEscolhida(cl)
                              }
                            }}
                            aria-pressed={sel}
                            title={ehFallback ? 'Não se encaixa nessa qualificação? Aplique a tributação integral — confira se seu produto realmente atende a essa família de NCM.' : undefined}
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
                                  onClick={() => setEscolhida(cl)}
                                  title="Aplicar esta legislação ao produto"
                                >
                                  ✓ Usar esta
                                </button>
                              ) : null}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : null}

                  <div className="mt-3 rounded-xl bg-white p-3 dark:bg-slate-900">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Pill cor="brand">Reforma automática</Pill>
                      {regraGeral ? <Pill cor="amber">⚠ Regra geral</Pill> : <Pill cor="emerald">✓ Enquadramento oficial</Pill>}
                      {escolhida.manual ? <Pill cor="amber">👤 Manual</Pill> : null}
                    </div>
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                      {[
                        ['CST', escolhida.cst || '—'],
                        ['cClassTrib', escolhida.cClassTrib || '—'],
                        ['Redução IBS', fmtPct(redIBS)],
                        ['Redução CBS', fmtPct(redCBS)],
                      ].map(([rot, val]) => (
                        <div key={rot} className="rounded-lg bg-slate-50 p-2 dark:bg-slate-950/60">
                          <div className="text-[9px] font-bold uppercase text-slate-500">{rot}</div>
                          <div className="font-mono text-sm font-bold">{val}</div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 text-[11px] text-slate-600 dark:text-slate-400">
                      <strong>Aplicada:</strong> {escolhida.resumo.descricaoCClassTrib || escolhida.baseLegal || '—'}
                    </div>
                    <div className="aurum-ai-acoes" role="group" aria-label="Ler a regra aplicada">
                      <BotaoDetalhePremium
                        icone="📋"
                        rotulo="Ler regra aplicada"
                        titulo="Ficha fiscal completa + simulação — abre em modal"
                        onClick={() => setFiscalAberta(escolhida)}
                      />
                      {(escolhida.resumo.urlLegislacao ?? escolhida.referencia?.urlLegislacao) ? (
                        <BotaoVerLegislacao
                          url={(escolhida.resumo.urlLegislacao ?? escolhida.referencia?.urlLegislacao) as string}
                          titulo={escolhida.cstClassTribDetalhes?.lcRef || escolhida.baseLegal || 'Legislação'}
                          referencia={escolhida.cstClassTribDetalhes?.lcRef || escolhida.baseLegal}
                          texto={escolhida.resumo.descricaoCClassTrib ?? null}
                          rotulo="Legislação"
                          className="btn-detalhe-premium"
                        />
                      ) : null}
                    </div>
                  </div>
                </>
              )}
            </div>
          </section>

          <section>
            <TituloSecao>Como o produto ENTRA — tributação anterior (manual)</TituloSecao>
            <p className="mt-1 text-[11px] text-slate-500">CFOP 1/2/3 · digite para filtrar e veja a descrição abaixo de cada campo.</p>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <Campo label="CFOP entrada">
                <CampoTributoAntigo tipo="cfop" rotulo="CFOP entrada" valor={form.cfopEntrada} dicaTipo semNbs onChange={(v) => campo('cfopEntrada', v)} />
              </Campo>
              <Campo label="CST ICMS entrada">
                <CampoTributoAntigo tipo="csticms" rotulo="CST ICMS entrada" valor={form.cstIcmsEntrada} onChange={(v) => campo('cstIcmsEntrada', v)} />
              </Campo>
              <Campo label="PIS entrada">
                <CampoTributoAntigo tipo="cstpiscofins" rotulo="PIS entrada" valor={form.pisEntrada} onChange={(v) => campo('pisEntrada', v)} />
              </Campo>
              <Campo label="COFINS entrada">
                <CampoTributoAntigo tipo="cstpiscofins" rotulo="COFINS entrada" valor={form.cofinsEntrada} onChange={(v) => campo('cofinsEntrada', v)} />
              </Campo>
            </div>
          </section>

          <section>
            <TituloSecao>Como o produto SAI — tributação anterior (manual)</TituloSecao>
            <p className="mt-1 text-[11px] text-slate-500">CFOP 5/6/7 · a Reforma continua automática pelo NCM (não muda).</p>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <Campo label="CFOP saída">
                <CampoTributoAntigo tipo="cfop" rotulo="CFOP saída" valor={form.cfopSaida} dicaTipo semNbs onChange={(v) => campo('cfopSaida', v)} />
              </Campo>
              <Campo label="CST ICMS saída">
                <CampoTributoAntigo tipo="csticms" rotulo="CST ICMS saída" valor={form.cstIcmsSaida} onChange={(v) => campo('cstIcmsSaida', v)} />
              </Campo>
              <Campo label="PIS saída">
                <CampoTributoAntigo tipo="cstpiscofins" rotulo="PIS saída" valor={form.pisSaida} onChange={(v) => campo('pisSaida', v)} />
              </Campo>
              <Campo label="COFINS saída">
                <CampoTributoAntigo tipo="cstpiscofins" rotulo="COFINS saída" valor={form.cofinsSaida} onChange={(v) => campo('cofinsSaida', v)} />
              </Campo>
            </div>
          </section>
        </div>
      </Modal>

      {fiscalAberta ? (
        <ModalDetalheFiscal
          aberto={fiscalAberta !== null}
          onFechar={() => setFiscalAberta(null)}
          cl={fiscalAberta}
          nomenclatura={nomenclatura}
        />
      ) : null}
    </>
  )
}
