/**
 * Blocos compactos de **detalhe de tributos** com botão-olho elegante.
 *
 * Padrão minimalista das listagens: a tabela mostra só o essencial
 * (SKU/produto, NCM, resumo da Reforma e total) e todo o resto —
 * tributos do regime anterior (CFOP, CST ICMS, PIS, COFINS) e demais
 * informações — abre neste modal compacto ao clicar no botão de tributos.
 *
 * Reutilizado em: Produtos, XML (notas/itens/DANFE), Lote e SPED.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { fmtMoeda, fmtNcm, fmtNum, fmtPct } from '@/domain/services/format'
import { Btn, Modal, Pill } from '@/ui/kit'
import { AvisoManual } from '@/ui/cartoes'
import type { ProdutoLinha } from '@/store/produtos'
import type { ResultadoItemNfe } from '@/infrastructure/nfe/tipos'
import { creditoIbsCbsDoItem, divergenciaXmlSistema } from '@/infrastructure/nfe/credito'
import { salvarProdutosEmLote } from '@/application/produtos'
import { useSessao } from '@/store/sessao'
import { toast } from '@/store/ui'

/**
 * Origem da classificação do sistema: de onde saiu o enquadramento exibido
 * em "Pela legislação". Manual (usuário) isenta o sistema; regra geral é o
 * fallback; senão veio da base oficial (automática).
 */
export function OrigemSistema({ item }: { item: ResultadoItemNfe }) {
  if (item.manual || item.classificacao.manual) return <Pill cor="amber">✋ Manual do usuário</Pill>
  if (item.regraGeral) return <Pill cor="slate">Regra geral</Pill>
  return <Pill cor="brand">Automática · base oficial</Pill>
}

/* ------------------------------------------------------------------ olho --- */

/**
 * Botão de detalhe de tributos — pílula elegante com olho em selo branco.
 * O rótulo padrão ("Tributos") dá affordance; `somenteIcone` mantém a
 * versão compacta para tabelas muito densas.
 */
export function Olho({
  titulo = 'Ver todos os tributos',
  onClick,
  rotulo = 'Tributos',
  somenteIcone = false,
}: {
  titulo?: string
  onClick: (e: React.MouseEvent) => void
  rotulo?: string
  somenteIcone?: boolean
}) {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      onClick={onClick}
      className={`group inline-flex items-center gap-1.5 rounded-full border border-brand-200/80 bg-gradient-to-b from-white to-brand-50 py-1 text-[10px] font-extrabold uppercase tracking-wide text-brand-700 shadow-sm transition-all hover:border-brand-500 hover:bg-brand-600 hover:text-white hover:shadow-pop dark:border-aurum-900 dark:from-brand-950/60 dark:to-slate-900 dark:text-brand-300 dark:hover:bg-brand-600 dark:hover:text-white ${
        somenteIcone ? 'px-1' : 'pl-1 pr-2.5'
      }`}
    >
      <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-600 text-white shadow-sm transition-colors group-hover:bg-white group-hover:text-brand-700 dark:bg-brand-500 dark:group-hover:bg-white dark:group-hover:text-brand-700">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </span>
      {somenteIcone ? null : rotulo}
    </button>
  )
}

/* --------------------------------------------------------------- blocos --- */

/** Seção compacta do modal (título + conteúdo em grade). */
export function Secao({
  titulo,
  icone,
  children,
}: {
  titulo: string
  icone: string
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3 dark:border-slate-700/60 dark:bg-slate-950/30">
      <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
        <span aria-hidden>{icone}</span> {titulo}
      </h4>
      {children}
    </section>
  )
}

/** Par rótulo → valor dentro das seções. */
export function Campo({
  rotulo,
  valor,
  mono,
  forte,
  titulo,
}: {
  rotulo: string
  valor: string
  mono?: boolean
  forte?: boolean
  titulo?: string
}) {
  return (
    <div className="min-w-0" title={titulo ?? (typeof valor === 'string' ? valor : undefined)}>
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{rotulo}</div>
      <div
        className={`truncate text-xs ${mono ? 'font-mono' : ''} ${forte ? 'font-black' : 'font-semibold text-slate-700 dark:text-slate-200'}`}
      >
        {valor}
      </div>
    </div>
  )
}

function Grade({ children, cols = 'grid-cols-2 md:grid-cols-4' }: { children: ReactNode; cols?: string }) {
  return <div className={`grid gap-2.5 ${cols}`}>{children}</div>
}

