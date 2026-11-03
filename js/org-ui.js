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

  root.LeanOrgUI = { attach, companyFilter };
})(typeof self !== "undefined" ? self : this);
