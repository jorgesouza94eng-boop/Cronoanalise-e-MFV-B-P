/**
 * ============================================================================
 * LEAN CHRONO & MFV — JANELA "DEFINIR ETAPAS DO PROCESSO" (REV 1.25)
 * ----------------------------------------------------------------------------
 * Escolha da etapa de cada elemento, uma vez por elemento (vale para todas as
 * linhas dele no produto), com aplicação em lote, prévia do TP por etapa e
 * sugestão opcional da IA (que só preenche elementos sem etapa). Nada é gravado
 * até "Salvar etapas".
 * Depende de: LeanCalc, LeanApp, LeanUI (avisos) e, para a IA, LeanAIUI.
 * ============================================================================
 */
(function (root) {
  "use strict";

  const Calc = root.LeanCalc;
  const $ = (id) => document.getElementById(id);
  const app = () => root.LeanApp;

  // Rascunho por produto: Map(chave do produto → Map(chave do elemento → etapa digitada))
  let draft = new Map();
  let fromAi = new Set(); // `${produto}|${elemento}` sugeridos pela IA (destaque na tabela)
  let draftStudyId = null;
  let productKey = null;
  let lists = new Map(); // cache dos elementos por produto (refeito a cada abertura)

  function toast(text, kind, ms) {
    if (root.LeanUI && root.LeanUI.toast) root.LeanUI.toast(text, kind, ms);
  }

  function el(tag, props, children) {
    const n = document.createElement(tag);
    Object.assign(n, props || {});
    (children || []).forEach((c) => n.append(c));
    return n;
  }

  const study = () => app() && app().state.study;
  const computed = () => Calc.computeStudy(study());

  function productDraft(pk) {
    if (!draft.has(pk)) draft.set(pk, new Map());
    return draft.get(pk);
  }

  function listOf(pk) {
    if (!lists.has(pk)) lists.set(pk, Calc.etapaElements(study(), pk, computed()));
    return lists.get(pk);
  }

  /** Nomes de etapa já usados no estudo e no rascunho (sugestões do campo). */
  function etapaNames() {
    const names = new Map();
    const add = (v) => {
      const t = String(v || "").trim().replace(/\s+/g, " ");
      if (t && !names.has(Calc.elementKey(t))) names.set(Calc.elementKey(t), t);
    };
    (study().elements || []).forEach((e) => add(e.etapa));
    draft.forEach((m) => m.forEach(add));
    return Array.from(names.values());
  }

  function changesOf(pk) {
    return Calc.etapaAssignPlan(study(), listOf(pk), productDraft(pk));
  }

  function render() {
    const st = study();
    const r = computed();
    const products = r.products;
    if (!products.some((p) => p.key === productKey)) productKey = (r.product && r.product.key) || products[0].key;
    const sel = $("et-product");
    sel.replaceChildren(...products.map((p) => el("option", { value: p.key, textContent: p.name || "Produto único", selected: p.key === productKey })));
    $("et-product-wrap").hidden = products.length < 2;
    const u = Calc.TIME_UNITS[r.unit] ? r.unit : "s";
    $("et-time-head").textContent = `Tempo (${Calc.TIME_UNITS[u].label})`;
    const list = listOf(productKey);
    const d = productDraft(productKey);
    $("et-tbody").replaceChildren(
      ...(list.length
        ? list.map((g) => {
            const mixed = g.etapa === null;
            const value = d.has(g.key) ? d.get(g.key) : mixed ? "" : g.etapa;
            const input = el("input", {
              type: "text",
              className: "input-cell et-input" + (fromAi.has(`${productKey}|${g.key}`) && d.has(g.key) ? " is-ai" : ""),
              value,
              placeholder: mixed ? "(várias — manter)" : "Etapa",
              autocomplete: "off",
              title: mixed ? "As linhas deste elemento estão em etapas diferentes: deixe vazio para manter, ou digite uma etapa para todas" : "",
            });
            input.setAttribute("list", "et-names");
            input.dataset.key = g.key;
            const tr = el("tr", {}, [
              el("td", { className: "et-check" }, [el("input", { type: "checkbox", className: "et-sel" })]),
              el("td", { className: "cell-num", textContent: String(g.firstSeq).padStart(2, "0") }),
              el("td", { className: "cell-text", textContent: g.name + (g.rows.length > 1 ? ` (${g.rows.length} linhas)` : "") }),
              el("td", { className: "mono", textContent: g.type }),
              el("td", { className: "mono", textContent: Calc.formatTime(g.cycleTime, u) }),
              el("td", { className: "mono", textContent: `${Calc.formatNumber(g.sharePct, 1)}%` }),
              el("td", {}, [input]),
            ]);
            tr.dataset.key = g.key;
            return tr;
          })
        : [el("tr", {}, [Object.assign(el("td", { className: "cell-text text-muted", textContent: "Este produto ainda não tem elementos com nome." }), { colSpan: 7 })])])
    );
    $("et-all").checked = false;
    $("et-names").replaceChildren(...etapaNames().map((n) => el("option", { value: n })));
    renderPreview();
    if (st) draftStudyId = st.id;
  }

  /** Prévia do TP por etapa com o rascunho (calculada pelo app, não pela IA). */
  function renderPreview() {
    const r = computed();
    const u = Calc.TIME_UNITS[r.unit] ? r.unit : "s";
    const lbl = Calc.TIME_UNITS[u].label;
    const changes = changesOf(productKey);
    const pv = Calc.etapaPreview(study(), productKey, changes);
    const box = $("et-preview");
    const total = changesOfAll().length;
    const parts = pv.etapas.map((e, i) => `${i + 1}. ${e.name} ${Calc.formatTime(e.tp, u)} ${lbl}`);
    const empty = listOf(productKey).filter((g) => {
      const d = productDraft(productKey);
      const v = d.has(g.key) ? d.get(g.key) : g.etapa;
      return v === "";
    }).length;
    box.replaceChildren(
      el("strong", { textContent: "Prévia do TP por etapa: " }),
      el("span", { textContent: parts.length ? `${parts.join(" • ")} • Total ${Calc.formatTime(pv.tp, u)} ${lbl}` : "nenhuma etapa definida" }),
      el("div", {
        className: "et-preview-sub",
        textContent:
          `${total} linha(s) a alterar ao salvar.` +
          (empty ? ` ${empty} elemento(s) sem etapa ficam em "(sem etapa)" quando o produto tiver etapas.` : ""),
      })
    );
  }

  function changesOfAll() {
    const all = [];
    draft.forEach((m, pk) => {
      if (m.size) all.push(...Calc.etapaAssignPlan(study(), listOf(pk), m));
    });
    return all;
  }

  /**
   * Abre a janela. opts.draft: Map(produto → Map(elemento → etapa)) — sugestões da IA, que entram
   * só nos elementos sem etapa; opts.productKey: produto inicial.
   */
  function open(opts) {
    const o = opts || {};
    const st = study();
    if (!st) return;
    if (draftStudyId !== st.id) {
      draft = new Map();
      fromAi = new Set();
    }
    lists = new Map();
    if (o.draft) {
      o.draft.forEach((m, pk) => {
        const list = listOf(pk);
        const d = productDraft(pk);
        m.forEach((value, key) => {
          const g = list.find((x) => x.key === key);
          if (!g || g.etapa !== "") return; // a IA não troca etapa já definida
          d.set(key, value);
          fromAi.add(`${pk}|${key}`);
        });
      });
    }
    if (o.productKey != null) productKey = o.productKey;
    render();
    const dlg = $("etapas-dialog");
    if (!dlg.open) dlg.showModal();
  }

  function save() {
    const changes = changesOfAll();
    if (!changes.length) {
      toast("Nenhuma etapa alterada.", "info");
      return close(true);
    }
    const n = app().applyEtapas(changes);
    toast(`Etapas gravadas em ${n} linha(s). No MFV, use "+ Etapa do estudo" para ter 1 barra por etapa no GBO.`, "ok", 8000);
    close(true);
  }

  function close(discard) {
    if (discard) {
      draft = new Map();
      fromAi = new Set();
    }
    $("etapas-dialog").close();
  }

  function init() {
    if (!$("etapas-dialog")) return;
    $("btn-define-etapas").addEventListener("click", () => open());
    $("et-product").addEventListener("change", (e) => {
      productKey = e.target.value;
      render();
    });
    $("et-tbody").addEventListener("input", (e) => {
      if (!e.target.classList.contains("et-input")) return;
      const key = e.target.dataset.key;
      const g = listOf(productKey).find((x) => x.key === key);
      // Elemento em várias etapas: campo vazio = manter como está
      if (g && g.etapa === null && !e.target.value.trim()) productDraft(productKey).delete(key);
      else productDraft(productKey).set(key, e.target.value);
      e.target.classList.remove("is-ai");
      renderPreview();
    });
    $("et-all").addEventListener("change", (e) => $("et-tbody").querySelectorAll(".et-sel").forEach((c) => (c.checked = e.target.checked)));
    $("btn-et-bulk").addEventListener("click", () => {
      const v = $("et-bulk").value.trim().replace(/\s+/g, " ");
      const rows = Array.from($("et-tbody").querySelectorAll("tr[data-key]")).filter((tr) => tr.querySelector(".et-sel").checked);
      if (!rows.length) return toast("Marque os elementos que vão para essa etapa.", "warn");
      rows.forEach((tr) => productDraft(productKey).set(tr.dataset.key, v));
      $("et-bulk").value = "";
      render();
    });
    $("btn-et-ai").addEventListener("click", () => {
      if (!root.LeanAIUI) return;
      $("etapas-dialog").close(); // o rascunho fica guardado até salvar ou cancelar
      root.LeanAIUI.suggestEtapas();
    });
    $("btn-et-save").addEventListener("click", save);
    const cancel = () => {
      if (changesOfAll().length && !root.confirm("Descartar as etapas não salvas?")) return;
      close(true);
    };
    $("btn-et-cancel").addEventListener("click", cancel);
    $("btn-et-close").addEventListener("click", cancel);
    $("etapas-dialog").addEventListener("cancel", (e) => {
      e.preventDefault();
      cancel();
    });
  }

  root.LeanEtapas = { open };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(typeof self !== "undefined" ? self : this);