/* -------------------------------------------------------- produto (cadastro) --- */

/**
 * Modal compacto com **todos os tributos do produto do cadastro**.
 * A lista mostra só SKU · produto · NCM · resumo Reforma · total.
 */
export function ModalProdutoDetalhe({
  produto,
  onFechar,
}: {
  produto: ProdutoLinha | null
  onFechar: () => void
}) {
  return (
    <Modal
      aberto={produto !== null}
      onFechar={onFechar}
      titulo={produto ? `${produto.codigo} · ${produto.nome}` : ''}
      subtitulo={produto ? `NCM ${fmtNcm(produto.ncm)} · CST ${produto.cstReforma || '—'} · cClassTrib ${produto.cClassTrib || '—'}` : ''}
      largura="max-w-lg"
      rodape={null}
    >
      {produto ? (
        <div className="space-y-3">
          <Secao titulo="Identificação" icone="📦">
            <Grade cols="grid-cols-2 md:grid-cols-3">
              <Campo rotulo="SKU" valor={produto.codigo} mono forte />
              <Campo rotulo="NCM" valor={fmtNcm(produto.ncm)} mono />
              <Campo rotulo="Empresa" valor={produto.empresaNome ?? 'Sem empresa'} />
            </Grade>
            <p className="mt-2 truncate text-xs text-slate-500" title={produto.nome}>
              {produto.nome}
            </p>
          </Secao>

          <Secao titulo="Reforma (LC 214/2025)" icone="💠">
            {produto.classificacaoManual || produto.classificacaoSnapshot?.manual ? (
              <div className="mb-2">
                <AvisoManual
                  compact
                  fonteDescricao={produto.classificacaoSnapshot?.manual?.fonteDescricao}
                  fonteUrl={produto.classificacaoSnapshot?.manual?.fonteUrl}
                />
              </div>
            ) : null}
            <Grade cols="grid-cols-2 md:grid-cols-3">
              <Campo rotulo="CST Reforma" valor={produto.cstReforma || '—'} mono />
              <Campo rotulo="cClassTrib" valor={produto.cClassTrib || '—'} mono />
              <Campo rotulo="Red. IBS" valor={fmtPct(produto.redIBS)} mono />
              <Campo rotulo="Red. CBS" valor={fmtPct(produto.redCBS)} mono />
              <Campo rotulo="Qtd" valor={fmtNum(produto.quantidade)} mono />
              <Campo rotulo="Total" valor={fmtMoeda(produto.total)} mono forte />
            </Grade>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500" title={produto.descClass}>
              {produto.descClass}
            </p>
            {produto.baseLegal ? (
              <p className="mt-1 text-[10px] text-slate-400" title={produto.baseLegal}>
                Base legal: {produto.baseLegal}
              </p>
            ) : null}
          </Secao>

          <Secao titulo="Regime anterior" icone="🧾">
            <Grade cols="grid-cols-2 md:grid-cols-4">
              <Campo rotulo="CFOP" valor={produto.cfop || '—'} mono />
              <Campo rotulo="CST ICMS" valor={produto.cstIcms || '—'} mono />
              <Campo rotulo="PIS" valor={produto.pis || '—'} mono />
              <Campo rotulo="COFINS" valor={produto.cofins || '—'} mono />
            </Grade>
          </Secao>

          <Secao titulo="Valores" icone="💰">
            <Grade cols="grid-cols-3">
              <Campo rotulo="Qtd" valor={fmtNum(produto.quantidade)} mono />
              <Campo rotulo="V. unit" valor={fmtMoeda(produto.valorUnitario)} mono />
              <Campo rotulo="Total" valor={fmtMoeda(produto.total)} mono forte />
            </Grade>
          </Secao>
        </div>
      ) : null}
    </Modal>
  )
}

/* ------------------------------------------------------------- item NF-e --- */

/**
 * Modal compacto com **todos os tributos de um item de NF-e**.
 * A lista de itens mostra só código · produto · qtd · valor · selo
 * Reforma · total — CFOP, CST ICMS, ICMS (BC/alíquota/valor), PIS e
 * COFINS ficam aqui.
 */
