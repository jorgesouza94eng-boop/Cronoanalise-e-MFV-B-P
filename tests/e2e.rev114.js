/**
 * Teste de ponta a ponta da REV 1.14 (Playwright): vários operadores no mesmo estudo (etiqueta no
 * nº da linha, Alt+1…Alt+9, menu da etiqueta, seletor e filtro, indicadores do posto), avisos de
 * consistência, MFV tipo POSTO e LINHA e Yamazumi com N barras.
 * Dados fictícios do T1: 480 min, 1.800/dia (takt 16 s), tolerância 0%, 10 peças.
 * Uso: npm start (outro terminal) e depois
 *   node tests/e2e.rev114.js http://127.0.0.1:8080/
 * Variável opcional: CHROMIUM_PATH=/caminho/do/chrome
 */
/* global LeanApp, LeanMfvApp, LeanYamazumiApp */ // existem apenas dentro das páginas testadas
const { chromium } = require("playwright");
const C = require("../js/calc.js");

const base = process.argv[2] || "http://127.0.0.1:8080/";
let failures = 0;
const check = (cond, msg) => { console.log((cond ? "  OK  " : "  FALHA ") + msg); if (!cond) failures++; };

function bancada() {
  const s = C.createStudy({ clientName: "Empresa Teste", processName: "Bancada" });
  s.shiftParams = { shiftTimeMin: 480, plannedStopsMin: 0, dailyDemandPcs: 1800, tolerancePct: 0 };
  s.elements = [
    [2, "Buscar material", "A", 1, "20", "IN"],
    [1, "Preparar", "A", 1, "30", "IN"],
    [2, "Embalar", "C", 10, "1:30", "AG"],
    [1, "Montar", "C", 10, "1:50", "AG"],
    [1, "Aguardando Op2", "A", 1, "2:00", "NA", "espera"],
    [2, "Aguardando Op1", "A", 1, "2:00", "NA", "espera"],
  ].map(([operador, description, type, quantity, videoTime, value, waste]) =>
    C.createElement({ operador, description, type, quantity: String(quantity), videoTime, value, waste: waste || "" })
  );
  s.filmPieces = { inicio: "10" };
  s.settings.numOperadores = 2;
  return s;
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const p = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  const errors = [];
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  p.on("dialog", (d) => d.accept(d.type() === "prompt" ? "Ana" : undefined));
  const txt = async (sel) => (await p.textContent(sel)).trim();
  console.log(`== REV 1.14 ${base}`);

  // ---- Cronoanálise
  await p.goto(base + "index.html");
  await p.waitForSelector("#study-dialog[open]");
  check(/^REV 1\.1[4-9]$/.test(await txt(".app-header .app-rev")), "rótulo da revisão (REV 1.14 ou posterior)");
  await p.setInputFiles("#input-import-json", { name: "e.json", mimeType: "application/json", buffer: Buffer.from(C.serializeStudy(bancada())) });
  await p.waitForFunction(() => window.LeanApp && LeanApp.state.study && LeanApp.state.study.processName === "Bancada");
  const tags = await p.$$eval("#chrono-tbody .op-tag", (t) => t.map((x) => (x.hidden ? "" : x.textContent)));
  check(tags.join(",") === "Op2,Op1,Op2,Op1,Op1,Op2", "etiqueta do operador no nº da linha: " + tags.join(","));
  check(await p.$$eval("#chrono-table thead th:not(#th-etapa)", (t) => t.length) === 13 && (await p.isHidden("#th-etapa")), "nenhuma coluna nova na grade (Etapa escondida sem a opção)");
  const tsub = await p.$$eval("#chrono-tbody [data-out='tsub']", (c) => c.map((x) => x.textContent.trim()));
  check(tsub.join("|") === "20,0|30,0|70,0|80,0|10,0|30,0", "tempo subtraído pelo mesmo operador: " + tsub.join("|"));
  check(await p.isVisible("#op-hint") && (await txt("#op-hint")).includes("a Qtd de cada um é a produção do posto"), "dica fixa da atividade em paralelo");
  check(await p.inputValue("#op-count") === "2" && (await p.isVisible("#op-kind")), "parâmetros Nº de operadores e Tipo");
  check(await txt("#kpi-cycle-time") === "12,0" && (await txt("#kpi-capacity")) === "2.400", "ciclo do posto 12 s e capacidade 2.400/dia");
  const normal = await txt("#kpi-normal-time");
  check(normal.includes("conteúdo 20,0") && normal.includes("83,3%") && normal.includes("ideais 1,25"), "posto: " + normal);
  check((await txt("#kpi-bottleneck")) === "BALANCEADO", "status pelo ciclo do posto");

  // Seletor do operador no resumo
  await p.selectOption("#summary-operator", "2");
  const names = await p.$$eval("#summary-tbody tr td:nth-child(2)", (c) => c.map((x) => x.textContent.trim()));
  check(names.join("|") === "Buscar material|Embalar|Aguardando Op1", "resumo do Op2: " + names.join("|"));
  await p.selectOption("#summary-operator", "0");
  check((await p.$$eval("#summary-tbody tr", (r) => r.length)) === 6 && (await txt("#summary-note")).includes("ciclo do posto"), "Todos = posto (6 elementos)");
  // Filtro por operador (só exibição)
  await p.selectOption("#flt-operator", "1");
  check(await p.$$eval("#chrono-tbody tr:not([hidden])", (r) => r.length) === 3, "filtro Op1: 3 linhas");
  check(await txt("#kpi-cycle-time") === "12,0", "filtro não muda os indicadores");
  await p.click("#btn-clear-filter");

  // Alt+2 troca o operador da linha; erro de leitura só no Op2 (T5)
  await p.click("#chrono-tbody tr:nth-child(2) [data-field='description']");
  await p.keyboard.press("Alt+2");
  check(await p.evaluate(() => LeanApp.state.study.elements[1].operador) === 2, "Alt+2: linha 2 passa para o Op2");
  const err = await p.evaluate(() => LeanApp.state.computed.rows.filter((x) => !x.valid).map((x) => x.operator + ":" + x.errors[0]));
  check(err.length === 0 || err.every((e) => e.startsWith("2:")), "erros só no Op2: " + err.join(" | "));
  await p.keyboard.press("Alt+1");
  check(await p.evaluate(() => LeanApp.state.study.elements[1].operador) === 1, "Alt+1: volta para o Op1");

  // Menu da etiqueta: dar nome e operador novo
  await p.click("#chrono-tbody tr:nth-child(1) .op-tag");
  await p.click(".op-menu button:has-text('Dar nome ao Op2')");
  check(await p.evaluate(() => LeanApp.state.study.settings.nomesOperadores["2"]) === "Ana", "nome opcional do Op2");
  check((await p.$$eval("#summary-operator option", (o) => o.map((x) => x.textContent))).includes("Op2 (Ana)"), "seletor mostra o nome");

  // Aviso de linha do tempo (T4): Op2 termina antes da filmagem
  await p.fill("#chrono-tbody tr:nth-child(6) [data-field='videoTime']", "140");
  await p.press("#chrono-tbody tr:nth-child(6) [data-field='videoTime']", "Tab");
  check((await txt("#study-checks")).includes("Op2 termina em 01:40; a filmagem termina em 02:00"), "aviso: Op2 termina em 01:40");
  await p.fill("#chrono-tbody tr:nth-child(6) [data-field='videoTime']", "200");
  await p.press("#chrono-tbody tr:nth-child(6) [data-field='videoTime']", "Tab");

  // 10 operadores (T11): Alt+9 e o 10º pela etiqueta
  await p.fill("#op-count", "9");
  await p.dispatchEvent("#op-count", "change");
  await p.click("#chrono-tbody tr:nth-child(4) [data-field='description']");
  await p.keyboard.press("Alt+9");
  await p.click("#chrono-tbody tr:nth-child(5) .op-tag");
  await p.click(".op-menu button:has-text('+ Novo operador (Op10)')");
  check(await p.evaluate(() => [LeanApp.state.study.elements[3].operador, LeanApp.state.study.elements[4].operador, LeanApp.state.study.settings.numOperadores].join(",")) === "9,10,10", "Alt+9 e Op10 pela etiqueta");
  check((await txt("#study-checks")).includes("Muitos operadores no mesmo vídeo"), "aviso de muitos operadores");
  // Volta ao T1 (2 operadores, tipo POSTO)
  await p.click("#chrono-tbody tr:nth-child(4) [data-field='description']");
  await p.keyboard.press("Alt+1");
  await p.click("#chrono-tbody tr:nth-child(5) [data-field='description']");
  await p.keyboard.press("Alt+1");
  await p.fill("#op-count", "2");
  await p.dispatchEvent("#op-count", "change");
  check(await p.inputValue("#op-count") === "2", "Nº de operadores volta a 2");
  await p.evaluate(() => LeanApp.flushSave());

  // ---- MFV tipo POSTO: 1 etapa (TC 12, 2 ops, conteúdo 20)
  await p.goto(base + "mfv.html");
  await p.waitForSelector("#doc-dialog[open]");
  await p.fill("#new-client", "Empresa Teste");
  await p.dispatchEvent("#new-client", "input");
  check((await txt("#new-doc-study-list")).includes("Bancada (posto, 2 op.)"), "Novo MFV mostra o estudo como posto de 2 operadores");
  await p.check("#new-doc-study-list label:has-text('Bancada') input");
  await p.fill("#new-family", "Teste");
  await p.click("#new-doc-form button[type=submit]");
  await p.waitForFunction(() => LeanMfvApp.state.doc && LeanMfvApp.state.doc.steps.length === 1);
  await p.selectOption("#mfv-time-unit", "s");
  const st = await p.evaluate(() => LeanMfvApp.state.doc.steps[0]);
  check(Math.abs(st.tcStudyMin * 60 - 12) < 1e-6 && st.operators === "2" && Math.abs(st.contentStudyMin * 60 - 20) < 1e-6, "POSTO: TC 12 s, 2 ops, conteúdo 20 s");
  check(await p.getAttribute("#steps-tbody [data-field='content']", "placeholder") === "20,0", "campo Conteúdo do posto na linha");
  await p.fill("#demand-monthly", String(1800 * 22));
  await p.fill("#work-days", "22");
  const warn = await txt("#steps-warnings");
  check(warn.includes("Tempo disponível do MFV (520 min/dia) diferente do tempo líquido dos estudos: 1. Bancada (480 min)"), "A4: tempo líquido 480 × 520 min/dia");

  // ---- Tipo LINHA: 1 etapa por operador
  await p.goto(base + "index.html");
  await p.waitForFunction(() => window.LeanApp && LeanApp.state.study && LeanApp.state.study.processName === "Bancada");
  await p.selectOption("#op-kind", "linha");
  await p.evaluate(() => LeanApp.flushSave());
  await p.goto(base + "mfv.html");
  await p.waitForFunction(() => window.LeanMfvApp && LeanMfvApp.state.doc);
  const pick = await p.$eval("#study-picker", (s) => Array.from(s.options).find((o) => o.textContent.includes("Bancada (linha, 2 op.)")).value);
  await p.selectOption("#study-picker", pick);
  await p.click("#btn-add-study-step"); // pede confirmação de contagem dupla (já existe a etapa do posto)
  await p.waitForFunction(() => LeanMfvApp.state.doc.steps.length === 3);
  const lin = await p.evaluate(() => LeanMfvApp.state.doc.steps.slice(1).map((x) => `${x.studyOperator}:${Math.round(x.tcStudyMin * 60)}`));
  check(lin.join(",") === "1:12,2:12", "LINHA: etapas Op1 e Op2 com o TC de cada operador");
  check((await txt("#steps-tbody")).includes("Bancada • Op2 (Ana)"), "nome do operador na etapa");

  // ---- Yamazumi: N barras
  await p.goto(base + "yamazumi.html");
  await p.waitForSelector("#doc-dialog[open]");
  await p.fill("#new-client", "Empresa Teste");
  await p.dispatchEvent("#new-client", "input");
  await p.fill("#new-name", "Bancada");
  await p.check("#new-doc-study-list label:has-text('Bancada') input");
  await p.click("#new-doc-form button[type=submit]");
  await p.waitForFunction(() => LeanYamazumiApp.state.doc && LeanYamazumiApp.state.doc.name === "Bancada");
  check(await p.$$eval("#yz-chart .yz-stack", (s) => s.length) === 2, "Yamazumi: 2 barras (Op1 e Op2)");
  check(await txt("#kpi-content") === "20,0" && (await txt("#kpi-balance")) === "83,3", "Yamazumi: conteúdo 20 s e balanceamento 83,3%");

  check(errors.length === 0, "nenhum erro no console" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(failures ? `${failures} FALHA(S)` : "TUDO OK");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
