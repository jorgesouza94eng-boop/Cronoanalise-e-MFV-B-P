/**
 * Teste de ponta a ponta da REV 1.4 (Playwright): demanda por produto e carga do posto (mix),
 * ligação Cronoanálise → MFV (empresa, estudos da empresa, botão "→ MFV") e aviso de TC atualizado.
 * Uso: npm start (outro terminal) e depois
 *   node tests/e2e.rev14.js http://127.0.0.1:8080/
 * Variável opcional: CHROMIUM_PATH=/caminho/do/chrome
 */
/* global LeanApp, LeanMfvApp */ // existem apenas dentro das páginas testadas
const { chromium } = require("playwright");
const C = require("../js/calc.js");

const base = process.argv[2] || "http://127.0.0.1:8080/";
let failures = 0;
const check = (cond, msg) => { console.log((cond ? "  OK  " : "  FALHA ") + msg); if (!cond) failures++; };

/** Furadeira: produto A (Furar 12 s) e produto B (Setup 30 s tipo A + Furar 20 s). */
function furadeira() {
  const s = C.createStudy({ clientName: "Metal Delta", processName: "Furadeira" });
  s.shiftParams = { shiftTimeMin: 500, plannedStopsMin: 20, dailyDemandPcs: 100, tolerancePct: 0 };
  s.elements = [
    C.createElement({ product: "Produto A", description: "Furar", videoTime: "12" }),
    C.createElement({ product: "Produto A", description: "Furar", videoTime: "24" }),
    C.createElement({ product: "Produto B", description: "Setup", type: "A", videoTime: "54" }),
    C.createElement({ product: "Produto B", description: "Furar", videoTime: "1:14" }),
  ];
  return s;
}
function prensa() {
  const s = C.createStudy({ clientName: "Metal Delta", processName: "Prensa" });
  s.elements = [C.createElement({ description: "Prensar", videoTime: "40" })];
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
  const closeDlg = (id) => p.evaluate((i) => { const d = document.getElementById(i); if (d.open) d.close(); }, id);
  console.log(`== REV 1.4 ${base}`);

  await p.goto(base + "index.html");
  await p.waitForSelector("#study-dialog[open]");
  const fur = furadeira();
  for (const st of [prensa(), fur]) {
    if (!(await p.$("#study-dialog[open]"))) { await p.click("#btn-studies"); await p.waitForSelector("#study-dialog[open]"); }
    await p.setInputFiles("#input-import-json", { name: "e.json", mimeType: "application/json", buffer: Buffer.from(C.serializeStudy(st)) });
    await p.waitForFunction((n) => window.LeanApp && LeanApp.state.study && LeanApp.state.study.processName === n, st.processName);
    await p.evaluate(() => LeanApp.flushSave());
  }
  await closeDlg("study-dialog");

  // ---- 1. Demanda por produto e carga do posto
  check(await p.isVisible("#mix-panel"), "quadro 'Carga do posto' com vários produtos");
  check(await txt("#mix-occupancy") === "🟢 21,5%", "sem demanda própria: demanda geral 100/dia → (20 + 83,3) ÷ 480 = 21,5%");
  await p.fill("#mix-tbody tr:nth-child(1) .mix-demand", "600");
  await p.fill("#mix-tbody tr:nth-child(2) .mix-demand", "300");
  check(await txt("#mix-load") === "370,0" && (await txt("#mix-occupancy")) === "🟢 77,1%", "carga = 0,2×600 + 0,833×300 = 370 min (77,1% de 480)");
  check(await txt("#kpi-bottleneck") === "ATENDE O MIX", "status do posto pelo mix");
  check((await txt("#mix-hint")).includes("Takt misto = 32,0"), "takt misto = 480 min ÷ 900 = 32,0 s");
  await p.fill("#mix-tbody tr:nth-child(2) .mix-demand", "500");
  check((await txt("#mix-occupancy")).includes("111,8%") && (await txt("#kpi-bottleneck")) === "SOBRECARGA", "B = 500/dia: 111,8% → SOBRECARGA");
  await p.fill("#mix-tbody tr:nth-child(2) .mix-demand", "300");
  await p.evaluate(() => LeanApp.flushSave());

  // ---- 2. "→ MFV" sem MFV da empresa: Novo MFV com empresa e estudo marcados
  await p.click("#btn-to-mfv");
  await p.waitForSelector("#doc-dialog[open]");
  check(await p.inputValue("#new-client") === "Metal Delta", "→ MFV: empresa preenchida");
  const items = await p.$$eval("#new-doc-study-list label", (l) => l.map((x) => [x.querySelector("input").checked, x.textContent]));
  check(items.length === 4, "lista os estudos da empresa: Furadeira A, B, Mix e Prensa (" + items.length + ")");
  check(items.some(([c, t]) => c && t.includes("Furadeira • Produto A")) && items.filter(([c]) => c).length === 1, "o estudo do botão (Produto A) já vem marcado");
  check(items.some(([, t]) => t.includes("Mix (TC ponderado)")), "opção Mix (TC ponderado)");
  await p.check("#new-doc-study-list label:has-text('Prensa') input");
  await p.fill("#new-family", "Suportes");
  await p.click("#new-doc-form button[type=submit]");
  await p.waitForFunction(() => window.LeanMfvApp && LeanMfvApp.state.doc && LeanMfvApp.state.doc.family === "Suportes");
  const names = await p.evaluate(() => LeanMfvApp.state.doc.steps.map((s) => s.name));
  check(names.length === 2 && names.includes("Furadeira • Produto A") && names.includes("Prensa"), "MFV criado com 2 etapas dos estudos: " + names.join(", "));
  check(await p.evaluate(() => LeanMfvApp.state.doc.steps.every((s) => s.tcStudyMin > 0)), "TCs já preenchidos");
  await p.evaluate(() => LeanMfvApp.flushSave());

  // ---- 3. "→ MFV" com 1 MFV da empresa: abre e inclui; repetir não duplica
  await p.goto(base + "index.html");
  await p.waitForFunction(() => window.LeanApp && LeanApp.state.study && LeanApp.state.study.processName === "Furadeira");
  await p.selectOption("#summary-product", { label: "Produto B" });
  await p.click("#btn-to-mfv");
  await p.waitForFunction(() => window.LeanMfvApp && LeanMfvApp.state.doc && LeanMfvApp.state.doc.steps.length === 3);
  check(await p.evaluate(() => LeanMfvApp.state.doc.steps[2].name) === "Furadeira • Produto B", "1 MFV da empresa: abre e inclui a etapa do Produto B");
  check(!(await p.$("#doc-dialog[open]")), "sem diálogo: foi direto ao MFV");
  await p.evaluate(() => LeanMfvApp.flushSave());
  await p.goto(base + "index.html");
  await p.waitForFunction(() => window.LeanApp && LeanApp.state.study);
  await p.click("#btn-to-mfv");
  await p.waitForFunction(() => window.LeanMfvApp && LeanMfvApp.state.doc);
  await p.waitForTimeout(300);
  check(await p.evaluate(() => LeanMfvApp.state.doc.steps.length) === 3, "repetir o botão não duplica a etapa");

  // ---- 4. TC alterado no estudo: aviso no MFV com Desfazer
  await p.goto(base + "index.html");
  await p.waitForFunction(() => window.LeanApp && LeanApp.state.study);
  // Produto A: Furar (12 + 14) ÷ 2 = 13 s
  await p.fill("#chrono-tbody tr:nth-child(2) [data-field=videoTime]", "26");
  await p.press("#chrono-tbody tr:nth-child(2) [data-field=videoTime]", "Enter");
  await p.evaluate(() => LeanApp.flushSave());
  await p.goto(base + "mfv.html");
  await p.waitForFunction(() => window.LeanMfvApp && LeanMfvApp.state.doc);
  check(await p.isVisible("#tc-banner") && (await txt("#tc-banner-text")).includes("0,200 → 0,217"), "aviso: Furadeira • Produto A 0,200 → 0,217 min");
  await p.click("#btn-tc-undo");
  const st = await p.evaluate(() => LeanMfvApp.state.doc.steps.find((s) => s.name === "Furadeira • Produto A"));
  check(st.source === "manual" && Math.abs(st.tcManualMin - 0.2) < 1e-9 && (await p.isHidden("#tc-banner")), "Desfazer: mantém 0,200 como TC editado");

  // ---- 5. Empresa com a mesma grafia dos estudos
  await p.click("#btn-docs");
  await p.waitForSelector("#doc-dialog[open]");
  check(await p.$$eval("#client-list option", (o) => o.some((x) => x.value === "Metal Delta")), "Novo MFV sugere as empresas dos estudos");
  await p.fill("#new-client", "metal  delta");
  await p.dispatchEvent("#new-client", "input");
  check(await p.$$eval("#new-doc-study-list label", (l) => l.length) === 4, "a lista de estudos aparece mesmo com grafia diferente");
  await p.fill("#new-family", "Outra família");
  await p.click("#new-doc-form button[type=submit]");
  await p.waitForFunction(() => LeanMfvApp.state.doc.family === "Outra família");
  check(await p.evaluate(() => LeanMfvApp.state.doc.clientName) === "Metal Delta", "empresa gravada com a grafia dos estudos");

  check(errors.length === 0, "nenhum erro no console" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(failures ? `${failures} FALHA(S)` : "TUDO OK");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
