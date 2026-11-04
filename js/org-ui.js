/**
 * ============================================================================
 * LEAN CHRONO & MFV — ORGANIZAÇÃO POR EMPRESA NAS LISTAS (REV 1.26)
 * ----------------------------------------------------------------------------
 * Usado nas janelas de Estudos, MFVs, Grupos e Planos:
 *  - filtro "Empresa" e agrupamento da lista por empresa (itens com data-client);
 *  - aviso dos arquivos soltos na pasta principal (versões anteriores), com o botão
 *    "Organizar por empresa", que os move para a subpasta de cada empresa.
 *  - REV 1.30: empresa ativa compartilhada pelas 4 páginas (selo no cabeçalho, filtro das
 *    listas e documento aberto ao entrar na página).
 *  - REV 1.29: renomear a empresa em todos os documentos (pergunta ao mudar o cliente no
 *    cabeçalho e botão "Renomear empresa" na lista).
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

  /* --------------------------------------------------------------------------
     EMPRESA ATIVA (REV 1.30)
     -------------------------------------------------------------------------- */

  const ACTIVE_KEY = "lean:empresaAtiva";

  /** Empresa do último documento aberto em qualquer página: { key, name } ou null. */
  function activeCompany() {
    try {
      const v = JSON.parse(root.localStorage.getItem(ACTIVE_KEY) || "null");
      return v && v.key ? v : null;
    } catch (err) {
      return null;
    }
  }

  function setActiveCompany(name) {
    const n = String(name || "").trim();
    const key = Calc.companyKey(n);
    if (!key) return;
    try {
      root.localStorage.setItem(ACTIVE_KEY, JSON.stringify({ key, name: n }));
    } catch (err) {
      /* sem armazenamento local: vale só nesta página */
    }
    renderBadge();
  }

  /** Selo "Empresa: …" ao lado da revisão, no cabeçalho. */
  function renderBadge() {
    if (typeof document === "undefined") return;
    const rev = document.querySelector(".app-header .app-rev");
    if (!rev) return;
    let badge = document.querySelector(".app-header .app-company");
    if (!badge) {
      badge = Object.assign(document.createElement("span"), { className: "app-company" });
      badge.title = "Empresa ativa: as outras páginas abrem nesta empresa";
      rev.after(badge);
    }
    const a = activeCompany();
    badge.hidden = !a;
    badge.textContent = a ? `Empresa: ${a.name}` : "";
  }

  /**
   * Documento a abrir ao entrar na página. docs = documentos da página (mais recente primeiro);
   * lastId = último aberto nesta página. Sem empresa ativa: o último (como antes).
   * Retorna { doc, count } (count = documentos da empresa) | { none: true, name } | null.
   */
  function pickForActive(docs, lastId) {
    const a = activeCompany();
    const list = (docs || []).filter(Boolean);
    if (!a) {
      const last = list.find((d) => d.id === lastId);
      return last ? { doc: last, count: 1 } : null;
    }
    const same = list.filter((d) => Calc.companyKey(d.clientName) === a.key);
    if (!same.length) return { none: true, name: a.name };
    return { doc: same.find((d) => d.id === lastId) || same[0], count: same.length };
  }

  /**
   * Seletor "MFV da empresa" / "Grupo da empresa" (REV 1.30): os documentos da empresa do
   * documento aberto, com a data da última alteração, e "+ Novo …". docs = documentos da página;
   * current = documento aberto (prevalece sobre a cópia da lista). Retorna quantos são da empresa.
   */
  function renderSwitch(select, docs, current, label, newLabel) {
    if (!select) return 0;
    const box = select.parentElement;
    if (!current) {
      box.hidden = true;
      return 0;
    }
    const key = Calc.companyKey(current.clientName);
    const same = [current].concat((docs || []).filter((d) => d && d.id !== current.id && key && Calc.companyKey(d.clientName) === key));
    same.sort((a, b) => String(label(a)).localeCompare(String(label(b)), "pt-BR"));
    const date = (iso) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
      return m ? ` (${m[3]}/${m[2]})` : "";
    };
    select.replaceChildren(
      ...same.map((d) => Object.assign(document.createElement("option"), { value: d.id, textContent: `${label(d) || "(sem nome)"}${date(d.updatedAt)}` })),
      Object.assign(document.createElement("option"), { value: "__new", textContent: newLabel })
    );
    select.value = current.id;
    box.hidden = false;
    return same.length;
  }

  /** Destaca o seletor por alguns segundos (empresa com vários documentos). */
  function flagSwitch(select) {
    if (!select) return;
    select.classList.add("switch-attention");
    setTimeout(() => select.classList.remove("switch-attention"), 6000);
  }

  /**
   * Agrupa os itens (li com data-client) por empresa, em ordem alfabética ("Sem cliente" no fim),
   * mantendo a ordem original dentro de cada empresa, e aplica o filtro escolhido.
   */
  function companyFilter(ul, key, onRefresh) {
    const items = Array.from(ul.children).filter((li) => li.dataset && li.dataset.client != null);
    ul.querySelectorAll("li.company-head").forEach((h) => h.remove());
    const header = ul.previousElementSibling;
    let sel = header ? header.querySelector("select.company-filter") : null;
    const groups = new Map();
    items.forEach((li) => {
      const name = String(li.dataset.client || "").trim();
      const k = name ? Calc.companyKey(name) : NONE;
      if (!groups.has(k)) groups.set(k, { name: name || "Sem cliente", items: [] });
      groups.get(k).items.push(li);
    });
    const keys = Array.from(groups.keys()).sort((a, b) => (a === NONE) - (b === NONE) || groups.get(a).name.localeCompare(groups.get(b).name, "pt-BR"));
    const many = keys.length > 1;
    backupButton(header, () => (sel && many && sel.value ? sel.value : null), groups);
    const renameBtn = renameButton(header, groups, onRefresh);
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
      // Uma empresa só: "Renomear empresa" vale para ela
      if (renameBtn) renameBtn.__key = keys.length === 1 && keys[0] !== NONE ? keys[0] : null;
      if (renameBtn) renameBtn.hidden = !renameBtn.__key;
      return;
    }
    // REV 1.30: a empresa ativa (ao montar e quando ela muda); fora isso, a escolha feita na lista
    const act = activeCompany();
    const fresh = !sel.__ready || (act && sel.__active !== act.key);
    const saved = !fresh ? sel.value : act ? (keys.includes(act.key) ? act.key : "") : remember(key);
    sel.__ready = true;
    sel.__active = act ? act.key : null;
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
      if (renameBtn) {
        renameBtn.__key = v && v !== NONE ? v : null;
        renameBtn.hidden = !renameBtn.__key;
      }
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

  /* --------------------------------------------------------------------------
     RENOMEAR EMPRESA EM TODOS OS DOCUMENTOS (REV 1.29)
     -------------------------------------------------------------------------- */

  const KIND_SHORT = { Crono: "estudo(s)", MFV: "MFV(s)", Yamazumi: "grupo(s)", Plano: "plano(s)" };
  // Campo "Empresa / Cliente" do documento aberto nesta página (registrado por watchClient)
  let current = null;

  /** Documentos da empresa oldKey que mudariam (fora o aberto e os que já têm o nome novo). */
  async function renameTargets(oldKey, name, excludeId) {
    const docs = await Store.collectCompanyDocs(oldKey);
    return docs.filter((d) => {
      try {
        const doc = JSON.parse(d.text);
        return doc.id !== excludeId && String(doc.clientName || "").trim() !== name;
      } catch (err) {
        return false;
      }
    });
  }

  /**
   * Pergunta e renomeia. oldLabel = grafia antiga (para a mensagem). Retorna o resultado de
   * Store.renameCompany, ou null quando não havia o que mudar ou o consultor disse não.
   */
  async function renameFlow(oldKey, oldLabel, newName, excludeId, ask) {
    const name = String(newName || "").trim();
    if (!name || !Store.renameCompany) return null;
    const targets = await renameTargets(oldKey, name, excludeId);
    if (!targets.length) return null;
    const count = {};
    targets.forEach((d) => (count[d.kind] = (count[d.kind] || 0) + 1));
    const resume = Object.keys(count).map((k) => `${count[k]} ${KIND_SHORT[k] || k}`).join(", ");
    const names = targets.slice(0, 8).map((d) => `  • ${d.fileName}`).join("\n") + (targets.length > 8 ? `\n  • … e mais ${targets.length - 8}` : "");
    const merge = Calc.companyKey(name) !== oldKey ? (await Store.collectCompanyDocs(Calc.companyKey(name))).length : 0;
    const msg =
      `${ask}\n\nAplicar "${name}" também aos outros ${targets.length} documento(s) de "${oldLabel}" (${resume})?\n\n${names}` +
      (merge ? `\n\nAtenção: já existem ${merge} documento(s) com o nome "${name}". As duas empresas vão ficar juntas.` : "") +
      "\n\nSó o nome da empresa muda (tempos, etapas e ligações ficam iguais). Arquivados ficam como estão." +
      "\nOK = renomear todos • Cancelar = só este documento";
    if (!root.confirm(msg)) return null;
    const res = await Store.renameCompany(oldKey, name, { excludeId });
    root.dispatchEvent(new root.CustomEvent("lean:company-renamed", { detail: { oldKey, name, count: res.count } }));
    const err = res.errors.length ? `\n\n${res.errors.length} arquivo(s) não foram alterados: ${res.errors.map((e) => `${e.fileName} (${e.error})`).join("; ")}` : "";
    root.alert(`✅ ${res.count} documento(s) renomeado(s) para "${name}".${err}`);
    return res;
  }

  /**
   * B — campo "Empresa / Cliente" do cabeçalho: ao terminar de editar (change), se a grafia mudou
   * e há outros documentos da empresa antiga, pergunta se renomeia todos.
   * getId() = id do documento aberto; onDone(res) = recarregar as listas da página.
   */
  function watchClient(input, getId, onDone) {
    if (!input) return;
    current = { input, getId };
    const remember = () => (input.__old = input.value);
    input.addEventListener("focus", remember);
    input.addEventListener("change", async () => {
      const old = String(input.__old || "").trim();
      const name = input.value.trim();
      input.__old = input.value;
      if (name) setActiveCompany(name);
      if (!old || !name || old === name) return;
      try {
        const res = await renameFlow(Calc.companyKey(old), old, name, getId && getId(), `Empresa do documento aberto: "${old}" → "${name}".`);
        if (res && typeof onDone === "function") onDone(res);
      } catch (err) {
        root.alert(`Não foi possível renomear os outros documentos: ${err.message || err}`);
      }
    });
  }

  /** C — botão "Renomear empresa" no cabeçalho da lista (empresa do filtro). */
  function renameButton(header, groups, onRefresh) {
    if (!header || !Store.renameCompany) return null;
    let btn = header.querySelector("button.btn-rename-company");
    if (!btn) {
      btn = Object.assign(document.createElement("button"), { type: "button", className: "btn-outline btn-small btn-rename-company", textContent: "Renomear empresa" });
      btn.title = "Troca o nome da empresa escolhida no filtro em todos os estudos, MFVs, grupos e planos";
      header.append(btn);
      btn.addEventListener("click", async () => {
        const k = btn.__key;
        if (!k) return;
        const oldLabel = (btn.__groups.get(k) || {}).name || "";
        const typed = root.prompt(`Novo nome da empresa "${oldLabel}" (vale para todos os documentos dela):`, oldLabel);
        const name = String(typed || "").trim();
        if (!name || name === oldLabel) return;
        btn.disabled = true;
        try {
          // O documento aberto muda pelo próprio campo (a página grava como sempre)
          const openId = current && current.getId ? current.getId() : null;
          const openIsHere = current && Calc.companyKey(current.input.value) === k;
          const res = await renameFlow(k, oldLabel, name, openIsHere ? openId : null, `Renomear a empresa "${oldLabel}" para "${name}".`);
          if (res && openIsHere) {
            current.input.value = name;
            current.input.__old = name;
            current.input.dispatchEvent(new root.Event("input", { bubbles: true }));
          }
          if (res && typeof btn.__refresh === "function") btn.__refresh();
        } catch (err) {
          root.alert(`Não foi possível renomear a empresa: ${err.message || err}`);
        } finally {
          btn.disabled = false;
        }
      });
    }
    btn.__groups = groups;
    btn.__refresh = onRefresh;
    return btn;
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
    companyFilter(ul, o.key || "docs", o.onRefresh);
    organizeBanner(ul, o.onRefresh);
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderBadge);
    else renderBadge();
  }

  root.LeanOrgUI = { attach, companyFilter, backupZip, watchClient, renameFlow, activeCompany, setActiveCompany, pickForActive, renderBadge, renderSwitch, flagSwitch };
})(typeof self !== "undefined" ? self : this);
