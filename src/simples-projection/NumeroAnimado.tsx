/**
 * Número animado (contagem crescente) — respeita prefers-reduced-motion.
 * Duração padrão 400ms com easing ease-out.
 */
import { useEffect, useRef, useState } from 'react';
import { useMovimentoReduzido } from '@/ui/motion';

export function useNumeroAnimado(valor: number, duracao = 400): number {
  const reduzir = useMovimentoReduzido();
  const [exibido, setExibido] = useState(valor);
  const anterior = useRef(valor);
  const raf = useRef(0);

  useEffect(() => {
    if (reduzir) {
      setExibido(valor);
      anterior.current = valor;
      return;
    }
    const de = anterior.current;
    const para = valor;
    if (de === para) return;
    const inicio = performance.now();
    const passo = (agora: number) => {
      const t = Math.min(1, (agora - inicio) / duracao);
      const eased = 1 - Math.pow(1 - t, 3);
      setExibido(de + (para - de) * eased);
      if (t < 1) raf.current = requestAnimationFrame(passo);
      else anterior.current = para;
    };
    raf.current = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf.current);
  }, [valor, duracao, reduzir]);

  return exibido;
}

export function NumeroAnimado({
  valor,
  formatar,
  className,
}: {
  valor: number;
  formatar: (v: number) => string;
  className?: string;
}) {
  const animado = useNumeroAnimado(valor);
  return <span className={className}>{formatar(animado)}</span>;
}
