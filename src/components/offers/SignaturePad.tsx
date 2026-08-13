import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { cn } from '@/lib/utils';

export interface SignaturePadHandle {
  clear: () => void;
  isEmpty: () => boolean;
  /** PNG con solo il tratto (sfondo trasparente), o null se non è stato disegnato nulla. */
  toDataURL: () => string | null;
}

interface SignaturePadProps {
  disabled?: boolean;
  /** Notifica il genitore al primo tratto disegnato (per abilitare il pulsante di invio). */
  onStrokeEnd?: () => void;
  className?: string;
  /** Serve a legare la <Label> del genitore al canvas, che altrimenti resta anonimo. */
  id?: string;
}

// Canvas di firma senza librerie esterne (vincolo del blocco): pointer events
// per funzionare con dito, penna e mouse con lo stesso codice, e gestione
// esplicita del devicePixelRatio perché altrimenti su schermi retina il
// canvas.width in CSS pixel non coincide con i pixel fisici e il tratto esce
// sfocato e disallineato rispetto al punto tenuto sotto il puntatore.
export const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(
  ({ disabled, onStrokeEnd, className, id }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const hasDrawnRef = useRef(false);
    const drawingRef = useRef(false);
    const lastPointRef = useRef<{ x: number; y: number } | null>(null);

    const setupCanvas = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#0f172a';
    };

    useEffect(() => {
      setupCanvas();
      // Ridimensionare il canvas (rotazione del device, resize finestra) lo
      // svuota sempre: è una proprietà dell'elemento, non un effetto
      // collaterale evitabile. Per questo si rifà il setup solo se non è
      // ancora stato tracciato nulla, altrimenti si perderebbe la firma già
      // disegnata dal cliente.
      const handleResize = () => {
        if (!hasDrawnRef.current) setupCanvas();
      };
      window.addEventListener('resize', handleResize);
      window.addEventListener('orientationchange', handleResize);
      return () => {
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('orientationchange', handleResize);
      };
    }, []);

    const getPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current!.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (disabled) return;
      // setPointerCapture può lanciare (es. se il browser non riconosce il
      // pointer come "attivo" in quel preciso istante): è solo un
      // miglioramento per continuare a tracciare il tratto anche se il dito
      // esce dai bordi del canvas, non deve poter impedire il disegno se
      // fallisce.
      try {
        canvasRef.current?.setPointerCapture(e.pointerId);
      } catch {
        // ignorato di proposito
      }
      drawingRef.current = true;
      lastPointRef.current = getPoint(e);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawingRef.current || disabled) return;
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx || !lastPointRef.current) return;
      const point = getPoint(e);
      ctx.beginPath();
      ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
      lastPointRef.current = point;
      hasDrawnRef.current = true;
    };

    const endStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      lastPointRef.current = null;
      try {
        canvasRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        // ignorato di proposito, stesso motivo di setPointerCapture sopra
      }
      if (hasDrawnRef.current) onStrokeEnd?.();
    };

    useImperativeHandle(ref, () => ({
      clear: () => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
        hasDrawnRef.current = false;
      },
      isEmpty: () => !hasDrawnRef.current,
      toDataURL: () => (hasDrawnRef.current ? canvasRef.current?.toDataURL('image/png') ?? null : null),
    }));

    return (
      <div className={cn('relative', className)}>
        {/* Riga tratteggiata e suggerimento: solo CSS, non toccano il buffer
            del canvas quindi non finiscono nel PNG esportato. */}
        <div className="pointer-events-none absolute inset-x-6 bottom-9 border-b border-dashed border-muted-foreground/40" />
        <span className="pointer-events-none absolute right-3 bottom-2 select-none text-[10px] text-muted-foreground/50">
          Firma qui
        </span>
        <canvas
          ref={canvasRef}
          id={id}
          // Senza etichetta e senza fuoco da tastiera, per chi usa uno screen
          // reader qui non c'è niente: e siccome l'accettazione richiede sempre
          // una firma disegnata, la pagina diventa incompletabile da soli.
          tabIndex={disabled ? -1 : 0}
          aria-label="Area in cui disegnare la firma, obbligatoria per accettare l'offerta"
          aria-disabled={disabled || undefined}
          className={cn(
            'h-[180px] w-full touch-none rounded-md border border-input bg-white',
            disabled ? 'cursor-not-allowed opacity-60' : 'cursor-crosshair'
          )}
          style={{ touchAction: 'none' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onPointerLeave={endStroke}
        />
      </div>
    );
  }
);
SignaturePad.displayName = 'SignaturePad';
