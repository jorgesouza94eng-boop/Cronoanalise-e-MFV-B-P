/**
 * Teste de ponta a ponta da REV 1.14, Fase 2 (Playwright): MFV com produto estratificado —
 * "Ponderar pela demanda do produto", operador compartilhado entre etapas (carga e gargalo) e
 * etapa não medida. Dados fictícios: 520 min/dia (horário padrão), família 800/dia, tolerância 0%.
 * Etapas: Preparo 6,4 | Laminação 4,0 | Queijo 3,0 | Enrolar 12,0 (Enroladinho, 200/dia) e
 * Moldagem 5,0 (Pão, 600/dia) → ponderados 1,6 | 1,0 | 0,75 | 3,0 | 3,75; carga do Op1 10,1 s.
 * Uso: npm start (outro terminal) e depois
 *   node tests/e2e.rev114-mfv.js http://127.0.0.1:8080/
 * Variável opcional: CHROMIUM_PATH=/caminho/do/chrome
 */
/* global LeanApp, LeanMfvApp */ // existem apenas dentro das páginas testadas
const { chromium } = require("playwright");
const C = require("../js/calc.js");

const base = process.argv[2] || "http://127.0.0.1:8080/";
let failures = 0;
const check = (cond, msg) => { console.log((cond ? "  OK  " : "  FALHA ") + msg); if (!cond) failures++; };

