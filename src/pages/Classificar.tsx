/**
 * Tela **Classificação individual** (SPEC §2.3 / §8).
 *
 * Formulário do produto à esquerda, painel de escolha da classificação da
 * Reforma à direita. Toda a regra vive no `useClassificar` — aqui há apenas
 * apresentação e debounce de digitação (Clean Code).
 *
 * Paridade com a v1:
 * - NCM carrega as opções com debounce de **300 ms** (e no `blur`);
 * - escolha por rádio **não** recarrega a lista (correção do `[BUG] L1061`);
 * - salvar validado no domínio; sucesso leva à tela **Produtos**.
 */
import { useEffect, useState } from 'react'
import type { NomenclaturaNcm } from '@/domain/entities'
import { MASK, fmtPct, norm } from '@/domain/services/format'
import { ModalReclassificacao } from '@/modais/reclassificacao'
import { useClassificar } from '@/store/classificar'
import { useSessao } from '@/store/sessao'
import { useUi, toast } from '@/store/ui'
import { ListaSugestoes, Btn, Campo, Painel, Pill, Texto, TituloSecao } from '@/ui/kit'
import { AvisoNcmExtinto } from '@/ui/cartoes'
import { SelectAux } from '@/ui/opcoes'

const DEBOUNCE_NCM = 300
const DEBOUNCE_SUGESTAO = 150

