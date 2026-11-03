/**
 * Teste de ponta a ponta da REV 1.27 (Playwright, Gemini SIMULADO): IA só com o produto
 * selecionado (cabeçalho "Analisando"), seletor do MFV só com a empresa do MFV (aviso de etapa de
 * outra empresa), estouros de Kaizen no fluxograma ligados ao Plano 5W2H e backup .zip por
 * empresa. Dados fictícios.
 * Uso: npm start (outro terminal) e depois
 *   node tests/e2e.rev127.js http://127.0.0.1:8080/
 * Variável opcional: CHROMIUM_PATH=/caminho/do/chrome
 */
/* global LeanApp, LeanMfvApp, LeanPlanoApp */ // existem apenas dentro das páginas testadas
const { chromium } = require("playwright");
const fs = require("fs");
const C = require("../js/calc.js");
const T = require("../js/xlsx-template.js");

const base = process.argv[2] || "http://127.0.0.1:8080/";
let failures = 0;
const check = (cond, msg) => { console.log((cond ? "  OK  " : "  FALHA ") + msg); if (!cond) failures++; };

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const p = await (await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true })).newPage();
  const errors = [];
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  p.on("dialog", (d) => d.accept());
  const txt = async (sel) => (await p.textContent(sel)).trim();
  const sent = [];
  await p.route("https://generativelanguage.googleapis.com/**", async (route) => {
    const req = route.request();
    if (req.url().includes("/models?")) return route.fulfill({ json: { models: [{ name: "models/gemini-teste-flash", displayName: "Flash", supportedGenerationMethods: ["generateContent"] }] } });
    const prompt = JSON.parse(req.postData()).contents[0].parts[0].text;
    sent.push(prompt);
    const items = JSON.parse(prompt.match(/ELEMENTOS: (\[.*\])\n/)[1]);
    const text = JSON.stringify({ itens: items.map((it) => ({ id: it.id, sem_acao: false, ecrs: "Eliminar", ferramenta: "5s", acao: "Ação teste", justificativa: "dado", confianca: "alta" })) });
    return route.fulfill({ json: { candidates: [{ content: { parts: [{ text }] } }] } });
  });
  console.log(`== REV 1.27 ${base}`);

  // Dois estudos de empresas diferentes; o da Padaria tem 2 produtos
  const pad = C.createStudy({ clientName: "Padaria Teste", processName: "Bancada" });
  pad.settings.multiProduct = true;
  pad.elements = [["Pão", "Buscar bandeja", "10", "NA"], ["Pão", "Laminar", "30", "AG"], ["Rosca", "Buscar farinha", "40", "NA"], ["Rosca", "Modelar", "60", "AG"]]
    .map(([product, description, videoTime, value]) => C.createElement({ product, description, videoTime, value }));
  const met = C.createStudy({ clientName: "Metal Outra", processName: "Solda" });
  met.elements = [C.createElement({ description: "Soldar", videoTime: "30", value: "AG" })];
  await p.goto(base + "index.html");
  await p.waitForSelector("#study-dialog[open]");
  check(/^REV 1\.(2[7-9]|[3-9]\d)$/.test(await txt(".app-header .app-rev")), "rótulo da revisão REV 1.27");
  for (const st of [met, pad]) {
    await p.setInputFiles("#input-import-json", { name: "s.json", mimeType: "application/json", buffer: Buffer.from(C.serializeStudy(st)) });
    await p.waitForFunction((n) => window.LeanApp && LeanApp.state.study && LeanApp.state.study.processName === n, st.processName);
    await p.evaluate(() => LeanApp.flushSave());
  }

  // 1) IA: cabeçalho e escopo do produto
  await p.click("#btn-ai");
  await p.waitForSelector("#ai-dialog[open]");
  await p.fill("#ai-key", "CHAVE-TESTE");
  await p.click("#btn-ai-models");
  await p.waitForFunction(() => document.querySelectorAll("#ai-model option").length === 1);
  await p.click("#btn-ai-save");
  check((await txt("#ai-scope-label")) === "Analisando: Padaria Teste — Bancada • Pão", "cabeçalho com estudo e produto: " + (await txt("#ai-scope-label")));
  await p.click("[data-ai=kaizen]");
  await p.waitForSelector("#ai-results:not([hidden])");
  const items = JSON.parse(sent[0].match(/ELEMENTOS: (\[.*\])\n/)[1]).map((x) => x.elemento);
  check(items.join(",") === "Buscar bandeja", "Kaizen só do produto do Resumo (Pão): " + items.join(","));
  check(!sent[0].includes("Metal Outra") && !sent[0].includes("Soldar"), "nada de outra empresa no pedido");
  await p.selectOption("#ai-scope", "todos");
  check((await txt("#ai-scope-label")).endsWith("• todos os produtos"), "escopo 'todos os produtos' no cabeçalho");
  await p.click("#btn-ai-close");

  // 2) Backup .zip da empresa
  await p.click("#btn-studies");
  await p.waitForSelector("#study-dialog[open] .btn-backup");
  await p.selectOption(".study-list-header select.company-filter", { label: "Padaria Teste (1)" });
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click(".btn-backup")]);
  check(/^Backup_Padaria_Teste_\d{4}-\d{2}-\d{2}\.zip$/.test(dl.suggestedFilename()), "backup da empresa: " + dl.suggestedFilename());
  const names = T.readZip(new Uint8Array(fs.readFileSync(await dl.path()))).map((e) => e.name);
  check(names.includes("LEIA-ME.txt") && names.some((n) => n.startsWith("Padaria_Teste/Crono_")) && !names.some((n) => n.includes("Metal")), "zip com LEIA-ME e só a empresa escolhida: " + names.join(", "));
  await p.keyboard.press("Escape");

  // 3) MFV: seletor só da empresa; etapa de outra empresa avisada
  await p.goto(base + "mfv.html");
  await p.waitForSelector("#doc-dialog[open]");
  await p.fill("#new-client", "Padaria Teste");
  await p.fill("#new-family", "Pães");
  await p.click("#new-doc-form button[type=submit]");
  await p.waitForFunction(() => window.LeanMfvApp && LeanMfvApp.state.doc);
  const opts = () => p.$$eval("#study-picker option", (l) => l.map((o) => o.textContent));
  check(!(await opts()).some((t) => t.includes("Metal Outra")) && (await opts()).some((t) => t.includes("Padaria Teste")), "seletor só com a empresa do MFV");
  await p.check("#picker-all");
  const metOpt = await p.$$eval("#study-picker option", (l) => (l.find((o) => o.textContent.includes("Metal Outra")) || {}).value);
  check(!!metOpt, "'Outras empresas' mostra os estudos das outras");
  await p.selectOption("#study-picker", metOpt);
  await p.click("#btn-add-study-step");
  await p.waitForFunction(() => document.getElementById("steps-warnings").textContent.includes("Etapa de outra empresa"));
  check(true, "aviso 'Etapa de outra empresa'");
  await p.click("#steps-tbody tr:nth-child(1) [data-action=remove]");

  // 4) Estouros de Kaizen no fluxograma
  await p.click("#btn-add-manual-step");
  await p.fill("#steps-tbody tr:nth-child(1) [data-field=name]", "Preparação");
  await p.fill("#steps-tbody tr:nth-child(1) [data-field=tc]", "0,5");
  await p.fill("#steps-tbody tr:nth-child(1) .input-kaizen-note", "Reorganizar: gelo pronto antes da janela");
  await p.waitForSelector("#flow-chart polygon[fill='#facc15']");
  check((await txt("#flow-bursts")).includes("✸1 — 1. Preparação: Reorganizar: gelo pronto antes da janela"), "legenda dos estouros: " + (await txt("#flow-bursts")));
  await p.evaluate(() => LeanMfvApp.flushSave());

  // 5) Plano 5W2H traz a oportunidade do MFV
  await p.goto(base + "plano.html");
  await p.waitForSelector("#doc-dialog[open]");
  await p.fill("#new-client", "Padaria Teste");
  await p.click("#new-doc-form button[type=submit]");
  await p.waitForFunction(() => window.LeanPlanoApp && LeanPlanoApp.state.doc);
  await p.click("#btn-from-crono");
  await p.waitForSelector("#crono-dialog[open]");
  const cands = await p.$$eval("#crono-list li strong", (l) => l.map((x) => x.textContent));
  check(cands.includes("Reorganizar — Preparação"), "oportunidade do MFV na lista do Plano: " + cands.join(" | "));
  await p.check("#crono-list li:has-text('Reorganizar — Preparação') input");
  await p.click("#btn-crono-add");
  const act = await p.evaluate(() => LeanPlanoApp.state.doc.actions.map((a) => `${a.what} | ${a.where} | ${a.why}`)[0]);
  check(/^Reorganizar — Preparação \| MFV — Pães \| Oportunidade Kaizen do MFV: TC 0,500 min/.test(act), "ação criada a partir do MFV: " + act);

  check(errors.length === 0, "nenhum erro no console" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(failures ? `${failures} FALHA(S)` : "TUDO OK");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
