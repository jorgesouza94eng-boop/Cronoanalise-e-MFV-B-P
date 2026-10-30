/**
 * ============================================================================
 * LEAN CHRONO & MFV — PREENCHIMENTO DO MODELO EXCEL B+P (CRONOANÁLISE REV2)
 * ----------------------------------------------------------------------------
 * Abre a planilha-modelo do consultor (.xlsm/.xlsx), preenche SOMENTE as células
 * de entrada e preserva todo o resto: fórmulas, gráficos, macros (VBA), cores,
 * comentários e abas ocultas. As partes não alteradas do arquivo são copiadas
 * byte a byte; o Excel recalcula tudo ao abrir.
 *
 * Mapeamento (planilha "01_Cronoanalise_das_Atividades_REV2.0"):
 *   GERAL (linhas 10–300): B Nº | C Elemento | D Tempo (Início) | E Tempo (Fim) |
 *                          G Quantidade | I Tipo | L lista de elementos | S observações
 *   Listagem de Elementos (linhas 9–134): B Elemento | C Tempo (s) | D Qt. | E Valor | G Desperdício
 *   Compilação e Soluções: B55 constatações e soluções
 *   Análise: C16 identificação do estudo
 *
 * Mapeamento (planilha "04_MFV_SIMPLIFICADO" REV1, aba EP — estado presente):
 *   D5 empresa | D6 família | C22:F28 horário (entrada, saída, pausas, refeição) |
 *   K28 disponibilidade | O21 demanda mensal | O26 dias úteis | P23 unidade do takt |
 *   D35 unidade do TC | B39:G51 etapas (X Kaizen, etapa, TC, nº ops, uptime) | K37 operadores |
 *   B55:D64 estoques | B76:B95 premissas. A aba EF recebe os dados gerais com etapas em branco.
 *
 * Depende de: LeanCalc (calc.js) e LeanXlsx (xlsx.js). Também roda no Node (testes).
 * ============================================================================
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./calc.js"), require("./xlsx.js"));
  } else {
    root.LeanXlsxTemplate = factory(root.LeanCalc, root.LeanXlsx);
  }
})(typeof self !== "undefined" ? self : this, function (Calc, Xlsx) {
  "use strict";

  const LIMITS = { geralFirst: 10, geralLast: 300, listFirst: 9, listLast: 134, analiseSum: 40 };
  const SHEETS = { geral: "GERAL", listagem: "Listagem de Elementos", compilacao: "Compilação e Soluções", analise: "Análise", bd: "BD" };

  /* ==========================================================================
     LEITURA DO ZIP (.xlsx/.xlsm)
     ========================================================================== */

  /** Descompactação "deflate-raw": nativa do navegador (sem bibliotecas). */
  async function browserInflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** Lê o diretório central do ZIP. Não descompacta nada ainda. */
  function readZip(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("Arquivo não é um Excel válido (.xlsx/.xlsm)");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    const entries = [];
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("Estrutura do arquivo Excel corrompida");
      const method = dv.getUint16(p + 10, true);
      const crc = dv.getUint32(p + 16, true);
      const csize = dv.getUint32(p + 20, true);
      const size = dv.getUint32(p + 24, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      entries.push({ name, method, crc, size, compressed: bytes.subarray(start, start + csize) });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  async function entryText(entry, inflate) {
    const data = entry.method === 0 ? entry.compressed : await inflate(entry.compressed);
    return new TextDecoder().decode(data);
  }

  /* ==========================================================================
     XML DA PLANILHA (EDIÇÃO CIRÚRGICA DE CÉLULAS)
     ========================================================================== */

  function unescapeXml(s) {
    return s
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
      .replace(/&amp;/g, "&");
  }

  function parseSharedStrings(xml) {
    if (!xml) return [];
    return Array.from(xml.matchAll(/<si>([\s\S]*?)<\/si>/g)).map((m) =>
      unescapeXml(Array.from(m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((t) => t[1]).join(""))
    );
  }

  function colIndex(ref) {
    const letters = ref.match(/^[A-Z]+/)[0];
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  /** Divide o XML da planilha em linhas: { head, rows: Map<nº, xml>, order: [nº], tail }. */
  function splitRows(xml) {
    const open = xml.search(/<sheetData\s*\/>|<sheetData>/);
    if (open < 0) throw new Error("Planilha sem dados");
    if (/^<sheetData\s*\/>/.test(xml.slice(open))) {
      const end = xml.indexOf("/>", open) + 2;
      return { head: xml.slice(0, open) + "<sheetData>", rows: new Map(), order: [], tail: "</sheetData>" + xml.slice(end) };
    }
    const start = open + "<sheetData>".length;
    const end = xml.indexOf("</sheetData>", start);
    const rows = new Map();
    for (const m of xml.slice(start, end).matchAll(/<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g)) {
      rows.set(Number(m[0].match(/\br="(\d+)"/)[1]), m[0]);
    }
    return { head: xml.slice(0, start), rows, order: Array.from(rows.keys()), tail: xml.slice(end) };
  }

  function joinRows(parts) {
    const nums = Array.from(parts.rows.keys()).sort((a, b) => a - b);
    return parts.head + nums.map((n) => parts.rows.get(n)).join("") + parts.tail;
  }

  function rowCells(rowXml) {
    const m = rowXml.match(/^<row\b([^>]*?)(\/?)>/);
    const attrs = m[1];
    const inner = m[2] === "/" ? "" : rowXml.slice(m[0].length, rowXml.length - "</row>".length);
    const cells = new Map();
    for (const c of inner.matchAll(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)) {
      cells.set(c[0].match(/\br="([A-Z]+\d+)"/)[1], c[0]);
    }
    return { attrs, cells };
  }

  /** Texto atual de uma célula (número, texto compartilhado ou texto embutido). */
  function cellText(cellXml, sst) {
    if (!cellXml) return "";
    const t = (cellXml.match(/\bt="([^"]+)"/) || [])[1];
    if (t === "inlineStr") {
      return unescapeXml(Array.from(cellXml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((x) => x[1]).join(""));
    }
    const v = (cellXml.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
    if (v == null) return "";
    return t === "s" ? sst[Number(v)] || "" : unescapeXml(v);
  }

  function getCell(parts, ref, sst) {
    const row = parts.rows.get(Number(ref.match(/\d+/)[0]));
    return row ? cellText(rowCells(row).cells.get(ref), sst) : "";
  }

  /**
   * Aplica alterações: updates = Map<"C10", valor>. Valor: número, texto ou null (limpa
   * mantendo a formatação da célula). Fórmulas nunca são alteradas.
   */
  function applyUpdates(parts, updates, force) {
    const byRow = new Map();
    updates.forEach((value, ref) => {
      const n = Number(ref.match(/\d+/)[0]);
      if (!byRow.has(n)) byRow.set(n, []);
      byRow.get(n).push([ref, value]);
    });
    byRow.forEach((list, n) => {
      const existing = parts.rows.get(n);
      // Linha inexistente e nada a gravar: não cria linha vazia.
      if (!existing && list.every(([, v]) => v == null || v === "")) return;
      const { attrs, cells } = existing ? rowCells(existing) : { attrs: ` r="${n}"`, cells: new Map() };
      list.forEach(([ref, value]) => {
        const old = cells.get(ref);
        // Nunca sobrescreve fórmula — exceto células de ENTRADA em que o consultor digitou
        // uma conta (ex.: demanda "=1240/6*26" no MFV da Laje Forte), listadas em "force".
        if (old && /<f[\s>/]/.test(old) && !(force && force.has(ref))) return;
        if (!old && (value == null || value === "")) return; // nada a limpar
        const style = old ? (old.match(/\bs="(\d+)"/) || [])[0] : null;
        const s = style ? ` ${style}` : "";
        if (value == null || value === "") cells.set(ref, `<c r="${ref}"${s}/>`);
        else if (typeof value === "number" && Number.isFinite(value)) cells.set(ref, `<c r="${ref}"${s}><v>${value}</v></c>`);
        else cells.set(ref, `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${Xlsx.esc(value)}</t></is></c>`);
      });
      const sorted = Array.from(cells.entries()).sort((a, b) => colIndex(a[0]) - colIndex(b[0]));
      // "spans" é só uma dica de desempenho; removida porque as colunas podem mudar.
      const head = attrs.replace(/\s+spans="[^"]*"/, "");
      parts.rows.set(n, `<row${head}>${sorted.map((c) => c[1]).join("")}</row>`);
    });
  }

  /** Remove os resultados guardados das fórmulas, para que o Excel/LibreOffice recalcule. */
  function dropCachedFormulaValues(xml) {
    return xml.replace(/<c\b([^>]*?)>(<f\b[^>]*?(?:\/>|>[\s\S]*?<\/f>))(?:<v>[\s\S]*?<\/v>|<v\/>)?<\/c>/g, (m, attrs, f) => {
      const a = attrs.replace(/\s+t="(?:str|b|e|n)"/, "");
      return `<c${a}>${f}</c>`;
    });
  }

  /* ==========================================================================
     MODELO: CARREGAR E RECONHECER
     ========================================================================== */

  const norm = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  /**
   * Abre o modelo e confere se é a planilha de cronoanálise B+P.
   * @returns {Promise<object>} modelo pronto para preencher
   * @throws Error com a explicação, se não for reconhecido
   */
  async function loadTemplate(bytes, options) {
    const inflate = (options && options.inflate) || browserInflate;
    const entries = readZip(bytes);
    const byName = new Map(entries.map((e) => [e.name, e]));
    const text = async (name) => (byName.has(name) ? entryText(byName.get(name), inflate) : null);

    const workbook = await text("xl/workbook.xml");
    const rels = await text("xl/_rels/workbook.xml.rels");
    if (!workbook || !rels) throw new Error("Arquivo não é uma pasta de trabalho do Excel");
    const relTarget = new Map(
      Array.from(rels.matchAll(/<Relationship\b[^>]*>/g)).map((m) => [
        (m[0].match(/\bId="([^"]+)"/) || [])[1],
        (m[0].match(/\bTarget="([^"]+)"/) || [])[1],
      ])
    );
    const sheetPath = new Map();
    for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
      const name = unescapeXml((m[0].match(/\bname="([^"]+)"/) || [])[1] || "");
      const target = relTarget.get((m[0].match(/\br:id="([^"]+)"/) || [])[1]);
      if (target) sheetPath.set(name, target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);
    }
    const expect = options && options.expect;
    // Plano de ação 5W2H (REV 1.19): aba "5W2H" com o cabeçalho O que / Como / Quem…
    const planoSheet = Array.from(sheetPath.keys()).find((n) => norm(n) === "5w2h");
    if (planoSheet && !sheetPath.has(SHEETS.geral) && !sheetPath.has("EP")) {
      if (expect === "crono" || expect === "mfv") throw new Error("Este arquivo é o modelo do Plano de Ação (5W2H): carregue-o na página Plano de Ação.");
      return recognizePlano({ entries, byName, text, workbook, rels, sheetPath, name: planoSheet });
    }
    if (expect === "plano") throw new Error('Este arquivo não é o modelo do Plano de Ação (aba "5W2H" não encontrada).');
    if (sheetPath.has("EP") && !sheetPath.has(SHEETS.geral)) {
      if (expect === "crono") throw new Error("Este arquivo é o modelo do MFV: carregue-o na página do MFV.");
      return recognizeMfv({ entries, byName, text, workbook, sheetPath });
    }
    if (expect === "mfv") throw new Error("Este arquivo não é o modelo do MFV Simplificado (aba EP não encontrada).");
    const missing = [SHEETS.geral, SHEETS.listagem, SHEETS.compilacao].filter((n) => !sheetPath.has(n));
    if (missing.length) throw new Error(`Modelo não reconhecido: faltam as abas ${missing.join(", ")}`);

    const sst = parseSharedStrings(await text("xl/sharedStrings.xml"));
    const sheets = {};
    for (const [key, name] of Object.entries(SHEETS)) {
      if (sheetPath.has(name)) sheets[key] = { name, path: sheetPath.get(name), parts: splitRows(await text(sheetPath.get(name))) };
    }

    // Cabeçalhos (linha 8) que identificam a REV2
    const expectGeral = { C8: "elemento", D8: "tempo (inicio)", E8: "tempo (fim)", G8: "quantidade", I8: "tipo", L8: "todos elementos" };
    const expectList = { B8: "elemento", C8: "tempo (s)", D8: "qt.", E8: "valor" };
    const bad = [];
    Object.entries(expectGeral).forEach(([ref, label]) => {
      if (norm(getCell(sheets.geral.parts, ref, sst)) !== label) bad.push(`GERAL!${ref} ≠ "${label}"`);
    });
    Object.entries(expectList).forEach(([ref, label]) => {
      if (norm(getCell(sheets.listagem.parts, ref, sst)) !== label) bad.push(`Listagem!${ref} ≠ "${label}"`);
    });
    if (bad.length) throw new Error(`Layout diferente da REV2 (${bad.slice(0, 3).join("; ")}). Envie o modelo para ajustar o mapeamento.`);

    // Rótulos exatos usados pelas fórmulas da planilha (aba BD e quadro de desperdícios)
    const valueLabels = { AG: "Agrega", NA: "Não agrega", IN: "Incidental" };
    if (sheets.bd) {
      ["AG", "NA", "IN"].forEach((k, i) => {
        const v = getCell(sheets.bd.parts, `A${i + 1}`, sst);
        if (v) valueLabels[k] = v;
      });
    }
    const wasteLabels = {};
    for (let r = 39; r <= 60; r++) {
      const label = getCell(sheets.compilacao.parts, `D${r}`, sst);
      if (!label) break;
      const key = Object.keys(Calc.WASTES).find((k) => norm(Calc.WASTES[k]).startsWith(norm(label)));
      if (key) wasteLabels[key] = label; // mantém o texto exato (inclusive espaços) usado no CONT.SE
    }

    // REV2.1 (equipe, 17/10/2026): GERAL!F8 = "Ritmo (%)", peças em GERAL!D7 e tolerância em Análise!L6
    const rev = norm(getCell(sheets.geral.parts, "F8", sst)) === "ritmo (%)" ? "2.1" : "2.0";
    return { kind: "crono-rev2", rev, entries, sst, sheets, workbook, valueLabels, wasteLabels, macro: byName.has("xl/vbaProject.bin") };
  }

  /* ==========================================================================
     PREENCHIMENTO
     ========================================================================== */

  /** Gera o .xlsm/.xlsx preenchido. Retorna { bytes, warnings }. */
  function fillTemplate(tpl, study) {
    const r = Calc.computeStudy(study);
    const rev21 = tpl.rev === "2.1"; // planilha da equipe com ritmo, peças e tolerância
    const warnings = [];
    const qtyMode = r.mode === "quantidade";
    const geral = tpl.sheets.geral.parts;
    const listagem = tpl.sheets.listagem.parts;

    // ---- GERAL: só linhas com leitura válida (como na planilha: elemento + início + fim)
    const lines = [];
    let skipped = 0;
    // Vários produtos: a planilha recebe só o produto escolhido no resumo (um arquivo por produto).
    const onlyProduct = r.multiProduct ? r.product.key : null;
    study.elements.forEach((el, i) => {
      const row = r.rows[i];
      if (onlyProduct != null && row.productKey !== onlyProduct) return;
      if (!row.hasReading || !row.valid) {
        if (el.description || el.videoTime) skipped += 1;
        return;
      }
      const qty = qtyMode ? row.quantity : row.frequency > 0 ? 1 / row.frequency : 1;
      const pace = Calc.parsePace(el.pace).value;
      const nm = String(el.description || "").trim().replace(/\s+/g, " ");
      lines.push({
        pace: pace == null ? 100 : pace,
        key: (row.etapaKey ? `${row.etapaKey}|` : "") + (nm ? Calc.elementKey(nm) : `#${el.id}`),
        name: nm || `(linha ${row.seq})`,
        start: (row.timeMinutes - row.subtractedTime) / 1440, // fração de dia (hh:mm:ss no Excel)
        end: row.timeMinutes / 1440,
        qty,
        type: row.type,
      });
    });
    if (skipped) warnings.push(`${skipped} linha(s) sem tempo ou com erro não foram exportadas.`);
    if (!rev21 && r.summary.acyclic === "por-unidade") {
      warnings.push("A aba Análise do modelo REV2.0 soma os acíclicos sem dividir pelas peças; use o modelo REV2.1 para o mesmo TP do app.");
    }
    if (r.multiProduct && r.products.length > 1) {
      warnings.push(`Estudo com ${r.products.length} produtos: exportado só "${r.product.name}". Escolha o outro produto no resumo e exporte de novo.`);
    }
    if (!qtyMode) warnings.push("O estudo está no modo Frequência: a planilha usa Quantidade (exportado como 1 ÷ frequência).");
    const capacity = LIMITS.geralLast - LIMITS.geralFirst + 1;
    if (lines.length > capacity) throw new Error(`O estudo tem ${lines.length} lançamentos; o modelo comporta ${capacity} (linhas ${LIMITS.geralFirst}–${LIMITS.geralLast}).`);

    // Nomes iguais aos do resumo, para os SOMASE/CONT.SE da planilha agruparem igual ao app.
    // Com etapas (REV 1.15), o modelo não tem a coluna: o nome leva a etapa ("Moldagem • Passar a massa").
    const label = (g) => (r.withEtapas ? `${g.etapa} • ${g.name}` : g.name);
    const canonical = new Map(r.summary.elements.map((g) => [g.key, label(g)]));
    lines.forEach((l) => (l.name = canonical.get(l.key) || l.name));
    const elements = r.summary.elements.filter((g) => !g.unnamed).map((g) => (r.withEtapas ? Object.assign({}, g, { name: label(g) }) : g));
    if (r.withEtapas) warnings.push('O modelo B+P não tem coluna Etapa: o nome de cada elemento foi exportado com a etapa ("Etapa • Elemento").');
    const listCap = LIMITS.listLast - LIMITS.listFirst + 1;
    if (elements.length > listCap) throw new Error(`O estudo tem ${elements.length} elementos; a Listagem do modelo comporta ${listCap}.`);
    if (!rev21 && lines.some((l) => Math.abs(l.pace - 100) > 1e-9)) {
      warnings.push("A planilha REV2.0 não tem coluna de ritmo: os tempos foram exportados como observados (ritmo 100%). Use a REV2.1 para levar o ritmo.");
    }
    if (!rev21 && elements.length > LIMITS.analiseSum) {
      warnings.push(`Atenção: a aba Análise da planilha soma só ${LIMITS.analiseSum} elementos (T25:T64); com ${elements.length}, o "tempo de ciclo unitário" dela sairá menor que o do app.`);
    }

    const g = new Map();
    for (let n = LIMITS.geralFirst; n <= LIMITS.geralLast; n++) {
      const l = lines[n - LIMITS.geralFirst];
      const u = elements[n - LIMITS.geralFirst];
      g.set(`C${n}`, l ? l.name : null);
      g.set(`D${n}`, l ? l.start : null);
      g.set(`E${n}`, l ? l.end : null);
      g.set(`G${n}`, l ? l.qty : null);
      if (rev21) g.set(`F${n}`, l && Math.abs(l.pace - 100) > 1e-9 ? l.pace : null); // vazio = 100%
      g.set(`I${n}`, l ? l.type : null);
      g.set(`L${n}`, u ? u.name : null);
      g.set(`S${n}`, null); // observações de revisões anteriores do modelo
    }
    // REV2.1: peças das filmagens (acíclicos por unidade) em D7
    if (rev21) g.set("D7", r.summary.acyclic === "por-unidade" ? r.films.piecesTotal : null);
    applyUpdates(geral, g);

    // ---- Listagem de Elementos (valores do resumo do app; a coluna F "Ação" é fórmula)
    const missingWaste = new Set();
    const lst = new Map();
    for (let n = LIMITS.listFirst; n <= LIMITS.listLast; n++) {
      const e = elements[n - LIMITS.listFirst];
      lst.set(`B${n}`, e ? e.name : null);
      lst.set(`C${n}`, e ? Math.round(e.cycleTime * 60 * 1000) / 1000 : null);
      lst.set(`D${n}`, e ? Math.round(e.avgQuantity * 1000) / 1000 : null);
      lst.set(`E${n}`, e && e.value ? tpl.valueLabels[e.value] : null);
      let waste = null;
      if (e && e.waste) {
        waste = tpl.wasteLabels[e.waste] || Calc.WASTES[e.waste];
        if (!tpl.wasteLabels[e.waste]) missingWaste.add(Calc.WASTES[e.waste]);
      }
      lst.set(`G${n}`, waste);
    }
    applyUpdates(listagem, lst);
    if (missingWaste.size) {
      warnings.push(`Desperdício(s) sem linha no quadro da planilha (não entram no gráfico dela): ${Array.from(missingWaste).join(", ")}.`);
    }

    // ---- Compilação (constatações) e Análise (identificação)
    applyUpdates(tpl.sheets.compilacao.parts, new Map([["B55", study.notes || null]]));
    if (tpl.sheets.analise) {
      applyUpdates(
        tpl.sheets.analise.parts,
        new Map([
          ["C16", `${study.clientName || "Cliente"} — ${study.processName || "Posto"}${r.multiProduct ? ` — ${r.product.name}` : ""} (${r.filmCount} filmagem(ns), exportado pelo Lean Chrono)`],
          ["F15", null], // comentário da revisão anterior do modelo
        ].concat(rev21 ? [["L6", Calc.parseNumber(String(study.shiftParams.tolerancePct == null ? "" : study.shiftParams.tolerancePct)) || null]] : []))
      );
    }

    return { bytes: buildOutput(tpl, [tpl.sheets.bd]), warnings, lines: lines.length, elements: elements.length };
  }

  /** Monta o arquivo: abas alteradas sem compressão; todo o resto copiado byte a byte. */
  function buildOutput(tpl, untouchedSheets, extra) {
    const enc = new TextEncoder();
    const changed = new Map(extra && extra.replace ? extra.replace : []);
    Object.values(tpl.sheets).forEach((sh) => {
      if (!sh || (untouchedSheets || []).includes(sh)) return;
      changed.set(sh.path, dropCachedFormulaValues(joinRows(sh.parts)));
    });
    // Excel recalcula todas as fórmulas (e os gráficos) ao abrir
    const wbXml = changed.get("xl/workbook.xml") || tpl.workbook;
    changed.set(
      "xl/workbook.xml",
      /<calcPr\b/.test(wbXml)
        ? wbXml.replace(/<calcPr\b([^>]*?)\s*(\/?)>/, (m, a, sl) =>
            `<calcPr${a.replace(/\s+(?:fullCalcOnLoad|calcCompleted)="[^"]*"/g, "")} fullCalcOnLoad="1"${sl ? "/" : ""}>`
          )
        : wbXml.replace("</workbook>", '<calcPr fullCalcOnLoad="1"/></workbook>')
    );
    const files = tpl.entries.map((e) =>
      changed.has(e.name)
        ? { name: e.name, data: enc.encode(changed.get(e.name)) }
        : { name: e.name, raw: { method: e.method, compressed: e.compressed, crc: e.crc, size: e.size } }
    );
    ((extra && extra.add) || []).forEach((f) => files.push({ name: f.name, data: enc.encode(f.xml) }));
    return Xlsx.zip(files);
  }

  /* ==========================================================================
     MODELO DO MFV SIMPLIFICADO (ABA EP / EF)
     ========================================================================== */

  const MFV = { stepsFirst: 39, stepsLast: 51, stockFirst: 55, stockLast: 64, notesFirst: 76, notesLast: 95, days: [22, 28] };
  const TAKT_UNITS = { s: "SEGUNDOS", min: "MINUTOS", h: "HORAS" };

  async function recognizeMfv(wb) {
    const sst = parseSharedStrings(await wb.text("xl/sharedStrings.xml"));
    const sheets = {};
    for (const name of ["EP", "EF"]) {
      if (wb.sheetPath.has(name)) sheets[name] = { name, path: wb.sheetPath.get(name), parts: splitRows(await wb.text(wb.sheetPath.get(name))) };
    }
    const ep = sheets.EP.parts;
    const checks = { B20: "horario de trabalho", B21: "dias da semana", C38: "etapa", E38: "tc", F38: "num. ops", B54: "estoques" };
    const bad = Object.entries(checks).filter(([ref, label]) => !norm(getCell(ep, ref, sst)).startsWith(label));
    if (bad.length) {
      throw new Error(`Layout diferente do MFV Simplificado REV1 (${bad.slice(0, 3).map(([r, l]) => `EP!${r} ≠ "${l}"`).join("; ")}).`);
    }
    return { kind: "mfv-rev1", entries: wb.entries, sst, sheets, workbook: wb.workbook, macro: wb.byName.has("xl/vbaProject.bin") };
  }

  function getMfvLib() {
    if (typeof self !== "undefined" && self.LeanMfv) return self.LeanMfv;
    return require("./mfv-calc.js"); // Node (testes)
  }

  /**
   * Preenche o MFV. TCs exportados em HORAS ("HORAS / peça"): é a única unidade em que
   * todas as fórmulas da planilha (O27, K46, N46, U45) calculam de forma consistente.
   */
  function fillMfvTemplate(tpl, doc) {
    const M = getMfvLib();
    const r = M.computeMfv(doc);
    const warnings = [];
    const pu = doc.productUnit || "pç";
    const clock = (v) => {
      const p = M.parseClock(v);
      return p.minutes == null || p.error ? null : p.minutes / 1440;
    };
    const num = (v) => {
      const n = Calc.parseNumber(v);
      return Number.isFinite(n) ? n : null;
    };
    const maxSteps = MFV.stepsLast - MFV.stepsFirst + 1;
    // REV 1.14: etapa não medida não vai para a tabela de processos (fica nas premissas)
    const measured = doc.steps.map((st, i) => ({ st, calc: r.steps[i] })).filter((x) => !x.st.unmeasured);
    if (measured.length > maxSteps) throw new Error(`O MFV tem ${measured.length} etapas; a planilha comporta ${maxSteps} (linhas ${MFV.stepsFirst}–${MFV.stepsLast}).`);
    const maxStock = MFV.stockLast - MFV.stockFirst + 1;
    if (doc.inventories.length > maxStock) throw new Error(`O MFV tem ${doc.inventories.length} estoques; a planilha comporta ${maxStock}.`);

    /** Dados gerais (cliente, horário, demanda, unidades) — iguais no EP e no EF. */
    const general = () => {
      const u = new Map([
        ["D5", doc.clientName || null],
        ["D6", doc.family || null],
        ["K28", num(doc.availabilityPct) != null ? num(doc.availabilityPct) / 100 : 1],
        ["O21", num(doc.demandMonthly)],
        ["O26", num(doc.workDaysMonth)],
        ["P21", `${pu} / MÊS`],
        ["P22", `${pu} / DIA`],
        ["P23", TAKT_UNITS[doc.timeUnit] || "MINUTOS"],
        ["P27", `${pu} / HORA`],
        ["D35", "HORAS / peça"],
        ["D54", pu],
        ["I46", `${pu} / dia`],
        ["I47", `${pu} / hora`],
        ["I50", `${pu} / dia / operador`],
        ["I51", `${pu} / hora / operador`],
        ["T45", `${pu} / dia`],
      ]);
      doc.schedule.forEach((d, i) => {
        const row = MFV.days[0] + i;
        const day = r.days[i];
        u.set(`C${row}`, clock(d.start));
        u.set(`D${row}`, clock(d.end));
        // G/H (horas sem paradas / efetivas): só entram onde o modelo NÃO tem fórmula
        // (ex.: sábado da aba EF do modelo Laje Forte); fórmulas existentes são preservadas.
        u.set(`G${row}`, day.worked ? day.gross / 1440 : null);
        u.set(`H${row}`, day.worked ? day.net / 1440 : null);
        u.set(`E${row}`, clock(d.breaks) == null && clock(d.start) != null ? 0 : clock(d.breaks));
        u.set(`F${row}`, clock(d.meal) == null && clock(d.start) != null ? 0 : clock(d.meal));
      });
      return u;
    };
    const force = new Set(["O21", "O26", "K28", "K37"]);
    for (let n = MFV.stepsFirst; n <= MFV.stepsLast; n++) ["B", "C", "E", "F", "G"].forEach((c) => force.add(`${c}${n}`));
    for (let n = MFV.stockFirst; n <= MFV.stockLast; n++) ["B", "D"].forEach((c) => force.add(`${c}${n}`));

    // ---- EP (estado presente)
    const ep = general();
    // Operador compartilhado (REV 1.14): nº de pessoas da etapa = TC ÷ carga do operador (Σ = 1 por operador)
    const sharedOf = (calc) =>
      calc && calc.operatorTag ? (r.sharedOperators || []).find((o) => o.label.toLowerCase() === calc.operatorTag.toLowerCase() && o.seqs.length > 1) : null;
    const epRow = new Map(); // nº da etapa no app → linha da tabela da EP (1, 2, …)
    measured.forEach((x, i) => epRow.set(x.calc.seq, i + 1));
    for (let n = MFV.stepsFirst; n <= MFV.stepsLast; n++) {
      const x = measured[n - MFV.stepsFirst];
      const st = x && x.st;
      const calc = x && x.calc;
      const shared = sharedOf(calc);
      ep.set(`B${n}`, st && st.kaizen ? "X" : null);
      ep.set(`C${n}`, st ? st.name || calc.name : null);
      ep.set(`E${n}`, st && calc.tc != null ? Math.round((calc.tc / 60) * 1e7) / 1e7 : null);
      ep.set(`F${n}`, st ? (shared && shared.load > 0 && calc.tc != null ? Math.round((calc.tc / shared.load) * 1e6) / 1e6 : num(st.operators)) : null);
      ep.set(`G${n}`, st && num(st.uptimePct) ? num(st.uptimePct) / 100 : null);
      if (st && calc.tc == null) warnings.push(`Etapa "${calc.name}" sem TC: exportada sem tempo.`);
    }
    ep.set("K37", Math.round(r.opsTotal * 1000) / 1000 || null);
    if (r.hasGroups) {
      warnings.push(
        `Etapa(s) de grupo Posto: a planilha recebe TC = ciclo do posto e Nº ops = nº de estudos, mas calcula os operadores ideais por ΣTC. ` +
          `No app, operadores ideais = Σ conteúdo ÷ takt = ${r.opsIdeal != null ? Calc.formatNumber(r.opsIdeal, 2) : "--"}; registre nas premissas, se necessário.`
      );
    }
    for (let n = MFV.stockFirst; n <= MFV.stockLast; n++) {
      const inv = doc.inventories[n - MFV.stockFirst];
      ep.set(`B${n}`, inv ? inv.name || null : null);
      ep.set(`D${n}`, inv ? num(inv.quantity) : null);
    }
    const notes = String(doc.notes || "").split(/\r?\n/).filter((l, i, arr) => l.trim() || i < arr.length - 1);
    // Premissas acrescentadas pelo app (REV 1.14): operadores compartilhados, ponderação e etapas não medidas
    const tu = Calc.TIME_UNITS[doc.timeUnit] ? doc.timeUnit : "min";
    const ftu = (m) => `${Calc.formatTime(m, tu, tu === "s" ? 2 : undefined)} ${Calc.TIME_UNITS[tu].label}/${pu}`;
    const listRows = (seqs) => {
      const rows = seqs.map((q) => epRow.get(q)).filter((v) => v != null);
      return rows.length > 1 ? `etapas ${rows.slice(0, -1).join(", ")} e ${rows[rows.length - 1]}` : `etapa ${rows[0]}`;
    };
    const auto = [];
    const shared = (r.sharedOperators || []).filter((o) => o.seqs.length > 1 && o.load != null);
    shared.forEach((o) =>
      auto.push(
        `Operador ${o.label}: ${listRows(o.seqs)}, carga ${ftu(o.load)} (${Calc.formatNumber(o.taktPct, 1)}% do takt), capacidade ${Calc.formatNumber(o.capacityDay, 0)} ${pu}/dia.`
      )
    );
    const weighted = r.steps.filter((x) => x.weight);
    if (weighted.length) {
      const f = (n) => Calc.formatNumber(n, n % 1 ? 1 : 0);
      const byFactor = new Map(); // "200/800" → [nº das etapas]
      weighted.forEach((x) => {
        const k = `${f(x.weight.demand)}/${f(x.weight.family)}`;
        byFactor.set(k, (byFactor.get(k) || []).concat([x.seq]));
      });
      auto.push(`TC ponderado pela demanda do produto: ${Array.from(byFactor, ([k, seqs]) => `${listRows(seqs)} (${k})`).join("; ")}.`);
    }
    if (r.unmeasured && r.unmeasured.length) auto.push(`Etapa(s) não medida(s): ${r.unmeasured.map((x) => x.name).join(", ")}.`);
    if (shared.length) {
      auto.push("A aba EP calcula gargalo e produção do processo Kaizen pelo TC da linha; com operador compartilhado, considerar a capacidade do operador informada aqui.");
      warnings.push("Operador compartilhado entre etapas: Nº ops de cada etapa = TC ÷ carga do operador; a carga e a capacidade do operador foram para as premissas.");
    }
    if (auto.length) notes.push(...auto);
    const maxNotes = MFV.notesLast - MFV.notesFirst;
    ep.set(`B${MFV.notesFirst}`, `PREMISSAS E OBSERVAÇÕES (exportado do Lean Chrono em ${new Date().toLocaleDateString("pt-BR")}):`);
    for (let n = MFV.notesFirst + 1; n <= MFV.notesLast; n++) ep.set(`B${n}`, notes[n - MFV.notesFirst - 1] || null);
    if (notes.length > maxNotes) warnings.push(`Premissas com ${notes.length} linhas: só as ${maxNotes} primeiras cabem na planilha.`);
    if (!doc.steps.some((s) => s.kaizen)) warnings.push('Nenhuma etapa marcada como Kaizen: as fórmulas do "Processo Kaizen" da planilha ficarão em erro (#N/D).');
    applyUpdates(tpl.sheets.EP.parts, ep, force);

    // ---- EF (estado futuro): dados gerais do EP, etapas e estoques em branco
    if (tpl.sheets.EF) {
      const ef = general();
      for (let n = MFV.stepsFirst; n <= MFV.stepsLast; n++) ["B", "C", "E", "F", "G"].forEach((c) => ef.set(`${c}${n}`, null));
      for (let n = MFV.stockFirst; n <= MFV.stockLast; n++) ef.set(`D${n}`, null);
      ef.set("K37", null);
      applyUpdates(tpl.sheets.EF.parts, ef, force);
      warnings.push("Aba EF (estado futuro) preparada com os dados gerais do EP; preencha as etapas futuras no Excel.");
    }
    warnings.push("O fluxograma do processo é uma imagem do modelo: use \"Exportar PNG\" no bloco Fluxograma do MFV e cole a imagem no Excel.");
    return { bytes: buildOutput(tpl, []), warnings, steps: doc.steps.length };
  }


  /* ==========================================================================
     MODELO DO PLANO DE AÇÃO (5W2H) — REV 1.19
     ========================================================================== */

  const PLANO = { first: 8, last: 24 }; // linhas das ações no modelo (17 ações por arquivo)
  const PLANO_EXTRA = "Plano (app)"; // aba acrescentada com os campos do app (o modelo não é alterado)

  async function recognizePlano(wb) {
    const sst = parseSharedStrings(await wb.text("xl/sharedStrings.xml"));
    const path = wb.sheetPath.get(wb.name);
    const parts = splitRows(await wb.text(path));
    const checks = { A6: "o que", B6: "como", C6: "quem", D6: "quando", F6: "onde", G6: "por que", H6: "quanto", I6: "% completo" };
    const bad = Object.entries(checks).filter(([ref, label]) => norm(getCell(parts, ref, sst)) !== label);
    if (bad.length) throw new Error(`Layout diferente do modelo 5W2H (${bad.slice(0, 3).map(([r, l]) => `${r} ≠ "${l}"`).join("; ")}).`);
    return {
      kind: "plano-5w2h",
      entries: wb.entries,
      sst,
      sheets: { plano: { name: wb.name, path, parts } },
      workbook: wb.workbook,
      rels: wb.rels,
      contentTypes: await wb.text("[Content_Types].xml"),
      macro: wb.byName.has("xl/vbaProject.bin"),
    };
  }

  function getPlanoLib() {
    if (typeof self !== "undefined" && self.LeanPlano) return self.LeanPlano;
    return require("./plano-calc.js"); // Node (testes)
  }

  /** Aba simples (texto e números, sem estilos do modelo) para os campos do app. */
  function plainSheetXml(rows) {
    const cell = (v, ref) =>
      v == null || v === ""
        ? ""
        : typeof v === "number" && Number.isFinite(v)
          ? `<c r="${ref}"><v>${v}</v></c>`
          : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${Xlsx.esc(v)}</t></is></c>`;
    const body = rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cell(v, `${Xlsx.colName(j)}${i + 1}`)).join("")}</row>`).join("");
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      `<sheetData>${body}</sheetData></worksheet>`
    );
  }

  /** Acrescenta uma aba nova ao modelo (workbook, relações e tipos de conteúdo). */
  function addSheet(tpl, name, xml) {
    const used = new Set(tpl.entries.map((e) => e.name));
    let n = 1;
    while (used.has(`xl/worksheets/sheet${n}.xml`)) n++;
    const path = `xl/worksheets/sheet${n}.xml`;
    const ids = Array.from(tpl.workbook.matchAll(/\bsheetId="(\d+)"/g)).map((m) => Number(m[1]));
    const sheetId = (ids.length ? Math.max(...ids) : 0) + 1;
    let rid = "rIdPlanoApp";
    while (tpl.rels.includes(`Id="${rid}"`)) rid += "x";
    const workbook = tpl.workbook.replace("</sheets>", `<sheet name="${Xlsx.esc(name)}" sheetId="${sheetId}" r:id="${rid}"/></sheets>`);
    const rels = tpl.rels.replace(
      "</Relationships>",
      `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/></Relationships>`
    );
    const ct = tpl.contentTypes.replace(
      "</Types>",
      `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`
    );
    return {
      replace: [
        ["xl/workbook.xml", workbook],
        ["xl/_rels/workbook.xml.rels", rels],
        ["[Content_Types].xml", ct],
      ],
      add: [{ name: path, xml }],
    };
  }

  /**
   * Preenche o modelo 5W2H com até 17 ações (part = 0, 1, … para planos maiores; cada arquivo
   * leva as ações daquela parte). Cabeçalho: B3 criação, D3 responsável, G3 objetivo, J3 meta,
   * B4 revisão, D4 responsável, G4 indicador. Ações: A O que | B Como | C Quem | D início |
   * E fim | F Onde | G Por que | H Quanto | I % completo. A aba "Plano (app)" leva todas as
   * ações com Status, ECRS, desperdício, ferramenta, prioridade e origem.
   */
  function fillPlanoTemplate(tpl, doc, options) {
    const P = getPlanoLib();
    const r = P.computePlan(doc, options && options.today);
    const per = PLANO.last - PLANO.first + 1;
    const part = (options && options.part) || 0;
    const slice = doc.actions.slice(part * per, part * per + per);
    const num = (v) => {
      const n = Calc.parseNumber(v);
      return Number.isFinite(n) ? n : null;
    };
    const warnings = [];
    const u = new Map([
      ["B3", P.excelDate(doc.createdDate)],
      ["D3", doc.owner || null],
      ["G3", doc.objective || null],
      ["J3", num(doc.targetPct) != null ? num(doc.targetPct) / 100 : null],
      ["B4", P.excelDate(doc.reviewDate)],
      ["D4", doc.reviewOwner || null],
      ["G4", doc.indicator || null],
    ]);
    for (let n = PLANO.first; n <= PLANO.last; n++) {
      const a = slice[n - PLANO.first];
      const pct = a ? num(a.pct) : null;
      u.set(`A${n}`, a ? a.what || null : null);
      u.set(`B${n}`, a ? a.how || null : null);
      u.set(`C${n}`, a ? a.who || null : null);
      u.set(`D${n}`, a ? P.excelDate(a.start) : null);
      u.set(`E${n}`, a ? P.excelDate(a.end) : null);
      u.set(`F${n}`, a ? a.where || null : null);
      u.set(`G${n}`, a ? a.why || null : null);
      u.set(`H${n}`, a ? num(a.cost) : null);
      u.set(`I${n}`, pct != null ? pct / 100 : null);
    }
    applyUpdates(tpl.sheets.plano.parts, u, new Set(Array.from(u.keys())));
    const parts = Math.max(1, Math.ceil(doc.actions.length / per));
    if (parts > 1) warnings.push(`O plano tem ${doc.actions.length} ações; o modelo comporta ${per}. Arquivo ${part + 1} de ${parts}: ações ${part * per + 1} a ${part * per + slice.length}.`);
    const missing = doc.actions.filter((a) => !a.who || !a.end).length;
    if (missing && part === 0) warnings.push(`${missing} ação(ões) sem Quem ou sem prazo (Fim): complete antes de apresentar o plano.`);
    // Aba extra com os campos do app (todas as ações)
    const head = ["Nº", "Prioridade", "O que", "Como", "Quem", "Início", "Fim", "Onde", "Por que", "Quanto (R$)", "% completo", "Status", "Tipo ECRS", "Desperdício", "Ferramenta Lean", "Origem (estudo • elemento)"];
    const rows = [
      [`PLANO DE AÇÃO (5W2H) — ${doc.clientName || ""} — exportado do Lean Chrono em ${new Date().toLocaleDateString("pt-BR")}`],
      [`Objetivo: ${doc.objective || "--"} | Meta: ${doc.targetPct || "--"}% | Indicador: ${doc.indicator || "--"}`],
      [],
      head,
    ].concat(
      doc.actions.map((a, i) => [
        i + 1,
        a.priority || "",
        a.what,
        a.how,
        a.who,
        P.formatDate(a.start),
        P.formatDate(a.end),
        a.where,
        a.why,
        num(a.cost),
        num(a.pct),
        P.STATUS[r.actions[i].status],
        P.ECRS[a.ecrs] || "",
        Calc.WASTES[a.waste] || "",
        P.TOOLS[a.tool] || "",
        a.origin ? [a.origin.processName, a.origin.product, a.origin.etapa, a.origin.element].filter(Boolean).join(" • ") : "",
      ])
    );
    rows.push([], [`Status: ${Object.keys(P.STATUS).map((k) => `${P.STATUS[k]} ${r.count[k]}`).join(" | ")} | % médio ${r.pctMean == null ? "--" : Calc.formatNumber(r.pctMean, 1)}% | Σ Quanto R$ ${Calc.formatNumber(r.costTotal, 2)}`]);
    const extra = addSheet(tpl, PLANO_EXTRA, plainSheetXml(rows));
    return { bytes: buildOutput(tpl, [], extra), warnings, parts, actions: slice.length };
  }

  function exportPlanoFileName(doc, templateName, part, parts) {
    const ext = /\.xlsm$/i.test(templateName || "") ? "xlsm" : "xlsx";
    const date = new Date().toISOString().slice(0, 10);
    return `5W2H_${Calc.slugify(doc.clientName, "Cliente")}_${date}${parts > 1 ? `_parte${part + 1}` : ""}.${ext}`;
  }

  /** O preenchimento altera as linhas do modelo carregado: sempre parte dos bytes originais. */
  async function fillFromBytes(templateBytes, docOrStudy, options) {
    const tpl = await loadTemplate(templateBytes, options);
    if (tpl.kind === "plano-5w2h") return fillPlanoTemplate(tpl, docOrStudy, options);
    return tpl.kind === "mfv-rev1" ? fillMfvTemplate(tpl, docOrStudy) : fillTemplate(tpl, docOrStudy);
  }

  function exportFileName(study, templateName, op) {
    const ext = /\.xlsm$/i.test(templateName || "") ? "xlsm" : "xlsx";
    const date = new Date().toISOString().slice(0, 10);
    const r = Calc.computeStudy(study);
    const product = r.multiProduct && r.products.length > 1 ? `_${Calc.slugify(r.product.name, "Produto")}` : "";
    const operator = op ? `_Op${op}` : ""; // REV 1.14: um arquivo por operador
    return `Crono_${Calc.slugify(study.clientName, "Cliente")}_${Calc.slugify(study.processName, "Posto")}${product}${operator}_${date}.${ext}`;
  }

  function exportMfvFileName(doc, templateName) {
    const ext = /\.xlsm$/i.test(templateName || "") ? "xlsm" : "xlsx";
    const date = new Date().toISOString().slice(0, 10);
    return `MFV_${Calc.slugify(doc.clientName, "Cliente")}_${Calc.slugify(doc.family, "Familia")}_${date}.${ext}`;
  }

  return {
    LIMITS,
    MFV,
    readZip,
    loadTemplate,
    fillTemplate,
    fillMfvTemplate,
    fillFromBytes,
    exportFileName,
    exportMfvFileName,
    fillPlanoTemplate,
    exportPlanoFileName,
    parseSharedStrings,
    dropCachedFormulaValues,
  };
});
