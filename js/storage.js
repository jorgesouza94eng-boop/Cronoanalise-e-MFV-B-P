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
  const DB_VERSION = 2;
  const STORE_STUDIES = "studies"; // { id, study, diskRevision, dirty, exportedAt }
  const STORE_MFV = "mfv"; // mesmo formato de registro, para os documentos de MFV
  const STORE_KV = "kv"; // chave → valor (handle da pasta, último estudo aberto…)
  const LS_PREFIX = "leanChrono:";

  const FILE_PATTERN = /^Crono_.+\.json$/i;
  const CONFLICT_MARK = "_conflito_";

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
  const keyPrefix = (store) => (store === STORE_MFV ? "mfv:" : "study:");

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

  /** Lê e valida um arquivo de estudo da pasta. Retorna null se não existir ou estiver vazio. */
  async function readStudyFile(fileName, normalize) {
    let fileHandle;
    try {
      fileHandle = await dirHandle.getFileHandle(fileName);
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

  /** Lista os estudos da pasta (ignora cópias de conflito e arquivos inválidos). */
  async function listFolderStudies(options) {
    const opts = options || {};
    const pattern = opts.pattern || FILE_PATTERN;
    const studies = [];
    const skipped = [];
    for await (const entry of dirHandle.values()) {
      if (entry.kind !== "file" || !pattern.test(entry.name)) continue;
      if (entry.name.includes(CONFLICT_MARK)) continue;
      try {
        const study = await readStudyFile(entry.name, opts.normalize);
        if (!study) continue;
        if (study.invalid) skipped.push({ fileName: entry.name, error: study.error });
        // O nome real do arquivo prevalece (caso tenha sido renomeado no Explorer).
        else studies.push(Object.assign(study, { fileName: entry.name }));
      } catch (err) {
        skipped.push({ fileName: entry.name, error: err.message || String(err) });
      }
    }
    return { studies, skipped };
  }

  async function writeTextFile(fileName, text) {
    const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
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

    const disk = await readStudyFile(study.fileName, opts.normalize);
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
        await writeTextFile(conflictFile, serialize(study));
      }
      return { status: "conflict", diskStudy, diskInvalid: diskExists && !diskStudy, conflictFile };
    }

    const nextRevision = (diskStudy ? diskStudy.revision : expectedRevision || 0) + 1;
    const toWrite = Object.assign({}, study, { revision: nextRevision });
    await writeTextFile(study.fileName, serialize(toWrite));
    return { status: "ok", revision: nextRevision };
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
    init,
    getBackend: () => backend,
    getKV,
    setKV,
    listLocal,
    getLocal,
    putLocal,
    deleteLocal,
    getDirHandle,
    useDirectoryHandle,
    restoreDirHandle,
    queryPermission,
    requestPermission,
    pickDirectory,
    folderReady,
    readStudyFile,
    listFolderStudies,
    writeStudy,
    writeTextFile,
    downloadText,
    readImportFile,
  };
})(typeof self !== "undefined" ? self : this);
