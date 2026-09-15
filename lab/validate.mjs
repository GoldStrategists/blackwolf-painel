#!/usr/bin/env node
// Black Wolf — validador do ciclo de vida de estratégias.
//
//   node lab/validate.mjs            valida o registro (sai 1 se houver erro)
//   node lab/validate.mjs --write    regenera HALL_OF_FAME.md e STRATEGY_GRAVEYARD.md
//
// O que ele impede, mecanicamente:
//   - pular estágio;
//   - promover sem evidência arquivada em disco;
//   - promover sem bater o número do gate (lab/gates.json);
//   - colocar no Hall of Fame quem não está em STAGE 7/8 pelo processo;
//   - ressuscitar estratégia do cemitério sem nova hipótese econômica;
//   - deixar HALL_OF_FAME.md / STRATEGY_GRAVEYARD.md desatualizados.
//
// Sem dependências: Node 18+.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = path.join(ROOT, 'lab', 'registry.json');
const GATES = path.join(ROOT, 'lab', 'gates.json');
const HALL = path.join(ROOT, 'HALL_OF_FAME.md');
const GRAVE = path.join(ROOT, 'STRATEGY_GRAVEYARD.md');

// BW_TODAY existe para teste determinístico; no uso normal é a data de hoje.
const TODAY = process.env.BW_TODAY || new Date().toISOString().slice(0, 10);

const STATUSES = ['in_lab', 'paper', 'production', 'legacy', 'rejected', 'paused'];
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const errors = [];
const warnings = [];
const debts = [];
const err = (id, msg) => errors.push(`${id}: ${msg}`);
const warn = (id, msg) => warnings.push(`${id}: ${msg}`);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`ERRO: não consegui ler ${path.relative(ROOT, file)} — ${e.message}`);
    process.exit(2);
  }
}

const registry = readJson(REGISTRY);
const gates = readJson(GATES);
const strategies = Array.isArray(registry.strategies) ? registry.strategies : [];

// ---------------------------------------------------------------- validação

const byId = new Map();
for (const s of strategies) {
  if (!s || typeof s !== 'object') { errors.push('registry: entrada inválida (não é objeto)'); continue; }
  if (!ID_RE.test(String(s.id || ''))) { err(s.id || '(sem id)', 'id ausente ou fora do padrão kebab-case'); continue; }
  if (byId.has(s.id)) err(s.id, 'id duplicado no registro');
  byId.set(s.id, s);
}

for (const s of byId.values()) validateStrategy(s);

