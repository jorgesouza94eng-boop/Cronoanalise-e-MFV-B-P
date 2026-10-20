/**
 * Teste de ponta a ponta da REV 1.9 (Playwright): página Yamazumi (grupo Posto, gráfico por
 * classe e por elemento, comparação T1 × T3, Excel) e grupo Posto no MFV (regra confirmada).
 * Exemplo de conferência: Corte 30 s, Solda 52 s, Célula (Op.1 40 s + Op.2 28 s + espera 12 s),
 * Embalagem 18 s, takt 45 s.
 * Uso: npm start (outro terminal) e depois
 *   node tests/e2e.rev19.js http://127.0.0.1:8080/
 * Variável opcional: CHROMIUM_PATH=/caminho/do/chrome
 */
/* global LeanApp, LeanMfvApp, LeanYamazumiApp */ // existem apenas dentro das páginas testadas
const { chromium } = require("playwright");
const C = require("../js/calc.js");

const base = process.argv[2] || "http://127.0.0.1:8080/";
let failures = 0;
const check = (cond, msg) => { console.log((cond ? "  OK  " : "  FALHA ") + msg); if (!cond) failures++; };

/** Estudo sintético da "Empresa Teste" (takt 45 s: 480 min ÷ 640 pç). */
function study(processName, elements) {
  const s = C.createStudy({ clientName: "Empresa Teste", processName });
  s.shiftParams = { shiftTimeMin: 480, plannedStopsMin: 0, dailyDemandPcs: 640, tolerancePct: 0 };
  let clock = 0;
  s.elements = elements.map(([description, sec, value, waste]) => {
    clock += sec;
    return C.createElement({ description, videoTime: String(clock), value: value || "AG", waste: waste || "" });
  });
  return s;
}
const STUDIES = [
  study("Corte", [["Cortar", 30]]),
  study("Solda", [["Soldar", 52]]),
  study("Célula Op.1", [["Montar", 30], ["Buscar peça", 10, "NA", "movimentacao"]]),
  study("Célula Op.2", [["Parafusar", 28], ["Aguardando Op.1", 12, "NA", "espera"]]),
  study("Embalagem", [["Embalar", 18]]),
];

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const p = await (await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true })).newPage();
  const errors = [];
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  p.on("dialog", (d) => d.accept());
  const txt = async (sel) => (await p.textContent(sel)).trim();
  console.log(`== REV 1.9 ${base}`);

  // ---- Estudos de cronoanálise
  await p.goto(base + "index.html");
  await p.waitForSelector("#study-dialog[open]");
  check(await p.$$eval(".app-nav a", (a) => a.some((x) => x.getAttribute("href") === "yamazumi.html")), "menu com o módulo Yamazumi");
  for (const st of STUDIES) {
    if (!(await p.$("#study-dialog[open]"))) { await p.click("#btn-studies"); await p.waitForSelector("#study-dialog[open]"); }
    await p.setInputFiles("#input-import-json", { name: "e.json", mimeType: "application/json", buffer: Buffer.from(C.serializeStudy(st)) });
    await p.waitForFunction((n) => window.LeanApp && LeanApp.state.study && LeanApp.state.study.processName === n, st.processName);
    await p.evaluate(() => LeanApp.flushSave());
  }

  // ---- 1. Novo grupo Posto (T1)
  await p.goto(base + "yamazumi.html");
  await p.waitForSelector("#doc-dialog[open]");
  check(await p.$$eval("#client-list option", (o) => o.some((x) => x.value === "Empresa Teste")), "Novo grupo sugere as empresas dos estudos");
  await p.fill("#new-client", "empresa  teste");
  await p.dispatchEvent("#new-client", "input");
  check(await p.$$eval("#new-doc-study-list label", (l) => l.length) === 5, "lista os 5 estudos da empresa");
  await p.fill("#new-name", "Célula");
  await p.check("#new-doc-study-list label:has-text('Célula Op.1') input");
  await p.check("#new-doc-study-list label:has-text('Célula Op.2') input");
  await p.click("#new-doc-form button[type=submit]");
  await p.waitForFunction(() => LeanYamazumiApp.state.doc && LeanYamazumiApp.state.doc.name === "Célula");
  check(await p.evaluate(() => LeanYamazumiApp.state.doc.clientName) === "Empresa Teste", "empresa gravada com a grafia dos estudos");
  check(await p.inputValue("#grp-takt") === "45,0", "takt pré-preenchido com o do 1º estudo (45 s)");
  check(await txt("#kpi-cycle") === "40,0", "ciclo do posto = maior TP = 40 s");
  check(await txt("#kpi-content") === "68,0", "conteúdo = 40 + (40 − 12 de espera) = 68 s");
  check(await txt("#kpi-balance") === "85,0", "balanceamento = 68 ÷ (2 × 40) = 85%");
  check((await txt("#kpi-ops-ideal")).includes("1,51"), "operadores ideais = 68 ÷ 45 = 1,51");
  check(await txt("#ft-wait") === "12,0", "espera do grupo = 12 s");
  check(await p.$$eval("#yz-chart .yz-stack", (s) => s.length) === 2, "gráfico com 2 barras");
  const legend = await txt("#yz-legend");
  check(legend.includes("Agrega") && legend.includes("Não agrega") && legend.includes("Espera"), "legenda por classe: " + legend);
  check((await p.getAttribute("#kpi-cycle-card", "class")).includes("is-balanced"), "ciclo dentro do takt");
  await p.selectOption("#grp-chart-mode", "elemento");
  check(await p.$$eval("#yz-chart .yz-seg", (s) => s.length) === 4, "por elemento: 4 segmentos (2 + 2)");
  await p.fill("#grp-takt", "35");
  check((await p.getAttribute("#kpi-cycle-card", "class")).includes("is-bottleneck"), "takt digitado 35 s: ciclo acima do takt");
  await p.fill("#grp-takt", "45");
  await p.evaluate(() => LeanYamazumiApp.flushSave());
  const t1Id = await p.evaluate(() => LeanYamazumiApp.state.doc.id);

  // ---- 2. Grupo T3 e comparação T1 × T3
  await p.click("#btn-docs");
  await p.waitForSelector("#doc-dialog[open]");
  await p.fill("#new-client", "Empresa Teste");
  await p.dispatchEvent("#new-client", "input");
  await p.fill("#new-name", "Célula após kaizen");
  await p.selectOption("#new-situation", "T3");
  await p.check("#new-doc-study-list label:has-text('Célula Op.1') input");
  await p.click("#new-doc-form button[type=submit]");
  await p.waitForFunction(() => LeanYamazumiApp.state.doc.name === "Célula após kaizen");
  await p.selectOption("#grp-compare", t1Id);
  check(await p.isVisible("#compare-section"), "comparação T1 × T3 visível");
  const rows = await p.$$eval("#compare-tbody tr", (r) => r.map((x) => Array.from(x.children).map((c) => c.textContent.trim())));
  const row = (label) => rows.find((r) => r[0].startsWith(label)) || [];
  check(row("Ciclo")[4] === "= igual", "ciclo 40 → 40: igual");
  check(row("Nº de operadores")[3] === "-50,0%" && row("Nº de operadores")[4] === "✔ melhora", "operadores 2 → 1: −50% (melhora)");
  check(row("Balanceamento")[2] === "100,0%", "T3 com 1 operador: balanceamento 100%");
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#btn-export-xlsx")]);
  check(/^Yamazumi_Empresa_Teste_.+\.xlsx$/.test(dl.suggestedFilename()), "Excel exportado: " + dl.suggestedFilename());
  await p.evaluate(() => LeanYamazumiApp.flushSave());

  // ---- 3. Reabrir o T1 e enviar ao MFV
  await p.click("#btn-docs");
  await p.waitForSelector("#doc-dialog[open]");
  check(await p.$$eval("#doc-list .study-title", (t) => t.length) === 2, "2 grupos salvos");
  await p.click(`#doc-list li[data-id="${t1Id}"] .study-item`);
  await p.waitForFunction((id) => LeanYamazumiApp.state.doc.id === id, t1Id);
  await p.click("#btn-to-mfv");
  await p.waitForURL(/mfv\.html/);
  await p.waitForSelector("#doc-dialog[open]");
  check(await p.inputValue("#new-client") === "Empresa Teste", "→ MFV: empresa do grupo preenchida");
  for (const n of ["Corte", "Solda", "Embalagem"]) await p.check(`#new-doc-study-list label:has-text('${n}') input`);
  await p.fill("#new-family", "Produto teste");
  await p.click("#new-doc-form button[type=submit]");
  await p.waitForFunction(() => LeanMfvApp.state.doc && LeanMfvApp.state.doc.steps.length === 4);
  const step = await p.evaluate(() => LeanMfvApp.state.doc.steps.find((s) => s.groupId));
  check(step && step.source === "group" && step.operators === "2", "etapa do posto com origem no grupo e 2 operadores");
  check((await txt("#steps-tbody")).includes("Posto: Célula (2 estudo(s))"), "origem do TC: Posto: Célula");

  // Horário de 480 min/dia e demanda para takt de 45 s
  const days = await p.$$("#schedule-tbody tr");
  for (let i = 0; i < 5; i++) {
    const inputs = await days[i].$$("input");
    await inputs[2].fill("00:00");
    await inputs[3].fill("02:00");
  }
  await p.fill("#demand-monthly", String(640 * 22));
  await p.fill("#work-days", "22");
  await p.selectOption("#mfv-time-unit", "s");
  check(await txt("#kpi-takt") === "45,0", "takt do MFV = 45 s");
  check((await txt("#kpi-bottleneck-name")).includes("Solda"), "gargalo = Solda");
  check(await txt("#kpi-cap") === "553,8", "capacidade = 480 min ÷ 52 s = 553,8");
  check(await txt("#kpi-ops") === "5,00", "operadores atuais = 1 + 1 + 1 + 2 = 5");
  const ideal = await txt("#kpi-ops-ideal");
  check(ideal.includes("Σ conteúdo") && ideal.includes("3,73") && ideal.includes("64,6%"), "ideal = 168 ÷ 45 = 3,73 • balanceamento da linha 64,6%: " + ideal);
  check(await txt("#tc-total") === "140,0", "tempo de processamento = ΣTC com o ciclo do posto = 140 s");

  // TC do posto editado: conteúdo proporcional; depois, conteúdo digitado
  const groupRow = `#steps-tbody tr[data-id="${step.id}"]`;
  await p.fill(`${groupRow} [data-field="tc"]`, "36");
  check(await p.getAttribute(`${groupRow} [data-field="content"]`, "placeholder") === "61,2", "TC 36 s: conteúdo = 68 × 36 ÷ 40 = 61,2 s");
  check((await txt("#steps-tbody")).includes("✎ editado"), "etapa marcada como editada");
  await p.fill(`${groupRow} [data-field="content"]`, "60");
  check((await txt("#kpi-ops-ideal")).includes("3,56"), "conteúdo digitado 60 s: ideal = 160 ÷ 45 = 3,56");
  await p.click(`${groupRow} [data-action="use-study"]`);
  await p.fill(`${groupRow} [data-field="content"]`, "");
  check((await txt("#kpi-ops-ideal")).includes("3,73"), "↺ usar grupo: volta ao ciclo e ao conteúdo do grupo");

  // Recarregar mantém a etapa do grupo
  await p.evaluate(() => LeanMfvApp.flushSave());
  await p.reload();
  await p.waitForFunction(() => window.LeanMfvApp && LeanMfvApp.state.doc && LeanMfvApp.state.doc.steps.length === 4);
  check(await p.evaluate(() => LeanMfvApp.state.doc.steps.some((s) => s.source === "group" && s.contentGroupMin > 1.13 && s.contentGroupMin < 1.14)), "recarregado: etapa de grupo com conteúdo 68 s");
  const opts = await p.$$eval("#study-picker optgroup", (g) => g.map((x) => x.label));
  check(opts.includes("Grupos do Yamazumi"), "seletor de etapas lista os grupos do Yamazumi");

  check(errors.length === 0, "nenhum erro no console" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(failures ? `${failures} FALHA(S)` : "TUDO OK");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
