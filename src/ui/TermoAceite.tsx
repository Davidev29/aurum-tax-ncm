/**
 * Assistente de instalação local — primeira execução do Aurum Tax NCM.
 *
 * Wizard em 5 passos com transições elásticas (framer-motion spring):
 *   0. Apresentação do sistema (o que faz + 100% local)
 *   1. Boas-vindas (o que é + 100% local sem nuvem + o que vou perguntar)
 *   2. Contrato e identificação (nome, CPF/CNPJ, e-mail + checkbox de aceite)
 *   3. Empresa e emitente — CNPJ único com busca automática em 2º plano
 *      (BrasilAPI) + tema; detalhe só aparece no fallback manual/offline
 *   4. Revisão e conclusão (visualiza os dados resolvidos + grava o aceite só na máquina)
 *
 * Nada é enviado à nuvem: o aceite fica em `localStorage`, a empresa/emitente
 * no banco local (SQLite) e o tema no `localStorage`.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Btn, Campo, Check, Selecao, Texto } from './kit'
import {
  CONTRATO_VERSAO,
  gravarAceite,
  validarContratante,
  type Contratante,
} from '@/domain/contrato'
import { TEMA_KEY } from '@/domain/constants'
import { norm } from '@/domain/services/format'
import { useSessao } from '@/store/sessao'
import { toast } from '@/store/ui'
import { EscudoAurum } from './Marca'

const PASSOS = ['Apresentação', 'Boas-vindas', 'Contrato', 'Empresa e emitente', 'Pronto'] as const

const PERFIS = [
  { valor: 'escritorio', rotulo: '🧾 Escritório contábil — cuido de vários clientes' },
  { valor: 'empresa', rotulo: '🏭 Empresa — uso fiscal interno' },
  { valor: 'consultor', rotulo: '👤 Consultor / autônomo' },
  { valor: 'estudo', rotulo: '📚 Estudo / testes da Reforma' },
] as const

type TemaEscolha = 'light' | 'dark'

/** Transição elástica padrão entre steps (spring com overshoot leve). */
const TRANSICAO_ELASTICA = { type: 'spring', stiffness: 320, damping: 26 } as const

function aplicarTemaEscolhido(tema: TemaEscolha): void {
  try {
    document.documentElement.classList.toggle('dark', tema === 'dark')
    localStorage.setItem(TEMA_KEY, tema)
  } catch {
    /* tema volta ao padrão na próxima carga */
  }
}

/* ------------------------- apresentação do sistema ------------------------ */

const FALA_APRESENTACAO =
  'Bem-vindo ao Aurum Tax NCM — classificador fiscal da Reforma Tributária. NCM, IBS/CBS e XML sem mistério, 100% local na sua máquina. Vamos configurar tudo em menos de 1 minuto?'

