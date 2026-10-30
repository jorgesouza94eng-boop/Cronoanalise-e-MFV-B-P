/**
 * Teste de ponta a ponta da REV 1.23 (Playwright): filtros na janela "Ações da cronoanálise"
 * do Plano 5W2H (valor, tipo ECRS, produto e "ocultar as que já estão no plano"), "Marcar
 * todas" só nas visíveis e ECRS reconhecido em "Manter/Simplificar:". Dados fictícios.
 * Uso: npm start (outro terminal) e depois
 *   node tests/e2e.rev123.js http://127.0.0.1:8080/
 * Variável opcional: CHROMIUM_PATH=/caminho/do/chrome
 */
/* global LeanPlanoApp */ // existe apenas dentro da página testada
const { chromium } = require("playwright");
const C = require("../js/calc.js");

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
  console.log(`== REV 1.23 ${base}`);

  const s = C.createStudy({ clientName: "Filtro Teste", processName: "Padaria" });
  s.shiftParams = { shiftTimeMin: 480, plannedStopsMin: 0, dailyDemandPcs: 200, tolerancePct: 0 };
  s.elements = [
    ["Pão", "Buscar bandeja", "10", "NA", "Eliminar: bandejas no posto"],
    ["Pão", "Dobrar massa", "30", "AG", "Manter/Simplificar: padronizar a dobra"],
    ["Pão", "Anotar OP", "40", "IN", "Combinar: anotar junto da pesagem"],
    ["Rosca", "Buscar bandeja", "50", "NA", "Eliminar: carrinho de bandejas"],
    ["Rosca", "Limpar mesa", "70", "", "Reorganizar: limpar no fim do lote"],
  ].map(([product, description, videoTime, value, kaizen]) => C.createElement({ product, description, videoTime, value, kaizen }));
  await p.goto(base + "index.html");
  await p.waitForSelector("#study-dialog[open]");
  check(/^REV 1\.(2[3-9]|[3-9]\d)$/.test(await txt(".app-header .app-rev")), "rótulo da revisão REV 1.23");
  await p.setInputFiles("#input-import-json", { name: "f.json", mimeType: "application/json", buffer: Buffer.from(C.serializeStudy(s)) });
  await p.waitForFunction(() => window.LeanApp && window.LeanApp.state.study && window.LeanApp.state.study.processName === "Padaria");

  await p.goto(base + "plano.html");
  await p.waitForSelector("#doc-dialog[open]");
  await p.fill("#new-client", "Filtro Teste");
  await p.click("#new-doc-form button[type=submit]");
  await p.waitForFunction(() => LeanPlanoApp.state.doc);
  await p.click("#btn-from-crono");
  await p.waitForSelector("#crono-dialog[open]");
  const visible = () => p.$$eval("#crono-list li:not([hidden]) strong", (l) => l.map((x) => x.textContent));
  check((await txt("#cf-count")) === "5 de 5 ação(ões)", "contador sem filtro: " + (await txt("#cf-count")));
  check((await visible()).includes("Simplificar — Dobrar massa"), "'Manter/Simplificar:' reconhecido como Simplificar");

  await p.selectOption("#cf-value", "NA");
  check((await visible()).length === 2 && (await visible()).every((t) => t === "Eliminar — Buscar bandeja"), "Valor = Não agrega: as 2 'Buscar bandeja'");
  await p.selectOption("#cf-product", { label: "Rosca" });
  check((await visible()).length === 1 && (await txt("#cf-count")) === "1 de 5 ação(ões)", "Não agrega + Rosca: 1 ação");
  await p.selectOption("#cf-value", "");
  await p.selectOption("#cf-product", "");
  await p.selectOption("#cf-ecrs", "-");
  check((await visible()).length === 0, "nenhuma ação sem ECRS");
  await p.selectOption("#cf-ecrs", "eliminar");
  await p.click("#btn-crono-all");
  await p.selectOption("#cf-ecrs", "");
  check(await p.$$eval("#crono-list input:checked", (l) => l.length) === 2, "'Marcar todas' marcou só as visíveis (2 Eliminar)");
  await p.check("#crono-list li:has-text('Anotar OP') input");
  await p.selectOption("#cf-ecrs", "eliminar");
  await p.click("#btn-crono-add");
  const acts = await p.evaluate(() => LeanPlanoApp.state.doc.actions.map((a) => a.what));
  check(acts.length === 2 && acts.every((a) => a === "Eliminar — Buscar bandeja"), "inclui só as marcadas visíveis (a marcada escondida fica de fora): " + acts.join(" | "));

  // Reabrir: as que já estão no plano ficam ocultas por padrão; o filtro é mantido
  await p.click("#btn-from-crono");
  await p.waitForSelector("#crono-dialog[open]");
  await p.selectOption("#cf-ecrs", "");
  check((await txt("#cf-count")) === "3 de 5 ação(ões)" && !(await visible()).includes("Eliminar — Buscar bandeja"), "já no plano: ocultas por padrão");
  await p.uncheck("#cf-hide-done");
  check((await txt("#cf-count")) === "5 de 5 ação(ões)", "desmarcando 'Ocultar': aparecem (desabilitadas)");
  await p.click("#btn-close-crono");
  const how = await p.evaluate(() => LeanPlanoApp.state.doc.actions.map((a) => a.ecrs));
  check(how.every((e) => e === "eliminar"), "tipo ECRS gravado nas ações");

  check(errors.length === 0, "nenhum erro no console" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(failures ? `${failures} FALHA(S)` : "TUDO OK");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
