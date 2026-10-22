/**
 * Teste de ponta a ponta da REV 1.16 (Playwright): "Arquivar" nas listas de estudos, MFVs e
 * grupos. Com a pasta conectada (aqui simulada em memória), o arquivo vai para a subpasta
 * _Arquivo e sai da lista; sem pasta, o app baixa o .json e tira o item do navegador.
 * O documento aberto não pode ser arquivado. Dados fictícios.
 * Uso: npm start (outro terminal) e depois
 *   node tests/e2e.rev116.js http://127.0.0.1:8080/
 * Variável opcional: CHROMIUM_PATH=/caminho/do/chrome
 */
/* global LeanApp, LeanMfvApp, LeanYamazumiApp, LeanStorage, DOMException */ // existem apenas dentro das páginas testadas
const { chromium } = require("playwright");
const C = require("../js/calc.js");
const M = require("../js/mfv-calc.js");

const base = process.argv[2] || "http://127.0.0.1:8080/";
let failures = 0;
const check = (cond, msg) => { console.log((cond ? "  OK  " : "  FALHA ") + msg); if (!cond) failures++; };

/** Pasta simulada (File System Access API em memória), instalada na página. */
function installFakeFolder() {
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
      kind: "directory",
      name,
      files,
      dirs,
      async queryPermission() { return "granted"; },
      async requestPermission() { return "granted"; },
      async getFileHandle(n, o) {
        if (!files.has(n)) { if (!(o && o.create)) throw notFound(); files.set(n, ""); }
        return fileHandle(n);
      },
      async getDirectoryHandle(n, o) {
        if (!dirs.has(n)) { if (!(o && o.create)) throw notFound(); dirs.set(n, makeDir(n)); }
        return dirs.get(n);
      },
      async removeEntry(n) { if (!files.delete(n)) throw notFound(); },
      async *values() { for (const n of files.keys()) yield fileHandle(n); for (const d of dirs.values()) yield d; },
    };
  }
  window.__fakeDir = makeDir("Pasta Teste");
  return LeanStorage.useDirectoryHandle(window.__fakeDir);
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errors = [];
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  const dialogs = [];
  p.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
  const txt = async (sel) => (await p.textContent(sel)).trim();
  console.log(`== REV 1.16 ${base}`);

  // ---- Cronoanálise sem pasta: Arquivar baixa o .json e tira do navegador
  await p.goto(base + "index.html");
  await p.waitForSelector("#study-dialog[open]");
  check(/^REV 1\.1[6-9]$/.test(await txt(".app-header .app-rev")), "rótulo da revisão REV 1.16");
  for (const name of ["Corte", "Solda"]) {
    const s = C.createStudy({ clientName: "Arquivo Teste", processName: name });
    await p.setInputFiles("#input-import-json", { name: `${name}.json`, mimeType: "application/json", buffer: Buffer.from(C.serializeStudy(s)) });
    await p.waitForFunction((n) => window.LeanApp && LeanApp.state.study && LeanApp.state.study.processName === n, name);
    await p.evaluate(() => LeanApp.flushSave());
  }
  await p.click("#btn-studies");
  await p.waitForSelector("#study-dialog[open]");
  const row = (t) => `#study-list li:has-text('${t}')`;
  check(!(await p.isVisible(`${row("Solda")} [data-action='archive']`)), "estudo aberto (Solda) sem o botão Arquivar");
  check(await p.isVisible(`${row("Corte")} [data-action='archive']`), "outro estudo com Arquivar");
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click(`${row("Corte")} [data-action='archive']`)]);
  check(/^Crono_Arquivo_Teste_Corte_.*\.json$/.test(dl.suggestedFilename()), "sem pasta: baixa o .json do estudo: " + dl.suggestedFilename());
  check(dialogs.some((m) => m.includes('Arquivar o estudo "Arquivo Teste — Corte"') && m.includes("Importar JSON")), "confirmação explica como trazer de volta");
  await p.waitForFunction(() => !document.querySelector("#study-list").textContent.includes("Corte"));
  check(true, "estudo arquivado saiu da lista");
  check(await p.evaluate(async () => (await LeanStorage.listLocal()).every((r) => r.study.processName !== "Corte")), "estudo arquivado saiu do navegador");

  // ---- MFV com a pasta conectada: vai para _Arquivo e sai da lista
  await p.goto(base + "mfv.html");
  await p.waitForSelector("#doc-dialog[open]");
  const old = M.createMfv({ clientName: "Arquivo Teste", family: "Versão antiga" });
  await p.evaluate(installFakeFolder);
  await p.evaluate(([name, text]) => window.__fakeDir.files.set(name, text), [old.fileName, M.serializeMfv(old)]);
  await p.fill("#new-client", "Arquivo Teste");
  await p.fill("#new-family", "Versão atual");
  await p.click("#new-doc-form button[type=submit]");
  await p.waitForFunction(() => LeanMfvApp.state.doc && LeanMfvApp.state.doc.family === "Versão atual");
  await p.evaluate(() => LeanMfvApp.flushSave());
  await p.click("#btn-docs");
  await p.waitForSelector("#doc-dialog[open] #doc-list li");
  const mrow = (t) => `#doc-list li:has-text('${t}')`;
  check((await txt(mrow("Versão antiga"))).includes("Na pasta"), "MFV antigo listado da pasta");
  check(!(await p.isVisible(`${mrow("Versão atual")} [data-action='archive']`)), "MFV aberto sem o botão Arquivar");
  dialogs.length = 0;
  await p.click(`${mrow("Versão antiga")} [data-action='archive']`);
  await p.waitForFunction(() => !document.querySelector("#doc-list").textContent.includes("Versão antiga"));
  check(dialogs.some((m) => m.includes("subpasta _Arquivo")), "confirmação cita a subpasta _Arquivo");
  const fs = await p.evaluate((name) => ({ root: window.__fakeDir.files.has(name), arq: !!(window.__fakeDir.dirs.get("_Arquivo") && window.__fakeDir.dirs.get("_Arquivo").files.has(name)) }), old.fileName);
  check(!fs.root && fs.arq, "arquivo movido da pasta para _Arquivo (nada apagado)");
  const arqText = await p.evaluate((name) => window.__fakeDir.dirs.get("_Arquivo").files.get(name), old.fileName);
  check(M.normalizeMfv(JSON.parse(arqText)).ok, "cópia arquivada é um MFV válido (pode voltar à pasta)");
  check((await txt(mrow("Versão atual"))).length > 0, "MFV aberto continua na lista");

  // ---- Yamazumi sem pasta: Arquivar baixa o .json
  await p.goto(base + "yamazumi.html");
  await p.waitForSelector("#doc-dialog[open]");
  for (const name of ["Grupo A", "Grupo B"]) {
    await p.fill("#new-client", "Arquivo Teste");
    await p.dispatchEvent("#new-client", "input");
    await p.fill("#new-name", name);
    await p.click("#new-doc-form button[type=submit]");
    await p.waitForFunction((n) => window.LeanYamazumiApp && LeanYamazumiApp.state.doc && LeanYamazumiApp.state.doc.name === n, name);
    await p.evaluate(() => window.LeanYamazumiApp.flushSave());
    await p.click("#btn-docs");
    await p.waitForSelector("#doc-dialog[open]");
  }
  const grow = (t) => `#doc-list li:has-text('${t}')`;
  const [dl2] = await Promise.all([p.waitForEvent("download"), p.click(`${grow("Grupo A")} [data-action='archive']`)]);
  check(/^Yamazumi_.*\.json$/.test(dl2.suggestedFilename()), "Yamazumi sem pasta: baixa o .json do grupo: " + dl2.suggestedFilename());
  await p.waitForFunction(() => !document.querySelector("#doc-list").textContent.includes("Grupo A"));
  check(true, "grupo arquivado saiu da lista");

  check(errors.length === 0, "nenhum erro no console" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(failures ? `${failures} FALHA(S)` : "TUDO OK");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
