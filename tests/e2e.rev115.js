/**
 * Teste de ponta a ponta da REV 1.15 (Playwright): coluna Etapa na cronoanálise (preencher para
 * baixo, troca de bloco, filtro, TP por etapa) e o estudo com etapas no MFV (1 etapa do fluxo por
 * etapa do processo, já ponderada e com o operador automático; sem contagem dupla).
 * Dados fictícios: 520 min/dia, Enroladinho 200/dia (família 800/dia), tolerância 0%, 10 peças.
 * Laminação 4,0 + 1,0 | Queijo 3,0 | Enrolar 12,0 + 1,0 → 5,0 | 3,0 | 13,0 s.
 * Uso: npm start (outro terminal) e depois
 *   node tests/e2e.rev115.js http://127.0.0.1:8080/
 * Variável opcional: CHROMIUM_PATH=/caminho/do/chrome
 */
/* global LeanApp, LeanMfvApp */ // existem apenas dentro das páginas testadas
const { chromium } = require("playwright");
const C = require("../js/calc.js");

const base = process.argv[2] || "http://127.0.0.1:8080/";
let failures = 0;
const check = (cond, msg) => { console.log((cond ? "  OK  " : "  FALHA ") + msg); if (!cond) failures++; };

function study(name) {
  const s = C.createStudy({ clientName: "Rosca Teste", processName: name });
  s.shiftParams = { shiftTimeMin: 520, plannedStopsMin: 0, dailyDemandPcs: 200, tolerancePct: 0 };
  s.elements = [
    ["Abrir a massa", "C", 10, "40"],
    ["Pegar bandeja", "A", 1, "50"],
    ["Colocar queijo", "C", 10, "120"],
    ["Enrolar", "C", 10, "320"],
    ["Pegar bandeja", "A", 1, "330"],
  ].map(([description, type, q, videoTime]) => C.createElement({ description, type, quantity: String(q), videoTime }));
  s.filmPieces = { inicio: "10" };
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
  console.log(`== REV 1.15 ${base}`);

  await p.goto(base + "index.html");
  await p.waitForSelector("#study-dialog[open]");
  check(/^REV 1\.(1[5-9]|[2-9]\d)$/.test(await txt(".app-header .app-rev")), "rótulo da revisão (REV 1.15 ou posterior)");
  await p.setInputFiles("#input-import-json", { name: "e.json", mimeType: "application/json", buffer: Buffer.from(C.serializeStudy(study("Enroladinho"))) });
  await p.waitForFunction(() => window.LeanApp && LeanApp.state.study && LeanApp.state.study.processName === "Enroladinho");
  const heads = async () => p.$$eval("#chrono-table thead th", (t) => t.filter((x) => !x.hidden).map((x) => x.textContent.trim()));
  check(!(await heads()).includes("Etapa") && (await p.$$eval("#chrono-tbody .cell-etapa", (c) => c.length)) === 0, "sem 'Etapas' marcado: nenhuma coluna nova");

  await p.check("#opt-multi-etapa");
  await p.waitForSelector("#chrono-tbody .cell-etapa");
  const h = await heads();
  check(h[1] === "Etapa" && h[2].startsWith("Elemento"), "coluna Etapa antes do elemento: " + h.slice(0, 3).join(" | "));
  const et = (i) => `#chrono-tbody tr:nth-child(${i}) [data-field='etapa']`;
  await p.fill(et(1), "Laminação");
  await p.press(et(1), "Enter");
  check(await p.evaluate(() => document.activeElement.dataset.field) === "description", "Enter na Etapa vai para o elemento");
  const vals = async () => p.$$eval("#chrono-tbody [data-field='etapa']", (x) => x.map((i) => i.value).join("|"));
  check(await vals() === "Laminação|Laminação|Laminação|Laminação|Laminação", "preencher para baixo: " + (await vals()));
  await p.fill(et(3), "Queijo");
  await p.press(et(3), "Tab"); // pergunta se troca o bloco (aceita)
  check(await vals() === "Laminação|Laminação|Queijo|Queijo|Queijo", "troca do bloco: " + (await vals()));
  await p.fill(et(4), "Enrolar");
  await p.press(et(4), "Tab");
  check(await vals() === "Laminação|Laminação|Queijo|Enrolar|Enrolar", "etapas finais: " + (await vals()));
  const note = await txt("#summary-note");
  check(note.includes("Etapas (3): 1. Laminação TP 5,0 | 2. Queijo TP 3,0 | 3. Enrolar TP 13,0"), "TP por etapa no resumo: " + note.slice(0, 90));
  check((await txt("#kpi-cycle-time")) === "21,0", "TP do produto = Σ etapas (21,0 s)");
  const names = await p.$$eval("#summary-tbody tr td:nth-child(2)", (c) => c.map((x) => x.textContent.trim()));
  check(names.includes("[Laminação] Pegar bandeja") && names.includes("[Enrolar] Pegar bandeja"), "mesmo elemento em etapas diferentes, separado no resumo");
  await p.selectOption("#flt-etapa", { label: "Queijo" });
  check(await p.$$eval("#chrono-tbody tr:not([hidden])", (r) => r.length) === 1 && (await txt("#kpi-cycle-time")) === "21,0", "filtro por etapa (só exibição)");
  await p.click("#btn-clear-filter");
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT + "_crono.png", fullPage: true }); // conferência visual
  await p.evaluate(() => LeanApp.flushSave());

  // 2º estudo com etapas (outro posto): o operador automático não pode virar o mesmo "Op1"
  const s2 = study("Moldagem");
  s2.elements.forEach((e) => (e.etapa = "Moldagem"));
  s2.shiftParams.dailyDemandPcs = 600;
  await p.click("#btn-open-studies").catch(() => {});
  await p.setInputFiles("#input-import-json", { name: "m.json", mimeType: "application/json", buffer: Buffer.from(C.serializeStudy(s2)) });
  await p.waitForFunction(() => LeanApp.state.study && LeanApp.state.study.processName === "Moldagem");
  await p.evaluate(() => LeanApp.flushSave());

  // MFV: estudo com etapas → 3 etapas ponderadas com o operador Op1
  await p.goto(base + "mfv.html");
  await p.waitForSelector("#doc-dialog[open]");
  await p.fill("#new-client", "Rosca Teste");
  await p.dispatchEvent("#new-client", "input");
  check((await txt("#new-doc-study-list")).includes("Enroladinho (3 etapa(s))"), "Novo MFV mostra o nº de etapas do estudo");
  await p.check("#new-doc-study-list label:has-text('Enroladinho') input");
  await p.check("#new-doc-study-list label:has-text('Moldagem') input");
  await p.fill("#new-family", "Pães");
  await p.click("#new-doc-form button[type=submit]");
  await p.waitForFunction(() => LeanMfvApp.state.doc && LeanMfvApp.state.doc.steps.length === 4);
  await p.selectOption("#mfv-time-unit", "s");
  await p.fill("#demand-monthly", String(800 * 22));
  await p.fill("#work-days", "22");
  const st = await p.evaluate(() => LeanMfvApp.state.doc.steps.map((s) => [s.name, s.weighted, s.operatorTag, s.studyDemand].join("/")));
  check(st.join(" | ") === "Laminação/true/Op1/200 | Queijo/true/Op1/200 | Enrolar/true/Op1/200 | Moldagem/true/Op1 B/600", "etapas ponderadas com operador automático: " + st.join(" | "));
  const tcs = await p.evaluate(() => LeanMfvApp.state.computed.steps.map((s) => Math.round(s.tc * 60 * 100) / 100));
  check(tcs.join("|") === "1.25|0.75|3.25|15.75", "TC = TP × 200/800 (e 600/800 na Moldagem): " + tcs.join("|"));
  const warn = await txt("#steps-warnings");
  check(!warn.includes("Contagem dupla"), "etapas do mesmo estudo: sem contagem dupla");
  check(warn.includes("✔ Operador Op1: etapas 1, 2 e 3 • carga 5,25 s"), "carga do Op1 = Σ etapas do Enroladinho ponderadas");
  check((await txt("#kpi-ops")) === "2,00", "Op1 e Op1 B = 2 operadores distintos");
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT + "_mfv.png", fullPage: true });

  check(errors.length === 0, "nenhum erro no console" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(failures ? `${failures} FALHA(S)` : "TUDO OK");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
