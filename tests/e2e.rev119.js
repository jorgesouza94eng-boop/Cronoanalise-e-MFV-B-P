/**
 * Teste de ponta a ponta da REV 1.19 (Playwright): Plano de Ação 5W2H. As ações Kaizen digitadas
 * na cronoanálise viram ações do plano (Pareto pelo % do ciclo), o status sai do % e das datas,
 * o Excel simples é exportado e o MFV do mesmo cliente mostra o Σ Quanto só como referência.
 * Dados fictícios.
 * Uso: npm start (outro terminal) e depois
 *   node tests/e2e.rev119.js http://127.0.0.1:8080/
 * Variável opcional: CHROMIUM_PATH=/caminho/do/chrome
 */
/* global LeanPlanoApp, LeanMfvApp */ // existem apenas dentro da página testada
const { chromium } = require("playwright");
const C = require("../js/calc.js");

const base = process.argv[2] || "http://127.0.0.1:8080/";
let failures = 0;
const check = (cond, msg) => { console.log((cond ? "  OK  " : "  FALHA ") + msg); if (!cond) failures++; };

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errors = [];
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  p.on("dialog", (d) => d.accept());
  const txt = async (sel) => (await p.textContent(sel)).trim();
  console.log(`== REV 1.19 ${base}`);

  // Estudo com 2 ações Kaizen (uma repetida em 2 linhas = 1 ação)
  const s = C.createStudy({ clientName: "Plano Teste", processName: "Bancada" });
  s.shiftParams = { shiftTimeMin: 480, plannedStopsMin: 0, dailyDemandPcs: 200, tolerancePct: 0 };
  s.elements = [
    ["Abrir a massa", "C", "10", "40", "Simplificar: usar gabarito"],
    ["Buscar bandeja", "A", "1", "100", "Eliminar: bandejas no posto"],
    ["Enrolar", "C", "10", "220", ""],
    ["Buscar bandeja", "A", "1", "250", "Eliminar: bandejas no posto"], // 20 + 30 s ÷ 10 = 5 s/pç de 17
  ].map(([description, type, quantity, videoTime, kaizen]) => C.createElement({ description, type, quantity, videoTime, kaizen }));
  s.filmPieces = { inicio: "10" };
  await p.goto(base + "index.html");
  await p.waitForSelector("#study-dialog[open]");
  await p.setInputFiles("#input-import-json", { name: "s.json", mimeType: "application/json", buffer: Buffer.from(C.serializeStudy(s)) });
  await p.waitForFunction(() => window.LeanApp && window.LeanApp.state.study && window.LeanApp.state.study.processName === "Bancada");
  check((await p.$$eval(".app-nav a", (as) => as.map((a) => a.textContent))).includes("Plano de Ação"), "menu com o módulo Plano de Ação");

  // Novo plano
  await p.goto(base + "plano.html");
  await p.waitForSelector("#doc-dialog[open]");
  check(/^REV 1\.(19|[2-9]\d)$/.test(await txt(".app-header .app-rev")), "rótulo da revisão REV 1.19");
  check(await p.$eval("#client-list", (d) => Array.from(d.options).some((o) => o.value === "Plano Teste")), "empresa dos estudos sugerida");
  await p.fill("#new-client", "plano teste");
  await p.click("#new-doc-form button[type=submit]");
  await p.waitForFunction(() => LeanPlanoApp.state.doc);
  check(await p.evaluate(() => LeanPlanoApp.state.doc.clientName) === "Plano Teste", "mesma grafia do cliente dos estudos");
  check(await p.inputValue("#pl-objective") === "Aumentar a produtividade (pç/HH) em 20%", "objetivo padrão do B+P");

  // Ações da cronoanálise
  await p.click("#btn-from-crono");
  await p.waitForSelector("#crono-dialog[open]");
  const items = await p.$$eval("#crono-list li strong", (els) => els.map((e) => e.textContent));
  check(items.length === 2 && items[0] === "Eliminar — Buscar bandeja", "2 ações, a de maior % do ciclo primeiro: " + items.join(" | "));
  await p.click("#btn-crono-all");
  await p.click("#btn-crono-add");
  const acts = () => p.evaluate(() => LeanPlanoApp.state.doc.actions.map((a) => [a.priority, a.what, a.ecrs].join("/")));
  check((await acts()).join(" | ") === "1/Eliminar — Buscar bandeja/eliminar | 2/Simplificar — Abrir a massa/simplificar", "ações criadas: " + (await acts()).join(" | "));
  check(/29,4% do ciclo/.test(await p.inputValue("#actions-tbody tr:nth-child(1) [data-field='why']")), "Por que com o % do ciclo");
  await p.click("#btn-from-crono");
  await p.waitForSelector("#crono-dialog[open]");
  check(await p.$$eval("#crono-list input:disabled", (x) => x.length) === 2, "ações já no plano ficam desabilitadas");
  await p.click("#btn-close-crono");

  // Quem / Quando / Quanto / %
  const row = (i, f) => `#actions-tbody tr:nth-child(${i}) [data-field='${f}']`;
  await p.fill(row(1, "who"), "Líder da bancada");
  await p.fill(row(1, "end"), "2020-01-31");
  await p.fill(row(1, "cost"), "150,00");
  await p.fill(row(2, "pct"), "100");
  await p.fill(row(2, "cost"), "1.000,50");
  check(await txt("#actions-tbody tr:nth-child(1) .pl-status") === "Atrasada", "prazo vencido = Atrasada");
  check(await txt("#actions-tbody tr:nth-child(2) .pl-status") === "Concluída", "100% = Concluída");
  check(await txt("#kpi-late") === "1" && (await txt("#kpi-done")) === "1", "KPIs: 1 atrasada, 1 concluída");
  check((await txt("#kpi-cost")).replace(/\s/g, " ") === "R$ 1.150,50", "Σ Quanto: " + (await txt("#kpi-cost")));
  check(await txt("#kpi-pct") === "50,0", "% médio 50,0");
  await p.selectOption("#flt-status", "atrasada");
  check(await p.$$eval("#actions-tbody tr[data-id]", (trs) => trs.filter((t) => !t.hidden).length) === 1, "filtro por status");
  await p.selectOption("#flt-status", "");

  // Origem alterada na cronoanálise → aviso
  await p.evaluate(async () => {
    LeanPlanoApp.state.candidatesByStudy.forEach((list) => list.splice(0, list.length));
    LeanPlanoApp.state.doc.updatedAt = new Date().toISOString();
  });
  await p.fill(row(1, "who"), "Líder da bancada ");
  check((await txt("#pl-warnings")).includes("a ação ou o elemento mudou na cronoanálise"), "aviso quando a ação sai da cronoanálise");

  // Excel simples (sem modelo) e JSON
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#btn-export-xlsx")]);
  check(/^Plano_Plano_Teste_.+\.xlsx$/.test(dl.suggestedFilename()), "Excel simples: " + dl.suggestedFilename());
  await p.evaluate(() => LeanPlanoApp.flushSave());

  // MFV do mesmo cliente: Σ Quanto como referência (não somado ao investimento)
  await p.goto(base + "mfv.html");
  await p.waitForSelector("#doc-dialog[open]");
  await p.fill("#new-client", "Plano Teste");
  await p.fill("#new-family", "Salgados");
  await p.click("#new-doc-form button[type=submit]");
  await p.waitForFunction(() => window.LeanMfvApp && LeanMfvApp.state.doc);
  await p.waitForFunction(() => !document.getElementById("pb-plan-ref").hidden);
  const ref = (await txt("#pb-plan-ref")).replace(/\s/g, " ");
  check(ref.includes("Σ Quanto R$ 1.150,50 (2 de 2 ações com Quanto)") && ref.includes("Não é somado"), "referência do plano no payback: " + ref);
  check(await p.inputValue("#pb-investment") === "", "investimento do cliente não é preenchido sozinho");

  check(errors.length === 0, "nenhum erro no console" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(failures ? `${failures} FALHA(S)` : "TUDO OK");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
