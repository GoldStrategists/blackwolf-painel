import { useFloor, isServerLive } from '../lib/store';
import { useNow } from './useNow';

/** Faixa que nunca deixa dúvida sobre o modo e sobre a saúde da conexão. */
export function ModeBanner() {
  const mode = useFloor((s) => s.mode);
  const ws = useFloor((s) => s.ws);
  const lastMessageAt = useFloor((s) => s.lastMessageAt);
  const now = useNow(1000);
  const live = isServerLive({ ws, lastMessageAt }, now);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30">
      {mode === 'demo' && (
        <div className="demo-stripes h-1.5 w-full" />
      )}
      {mode === 'demo' && (
        <div className="mx-auto w-fit rounded-b-md bg-warn px-4 py-0.5 text-[11px] font-black tracking-widest text-black">MODO DEMONSTRAÇÃO · DADOS FICTÍCIOS</div>
      )}
      {mode === 'live' && <div className="h-1 w-full bg-neg" />}
      {!live && (
        <div className="mx-auto mt-1 w-fit rounded-md bg-neg px-4 py-1 text-xs font-bold text-white">
          {ws === 'open' ? 'Servidor sem enviar dados' : 'Sem conexão com o servidor'} — valores congelados, reconectando…
        </div>
      )}
    </div>
  );
}