export function ModalItemNfeDetalhe({
  item,
  onFechar,
}: {
  item: ResultadoItemNfe | null
  onFechar: () => void
}) {
  const cred = item ? creditoIbsCbsDoItem(item) : null
  const ativa = useSessao((s) => s.ativa)
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)

  // Troca de item: reseta o estado do botão salvar.
  useEffect(() => {
    setSalvo(false)
    setSalvando(false)
  }, [item?.codProd, item?.ncm])

  const salvar = async () => {
    if (!item || salvando) return
    if (ativa?.id == null) {
      toast('Vincule uma empresa para salvar o produto no cadastro.', 'warn')
      return
    }
    setSalvando(true)
    try {
      const r = await salvarProdutosEmLote(
        [
          {
            codigo: item.codProd,
            nome: item.descricao || item.codProd,
            ncm: item.ncm,
            cfop: item.cfop,
            cstIcms: item.cstIcms,
            pis: item.cstPis,
            cofins: item.cstCofins,
            quantidade: Number(item.qtd) || 0,
            valorUnitario: Number(item.vlUnit) || 0,
            classificacao: item.classificacao,
          },
        ],
        ativa.id,
      )
      if (r.salvos > 0) toast(`Produto "${item.descricao || item.codProd}" salvo no cadastro.`, 'ok')
      else if (r.atualizados > 0) toast('Produto atualizado no cadastro (SKU já existia).', 'ok')
      else toast('Não foi possível salvar — item sem código/classificação.', 'warn')
      setSalvo(true)
    } catch {
      toast('Falha ao salvar o produto. Tente de novo.', 'err')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal
      aberto={item !== null}
      onFechar={onFechar}
      titulo={item ? `${item.codProd} · ${item.descricao}` : ''}
      subtitulo={
        item
          ? `NCM ${fmtNcm(item.ncm)} · CFOP ${item.cfop || '—'} · Sistema CST ${item.classificacao.cst || '—'} · ${item.classificacao.cClassTrib || '—'}`
          : ''
      }
      largura="max-w-lg"
      rodape={
        item ? (
          <span className="flex flex-wrap items-center justify-end gap-2">
            <Btn tam="sm" onClick={onFechar}>
              Fechar
            </Btn>
            <Btn variante="primary" tam="sm" onClick={() => void salvar()} disabled={salvando}>
              {salvando ? 'Salvando…' : salvo ? '✓ Salvo · clicar atualiza' : '＋ Salvar produto'}
            </Btn>
          </span>
        ) : undefined
      }
    >
      {item && cred ? (
        <div className="space-y-3">
          <FaixaDivergencia item={item} />
          <Secao titulo="Produto" icone="📦">
            <Grade cols="grid-cols-2 md:grid-cols-4">
              <Campo rotulo="Código" valor={item.codProd} mono forte />
              <Campo rotulo="NCM" valor={fmtNcm(item.ncm)} mono />
              <Campo rotulo="CFOP" valor={item.cfop || '—'} mono />
              <Campo rotulo="Unid." valor={`${fmtNum(item.qtd)} ${item.unid || ''}`.trim()} mono />
              <Campo rotulo="V. unit" valor={fmtMoeda(item.vlUnit)} mono />
              <Campo rotulo="V. total" valor={fmtMoeda(item.vlTotal)} mono forte />
              <Campo
                rotulo="Crédito IBS/CBS"
                valor={cred.temCredito ? `✓ ${fmtMoeda(cred.vTotal)}` : '—'}
                mono
              />
              <Campo rotulo="Estimativa total" valor={fmtMoeda(item.totalTributos)} mono forte />
            </Grade>
          </Secao>

          <Secao titulo="Regime anterior" icone="🧾">
            <Grade cols="grid-cols-2 md:grid-cols-4">
              <Campo rotulo="CST ICMS" valor={item.cstIcms || '—'} mono />
              <Campo rotulo="ICMS valor" valor={fmtMoeda(item.vlIcms)} mono />
              <Campo rotulo="BC ICMS" valor={fmtMoeda(item.vBcIcms ?? 0)} mono />
              <Campo rotulo="Alíquota" valor={`${fmtNum(item.pIcms ?? 0)}%`} mono />
              <Campo rotulo="PIS" valor={`${item.cstPis || '—'} · ${fmtMoeda(item.vPis ?? 0)}`} mono />
              <Campo rotulo="COFINS" valor={`${item.cstCofins || '—'} · ${fmtMoeda(item.vCofins ?? 0)}`} mono />
            </Grade>
          </Secao>

          <Secao titulo="O que veio na nota (XML · grupo IBSCBS)" icone="🧾">
            {cred.cstIbsCbs || cred.cClassTrib || item.vBcIbsCbs || cred.temCredito ? (
              <Grade cols="grid-cols-2 md:grid-cols-3">
                <Campo rotulo="CST no XML" valor={item.cstIbsCbs || '—'} mono />
                <Campo rotulo="cClassTrib no XML" valor={item.cClassTribIbsCbs || '—'} mono />
                <Campo rotulo="BC IBS/CBS" valor={fmtMoeda(item.vBcIbsCbs ?? 0)} mono />
                <Campo rotulo="IBS destacado" valor={cred.vIbs > 0 ? fmtMoeda(cred.vIbs) : '—'} mono />
                <Campo rotulo="CBS destacada" valor={cred.vCbs > 0 ? fmtMoeda(cred.vCbs) : '—'} mono />
                <Campo rotulo="Total destacado" valor={cred.temCredito ? fmtMoeda(cred.vTotal) : '—'} mono forte />
              </Grade>
            ) : (
              <p className="text-[11px] leading-relaxed text-slate-500">
                Sem grupo <span className="font-mono">IBSCBS</span> neste item — XML anterior à
                Reforma ou emitente sem preenchimento. Não há tributação da nota para confrontar.
              </p>
            )}
          </Secao>

          <Secao titulo="Pela legislação (sistema)" icone="💠">
            {(item.manual || item.classificacao.manual) && (
              <div className="mb-2">
                <AvisoManual
                  compact
                  fonteDescricao={item.classificacao.manual?.fonteDescricao}
                  fonteUrl={item.classificacao.manual?.fonteUrl}
                />
              </div>
            )}
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <OrigemSistema item={item} />
              <span className="text-[11px] text-slate-500">
                Red. {fmtPct(item.redIBS)} / {fmtPct(item.redCBS)}
              </span>
            </div>
            <Grade cols="grid-cols-2 md:grid-cols-3">
              <Campo rotulo="CST sistema" valor={item.classificacao.cst || '—'} mono />
              <Campo rotulo="cClassTrib sistema" valor={item.classificacao.cClassTrib || '—'} mono />
              <Campo rotulo="IBS estimado" valor={fmtMoeda(item.ibs)} mono />
              <Campo rotulo="CBS estimada" valor={fmtMoeda(item.cbs)} mono />
              <Campo rotulo="Total estimado" valor={fmtMoeda(item.totalTributos)} mono forte />
              <Campo rotulo="Anexo" valor={item.anexo || '—'} mono />
            </Grade>
            {item.classificacao.baseLegal ? (
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500" title={item.classificacao.baseLegal}>
                Base legal: {item.classificacao.baseLegal.slice(0, 140)}
              </p>
            ) : null}
          </Secao>
          <p className="rounded-xl bg-brand-50/70 px-3 py-2 text-[11px] leading-relaxed text-brand-800 dark:bg-brand-950/30 dark:text-brand-300">
            Gostou deste item? Use <strong>＋ Salvar produto</strong> abaixo para gravá-lo no cadastro
            {ativa ? ` de ${ativa.razaoSocial}` : ''} (SKU {item.codProd}) — se o SKU já existir, ele é atualizado.
          </p>
        </div>
      ) : null}
    </Modal>
  )
}

