/**
 * Teste de ponta a ponta da REV 1.10 (Playwright): sem documento aberto, a janela inicial de
 * cada página (estudos, MFVs e grupos) pode ser fechada, tem o menu dos módulos e deixa uma
 * tela vazia com o botão para abrir de novo.
 * Uso: npm start (outro terminal) e depois
 *   node tests/e2e.rev110.js http://127.0.0.1:8080/
 * Variável opcional: CHROMIUM_PATH=/caminho/do/chrome
 */
const { chromium } = require("playwright");

const base = process.argv[2] || "http://127.0.0.1:8080/";
let failures = 0;
const check = (cond, msg) => { console.log((cond ? "  OK  " : "  FALHA ") + msg); if (!cond) failures++; };

const PAGES = [
  { file: "index.html", dialog: "#study-dialog", label: "Cronoanálise", next: "mfv.html" },
  { file: "mfv.html", dialog: "#doc-dialog", label: "MFV", next: "yamazumi.html" },
  { file: "yamazumi.html", dialog: "#doc-dialog", label: "Yamazumi", next: "index.html" },
];

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  console.log(`== REV 1.10 ${base}`);
  for (const pg of PAGES) {
    // Contexto novo = navegador sem nenhum documento salvo
    const p = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
    const errors = [];
    p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await p.goto(base + pg.file);
    await p.waitForSelector(`${pg.dialog}[open]`);
    const open = `${pg.dialog}[open]`;
    check(await p.isVisible(`${open} .dialog-nav a[href="${pg.next}"]`), `${pg.label}: menu dos módulos dentro da janela`);
    check(await p.isVisible(`${open} #btn-close-dialog`), `${pg.label}: botão × visível sem documento aberto`);
    await p.keyboard.press("Escape");
    check(!(await p.$(open)), `${pg.label}: Esc fecha a janela`);
    check(await p.isVisible("#empty-state") && !(await p.isVisible(".app-workspace")), `${pg.label}: tela vazia, sem a área de trabalho`);
    await p.keyboard.press("Control+Enter");
    await p.click("#btn-empty-open");
    await p.waitForSelector(open);
    check(true, `${pg.label}: botão da tela vazia reabre a janela`);
    await p.click(`${open} #btn-close-dialog`);
    check(!(await p.$(open)), `${pg.label}: × fecha a janela`);
    await p.click(`.app-header .app-nav a[href="${pg.next}"]`);
    await p.waitForURL(new RegExp(pg.next.replace(".", "\\.")));
    check(true, `${pg.label}: menu do cabeçalho leva para ${pg.next}`);
    check(errors.length === 0, `${pg.label}: nenhum erro no console` + (errors.length ? ": " + errors.join(" | ") : ""));
    await p.context().close();
  }
  await browser.close();
  console.log(failures ? `${failures} FALHA(S)` : "TUDO OK");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
