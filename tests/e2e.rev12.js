/**
 * Teste de ponta a ponta da REV 1.2 (Playwright): peças por filmagem na cronoanálise,
 * produtividade real (pç/HH) e payback no MFV.
 * Uso: npm start (outro terminal) e depois
 *   node tests/e2e.rev12.js http://127.0.0.1:8080/
 * Variável opcional: CHROMIUM_PATH=/caminho/do/chrome
 */
/* global LeanApp, LeanMfvApp */ // existem apenas dentro das páginas testadas
const { chromium } = require("playwright");
const C = require("../js/calc.js");

const base = process.argv[2] || "http://127.0.0.1:8080/";
let failures = 0;
const check = (cond, msg) => { console.log((cond ? "  OK  " : "  FALHA ") + msg); if (!cond) failures++; };

/** Estudo com 2 filmagens: cíclico 10 s/un e acíclicos de 30 s (F1) e 20 s (F2). */
function studyJson() {
  const s = C.createStudy({ clientName: "Metal Beta", processName: "Furação" });
  s.elements = [
    C.createElement({ description: "Furar peça", type: "C", quantity: "1", videoTime: "10" }),
    C.createElement({ description: "Trocar broca", type: "A", videoTime: "40" }),
    C.createElement({ description: "Furar peça", type: "C", quantity: "1", videoTime: "10", newVideo: true }),
    C.createElement({ description: "Limpar cavaco", type: "A", videoTime: "30" }),
  ];
  return Buffer.from(C.serializeStudy(s));
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const p = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  const errors = [];
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  p.on("dialog", (d) => d.accept());
  const txt = async (sel) => (await p.textContent(sel)).trim();
  console.log(`== REV 1.2 ${base}`);

  // ---- Cronoanálise: peças por filmagem
  await p.goto(base + "index.html");
  await p.waitForSelector("#study-dialog[open]");
  await p.setInputFiles("#input-import-json", { name: "estudo.json", mimeType: "application/json", buffer: studyJson() });
  await p.waitForFunction(() => window.LeanApp && LeanApp.state.study && LeanApp.state.study.processName === "Furação");
  await p.evaluate(() => { const d = document.getElementById("study-dialog"); if (d.open) d.close(); });

  check(await p.isVisible("#films-panel"), "painel de peças por filmagem visível (modo quantidade)");
  check(await p.$$eval("#films-list .film-box", (b) => b.length) === 2, "um campo por filmagem (F1 e F2)");
  check(await txt("#summary-total") === "60,0", "sem peças: ciclo = 60 s (acíclicos como tempo total)");
  await p.fill("#films-list .film-box:nth-child(1) .film-pieces", "5");
  check((await txt("#films-hint")).includes("Faltam peças"), "peças incompletas: aviso");
  await p.fill("#films-list .film-box:nth-child(2) .film-pieces", "5");
  check(await txt("#summary-total") === "15,0", "com peças: ciclo = 10 + 30/10 + 20/10 = 15 s");
  check((await txt("#films-hint")).includes("7,0 s/un"), "ciclo real observado = 70 s ÷ 10 = 7 s/un");
  check(await p.evaluate(() => document.activeElement.classList.contains("film-pieces")), "foco preservado durante a digitação");
  await p.evaluate(() => LeanApp.flushSave());
  await p.reload();
  await p.waitForFunction(() => window.LeanApp && LeanApp.state.study);
  check(await p.inputValue("#films-list .film-box:nth-child(2) .film-pieces") === "5" && (await txt("#summary-total")) === "15,0", "peças preservadas após recarregar");

  // ---- MFV: produtividade real (pç/HH) e payback
  await p.goto(base + "mfv.html");
  await p.waitForSelector("#doc-dialog[open]");
  await p.fill("#new-client", "Metal Beta"); await p.fill("#new-family", "Flanges");
  await p.click("#new-doc-form button[type=submit]");
  await p.waitForFunction(() => window.LeanMfvApp && LeanMfvApp.state.doc && LeanMfvApp.state.doc.family === "Flanges");
  await p.evaluate(() => { const d = document.getElementById("doc-dialog"); if (d.open) d.close(); });

  const day = async (btn, pieces, ops, hours) => {
    await p.click(btn);
    await p.keyboard.type(pieces);
    const tr = "#prod-tbody tr[data-id]:last-child";
    await p.fill(`${tr} [data-field=operators]`, ops);
    await p.fill(`${tr} [data-field=hours]`, hours);
  };
  await day("#btn-add-prod-base", "100", "2", "8");
  await day("#btn-add-prod-base", "120", "2", "8");
  check(await txt("#prod-tbody tr:nth-child(1) [data-out=pcHH]") === "6,250", "pç/HH do dia = 100 ÷ (2 × 8) = 6,250");
  check(await txt("#kpi-prod-base") === "6,875", "linha de base = 220 ÷ 32 HH = 6,875");
  check((await txt("#kpi-gain-cap")).includes("8,250"), "meta indicada: 6,875 × 1,2 = 8,250 pç/HH");
  await p.fill("#prod-projected", "8");
  check(await txt("#kpi-prod-acomp-title") === "Projetado (estimativa)" && (await txt("#kpi-gain")) === "+16,4%", "projetado: +16,4% (estimativa)");
  check(await p.$eval("#kpi-gain-card", (c) => c.classList.contains("is-warning")), "abaixo da meta: semáforo amarelo");
  await day("#btn-add-prod-acomp", "150", "2", "8");
  check(await p.inputValue("#prod-tbody tr:nth-child(3) [data-field=operators]") === "2", "novo dia repete operadores e horas");
  await p.fill("#prod-tbody tr:nth-child(3) [data-field=operators]", "2");
  await day("#btn-add-prod-acomp", "140", "2", "8");
  check(await txt("#kpi-prod-acomp") === "9,063" && (await txt("#kpi-gain")) === "+31,8%", "acompanhamento real: 9,063 pç/HH, +31,8%");
  check(await p.$eval("#kpi-gain-card", (c) => c.classList.contains("is-balanced")), "meta atingida: semáforo verde");

  await p.fill("#pb-investment", "20000");
  await p.fill("#pb-hh-cost", "30");
  await p.fill("#pb-monthly-prod", "5000");
  await p.fill("#pb-other", "500");
  const saved = 5000 * (32 / 220 - 32 / 290);
  const months = 20000 / (saved * 30 + 500);
  check(await txt("#kpi-hh-saved") === C.formatNumber(saved, 1), `HH economizadas = ${C.formatNumber(saved, 1)}/mês`);
  check(await txt("#kpi-payback") === C.formatNumber(months, 1), `payback = ${C.formatNumber(months, 1)} meses`);

  await p.evaluate(() => LeanMfvApp.flushSave());
  await p.reload();
  await p.waitForFunction(() => window.LeanMfvApp && LeanMfvApp.state.doc);
  check(await p.$$eval("#prod-tbody tr[data-id]", (r) => r.length) === 4 && (await txt("#kpi-payback")) === C.formatNumber(months, 1), "pç/HH e payback preservados após recarregar");
  await p.click("#prod-tbody tr:nth-child(4) [data-action=remove]");
  check(await txt("#kpi-prod-acomp") === "9,375", "remover dia recalcula o acompanhamento");

  // Celular: sem rolagem horizontal da página
  await p.setViewportSize({ width: 390, height: 844 });
  check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "celular: página sem rolagem horizontal");

  check(errors.length === 0, "nenhum erro no console" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(failures ? `${failures} FALHA(S)` : "TUDO OK");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
