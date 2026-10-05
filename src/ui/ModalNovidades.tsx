/**
 * Modal de novidades — abre sozinho em dois momentos, sem backend:
 *
 * 1. PÓS-ATUALIZAÇÃO (`modo === 'novidades'`): primeiro boot da versão nova,
 *    lista o que mudou a partir de `NOTAS_VERSAO` + bloco opcional
 *    `comentario` (só renderiza "quando for o caso").
 * 2. AVISO DE DOWNLOAD (`modo === 'disponivel'`): o job de background achou
 *    versão nova no GitHub Releases — exibe as notas remotas (texto puro) e
 *    oferece baixar/instalar sem sair da tela atual.
 *
 * Montado em `ModaisGlobais` sob `useUi.modal === 'novidades'`.
 */
import { useEffect, useState } from 'react'
import { baixarAtualizacao, instalarAtualizacao } from '@/application/atualizacao'
import { bridge } from '@/infrastructure/bridge'
import { notasDaVersao } from '@/domain/constants/notas-versao'
import { confirmar } from '@/store/dialogo'
import { useNovidades } from '@/store/novidades'
import { Btn, Modal } from './kit'

export function ModalNovidades({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const modo = useNovidades((s) => s.modo)
  const versaoNotas = useNovidades((s) => s.versaoNotas)
  const versaoNova = useNovidades((s) => s.versaoNova)
  const notasRemotas = useNovidades((s) => s.notasRemotas)
  const marcarVistaEFechar = useNovidades((s) => s.marcarVistaEFechar)
  const adiarAtualizacao = useNovidades((s) => s.adiarAtualizacao)

  const [baixando, setBaixando] = useState<number | null>(null)
  const [pronta, setPronta] = useState(false)

  // Progresso do download enquanto este modal está aberto (ouvinte próprio —
  // o preload empilha ouvintes, sem anular o job de background).
  useEffect(() => {
    if (!aberto || modo !== 'disponivel' || !bridge) return
    return bridge.onAtualizacao((ev) => {
      if (ev.tipo === 'baixando') setBaixando(ev.pct)
      else if (ev.tipo === 'baixada') {
        setBaixando(null)
        setPronta(true)
      } else if (ev.tipo === 'erro') setBaixando(null)
    })
  }, [aberto, modo])

  useEffect(() => {
    if (!aberto) {
      setBaixando(null)
      setPronta(false)
    }
  }, [aberto])

  if (modo === 'disponivel') {
    const baixar = async (): Promise<void> => {
      setBaixando(0)
      const ok = await baixarAtualizacao()
      if (!ok) setBaixando(null)
    }
    const instalar = async (): Promise<void> => {
      const ok = await confirmar(
        'Reiniciar e atualizar?',
        `O programa será fechado para aplicar a versão ${versaoNova ?? ''}.`,
        { icone: '🔄', confirmar: 'Reiniciar e atualizar' },
      )
      if (ok) void instalarAtualizacao()
    }
    return (
      <Modal
        aberto={aberto}
        onFechar={onFechar}
        titulo={`Nova versão disponível${versaoNova ? ` — v${versaoNova}` : ''}`}
        subtitulo="Baixe sem sair daqui; as tabelas tributárias vêm embutidas"
        largura="max-w-lg"
        rodape={
          <>
            <Btn onClick={adiarAtualizacao}>Depois</Btn>
            {pronta ? (
              <Btn variante="primary" onClick={() => void instalar()}>
                Reiniciar e atualizar
              </Btn>
            ) : (
              <Btn variante="primary" carregando={baixando !== null} onClick={() => void baixar()}>
                {baixando !== null ? `Baixando… ${baixando}%` : 'Baixar atualização'}
              </Btn>
            )}
          </>
        }
      >
        {baixando !== null ? (
          <div className="mb-3 h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-indigo-500 to-fuchsia-500 transition-[width] duration-300"
              style={{ width: `${Math.max(2, Math.min(100, baixando))}%` }}
            />
          </div>
        ) : null}
        {notasRemotas ? (
          <p className="max-h-56 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            {notasRemotas}
          </p>
        ) : (
          <p className="text-xs text-slate-500">
            Uma nova versão do programa foi encontrada. Baixe para receber as tabelas
            tributárias atualizadas.
          </p>
        )}
      </Modal>
    )
  }

  // Modo `novidades` (ou fallback sem modo: mostra as notas da versão em tela).
  const notas = versaoNotas ? notasDaVersao(versaoNotas) : null
  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo={`O que mudou${versaoNotas ? ` — v${versaoNotas}` : ''}`}
      subtitulo="Resumo da versão instalada"
      largura="max-w-lg"
      rodape={
        <Btn variante="primary" onClick={marcarVistaEFechar}>
          Entendi
        </Btn>
      }
    >
      {notas ? (
        <div className="space-y-3">
          <ul className="space-y-1.5">
            {notas.novidades.map((n) => (
              <li key={n} className="flex gap-2 text-xs leading-relaxed">
                <span aria-hidden="true" className="mt-0.5 shrink-0 text-emerald-600">
                  ✓
                </span>
                <span>{n}</span>
              </li>
            ))}
          </ul>
          {notas.comentario ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              {notas.comentario}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-slate-500">Sem notas cadastradas para esta versão.</p>
      )}
    </Modal>
  )
}
