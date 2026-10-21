/**
 * Teste de ponta a ponta da REV 1.13 (Playwright): macro-etapas na cronoanálise (coluna,
 * resumo por macro, preencher para baixo, renomear, filtro, ocultar), ocupação no MFV
 * (coluna Ocupação e quadro "Ocupação dos recursos") e Yamazumi por macro-etapa.
 * Valores de conferência: 520 min/dia, família 800/dia (Pão 600, Enroladinho 200), tolerância 5%.
 * Uso: npm start (outro terminal) e depois
 *   node tests/e2e.rev113.js http://127.0.0.1:8080/
 * Variável opcional: CHROMIUM_PATH=/caminho/do/chrome
 */
/* global LeanApp, LeanMfvApp, LeanYamazumiApp */ // existem apenas dentro das páginas testadas
const { chromium } = require("playwright");
const C = require("../js/calc.js");

const base = process.argv[2] || "http://127.0.0.1:8080/";
let failures = 0;
const check = (cond, msg) => { console.log((cond ? "  OK  " : "  FALHA ") + msg); if (!cond) failures++; };

function padaria() {
  const s = C.createStudy({ clientName: "Empresa Teste", processName: "Bancada" });
  s.shiftParams = { shiftTimeMin: 520, plannedStopsMin: 0, dailyDemandPcs: 800, tolerancePct: 5 };
  s.settings.multiProduct = true;
  const E = "Enroladinho";
  s.elements = [
    [E, "Preparo da massa", "Preparar massa", "32", "5"],
    [E, "Laminação e corte", "Laminar e cortar", "2:01", "20"],
    [E, "Queijo", "Colocar queijo", "3:14", "25"],
    [E, "Enrolar", "Enrolar", "22:03", "100"],
    ["Pão", "Moldagem", "Moldar pão", "1:37:34", "1000"],
  ].map(([product, macroEtapa, description, videoTime, quantity]) => C.createElement({ product, macroEtapa, description, videoTime, quantity, value: "AG" }));
  s.productDemand = { "pão": "600", enroladinho: "200" };
  s.settings.product = "enroladinho";
  return s;
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const p = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  const errors = [];
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  p.on("dialog", (d) => d.accept());
  const txt = async (sel) => (await p.textContent(sel)).trim();
  const cells = (sel) => p.$$eval(sel, (rows) => rows.map((r) => Array.from(r.children).map((c) => c.textContent.trim())));
  console.log(`== REV 1.13 ${base}`);

  // ---- Cronoanálise
  await p.goto(base + "index.html");
  await p.waitForSelector("#study-dialog[open]");
  check(await txt(".app-header .app-rev") === "REV 1.13", "rótulo da revisão REV 1.13");
  await p.setInputFiles("#input-import-json", { name: "e.json", mimeType: "application/json", buffer: Buffer.from(C.serializeStudy(padaria())) });
  await p.waitForFunction(() => window.LeanApp && LeanApp.state.study && LeanApp.state.study.processName === "Bancada");
  check(await p.isChecked("#opt-macro") && (await p.isVisible("#chrono-tbody .input-macro")), "coluna Macro-etapa visível (estudo com macros)");
  check(await p.isVisible("#macro-panel"), "bloco Resumo por macro-etapa");
  let rows = await cells("#macro-tbody tr");
  check(rows.map((r) => r[0]).join("|") === "Preparo da massa|Laminação e corte|Queijo|Enrolar", "macros do Enroladinho na ordem do estudo");
  check(rows.map((r) => r[2]).join("|") === "6,4|4,5|2,9|11,3" && rows.map((r) => r[4]).join("|") === "6,7|4,7|3,1|11,9", "tempo normal e TP por macro (s, 1 casa)");
  check(await txt("#macro-tn") === "25,1" && (await txt("#macro-tp")) === "26,3" && (await txt("#macro-share")) === "100,0%", "Σ = ciclo (25,1 s) e TP do produto (26,3 s)");
  check((await txt("#macro-hint")).includes("✔"), "conferência Σ macros = ciclo");

  // Filtro por macro-etapa (só exibição)
  await p.selectOption("#flt-macro", "enrolar");
  check(await p.$$eval("#chrono-tbody tr:not([hidden])", (r) => r.length) === 1, "filtro por macro: 1 linha visível");
  check(await txt("#macro-tn") === "25,1", "filtro não altera o resumo por macro");
  await p.click("#btn-clear-filter");

  // Renomear: troca em todas as linhas do produto
  const first = "#chrono-tbody tr:nth-child(1) .input-macro";
  await p.click(first);
  await p.fill(first, "Masseira");
  await p.press(first, "Enter");
  check(await p.evaluate(() => LeanApp.state.study.elements[0].macroEtapa) === "Masseira", "macro renomeada na linha");
  rows = await cells("#macro-tbody tr");
  check(rows[0][0] === "Masseira", "resumo por macro com o novo nome");
  // Sem macro: aviso e linha "Sem macro-etapa"
  await p.fill("#chrono-tbody tr:nth-child(3) .input-macro", "");
  await p.press("#chrono-tbody tr:nth-child(3) .input-macro", "Tab");
  check((await txt("#macro-issues")).includes("sem macro-etapa") && (await txt("#macro-tbody")).includes("Sem macro-etapa"), "elemento sem macro: aviso e linha 'Sem macro-etapa'");
  check(await txt("#macro-tn") === "25,1", "soma continua igual ao ciclo");
  await p.fill("#chrono-tbody tr:nth-child(3) .input-macro", "Queijo");
  await p.press("#chrono-tbody tr:nth-child(3) .input-macro", "Tab");
  await p.fill(first, "Preparo da massa");
  await p.press(first, "Tab");
  // Ocultar a coluna mantém as macros
  await p.uncheck("#opt-macro");
  check(!(await p.$("#chrono-tbody .input-macro")) && (await p.isVisible("#macro-panel")), "ocultar a coluna: macros e resumo mantidos");
  await p.check("#opt-macro");
  await p.evaluate(() => LeanApp.flushSave());

  // ---- MFV: coluna Ocupação e quadro de recursos
  await p.goto(base + "mfv.html");
  await p.waitForSelector("#doc-dialog[open]");
  await p.fill("#new-client", "Empresa Teste");
  await p.dispatchEvent("#new-client", "input");
  await p.check("#new-doc-study-list label:has-text('Bancada • Enroladinho') input");
  await p.check("#new-doc-study-list label:has-text('Bancada • Pão') input");
  await p.fill("#new-family", "Pães");
  await p.click("#new-doc-form button[type=submit]");
  await p.waitForFunction(() => LeanMfvApp.state.doc && LeanMfvApp.state.doc.steps.length === 2);
  await p.fill("#demand-monthly", String(800 * 22));
  await p.fill("#work-days", "22");
  await p.selectOption("#mfv-time-unit", "s");
  check(await txt("#kpi-takt") === "39,0", "takt da família = 31.200 ÷ 800 = 39,0 s");
  const steps = await cells("#steps-tbody tr[data-id]");
  check(steps[0][8] === "67,5%" && steps[0][9] === "16,9%", "Enroladinho: % do takt 67,5% (TC real) e ocupação 16,9% (TP × 200 ÷ 31.200)");
  check(steps[1][9] === "9,1%", "Pão: ocupação 9,1% (TP × 600 ÷ 31.200)");
  check(await p.isVisible("#resource-panel"), "quadro 'Ocupação dos recursos'");
  const res = await cells("#resource-tbody tr");
  const occ = res.filter((r) => r[1] && !r[1].startsWith("Total")).map((r) => `${r[1]}=${r[4]}/${r[5]}`);
  check(
    occ.join("|") === "Preparo da massa=1,7/4,3%|Laminação e corte=1,2/3,0%|Queijo=0,8/2,0%|Enrolar=3,0/7,6%|Moldagem=3,6/9,1%",
    "TC ponderado e ocupação por macro: " + occ.join("; ")
  );
  const tot = res.find((r) => r[1].startsWith("Total"));
  check(tot && tot[1].includes("= carga do mix ✔") && tot[4] === "10,1" && tot[5] === "26,0%", "total do operador = mix (10,15 s; 26,0%)");
  check(await p.evaluate(() => LeanMfvApp.state.doc.steps[0].tcStudyMin) > 0.43, "TC das etapas continua o TP do estudo (não ponderado)");

  // ---- Yamazumi por macro-etapa
  await p.goto(base + "yamazumi.html");
  await p.waitForSelector("#doc-dialog[open]");
  await p.fill("#new-client", "Empresa Teste");
  await p.dispatchEvent("#new-client", "input");
  await p.fill("#new-name", "Bancada");
  await p.check("#new-doc-study-list label:has-text('Bancada • Enroladinho') input");
  await p.click("#new-doc-form button[type=submit]");
  await p.waitForFunction(() => LeanYamazumiApp.state.doc && LeanYamazumiApp.state.doc.name === "Bancada");
  await p.selectOption("#grp-chart-mode", "macro");
  check(await p.$$eval("#yz-chart .yz-seg", (s) => s.length) === 5, "Yamazumi por macro-etapa: 4 macros + tolerância");
  const legend = await txt("#yz-legend");
  check(legend.includes("Preparo da massa") && legend.includes("Enrolar") && legend.includes("Tolerância"), "legenda com as macro-etapas");

  check(errors.length === 0, "nenhum erro no console" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(failures ? `${failures} FALHA(S)` : "TUDO OK");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
