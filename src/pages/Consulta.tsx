/**
 * Tela **Consulta NCM** (SPEC §5).
 *
 * Busca por NCM com sugestões da nomenclatura vigente e painel com **0/1/N**
 * classificações resolvidas pelo repositório (`resolverClassificacoes`).
 *
 * Regras preservadas da v1:
 * - NCM precisa de exatamente 8 dígitos (`avisoInvalido`);
 * - 0 vínculos → cartão de **tributação integral** (regra geral);
 * - N > 1 → aviso âmbar "possui N classificações possíveis";
 * - "Salvar como produto" abre o modal da página, nunca escreve direto;
 * - "Adicionar à calculadora" abre o **modal de cálculo** (qtd, valor e
 *   prévia) — a pesquisa não é interrompida por uma troca de tela.
 */
import { useEffect, useState } from 'react'
import type { Classificacao } from '@/domain/entities'
import { MASK, norm } from '@/domain/services/format'
import { ModalSalvarClass } from '@/modais/pagina'
import { ModalReclassificacao } from '@/modais/reclassificacao'
import { useBase } from '@/store/base'
import { useConsulta } from '@/store/consulta'
import { toast, useUi } from '@/store/ui'
import { CartaoClassificacao, CartaoTributacaoIntegral } from '@/ui/cartoes'
import { Btn, Painel, Texto, Vazio } from '@/ui/kit'
import { SUGGEST_LIMITS } from '@/domain/constants'

/** Debounce das sugestões (paridade com os 150 ms da v1). */
const DEBOUNCE_SUGESTAO = 150