/** Estudo de 1 produto com 1 elemento C (Qtd 10): TN = tempo ÷ 10. */
function study(name, time, demand) {
  const s = C.createStudy({ clientName: "Padaria Teste", processName: name });
  s.shiftParams = { shiftTimeMin: 520, plannedStopsMin: 0, dailyDemandPcs: demand, tolerancePct: 0 };
  s.elements = [C.createElement({ description: name, type: "C", quantity: "10", videoTime: time, value: "AG" })];
  return s;
}
const STUDIES = [
  ["Preparo", "104", 200],
  ["Laminação", "40", 200],
  ["Queijo", "30", 200],
  ["Enrolar", "200", 200],
  ["Moldagem", "50", 600],
];

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const p = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  const errors = [];
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  p.on("dialog", (d) => d.accept());
  const txt = async (sel) => (await p.textContent(sel)).trim();
  console.log(`== REV 1.14 Fase 2 ${base}`);

  await p.goto(base + "index.html");
  await p.waitForSelector("#study-dialog[open]");
  for (const [name, time, demand] of STUDIES) {
    await p.setInputFiles("#input-import-json", { name: `${name}.json`, mimeType: "application/json", buffer: Buffer.from(C.serializeStudy(study(name, time, demand))) });
    await p.waitForFunction((n) => window.LeanApp && LeanApp.state.study && LeanApp.state.study.processName === n, name);
    await p.evaluate(() => LeanApp.flushSave());
  }

  // Novo MFV com os 5 estudos (na ordem de marcação)
  await p.goto(base + "mfv.html");
  await p.waitForSelector("#doc-dialog[open]");
  await p.fill("#new-client", "Padaria Teste");
  await p.dispatchEvent("#new-client", "input");
  for (const [name] of STUDIES) await p.check(`#new-doc-study-list label:has-text('${name}') input`);
  await p.fill("#new-family", "Pães");
  await p.click("#new-doc-form button[type=submit]");
  await p.waitForFunction(() => LeanMfvApp.state.doc && LeanMfvApp.state.doc.steps.length === 5);
  await p.selectOption("#mfv-time-unit", "s");
  await p.fill("#demand-monthly", String(800 * 22));
  await p.fill("#work-days", "22");
  check(await txt("#kpi-takt") === "39,0", "takt 39,0 s (520 min ÷ 800/dia)");
  check(await p.evaluate(() => LeanMfvApp.state.doc.steps.every((s) => s.weighted === false)), "ponderação desligada por padrão");
  check(await p.evaluate(() => LeanMfvApp.state.doc.steps.map((s) => s.studyDemand).join(",")) === "200,200,200,200,600", "demanda própria de cada produto vinda do estudo");

  // Liga a ponderação e informa o operador Op1 em todas as etapas
  const rows = "#steps-tbody tr[data-id]";
  await p.check(`${rows}:nth-child(1) [data-field='kaizen']`);
  for (let i = 1; i <= 5; i++) {
    await p.check(`${rows}:nth-child(${i}) [data-field='weighted']`);
    await p.fill(`${rows}:nth-child(${i}) [data-field='operatorTag']`, "Op1");
  }
  const tcs = await p.$$eval(`${rows} [data-field='tc']`, (x) => x.map((i) => i.value));
  check(tcs.join("|") === "1,6|1,0|0,8|3,0|3,8", "TC ponderado na linha: " + tcs.join("|"));
  check((await txt(`${rows}:nth-child(1) .weight-detail`)) === "TP 6,4 × 200/800 → 1,6", "origem do TC mostra TP × fator → TC");
  check((await txt(`${rows}:nth-child(5) .weight-detail`)) === "TP 5,0 × 600/800 → 3,8", "fator 600/800 do Pão");
  const warn = await txt("#steps-warnings");
  check(warn.includes("✔ Operador Op1: etapas 1, 2, 3, 4 e 5 • carga 10,10 s • 25,9% do takt • capacidade 3.089/dia"), "conferência: carga do Op1");
  check(warn.includes("Gargalo = carga do operador Op1 (10,10 s), não a maior etapa (5. Moldagem, 3,75 s)"), "gargalo = carga do operador");
  check(!warn.includes("Demanda diária do MFV"), "etapas ponderadas não acusam demanda diferente da família");
  check((await txt("#kpi-bottleneck-name")) === "Carga do operador Op1" && (await txt("#kpi-bottleneck-tc")) === "10,1", "cartão do gargalo");
  check((await txt("#kpi-ops")) === "1,00", "operadores atuais = 1 (distintos)");
  check((await txt("#kpi-cap")).startsWith("3.089"), "capacidade da linha pela carga: " + (await txt("#kpi-cap")));
  check((await txt("#kpi-kaizen-detail")).includes("capacidade do operador Op1"), "Kaizen usa a capacidade do operador");
  const fr = await p.$$eval(`${rows} [data-out='opsEff']`, (x) => x.map((c) => c.textContent));
  check(fr.join("|") === "0,158|0,099|0,074|0,297|0,371", "fração do operador por etapa (TC ÷ carga): " + fr.join("|"));
  check(await p.isVisible("#gbo-chart .gbo-load") && (await txt("#gbo-chart .gbo-load")) === "Carga do Op1 10,10 s (gargalo)", "linha da carga do operador no GBO");

  // Etapa não medida (Forno)
  await p.click("#btn-add-manual-step");
  await p.fill(`${rows}:nth-child(6) [data-field='name']`, "Forno");
  await p.check(`${rows}:nth-child(6) [data-field='unmeasured']`);
  await p.waitForFunction(() => LeanMfvApp.state.doc.steps[5].unmeasured === true);
  check(await p.isDisabled(`${rows}:nth-child(6) [data-field='tc']`) && (await txt(`${rows}:nth-child(6) [data-out='takt']`)) === "--", "linha não medida sem TC");
  check((await txt("#steps-warnings")).includes("Fluxo incompleto: 1 etapa(s) sem TC (6. Forno)"), "aviso de fluxo incompleto");
  check(await p.$$eval("#gbo-chart .gbo-bar.is-unmeasured", (b) => b.length) === 1, "barra tracejada 'não medida' no GBO");
  check((await txt("#kpi-cap")).startsWith("3.089") && (await txt("#kpi-ops")) === "1,00", "Forno fora dos cálculos");
  check((await txt("#lead-hint")) === "Dias = quantidade em estoque ÷ demanda diária." || (await txt("#lead-hint")).includes("Σ TP original"), "lead time com o TP original");

  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT, fullPage: true }); // captura opcional para conferência visual

  // Produto sem demanda própria (M7): estudo Queijo sem demanda → "--"
  await p.evaluate(() => {
    LeanMfvApp.state.doc.steps[2].studyDemand = null;
  });
  await p.fill("#work-days", "22");
  await p.dispatchEvent("#work-days", "input");
  check((await p.inputValue(`${rows}:nth-child(3) [data-field='tc']`)) === "" && (await txt(`${rows}:nth-child(3) .weight-detail`)).includes("informe a demanda do produto"), "sem demanda própria: TC em branco e aviso");

  check(errors.length === 0, "nenhum erro no console" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(failures ? `${failures} FALHA(S)` : "TUDO OK");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
