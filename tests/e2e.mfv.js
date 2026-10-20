/**
 * Teste de ponta a ponta do MFV no navegador (Playwright).
 * Uso: npm start (outro terminal) e depois
 *   node tests/e2e.mfv.js http://127.0.0.1:8080/
 * Variável opcional: CHROMIUM_PATH=/caminho/do/chrome
 */
/* global LeanApp, LeanMfvApp */ // existem apenas dentro das páginas testadas
const { chromium } = require("playwright");

const base = process.argv[2] || "http://127.0.0.1:8080/";
let failures = 0;
const check = (cond, msg) => { console.log((cond ? "  OK  " : "  FALHA ") + msg); if (!cond) failures++; };

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const p = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  const errors = [];
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  p.on("dialog", (d) => d.accept());
  const txt = async (sel) => (await p.textContent(sel)).trim();
  console.log(`== MFV ${base}`);

  // 3 estudos de cronoanálise do mesmo cliente
  await p.goto(base + "index.html");
  await p.waitForSelector("#study-dialog[open]");
  for (const [proc, rows] of [["Corte", [["Cortar", "30"], ["Mover", "45"]]], ["Solda", [["Soldar", "1:10"]]], ["Montagem", [["Montar", "50"]]]]) {
    if (!(await p.$("#study-dialog[open]"))) { await p.click("#btn-studies"); await p.waitForSelector("#study-dialog[open]"); }
    await p.fill("#new-client", "Metal Alfa"); await p.fill("#new-process", proc);
    await p.click("#new-study-form button[type=submit]");
    await p.waitForFunction((pr) => LeanApp.state.study.processName === pr, proc);
    for (const [d, t] of rows) { await p.keyboard.type(d); await p.keyboard.press("Enter"); await p.keyboard.type(t); await p.keyboard.press("Enter"); await p.keyboard.press("Enter"); }
    await p.evaluate(() => LeanApp.flushSave());
  }

  // Navega para o MFV e cria o documento
  await p.click(".app-nav a[href='mfv.html']");
  await p.waitForSelector("#doc-dialog[open]");
  check(true, "link Cronoanálise → MFV abre o gerenciador de MFVs");
  await p.fill("#new-client", "Metal Alfa"); await p.fill("#new-family", "Suportes");
  await p.click("#new-doc-form button[type=submit]");
  await p.waitForFunction(() => LeanMfvApp.state.doc);
  const options = await p.$$eval("#study-picker option", (o) => o.map((x) => x.value).filter(Boolean));
  check(options.length === 3, "lista os 3 estudos do cliente");
  for (const v of options) { await p.selectOption("#study-picker", v); await p.click("#btn-add-study-step"); }
  check(await p.$$eval("#steps-tbody tr[data-id]", (r) => r.length) === 3, "3 etapas vinculadas aos estudos");

  await p.fill("#demand-monthly", "8800"); await p.fill("#work-days", "22");
  await p.check("#steps-tbody tr:nth-child(2) input[type=radio]");
  await p.fill("#steps-tbody tr:nth-child(1) [data-field=operators]", "2");
  check(await txt("#kpi-avail") === "520,0", "tempo disponível = 520 min/dia (horário padrão)");
  check(await txt("#kpi-takt") === "1,300", "takt = 520 ÷ 400 = 1,300 min");
  check(await txt("#tc-total") === "2,750", "ΣTC = 0,750 + 0,833 + 1,167");
  check((await txt("#kpi-bottleneck-name")).includes("Solda"), "gargalo = Solda");
  check((await txt("#kpi-ops-ideal")).includes("ΣTC ÷ takt): 2,12 •"), "operadores ideais = 2,12");
  check(await txt("#kpi-cap") === "445,7", "capacidade = 520 ÷ 1,167 = 445,7/dia");
  check(await txt("#kpi-prod") === "12,86", "produtividade = 12,86 pç/h/op");
  check((await txt("#kpi-kaizen-detail")).startsWith("Montagem"), "processo Kaizen = Montagem");
  check(await p.$$eval(".gbo-bar", (b) => b.length) === 3 && !!(await p.$(".gbo-takt")), "gráfico GBO com 3 barras e linha do takt");

  // TC vinculado é editável e pode voltar ao estudo
  await p.fill("#steps-tbody tr:nth-child(3) [data-field=tc]", "1,5");
  check((await txt("#steps-tbody tr:nth-child(3) .origin-cell")).includes("editado"), "TC editado: origem marcada como editada");
  check((await txt("#kpi-bottleneck-tc")) === "1,500", "gargalo recalculado com o TC editado");
  check(await p.$eval("#steps-tbody tr:nth-child(3)", (tr) => tr.classList.contains("row-over-takt")), "etapa acima do takt destacada");
  await p.click("#steps-tbody tr:nth-child(3) [data-action=use-study]");
  check(await p.inputValue("#steps-tbody tr:nth-child(3) [data-field=tc]") === "1,167", "↺ usar estudo restaura o TC do estudo");

  // Unidade de tempo e atravessamento
  await p.selectOption("#mfv-time-unit", "s");
  check(await txt("#kpi-takt") === "78,0" && (await txt("#kpi-takt-unit")) === "s/pç", "unidade em segundos: takt = 78,0 s/pç");
  await p.fill("#inventory-tbody tr:nth-child(1) [data-field=quantity]", "800");
  check(await txt("#lead-time") === "2,00 dias", "atravessamento = 800 ÷ 400 = 2 dias");

  // Persistência
  await p.evaluate(() => LeanMfvApp.flushSave());
  await p.reload();
  await p.waitForFunction(() => window.LeanMfvApp && LeanMfvApp.state.doc);
  check(await p.$$eval("#steps-tbody tr[data-id]", (r) => r.length) === 3 && (await p.inputValue("#demand-monthly")) === "8800", "MFV preservado após recarregar");

  // Exportar JSON
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#btn-export-mfv")]);
  check(/^MFV_Metal_Alfa_Suportes_.+\.json$/.test(dl.suggestedFilename()), "Exportar JSON: " + dl.suggestedFilename());

  // Volta para a cronoanálise: estudos intactos
  await p.click(".app-nav a[href='index.html']");
  await p.waitForFunction(() => window.LeanApp && LeanApp.state.study);
  check(await p.evaluate(() => LeanApp.state.study.clientName) === "Metal Alfa", "cronoanálise reabre o último estudo normalmente");

  check(errors.length === 0, "nenhum erro no console" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(failures ? `${failures} FALHA(S)` : "TUDO OK");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