function validateStrategy(s) {
  const id = s.id;

  for (const f of ['name', 'market', 'version', 'origin', 'hypothesis', 'status']) {
    if (!s[f] || String(s[f]).trim() === '') err(id, `campo obrigatório vazio: ${f}`);
  }
  if (!['public', 'original'].includes(s.origin)) err(id, `origin deve ser "public" ou "original" (está: ${s.origin})`);
  if (!STATUSES.includes(s.status)) err(id, `status inválido: ${s.status} (use ${STATUSES.join(', ')})`);
  if (!Number.isInteger(s.stage) || s.stage < 0 || s.stage > 8) {
    err(id, `stage deve ser inteiro de 0 a 8 (está: ${s.stage})`);
    return;
  }

  const legacy = s.status === 'legacy';
  const rejeitada = s.status === 'rejected';
  const metrics = s.metrics && typeof s.metrics === 'object' ? s.metrics : {};
  // `stage` de uma estratégia viva = último estágio VENCIDO.
  // `stage` de uma estratégia rejeitada = estágio em que ela MORREU (não vencido).
  const vencidos = rejeitada ? s.stage - 1 : s.stage;

  // coerência stage <-> status
  if (s.status === 'paper' && s.stage !== 7) err(id, 'status "paper" exige stage 7');
  if (s.status === 'production' && s.stage !== 8) err(id, 'status "production" exige stage 8');
  if (['in_lab', 'paused'].includes(s.status) && s.stage > 6) {
    err(id, `stage ${s.stage} não combina com status "${s.status}" (7 = paper, 8 = production)`);
  }
  if (s.stage >= 7 && !legacy && s.status !== 'rejected' && !DATE_RE.test(String(s.promoted_at || ''))) {
    err(id, 'stage >= 7 exige promoted_at no formato YYYY-MM-DD');
  }

  // --- legado: entra para ser auditado, nunca para ser aprovado
  if (legacy) {
    const g = s.grandfathered;
    if (!g || !g.reason || !DATE_RE.test(String(g.audit_deadline || ''))) {
      err(id, 'status "legacy" exige grandfathered.reason e grandfathered.audit_deadline (YYYY-MM-DD)');
      return;
    }
    if (!Array.isArray(g.missing_stages) || g.missing_stages.length === 0) {
      err(id, 'status "legacy" exige grandfathered.missing_stages (as etapas sem evidência)');
    }
    const msg = `em produção sem dossiê — etapas sem evidência: [${(g.missing_stages || []).join(', ')}] — prazo de auditoria ${g.audit_deadline}`;
    if (g.audit_deadline < TODAY) err(id, `PRAZO DE AUDITORIA VENCIDO (${g.audit_deadline}). Audite, remova de produção ou renegocie o prazo explicitamente.`);
    debts.push(`${id}: ${msg}`);
    return; // legado não passa pelos gates: ele É a dívida
  }
  if (s.grandfathered) err(id, 'grandfathered só é permitido com status "legacy"');

  // --- reabertura de estratégia rejeitada
  if (s.reopened_from) {
    const r = s.reopened_from;
    const origem = byId.get(r.graveyard_id);
    if (!origem) err(id, `reopened_from.graveyard_id "${r.graveyard_id}" não existe no registro`);
    else if (origem.status !== 'rejected') err(id, `reopened_from aponta para "${r.graveyard_id}", que não está rejeitada`);
    if (r.graveyard_id === id) err(id, 'reabertura tem que usar um id novo — a entrada do cemitério não volta a viver');
    if (!r.new_hypothesis || String(r.new_hypothesis).trim().length < 40) {
      err(id, 'reabertura exige new_hypothesis escrita (nova hipótese econômica ou estrutural, não "mudei o parâmetro")');
    }
    if (!DATE_RE.test(String(r.date || ''))) err(id, 'reopened_from.date ausente ou fora do formato YYYY-MM-DD');
    if (origem && origem.rejection && DATE_RE.test(String(r.date || '')) && r.date < origem.rejection.date) {
      err(id, 'reabertura datada antes da rejeição da original');
    }
    const primeiro = (s.stage_history || [])[0];
    if (!primeiro || primeiro.stage !== 0) err(id, 'estratégia reaberta recomeça em STAGE 0 — sem atalho por já ter sido testada');
  }

  // --- rejeitada: vai para o cemitério com a causa da morte
  if (s.status === 'rejected') {
    const r = s.rejection;
    if (!r || typeof r !== 'object') { err(id, 'status "rejected" exige o bloco rejection'); return; }
    for (const f of ['date', 'stage_reached', 'reason', 'weakness', 'result', 'params']) {
      if (r[f] === undefined || r[f] === null || String(r[f]).trim() === '') err(id, `rejection.${f} é obrigatório`);
    }
    if (r.date && !DATE_RE.test(String(r.date))) err(id, 'rejection.date fora do formato YYYY-MM-DD');
    if (Number.isInteger(r.stage_reached) && r.stage_reached !== s.stage) {
      err(id, `rejection.stage_reached (${r.stage_reached}) tem que ser igual ao stage (${s.stage})`);
    }
  } else if (s.rejection) {
    err(id, 'bloco rejection só é permitido com status "rejected"');
  }

  // --- histórico: nenhum estágio pulado, cada promoção com evidência em disco
  const hist = Array.isArray(s.stage_history) ? s.stage_history : [];
  const esperadas = vencidos + 1;
  if (hist.length !== esperadas) {
    const fim = rejeitada ? `venceu até o STAGE ${vencidos} antes de morrer no ${s.stage}` : `STAGE 0 até ${s.stage}`;
    err(id, `stage_history tem ${hist.length} entrada(s); são necessárias ${esperadas} (${fim}), sem pular etapa`);
  }
  let anterior = null;
  hist.forEach((h, i) => {
    const tag = `stage_history[${i}]`;
    if (h.stage !== i) err(id, `${tag}: estágio fora de ordem (esperado ${i}, veio ${h.stage}) — não se pula etapa`);
    if (!DATE_RE.test(String(h.date || ''))) err(id, `${tag}: date ausente ou fora do formato YYYY-MM-DD`);
    else if (anterior && h.date < anterior) err(id, `${tag}: data ${h.date} anterior à do estágio previous (${anterior})`);
    else anterior = h.date;
    if (h.verdict !== 'pass') err(id, `${tag}: verdict tem que ser "pass" (estágio no histórico é estágio vencido)`);
    if (!h.evidence) err(id, `${tag}: evidence obrigatório (caminho do artefato)`);
    else if (!fs.existsSync(path.join(ROOT, h.evidence))) err(id, `${tag}: evidência não existe em disco: ${h.evidence}`);
  });

  // --- gates quantitativos, cumulativos do 0 até o stage atual
  for (let st = 0; st <= vencidos; st++) {
    const gate = gates.stages[String(st)];
    if (!gate) continue;
    const valor = (k) => (k === 'hypothesis' ? s.hypothesis : metrics[k]);
    for (const k of gate.required || []) {
      const v = valor(k);
      if (v === undefined || v === null || String(v).trim() === '') {
        err(id, `STAGE ${st} (${gate.name}): falta a evidência "${k}" — sem medida não há promoção`);
      }
    }
    for (const [k, min] of Object.entries(gate.min || {})) {
      const v = metrics[k];
      if (typeof v === 'number' && v < min) err(id, `STAGE ${st} (${gate.name}): ${k} = ${v} < mínimo ${min}`);
    }
    for (const [k, max] of Object.entries(gate.max || {})) {
      const v = metrics[k];
      if (typeof v === 'number' && v > max) err(id, `STAGE ${st} (${gate.name}): ${k} = ${v} > máximo ${max}`);
    }
  }

  // --- controles anti-overfitting (valem a partir da validação)
  if (vencidos >= 3) {
    const limite = gates.global.max_configs_without_adjustment;
    if (!Number.isInteger(s.configs_tested)) {
      err(id, 'configs_tested obrigatório a partir do STAGE 3: quantas configurações/variantes foram testadas até aqui');
    } else if (s.configs_tested > limite && !String(s.multiple_testing_adjustment || '').trim()) {
      err(id, `configs_tested = ${s.configs_tested} acima de ${limite} sem multiple_testing_adjustment: com esse número de tentativas, um OOS bonito é esperado por acaso`);
    }
    const usos = metrics.final_holdout_uses;
    if (typeof usos === 'number' && usos > gates.global.max_final_holdout_uses) {
      err(id, `final_holdout_uses = ${usos}: o holdout final se usa UMA vez. Depois disso ele virou dado de desenvolvimento.`);
    }
  }

  if (!Array.isArray(s.weaknesses) || s.weaknesses.length === 0) {
    if (s.stage >= 7) err(id, 'STAGE 7+ exige weaknesses preenchidas — estratégia sem fraqueza conhecida é estratégia mal estudada');
    else warn(id, 'weaknesses vazio: registre o que você já sabe que é frágil');
  }
}

