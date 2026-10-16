/**
 * Modal **Produto manual** — cadastro direto pela tela Produtos.
 *
 * Redesign compacto em **3 etapas** (sem scroll vertical longo):
 * - 1 · Identificação — SKU, nome, qtd + valor (com total ao vivo);
 * - 2 · NCM e Reforma — NCM + sugestão por nome, enquadramento automático;
 * - 3 · Regime anterior — entrada × saída lado a lado.
 *
 * A Reforma continua 100% automática via `resolverClassificacoes`.
 * N > 1 regras → lista compacta de escolha + leitura
 * (`ModalDetalheFiscal` + `BotaoVerLegislacao`).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Classificacao, NomenclaturaNcm } from '@/domain/entities'
import { fmtMoeda, fmtNcm, fmtPct, norm, parseMoeda, parseQtd } from '@/domain/services/format'
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
import { Btn, Campo, Modal, Pill, Texto } from '@/ui/kit'
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

const ETAPAS = [
  { id: 0, rotulo: 'Identificação', icone: '📦' },
  { id: 1, rotulo: 'NCM e Reforma', icone: '💠' },
  { id: 2, rotulo: 'Regime anterior', icone: '🧾' },
] as const

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
  const [etapa, setEtapa] = useState(0)
  const seqNcm = useRef(0)
  const seqNome = useRef(0)
  const ehEdicao = editando?.id != null

  // Abertura: limpa ou pré-preenche (edição vinda da linha da tabela).
  useEffect(() => {
    if (!aberto) return
    seqNcm.current = 0
    seqNome.current = 0
    setEtapa(0)
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
      setAvisoNcm(`⚡ ${r.lista.length} regras encontradas — escolha qual legislação aplicar.`)
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

  const totalPrevisto = useMemo(
    () => parseQtd(form.qtd) * parseMoeda(form.valor),
    [form.qtd, form.valor],
  )
  const ncmOk = norm(ncm).length === 8 && !!escolhida
  const identOk = form.codigo.trim().length > 0 && form.nome.trim().length > 0

  const avancar = () => {
    if (etapa === 0 && !identOk) {
      toast(!form.codigo.trim() ? 'Informe o SKU.' : 'Informe o nome do produto.', 'warn')
      return
    }
    if (etapa === 1 && !ncmOk) {
      toast(norm(ncm).length !== 8 ? 'Informe um NCM de 8 dígitos.' : 'Escolha a regra da Reforma.', 'warn')
      return
    }
    setEtapa((e) => Math.min(e + 1, ETAPAS.length - 1))
  }

  const confirmar = async () => {
    const codigo = form.codigo.trim()
    const nome = form.nome.trim()
    if (!codigo) {
      setEtapa(0)
      return toast('Informe o SKU.', 'warn')
    }
    if (!nome) {
      setEtapa(0)
      return toast('Informe o nome do produto.', 'warn')
    }
    if (norm(ncm).length !== 8) {
      setEtapa(1)
      return toast('Informe um NCM de 8 dígitos.', 'warn')
    }
    if (!escolhida) {
      setEtapa(1)
      return toast('Aguarde a tributação da Reforma ou escolha uma regra.', 'warn')
    }

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
    if (e.key === 'Enter') {
      e.preventDefault()
      if (etapa < ETAPAS.length - 1) avancar()
      else void confirmar()
    }
  }

  const redIBS = Number(escolhida?.resumo.percentualReducaoIBS ?? 0)
  const redCBS = Number(escolhida?.resumo.percentualReducaoCBS ?? 0)

  return (
    <>
      <Modal
        aberto={aberto}
        onFechar={onFechar}
        titulo={ehEdicao ? '✏️ Editar produto' : '➕ Novo produto'}
        subtitulo={
          escolhida
            ? `CST ${escolhida.cst} · ${escolhida.cClassTrib} · ${fmtMoeda(totalPrevisto)}`
            : 'Cadastro em 3 passos — sem rolagem longa.'
        }
        largura="max-w-4xl"
        rodape={
          <div className="flex w-full items-center justify-between gap-2">
            <span className="text-[11px] text-slate-400">
              Etapa {etapa + 1} de {ETAPAS.length}
              {totalPrevisto > 0 ? ` · Total ${fmtMoeda(totalPrevisto)}` : ''}
            </span>
            <span className="flex items-center gap-2">
              <Btn onClick={onFechar}>Cancelar</Btn>
              {etapa > 0 ? <Btn onClick={() => setEtapa((e) => e - 1)}>← Voltar</Btn> : null}
              {etapa < ETAPAS.length - 1 ? (
                <Btn variante="primary" onClick={avancar}>
                  Continuar →
                </Btn>
              ) : (
                <Btn variante="primary" carregando={salvando} onClick={() => void confirmar()}>
                  {salvando ? 'Salvando…' : ehEdicao ? '💾 Salvar alterações' : '💾 Salvar produto'}
                </Btn>
              )}
            </span>
          </div>
        }
      >
        {/* Stepper compacto — navegação direta por etapa */}
        <div className="mb-4 flex items-center gap-1.5" role="tablist" aria-label="Etapas do cadastro">
          {ETAPAS.map((s, i) => {
            const ativo = i === etapa
            const concluida = i < etapa || (i === 0 && identOk) || (i === 1 && ncmOk)
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={ativo}
                onClick={() => {
                  // Volta livre; avançar só com a etapa atual válida.
                  if (i <= etapa) setEtapa(i)
                  else if (i === 1 && identOk) setEtapa(1)
                  else if (i === 2 && identOk && ncmOk) setEtapa(2)
                  else avancar()
                }}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-[11px] font-bold transition ${
                  ativo
                    ? 'border-brand-500 bg-brand-50 text-brand-800 shadow-card dark:border-aurum-500 dark:bg-brand-950/50 dark:text-aurum-100'
                    : concluida
                      ? 'border-emerald-200 bg-emerald-50/60 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'
                      : 'border-[var(--line)] bg-slate-50 text-slate-500 dark:bg-slate-950/40'
                }`}
              >
                <span
                  className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${
                    ativo ? 'bg-brand-600 text-white' : concluida ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500 dark:bg-slate-800'
                  }`}
                >
                  {concluida && !ativo ? '✓' : i + 1}
                </span>
                <span aria-hidden="true">{s.icone}</span>
                <span className="hidden sm:inline">{s.rotulo}</span>
              </button>
            )
          })}
        </div>

        <div className="min-h-[340px]">
          {/* ── Etapa 1 · Identificação ─────────────────────────────── */}
          {etapa === 0 ? (
            <div className="rounded-2xl border border-[var(--line)] bg-slate-50/60 p-4 dark:bg-slate-950/30">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-500">
                  📦 Identificação do produto
                </h3>
                <Pill cor={identOk ? 'emerald' : 'slate'}>{identOk ? '✓ Pronto' : 'SKU + nome'}</Pill>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                <div className="md:col-span-2">
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
                </div>
                <div className="md:col-span-3">
                  <Campo label="Nome do produto" obrigatorio>
                    <Texto
                      value={form.nome}
                      placeholder="Ex.: Queijo Minas padrão"
                      className="field-sm"
                      onChange={(e) => campo('nome', e.target.value)}
                      onKeyDown={noEnter}
                    />
                  </Campo>
                </div>
                <div className="md:col-span-2">
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
                </div>
                <div className="md:col-span-2">
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
                <div className="rounded-xl bg-white p-2.5 dark:bg-slate-900">
                  <div className="text-[9px] font-bold uppercase text-slate-400">Total previsto</div>
                  <div className="font-mono text-base font-black text-brand-700 dark:text-aurum-200">
                    {fmtMoeda(totalPrevisto)}
                  </div>
                  <div className="text-[10px] text-slate-400">qtd × valor unitário</div>
                </div>
              </div>
              <p className="mt-3 rounded-xl bg-white px-3 py-2 text-[11px] leading-relaxed text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                💡 O SKU identifica o produto na empresa ativa. Quantidade e valor podem ficar para depois —
                o essencial agora é <strong>SKU + nome</strong>.
              </p>
            </div>
          ) : null}

          {/* ── Etapa 2 · NCM e Reforma ─────────────────────────────── */}
          {etapa === 1 ? (
            <div className="space-y-3">
              <div className="rounded-2xl border border-[var(--line)] bg-slate-50/60 p-4 dark:bg-slate-950/30">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-500">
                    💠 NCM e tributação da Reforma
                  </h3>
                  {carregandoNcm ? (
                    <Pill cor="brand">Consultando…</Pill>
                  ) : escolhida ? (
                    <Pill cor={regraGeral ? 'amber' : 'emerald'}>
                      {regraGeral ? '⚠ Regra geral' : '✓ Enquadrado'}
                    </Pill>
                  ) : (
                    <Pill cor="slate">Aguardando NCM</Pill>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
                  <div className="relative">
                    <Campo label="Sugerir NCM pelo nome" dica="Digite e clique para preencher.">
                      <Texto
                        value={buscaNome}
                        placeholder="Ex.: queijo mozarela"
                        className="field-sm"
                        autoComplete="off"
                        onChange={(e) => setBuscaNome(e.target.value)}
                      />
                    </Campo>
                    {buscaNome.trim().length >= 2 ? (
                      <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-[var(--line)] bg-white shadow-pop dark:bg-slate-900">
                        {buscandoNome && !sugestoesNome.length ? (
                          <div className="p-2 text-xs text-slate-500">Buscando NCM…</div>
                        ) : sugestoesNome.length ? (
                          <ul className="max-h-40 overflow-y-auto">
                            {sugestoesNome.map((s) => (
                              <li key={s.codigo}>
                                <button
                                  type="button"
                                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition hover:bg-brand-50 dark:hover:bg-slate-800"
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
                                  <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-slate-800">
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
                  </div>
                </div>
                {nomenclatura?.descricao ? (
                  <p className="mt-2 truncate text-[11px] text-slate-500" title={nomenclatura.descricao}>
                    {nomenclatura.descricao}
                  </p>
                ) : null}
                {avisoNcm && !escolhida ? (
                  <p className="mt-2 text-[11px] text-slate-500">{avisoNcm}</p>
                ) : null}
              </div>

              {escolhida ? (
                <div className="rounded-2xl border border-[var(--line)] bg-white p-3 dark:bg-slate-900">
                  {avisoNcm ? (
                    <div
                      className={`mb-2 rounded-lg border px-2.5 py-1.5 text-[11px] ${
                        avisoNcm.startsWith('⚠')
                          ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
                          : 'border-brand-200 bg-brand-50/60 text-slate-600 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300'
                      }`}
                    >
                      {avisoNcm}
                    </div>
                  ) : null}

                  {opcoes.length > 1 && !regraGeral ? (
                    <ul className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
                      {opcoes.map((cl, i) => {
                        const sel = escolhida === cl
                        const ehFallback = cl.integralFallback === true
                        const rIBS = Number(cl.resumo.percentualReducaoIBS ?? 0)
                        const rCBS = Number(cl.resumo.percentualReducaoCBS ?? 0)
                        const url = cl.resumo.urlLegislacao ?? cl.referencia?.urlLegislacao ?? null
                        return (
                          <li
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
                            className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition ${
                              sel
                                ? 'border-brand-500 bg-brand-50 shadow-card dark:border-aurum-500 dark:bg-brand-950/50'
                                : 'border-[var(--line)] bg-slate-50/60 hover:border-brand-300 dark:bg-slate-950/40'
                            }`}
                          >
                            <span
                              className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 font-mono text-[10px] font-black ${
                                sel ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 text-transparent'
                              }`}
                            >
                              ✓
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block font-mono text-xs font-black">
                                {i + 1} · CST {cl.cst} · {cl.cClassTrib}
                                {ehFallback ? <span className="ml-1.5 text-[10px] font-bold text-slate-500">🛡 integral</span> : null}
                              </span>
                              <span className="block truncate text-[11px] text-slate-500">
                                {cl.resumo.descricaoCClassTrib || cl.baseLegal || '—'}
                              </span>
                            </span>
                            {!ehFallback ? (
                              <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                −{fmtPct(rIBS)}/{fmtPct(rCBS)}
                              </span>
                            ) : null}
                            <span className="flex shrink-0 gap-1" onClick={(e) => e.stopPropagation()}>
                              <BotaoDetalhePremium
                                icone="📖"
                                rotulo="Ler"
                                titulo="Ficha fiscal completa desta opção"
                                onClick={() => setFiscalAberta(cl)}
                              />
                              {url ? (
                                <BotaoVerLegislacao
                                  url={url}
                                  titulo={cl.cstClassTribDetalhes?.lcRef || cl.baseLegal || 'Legislação'}
                                  referencia={cl.cstClassTribDetalhes?.lcRef || cl.baseLegal}
                                  texto={cl.resumo.descricaoCClassTrib ?? null}
                                  rotulo="Lei"
                                  className="btn-detalhe-premium"
                                />
                              ) : null}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-950/50">
                      <span className="font-mono text-sm font-black">
                        CST {escolhida.cst} · {escolhida.cClassTrib}
                      </span>
                      <Pill cor="brand">−{fmtPct(redIBS)} IBS · −{fmtPct(redCBS)} CBS</Pill>
                      {regraGeral ? <Pill cor="amber">⚠ Regra geral</Pill> : <Pill cor="emerald">✓ Oficial</Pill>}
                      <span className="ml-auto flex gap-1.5">
                        <BotaoDetalhePremium
                          icone="📋"
                          rotulo="Ler regra"
                          titulo="Ficha fiscal completa + simulação"
                          onClick={() => setFiscalAberta(escolhida)}
                        />
                        {(escolhida.resumo.urlLegislacao ?? escolhida.referencia?.urlLegislacao) ? (
                          <BotaoVerLegislacao
                            url={(escolhida.resumo.urlLegislacao ?? escolhida.referencia?.urlLegislacao) as string}
                            titulo={escolhida.cstClassTribDetalhes?.lcRef || escolhida.baseLegal || 'Legislação'}
                            referencia={escolhida.cstClassTribDetalhes?.lcRef || escolhida.baseLegal}
                            texto={escolhida.resumo.descricaoCClassTrib ?? null}
                            rotulo="Lei"
                            className="btn-detalhe-premium"
                          />
                        ) : null}
                      </span>
                    </div>
                  )}
                  <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-slate-500" title={escolhida.resumo.descricaoCClassTrib || escolhida.baseLegal}>
                    <strong>Aplicada:</strong> {escolhida.resumo.descricaoCClassTrib || escolhida.baseLegal || '—'}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* ── Etapa 3 · Regime anterior ───────────────────────────── */}
          {etapa === 2 ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-[var(--line)] bg-slate-50/60 p-3.5 dark:bg-slate-950/30">
                <h3 className="mb-1 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-slate-500">
                  <span aria-hidden="true">📥</span> Entrada
                  <span className="ml-auto rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-bold text-slate-500 dark:bg-slate-800">CFOP 1/2/3</span>
                </h3>
                <p className="mb-3 text-[10px] text-slate-400">Como o produto entra (compra/devolução).</p>
                <div className="space-y-2.5">
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
              </div>
              <div className="rounded-2xl border border-[var(--line)] bg-slate-50/60 p-3.5 dark:bg-slate-950/30">
                <h3 className="mb-1 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-slate-500">
                  <span aria-hidden="true">📤</span> Saída
                  <span className="ml-auto rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-bold text-slate-500 dark:bg-slate-800">CFOP 5/6/7</span>
                </h3>
                <p className="mb-3 text-[10px] text-slate-400">Como o produto sai (venda/remessa).</p>
                <div className="space-y-2.5">
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
              </div>
              <p className="rounded-xl bg-brand-50/70 px-3 py-2 text-[11px] leading-relaxed text-slate-500 md:col-span-2 dark:bg-brand-950/20 dark:text-slate-400">
                Opcional — deixe vazio o que não se aplica. A Reforma continua automática pelo NCM e não muda aqui.
              </p>
            </div>
          ) : null}
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
