import { useEffect, useState } from 'react';
import { PLAN_TEMPLATES, type AccountView, type RiskRule, type RiskRuleType } from '@bw/shared';
import { api } from '../lib/api';
import { useFloor } from '../lib/store';

const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));

/** Formulário de configuração da conta: nome, sala, tamanho e regras de risco (por conta). */
export function AccountEditor({ a }: { a: AccountView }) {
  const mode = useFloor((s) => s.mode);
  const rooms = useFloor((s) => s.rooms);
  const [rule, setRule] = useState<RiskRule | null>(null);
  const [form, setForm] = useState({
    displayName: a.displayName,
    roomId: a.roomId,
    firm: a.firm ?? '',
    plan: a.plan ?? '',
    nominalSize: a.nominalSize?.toString() ?? '',
    startingBalance: a.startingBalance?.toString() ?? '',
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [templateWarning, setTemplateWarning] = useState<string | null>(null);

  // Carrega a regra atual sob demanda (a view tem só o resumo).
  useEffect(() => {
    let alive = true;
    void api<{ id: string; rule: RiskRule }[]>(`/api/${mode}/accounts`).then((list) => {
      const r = list.find((x) => x.id === a.id)?.rule;
      if (r && alive) setRule(r);
    });
    return () => {
      alive = false;
    };
  }, [mode, a.id]);
  if (rule === null) return <p className="text-xs text-wolf-500">Carregando…</p>;

  const setR = (patch: Partial<RiskRule>) => setRule({ ...rule, ...patch });

  const applyTemplate = (id: string) => {
    const t = PLAN_TEMPLATES.find((p) => p.id === id);
    if (!t) return;
    setRule({ ...rule, ...t.rule });
    setForm((f) => ({ ...f, nominalSize: String(t.nominalSize), startingBalance: f.startingBalance || String(t.nominalSize), plan: t.id === 'custom' ? f.plan : t.label }));
    setTemplateWarning(t.warning);
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/${mode}/accounts/${encodeURIComponent(a.id)}`, {
        method: 'PATCH',
        body: {
          displayName: form.displayName.trim() || a.name,
          roomId: form.roomId,
          firm: form.firm.trim() || null,
          plan: form.plan.trim() || null,
          nominalSize: numOrNull(form.nominalSize),
          startingBalance: numOrNull(form.startingBalance),
          rule,
        },
      });
      setMsg({ ok: true, text: 'Salvo.' });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, key: keyof typeof form, props: Record<string, unknown> = {}) => (
    <div>
      <label className="label">{label}</label>
      <input className="input" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} {...props} />
    </div>
  );
  const ruleNum = (label: string, key: 'maxDrawdown' | 'trailStopOffset' | 'dailyLossLimit' | 'manualThreshold', hint?: string) => (
    <div>
      <label className="label" title={hint}>
        {label}
      </label>
      <input className="input font-mono" inputMode="decimal" value={rule[key] ?? ''} onChange={(e) => setR({ [key]: numOrNull(e.target.value) } as Partial<RiskRule>)} placeholder="vazio = não se aplica" />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">{field('Nome da estação', 'displayName', { maxLength: 64 })}</div>
        <div className="col-span-2">
          <label className="label">Sala</label>
          <select className="input" value={form.roomId} onChange={(e) => setForm({ ...form, roomId: e.target.value })}>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        {field('Empresa', 'firm')}
        {field('Plano', 'plan')}
        {field('Tamanho nominal (US$)', 'nominalSize', { inputMode: 'decimal' })}
        {field('Saldo inicial (US$)', 'startingBalance', { inputMode: 'decimal' })}
      </div>

      <section className="rounded-lg border border-wolf-700 p-3">
        <h3 className="kpi-label mb-2">Regras de risco desta conta</h3>
        <label className="label">Preencher com modelo</label>
        <select className="input mb-1" defaultValue="" onChange={(e) => applyTemplate(e.target.value)}>
          <option value="" disabled>
            Escolha um modelo (opcional)…
          </option>
          {PLAN_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        {templateWarning && <p className="mb-2 text-[11px] text-warn">{templateWarning}</p>}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label">Tipo de drawdown</label>
            <select className="input" value={rule.type} onChange={(e) => setR({ type: e.target.value as RiskRuleType })}>
              <option value="none">Sem regra</option>
              <option value="static">Estático (saldo inicial − DD)</option>
              <option value="trailing_intraday">Trailing intraday (segue o pico de equity)</option>
              <option value="trailing_eod">Trailing fim do dia (segue o saldo de fechamento)</option>
            </select>
          </div>
          {ruleNum('Drawdown máximo', 'maxDrawdown')}
          {ruleNum('Trailing para em saldo inicial +', 'trailStopOffset', 'Ex.: 100 → o limite para de subir em saldo inicial + 100')}
          {ruleNum('Perda diária máx.', 'dailyLossLimit')}
          <div>
            <label className="label">Alerta amarelo em</label>
            <select className="input" value={rule.warnAtPct} onChange={(e) => setR({ warnAtPct: Number(e.target.value) })}>
              {[0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9].map((v) => (
                <option key={v} value={v}>
                  {Math.round(v * 100)}% consumido
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">{ruleNum('Limite de liquidação ATUAL (do dashboard da prop firm)', 'manualThreshold', 'Recomendado: copie o valor atual do dashboard da Apex/prop firm. O app nunca o rebaixa; só sobe com o trailing.')}</div>
          {rule.type === 'trailing_eod' && (
            <>
              <div>
                <label className="label">Horário do fechamento</label>
                <input className="input" value={rule.eodTime} onChange={(e) => setR({ eodTime: e.target.value })} placeholder="17:00" />
              </div>
              <div>
                <label className="label">Fuso</label>
                <input className="input" value={rule.eodTimeZone} onChange={(e) => setR({ eodTimeZone: e.target.value })} placeholder="America/New_York" />
              </div>
            </>
          )}
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-wolf-400">
          O NinjaTrader não expõe o limite de trailing da prop firm. Sem o valor informado acima, o app calcula a partir do saldo inicial e do pico que ele mesmo observou — histórico anterior ao app é desconhecido. Alterar tipo, drawdown, saldo inicial ou limite manual reinicia esse acompanhamento.
        </p>
      </section>

      {msg && <p className={`text-xs ${msg.ok ? 'text-pos' : 'text-neg'}`}>{msg.text}</p>}
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-on" onClick={save} disabled={busy}>
          Salvar
        </button>
        <button
          className="btn"
          onClick={async () => {
            if (!window.confirm('Ocultar esta conta da sala? Ela pode ser reexibida em Configurações → Contas.')) return;
            await api(`/api/${mode}/accounts/${encodeURIComponent(a.id)}`, { method: 'PATCH', body: { hidden: true } });
            useFloor.getState().select(null);
          }}
        >
          Ocultar
        </button>
      </div>
    </div>
  );
}
