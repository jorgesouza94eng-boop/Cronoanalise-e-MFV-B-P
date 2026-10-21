/**
 * Teste de ponta a ponta da REV 1.11 (Playwright): conferência dos vínculos do MFV —
 * ordem das etapas pela marcação, contagem dupla (Mix + produto), mix sem demanda por
 * produto, avisos do estudo na etapa e demanda da família.
 * Uso: npm start (outro terminal) e depois
 *   node tests/e2e.rev111.js http://127.0.0.1:8080/
 * Variável opcional: CHROMIUM_PATH=/caminho/do/chrome
 */
/* global LeanApp, LeanMfvApp */ // existem apenas dentro das páginas testadas
const { chromium } = require("playwright");
const C = require("../js/calc.js");

const base = process.argv[2] || "http://127.0.0.1:8080/";
let failures = 0;
const check = (cond, msg) => { console.log((cond ? "  OK  " : "  FALHA ") + msg); if (!cond) failures++; };

function study(processName, elements, extra) {
  const s = C.createStudy({ clientName: "Empresa Teste", processName });
  s.shiftParams = { shiftTimeMin: 480, plannedStopsMin: 0, dailyDemandPcs: 640, tolerancePct: 0 };
  s.elements = elements.map((e) => C.createElement(Object.assign({ value: "AG" }, e)));
  return Object.assign(s, extra || {});
}
const STUDIES = [
  study("Corte", [{ description: "Cortar", videoTime: "30" }]),
  study("Solda", [{ description: "Soldar", videoTime: "52" }, { description: "Buscar arame", type: "A", videoTime: "1:10" }]),
  study("Forno", [{ product: "Pão", description: "Moldar", videoTime: "10" }, { product: "Rosca", description: "Rechear", videoTime: "40" }]),
];

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const p = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  const errors = [];
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  const dialogs = [];
  let answer = true;
  p.on("dialog", (d) => { dialogs.push(d.message()); answer ? d.accept() : d.dismiss(); });
  const txt = async (sel) => (await p.textContent(sel)).trim();
  console.log(`== REV 1.11 ${base}`);

  await p.goto(base + "index.html");
  await p.waitForSelector("#study-dialog[open]");
  for (const st of STUDIES) {
    if (!(await p.$("#study-dialog[open]"))) { await p.click("#btn-studies"); await p.waitForSelector("#study-dialog[open]"); }
    await p.setInputFiles("#input-import-json", { name: "e.json", mimeType: "application/json", buffer: Buffer.from(C.serializeStudy(st)) });
    await p.waitForFunction((n) => window.LeanApp && LeanApp.state.study && LeanApp.state.study.processName === n, st.processName);
    await p.evaluate(() => LeanApp.flushSave());
  }

  // ---- Novo MFV: ordem de marcação e aviso de Mix + produto
  await p.goto(base + "mfv.html");
  await p.waitForSelector("#doc-dialog[open]");
  await p.fill("#new-client", "Empresa Teste");
  await p.dispatchEvent("#new-client", "input");
  const lbl = (t) => `#new-doc-study-list label:has-text('${t}')`;
  await p.check(`${lbl("Solda")} input`);
  await p.check(`${lbl("Corte")} input`);
  check(await txt(`${lbl("Solda")} .study-check-order`) === "1º" && (await txt(`${lbl("Corte")} .study-check-order`)) === "2º", "nº de ordem pela marcação: Solda 1º, Corte 2º");
  check(await p.isVisible(`${lbl("Solda")} .study-check-warn`), "⚠ no estudo com acíclico sem peças");
  await p.check(`${lbl("Mix (TC ponderado)")} input`);
  await p.check(`${lbl("Forno • Pão")} input`);
  check(await p.isVisible("#new-doc-warning") && (await txt("#new-doc-warning")).includes("Mix e produto"), "aviso: Mix e produto do mesmo estudo marcados");
  await p.uncheck(`${lbl("Forno • Pão")} input`);
  check(!(await p.isVisible("#new-doc-warning")), "aviso some ao desmarcar o produto");
  await p.uncheck(`${lbl("Corte")} input`);
  await p.check(`${lbl("Corte")} input`);
  check(await txt(`${lbl("Corte")} .study-check-order`) === "3º", "desmarcar e marcar de novo põe no fim: Corte 3º");
  await p.fill("#new-family", "Família teste");
  await p.click("#new-doc-form button[type=submit]");
  await p.waitForFunction(() => LeanMfvApp.state.doc && LeanMfvApp.state.doc.steps.length === 3);
  const names = await p.evaluate(() => LeanMfvApp.state.doc.steps.map((s) => s.name));
  check(names[0] === "Solda" && names[1].startsWith("Forno • Mix") && names[2] === "Corte", "etapas na ordem de marcação: " + names.join(" | "));
  check(dialogs.length === 0, "sem contagem dupla: cria sem pedir confirmação");

  // ---- Avisos das etapas
  const warn = await txt("#steps-warnings");
  check(warn.includes("1. Solda") && warn.includes("tipo A"), "etapa 1 (Solda): aviso de acíclico sem peças");
  check(warn.includes("2. Forno • Mix") && warn.includes("pesos iguais"), "etapa 2 (Mix): aviso de pesos iguais");
  check(!warn.includes("Demanda diária do MFV"), "sem demanda no MFV: nenhum aviso de demanda");
  await p.fill("#demand-monthly", String(640 * 22));
  await p.fill("#work-days", "22");
  const warn2 = await txt("#steps-warnings");
  check(warn2.includes("Demanda diária do MFV (640,0/dia)") && warn2.includes("2. Forno • Mix (TC ponderado) (1.280,0/dia)") && !warn2.includes("1. Solda (") , "demanda: só o Mix (1.280/dia) difere dos 640/dia do MFV");

  // ---- Seletor: incluir o produto do mesmo estudo pede confirmação
  const pao = await p.$eval("#study-picker", (s) => Array.from(s.options).find((o) => o.textContent.startsWith("Forno • Pão")).value);
  await p.selectOption("#study-picker", pao);
  answer = false;
  await p.click("#btn-add-study-step");
  check(dialogs.length === 1 && dialogs[0].includes("Mix e produto"), "seletor: confirmação ao incluir produto do estudo já no Mix");
  check(await p.evaluate(() => LeanMfvApp.state.doc.steps.length) === 3, "cancelado: etapa não incluída");
  answer = true;
  await p.click("#btn-add-study-step");
  check(await p.evaluate(() => LeanMfvApp.state.doc.steps.length) === 4, "confirmado: etapa incluída");
  check((await txt("#steps-warnings")).includes("Contagem dupla"), "aviso de contagem dupla na lista de etapas");

  check(errors.length === 0, "nenhum erro no console" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(failures ? `${failures} FALHA(S)` : "TUDO OK");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
