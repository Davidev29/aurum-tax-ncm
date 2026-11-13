/**
 * Modais **pertencentes a uma página** (page-owned).
 *
 * Ficam fora do host global (`useUi.modal`) de propósito: assim podem ser
 * empilhados sobre um modal global (ex.: cadastro rápido de CFOP aberto a
 * partir daqui) sem que um fechamento feche o outro.
 *
 * Hoje: apenas o `ModalSalvarClass` ("Salvar como produto" a partir de uma
 * classificação). A Calculadora e seu modal "Adicionar à calculadora" foram
 * removidos na v1.2.
 */
import { useEffect, useState } from 'react'
import type { Classificacao } from '@/domain/entities'
import {
  fmtNbs,
  fmtNcm,
  fmtPct,
  norm,
  parseMoeda,
  parseQtd,
} from '@/domain/services/format'
import { salvarProduto, type EntradaProduto } from '@/application/produtos'
import { useProdutos } from '@/store/produtos'
import { useSessao } from '@/store/sessao'
import { confirmar as confirmarDialogo } from '@/store/dialogo'
import { toast } from '@/store/ui'
import type { PrefillSalvar } from '@/store/consulta'
import { Btn, Campo, Modal, Pill, Texto, TituloSecao } from '@/ui/kit'
import { SelectAux } from '@/ui/opcoes'

/** Formatação do código conforme o tipo (NCM 8 dígitos × NBS 9 dígitos). */
function fmtCodigo(codigo: unknown): string {
  return norm(codigo).length === 9 ? fmtNbs(codigo) : fmtNcm(codigo)
}

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
            {cl.codigoFormatado || fmtCodigo(cl.codigo)}
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
