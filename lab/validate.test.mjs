#!/usr/bin/env node
// Teste do validador do ciclo de vida:  node lab/validate.test.mjs
// Monta registros sintéticos em um diretório temporário e confere que o
// validador aprova o que tem que aprovar e RECUSA o que tem que recusar.
// Sem dependências: Node 18+.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const LAB = path.dirname(fileURLToPath(import.meta.url));
const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-lab-'));
fs.mkdirSync(path.join(raiz, 'lab', 'strategies', 'alvo'), { recursive: true });
fs.copyFileSync(path.join(LAB, 'validate.mjs'), path.join(raiz, 'lab', 'validate.mjs'));
fs.copyFileSync(path.join(LAB, 'gates.json'), path.join(raiz, 'lab', 'gates.json'));
for (let i = 0; i <= 8; i++) {
  fs.writeFileSync(path.join(raiz, 'lab', 'strategies', 'alvo', `stage-${i}.md`), `evidencia ${i}\n`);
}

const historico = (ate) =>
  Array.from({ length: ate + 1 }, (_, i) => ({
    stage: i,
    date: `2026-0${Math.min(9, 1 + i)}-01`,
    verdict: 'pass',
    evidence: `lab/strategies/alvo/stage-${i}.md`,
  }));

const metricasCompletas = {
  cost_model: 'spread 20 pts + comissao 7/lote + swap', is_trades: 420, is_profit_factor: 1.6,
  reproduction_reference: 'reimplementacao independente em Python', reproduction_delta_pct: 8,
  oos_trades: 180, oos_profit_factor: 1.4, oos_expectancy_r: 0.18, oos_degradation_pct: 22, final_holdout_uses: 1,
  wf_windows: 8, wf_profitable_windows_pct: 75, wf_efficiency_pct: 61,
  stress_slippage_multiple: 3, stress_fee_increase_pct: 50, stress_execution_delay: '1 barra M5',
  stress_param_perturbation_pct: 25, stress_pf_worst_case: 1.18, stress_trade_removal_pct: 10, stress_regimes_tested: 3,
  mc_runs: 20000, mc_dd95_pct: 18.4, mc_risk_of_ruin_pct: 0.3, mc_losing_streak_p95: 9,
  paper_sessions: 70, paper_trades: 140, paper_pf: 1.31, paper_vs_backtest_pf_delta_pct: 12,
  paper_avg_slippage: '0.08 USD', slippage_tolerance: 'ate 0.25 USD por lado', sharpe: 1.15,
  max_drawdown_pct: 14.2, avg_holding_time: '38 min',
  risk_plan: '1% por trade, teto diario 3%', kill_switch: 'pausa por conta no painel', monitoring: 'aba Quem esta vivo',
};

const aprovada = () => ({
  id: 'alvo', name: 'Alvo', market: 'XAUUSD M5', version: '1.0', origin: 'original', owner: 'Luiz',
  hypothesis: 'Reversao a media intradiaria no ouro apos exaustao de sessao.',
  stage: 8, status: 'production', promoted_at: '2026-09-10', configs_tested: 12,
  stage_history: historico(8), metrics: { ...metricasCompletas },
  weaknesses: ['Depende da liquidez da sessao de NY'], rejection: null,
});

const morta = () => ({
  id: 'morta', name: 'Morta', market: 'XAUUSD M15', version: '1.0', origin: 'public', owner: 'Luiz',
  hypothesis: 'Rompimento da faixa asiatica.', stage: 3, status: 'rejected', configs_tested: 8,
  stage_history: historico(2), metrics: { ...metricasCompletas, oos_profit_factor: 0.88 },
  weaknesses: ['Overfit no horario'],
  rejection: {
    date: '2026-08-20', stage_reached: 3, reason: 'PF OOS 0.88 com degradacao de 55%',
    result: '-1.2R em 140 trades fora da amostra', params: 'faixa 00:00-07:00, buffer 15 pts, SL 1.5 ATR',
    weakness: 'O edge so existia no periodo de desenvolvimento',
  },
});

function rodar(strategies, { write = false } = {}) {
  fs.writeFileSync(path.join(raiz, 'lab', 'registry.json'), JSON.stringify({ schema_version: 1, strategies }, null, 2));
  const args = [path.join(raiz, 'lab', 'validate.mjs')];
  if (write) args.push('--write');
  try {
    return { code: 0, out: execFileSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, BW_TODAY: '2026-09-15' } }) };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

let falhas = 0;
function caso(nome, strategies, esperado) {
  rodar(strategies, { write: true });           // docs sempre em dia antes de conferir
  const { code, out } = rodar(strategies);
  const ok = esperado.aprova ? code === 0 : code === 1 && (!esperado.contendo || out.includes(esperado.contendo));
  if (!ok) {
    falhas++;
    console.log(`FALHOU  ${nome}\n        exit=${code} esperado=${esperado.aprova ? 'aprovar' : `recusar "${esperado.contendo}"`}\n${out.split('\n').map((l) => '        ' + l).join('\n')}`);
  } else {
    console.log(`ok      ${nome}`);
  }
}

