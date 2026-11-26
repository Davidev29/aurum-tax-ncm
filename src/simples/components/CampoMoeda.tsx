/**
 * Simples Nacional — campo de valor monetário com máscara e formatação ao perder o foco.
 */
import { useEffect, useState } from 'react'
import { parseMoeda } from '@/domain/services/format'
import { Texto } from '@/ui/kit'

function CampoMoeda({
  rotulo,
  valor,
  onValor,
  placeholder,
  dica,
}: {
  rotulo: string;
  valor: number;
  onValor: (v: number) => void;
  placeholder?: string;
  dica?: string;
}) {
  const [texto, setTexto] = useState(() => (valor > 0 ? `R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : ''));
  useEffect(() => {
    if (valor === 0) setTexto('');
  }, [valor]);
  return (
    <label className="block min-w-0">
      <span className="field-label field-label--lg">{rotulo}</span>
      <Texto
        mono
        mask="moeda"
        inputMode="decimal"
        className="field num-input h-12 !py-2 text-base"
        placeholder={placeholder ?? 'R$ 0,00'}
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          onValor(parseMoeda(e.target.value));
        }}
        onBlur={() => setTexto((t) => (parseMoeda(t) > 0 ? `R$ ${parseMoeda(t).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : t))}
      />
      {dica ? <span className="mt-1 block text-[13px] leading-snug text-slate-600 dark:text-slate-300" title={dica}>{dica}</span> : null}
    </label>
  );
}

export { CampoMoeda }
