// Teste de fumaça ponta a ponta: login, cena 3D renderizando, câmeras, painel de conta,
// troca DEMO→LIVE sem vazar dados. Requer o servidor rodando (npm start) com web compilado.
// Uso: BW_URL=http://127.0.0.1:4100 BW_USER=admin BW_PASS=... node web/e2e/smoke.mjs
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

// createRequire respeita NODE_PATH (Playwright instalado globalmente). Localmente:
//   npm i -D playwright && npx playwright install chromium
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.env.BW_URL ?? 'http://127.0.0.1:4100';
const USER = process.env.BW_USER ?? 'admin';
const PASS = process.env.BW_PASS;
if (!PASS) throw new Error('Defina BW_PASS');
const out = new URL('./screenshots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const step = async (name, fn) => {
  const t = Date.now();
  await fn();
  console.log(`✓ ${name} (${Date.now() - t} ms)`);
};

await step('login', async () => {
  await page.goto(BASE);
  await page.getByLabel('Senha', { exact: true }).fill(PASS);
  await page.getByRole('button', { name: /Entrar/ }).click();
  await page.waitForSelector('canvas', { timeout: 30000 });
});

await step('dados DEMO chegam pelo WebSocket', async () => {
  await page.getByText('MODO DEMONSTRAÇÃO · DADOS FICTÍCIOS').waitFor();
  await page.getByText('Simulador · há').waitFor({ timeout: 15000 });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: out + '01-panorama-demo.png' });
});

await step('visão superior', async () => {
  await page.getByRole('button', { name: 'Superior' }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: out + '02-superior.png' });
});

await step('seleciona conta e abre painel', async () => {
  await page.getByRole('button', { name: 'Panorâmica' }).click();
  await page.locator('aside, div').getByRole('button', { name: /DEMO-/ }).first().click();
  await page.getByRole('button', { name: 'Visão geral' }).waitFor();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: out + '03-conta-foco.png' });
  await page.getByRole('button', { name: 'Histórico' }).click();
  await page.getByRole('button', { name: '30 dias' }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out + '04-conta-historico.png' });
  await page.getByRole('button', { name: 'Configurar' }).click();
  await page.getByText('Regras de risco desta conta').waitFor();
  await page.screenshot({ path: out + '05-conta-config.png' });
  await page.getByRole('button', { name: 'Fechar' }).first().click();
});

await step('clique numa mesa dentro da cena 3D abre o painel da conta', async () => {
  await page.getByRole('button', { name: 'Panorâmica' }).click();
  await page.waitForTimeout(3000);
  // Varre pontos da área das mesas até acertar uma (raycast real do Three.js).
  let opened = false;
  for (const [x, y] of [[700, 560], [640, 520], [760, 500], [560, 600], [820, 580], [700, 470], [600, 470], [880, 520]]) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(700);
    if (await page.getByRole('button', { name: 'Visão geral' }).count()) {
      opened = true;
      break;
    }
  }
  if (!opened) throw new Error('nenhum clique na cena abriu uma conta');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Livre' }).click();
});

await step('configurações', async () => {
  await page.getByRole('button', { name: 'Configurações' }).click();
  await page.getByText('Cadastrar conta manualmente').waitFor();
  await page.screenshot({ path: out + '06-configuracoes.png' });
  await page.getByRole('button', { name: 'Fechar' }).last().click();
});

await step('qualidade alta', async () => {
  await page.getByLabel('Qualidade gráfica').selectOption('high');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: out + '07-qualidade-alta.png' });
  await page.getByLabel('Qualidade gráfica').selectOption('medium');
});

await step('troca para LIVE não mostra dados DEMO', async () => {
  page.once('dialog', (d) => d.accept());
  await page.getByRole('radio', { name: /LIVE/ }).click();
  await page.waitForTimeout(2500);
  const demoTexts = await page.getByText(/DEMO-(APEX|PROP|PESSOAL)/).count();
  if (demoTexts > 0) throw new Error(`LIVE exibindo ${demoTexts} elemento(s) DEMO`);
  await page.screenshot({ path: out + '08-live-vazio.png' });
  await page.getByRole('radio', { name: 'DEMO' }).click();
});

const relevant = errors.filter((e) => !/favicon|GPU stall|WebGL warning|Automatic fallback to software WebGL/i.test(e));
if (relevant.length) {
  console.error('Erros no console:\n' + relevant.join('\n'));
  process.exitCode = 1;
}
await browser.close();
console.log('screenshots em', out);
