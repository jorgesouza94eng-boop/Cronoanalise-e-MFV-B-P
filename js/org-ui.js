/**
 * ============================================================================
 * LEAN CHRONO & MFV — ORGANIZAÇÃO POR EMPRESA NAS LISTAS (REV 1.26)
 * ----------------------------------------------------------------------------
 * Usado nas janelas de Estudos, MFVs, Grupos e Planos:
 *  - filtro "Empresa" e agrupamento da lista por empresa (itens com data-client);
 *  - aviso dos arquivos soltos na pasta principal (versões anteriores), com o botão
 *    "Organizar por empresa", que os move para a subpasta de cada empresa.
 * Depende de: LeanCalc, LeanStorage.
 * ============================================================================
 */
(function (root) {
  "use strict";

  const Calc = root.LeanCalc;
  const Store = root.LeanStorage;
  const NONE = "__sem_cliente";

  function remember(key, value) {
    try {
      if (value === undefined) return root.localStorage.getItem(`empresa:${key}`) || "";
      root.localStorage.setItem(`empresa:${key}`, value);
    } catch (err) {
      /* sem armazenamento local: o filtro vale só nesta tela */
    }
    return "";
  }

  /**
   * Agrupa os itens (li com data-client) por empresa, em ordem alfabética ("Sem cliente" no fim),
   * mantendo a ordem original dentro de cada empresa, e aplica o filtro escolhido.
   */
  function companyFilter(ul, key) {
    const items = Array.from(ul.children).filter((li) => li.dataset && li.dataset.client != null);
    ul.querySelectorAll("li.company-head").forEach((h) => h.remove());
    const header = ul.previousElementSibling;
    let sel = header ? header.querySelector("select.company-filter") : null;
    const groups = new Map();
    items.forEach((li) => {
      const name = String(li.dataset.client || "").trim();
      const k = name ? Calc.elementKey(name) : NONE;
      if (!groups.has(k)) groups.set(k, { name: name || "Sem cliente", items: [] });
      groups.get(k).items.push(li);
    });
    const keys = Array.from(groups.keys()).sort((a, b) => (a === NONE) - (b === NONE) || groups.get(a).name.localeCompare(groups.get(b).name, "pt-BR"));
    const many = keys.length > 1;
    backupButton(header, () => (sel && many && sel.value ? sel.value : null), groups);
    if (!sel && header && many) {
      sel = document.createElement("select");
      sel.className = "company-filter";
      sel.setAttribute("aria-label", "Filtrar por empresa");
      header.append(sel);
      sel.addEventListener("change", () => {
        remember(key, sel.value);
        apply();
      });
    }
    if (sel) sel.hidden = !many;
    if (!many) {
      items.forEach((li) => (li.hidden = false));
      return;
    }
    const saved = sel.value || remember(key);
    sel.replaceChildren(
      Object.assign(document.createElement("option"), { value: "", textContent: `Empresa: todas (${items.length})` }),
      ...keys.map((k) => Object.assign(document.createElement("option"), { value: k, textContent: `${groups.get(k).name} (${groups.get(k).items.length})` }))
    );
    sel.value = keys.includes(saved) ? saved : "";
    keys.forEach((k) => {
      const g = groups.get(k);
      const head = Object.assign(document.createElement("li"), { className: "company-head", textContent: `${g.name} (${g.items.length})` });
      head.dataset.group = k;
      ul.append(head, ...g.items);
      g.items.forEach((li) => (li.dataset.group = k));
    });
    // Itens sem empresa (ex.: aviso de lista vazia) vão para o fim
    Array.from(ul.children).filter((li) => !li.dataset.group).forEach((li) => ul.append(li));
    function apply() {
      const v = sel.value;
      ul.querySelectorAll("li[data-group]").forEach((li) => (li.hidden = !!v && li.dataset.group !== v));
    }
    apply();
  }

  /* --------------------------------------------------------------------------
     BACKUP .ZIP (REV 1.27)
     -------------------------------------------------------------------------- */

  const enc = new TextEncoder();
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const KIND_LABEL = { Crono: "estudo(s) de cronoanálise", MFV: "MFV(s)", Yamazumi: "grupo(s) do Yamazumi", Plano: "plano(s) de ação" };

  /** Gera e baixa o .zip: <Empresa>/<arquivo>.json e um LEIA-ME.txt. clientKey null = todas. */
  async function backupZip(clientKey, label) {
    const docs = await Store.collectCompanyDocs(clientKey);
    if (!docs.length) {
      root.alert("Nenhum documento para o backup.");
      return 0;
    }
    const count = {};
    docs.forEach((d) => (count[d.kind] = (count[d.kind] || 0) + 1));
    const readme = [
      "BACKUP — LEAN CHRONO & MFV (Programa Brasil Mais Produtivo)",
      `Empresa: ${label}`,
      `Gerado em: ${new Date().toLocaleString("pt-BR")}`,
      "",
      "Conteúdo (versão mais recente de cada documento, do navegador e da pasta):",
      ...Object.keys(count).map((k) => `  • ${count[k]} ${KIND_LABEL[k] || k}`),
      "",
      "Fora do backup: itens arquivados (_Arquivo), cópias de conflito e modelos Excel (_Modelos).",
      "",
      "Para restaurar: copie as subpastas para a pasta conectada (OneDrive)",
      'ou use "Importar JSON" em cada módulo.',
      "",
    ].join("\r\n");
    const files = [{ name: "LEIA-ME.txt", data: enc.encode(readme) }].concat(docs.map((d) => ({ name: `${d.dir}/${d.fileName}`, data: enc.encode(d.text) })));
    const bytes = root.LeanXlsx.zip(files);
    const name = `Backup_${clientKey ? docs[0].dir : "Todas_as_empresas"}_${today()}.zip`;
    Store.downloadText(name, bytes, "application/zip");
    return docs.length;
  }

  /** Botão "Backup .zip" no cabeçalho da lista (empresa do filtro ou todas). */
  function backupButton(header, currentKey, groups) {
    if (!header || !Store.collectCompanyDocs || !root.LeanXlsx) return;
    let btn = header.querySelector("button.btn-backup");
    if (!btn) {
      btn = Object.assign(document.createElement("button"), { type: "button", className: "btn-outline btn-small btn-backup", textContent: "Backup .zip" });
      header.append(btn);
      btn.addEventListener("click", async () => {
        const k = btn.__key ? btn.__key() : null;
        const label = k ? (btn.__groups.get(k) || {}).name || "empresa" : "todas as empresas";
        btn.disabled = true;
        try {
          const n = await backupZip(k === NONE ? "" : k, label);
          if (n) btn.title = `Último backup: ${n} documento(s) de ${label}`;
        } catch (err) {
          root.alert(`Não foi possível gerar o backup: ${err.message || err}`);
        } finally {
          btn.disabled = false;
        }
      });
    }
    btn.__key = currentKey;
    btn.__groups = groups;
    btn.title = 'Baixa um .zip com todos os documentos da empresa escolhida no filtro (ou de todas), do navegador e da pasta';
  }

  /** Aviso dos documentos soltos na pasta principal, com "Organizar por empresa". */
  async function organizeBanner(ul, onRefresh) {
    const header = ul.previousElementSibling;
    if (!header || !Store.countLooseFiles) return;
    let box = header.parentElement.querySelector(".org-banner");
    const n = await Store.countLooseFiles().catch(() => 0);
    if (!n) {
      if (box && !box.dataset.done) box.remove(); // o resultado de "Organizar" continua visível
      return;
    }
    if (!box) {
      box = document.createElement("div");
      box.className = "org-banner info-banner";
      header.before(box);
    }
    const btn = Object.assign(document.createElement("button"), { type: "button", className: "btn-outline btn-small", textContent: "Organizar por empresa" });
    box.replaceChildren(
      Object.assign(document.createElement("span"), {
        textContent: `${n} arquivo(s) soltos na pasta principal (versão anterior). Os novos já vão para a subpasta da empresa.`,
      }),
      btn
    );
    btn.addEventListener("click", async () => {
      if (!root.confirm(`Mover ${n} arquivo(s) para a subpasta da empresa de cada um?\n\nNada é apagado: cada arquivo é gravado na subpasta e só depois sai da pasta principal.`)) return;
      btn.disabled = true;
      const res = await Store.organizeByCompany();
      box.dataset.done = "1";
      const skip = res.skipped.length ? ` ${res.skipped.length} ficaram onde estavam (${res.skipped.map((x) => `${x.fileName}: ${x.reason}`).join("; ")}).` : "";
      box.replaceChildren(
        Object.assign(document.createElement("span"), {
          textContent: `✅ ${res.moved} arquivo(s) organizados em ${res.dirs.length} subpasta(s): ${res.dirs.join(", ") || "--"}.${skip}`,
        })
      );
      if (typeof onRefresh === "function") onRefresh();
    });
  }

  /** Filtro, agrupamento e aviso de arquivos soltos numa lista de documentos. */
  function attach(ul, opts) {
    const o = opts || {};
    if (!ul) return;
    companyFilter(ul, o.key || "docs");
    organizeBanner(ul, o.onRefresh);
  }

  root.LeanOrgUI = { attach, companyFilter, backupZip };
})(typeof self !== "undefined" ? self : this);