export function Consulta() {
  const codigo = useConsulta((s) => s.codigo)
  const setCodigo = useConsulta((s) => s.setCodigo)
  const consultar = useConsulta((s) => s.consultar)
  const limpar = useConsulta((s) => s.limpar)
  const buscarSugestoes = useConsulta((s) => s.buscarSugestoes)
  const sugestoes = useConsulta((s) => s.sugestoes)
  const resultados = useConsulta((s) => s.resultados)
  const nomenclatura = useConsulta((s) => s.nomenclatura)
  const regraGeral = useConsulta((s) => s.regraGeral)
  const avisoInvalido = useConsulta((s) => s.avisoInvalido)
  const carregando = useConsulta((s) => s.carregando)

  const abrirCalc = useUi((s) => s.abrirCalc)
  const nomenclaturaBase = useBase((s) => s.status?.nomenclatura ?? 0)

  const [paraSalvar, setParaSalvar] = useState<Classificacao | null>(null)
  const [reclassificando, setReclassificando] = useState(false)

  // Sugestões com debounce (paridade com o `input` listener da v1).
  useEffect(() => {
    const t = window.setTimeout(() => void buscarSugestoes(codigo), DEBOUNCE_SUGESTAO)
    return () => window.clearTimeout(t)
  }, [codigo, buscarSugestoes])

  const submeter = () => void consultar()
  const aoEscolher = (c: string) => {
    setCodigo(MASK.ncm(c))
    void consultar(c)
  }

  const vazio = avisoInvalido && !resultados.length

  return (
    <div className="mx-auto max-w-5xl">
      <Painel>
        <div className="p-5">
          <h2 className="flex items-center gap-2 text-base font-bold">
            <span className="text-lg">🔍</span> Consulta por NCM
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Aceita 8 dígitos com ou sem pontuação. Sugestões aparecem automaticamente conforme você
            digita.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <div className="field-wrap min-w-[220px] flex-1">
              <span className="field-icon">🔢</span>
              <Texto
                mask="ncm"
                mono
                grande
                autoComplete="off"
                inputMode="numeric"
                placeholder="0201.10.00"
                value={codigo}
                erro={avisoInvalido}
                onChange={(e) => setCodigo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submeter()
                }}
              />
            </div>
            <Btn variante="primary" onClick={submeter}>
              Classificar
            </Btn>
            <Btn
              onClick={() => {
                limpar()
                toast('Consulta limpa.', 'warn')
              }}
            >
              Limpar
            </Btn>
          </div>

          <ListaSugestaoNcm
            sugestoes={sugestoes}
            texto={codigo}
            baseVazia={nomenclaturaBase === 0}
            onEscolher={aoEscolher}
          />
        </div>
      </Painel>

      <div className="mt-6 space-y-4">
        {carregando ? (
          <Painel className="p-8 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
            <div className="mt-3 text-sm text-slate-500">Classificando…</div>
          </Painel>
        ) : vazio ? (
          <Painel className="p-8 text-center">
            <div className="text-3xl">⌨️</div>
            <div className="mt-2 text-sm font-semibold">Informe um NCM de 8 dígitos.</div>
          </Painel>
        ) : resultados.length ? (
          <>
            {nomenclatura ? (
              <div className="rounded-2xl border border-brand-200 bg-gradient-to-r from-brand-50 to-white p-4 dark:border-aurum-900 dark:from-brand-950/40 dark:to-slate-900">
                <div className="text-[10px] font-bold uppercase tracking-wide text-brand-600 dark:text-aurum-200">
                  NCM {nomenclatura.codigoOriginal}
                </div>
                <div className="mt-1 text-sm font-semibold text-brand-900 dark:text-brand-100">
                  {nomenclatura.descricao}
                </div>
                {nomenclatura.ato ? (
                  <div className="mt-1 text-[10px] text-brand-700 dark:text-brand-300">
                    📎 {nomenclatura.ato}
                  </div>
                ) : null}
              </div>
            ) : null}

            {!regraGeral && resultados.length > 1 ? (
              <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                <strong>⚡ Este NCM possui {resultados.length} classificações possíveis.</strong>{' '}
                Compare as opções abaixo.
              </div>
            ) : null}

            <div className="space-y-4">
              {regraGeral ? (
                <CartaoTributacaoIntegral
                  cl={resultados[0].classificacao}
                  nomenclatura={nomenclatura}
                  onSalvar={() => setParaSalvar(resultados[0].classificacao)}
                  onAddCalc={() => abrirCalc({ tipo: 'classificacao', classificacao: resultados[0].classificacao })}
                  onReclassificar={() => setReclassificando(true)}
                />
              ) : (
                resultados.map((r, i) => (
                  <CartaoClassificacao
                    key={r.__uid}
                    cl={r.classificacao}
                    indice={i}
                    total={resultados.length}
                    onSalvar={() => setParaSalvar(r.classificacao)}
                    onAddCalc={() => abrirCalc({ tipo: 'classificacao', classificacao: r.classificacao })}
                  />
                ))
              )}
            </div>
          </>
        ) : (
          <Vazio
            icone="🔍"
            titulo="Digite um NCM para classificar"
            texto="A base oficial da Reforma (LC 214/2025) retorna 0, 1 ou várias classificações tributárias para cada NCM."
          />
        )}
      </div>

      <ModalSalvarClass
        aberto={paraSalvar !== null}
        classificacao={paraSalvar}
        onFechar={() => setParaSalvar(null)}
      />
      {reclassificando && norm(codigo).length === 8 ? (
        <ModalReclassificacao
          aberto={reclassificando}
          ncm={codigo}
          nomenclatura={nomenclatura}
          onFechar={() => setReclassificando(false)}
          onSalvo={() => void consultar()}
        />
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------- sugestões -- */

function ListaSugestaoNcm({
  sugestoes,
  texto,
  baseVazia,
  onEscolher,
}: {
  sugestoes: { codigo: string; codigoOriginal: string; descricao: string }[]
  texto: string
  baseVazia: boolean
  onEscolher: (codigo: string) => void
}) {
  const digitos = norm(texto)

  if (digitos.length < 2) {
    return (
      <div className="mt-3 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/40">
        {baseVazia ? (
          <>
            Importe a <strong>nomenclatura NCM</strong> (Configurações ⚙) ou cadastre em{' '}
            <strong>Tabelas auxiliares</strong>.
          </>
        ) : (
          'Digite pelo menos 2 dígitos para ver as sugestões…'
        )}
      </div>
    )
  }

  const visiveis = sugestoes.slice(0, SUGGEST_LIMITS.consulta)
  const restantes = sugestoes.length - visiveis.length

  return (
    <div className="mt-3 max-h-72 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/60 p-2 dark:border-slate-800 dark:bg-slate-950/40">
      {sugestoes.length ? (
        <>
          {visiveis.map((n) => (
            <button
              key={n.codigo}
              type="button"
              className="flex w-full cursor-pointer items-start gap-2 rounded-lg px-3 py-1.5 text-left text-xs transition hover:bg-brand-50 dark:hover:bg-brand-900/30"
              onClick={() => onEscolher(n.codigo)}
            >
              <span className="whitespace-nowrap font-mono font-bold text-brand-700 dark:text-aurum-200">
                {n.codigoOriginal}
              </span>
              <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">
                {n.descricao}
              </span>
            </button>
          ))}
          {restantes > 0 ? (
            <div className="px-3 py-1 text-[10px] text-slate-400">
              + {restantes} sugestões…
            </div>
          ) : null}
        </>
      ) : (
        <div className="px-3 py-2 text-xs text-slate-500">
          Nenhuma sugestão para &quot;{digitos}&quot;.
        </div>
      )}
    </div>
  )
}
