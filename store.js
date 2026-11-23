/*
 * Recipe Box — storage on the phone (IndexedDB) and reading recipes from photos, PDFs, Word files and text.
 * Recipe: {id, title, author, servings, prepMinutes, cookMinutes, notes, cuisine, meal, diet, method,
 *          illegible:[], ingredients:[], steps:[], photos:[Blob], status, error, favorite, createdAt, updatedAt}
 */
(function (root) {
  "use strict";
  const RB = root.RB;
  const STATUS = { PROCESSING: "PROCESSING", REVIEW: "NEEDS_REVIEW", SAVED: "SAVED", FAILED: "FAILED" };

  // ------------------------------------------------------------------ IndexedDB

  let dbPromise;
  function db() {
    dbPromise ??= new Promise((resolve, reject) => {
      const req = indexedDB.open("recipebox", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("recipes", { keyPath: "id", autoIncrement: true });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction("recipes", mode);
      const store = t.objectStore("recipes");
      let result;
      Promise.resolve(fn(store)).then((r) => { result = r; });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
    });
  }
  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  const listeners = new Set();
  const changed = () => listeners.forEach((f) => f());

  const Store = {
    STATUS,
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
    all: () => tx("readonly", (s) => req(s.getAll())),
    get: (id) => tx("readonly", (s) => req(s.get(Number(id)))),
    async put(r) {
      r.updatedAt = Date.now();
      const id = await tx("readwrite", (s) => req(s.put(r)));
      changed();
      return id;
    },
    async putMany(list) {
      await tx("readwrite", (s) => Promise.all(list.map((r) => req(s.put(r)))));
      changed();
    },
    async remove(id) { await tx("readwrite", (s) => req(s.delete(Number(id)))); changed(); },
  };

  function newRecipe(fields) {
    const now = Date.now();
    return {
      title: "", author: "", servings: "", prepMinutes: "", cookMinutes: "", notes: "",
      cuisine: "", meal: "", diet: "", method: "", illegible: [], ingredients: [], steps: [], photos: [],
      status: STATUS.SAVED, error: null, favorite: false, createdAt: now, updatedAt: now, ...fields,
    };
  }

  /** Applies a draft to a stored recipe, normalising ingredient names for search and matching. */
  function applyDraft(r, d, status, error) {
    const reviewed = status === STATUS.SAVED;
    Object.assign(r, {
      title: (d.title || "").trim() || "Untitled recipe",
      author: (d.author || "").trim(),
      servings: String(d.servings ?? "").trim(), prepMinutes: String(d.prepMinutes ?? "").trim(),
      cookMinutes: String(d.cookMinutes ?? "").trim(), notes: (d.notes || "").trim(),
      cuisine: d.cuisine || "", meal: d.meal || "", diet: d.diet || "", method: d.method || "",
      illegible: reviewed ? [] : d.illegible || [],
      ingredients: (d.ingredients || []).filter((i) => (i.raw || i.item || "").trim()).map((i) => ({
        ...i, raw: (i.raw || i.item).trim(), item: RB.canonical(i.item || i.raw), confidence: reviewed ? 1 : i.confidence ?? 1,
      })),
      steps: (d.steps || []).filter((s) => (s.text || "").trim()).map((s) => ({ text: s.text.trim(), confidence: reviewed ? 1 : s.confidence ?? 1 })),
      status, error: error || null,
    });
    return r;
  }

  // ------------------------------------------------------------------ settings

  const Settings = {
    get key() { return localStorage.getItem("geminiKey") || ""; },
    set key(v) { localStorage.setItem("geminiKey", v.trim()); localStorage.removeItem("geminiModels"); },
    get models() { try { return JSON.parse(localStorage.getItem("geminiModels")) || null; } catch { return null; } },
    set models(v) { localStorage.setItem("geminiModels", JSON.stringify(v)); },
    get pantry() { try { return JSON.parse(localStorage.getItem("pantry")) || []; } catch { return []; } },
    set pantry(v) { localStorage.setItem("pantry", JSON.stringify(v)); },
  };

  // ------------------------------------------------------------------ Gemini (free key, called straight from the phone)

  const API = "https://generativelanguage.googleapis.com/v1beta/";
  const PROMPT = `You transcribe recipes from photos of handwritten notes, recipe cards, notebook pages or printed pages, or from text copied off such photos.
Read carefully, including margin notes. Handwriting may be cursive, faded, or in a language other than English.

Rules:
- Transcribe faithfully, keeping the original language. Do not invent ingredients, amounts or steps that are not written. If something is unreadable, keep your best guess, lower its confidence, and describe it briefly in "illegible".
- confidence is 0.0-1.0: how sure you are that you read that line correctly.
- ingredients[].raw is the line as written. qty is a number (convert fractions: "1 1/2" -> 1.5) or null if not given ("salt to taste"). unit is a short lowercase unit ("cup", "tbsp", "tsp", "g", "kg", "ml", "l", "oz", "lb", "clove", "piece", "pinch") or null.
- ingredients[].item is the plain generic ingredient name in lowercase singular ENGLISH, without amounts or preparation ("2 cloves garlic, finely minced" -> "garlic"; "brinjals" -> "eggplant"). prep holds preparation words or null.
- If the steps are not numbered, split them into sensible steps in written order.
- servings / prep_minutes / cook_minutes: only if written or clearly stated; otherwise null.
- source_author: a person's name if the recipe says whose it is ("Grandma's", "from Aunty Mala"), else null.
- tags: short lowercase English words. cuisine, meal ("breakfast", "lunch", "dinner", "dessert", "snack", "drink", "side"), diet ("vegetarian", "vegan", "gluten-free") only when true from the ingredients, method ("stovetop", "oven", "pressure cooker", "no-cook", "fried", "grilled").
- title: as written; if there is none, write a short descriptive title.
- If the input does not contain a recipe, set is_recipe to false and leave the lists empty.`;

  const str = (nullable) => ({ type: "STRING", ...(nullable ? { nullable: true } : {}) });
  const num = (nullable) => ({ type: "NUMBER", ...(nullable ? { nullable: true } : {}) });
  const arr = (items) => ({ type: "ARRAY", items });
  const obj = (props) => ({ type: "OBJECT", properties: props, required: Object.keys(props), propertyOrdering: Object.keys(props) });
  const SCHEMA = obj({
    is_recipe: { type: "BOOLEAN" }, title: str(), source_author: str(true), servings: num(true),
    prep_minutes: num(true), cook_minutes: num(true),
    ingredients: arr(obj({ raw: str(), qty: num(true), unit: str(true), item: str(), prep: str(true), optional: { type: "BOOLEAN" }, confidence: num() })),
    steps: arr(obj({ n: { type: "INTEGER" }, text: str(), confidence: num() })),
    notes: str(true), tags: obj({ cuisine: arr(str()), meal: arr(str()), diet: arr(str()), method: arr(str()) }),
    illegible: arr(str()),
  });
  const MULTI = obj({ recipes: arr(SCHEMA) });

  function fromGeminiJson(o) {
    const t = o.tags || {};
    const n = (v) => (v == null ? "" : String(Math.round(v * 100) / 100));
    return {
      isRecipe: o.is_recipe !== false, title: (o.title || "").trim(), author: o.source_author || "",
      servings: n(o.servings), prepMinutes: o.prep_minutes == null ? "" : String(Math.round(o.prep_minutes)),
      cookMinutes: o.cook_minutes == null ? "" : String(Math.round(o.cook_minutes)), notes: o.notes || "",
      cuisine: (t.cuisine || []).join(", "), meal: (t.meal || []).join(", "), diet: (t.diet || []).join(", "),
      method: (t.method || []).join(", "), illegible: o.illegible || [],
      ingredients: (o.ingredients || []).filter((i) => i.raw || i.item).map((i) => ({
        raw: (i.raw || i.item).trim(), item: i.item || i.raw, qty: i.qty ?? null, unit: i.unit || null,
        prep: i.prep || null, optional: !!i.optional, confidence: i.confidence ?? 1,
      })),
      steps: (o.steps || []).filter((s) => (s.text || "").trim()).map((s) => ({ text: s.text.trim(), confidence: s.confidence ?? 1 })),
    };
  }

  class GeminiError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

  function friendly(code, body) {
    let msg = "";
    try { msg = JSON.parse(body).error.message || ""; } catch {}
    if (code === 400) return /API key/i.test(msg) ? "The Gemini key isn't valid. Check it in Settings." : "Gemini couldn't process this: " + msg;
    if (code === 401 || code === 403) return "The Gemini key was refused. Check it in Settings.";
    if (code === 429) return "Gemini's free daily limit is used up. Try again later.";
    if (code >= 500) return "Gemini is busy right now. Try again shortly.";
    return `Gemini error ${code}${msg ? ": " + msg : ""}`;
  }

  async function call(path, body) {
    const res = await fetch(API + path, {
      method: body ? "POST" : "GET",
      headers: { "x-goog-api-key": Settings.key, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new GeminiError(res.status, friendly(res.status, text));
    return JSON.parse(text);
  }

  /** Newest stable Flash (or Flash-Lite) model that can generate content. */
  function pickModel(list, lite) {
    const c = (list.models || []).map((m) => {
      const id = (m.name || "").replace(/^models\//, "");
      const v = parseFloat((id.match(/^gemini-(\d+(?:\.\d+)?)-flash/) || [])[1]);
      const ok = (m.supportedGenerationMethods || []).includes("generateContent") && !isNaN(v) &&
        !/image|tts|live|audio|thinking|8b/.test(id) && id.includes("lite") === lite;
      return ok ? { id, v, stable: !/preview|exp|-\d{3,}$/.test(id) } : null;
    }).filter(Boolean);
    c.sort((a, b) => (b.stable - a.stable) || (b.v - a.v) || (a.id.length - b.id.length));
    return c[0]?.id || null;
  }

  async function detectModels() {
    const list = await call("models?pageSize=200");
    const flash = pickModel(list, false), lite = pickModel(list, true);
    if (!flash && !lite) throw new GeminiError(0, "No suitable Gemini model is available for this key.");
    Settings.models = { flash: flash || lite, lite: lite || flash };
    return Settings.models;
  }

  /** Thinking turned down to the minimum: it is most of Gemini's wait and reading needs little of it. */
  const thinkingFor = (model) => (parseFloat((model.match(/^gemini-(\d+(?:\.\d+)?)/) || [])[1]) >= 3
    ? { thinkingLevel: "low" } : { thinkingBudget: 0 });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function generate(parts, schema, thorough) {
    let models = Settings.models || (await detectModels());
    const body = (model, thinking) => ({
      system_instruction: { parts: [{ text: PROMPT }] },
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.2, ...(thinking ? { thinkingConfig: thinking } : {}) },
    });
    async function attempt(model) {
      const waits = [3000, 10000];
      for (let i = 0; ; i++) {
        try {
          try { return await call(`models/${model}:generateContent`, body(model, thinkingFor(model))); }
          catch (e) { if (e.code === 400 && /think/i.test(e.message)) return await call(`models/${model}:generateContent`, body(model, null)); throw e; }
        } catch (e) {
          const retry = !(e instanceof GeminiError) || [500, 502, 503, 504].includes(e.code);
          if (!retry || i >= waits.length) throw e;
          await sleep(waits[i]);
        }
      }
    }
    let res;
    try { res = await attempt(thorough ? models.flash : models.lite); }
    catch (e) { if (e.code !== 404) throw e; models = await detectModels(); res = await attempt(thorough ? models.flash : models.lite); }
    const cand = res.candidates?.[0];
    if (!cand) throw new Error(res.promptFeedback?.blockReason ? `Gemini declined this (${res.promptFeedback.blockReason}).` : "Gemini returned no answer.");
    const text = (cand.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("");
    if (!text.trim()) throw new Error(`Gemini returned an empty answer (${cand.finishReason}).`);
    return JSON.parse(text);
  }

  const blobToBase64 = (blob) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });

  const Gemini = {
    get configured() { return !!Settings.key; },
    detectModels,
    async readPhotos(blobs, thorough) {
      const parts = [];
      for (let i = 0; i < blobs.length; i++) {
        parts.push({ text: `Page ${i + 1} of ${blobs.length}:` });
        parts.push({ inline_data: { mime_type: "image/jpeg", data: await blobToBase64(blobs[i]) } });
      }
      parts.push({ text: "This is ONE recipe. Transcribe it into the JSON format." });
      return fromGeminiJson(await generate(parts, SCHEMA, thorough));
    },
    async readText(text) {
      const parts = [
        { text: "This text comes from a document, from text copied off a photo, or from dictation. It may contain recognition mistakes, missing line breaks, and one OR SEVERAL recipes:\n\n" + text },
        { text: "Return every recipe in it, in order, in the JSON format. Fix obvious recognition mistakes only when you are sure." },
      ];
      return ((await generate(parts, MULTI, false)).recipes || []).map(fromGeminiJson);
    },
  };

  // ------------------------------------------------------------------ libraries loaded only when needed

  const loaded = {};
  function script(src) {
    loaded[src] ??= new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = () => rej(new Error("Couldn't load " + src.split("/").pop() + ". Are you online?"));
      document.head.appendChild(s);
    });
    return loaded[src];
  }
  const LIB = {
    tesseract: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",
    pdf: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
    pdfWorker: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
    jszip: "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
  };

  /** Basic free reader (Tesseract, in the browser). Good on print, weak on handwriting. */
  async function ocr(blobs) {
    await script(LIB.tesseract);
    const worker = await root.Tesseract.createWorker("eng");
    try {
      const lines = [];
      for (const b of blobs) {
        const { data } = await worker.recognize(b);
        for (const l of data.lines || []) lines.push({ text: l.text, confidence: (l.confidence || 0) / 100, height: l.bbox ? l.bbox.y1 - l.bbox.y0 : 0 });
      }
      return lines;
    } finally { await worker.terminate(); }
  }

  // ------------------------------------------------------------------ images

  const MAX_EDGE = 1600;
  /** Any photo/canvas -> JPEG Blob at most MAX_EDGE px on its long side. */
  async function toJpeg(source) {
    let bmp = source;
    if (source instanceof Blob) {
      bmp = await new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img); img.onerror = () => rej(new Error("That file isn't a photo the browser can read"));
        img.src = URL.createObjectURL(source);
      });
    }
    const w = bmp.naturalWidth || bmp.width, h = bmp.naturalHeight || bmp.height;
    const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.src?.startsWith("blob:")) URL.revokeObjectURL(bmp.src);
    return new Promise((res) => c.toBlob(res, "image/jpeg", 0.88));
  }

  async function pdfPages(file, maxPages) {
    await script(LIB.pdf);
    root.pdfjsLib.GlobalWorkerOptions.workerSrc = LIB.pdfWorker;
    const pdf = await root.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const out = [];
    for (let i = 1; i <= Math.min(pdf.numPages, maxPages ?? pdf.numPages); i++) {
      const page = await pdf.getPage(i);
      const v = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: MAX_EDGE / Math.max(v.width, v.height) });
      const c = document.createElement("canvas");
      c.width = vp.width; c.height = vp.height;
      const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: g, viewport: vp }).promise;
      out.push(await toJpeg(c));
    }
    return { pages: out, total: pdf.numPages };
  }
  async function pdfPageCount(file) {
    await script(LIB.pdf);
    root.pdfjsLib.GlobalWorkerOptions.workerSrc = LIB.pdfWorker;
    return (await root.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise).numPages;
  }

  async function docxText(file) {
    await script(LIB.jszip);
    const zip = await root.JSZip.loadAsync(file);
    const xml = await zip.file("word/document.xml")?.async("string");
    if (!xml) throw new Error("This doesn't look like a Word (.docx) file");
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    return [...doc.getElementsByTagNameNS(W, "p")].map((p) => {
      let s = "";
      for (const el of p.getElementsByTagNameNS(W, "*")) {
        if (el.localName === "t") s += el.textContent;
        else if (el.localName === "tab") s += "\t";
        else if (el.localName === "br" || el.localName === "cr") s += "\n";
      }
      return s;
    }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  // ------------------------------------------------------------------ reading queue (one at a time)

  let queue = Promise.resolve();
  const enqueue = (job) => (queue = queue.then(job, job));

  const BASIC_NOTE = "Read with the basic reader, which struggles with handwriting. Add a free Gemini key in Settings for much better results, then tap Read again.";
  const fallbackNote = (e) => `Gemini couldn't read this (${e.message}), so the basic reader was used. Tap Read again later to retry with Gemini.`;

  async function finish(r, draft, note) {
    const message = draft.isRecipe ? note : ["No recipe was found. Check the photo, or type it in.", note].filter(Boolean).join(" ");
    if (!(await Store.get(r.id))) return; // deleted meanwhile
    await Store.put(applyDraft(r, draft, STATUS.REVIEW, message));
  }

  function readPhotos(id, thorough) {
    return enqueue(async () => {
      const r = await Store.get(id);
      if (!r) return;
      try {
        let draft, note = null;
        if (Gemini.configured) {
          try { draft = await Gemini.readPhotos(r.photos, thorough); }
          catch (e) { draft = RB.parseRecipe(await ocr(r.photos)); note = fallbackNote(e); }
        } else { draft = RB.parseRecipe(await ocr(r.photos)); note = BASIC_NOTE; }
        await finish(r, draft, note);
      } catch (e) {
        r.status = STATUS.FAILED; r.error = e.message || String(e);
        await Store.put(r);
      }
    });
  }

  const Reader = {
    async fromPhotos(blobs) {
      const photos = [];
      for (const b of blobs) photos.push(await toJpeg(b));
      const id = await Store.put(newRecipe({ title: "Reading recipe…", photos, status: STATUS.PROCESSING }));
      readPhotos(id, false);
      return id;
    },
    async again(id) {
      const r = await Store.get(id);
      r.status = STATUS.PROCESSING; r.error = null;
      await Store.put(r);
      readPhotos(id, true);
    },
    /** Text (pasted, typed, dictated, from a Word file). Returns the first new recipe's id. */
    async fromText(text) {
      const id = await Store.put(newRecipe({ title: "Reading recipe…", status: STATUS.PROCESSING }));
      enqueue(async () => {
        const r = await Store.get(id);
        try {
          let drafts, note = null;
          if (Gemini.configured) {
            try { drafts = await Gemini.readText(text); if (!drafts.length) throw new Error("no recipe found"); }
            catch (e) { drafts = [RB.parseRecipe(text.split("\n").map((t) => ({ text: t })))]; note = fallbackNote(e); }
          } else drafts = [RB.parseRecipe(text.split("\n").map((t) => ({ text: t })))];
          await finish(r, drafts[0], note);
          for (const d of drafts.slice(1)) await Store.put(applyDraft(newRecipe({}), d, STATUS.REVIEW, note));
        } catch (e) { r.status = STATUS.FAILED; r.error = e.message; await Store.put(r); }
      });
      return id;
    },
    async fromPdf(file, onePerPage) {
      const { pages } = await pdfPages(file, onePerPage ? undefined : 8);
      const ids = [];
      if (onePerPage) for (const p of pages) ids.push(await Reader.fromPhotos([p]));
      else ids.push(await Reader.fromPhotos(pages));
      return ids;
    },
    pdfPageCount,
    async fromDocument(file) {
      const name = file.name.toLowerCase();
      let text;
      if (name.endsWith(".docx")) text = await docxText(file);
      else if (name.endsWith(".doc")) text = RB.docText(new Uint8Array(await file.arrayBuffer()));
      else text = await file.text();
      if (!text.trim()) throw new Error("No text was found in this file");
      return Reader.fromText(text);
    },
  };

  // ------------------------------------------------------------------ collections: import, export, family recipes

  /** Adds collection recipes; ones already present (same title) only get a missing source filled in. */
  async function importDrafts(drafts) {
    const existing = new Map((await Store.all()).map((r) => [r.title.toLowerCase(), r]));
    const add = [], fix = [];
    for (const d of drafts) {
      const old = existing.get(d.title.toLowerCase());
      if (old) { if (!old.author && d.author) { old.author = d.author; fix.push(old); } continue; }
      const r = applyDraft(newRecipe({}), d, STATUS.SAVED, null);
      existing.set(d.title.toLowerCase(), r);
      add.push(r);
    }
    if (add.length || fix.length) await Store.putMany([...add, ...fix]);
    return { added: add.length, skipped: drafts.length - add.length };
  }

  const Collection = {
    async importFile(file) { return importDrafts(RB.parseCollection(JSON.parse(await file.text()))); },
    async export() {
      const all = (await Store.all()).filter((r) => r.status === STATUS.SAVED);
      const list = (s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []);
      return {
        format: "recipebox-collection", version: 1, exported: new Date().toISOString(),
        recipes: all.map((r) => ({
          title: r.title, source: r.author || null, servings: r.servings ? +r.servings : null,
          prep_minutes: r.prepMinutes ? +r.prepMinutes : null, cook_minutes: r.cookMinutes ? +r.cookMinutes : null,
          meal: list(r.meal), cuisine: list(r.cuisine), diet: list(r.diet), method: list(r.method),
          notes: r.notes || null, ingredients: r.ingredients.map((i) => i.raw), steps: r.steps.map((s) => s.text),
        })),
      };
    },
    /** The family collection, published encrypted next to the app. */
    async loadFamily(passphrase) {
      const res = await fetch("family.enc.json", { cache: "no-cache" });
      if (!res.ok) throw new Error("The family recipes file isn't available right now.");
      const enc = await res.json();
      const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
      const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase.trim()), "PBKDF2", false, ["deriveKey"]);
      const key = await crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: b64(enc.salt), iterations: enc.iterations, hash: "SHA-256" },
        material, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
      let plain;
      try { plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(enc.iv) }, key, b64(enc.data)); }
      catch { throw new Error("That passphrase isn't right."); }
      localStorage.setItem("familyPass", passphrase.trim());
      return importDrafts(RB.parseCollection(JSON.parse(new TextDecoder().decode(plain))));
    },
  };

  root.RB = Object.assign(RB, { Store, Settings, Gemini, Reader, Collection, STATUS, newRecipe, applyDraft, pickModel });
})(globalThis);