// -------------------------------------------------------------- renderização

const NAO_MEDIDO = '— (não medido)';
const fmt = (v, suf = '') => (v === undefined || v === null || v === '' ? NAO_MEDIDO : `${v}${suf}`);
const cell = (v) => String(v ?? NAO_MEDIDO).replace(/\|/g, '\\|').replace(/\n+/g, ' ');

function hallLinhas(s) {
  const m = s.metrics || {};
  return [
    ['Strategy', s.name],
    ['Market', s.market],
    ['Version', s.version],
    ['Date promoted', fmt(s.promoted_at)],
    ['OOS Profit Factor', fmt(m.oos_profit_factor)],
    ['OOS Expectancy', fmt(m.oos_expectancy_r, ' R/trade')],
    ['Sharpe', fmt(m.sharpe)],
    ['Max Drawdown', fmt(m.max_drawdown_pct, '%')],
    ['Average Holding Time', fmt(m.avg_holding_time)],
    ['Trades', fmt(m.oos_trades)],
    ['Slippage tolerance', fmt(m.slippage_tolerance)],
    ['Monte Carlo DD95', fmt(m.mc_dd95_pct, '%')],
    ['Current status', `STAGE ${s.stage} · ${s.status}`],
  ];
}

function renderHall(list) {
  const out = [];
  out.push('# HALL OF FAME — Black Wolf');
  out.push('');
  out.push('<!-- ARQUIVO GERADO. Não edite à mão: edite lab/registry.json e rode `node lab/validate.mjs --write`. -->');
  out.push('');
  out.push('Entram aqui **somente** estratégias em **STAGE 7 (paper trade)** ou **STAGE 8 (produção)**');
  out.push('que percorreram todos os estágios anteriores com evidência arquivada e bateram os gates');
  out.push('de [`lab/gates.json`](lab/gates.json). Lucro grande, curva bonita, win rate alto e "funcionou');
  out.push('nos últimos meses" **não promovem ninguém** — ver [STRATEGY_LIFECYCLE.md](STRATEGY_LIFECYCLE.md).');
  out.push('');
  out.push('Produto que já está em produção mas não tem dossiê **não entra aqui**: ele é dívida, não troféu,');
  out.push('e aparece em "Dívida de produção" no ciclo de vida.');
  out.push('');
  out.push(`Atualizado em: ${TODAY} · Estratégias no Hall of Fame: **${list.length}**`);
  out.push('');
  if (!list.length) {
    out.push('---');
    out.push('');
    out.push('## Vazio — e isso está certo');
    out.push('');
    out.push('Nenhuma estratégia percorreu o ciclo completo ainda. Hall de fama vazio no começo é o');
    out.push('estado esperado de um laboratório honesto: o cemitério enche primeiro, o hall enche depois.');
    out.push('Hall cheio em laboratório novo é sinal de critério frouxo, não de talento.');
    out.push('');
    out.push('Quando a primeira entrar, ela é registrada com estes campos (todos obrigatórios):');
    out.push('');
    const campos = hallLinhas({ metrics: {} }).map(([k]) => k);
    campos.splice(campos.length - 1, 0, 'Weaknesses'); // ordem do STRATEGY_LIFECYCLE
    for (const k of campos) out.push(`- ${k}`);
    out.push('');
    return out.join('\n') + '\n';
  }
  out.push('| # | Strategy | Market | Version | Stage | OOS PF | MC DD95 | Status |');
  out.push('| - | -------- | ------ | ------- | ----- | ------ | ------- | ------ |');
  list.forEach((s, i) => {
    const m = s.metrics || {};
    out.push(`| ${i + 1} | ${cell(s.name)} | ${cell(s.market)} | ${cell(s.version)} | ${s.stage} | ${cell(fmt(m.oos_profit_factor))} | ${cell(fmt(m.mc_dd95_pct, '%'))} | ${cell(s.status)} |`);
  });
  out.push('');
  for (const s of list) {
    out.push('---');
    out.push('');
    out.push(`## ${s.name} — v${s.version}`);
    out.push('');
    out.push('| Campo | Valor |');
    out.push('| ----- | ----- |');
    for (const [k, v] of hallLinhas(s)) out.push(`| ${k} | ${cell(v)} |`);
    out.push('');
    out.push('**Weaknesses**');
    out.push('');
    for (const w of s.weaknesses || []) out.push(`- ${w}`);
    out.push('');
    out.push(`Dossiê: [\`lab/strategies/${s.id}/DOSSIER.md\`](lab/strategies/${s.id}/DOSSIER.md)`);
    out.push('');
  }
  return out.join('\n');
}

