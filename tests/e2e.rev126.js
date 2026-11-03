/**
 * Teste de ponta a ponta da REV 1.26 (Playwright, pasta simulada): arquivos por empresa.
 * Documento novo gravado em <Empresa>/; arquivos soltos de versões anteriores avisados e movidos
 * por "Organizar por empresa"; leitura das subpastas (inclusive pelo MFV); filtro e agrupamento
 * por empresa nas listas. Dados fictícios.
 * Uso: npm start (outro terminal) e depois
 *   node tests/e2e.rev126.js http://127.0.0.1:8080/
 * Variável opcional: CHROMIUM_PATH=/caminho/do/chrome
 */
/* global LeanApp, LeanStorage, sessionStorage, DOMException */ // existem apenas dentro das páginas testadas
const { chromium } = require("playwright");
const C = require("../js/calc.js");
const M = require("../js/mfv-calc.js");

const base = process.argv[2] || "http://127.0.0.1:8080/";
let failures = 0;
const check = (cond, msg) => { console.log((cond ? "  OK  " : "  FALHA ") + msg); if (!cond) failures++; };

/** Pasta simulada (File System Access API em memória), instalada na página e guardada em window. */
function installFakeFolder(seed) {
  const notFound = () => new DOMException("não encontrado", "NotFoundError");
  function makeDir(name) {
    const files = new Map();
    const dirs = new Map();
    const fileHandle = (n) => ({
      kind: "file",
      name: n,
      async getFile() {
        const t = files.get(n);
        return { size: t.length, lastModified: Date.now(), text: async () => t, arrayBuffer: async () => new TextEncoder().encode(t).buffer };
      },
      async createWritable() {
        let buf = "";
        return { async write(x) { buf += typeof x === "string" ? x : new TextDecoder().decode(x); }, async close() { files.set(n, buf); }, async abort() {} };
      },
    });
    return {
      kind: "directory", name, files, dirs,
      async queryPermission() { return "granted"; },
      async requestPermission() { return "granted"; },
      async getFileHandle(n, o) { if (!files.has(n)) { if (!(o && o.create)) throw notFound(); files.set(n, ""); } return fileHandle(n); },
      async getDirectoryHandle(n, o) { if (!dirs.has(n)) { if (!(o && o.create)) throw notFound(); dirs.set(n, makeDir(n)); } return dirs.get(n); },
      async removeEntry(n) { if (!files.delete(n)) throw notFound(); },
      async *values() { for (const n of files.keys()) yield fileHandle(n); for (const d of dirs.values()) yield d; },
    };
  }
  // A mesma pasta em todas as páginas (sessionStorage guarda os arquivos entre as navegações)
  const root = makeDir("B+P");
  const saved = JSON.parse(sessionStorage.getItem("__fake") || "null") || seed || { files: {}, dirs: {} };
  Object.entries(saved.files).forEach(([k, v]) => root.files.set(k, v));
  Object.entries(saved.dirs).forEach(([d, fs]) => { const h = makeDir(d); Object.entries(fs).forEach(([k, v]) => h.files.set(k, v)); root.dirs.set(d, h); });
  window.__fakeDir = root;
  window.__dump = () => {
    const out = { files: Object.fromEntries(root.files), dirs: {} };
    root.dirs.forEach((h, d) => (out.dirs[d] = Object.fromEntries(h.files)));
    sessionStorage.setItem("__fake", JSON.stringify(out));
    return { root: Array.from(root.files.keys()), dirs: Object.fromEntries(Array.from(root.dirs, ([d, h]) => [d, Array.from(h.files.keys())])) };
  };
  return LeanStorage.useDirectoryHandle(root);
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const p = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  const errors = [];
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  const dialogs = [];
  p.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
  const txt = async (sel) => (await p.textContent(sel)).trim();
  console.log(`== REV 1.26 ${base}`);

  // Pasta com arquivos soltos de versões anteriores (2 empresas)
  const a = C.createStudy({ clientName: "Padaria Alfa", processName: "Bancada" });
  const b = C.createStudy({ clientName: "Metal Beta", processName: "Solda" });
  const m = M.createMfv({ clientName: "Padaria Alfa", family: "Pães" });
  const seed = { files: { [a.fileName]: C.serializeStudy(a), [b.fileName]: C.serializeStudy(b), [m.fileName]: M.serializeMfv(m) }, dirs: {} };

  await p.goto(base + "index.html");
  await p.waitForSelector("#study-dialog[open]");
  check(/^REV 1\.(2[6-9]|[3-9]\d)$/.test(await txt(".app-header .app-rev")), "rótulo da revisão REV 1.26");
  await p.evaluate(installFakeFolder, seed);
  await p.evaluate(() => LeanApp.useFolderHandle(window.__fakeDir));
  await p.waitForSelector("#study-dialog[open] .org-banner");
  check((await txt(".org-banner")).includes("3 arquivo(s) soltos na pasta principal"), "aviso dos arquivos soltos: " + (await txt(".org-banner")));
  check(await p.$$eval("#study-list li.study-row", (l) => l.length) === 2, "estudos soltos continuam listados (compatibilidade)");

  // Organizar por empresa
  await p.click(".org-banner button");
  await p.waitForFunction(() => document.querySelector(".org-banner") && document.querySelector(".org-banner").textContent.includes("organizados"));
  check((await txt(".org-banner")).includes("3 arquivo(s) organizados em 2 subpasta(s): Metal_Beta, Padaria_Alfa"), "organizado: " + (await txt(".org-banner")));
  let fs = await p.evaluate(() => window.__dump());
  check(fs.root.length === 0 && fs.dirs.Padaria_Alfa.length === 2 && fs.dirs.Metal_Beta.length === 1, "arquivos nas subpastas das empresas: " + JSON.stringify(fs));
  check(dialogs.some((d) => d.includes("Nada é apagado")), "confirmação antes de mover");

  // Filtro e agrupamento por empresa
  await p.waitForSelector("#study-list li.company-head");
  const heads = await p.$$eval("#study-list li.company-head", (l) => l.map((x) => x.textContent));
  check(heads.join("|") === "Metal Beta (1)|Padaria Alfa (1)", "lista agrupada por empresa: " + heads.join("|"));
  await p.selectOption(".study-list-header select.company-filter", { label: "Padaria Alfa (1)" });
  const visible = await p.$$eval("#study-list li.study-row", (l) => l.filter((x) => !x.hidden).map((x) => x.querySelector(".study-title").textContent));
  check(visible.length === 1 && visible[0].startsWith("Padaria Alfa"), "filtro por empresa: " + visible.join(" | "));

  // Novo estudo vai direto para a subpasta da empresa
  await p.fill("#new-client", "Metal Beta");
  await p.fill("#new-process", "Corte");
  await p.click("#new-study-form button[type=submit]");
  await p.waitForFunction(() => LeanApp.state.study && LeanApp.state.study.processName === "Corte" && LeanApp.state.diskRevision === 1, null, { timeout: 8000 });
  fs = await p.evaluate(() => window.__dump());
  check(fs.dirs.Metal_Beta.length === 2 && fs.root.length === 0, "novo estudo gravado em Metal_Beta/: " + fs.dirs.Metal_Beta.join(", "));

  // Renomear a empresa: o arquivo muda de subpasta (sem duplicar)
  await p.fill("#client-name", "Metal Beta Ltda");
  await p.waitForFunction(() => LeanApp.state.diskRevision === 2, null, { timeout: 8000 });
  fs = await p.evaluate(() => window.__dump());
  check(fs.dirs.Metal_Beta_Ltda && fs.dirs.Metal_Beta_Ltda.length === 1 && fs.dirs.Metal_Beta.length === 1, "empresa renomeada: arquivo movido para Metal_Beta_Ltda/: " + JSON.stringify(fs.dirs));

  // MFV lê os estudos e MFVs das subpastas
  await p.goto(base + "mfv.html");
  await p.waitForSelector("#doc-dialog[open]");
  await p.evaluate(installFakeFolder);
  await p.evaluate(async () => { await LeanStorage.useDirectoryHandle(window.__fakeDir); });
  await p.evaluate(() => document.getElementById("btn-docs").click());
  await p.waitForFunction(() => document.querySelectorAll("#doc-list li.study-row").length >= 1, null, { timeout: 8000 });
  check((await txt("#doc-list")).includes("Padaria Alfa — Pães"), "MFV da subpasta Padaria_Alfa listado");
  check(!(await p.isVisible(".org-banner")), "sem arquivos soltos: sem aviso");

  check(errors.length === 0, "nenhum erro no console" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(failures ? `${failures} FALHA(S)` : "TUDO OK");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
