/**
 * Teste de ponta a ponta da REV 1.28 (Playwright): modelo de cronoanálise EO_Cronoanálise r05.
 * Carrega o modelo sintético, exporta o estudo e confere a planilha gerada (GERAL, Listagem com
 * Responsável/Data do Plano 5W2H do cliente, UNIDADES e Compilação). Dados fictícios.
 * Uso: npm start (outro terminal) e depois
 *   node tests/e2e.rev128.js http://127.0.0.1:8080/
 * Variável opcional: CHROMIUM_PATH=/caminho/do/chrome
 */
/* global LeanApp, LeanStorage */ // existem apenas dentro da página testada
const { chromium } = require("playwright");
const zlib = require("zlib");
const fs = require("fs");
const C = require("../js/calc.js");
const T = require("../js/xlsx-template.js");
const { buildR05 } = require("./r05-template.js");

const base = process.argv[2] || "http://127.0.0.1:8080/";
let failures = 0;
const check = (cond, msg) => { console.log((cond ? "  OK  " : "  FALHA ") + msg); if (!cond) failures++; };
const dec = new TextDecoder();

function sheetXml(bytes, n) {
  const e = T.readZip(bytes).find((x) => x.name === `xl/worksheets/sheet${n}.xml`);
  return dec.decode(e.method === 0 ? e.compressed : zlib.inflateRawSync(e.compressed));
}
function cell(xml, ref) {
  const m = xml.match(new RegExp(`<c r="${ref}"[^>]*?(?:/>|>([\\s\\S]*?)</c>)`));
  if (!m || !m[1]) return "";
  const t = m[1].match(/<t[^>]*>([\s\S]*?)<\/t>/);
  if (t) return t[1];
  const v = m[1].match(/<v>([\s\S]*?)<\/v>/);
  return v ? Number(v[1]) : "";
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const p = await (await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true })).newPage();
  const errors = [];
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  p.on("dialog", (d) => d.accept());
  const txt = async (sel) => (await p.textContent(sel)).trim();
  console.log(`== REV 1.28 ${base}`);

  const s = C.createStudy({ clientName: "Metal Alfa", processName: "Corte" });
  s.elements = [
    { description: "Corte", videoTime: "30", quantity: "2", type: "C", value: "AG", kaizen: "Simplificar: usar gabarito" },
    { description: "Transporte", videoTime: "45", type: "A", value: "NA", waste: "transporte" },
    { description: "Corte", videoTime: "1:05", quantity: "1", type: "C", value: "AG" },
  ].map((e) => C.createElement(e));
  s.filmPieces = { inicio: "3" };
  s.notes = "Constatação do estudo";

  await p.goto(base + "index.html");
  await p.waitForSelector("#study-dialog[open]");
  check(/^REV 1\.(2[8-9]|[3-9]\d)$/.test(await txt(".app-header .app-rev")), "rótulo da revisão REV 1.28");
  await p.setInputFiles("#input-import-json", { name: "s.json", mimeType: "application/json", buffer: Buffer.from(C.serializeStudy(s)) });
  await p.waitForFunction(() => window.LeanApp && LeanApp.state.study && LeanApp.state.study.processName === "Corte");

  // Plano 5W2H do cliente com a ação do Corte (gravado no navegador, como o módulo Plano faz)
  await p.evaluate(async (id) => {
    const plan = {
      id: "plano-teste",
      clientName: "Metal Alfa",
      fileName: "Plano_Metal_Alfa.json",
      updatedAt: new Date().toISOString(),
      actions: [{ who: "Carlos", end: "2026-12-15", origin: { studyId: id, element: "Corte", etapa: "", product: "", kaizen: "Simplificar: usar gabarito" } }],
    };
    await LeanStorage.putLocal({ id: plan.id, study: plan, diskRevision: 0, dirty: false }, LeanStorage.STORE_PLANS);
  }, s.id);

  // Carregar o modelo r05
  await p.click("#btn-studies");
  await p.waitForSelector("#study-dialog[open]");
  await p.setInputFiles("#input-template", { name: "EO_Cronoanalise_v00_r05.xlsm", mimeType: "application/vnd.ms-excel.sheet.macroEnabled.12", buffer: Buffer.from(buildR05()) });
  await p.waitForFunction(() => document.getElementById("toast-region").textContent.includes("reconhecido"));
  check((await txt("#toast-region")).includes("Modelo EO_Cronoanálise r05 reconhecido ✅"), "modelo r05 reconhecido: " + (await txt("#toast-region")).slice(0, 120));
  await p.keyboard.press("Escape");

  // Exportar
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#btn-export-xlsx")]);
  check(/^Crono_Metal_Alfa_Corte_\d{4}-\d{2}-\d{2}\.xlsm$/.test(dl.suggestedFilename()), "arquivo .xlsm: " + dl.suggestedFilename());
  const bytes = new Uint8Array(fs.readFileSync(await dl.path()));
  const U = sheetXml(bytes, 1);
  const G = sheetXml(bytes, 2);
  const L = sheetXml(bytes, 3);
  const K = sheetXml(bytes, 4);
  check(cell(G, "B9") === "Corte" && cell(G, "F9") === "Peça" && cell(G, "F10") === "Lote" && cell(G, "G10") === "A", "GERAL: elemento, unidade (Peça/Lote) e tipo");
  check(cell(U, "B8") === 3, "UNIDADES: tamanho do lote = 3 peças filmadas");
  check(cell(L, "C9") === 16.667 && cell(L, "C10") === 5, "Listagem: Corte 50 s ÷ 3 pç = 16,667 s e Transporte 15 ÷ 3 = 5 s (= app)");
  check(cell(L, "F9") === "Simplificar: usar gabarito", "Listagem: ação Kaizen");
  check(cell(L, "G9") === "Carlos" && cell(L, "H9") === 46371, "Listagem: Responsável e Data do Plano 5W2H");
  check(String(cell(U, "C15")).includes("Desperdícios observados:"), "UNIDADES: observações com premissas e desperdícios");
  check(cell(K, "B35") === "Constatação do estudo", "Compilação: constatações em B35");
  await p.waitForTimeout(300);
  check((await txt("#toast-region")).includes("vieram do Plano de Ação 5W2H"), "aviso do plano na tela");

  check(errors.length === 0, "nenhum erro no console" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(failures ? `${failures} FALHA(S)` : "TUDO OK");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