function renderGrave(list) {
  const out = [];
  out.push('# STRATEGY GRAVEYARD — Black Wolf');
  out.push('');
  out.push('<!-- ARQUIVO GERADO. Não edite à mão: edite lab/registry.json e rode `node lab/validate.mjs --write`. -->');
  out.push('');
  out.push('Estratégias rejeitadas. Este arquivo é o ativo mais valioso do laboratório: ele é a lista');
  out.push('do que **não** funciona e do porquê — o que impede a casa de pagar duas vezes pelo mesmo erro.');
  out.push('');
  out.push('**Regra de ressurreição:** uma estratégia daqui não volta por mudança de parâmetro, de');
  out.push('timeframe ou de ativo. Ela só reabre com **nova hipótese econômica ou estrutural** escrita,');
  out.push('em uma entrada nova do registro, com `reopened_from` apontando para a entrada original e');
  out.push('recomeçando do STAGE 0. O validador recusa qualquer outro caminho.');
  out.push('');
  out.push(`Atualizado em: ${TODAY} · Estratégias enterradas: **${list.length}**`);
  out.push('');
  if (!list.length) {
    out.push('---');
    out.push('');
    out.push('## Vazio — e isso é um alerta');
    out.push('');
    out.push('Cemitério vazio não significa que as ideias são boas. Significa que ninguém foi testado');
    out.push('até o ponto de morrer, ou que mortes aconteceram e não foram registradas. Ideia abandonada');
    out.push('sem registro volta em seis meses com outro nome e custa o mesmo dinheiro de novo.');
    out.push('');
    out.push('Cada enterro registra:');
    out.push('');
    out.push('- Motivo da rejeição');
    out.push('- Resultado');
    out.push('- Parâmetros');
    out.push('- Fraqueza descoberta');
    out.push('- Estágio em que morreu e data');
    out.push('');
    return out.join('\n') + '\n';
  }
  out.push('| # | Strategy | Market | Morreu no | Data | Motivo |');
  out.push('| - | -------- | ------ | --------- | ---- | ------ |');
  list.forEach((s, i) => {
    const r = s.rejection || {};
    out.push(`| ${i + 1} | ${cell(s.name)} | ${cell(s.market)} | STAGE ${r.stage_reached ?? s.stage} | ${cell(r.date)} | ${cell(r.reason)} |`);
  });
  out.push('');
  for (const s of list) {
    const r = s.rejection || {};
    out.push('---');
    out.push('');
    out.push(`## ${s.name} — v${s.version} (\`${s.id}\`)`);
    out.push('');
    out.push('| Campo | Valor |');
    out.push('| ----- | ----- |');
    out.push(`| Market | ${cell(s.market)} |`);
    out.push(`| Hipótese original | ${cell(s.hypothesis)} |`);
    out.push(`| Morreu no estágio | STAGE ${r.stage_reached ?? s.stage} |`);
    out.push(`| Data da rejeição | ${cell(r.date)} |`);
    out.push(`| Motivo da rejeição | ${cell(r.reason)} |`);
    out.push(`| Resultado | ${cell(r.result)} |`);
    out.push(`| Parâmetros | ${cell(r.params)} |`);
    out.push(`| Fraqueza descoberta | ${cell(r.weakness)} |`);
    out.push('');
    if ((s.weaknesses || []).length) {
      out.push('**Outras fraquezas registradas**');
      out.push('');
      for (const w of s.weaknesses) out.push(`- ${w}`);
      out.push('');
    }
    out.push(`Dossiê: [\`lab/strategies/${s.id}/DOSSIER.md\`](lab/strategies/${s.id}/DOSSIER.md)`);
    out.push('');
  }
  return out.join('\n');
}

