/**
 * Teste de ponta a ponta da REV 1.31 (Playwright, Gemini SIMULADO): pausas/refeição sem ":"
 * lidas como minutos no MFV e modelo reserva da IA quando o escolhido responde 503. Dados fictícios.
 * Uso: npm start (outro terminal) e depois
 *   node tests/e2e.rev131.js http://127.0.0.1:8080/
 * Variável opcional: CHROMIUM_PATH=/caminho/do/chrome
 */
/* global LeanApp, LeanMfvApp */ // existem apenas dentro das páginas testadas
const { chromium } = require("playwright");
const C = require("../js/calc.js");
const M = require("../js/mfv-calc.js");

const base = process.argv[2] || "http://127.0.0.1:8080/";
let failures = 0;
const check = (cond, msg) => { console.log((cond ? "  OK  " : "  FALHA ") + msg); if (!cond) failures++; };

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const p = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  const errors = [];
  p.on("console", (m) => m.type() === "error" && !/status of 503/.test(m.text()) && errors.push(m.text()));
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  p.on("dialog", (d) => d.accept());
  const txt = async (sel) => (await p.textContent(sel)).trim();
  console.log(`== REV 1.31 ${base}`);

  // 1) MFV: "20" na pausa = 20 minutos; "90" na refeição = 1:30 com aviso
  const d = M.createMfv({ clientName: "Pausa Teste", family: "Peças" });
  d.demandMonthly = "4400";
  d.workDaysMonth = "22";
  d.schedule.forEach((day, i) => Object.assign(day, i === 0 ? { start: "07:00", end: "17:00", breaks: "", meal: "" } : { start: "", end: "", breaks: "", meal: "" }));
  await p.goto(base + "mfv.html");
  await p.waitForSelector("#doc-dialog[open]");
  check(/^REV 1\.(3[1-9]|[4-9]\d)$/.test(await txt(".app-header .app-rev")), "rótulo da revisão REV 1.31");
  await p.setInputFiles("#input-import-mfv", { name: "m.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(d)) });
  await p.waitForFunction(() => window.LeanMfvApp && LeanMfvApp.state.doc && LeanMfvApp.state.doc.family === "Peças");
  const cell = (f) => `#schedule-tbody tr:nth-child(1) input[data-field=${f}]`;
  await p.fill(cell("breaks"), "20");
  await p.press(cell("breaks"), "Tab");
  check((await p.inputValue(cell("breaks"))) === "00:20", "pausa \"20\" vira 00:20 (20 minutos)");
  await p.fill(cell("meal"), "90");
  await p.press(cell("meal"), "Tab");
  check((await p.inputValue(cell("meal"))) === "01:30", "refeição \"90\" vira 01:30");
  check((await txt("#toast-region")).includes("Refeição: 90 = 90 minutos (01:30). Para horas, use HH:MM"), "aviso da conversão em minutos");
  const net = await p.evaluate(() => window.LeanMfv.computeMfv(LeanMfvApp.state.doc).days[0].net);
  check(net === 600 - 20 - 90, "efetivo do dia = 10 h − 20 − 90 min = 490 min (" + net + ")");
  check((await p.getAttribute(cell("breaks"), "placeholder")) === "min", "campo de pausas indica minutos");

  // 2) IA: modelo escolhido com 503 → modelo reserva neste pedido (configuração mantida)
  const calls = [];
  await p.route("https://generativelanguage.googleapis.com/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/models?")) {
      return route.fulfill({
        json: {
          models: [
            { name: "models/gemini-teste-flash", displayName: "Flash", supportedGenerationMethods: ["generateContent"] },
            { name: "models/gemini-reserva-flash-lite", displayName: "Lite", supportedGenerationMethods: ["generateContent"] },
          ],
        },
      });
    }
    const model = url.match(/models\/([^:]+):/)[1];
    calls.push(model);
    if (model === "gemini-teste-flash") return route.fulfill({ status: 503, json: { error: { message: "high demand" } } });
    return route.fulfill({ json: { candidates: [{ content: { parts: [{ text: "Constatação gerada pelo reserva." }] } }] } });
  });
  const s = C.createStudy({ clientName: "Reserva Teste", processName: "Bancada" });
  s.elements = [C.createElement({ description: "Corte", videoTime: "10", quantity: "1", type: "C", value: "AG" })];
  await p.goto(base + "index.html");
  await p.waitForSelector("#study-dialog[open]");
  await p.setInputFiles("#input-import-json", { name: "s.json", mimeType: "application/json", buffer: Buffer.from(C.serializeStudy(s)) });
  await p.waitForFunction(() => window.LeanApp && LeanApp.state.study && LeanApp.state.study.processName === "Bancada");
  await p.click("#btn-ai");
  await p.waitForSelector("#ai-dialog[open]");
  await p.fill("#ai-key", "CHAVE-TESTE");
  await p.click("#btn-ai-models");
  await p.waitForFunction(() => document.querySelectorAll("#ai-model option").length === 2);
  await p.selectOption("#ai-model", "gemini-teste-flash");
  await p.click("#btn-ai-save");
  await p.waitForFunction(() => !document.querySelector("[data-ai=notes]").disabled);
  await p.click("[data-ai=notes]");
  await p.waitForFunction(() => document.getElementById("toast-region").textContent.includes("modelo reserva"), null, { timeout: 30000 });
  check((await txt("#toast-region")).includes("gemini-teste-flash sobrecarregado (erro 503). Este pedido foi para o modelo reserva gemini-reserva-flash-lite"), "aviso do modelo reserva");
  await p.waitForFunction(() => document.getElementById("ai-notes").value.includes("Constatação gerada pelo reserva."), null, { timeout: 30000 });
  check(calls.filter((m) => m === "gemini-teste-flash").length === 3 && calls.includes("gemini-reserva-flash-lite"), "3 tentativas no escolhido e depois o reserva: " + calls.join(", "));
  check((await p.inputValue("#ai-model")) === "gemini-teste-flash", "modelo escolhido na configuração não muda");

  check(errors.length === 0, "nenhum erro no console" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(failures ? `${failures} FALHA(S)` : "TUDO OK");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