/**
 * Faixa de confronto XML × sistema no topo do detalhe do item — é aqui que
 * a diferença entre a tributação da nota e a da legislação fica explícita.
 */
function FaixaDivergencia({ item }: { item: ResultadoItemNfe }) {
  const d = divergenciaXmlSistema(item)
  if (!d.temXml) {
    return (
      <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500 dark:bg-slate-950/40">
        Sem IBS/CBS destacado neste item — abaixo só a estimativa do sistema.
      </p>
    )
  }
  if (!d.diverge) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-[11px] font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
        <span>✓</span>
        <span>Igual ao XML — enquadramento do emitente confere com o do sistema.</span>
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
      <div className="font-black">⚠ Divergente do XML</div>
      <div className="mt-0.5">
        {d.divergeEnquadramento ? (
          <span>
            Emitente: CST {item.cstIbsCbs || '—'} · {item.cClassTribIbsCbs || '—'} — sistema: CST{' '}
            {item.classificacao.cst} · {item.classificacao.cClassTrib}.{' '}
          </span>
        ) : null}
        {d.divergeValores ? (
          <span>
            Valores: destacado {fmtMoeda((Number(item.vIbsItem) || 0) + (Number(item.vCbsItem) || 0))} ≠
            estimado {fmtMoeda(item.totalTributos)}.
          </span>
        ) : null}
      </div>
    </div>
  )
}
