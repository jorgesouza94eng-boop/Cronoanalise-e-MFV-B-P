/**
 * ============================================================================
 * LEAN CHRONO & MFV — CAMADA DE ARMAZENAMENTO LOCAL-FIRST
 * ----------------------------------------------------------------------------
 * 1) Cache local no navegador (IndexedDB; se indisponível, localStorage).
 *    Funciona em qualquer navegador, inclusive celular, e é gravado a cada
 *    alteração (proteção contra fechamento acidental).
 * 2) Pasta local sincronizada pelo OneDrive (File System Access API —
 *    Chrome/Edge no computador). O "handle" da pasta fica no IndexedDB.
 *    A gravação na pasta usa controle de revisão para não sobrescrever
 *    alterações feitas em outro dispositivo.
 * Depende de: LeanCalc (calc.js).
 * ============================================================================
 */
(function (root) {
  "use strict";

  const Calc = root.LeanCalc;

  const DB_NAME = "LeanChronoDB";
  const DB_VERSION = 4; // v4: planos de ação (REV 1.19)
  const STORE_STUDIES = "studies"; // { id, study, diskRevision, dirty, exportedAt }
  const STORE_MFV = "mfv"; // mesmo formato de registro, para os documentos de MFV
  const STORE_GROUPS = "grupos"; // mesmo formato, para os grupos do Yamazumi (REV 1.9)
  const STORE_PLANS = "planos"; // mesmo formato, para os planos de ação 5W2H (REV 1.19)
  const STORE_KV = "kv"; // chave → valor (handle da pasta, último estudo aberto…)
  const LS_PREFIX = "leanChrono:";

  const FILE_PATTERN = /^Crono_.+\.json$/i;
  const CONFLICT_MARK = "_conflito_";
  const ARCHIVE_DIR = "_Arquivo"; // REV 1.16: subpasta dos arquivos arquivados (fora das listas)
  // REV 1.26: um subpasta por empresa na pasta conectada (<Empresa>/Crono_….json). Subpastas que
  // começam com "_" (ex.: _Modelos, _Arquivo) não são de empresa.
  const COMPANY_FALLBACK = "Sem_cliente";
  const DOC_PATTERN = /^(Crono|MFV|Yamazumi|Plano)_.+\.json$/i;
  const locations = new Map(); // nome do arquivo → subpasta onde está ("" = pasta principal)

  let dbPromise = null;
  let backend = null; // "idb" | "localStorage" | "memory"
  const memoryStore = new Map();

  /* ==========================================================================
     DETECÇÃO DE RECURSOS
     ========================================================================== */

  const fsSupported =
    typeof root.showDirectoryPicker === "function" && root.isSecureContext !== false;

  /* ==========================================================================
     INDEXEDDB (COM FALLBACK PARA localStorage / MEMÓRIA)
     ========================================================================== */

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!root.indexedDB) return reject(new Error("IndexedDB indisponível"));
      let request;
      try {
        request = root.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        return reject(err);
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_STUDIES)) {
          db.createObjectStore(STORE_STUDIES, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_MFV)) {
          db.createObjectStore(STORE_MFV, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_GROUPS)) {
          db.createObjectStore(STORE_GROUPS, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_PLANS)) {
          db.createObjectStore(STORE_PLANS, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_KV)) db.createObjectStore(STORE_KV);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("IndexedDB bloqueado por outra aba"));
    });
    return dbPromise;
  }

  /** Executa uma operação em um object store e resolve com o resultado. */
  async function idbRun(storeName, mode, fn) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const req = fn(tx.objectStore(storeName));
      let result;
      if (req) req.onsuccess = () => (result = req.result);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Transação abortada"));
    });
  }

  function lsAvailable() {
    try {
      const k = LS_PREFIX + "__teste__";
      root.localStorage.setItem(k, "1");
      root.localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Inicializa o armazenamento e pede persistência ao navegador (evita limpeza automática). */
  async function init() {
    try {
      await openDB();
      backend = "idb";
    } catch (err) {
      console.warn("IndexedDB indisponível; usando alternativa:", err);
      dbPromise = null;
      backend = lsAvailable() ? "localStorage" : "memory";
    }

    let persisted = false;
    try {
      if (root.navigator && navigator.storage && navigator.storage.persist) {
        persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
      }
    } catch (e) {
      /* navegador sem suporte: segue sem persistência garantida */
    }

    return { backend, fsSupported, persisted };
  }

  /* ---- Chave/valor ------------------------------------------------------- */

  async function getKV(key) {
    if (backend === "idb") return idbRun(STORE_KV, "readonly", (s) => s.get(key));
    if (backend === "localStorage") {
      const raw = root.localStorage.getItem(LS_PREFIX + "kv:" + key);
      return raw == null ? undefined : JSON.parse(raw);
    }
    return memoryStore.get("kv:" + key);
  }

  async function setKV(key, value) {
    if (backend === "idb") return idbRun(STORE_KV, "readwrite", (s) => s.put(value, key));
    if (backend === "localStorage") {
      // Handles de pasta não são serializáveis: só existem no modo IndexedDB.
      if (value && typeof value === "object" && value.kind) return;
      root.localStorage.setItem(LS_PREFIX + "kv:" + key, JSON.stringify(value));
      return;
    }
    memoryStore.set("kv:" + key, value);
  }

  /* ---- Estudos no cache local ------------------------------------------- */

  /** Prefixo das chaves no localStorage/memória: "study:" (estudos) ou "mfv:". */
  const keyPrefix = (store) =>
    store === STORE_MFV ? "mfv:" : store === STORE_GROUPS ? "grupo:" : store === STORE_PLANS ? "plano:" : "study:";

  async function listLocal(store) {
    const st = store || STORE_STUDIES;
    if (backend === "idb") return (await idbRun(st, "readonly", (s) => s.getAll())) || [];
    const prefix = keyPrefix(st);
    if (backend === "localStorage") {
      const out = [];
      for (let i = 0; i < root.localStorage.length; i++) {
        const k = root.localStorage.key(i);
        if (k && k.startsWith(LS_PREFIX + prefix)) {
          try {
            out.push(JSON.parse(root.localStorage.getItem(k)));
          } catch (e) {
            console.warn("Registro local corrompido ignorado:", k);
          }
        }
      }
      return out;
    }
    return Array.from(memoryStore.entries())
      .filter(([k]) => k.startsWith(prefix))
      .map(([, v]) => v);
  }

  async function getLocal(id, store) {
    if (!id) return null;
    const st = store || STORE_STUDIES;
    if (backend === "idb") return (await idbRun(st, "readonly", (s) => s.get(id))) || null;
    if (backend === "localStorage") {
      const raw = root.localStorage.getItem(LS_PREFIX + keyPrefix(st) + id);
      return raw ? JSON.parse(raw) : null;
    }
    return memoryStore.get(keyPrefix(st) + id) || null;
  }

  async function putLocal(record, store) {
    const st = store || STORE_STUDIES;
    const clean = JSON.parse(JSON.stringify(record)); // remove referências da interface
    if (backend === "idb") return idbRun(st, "readwrite", (s) => s.put(clean));
    if (backend === "localStorage") {
      root.localStorage.setItem(LS_PREFIX + keyPrefix(st) + clean.id, JSON.stringify(clean));
      return;
    }
    memoryStore.set(keyPrefix(st) + clean.id, clean);
  }

  async function deleteLocal(id, store) {
    const st = store || STORE_STUDIES;
    if (backend === "idb") return idbRun(st, "readwrite", (s) => s.delete(id));
    if (backend === "localStorage") {
      root.localStorage.removeItem(LS_PREFIX + keyPrefix(st) + id);
      return;
    }
    memoryStore.delete(keyPrefix(st) + id);
  }

  /* ==========================================================================
     PASTA LOCAL (ONEDRIVE) — FILE SYSTEM ACCESS API
     ========================================================================== */

  let dirHandle = null;

  function getDirHandle() {
    return dirHandle;
  }

  /** Usa um handle de pasta (escolhido pelo usuário) e o memoriza no IndexedDB. */
  async function useDirectoryHandle(handle) {
    dirHandle = handle;
    locations.clear(); // outra pasta: os locais conhecidos não valem mais
    if (backend === "idb") {
      try {
        await setKV("dirHandle", handle);
      } catch (err) {
        console.warn("Não foi possível memorizar a pasta:", err);
      }
    }
    return handle;
  }

  /** Recupera a pasta usada na última sessão. Retorna o estado da permissão. */
  async function restoreDirHandle() {
    if (!fsSupported || backend !== "idb") return { handle: null, permission: "unsupported" };
    try {
      const handle = await getKV("dirHandle");
      if (!handle) return { handle: null, permission: "none" };
      dirHandle = handle;
      return { handle, permission: await queryPermission(handle) };
    } catch (err) {
      console.warn("Não foi possível restaurar a pasta anterior:", err);
      return { handle: null, permission: "none" };
    }
  }

  async function queryPermission(handle) {
    const h = handle || dirHandle;
    if (!h) return "none";
    if (typeof h.queryPermission !== "function") return "granted";
    return h.queryPermission({ mode: "readwrite" });
  }

  /**
   * Pede permissão de escrita. SÓ pode ser chamada a partir de um clique ou
   * tecla do usuário (o navegador recusa se vier de um temporizador).
   */
  async function requestPermission(handle) {
    const h = handle || dirHandle;
    if (!h) return "none";
    if (typeof h.requestPermission !== "function") return "granted";
    return h.requestPermission({ mode: "readwrite" });
  }

  /** Abre o seletor de pasta do sistema (exige clique do usuário). */
  async function pickDirectory() {
    const handle = await root.showDirectoryPicker({ id: "lean-chrono", mode: "readwrite" });
    return useDirectoryHandle(handle);
  }

  async function folderReady() {
    return !!dirHandle && (await queryPermission()) === "granted";
  }

  /* --------------------------------------------------------------------------
     SUBPASTA POR EMPRESA (REV 1.26)
     -------------------------------------------------------------------------- */

  /** Nome da subpasta da empresa (mesma grafia do início do nome dos arquivos). */
  function companyDirName(clientName) {
    return Calc.slugify(clientName, COMPANY_FALLBACK);
  }

  const isCompanyDir = (name) => !!name && !name.startsWith("_") && !name.startsWith(".");

  async function subdir(name, create) {
    return name ? dirHandle.getDirectoryHandle(name, create ? { create: true } : undefined) : dirHandle;
  }

  async function hasFile(dir, name) {
    try {
      await dir.getFileHandle(name);
      return true;
    } catch (err) {
      if (err && (err.name === "NotFoundError" || err.name === "TypeMismatchError")) return false;
      throw err;
    }
  }

  /**
   * Onde está o arquivo: o local já conhecido, a subpasta indicada, a pasta principal (arquivos de
   * versões anteriores) ou qualquer subpasta de empresa (empresa renomeada). null = não existe.
   */
  async function locate(fileName, hintDir) {
    const tries = [];
    if (locations.has(fileName)) tries.push(locations.get(fileName));
    if (hintDir != null && !tries.includes(hintDir)) tries.push(hintDir);
    if (!tries.includes("")) tries.push("");
    for (const d of tries) {
      try {
        if (await hasFile(await subdir(d), fileName)) {
          locations.set(fileName, d);
          return d;
        }
      } catch (err) {
        if (!err || err.name !== "NotFoundError") throw err;
      }
    }
    for await (const entry of dirHandle.values()) {
      if (entry.kind !== "directory" || !isCompanyDir(entry.name) || tries.includes(entry.name)) continue;
      if (await hasFile(entry, fileName)) {
        locations.set(fileName, entry.name);
        return entry.name;
      }
    }
    locations.delete(fileName);
    return null;
  }

  /** Lê e valida um arquivo de estudo da pasta (em qualquer subpasta de empresa). Retorna null se não existir ou estiver vazio. */
  async function readStudyFile(fileName, normalize, hintDir) {
    const where = await locate(fileName, hintDir);
    if (where == null) return null;
    let fileHandle;
    try {
      fileHandle = await (await subdir(where)).getFileHandle(fileName);
    } catch (err) {
      if (err && err.name === "NotFoundError") return null;
      throw err;
    }
    const file = await fileHandle.getFile();
    if (file.size === 0) return null;
    const text = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return { invalid: true, error: "JSON corrompido ou incompleto" };
    }
    const result = (normalize || Calc.normalizeStudy)(parsed);
    if (!result.ok) return { invalid: true, error: result.error };
    return result.study;
  }

  /**
   * Lista os estudos da pasta: subpastas das empresas e, por compatibilidade, a pasta principal
   * (ignora cópias de conflito e arquivos inválidos).
   */
  async function listFolderStudies(options) {
    const opts = options || {};
    const pattern = opts.pattern || FILE_PATTERN;
    const studies = [];
    const skipped = [];
    const dirs = [["", dirHandle]];
    for await (const entry of dirHandle.values()) {
      if (entry.kind === "directory" && isCompanyDir(entry.name)) dirs.push([entry.name, entry]);
    }
    for (const [dirName, dir] of dirs) {
      for await (const entry of dir.values()) {
        if (entry.kind !== "file" || !pattern.test(entry.name)) continue;
        if (entry.name.includes(CONFLICT_MARK)) continue;
        locations.set(entry.name, dirName);
        try {
          const study = await readStudyFile(entry.name, opts.normalize, dirName);
          if (!study) continue;
          if (study.invalid) skipped.push({ fileName: entry.name, error: study.error });
          // O nome real do arquivo prevalece (caso tenha sido renomeado no Explorer).
          else studies.push(Object.assign(study, { fileName: entry.name }));
        } catch (err) {
          skipped.push({ fileName: entry.name, error: err.message || String(err) });
        }
      }
    }
    return { studies, skipped };
  }

  /**
   * Backup (REV 1.27): todos os documentos (estudos, MFVs, grupos e planos) de uma empresa —
   * ou de todas (clientKey null) —, do navegador e da pasta, na versão mais recente de cada id.
   * Não inclui os arquivados nem as cópias de conflito. Retorna [{ dir, fileName, text, kind }].
   */
  async function collectCompanyDocs(clientKey) {
    const best = new Map();
    const keep = (doc, text, fileName) => {
      if (!doc || typeof doc !== "object" || !doc.id) return;
      if (clientKey != null && Calc.elementKey(doc.clientName) !== clientKey) return;
      const prev = best.get(doc.id);
      if (prev && String(prev.updatedAt) >= String(doc.updatedAt || "")) return;
      best.set(doc.id, { doc, text, fileName: fileName || doc.fileName, updatedAt: String(doc.updatedAt || "") });
    };
    for (const store of [STORE_STUDIES, STORE_MFV, STORE_GROUPS, STORE_PLANS]) {
      (await listLocal(store)).forEach((r) => {
        if (!r || !r.study) return;
        const isCrono = store === STORE_STUDIES;
        keep(r.study, isCrono ? Calc.serializeStudy(r.study) : JSON.stringify(r.study, null, 2));
      });
    }
    if (await folderReady()) {
      const dirs = [dirHandle];
      for await (const entry of dirHandle.values()) if (entry.kind === "directory" && isCompanyDir(entry.name)) dirs.push(entry);
      for (const dir of dirs) {
        for await (const entry of dir.values()) {
          if (entry.kind !== "file" || !DOC_PATTERN.test(entry.name) || entry.name.includes(CONFLICT_MARK)) continue;
          try {
            const text = await (await entry.getFile()).text();
            keep(JSON.parse(text), text, entry.name);
          } catch (err) {
            /* arquivo ilegível: fica fora do backup */
          }
        }
      }
    }
    return Array.from(best.values())
      .filter((x) => DOC_PATTERN.test(String(x.fileName || "")))
      .map((x) => ({ dir: companyDirName(x.doc.clientName), fileName: x.fileName, text: x.text, kind: x.fileName.split("_")[0] }))
      .sort((a, b) => a.dir.localeCompare(b.dir) || a.fileName.localeCompare(b.fileName));
  }

  /** Arquivos de documentos soltos na pasta principal (versões anteriores à REV 1.26). */
  async function countLooseFiles() {
    if (!(await folderReady())) return 0;
    let n = 0;
    for await (const entry of dirHandle.values()) if (entry.kind === "file" && DOC_PATTERN.test(entry.name)) n += 1;
    return n;
  }

  /**
   * Organizar por empresa (REV 1.26): move os documentos soltos na pasta principal (inclusive as
   * cópias de conflito) para a subpasta da empresa de cada um. Nada é apagado antes de gravado no
   * destino; se já houver um arquivo com o mesmo nome no destino, o arquivo fica onde está.
   * Retorna { moved, skipped: [{ fileName, reason }], dirs: [subpastas usadas] }.
   */
  async function organizeByCompany() {
    if (!(await folderReady())) return { moved: 0, skipped: [], dirs: [] };
    const names = [];
    for await (const entry of dirHandle.values()) if (entry.kind === "file" && DOC_PATTERN.test(entry.name)) names.push(entry.name);
    let moved = 0;
    const skipped = [];
    const dirs = new Set();
    for (const name of names) {
      try {
        const text = await (await (await dirHandle.getFileHandle(name)).getFile()).text();
        let client;
        try {
          client = JSON.parse(text).clientName;
        } catch (err) {
          skipped.push({ fileName: name, reason: "JSON corrompido" });
          continue;
        }
        const target = companyDirName(client);
        const dir = await subdir(target, true);
        if (await hasFile(dir, name)) {
          skipped.push({ fileName: name, reason: `já existe em ${target}` });
          continue;
        }
        await writeTextFile(name, text, target);
        await dirHandle.removeEntry(name);
        locations.set(name, target);
        dirs.add(target);
        moved += 1;
      } catch (err) {
        skipped.push({ fileName: name, reason: err.message || String(err) });
      }
    }
    return { moved, skipped, dirs: Array.from(dirs).sort() };
  }

  async function writeTextFile(fileName, text, dirName) {
    const fileHandle = await (await subdir(dirName || "", true)).getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(text);
      await writable.close();
    } catch (err) {
      try {
        await writable.abort();
      } catch (e) {
        /* nada a desfazer */
      }
      throw err;
    }
  }

  /** Grava um arquivo binário (ex.: modelo Excel) numa subpasta da pasta conectada. */
  async function writeBinaryFile(subdir, fileName, bytes) {
    const dir = subdir ? await dirHandle.getDirectoryHandle(subdir, { create: true }) : dirHandle;
    const fh = await dir.getFileHandle(fileName, { create: true });
    const w = await fh.createWritable();
    await w.write(bytes);
    await w.close();
  }

  /** Lista arquivos binários de uma subpasta: [{ name, bytes, lastModified }]. Subpasta ausente = []. */
  async function readBinaryFiles(subdir, pattern) {
    let dir;
    try {
      dir = await dirHandle.getDirectoryHandle(subdir);
    } catch (err) {
      if (err && err.name === "NotFoundError") return [];
      throw err;
    }
    const out = [];
    for await (const entry of dir.values()) {
      if (entry.kind !== "file" || (pattern && !pattern.test(entry.name))) continue;
      const file = await entry.getFile();
      out.push({ name: entry.name, bytes: new Uint8Array(await file.arrayBuffer()), lastModified: file.lastModified });
    }
    return out.sort((a, b) => b.lastModified - a.lastModified);
  }

  /**
   * Arquiva um arquivo da pasta (REV 1.16): grava o conteúdo na subpasta "_Arquivo" e tira o
   * arquivo da pasta principal, para ele sair das listas do app. Nada é apagado: para voltar,
   * basta mover o arquivo de volta (Explorer/OneDrive). Se já houver um arquivo com o mesmo nome
   * no _Arquivo, o novo recebe a data no nome. text = conteúdo a gravar (versão mais recente).
   * Retorna { status: "ok", archived } | { status: "no-folder" } | { status: "no-permission" }.
   */
  async function archiveFile(fileName, text) {
    if (!dirHandle) return { status: "no-folder" };
    if ((await queryPermission()) !== "granted") return { status: "no-permission" };
    // REV 1.26: o arquivado vai para <Empresa>/_Arquivo
    let client = "";
    try {
      client = JSON.parse(text).clientName;
    } catch (err) {
      /* conteúdo sem JSON: usa a pasta onde o arquivo está */
    }
    const where = await locate(fileName);
    const base = client || where == null ? companyDirName(client) : where;
    const dir = await (await subdir(base, true)).getDirectoryHandle(ARCHIVE_DIR, { create: true });
    let name = fileName;
    try {
      await dir.getFileHandle(name);
      const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
      name = fileName.replace(/\.json$/i, `_arquivado-${stamp}.json`);
    } catch (err) {
      if (!err || err.name !== "NotFoundError") throw err;
    }
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
    if (where != null) {
      try {
        await (await subdir(where)).removeEntry(fileName);
      } catch (err) {
        if (!err || err.name !== "NotFoundError") throw err; // só no navegador: não havia arquivo na pasta
      }
      locations.delete(fileName);
    }
    return { status: "ok", archived: `${base}/${ARCHIVE_DIR}/${name}` };
  }

  /**
   * Arquivar um item da lista (estudo, MFV ou grupo; REV 1.16). Com a pasta conectada: vai para
   * "_Arquivo" e sai do navegador. Sem pasta: baixa o .json (backup para "Importar JSON") e sai do
   * navegador. text = conteúdo da versão mais recente; store = store do IndexedDB (vazio = estudos).
   */
  async function archiveRecord(id, fileName, text, store) {
    if (await folderReady()) {
      const res = await archiveFile(fileName, text);
      if (res.status !== "ok") return res;
      await deleteLocal(id, store);
      return Object.assign(res, { mode: "pasta" });
    }
    downloadText(fileName, text, "application/json");
    await deleteLocal(id, store);
    return { status: "ok", mode: "download", archived: fileName };
  }

  /** Texto da confirmação de "Arquivar", igual nos três módulos. */
  function archivePrompt(label, kind, folder) {
    return folder
      ? `Arquivar ${kind} "${label}"?\n\nO arquivo vai para a subpasta ${ARCHIVE_DIR} da pasta conectada e sai desta lista (nada é apagado). ` +
          `Para trazer de volta, mova o arquivo de ${ARCHIVE_DIR} para a pasta.`
      : `Arquivar ${kind} "${label}"?\n\nO app baixa uma cópia .json (guarde-a) e tira o item deste navegador. ` + 'Para trazer de volta, use "Importar JSON".';
  }

  function conflictFileName(fileName) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
    return fileName.replace(/\.json$/i, `${CONFLICT_MARK}${stamp}.json`);
  }

  /**
   * Grava o estudo na pasta com proteção contra conflito.
   *
   * expectedRevision: revisão da pasta conhecida por este dispositivo (null = nunca gravou/leu).
   * Retorna:
   *  { status: "ok", revision }                                  → gravado
   *  { status: "conflict", diskStudy, conflictFile }             → NÃO sobrescreveu; a versão
   *                                                               local foi salva como cópia
   *  { status: "no-permission" }                                 → pasta precisa ser reautorizada
   */
  async function writeStudy(study, expectedRevision, options) {
    const opts = options || {};
    if (!dirHandle) return { status: "no-folder" };
    if ((await queryPermission()) !== "granted") return { status: "no-permission" };

    // REV 1.26: grava na subpasta da empresa; arquivo em outro lugar (versão anterior ou empresa
    // renomeada) é lido de onde está e, depois de gravado no destino, sai do lugar antigo.
    const target = companyDirName(study.clientName);
    const current = await locate(study.fileName, target);
    const disk = current == null ? null : await readStudyFile(study.fileName, opts.normalize, current);
    const serialize = opts.serialize || Calc.serializeStudy;
    const diskStudy = disk && !disk.invalid ? disk : null;
    const diskExists = !!disk;

    let allowed;
    if (opts.force) allowed = true;
    else if (diskExists && !diskStudy) allowed = false; // arquivo corrompido: não sobrescreve sem confirmação
    else allowed = Calc.canWriteOver(expectedRevision, diskStudy);

    if (!allowed) {
      let conflictFile = null;
      if (!opts.skipConflictCopy) {
        conflictFile = conflictFileName(study.fileName);
        await writeTextFile(conflictFile, serialize(study), target);
      }
      return { status: "conflict", diskStudy, diskInvalid: diskExists && !diskStudy, conflictFile };
    }

    const nextRevision = (diskStudy ? diskStudy.revision : expectedRevision || 0) + 1;
    const toWrite = Object.assign({}, study, { revision: nextRevision });
    await writeTextFile(study.fileName, serialize(toWrite), target);
    let moved = null;
    if (current != null && current !== target) {
      try {
        await (await subdir(current)).removeEntry(study.fileName);
      } catch (err) {
        if (!err || err.name !== "NotFoundError") throw err;
      }
      moved = { from: current, to: target };
    }
    locations.set(study.fileName, target);
    return { status: "ok", revision: nextRevision, folder: target, moved };
  }

  /* ==========================================================================
     DOWNLOAD / UPLOAD (EXPORTAR E IMPORTAR — MODO CELULAR E TROCA DE ARQUIVOS)
     ========================================================================== */

  function downloadText(fileName, text, mimeType) {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Liberação adiada: no Safari (iPhone) a revogação imediata cancela o download.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  /** Lê um arquivo escolhido pelo usuário e valida como estudo. */
  async function readImportFile(file, normalize) {
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch (err) {
      return { ok: false, error: "O arquivo não contém JSON válido" };
    }
    return (normalize || Calc.normalizeStudy)(parsed);
  }

  root.LeanStorage = {
    fsSupported,
    STORE_MFV,
    STORE_GROUPS,
    STORE_PLANS,
    init,
    getBackend: () => backend,
    getKV,
    setKV,
    listLocal,
    getLocal,
    putLocal,
    deleteLocal,
    archiveFile,
    archiveRecord,
    archivePrompt,
    ARCHIVE_DIR,
    getDirHandle,
    useDirectoryHandle,
    restoreDirHandle,
    queryPermission,
    requestPermission,
    pickDirectory,
    folderReady,
    readStudyFile,
    listFolderStudies,
    companyDirName,
    countLooseFiles,
    organizeByCompany,
    collectCompanyDocs,
    writeStudy,
    writeTextFile,
    writeBinaryFile,
    readBinaryFiles,
    canStoreBinary: () => backend === "idb" || backend === "memory",
    downloadText,
    readImportFile,
  };
})(typeof self !== "undefined" ? self : this);
