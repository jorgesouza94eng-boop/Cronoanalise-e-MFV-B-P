/**
 * Teste de ponta a ponta da REV 1.25 (Playwright, Gemini SIMULADO): janela "Definir etapas"
 * (uma etapa por elemento, aplicação em lote, prévia do TP por etapa, salvar), sugestão de etapas
 * pela IA (só elementos sem etapa, revisão na janela antes de gravar) e as barras no GBO do MFV.
 * Dados fictícios.
 * Uso: npm start (outro terminal) e depois
 *   node tests/e2e.rev125.js http://127.0.0.1:8080/
 * Variável opcional: CHROMIUM_PATH=/caminho/do/chrome
 */
/* global LeanApp, LeanMfvApp */ // existem apenas dentro das páginas testadas
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

  const sent = [];
  await p.route("https://generativelanguage.googleapis.com/**", async (route) => {
    const req = route.request();
    if (req.url().includes("/models?")) {
      return route.fulfill({ json: { models: [{ name: "models/gemini-teste-flash", displayName: "Flash", supportedGenerationMethods: ["generateContent"] }] } });
    }
    const prompt = JSON.parse(req.postData()).contents[0].parts[0].text;
    sent.push(prompt);
    const items = JSON.parse(prompt.match(/ELEMENTOS \(na ordem da cronoanálise\): (\[.*\])\n/)[1]).filter((x) => x.id);
    const itens = items.map((x) =>
      x.elemento === "Conversar" ? { id: x.id, sem_etapa: true, motivo: "Não é atividade do processo" } : { id: x.id, sem_etapa: false, etapa: /Model|bandeja/i.test(x.elemento) ? "Modelagem" : "laminação" }
    );
    const text = JSON.stringify({ itens, etapas: [{ produto: "", nome: "Modelagem", justificativa: "Formato final do pão" }] });
    return route.fulfill({ json: { candidates: [{ content: { parts: [{ text }] } }] } });
  });

  console.log(`== REV 1.25 ${base}`);
  const s = C.createStudy({ clientName: "Etapas Teste", processName: "Bancada" });
  s.shiftParams = { shiftTimeMin: 480, plannedStopsMin: 0, dailyDemandPcs: 200, tolerancePct: 0 };
  s.elements = [
    ["Pesar farinha", "A", "1", "20"],
    ["Bater massa", "A", "1", "40"],
    ["Laminar", "C", "10", "110"],
    ["Conversar", "A", "1", "115"],
    ["Laminar", "C", "10", "140"],
    ["Modelar", "C", "10", "220"],
    ["Colocar na bandeja", "C", "10", "240"],
  ].map(([description, type, quantity, videoTime]) => C.createElement({ description, type, quantity, videoTime }));
  s.filmPieces = { inicio: "10" };
  await p.goto(base + "index.html");
  await p.waitForSelector("#study-dialog[open]");
  check(/^REV 1\.(2[5-9]|[3-9]\d)$/.test(await txt(".app-header .app-rev")), "rótulo da revisão REV 1.25");
  await p.setInputFiles("#input-import-json", { name: "e.json", mimeType: "application/json", buffer: Buffer.from(C.serializeStudy(s)) });
  await p.waitForFunction(() => window.LeanApp && LeanApp.state.study && LeanApp.state.study.processName === "Bancada");

  // 1) Janela manual
  await p.click("#btn-define-etapas");
  await p.waitForSelector("#etapas-dialog[open]");
  const names = await p.$$eval("#et-tbody tr[data-key] td:nth-child(3)", (l) => l.map((x) => x.textContent));
  check(names.length === 6 && names[2] === "Laminar (2 linhas)", "6 elementos uma vez cada (Laminar com 2 linhas): " + names.join(" | "));
  check(await p.isHidden("#et-product-wrap"), "um produto: sem seletor de produto");
  const input = (k) => `#et-tbody tr[data-key='${k}'] .et-input`;
  await p.fill(input("pesar farinha"), "Preparação da massa");
  await p.check("#et-tbody tr[data-key='bater massa'] .et-sel");
  await p.fill("#et-bulk", "Preparação da massa");
  await p.click("#btn-et-bulk");
  check(await p.inputValue(input("bater massa")) === "Preparação da massa", "aplicar aos marcados");
  check((await txt("#et-preview")).includes("1. Preparação da massa 4,0 s") && (await txt("#et-preview")).includes("2 linha(s) a alterar"), "prévia do TP por etapa: " + (await txt("#et-preview")));
  check(await p.evaluate(() => LeanApp.state.study.elements[0].etapa) === "", "nada gravado antes de salvar");
  await p.click("#btn-et-save");
  check(await p.evaluate(() => LeanApp.state.study.elements.map((e) => e.etapa || "-").join(",")) === "Preparação da massa,Preparação da massa,-,-,-,-,-", "salvo nas linhas dos 2 elementos");
  check(await p.isChecked("#opt-multi-etapa"), "coluna Etapa ligada ao salvar");

  // 2) IA: só os sem etapa; revisão na janela antes de gravar
  await p.click("#btn-ai");
  await p.waitForSelector("#ai-dialog[open]");
  await p.fill("#ai-key", "CHAVE-TESTE");
  await p.click("#btn-ai-models");
  await p.waitForFunction(() => document.querySelectorAll("#ai-model option").length === 1);
  await p.click("#btn-ai-save");
  await p.click("#btn-ai-close");
  await p.click("#btn-define-etapas");
  await p.waitForSelector("#etapas-dialog[open]");
  await p.click("#btn-et-ai");
  await p.waitForSelector("#ai-dialog[open]");
  await p.waitForSelector("#ai-results:not([hidden])");
  const ids = JSON.parse(sent[0].match(/ELEMENTOS \(na ordem da cronoanálise\): (\[.*\])\n/)[1]).filter((x) => x.id).map((x) => x.elemento);
  check(ids.join(",") === "Laminar,Conversar,Modelar,Colocar na bandeja", "IA recebe só os elementos sem etapa: " + ids.join(","));
  const groups = await p.$$eval("#ai-list li.ai-group", (l) => l.map((x) => x.textContent));
  check(groups.length === 2 && groups[0].startsWith("1. laminação") && groups[1].startsWith("2. Modelagem") && groups[1].includes("Formato final do pão"), "lista agrupada por etapa, com TP e justificativa: " + groups.join(" | "));
  check((await txt("#ai-list")).includes("Sem etapa clara: Não é atividade do processo"), "sem etapa clara com o motivo");
  await p.click("#btn-ai-apply");
  await p.waitForSelector("#etapas-dialog[open]");
  check(await p.inputValue(input("laminar")) === "laminação" && (await p.getAttribute(input("laminar"), "class")).includes("is-ai"), "sugestões da IA chegam como rascunho destacado");
  check(await p.inputValue(input("pesar farinha")) === "Preparação da massa", "etapa já definida não é trocada pela IA");
  await p.fill(input("laminar"), "Laminação");
  await p.fill(input("conversar"), "Laminação");
  await p.click("#btn-et-save");
  const et = await p.evaluate(() => LeanApp.state.study.elements.map((e) => e.etapa).join(","));
  check(et === "Preparação da massa,Preparação da massa,Laminação,Laminação,Laminação,Modelagem,Modelagem", "etapas gravadas: " + et);
  const tp = await p.evaluate(() => (LeanApp.state.computed.product.etapas || []).map((e) => `${e.name}=${(e.tp * 60).toFixed(1)}`).join(" | "));
  check(tp === "Preparação da massa=4.0 | Laminação=3.2 | Modelagem=6.0", "TP por etapa na cronoanálise: " + tp);
  await p.evaluate(() => LeanApp.flushSave());

  // 3) MFV: 1 barra por etapa no GBO
  await p.goto(base + "mfv.html");
  await p.waitForSelector("#doc-dialog[open]");
  await p.fill("#new-client", "Etapas Teste");
  await p.fill("#new-family", "Pães");
  await p.click("#new-doc-form button[type=submit]");
  await p.waitForFunction(() => window.LeanMfvApp && LeanMfvApp.state.doc);
  const opt = await p.$$eval("#study-picker option", (l) => l.map((o) => [o.value, o.textContent]).find((x) => /3 etapa/.test(x[1])));
  check(!!opt, "estudo aparece com '(3 etapa(s))' no seletor");
  if (opt) {
    await p.selectOption("#study-picker", opt[0]);
    await p.click("#btn-add-study-step");
    check(await p.evaluate(() => LeanMfvApp.state.doc.steps.length) === 3, "3 etapas no MFV (1 barra por etapa no GBO)");
  }

  check(errors.length === 0, "nenhum erro no console" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(failures ? `${failures} FALHA(S)` : "TUDO OK");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
