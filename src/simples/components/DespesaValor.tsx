/**
 * Simples Nacional — valor mensal da despesa que gera crédito de CBS.
 */
import { useEffect, useState } from 'react'
import { parseMoeda } from '@/domain/services/format'
import { Texto } from '@/ui/kit'

function DespesaValor({
  valor,
  onValor,
}: {
  valor: number;
  onValor: (v: number) => void;
}) {
  const fmt = (v: number) => (v > 0 ? `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '');
  const [texto, setTexto] = useState(() => fmt(valor));
  const [foco, setFoco] = useState(false);
  // Sincroniza quando o valor muda por fora (ex.: limpar) e o campo não está em edição.
  useEffect(() => {
    if (!foco) setTexto(fmt(valor));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor, foco]);
  return (
    <Texto
      mono
      mask="moeda"
      inputMode="decimal"
      aria-label="Valor da despesa em reais por mês"
      title="Valor mensal da despesa em R$ — base para o crédito de CBS"
      className="field field-sm mono w-28 !py-1 text-right !text-[13px]"
      placeholder="R$ 0,00"
      value={texto}
      onChange={(e) => {
        setTexto(e.target.value);
        onValor(parseMoeda(e.target.value));
      }}
      onFocus={() => setFoco(true)}
      onBlur={() => {
        setFoco(false);
        setTexto(fmt(parseMoeda(texto)));
      }}
    />
  );
}

export { DespesaValor }