caso('estrategia completa em producao passa', [aprovada()], { aprova: true });
caso('estrategia rejeitada nao e cobrada pelo gate em que morreu', [morta()], { aprova: true });

caso('pular estagio e recusado', [{ ...aprovada(), stage_history: historico(8).filter((h) => h.stage !== 5) }], { contendo: 'sem pular etapa' });
caso('evidencia inexistente e recusada', [{ ...aprovada(), stage_history: historico(8).map((h) => (h.stage === 4 ? { ...h, evidence: 'lab/strategies/alvo/nao-existe.md' } : h)) }], { contendo: 'evidência não existe em disco' });
caso('metrica ausente barra a promocao', [{ ...aprovada(), metrics: { ...metricasCompletas, mc_dd95_pct: null } }], { contendo: 'falta a evidência "mc_dd95_pct"' });
caso('numero abaixo do gate barra a promocao', [{ ...aprovada(), metrics: { ...metricasCompletas, oos_profit_factor: 1.05 } }], { contendo: 'oos_profit_factor = 1.05 < mínimo 1.25' });
caso('drawdown de monte carlo acima do teto barra', [{ ...aprovada(), metrics: { ...metricasCompletas, mc_dd95_pct: 40 } }], { contendo: 'mc_dd95_pct = 40 > máximo 25' });
caso('muitas configuracoes sem ajuste de teste multiplo barra', [{ ...aprovada(), configs_tested: 400 }], { contendo: 'multiple_testing_adjustment' });
caso('holdout final usado mais de uma vez barra', [{ ...aprovada(), metrics: { ...metricasCompletas, final_holdout_uses: 3 } }], { contendo: 'final_holdout_uses = 3' });
caso('data fora de ordem no historico e recusada', [{ ...aprovada(), stage_history: historico(8).map((h) => (h.stage === 6 ? { ...h, date: '2026-01-01' } : h)) }], { contendo: 'anterior à' });
caso('rejeitada sem causa da morte e recusada', [{ ...morta(), rejection: { ...morta().rejection, weakness: '' } }], { contendo: 'rejection.weakness é obrigatório' });
caso('legado nao entra no hall of fame', [{
  id: 'legado', name: 'Legado', market: 'XAUUSD M5', version: '3.0', origin: 'original',
  hypothesis: 'nao documentada', stage: 8, status: 'legacy', configs_tested: null, stage_history: [], metrics: {},
  weaknesses: ['sem dossie'],
  grandfathered: { reason: 'vendido antes do laboratorio', missing_stages: [0, 1, 2, 3, 4, 5, 6, 7], audit_deadline: '2026-12-31' },
}], { aprova: true });
{
  const hall = fs.readFileSync(path.join(raiz, 'HALL_OF_FAME.md'), 'utf8');
  if (hall.includes('Legado')) { falhas++; console.log('FALHOU  legado aparece no HALL_OF_FAME.md e nao deveria'); }
  else console.log('ok      legado ausente do HALL_OF_FAME.md gerado');
}
caso('prazo de auditoria vencido vira erro', [{
  id: 'legado', name: 'Legado', market: 'XAUUSD M5', version: '3.0', origin: 'original',
  hypothesis: 'nao documentada', stage: 8, status: 'legacy', stage_history: [], metrics: {},
  weaknesses: ['sem dossie'],
  grandfathered: { reason: 'vendido antes do laboratorio', missing_stages: [1], audit_deadline: '2026-01-31' },
}], { contendo: 'PRAZO DE AUDITORIA VENCIDO' });
caso('ressurreicao sem nova hipotese e recusada', [morta(), {
  ...aprovada(), id: 'morta-v2', stage: 0, status: 'in_lab', promoted_at: null, stage_history: historico(0),
  reopened_from: { graveyard_id: 'morta', new_hypothesis: 'mudei o parametro', date: '2026-09-01' },
}], { contendo: 'nova hipótese econômica' });
caso('ressurreicao com nova hipotese economica passa', [morta(), {
  ...aprovada(), id: 'morta-v2', stage: 0, status: 'in_lab', promoted_at: null, stage_history: historico(0),
  reopened_from: {
    graveyard_id: 'morta',
    new_hypothesis: 'O fluxo da faixa asiatica mudou de estrutura com a migracao de liquidez de ouro para o book asiatico apos 2026; a hipotese agora e de continuidade, nao de rompimento.',
    date: '2026-09-01',
  },
}], { aprova: true });

// documentos gerados fora de sincronia com o registro
rodar([aprovada()], { write: true });
fs.writeFileSync(path.join(raiz, 'HALL_OF_FAME.md'), '# editado a mao\n');
const drift = rodar([aprovada()]);
if (drift.code === 1 && drift.out.includes('desatualizado')) console.log('ok      hall of fame editado a mao e detectado');
else { falhas++; console.log(`FALHOU  hall of fame editado a mao e detectado\n${drift.out}`); }

fs.rmSync(raiz, { recursive: true, force: true });
console.log(falhas ? `\n${falhas} teste(s) falharam\n` : '\ntodos os testes passaram\n');
process.exit(falhas ? 1 : 0);
