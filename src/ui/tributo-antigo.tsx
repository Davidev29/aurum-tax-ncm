/**
 * Campo de tributo anterior com **autocomplete inline (sem SELECT)**.
 *
 * Padrão "multitexto" (igual à busca unificada da Consulta): digitando o
 * código ou a descrição, a lista sugere `código — descrição`; ao clicar
 * (ou Enter no destacado), o código persiste. Teclado: ↑↓ navega,
 * Enter escolhe, Escape fecha.
 *
 * Abaixo, a caixa de pré-visualização mostra o significado do código
 * persistido. Botão ＋ abre o cadastro rápido da tabela.
 *
 * Usado para CFOP entrada/saída, CST ICMS, PIS e COFINS — só tributação
 * antiga. A Reforma nunca passa por aqui. Produto (NCM) nunca aceita
 * NBS (9 dígitos, serviços): `semNbs` avisa em vermelho e exclui das
 * sugestões (o salvamento também bloqueia).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { TipoAux } from '@/application/aux-meta'
import { AUX_META } from '@/application/aux-meta'
import { filtrarSugestoesAux } from '@/application/aux-sugestao'
import { abrirEdicaoAux } from '@/modais/globais'
import { useOpcoesAux } from '@/ui/opcoes'
import { Texto } from '@/ui/kit'

export function CampoTributoAntigo({
  tipo,
  rotulo,
  valor,
  onChange,
  placeholder = 'Digite o código ou a descrição…',
  dicaTipo = false,
  /** Produto (NCM) nunca aceita NBS (9 dígitos, serviços): avisa em vermelho. */
  semNbs = false,
}: {
  tipo: TipoAux
  rotulo: string
  valor: string
  onChange: (v: string) => void
  placeholder?: string
  /** Mostra selo Entrada/Saída/Outros (só CFOP tem `tipo`). */
  dicaTipo?: boolean
  semNbs?: boolean
}) {
  const opcoes = useOpcoesAux(tipo)
  // Rascunho digitado × valor persistido: o rascunho sugere, o clique persiste.
  const [rascunho, setRascunho] = useState(valor ?? '')
  const [focado, setFocado] = useState(false)
  const [ativo, setAtivo] = useState(-1)
  const valorRef = useRef(valor ?? '')
  valorRef.current = valor ?? ''

  // Carga externa (modo edição): espelha o persistido no campo.
  useEffect(() => {
    setRascunho(valor ?? '')
    setAtivo(-1)
  }, [valor])

  const sugestoes = useMemo(
    () => filtrarSugestoesAux(opcoes as never[], rascunho, 8, { excluirNbs: semNbs }),
    [opcoes, rascunho, semNbs],
  )
  const aberta = focado && rascunho.trim().length >= 1 && sugestoes.length > 0

  // Sem destaque automático: só a navegação por teclado (↑↓) destaca —
  // Enter nunca escolhe sozinho (paridade com a busca da Consulta).
  useEffect(() => {
    setAtivo(-1)
  }, [rascunho])

  const persistir = (codigo: string) => {
    const v = String(codigo ?? '').trim()
    setRascunho(v)
    setFocado(false)
    setAtivo(-1)
    if (v !== String(valorRef.current ?? '').trim()) onChange(v)
  }

  const aoTecla = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && sugestoes.length) {
      e.preventDefault()
      setAtivo((a) => Math.min(a + 1, sugestoes.length - 1))
    } else if (e.key === 'ArrowUp' && sugestoes.length) {
      e.preventDefault()
      setAtivo((a) => (a <= 0 ? -1 : a - 1))
    } else if (e.key === 'Enter') {
      if (ativo >= 0 && sugestoes[ativo]) {
        e.preventDefault()
        persistir(String((sugestoes[ativo] as Record<string, unknown>).codigo ?? ''))
      } else {
        // Sem destaque: confirma o rascunho (código exato ou fora da tabela).
        e.preventDefault()
        persistir(rascunho)
      }
    } else if (e.key === 'Escape') {
      setFocado(false)
      setAtivo(-1)
    }
  }

  const atual = useMemo(
    () => opcoes.find((o) => String(o.codigo ?? '') === String(valor ?? '').trim()) as Record<string, unknown> | undefined,
    [opcoes, valor],
  )
  const descricao = atual ? String((atual as Record<string, unknown>).descricao ?? '') : ''
  const tipoAtual = atual ? String((atual as Record<string, unknown>).tipo ?? '') : ''
  // Produto = CFOP 4 dígitos. NBS (9 dígitos, serviços) nunca entra aqui:
  // avisa em vermelho antes mesmo do salvamento (que também bloqueia).
  const ehNbs = semNbs && String(valor ?? '').replace(/\D/g, '').length === 9

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5">
        <div className="relative min-w-0 flex-1">
          <Texto
            value={rascunho}
            placeholder={placeholder}
            aria-label={rotulo}
            role="combobox"
            aria-expanded={aberta}
            aria-activedescendant={ativo >= 0 ? `sugg-${rotulo}-${ativo}` : undefined}
            autoComplete="off"
            spellCheck={false}
            className="field-sm field-mono"
            onChange={(e) => {
              setRascunho(e.target.value)
              setFocado(true)
            }}
            onFocus={() => setFocado(true)}
            onBlur={() => {
              // Timeout: o clique na sugestão (onMouseDown) vence o blur.
              window.setTimeout(() => {
                setFocado(false)
                setAtivo(-1)
                // Ao sair, o rascunho vira o persistido (cru, mesmo fora da
                // tabela — o validador decide; vazio limpa).
                const atual = String(valorRef.current ?? '').trim()
                const ras = rascunho.trim()
                if (ras !== atual) onChange(ras)
              }, 120)
            }}
            onKeyDown={aoTecla}
          />
          {aberta ? (
            <div role="listbox" aria-label={`Sugestões de ${rotulo}`} className="sugg sugg--glass">
              {sugestoes.map((o, i) => {
                const rec = o as unknown as Record<string, unknown>
                const cod = String(rec.codigo ?? '')
                const desc = String(rec.descricao ?? '')
                const tp = String(rec.tipo ?? '')
                return (
                  <button
                    key={cod || `i-${i}`}
                    id={`sugg-${rotulo}-${i}`}
                    role="option"
                    aria-selected={i === ativo}
                    type="button"
                    className={`sugg-item ${i === ativo ? 'is-active' : ''}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setAtivo(i)}
                    onClick={() => persistir(cod)}
                  >
                    <span className="font-mono text-xs font-black text-brand-700 dark:text-aurum-200">{cod}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-600 dark:text-slate-300">
                      {desc ? ` — ${desc.slice(0, 70)}` : ''}
                      {dicaTipo && tp ? ` (${tp})` : ''}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[color-mix(in_srgb,var(--color-aurum-500)_35%,var(--line))] text-sm font-bold text-brand-700 dark:text-aurum-200"
          title={`Cadastrar novo ${AUX_META[tipo]?.singular ?? rotulo}`}
          onClick={() => abrirEdicaoAux(tipo)}
        >
          ＋
        </button>
      </div>
      <div
        className={`rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug ${
          ehNbs
            ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200'
            : valor
              ? descricao
                ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'
                : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200'
              : 'border-[var(--line)] bg-slate-50 text-slate-500 dark:bg-slate-950/40 dark:text-slate-400'
        }`}
        aria-live="polite"
      >
        {ehNbs ? (
          <span>
            <strong className="font-mono">{String(valor).trim()}</strong> — NBS (9 dígitos) é só para serviços.
            Aqui é só produto: use CFOP de 4 dígitos.
          </span>
        ) : !valor ? (
          <span>Não informado — deixe vazio se não se aplica.</span>
        ) : descricao ? (
          <span>
            <strong className="font-mono">{String(valor).trim()}</strong>
            {tipoAtual && dicaTipo ? <span className="ml-1 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold dark:bg-slate-800">{tipoAtual}</span> : null}
            <span className="block">{descricao}</span>
          </span>
        ) : (
          <span>
            <strong className="font-mono">{String(valor).trim()}</strong> — fora da tabela auxiliar. Será gravado, mas confira o código.
          </span>
        )}
      </div>
    </div>
  )
}