export function Classificar() {
  const form = useClassificar((s) => s.form)
  const setCampo = useClassificar((s) => s.setCampo)
  const nomenclatura = useClassificar((s) => s.nomenclatura)
  const opcoes = useClassificar((s) => s.opcoes)
  const escolhida = useClassificar((s) => s.escolhida)
  const escolher = useClassificar((s) => s.escolher)
  const carregarClassificacoes = useClassificar((s) => s.carregarClassificacoes)
  const avisoInvalido = useClassificar((s) => s.avisoInvalido)
  const carregando = useClassificar((s) => s.carregando)
  const regraGeral = useClassificar((s) => s.regraGeral)
  const editandoId = useClassificar((s) => s.editandoId)
  const salvar = useClassificar((s) => s.salvar)
  const limpar = useClassificar((s) => s.limpar)

  const ativa = useSessao((s) => s.ativa)
  const trocarView = useUi((s) => s.trocarView)
  const [reclassificando, setReclassificando] = useState(false)

  // Debounce de 300 ms do NCM (paridade com o `input` listener da v1).
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (norm(form.ncm).length === 8) void carregarClassificacoes(form.ncm)
    }, DEBOUNCE_NCM)
    return () => window.clearTimeout(t)
  }, [form.ncm, carregarClassificacoes])

  const aoSalvar = async () => {
    const ok = await salvar()
    if (!ok) return
    limpar()
    trocarView('produtos')
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0 space-y-6">
        <Painel>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-base font-bold">
                <span className="text-lg">📋</span> Classificação individual
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Preencha os dados e escolha a classificação na lateral.
              </p>
            </div>
            <Pill cor="brand">{editandoId != null ? 'Editando produto' : 'Novo produto'}</Pill>
          </div>

          <div className="p-5">
            {!ativa ? (
              <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                <span>ⓘ</span>
                <span>
                  Sem empresa ativa: o produto será salvo como <strong>sem empresa</strong>.
                </span>
              </div>
            ) : null}

            <TituloSecao>Identificação</TituloSecao>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <Campo label="SKU / Código interno" obrigatorio>
                <Texto
                  mono
                  autoComplete="off"
                  placeholder="SKU-0001"
                  value={form.codigo}
                  onChange={(e) => setCampo('codigo', e.target.value)}
                />
              </Campo>
              <Campo label="Nome do produto" obrigatorio>
                <Texto
                  autoComplete="off"
                  placeholder="Ex.: Queijo Minas Frescal 500g"
                  value={form.nome}
                  onChange={(e) => setCampo('nome', e.target.value)}
                />
              </Campo>

              <Campo
                label="NCM (8 dígitos)"
                obrigatorio
                className="md:col-span-2"
                dica={
                  nomenclatura
                    ? `📦 ${nomenclatura.descricao}`
                    : avisoInvalido
                      ? 'NCM deve ter 8 dígitos.'
                      : undefined
                }
              >
                <CampoNcmComSugestoes
                  valor={form.ncm}
                  aoMudar={(v) => setCampo('ncm', v)}
                  aoConfirmar={() => void carregarClassificacoes()}
                />
              </Campo>

              <Campo label="Quantidade">
                <Texto
                  mask="qtd"
                  mono
                  inputMode="decimal"
                  placeholder="0,000"
                  className="num-input"
                  value={form.qtd}
                  onChange={(e) => setCampo('qtd', e.target.value)}
                />
              </Campo>
              <Campo label="Valor unitário (R$)">
                <Texto
                  mask="moeda"
                  mono
                  inputMode="decimal"
                  placeholder="R$ 0,00"
                  className="num-input"
                  value={form.valor}
                  onChange={(e) => setCampo('valor', e.target.value)}
                />
              </Campo>
            </div>

            <div className="mt-7">
              <TituloSecao>Tributação anterior (pré-reforma)</TituloSecao>
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <Campo label="CFOP">
                  <SelectAux tipo="cfop" valor={form.cfop} onChange={(v) => setCampo('cfop', v)} />
                </Campo>
                <Campo label="CST ICMS">
                  <SelectAux
                    tipo="csticms"
                    valor={form.cstIcms}
                    onChange={(v) => setCampo('cstIcms', v)}
                  />
                </Campo>
                <Campo label="CST PIS">
                  <SelectAux
                    tipo="cstpiscofins"
                    valor={form.pis}
                    onChange={(v) => setCampo('pis', v)}
                    rotuloAdicionar="Cadastrar novo CST PIS/COFINS"
                  />
                </Campo>
                <Campo label="CST COFINS">
                  <SelectAux
                    tipo="cstpiscofins"
                    valor={form.cofins}
                    onChange={(v) => setCampo('cofins', v)}
                    rotuloAdicionar="Cadastrar novo CST PIS/COFINS"
                  />
                </Campo>
              </div>
            </div>

            <div className="mt-7 flex flex-wrap gap-2 border-t border-slate-100 pt-5 dark:border-slate-800">
              <Btn
                variante="primary"
                disabled={!escolhida}
                title={escolhida ? undefined : 'Escolha uma classificação na lateral.'}
                onClick={() => void aoSalvar()}
              >
                💾 Salvar produto
              </Btn>
              {editandoId != null ? (
                <Btn onClick={limpar}>Cancelar edição</Btn>
              ) : null}
              <Btn
                onClick={() => {
                  limpar()
                  toast('Formulário limpo.', 'warn')
                }}
              >
                Limpar
              </Btn>
            </div>
          </div>
        </Painel>
      </div>

      <aside className="xl:sticky xl:top-24 xl:h-fit">
        <Painel className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
            <h3 className="flex items-center gap-2 text-sm font-bold">
              <span>⚡</span> Classificação da Reforma
            </h3>
            {escolhida ? <Pill cor="emerald">✓ escolhida</Pill> : null}
          </div>

          <div className="max-h-[calc(100vh-220px)] overflow-y-auto p-4 text-sm">
            {nomenclatura?.dataFim ? (
              <div className="mb-2">
                <AvisoNcmExtinto nomenclatura={nomenclatura} />
              </div>
            ) : null}
            {carregando ? (
              <div className="rounded-xl bg-slate-50 p-6 text-center text-xs text-slate-500 dark:bg-slate-950/40">
                Carregando classificações…
              </div>
            ) : !opcoes.length ? (
              <div className="rounded-xl bg-slate-50 p-6 text-center text-xs text-slate-500 dark:bg-slate-950/40">
                {avisoInvalido
                  ? 'NCM deve ter 8 dígitos para carregar as classificações.'
                  : 'Informe o NCM para carregar as classificações'}
              </div>
            ) : (
              <div className="space-y-2">
                {regraGeral ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                    ⚠ Este NCM <strong>não possui classificação específica</strong>.
                    <button
                      type="button"
                      className="mt-2 w-full rounded-lg bg-brand-600 px-2 py-1.5 text-center text-[11px] font-bold text-white transition hover:bg-brand-700"
                      onClick={() => setReclassificando(true)}
                    >
                      ✋ Reclassificar manualmente
                    </button>
                  </div>
                ) : null}

                {opcoes.map((op, i) => {
                  const r = op.resumo
                  const redIBS = r.percentualReducaoIBS ?? 0
                  const redCBS = r.percentualReducaoCBS ?? 0
                  const sel = escolhida?.id === op.id && escolhida?.cst === op.cst
                  return (
                    <label
                      key={`${op.id}-${i}`}
                      className={`mb-2 block cursor-pointer rounded-xl border-2 p-3 transition ${
                        sel
                          ? 'border-brand-500 bg-brand-50 dark:border-aurum-700 dark:bg-brand-900/30'
                          : 'border-slate-200 bg-white hover:border-brand-300 dark:border-slate-700 dark:bg-slate-900'
                      }`}
                    >
                      <input
                        type="radio"
                        name="ncmClass"
                        className="sr-only"
                        checked={sel}
                        onChange={() => escolher(i)}
                      />
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-bold">
                          CST {op.cst} · {op.cClassTrib}
                        </span>
                        <span className="flex items-center gap-1">
                          {op.manual ? <Pill cor="amber">✋ manual</Pill> : null}
                          {redIBS >= 100 ? <Pill cor="red">ZERO</Pill> : null}
                          <Pill>
                            {fmtPct(redIBS)} / {fmtPct(redCBS)}
                          </Pill>
                        </span>
                      </div>
                      <div className="mt-1.5 text-xs font-semibold leading-snug">
                        {r.descricaoCClassTrib || op.baseLegal || '—'}
                      </div>
                      {sel ? (
                        <div className="mt-2 rounded-lg bg-brand-600 px-2 py-1 text-center text-[10px] font-bold text-white">
                          ✓ Classificação selecionada
                        </div>
                      ) : null}
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        </Painel>
      </aside>
      {reclassificando && norm(form.ncm).length === 8 ? (
        <ModalReclassificacao
          aberto={reclassificando}
          ncm={form.ncm}
          nomenclatura={nomenclatura}
          onFechar={() => setReclassificando(false)}
          onSalvo={() => void carregarClassificacoes(form.ncm)}
        />
      ) : null}
    </div>
  )
}

/* --------------------------------------------------------------- NCM ------- */

/**
 * Input de NCM com máscara + dropdown de sugestões.
 *
 * Paridade com `bindNcmSugestoesForm` (index.html L1044): setas sobem/descem,
 * Enter escolhe a opção ativa (senão confirma o NCM), Esc fecha, e o blur com
 * 150 ms de carência não fecha a lista antes do clique.
 */
function CampoNcmComSugestoes({
  valor,
  aoMudar,
  aoConfirmar,
}: {
  valor: string
  aoMudar: (v: string) => void
  aoConfirmar: () => void
}) {
  const buscarSugestoes = useClassificar((s) => s.buscarSugestoes)
  const sugestoes = useClassificar((s) => s.sugestoes)
  const carregarClassificacoes = useClassificar((s) => s.carregarClassificacoes)
  const [focado, setFocado] = useState(false)
  const [ativo, setAtivo] = useState(-1)

  const digitos = norm(valor)
  const aberto = focado && digitos.length >= 2 && digitos.length < 8 && sugestoes.length > 0

  useEffect(() => {
    if (!focado || digitos.length < 2 || digitos.length === 8) return
    const t = window.setTimeout(() => void buscarSugestoes(valor), DEBOUNCE_SUGESTAO)
    return () => window.clearTimeout(t)
  }, [valor, focado, digitos.length, buscarSugestoes])

  useEffect(() => {
    if (!aberto) setAtivo(-1)
  }, [aberto])

  const escolher = (n: NomenclaturaNcm) => {
    const c = MASK.ncm(n.codigo)
    aoMudar(c)
    setAtivo(-1)
    window.setTimeout(() => void carregarClassificacoes(c), 0)
  }

  return (
    <div className="relative">
      <div className="field-wrap">
        <span className="field-icon">🔢</span>
        <Texto
          mask="ncm"
          mono
          grande
          autoComplete="off"
          inputMode="numeric"
          placeholder="0000.00.00"
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
          onFocus={() => setFocado(true)}
          onBlur={() => window.setTimeout(() => setFocado(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (aberto && ativo >= 0) {
                e.preventDefault()
                const alvo = sugestoes[ativo]
                if (alvo) escolher(alvo)
                return
              }
              aoConfirmar()
              return
            }
            if (!aberto) return
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setAtivo((i) => Math.min(i + 1, sugestoes.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setAtivo((i) => Math.max(i - 1, 0))
            } else if (e.key === 'Escape') {
              setFocado(false)
              setAtivo(-1)
            }
          }}
        />
      </div>
      {aberto ? (
        <ListaSugestoes
          itens={sugestoes}
          chave={(n) => n.codigo}
          ativo={ativo}
          onSetAtivo={setAtivo}
          onEscolher={escolher}
          render={(n) => (
            <span className="min-w-0 flex-1">
              <span className="block font-mono text-xs font-bold text-brand-700 dark:text-aurum-200">
                {n.codigoOriginal}
              </span>
              <span className="block truncate text-[11px] text-slate-600 dark:text-slate-300">
                {n.descricao}
              </span>
            </span>
          )}
        />
      ) : null}
    </div>
  )
}