function ApresentacaoSistema({ reduzir }: { reduzir: boolean }) {
  const fala = useTypewriter(FALA_APRESENTACAO, !reduzir)
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <motion.div
        initial={reduzir ? false : { scale: 0 }}
        animate={{ scale: 1 }}
        transition={reduzir ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 14 }}
        className="relative"
      >
        <motion.div
          animate={reduzir ? undefined : { y: [0, -8, 0] }}
          transition={reduzir ? undefined : { duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        >
          {/* Moldura quadrada proporcional + anel ouro animado (padrão `.borda-cintilante` do sistema). */}
          <div
            style={{ '--cor-borda': '#be9433', '--cor-brilho': '#ead79e' } as CSSProperties}
            className="borda-cintilante grid h-32 w-32 place-items-center rounded-2xl bg-gradient-to-b from-[#1c2a47] to-[#0e1628] shadow-card"
          >
            <EscudoAurum tamanho={76} />
          </div>
        </motion.div>
        {/* sombra elástica */}
        {!reduzir ? (
          <motion.div
            aria-hidden="true"
            className="mx-auto mt-1.5 h-2 w-20 rounded-full bg-slate-300/60 dark:bg-slate-700/60"
            animate={{ scaleX: [1, 0.82, 1] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          />
        ) : null}
      </motion.div>

      <div
        className="relative max-w-md rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-left text-[13px] leading-relaxed shadow-card"
        aria-live="polite"
      >
        <span aria-hidden="true" className="absolute -top-2 left-1/2 h-4 w-4 -translate-x-1/2 rotate-45 border-l border-t border-[var(--line)] bg-[var(--surface-2)]" />
        <strong className="font-black text-brand-700 dark:text-aurum-300">Aurum Tax NCM ✨</strong>
        <p className="mt-1 min-h-[3.5rem]">
          {fala}
          {!reduzir && fala.length < FALA_APRESENTACAO.length ? <span className="animate-pulse">▍</span> : null}
        </p>
      </div>

      <motion.div
        initial={reduzir ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduzir ? { duration: 0 } : { delay: 0.35, ...TRANSICAO_ELASTICA }}
        className="grid w-full grid-cols-1 gap-2 sm:grid-cols-3"
      >
        {[
          ['🔍', 'Classifica NCM/NBS', 'CST + cClassTrib da LC 214/2025'],
          ['🧮', 'Calcula IBS/CBS', 'Simulador e lote com PDF'],
          ['🔒', '100% local', 'Sua base nunca sai da máquina'],
        ].map(([icone, titulo, dica], i) => (
          <motion.div
            key={titulo}
            initial={reduzir ? false : { opacity: 0, scale: 0.9, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={reduzir ? { duration: 0 } : { delay: 0.45 + i * 0.12, ...TRANSICAO_ELASTICA }}
            className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 text-left"
          >
            <div className="text-lg">{icone}</div>
            <div className="text-xs font-black">{titulo}</div>
            <div className="text-[11px] text-slate-500">{dica}</div>
          </motion.div>
        ))}
      </motion.div>
    </div>
  )
}

/** Efeito máquina de escrever para a fala de apresentação. */
function useTypewriter(texto: string, ativo: boolean, velocidade = 22): string {
  const [n, setN] = useState(ativo ? 0 : texto.length)
  useEffect(() => {
    if (!ativo) {
      setN(texto.length)
      return
    }
    setN(0)
    const t = window.setInterval(() => {
      setN((v) => {
        if (v >= texto.length) {
          window.clearInterval(t)
          return v
        }
        return v + 1
      })
    }, velocidade)
    return () => window.clearInterval(t)
  }, [texto, ativo, velocidade])
  return texto.slice(0, n)
}

/* ------------------------------ assistente -------------------------------- */

export function AssistenteInstalacao({ onConcluido }: { onConcluido: () => void }) {
  const reduzir = useReducedMotion() ?? false
  const [passo, setPasso] = useState(0)
  const [dir, setDir] = useState(1)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  // Passo 2 — quem contrata (prova da contratação, gravada só localmente).
  const [contratante, setContratante] = useState<Contratante>({ nome: '', documento: '', email: '' })
  const [aceitou, setAceitou] = useState(false)

  // Passo 3 — perfil + CNPJ único (empresa + emitente) com busca automática em 2º plano.
  const [perfil, setPerfil] = useState<string>('escritorio')
  const [empresaCnpj, setEmpresaCnpj] = useState('')
  const [empresaRazao, setEmpresaRazao] = useState('')
  const [empresaBuscando, setEmpresaBuscando] = useState(false)
  const [empresaManual, setEmpresaManual] = useState(false)
  const [empresaOk, setEmpresaOk] = useState<string | null>(null)

  // Detalhe do emitente/timbrado — preenchido pela mesma busca; visível só no
  // fallback manual ou na revisão final (passo 4).
  const [emitenteCnpj, setEmitenteCnpj] = useState('')
  const [emitenteRazao, setEmitenteRazao] = useState('')
  const [emitenteEndereco, setEmitenteEndereco] = useState('')
  const [emitenteCidade, setEmitenteCidade] = useState('')
  const [emitenteCep, setEmitenteCep] = useState('')
  const [emitenteTelefone, setEmitenteTelefone] = useState('')
  const [emitenteEmail, setEmitenteEmail] = useState('')
  const [emitenteManual, setEmitenteManual] = useState(false)
  const [emitenteOk, setEmitenteOk] = useState<string | null>(null)
  const [tema, setTema] = useState<TemaEscolha>(() =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light',
  )
  // Último CNPJ já resolvido em 2º plano — evita refetch a cada tecla.
  const ultimoBuscadoRef = useRef('')

  const irPara = (novo: number) => {
    setDir(novo > passo ? 1 : -1)
    setErro(null)
    setPasso(Math.max(0, Math.min(PASSOS.length - 1, novo)))
  }

  const campoContratante = <K extends keyof Contratante>(nome: K, valor: Contratante[K]) =>
    setContratante((c) => ({ ...c, [nome]: valor }))

  const avancarDoContrato = (): void => {
    const invalido = validarContratante(contratante)
    if (invalido) {
      setErro(invalido)
      return
    }
    if (!aceitou) {
      setErro('Marque a caixa “Li e Aceito” para prosseguir com a instalação.')
      return
    }
    // Pré-preenche empresa/emitente com os dados do contratante.
    if (!empresaRazao && contratante.nome.trim()) setEmpresaRazao(contratante.nome.trim())
    const doc = norm(contratante.documento)
    if (doc.length === 14) {
      if (!empresaCnpj) setEmpresaCnpj(contratante.documento.trim())
      if (!emitenteCnpj) setEmitenteCnpj(contratante.documento.trim())
    }
    if (!emitenteRazao && contratante.nome.trim()) setEmitenteRazao(contratante.nome.trim())
    irPara(3)
  }

  /** CNPJ único → resolve empresa + emitente na BrasilAPI; falha libera o manual. */
  const buscarCnpjUnificado = async (modo: 'auto' | 'manual' = 'manual'): Promise<void> => {
    const digitos = norm(empresaCnpj)
    if (digitos.length !== 14) {
      if (modo === 'manual') {
        setErro('Digite um CNPJ com 14 dígitos — buscamos tudo em 2º plano, ou cadastre manualmente.')
      }
      return
    }
    if (ultimoBuscadoRef.current === digitos) return
    setEmpresaBuscando(true)
    if (modo === 'manual') setErro(null)
    try {
      const { buscarCnpj } = await import('@/infrastructure/receita/brasilapi')
      const d = await buscarCnpj(empresaCnpj)
      ultimoBuscadoRef.current = digitos
      const razao = d.razaoSocial || empresaRazao
      setEmpresaRazao(razao)
      setEmpresaOk(d.razaoSocial || null)
      setEmpresaManual(false)
      // O mesmo retorno alimenta o emitente/timbrado (sem 2ª etapa).
      setEmitenteCnpj((v) => v || empresaCnpj)
      if (d.razaoSocial) setEmitenteRazao(d.razaoSocial)
      else if (!emitenteRazao && razao) setEmitenteRazao(razao)
      if (d.endereco) setEmitenteEndereco(d.endereco)
      setEmitenteCidade(d.cidade && d.uf ? `${d.cidade}/${d.uf}` : d.cidade || emitenteCidade)
      if (d.cep) setEmitenteCep(d.cep)
      if (d.telefone) setEmitenteTelefone(d.telefone)
      if (d.email) setEmitenteEmail(d.email)
      setEmitenteOk(d.razaoSocial || null)
      setEmitenteManual(false)
      if (modo === 'manual') toast('Dados puxados da BrasilAPI.', 'ok')
    } catch (e) {
      // Falha de rede/limite/404 → libera preenchimento manual, sem travar.
      ultimoBuscadoRef.current = ''
      setEmpresaManual(true)
      setEmitenteManual(true)
      setEmpresaOk(null)
      setEmitenteOk(null)
      if (modo === 'manual') {
        const msg = e instanceof Error ? e.message : String(e)
        setErro(`${msg} — preencha manualmente abaixo.`)
      }
    } finally {
      setEmpresaBuscando(false)
    }
  }

  // Busca automática em 2º plano: completou 14 dígitos → resolve sozinho.
  useEffect(() => {
    if (norm(empresaCnpj).length !== 14) return
    if (ultimoBuscadoRef.current === norm(empresaCnpj)) return
    const t = window.setTimeout(() => void buscarCnpjUnificado('auto'), 600)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaCnpj])

  /** Mantém o CNPJ único sincronizado nos dois cadastros (empresa + emitente). */
  const trocarCnpjUnificado = (valor: string): void => {
    setEmpresaCnpj(valor)
    setEmitenteCnpj(valor)
    setEmpresaOk(null)
    setEmitenteOk(null)
  }

  /** Compat: botões legados chamavam as buscas separadas — agora unificadas. */
  const buscarEmpresa = async (): Promise<void> => buscarCnpjUnificado('manual')

  const concluir = async (): Promise<void> => {
    setSalvando(true)
    setErro(null)
    try {
      gravarAceite(
        {
          nome: contratante.nome.trim(),
          documento: contratante.documento.trim(),
          email: contratante.email.trim(),
        },
        perfil,
      )
      aplicarTemaEscolhido(tema)
      // Primeira empresa (opcional — falha não bloqueia).
      const cnpjEmp = norm(empresaCnpj)
      const razaoEmp = empresaRazao.trim()
      if (cnpjEmp.length === 14) {
        try {
          const ok = await useSessao.getState().criarPorCnpj(empresaCnpj)
          if (!ok && razaoEmp) await useSessao.getState().criar({ razaoSocial: razaoEmp, cnpj: empresaCnpj.trim() })
        } catch (e) {
          if (razaoEmp) {
            try {
              await useSessao.getState().criar({ razaoSocial: razaoEmp, cnpj: empresaCnpj.trim() })
            } catch {
              toast(e instanceof Error ? e.message : 'Não foi possível criar a empresa agora.', 'warn')
            }
          } else {
            toast(e instanceof Error ? e.message : 'Não foi possível criar a empresa agora.', 'warn')
          }
        }
      } else if (razaoEmp) {
        try {
          await useSessao.getState().criar({ razaoSocial: razaoEmp, cnpj: empresaCnpj.trim() })
        } catch (e) {
          toast(e instanceof Error ? e.message : 'Não foi possível criar a empresa agora.', 'warn')
        }
      }
      // Emitente do timbrado (opcional, com dados da BrasilAPI quando houver).
      const emit = (emitenteOk ?? emitenteRazao).trim() || emitenteRazao.trim()
      if (emit) {
        try {
          await useSessao.getState().persistirEmitente({
            razaoSocial: emit,
            cnpj: emitenteCnpj.trim(),
            endereco: emitenteEndereco.trim(),
            cidade: emitenteCidade.trim(),
            cep: emitenteCep.trim(),
            telefone: emitenteTelefone.trim(),
            email: emitenteEmail.trim(),
          })
        } catch {
          /* segue sem emitente — configurável depois em ⚙ */
        }
      } else if (emitenteRazao.trim()) {
        try {
          await useSessao.getState().persistirEmitente({ razaoSocial: emitenteRazao.trim() })
        } catch {
          /* segue sem emitente */
        }
      }
      toast('Instalação concluída. Bom trabalho!', 'ok')
      onConcluido()
    } finally {
      setSalvando(false)
    }
  }

  const podeVoltar = passo > 0 && !salvando
  const ultimo = PASSOS.length - 1
  // Ref para foco acessível a cada troca elástica de step.
  const tituloRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    tituloRef.current?.focus?.()
  }, [passo])

  const avancar = () => {
    if (passo === 0 || passo === 1) irPara(passo + 1)
    else if (passo === 2) avancarDoContrato()
    else irPara(passo + 1)
  }

  // Portal no `document.body`: o assistente monta como filho do `Layout`
  // (dentro de `Pagina`, que usa transform) — sem portal o `fixed` teria o
  // container animado como referência e abriria fora da tela. Mesmo motivo
  // do `Modal` em `kit.tsx`.
  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-slate-900/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Assistente de instalação do Aurum Tax NCM"
    >
      <div className="glass-box modal-box my-6 w-full max-w-2xl" role="document">
        <div className="glass-header border-b border-[var(--line)] px-5 py-4">
          <h2 className="text-base font-black">🧭 Instalação — Aurum Tax NCM</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Passo {passo + 1} de {PASSOS.length}: {PASSOS[passo]} · Contrato v{CONTRATO_VERSAO}
          </p>
          <div
            className="mt-2 flex gap-1.5"
            role="progressbar"
            aria-valuenow={passo + 1}
            aria-valuemin={1}
            aria-valuemax={PASSOS.length}
          >
            {PASSOS.map((p, i) => (
              <button
                key={p}
                type="button"
                title={p}
                aria-label={`Ir para ${p}`}
                disabled={i > passo || salvando}
                onClick={() => {
                  if (i <= passo) irPara(i)
                }}
                className={`h-1.5 flex-1 rounded-full transition ${
                  i <= passo ? 'bg-brand-600 dark:bg-aurum-400' : 'bg-slate-200 dark:bg-slate-700'
                } ${i <= passo ? 'cursor-pointer hover:brightness-110' : ''}`}
              />
            ))}
          </div>
        </div>

        <div ref={tituloRef} tabIndex={-1} className="outline-none">
          <AnimatePresence mode="wait" custom={dir} initial={false}>
            <motion.div
              key={passo}
              custom={dir}
              initial={reduzir ? { opacity: 0 } : { opacity: 0, x: 72 * dir, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={reduzir ? { opacity: 0 } : { opacity: 0, x: -72 * dir, scale: 0.96 }}
              transition={reduzir ? { duration: 0.15 } : TRANSICAO_ELASTICA}
              className="modal-scroll scroll-elegante min-h-[16rem] px-5 py-4 text-xs leading-relaxed"
            >
              {passo === 0 ? <ApresentacaoSistema reduzir={reduzir} /> : null}

              {passo === 1 ? (
                <div className="space-y-3">
                  <p className="text-sm font-bold">
                    Bem-vindo! Vamos deixar tudo pronto em menos de 1 minuto. 👋
                  </p>
                  <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                    <strong>🔒 100% local, sem nuvem.</strong> Empresas, produtos, XMLs e
                    classificações ficam <strong>somente neste computador</strong> (banco local + pasta
                    de dados). A Aurum <strong>não recebe nem tem acesso</strong> à sua base. Internet
                    só é usada se você pedir: buscar CNPJ, ler a lei oficial ou baixar atualizações.
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/40">
                    <strong>Vou te perguntar só o essencial:</strong>
                    <ol className="mt-1 list-decimal space-y-1 pl-5 text-slate-600 dark:text-slate-300">
                      <li>Seu nome, CPF/CNPJ e e-mail + aceite do contrato;</li>
                      <li>Seu perfil + CNPJ da empresa/emitente (busca automática) e tema;</li>
                      <li>Revisão dos dados antes de concluir.</li>
                    </ol>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Classificador fiscal da Reforma Tributária: NCM/NBS, CST de IBS/CBS, cClassTrib
                    e XML — base EC 132/2023 · LC 214/2025 · Decreto 12.955/2026 · Res. CGIBS
                    6/2026.
                  </p>
                </div>
              ) : null}

              {passo === 2 ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-3 dark:border-aurum-900 dark:bg-brand-950/30">
                    <strong>📜 Contrato de Licença Desktop v1.1 — Out/2026 (resumo).</strong>
                    <ol className="mt-1 list-decimal space-y-1 pl-5 text-slate-600 dark:text-slate-300">
                      <li>Licença de uso do Aurum Tax NCM v1.1: 10 módulos — Calculadora, Simples Nacional (+ projeção dividida v2), Consulta NCM, Serviços (NBS), Consulta de CNAEs, Lote, XML de NF-e/NFC-e, Produtos, Tabelas auxiliares e Legislação.</li>
                      <li>Roda 100% na sua máquina — sem nuvem, sem telemetria da base. Classificação determinística local (sem IA em nuvem, sem chat dedicado).</li>
                      <li>Motor SPED existe localmente, mas a importação com tela é a de XML de NF-e/NFC-e.</li>
                      <li>Internet só para funções opcionais (BrasilAPI, normas oficiais, CFF, atualizações).</li>
                      <li>Você é responsável por backups, conferência fiscal e segurança da máquina.</li>
                      <li>Ferramenta de apoio — não substitui o julgamento profissional.</li>
                    </ol>
                    <p className="mt-2 text-[11px] text-slate-400">
                      Texto integral no instalador (<code>LICENCA.txt</code>) — ele prevalece sobre este resumo.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Campo label="Seu nome / razão social" obrigatorio className="sm:col-span-2">
                      <Texto
                        value={contratante.nome}
                        onChange={(e) => campoContratante('nome', e.target.value)}
                        placeholder="Ex.: Escritório Modelo LTDA"
                        autoComplete="organization"
                      />
                    </Campo>
                    <Campo label="CPF ou CNPJ" obrigatorio>
                      <Texto
                        mask="cnpj"
                        mono
                        value={contratante.documento}
                        onChange={(e) => campoContratante('documento', e.target.value)}
                        placeholder="00.000.000/0000-00"
                        inputMode="numeric"
                      />
                    </Campo>
                    <Campo label="E-mail" obrigatorio>
                      <Texto
                        value={contratante.email}
                        onChange={(e) => campoContratante('email', e.target.value)}
                        placeholder="voce@escritorio.com.br"
                        inputMode="email"
                        autoComplete="email"
                      />
                    </Campo>
                  </div>
                  <Check
                    label="Li o Contrato de Licença (resumo acima + texto integral em LICENCA.txt) e ACEITO os seus termos."
                    checked={aceitou}
                    onChange={(e) => {
                      setAceitou(e.target.checked)
                      if (e.target.checked) setErro(null)
                    }}
                  />
                </div>
              ) : null}

              {passo === 3 ? (
                <div className="space-y-3">
                  <Campo label="Como você vai usar o Aurum Tax NCM?">
                    <Selecao value={perfil} onChange={(e) => setPerfil(e.target.value)}>
                      {PERFIS.map((p) => (
                        <option key={p.valor} value={p.valor}>
                          {p.rotulo}
                        </option>
                      ))}
                    </Selecao>
                  </Campo>
                  <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-3 dark:border-aurum-900 dark:bg-brand-950/30">
                    <strong>🏷️ Empresa e emitente pelo CNPJ.</strong>
                    <p className="mb-2 mt-1 text-[11px] text-slate-500">
                      Digite o CNPJ — buscamos razão social, endereço e contatos na{' '}
                      <strong>BrasilAPI em 2º plano</strong>, sem outra tela. O detalhe
                      aparece só na revisão final. Sem internet, liberamos o manual.
                    </p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <div className="flex-1">
                        <Texto
                          mask="cnpj"
                          mono
                          value={empresaCnpj}
                          onChange={(e) => trocarCnpjUnificado(e.target.value)}
                          placeholder="CNPJ — 00.000.000/0000-00"
                          inputMode="numeric"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void buscarEmpresa()
                          }}
                        />
                      </div>
                      <Btn variante="primary" carregando={empresaBuscando} onClick={() => void buscarEmpresa()}>
                        {empresaBuscando ? 'Buscando…' : '🔍 Puxar dados'}
                      </Btn>
                    </div>
                    {empresaBuscando ? (
                      <p className="mt-2 rounded-lg bg-brand-50 px-3 py-2 text-[11px] font-semibold text-brand-700 dark:bg-brand-950/40 dark:text-aurum-300">
                        🔄 Buscando na BrasilAPI em 2º plano…
                      </p>
                    ) : empresaOk || emitenteOk ? (
                      <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                        ✓ {empresaOk ?? emitenteOk} — dados resolvidos. Confira na revisão final.
                      </p>
                    ) : null}
                    {(empresaManual || emitenteManual) && (
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <Campo label="Razão social (empresa + timbrado)" className="sm:col-span-2">
                          <Texto
                            value={empresaRazao || emitenteRazao}
                            onChange={(e) => {
                              setEmpresaRazao(e.target.value)
                              setEmitenteRazao(e.target.value)
                            }}
                            placeholder="Ex.: Escritório Modelo LTDA"
                          />
                        </Campo>
                        <Campo label="Endereço" className="sm:col-span-2">
                          <Texto
                            value={emitenteEndereco}
                            onChange={(e) => setEmitenteEndereco(e.target.value)}
                            placeholder="Rua, número, bairro"
                          />
                        </Campo>
                        <Campo label="Cidade/UF">
                          <Texto
                            value={emitenteCidade}
                            onChange={(e) => setEmitenteCidade(e.target.value)}
                            placeholder="Cidade/UF"
                          />
                        </Campo>
                        <Campo label="CEP">
                          <Texto
                            value={emitenteCep}
                            onChange={(e) => setEmitenteCep(e.target.value)}
                            placeholder="00000-000"
                            inputMode="numeric"
                          />
                        </Campo>
                        <Campo label="Telefone">
                          <Texto
                            value={emitenteTelefone}
                            onChange={(e) => setEmitenteTelefone(e.target.value)}
                            placeholder="(00) 00000-0000"
                          />
                        </Campo>
                        <Campo label="E-mail">
                          <Texto
                            value={emitenteEmail}
                            onChange={(e) => setEmitenteEmail(e.target.value)}
                            placeholder="contato@empresa.com.br"
                            inputMode="email"
                          />
                        </Campo>
                      </div>
                    )}
                    {!empresaManual && !emitenteManual && !empresaOk && !emitenteOk && (
                      <button
                        type="button"
                        onClick={() => {
                          setEmpresaManual(true)
                          setEmitenteManual(true)
                        }}
                        className="mt-2 text-[11px] font-semibold text-slate-400 hover:text-brand-600"
                      >
                        ▸ Sem internet? Preencher manualmente
                      </button>
                    )}
                  </div>

                  <div>
                    <span className="field-label">Aparência</span>
                    <div className="mt-1 grid grid-cols-2 gap-2">
                      {(
                        [
                          ['light', '☀️ Claro', 'Fundo branco, ideal para o dia'],
                          ['dark', '🌙 Escuro', 'Fundo escuro, descansa a vista'],
                        ] as Array<[TemaEscolha, string, string]>
                      ).map(([valor, titulo, dica]) => (
                        <button
                          key={valor}
                          type="button"
                          onClick={() => setTema(valor)}
                          aria-pressed={tema === valor}
                          className={`rounded-xl border p-3 text-left transition ${
                            tema === valor
                              ? 'border-brand-500 bg-brand-50/70 dark:border-aurum-500 dark:bg-brand-900/20'
                              : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'
                          }`}
                        >
                          <div className="text-sm font-bold">{titulo}</div>
                          <div className="text-[11px] text-slate-400">{dica}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {passo === 4 ? (
                <div className="space-y-3">
                  <p className="text-sm font-bold">✅ Tudo certo, {contratante.nome.split(' ')[0] || 'vamos lá'}! Confira:</p>
                  <dl className="space-y-1.5 rounded-xl bg-slate-50 p-3 dark:bg-slate-950/40">
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-400">Contratante</dt>
                      <dd className="text-right font-semibold">
                        {contratante.nome} · {contratante.documento}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-400">E-mail</dt>
                      <dd className="font-semibold">{contratante.email}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-400">Perfil</dt>
                      <dd className="font-semibold">
                        {PERFIS.find((p) => p.valor === perfil)?.rotulo ?? perfil}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-400">Empresa / emitente</dt>
                      <dd className="text-right font-semibold">
                        {(empresaOk || emitenteOk || empresaRazao || emitenteRazao || '').trim() || '— (cadastrar depois)'}
                      </dd>
                    </div>
                    {empresaCnpj.trim() ? (
                      <div className="flex justify-between gap-3">
                        <dt className="text-slate-400">CNPJ</dt>
                        <dd className="font-semibold">{empresaCnpj}</dd>
                      </div>
                    ) : null}
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-400">Tema</dt>
                      <dd className="font-semibold">{tema === 'dark' ? '🌙 escuro' : '☀️ claro'}</dd>
                    </div>
                  </dl>
                  {(emitenteRazao || emitenteEndereco || emitenteCidade || emitenteCep || emitenteTelefone || emitenteEmail) ? (
                    <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-3 dark:border-aurum-900 dark:bg-brand-950/30">
                      <div className="flex items-center justify-between gap-2">
                        <strong>🏷️ Dados resolvidos via CNPJ (visualização).</strong>
                        <button
                          type="button"
                          onClick={() => irPara(3)}
                          className="text-[11px] font-semibold text-brand-600 hover:brightness-110 dark:text-aurum-300"
                        >
                          Corrigir →
                        </button>
                      </div>
                      <dl className="mt-2 space-y-1 text-[11px]">
                        {emitenteRazao.trim() ? (
                          <div className="flex justify-between gap-3">
                            <dt className="text-slate-400">Razão social</dt>
                            <dd className="text-right font-semibold">{emitenteRazao}</dd>
                          </div>
                        ) : null}
                        {emitenteEndereco.trim() ? (
                          <div className="flex justify-between gap-3">
                            <dt className="text-slate-400">Endereço</dt>
                            <dd className="text-right font-semibold">{emitenteEndereco}</dd>
                          </div>
                        ) : null}
                        {emitenteCidade.trim() ? (
                          <div className="flex justify-between gap-3">
                            <dt className="text-slate-400">Cidade/UF</dt>
                            <dd className="text-right font-semibold">{emitenteCidade}</dd>
                          </div>
                        ) : null}
                        {emitenteCep.trim() ? (
                          <div className="flex justify-between gap-3">
                            <dt className="text-slate-400">CEP</dt>
                            <dd className="text-right font-semibold">{emitenteCep}</dd>
                          </div>
                        ) : null}
                        {emitenteTelefone.trim() ? (
                          <div className="flex justify-between gap-3">
                            <dt className="text-slate-400">Telefone</dt>
                            <dd className="text-right font-semibold">{emitenteTelefone}</dd>
                          </div>
                        ) : null}
                        {emitenteEmail.trim() ? (
                          <div className="flex justify-between gap-3">
                            <dt className="text-slate-400">E-mail</dt>
                            <dd className="text-right font-semibold">{emitenteEmail}</dd>
                          </div>
                        ) : null}
                      </dl>
                    </div>
                  ) : null}

                  <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                    Ao concluir, gravo o aceite (contrato v{CONTRATO_VERSAO} + data/hora){' '}
                    <strong>só nesta máquina</strong>. Sem nuvem, sem conta, sem telemetria da sua base.
                  </div>
                  <div className="rounded-xl border border-aurum-500/40 bg-gradient-to-br from-aurum-50 to-white p-3 text-brand-800 dark:border-aurum-800 dark:from-brand-950/40 dark:to-slate-900 dark:text-aurum-200">
                    ✨ <strong>Na sequência, um tour guiado menu a menu</strong> mostra o que cada tela faz e como usar — você pode revê-lo quando quiser no botão <strong>✨ Guia</strong> do topo.
                  </div>
                </div>
              ) : null}

              {erro ? (
                <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">
                  {erro}
                </p>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] px-5 py-3">
          <div className="flex items-center gap-2">
            <Btn variante="ghost" onClick={() => (podeVoltar ? irPara(passo - 1) : undefined)}>
              ← Voltar
            </Btn>
            {passo === 3 ? (
              <button
                type="button"
                onClick={() => irPara(passo + 1)}
                className="text-[11px] font-semibold text-slate-400 hover:text-brand-600"
              >
                Pular esta etapa →
              </button>
            ) : null}
          </div>
          {passo < ultimo ? (
            <Btn variante="primary" onClick={avancar}>
              {passo === 0 ? 'Conhecer o sistema →' : passo === 1 ? 'Começar →' : 'Continuar →'}
            </Btn>
          ) : (
            <Btn variante="primary" carregando={salvando} onClick={() => void concluir()}>
              {salvando ? 'Salvando…' : '✓ Concluir instalação'}
            </Btn>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