// ------------------------------------------------------------------- saída

const hallList = strategies
  .filter((s) => s.stage >= 7 && ['paper', 'production'].includes(s.status))
  .sort((a, b) => String(b.promoted_at || '').localeCompare(String(a.promoted_at || '')) || a.id.localeCompare(b.id));

const graveList = strategies
  .filter((s) => s.status === 'rejected')
  .sort((a, b) => String(b.rejection?.date || '').localeCompare(String(a.rejection?.date || '')) || a.id.localeCompare(b.id));

const hallMd = renderHall(hallList);
const graveMd = renderGrave(graveList);
const write = process.argv.includes('--write');

if (write) {
  fs.writeFileSync(HALL, hallMd);
  fs.writeFileSync(GRAVE, graveMd);
  console.log(`escrito: ${path.relative(ROOT, HALL)}`);
  console.log(`escrito: ${path.relative(ROOT, GRAVE)}`);
} else {
  for (const [file, esperado] of [[HALL, hallMd], [GRAVE, graveMd]]) {
    const rel = path.relative(ROOT, file);
    if (!fs.existsSync(file)) errors.push(`${rel}: não existe — rode \`node lab/validate.mjs --write\``);
    else if (fs.readFileSync(file, 'utf8') !== esperado) {
      // a data de atualização muda sozinha; só reclama se o conteúdo real divergir
      const limpa = (t) => t.replace(/^Atualizado em: \d{4}-\d{2}-\d{2} /m, 'Atualizado em: ');
      if (limpa(fs.readFileSync(file, 'utf8')) !== limpa(esperado)) {
        errors.push(`${rel}: desatualizado em relação a lab/registry.json — rode \`node lab/validate.mjs --write\``);
      }
    }
  }
}

console.log(`\nBlack Wolf — ciclo de vida de estratégias (${TODAY})`);
console.log(`estratégias no registro: ${strategies.length} · hall of fame: ${hallList.length} · cemitério: ${graveList.length}`);

if (debts.length) {
  console.log(`\nDÍVIDA DE PRODUÇÃO (${debts.length}) — em produção sem dossiê completo:`);
  for (const d of debts) console.log(`  ! ${d}`);
}
if (warnings.length) {
  console.log(`\nAVISOS (${warnings.length}):`);
  for (const w of warnings) console.log(`  ~ ${w}`);
}
if (errors.length) {
  console.log(`\nERROS (${errors.length}) — promoção bloqueada:`);
  for (const e of errors) console.log(`  x ${e}`);
  console.log('');
  process.exit(1);
}
console.log('\nOK: registro consistente com o ciclo de vida.\n');
