/* Recipe Box — screens. Hash routes: #/ · #/r/ID · #/edit/ID · #/cook · #/text · #/settings */
(function () {
  "use strict";
  const { Store, Settings, Gemini, Reader, Collection, STATUS } = RB;
  const LOW = 0.75; // lines below this confidence are highlighted for checking
  const main = document.getElementById("main");

  // ------------------------------------------------------------------ tiny DOM helper

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "class") el.className = v;
      else if (k === "value") el.value = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k.nodeType ? k : String(k));
    return el;
  }
  /** Like replaceChildren, but flattens nested lists and skips null/false (which replaceChildren would print). */
  function fill(el, ...kids) { el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false)); return el; }
  const icon = (name) => h("span", { class: "icon", "aria-hidden": "true" }, ICONS[name] || "");
  const ICONS = { back: "‹", gear: "⚙", heart: "♥", heartOff: "♡", edit: "✎", trash: "🗑", again: "↻", up: "↑", down: "↓", x: "✕", plus: "+", search: "⌕" };
  const tags = (s) => (s || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const total = (r) => (r.prepMinutes || r.cookMinutes ? (+r.prepMinutes || 0) + (+r.cookMinutes || 0) : null);
  const go = (hash) => { location.hash = hash; };

  let urls = [];
  const photoUrl = (blob) => { const u = URL.createObjectURL(blob); urls.push(u); return u; };

  function toast(msg) {
    const t = h("div", { class: "toast", role: "status" }, msg);
    document.body.append(t);
    setTimeout(() => t.classList.add("show"), 10);
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 3500);
  }

  function topbar(title, { back, actions } = {}) {
    return h("header", { class: "bar" },
      back ? h("button", { class: "iconbtn", "aria-label": "Back", onclick: () => (history.length > 1 ? history.back() : go("#/")) }, icon("back")) : null,
      h("h1", {}, title),
      h("div", { class: "actions" }, actions || []));
  }

  function meta(r) {
    return [r.author && (r.author.startsWith("Aayi") || /book|types of/i.test(r.author) ? r.author : "by " + r.author),
      total(r) && total(r) + " min", r.servings && "serves " + r.servings, tags(r.cuisine)[0] && (RB.titleCase ? RB.titleCase(tags(r.cuisine)[0]) : tags(r.cuisine)[0])].filter(Boolean).join(" · ");
  }

  function photoViewer(blob) {
    const ov = h("div", { class: "overlay", onclick: () => ov.remove() },
      h("img", { src: photoUrl(blob), alt: "Recipe photo" }),
      h("button", { class: "iconbtn close", "aria-label": "Close" }, icon("x")));
    document.body.append(ov);
  }
  const photoStrip = (photos, size) => photos.length
    ? h("div", { class: "strip" }, photos.map((p, i) => h("img", { src: photoUrl(p), alt: `Page ${i + 1}`, class: size, onclick: () => photoViewer(p) })))
    : null;

  // ------------------------------------------------------------------ home

  const homeState = { query: "", fav: false, quick: false, meal: null };

  async function home() {
    const all = (await Store.all()).sort((a, b) => b.updatedAt - a.updatedAt);
    const pending = all.filter((r) => r.status !== STATUS.SAVED);
    const saved = all.filter((r) => r.status === STATUS.SAVED);
    // Filter grid rows: Favourites · Quick · Drink, then Breakfast · Lunch · Dinner together, then Snack · Side · Dessert.
    const used = new Set(saved.flatMap((r) => tags(r.meal)));
    const mainMeals = ["breakfast", "lunch", "dinner"].filter((m) => used.has(m));
    const known = ["breakfast", "lunch", "dinner", "snack", "side", "dessert", "drink"];
    const moreMeals = [...["snack", "side", "dessert"].filter((m) => used.has(m)), ...[...used].filter((m) => !known.includes(m)).sort()];
    const sentence = (s) => s.charAt(0).toUpperCase() + s.slice(1);

    const list = h("div", { class: "list" });
    function draw() {
      const words = homeState.query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
      const hay = (r) => [r.title, r.author, r.notes, r.cuisine, r.meal, r.diet, r.method,
        ...r.ingredients.map((i) => i.raw + " " + i.item), ...r.steps.map((s) => s.text)].join(" ").toLowerCase();
      const shown = saved.filter((r) => {
        if (homeState.fav && !r.favorite) return false;
        if (homeState.quick && !(total(r) && total(r) <= 30)) return false;
        if (homeState.meal && !tags(r.meal).includes(homeState.meal)) return false;
        if (words.length) { const s = hay(r); return words.every((w) => new RegExp("(^|[^\\p{L}\\p{N}])" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u").test(s)); }
        return true;
      });
      fill(list, 
        pending.length ? [h("h2", {}, "Needs review"), pending.map((r) => row(r, () => go("#/edit/" + r.id)))] : [],
        h("h2", {}, words.length ? `Results (${shown.length})` : `My recipes (${saved.length})`),
        shown.length ? shown.slice(0, 300).map((r) => row(r, () => go("#/r/" + r.id)))
          : h("p", { class: "muted pad" }, saved.length ? "Nothing matches." : "No recipes yet."),
        shown.length > 300 ? h("p", { class: "muted pad" }, `Showing 300 of ${shown.length}. Search to narrow down.`) : null,
      );
    }

    const chip = (label, on, click) => h("button", { class: "chip" + (on ? " on" : ""), onclick: click }, label);
    // The main action on its own full-width button, then the filters in an even 3-column grid.
    const chips = h("div", { class: "filtergrid" });
    const mealChip = (m) => chip(sentence(m), homeState.meal === m, () => { homeState.meal = homeState.meal === m ? null : m; drawChips(); draw(); });
    function drawChips() {
      fill(chips,
        h("button", { class: "cookbtn", onclick: () => go("#/cook") }, "What can I cook?"),
        chip("Favourites", homeState.fav, () => { homeState.fav = !homeState.fav; drawChips(); draw(); }),
        chip("Quick", homeState.quick, () => { homeState.quick = !homeState.quick; drawChips(); draw(); }),
        used.has("drink") ? mealChip("drink") : h("span"),
        mainMeals.map(mealChip), mainMeals.length ? Array.from({ length: (3 - mainMeals.length) % 3 }, () => h("span")) : [],
        moreMeals.map(mealChip),
        h("button", { class: "cookbtn", onclick: addSheet }, "Add recipe"), // just above the recipe lists
      );
    }
    drawChips(); draw();

    const search = h("input", { type: "search", class: "search", placeholder: "Search recipes, ingredients, notes…", value: homeState.query,
      oninput: (e) => { homeState.query = e.target.value; draw(); } });

    fill(main, 
      topbar("Recipe Box", { actions: [h("button", { class: "iconbtn", "aria-label": "Settings", onclick: () => go("#/settings") }, icon("gear"))] }),
      h("div", { class: "pad" }, search), chips,
      !all.length ? welcome() : null,
      list,
    );
  }

  function row(r, onclick) {
    const sub = r.status === STATUS.PROCESSING ? "Reading…"
      : r.status === STATUS.FAILED ? "Couldn't read: " + (r.error || "unknown error")
      : r.status === STATUS.REVIEW ? (r.error || "Ready to check against the photo") : meta(r);
    return h("button", { class: "row", onclick },
      h("div", { class: "thumb" }, r.photos?.[0] ? h("img", { src: photoUrl(r.photos[0]), alt: "" }) : (r.title[0] || "?").toUpperCase()),
      h("div", { class: "rowtext" },
        h("div", { class: "rowtitle" }, r.title || "Untitled", r.favorite ? h("span", { class: "fav" }, " ♥") : null),
        sub ? h("div", { class: "rowsub" + (r.status === STATUS.FAILED ? " err" : "") }, sub) : null),
      r.status === STATUS.PROCESSING ? h("div", { class: "spinner", "aria-label": "Reading" }) : null);
  }

  function welcome() {
    return h("div", { class: "card pad" },
      h("h3", {}, "Welcome!"),
      h("p", {}, "Load the family recipe collection, or add your own recipes with the Add recipe button."),
      h("button", { class: "btn", onclick: familyDialog }, "Load family recipes"));
  }

  // ------------------------------------------------------------------ add sheet

  function pick(accept, multiple) {
    return new Promise((res) => {
      const i = h("input", { type: "file", accept, multiple, style: "display:none", onchange: () => { res([...i.files]); i.remove(); } });
      document.body.append(i); i.click();
    });
  }

  function addSheet() {
    const close = () => sheet.remove();
    const opt = (title, sub, fn) => h("button", { class: "opt", onclick: () => { close(); fn(); } }, h("b", {}, title), h("span", {}, sub));
    const sheet = h("div", { class: "sheetbg", onclick: (e) => e.target === sheet && close() },
      h("div", { class: "sheet" },
        opt("Take or choose photos", "Recipe cards, notebook pages, cookbook pages", addPhotos),
        opt("Import a file", "PDF, Word (.docx / .doc), text, or a Recipe Box collection (.json)", importFile),
        opt("Paste, type or dictate", "Text copied with Live Text, or read it aloud with the keyboard mic", () => go("#/text")),
        opt("Load family recipes", "The shared family collection (needs the passphrase)", familyDialog),
        h("button", { class: "btn ghost", onclick: close }, "Cancel")));
    document.body.append(sheet);
  }

  async function addPhotos() {
    const files = await pick("image/*", true);
    if (!files.length) return;
    try { await Reader.fromPhotos(files); toast("Reading your recipe… it will appear under Needs review."); }
    catch (e) { toast("Couldn't use those photos: " + e.message); }
  }

  async function importFile() {
    const [file] = await pick(".pdf,.docx,.doc,.txt,.json,application/pdf,application/json,text/plain", false);
    if (!file) return;
    const name = file.name.toLowerCase();
    try {
      if (name.endsWith(".json")) {
        const { added, skipped } = await Collection.importFile(file);
        toast(`Added ${added} recipes` + (skipped ? ` (${skipped} already here)` : ""));
      } else if (name.endsWith(".pdf")) {
        const pages = await Reader.pdfPageCount(file);
        const one = pages <= 1 ? false : await choose(`This PDF has ${pages} pages`,
          "Is it one recipe over several pages, or one recipe on each page?" + (pages > 8 ? " As one recipe, only the first 8 pages are used." : ""),
          [["One per page", true], ["One recipe", false]]);
        if (one == null) return;
        toast("Reading the PDF…");
        await Reader.fromPdf(file, one);
      } else {
        await Reader.fromDocument(file);
        toast("Reading… new recipes will appear under Needs review.");
      }
    } catch (e) { toast("Couldn't import: " + e.message); }
  }

  function choose(title, text, options) {
    return new Promise((res) => {
      const done = (v) => { dlg.remove(); res(v); };
      const dlg = h("div", { class: "sheetbg" }, h("div", { class: "dialog" },
        h("h3", {}, title), h("p", {}, text),
        h("div", { class: "row-btns" }, h("button", { class: "btn ghost", onclick: () => done(null) }, "Cancel"),
          options.map(([label, v]) => h("button", { class: "btn", onclick: () => done(v) }, label)))));
      document.body.append(dlg);
    });
  }

  function familyDialog() {
    const input = h("input", { type: "password", placeholder: "Passphrase", autocomplete: "off", value: localStorage.getItem("familyPass") || "" });
    const msg = h("p", { class: "muted" });
    const btn = h("button", { class: "btn" }, "Load");
    const dlg = h("div", { class: "sheetbg" }, h("div", { class: "dialog" },
      h("h3", {}, "Family recipes"),
      h("p", {}, "Enter the passphrase you were given. Recipes already on this phone are kept; only new ones are added."),
      input, msg,
      h("div", { class: "row-btns" }, h("button", { class: "btn ghost", onclick: () => dlg.remove() }, "Close"), btn)));
    btn.onclick = async () => {
      btn.disabled = true; msg.textContent = "Loading…";
      try {
        const { added, skipped } = await Collection.loadFamily(input.value);
        dlg.remove();
        toast(added ? `Added ${added} family recipes` : `You already have all ${skipped} family recipes`);
      } catch (e) { msg.textContent = e.message; btn.disabled = false; }
    };
    document.body.append(dlg);
    input.focus();
  }

  // ------------------------------------------------------------------ recipe view

  async function detail(id) {
    const r = await Store.get(id);
    if (!r) return go("#/");
    const fav = h("button", { class: "iconbtn", "aria-label": r.favorite ? "Remove from favourites" : "Add to favourites",
      onclick: async () => { r.favorite = !r.favorite; await Store.put(r); render(); } }, icon(r.favorite ? "heart" : "heartOff"));
    const allTags = [...new Set([r.cuisine, r.meal, r.diet, r.method].flatMap(tags))];
    fill(main, 
      topbar("", { back: true, actions: [fav, h("button", { class: "iconbtn", "aria-label": "Edit", onclick: () => go("#/edit/" + r.id) }, icon("edit"))] }),
      h("article", { class: "pad recipe" },
        h("h1", { class: "title" }, r.title),
        h("p", { class: "muted" }, [r.author && meta({ ...r, servings: "", prepMinutes: "", cookMinutes: "", cuisine: "" }),
          r.prepMinutes && `prep ${r.prepMinutes} min`, r.cookMinutes && `cook ${r.cookMinutes} min`, r.servings && `serves ${r.servings}`].filter(Boolean).join(" · ")),
        allTags.length ? h("div", { class: "tags" }, allTags.map((t) => h("span", { class: "tag" }, t))) : null,
        photoStrip(r.photos || [], "small"),
        h("h2", {}, "Ingredients"),
        h("ul", { class: "ings" }, r.ingredients.map((i) => h("li", {}, i.raw + (i.optional && !/optional/i.test(i.raw) ? " (optional)" : "")))),
        h("h2", {}, "Method"),
        h("ol", { class: "steps" }, r.steps.map((s) => h("li", {}, s.text))),
        r.notes ? [h("h2", {}, "Notes"), h("p", { class: "notes" }, r.notes)] : null));
  }

  // ------------------------------------------------------------------ review / edit

  async function edit(id) {
    const r = await Store.get(id);
    if (!r) return go("#/");
    const d = structuredClone({ ...r, photos: undefined });
    const body = h("div", { class: "pad" });
    const field = (label, key, opts = {}) => h("label", { class: "field" + (opts.half ? " half" : "") }, h("span", {}, label),
      h(opts.multi ? "textarea" : "input", { value: d[key] ?? "", inputmode: opts.num ? "decimal" : null, rows: opts.multi ? 3 : null,
        oninput: (e) => { d[key] = e.target.value; } }));

    function draw() {
      const unsure = (c) => (c ?? 1) < LOW;
      fill(body, 
        r.status === STATUS.PROCESSING ? h("div", { class: "card" }, h("div", { class: "spinner" }), " Reading the photo…") : null,
        r.status === STATUS.FAILED ? h("div", { class: "card err" }, h("b", {}, "Couldn't read this recipe. "), r.error || "", " You can type it in below.") : null,
        r.status !== STATUS.FAILED && r.error ? h("div", { class: "card err" }, r.error) : null,
        d.illegible?.length ? h("div", { class: "card warn" }, h("b", {}, "Hard to read: "), d.illegible.join(" · ")) : null,
        field("Title", "title"), field("Whose recipe / source", "author"),
        h("div", { class: "three" }, field("Serves", "servings", { num: 1 }), field("Prep min", "prepMinutes", { num: 1 }), field("Cook min", "cookMinutes", { num: 1 })),
        h("h2", {}, "Ingredients"),
        d.ingredients.map((ing, i) => h("div", { class: "editrow" + (unsure(ing.confidence) ? " unsure" : "") },
          h("div", { class: "grow" },
            h("input", { value: ing.raw, "aria-label": "Ingredient as written", oninput: (e) => { ing.raw = e.target.value; } }),
            h("input", { class: "small", value: ing.item, "aria-label": "Search as", placeholder: "search as, e.g. garlic", oninput: (e) => { ing.item = e.target.value; } }),
            unsure(ing.confidence) ? h("span", { class: "hint" }, "Check this against the photo") : null),
          h("div", { class: "col" },
            h("button", { class: "iconbtn", "aria-label": "Remove", onclick: () => { d.ingredients.splice(i, 1); draw(); } }, icon("x")),
            h("button", { class: "iconbtn", "aria-label": "Move to method", onclick: () => { d.ingredients.splice(i, 1); d.steps.push({ text: ing.raw, confidence: ing.confidence }); draw(); } }, icon("down"))))),
        h("button", { class: "btn ghost", onclick: () => { d.ingredients.push({ raw: "", item: "", confidence: 1 }); draw(); } }, "+ Add ingredient"),
        h("h2", {}, "Method"),
        d.steps.map((s, i) => h("div", { class: "editrow" + (unsure(s.confidence) ? " unsure" : "") },
          h("span", { class: "num" }, i + 1),
          h("div", { class: "grow" }, h("textarea", { rows: 2, value: s.text, oninput: (e) => { s.text = e.target.value; } }),
            unsure(s.confidence) ? h("span", { class: "hint" }, "Check this against the photo") : null),
          h("div", { class: "col" },
            h("button", { class: "iconbtn", "aria-label": "Remove", onclick: () => { d.steps.splice(i, 1); draw(); } }, icon("x")),
            h("button", { class: "iconbtn", "aria-label": "Move to ingredients", onclick: () => { d.steps.splice(i, 1); d.ingredients.push(RB.parseIngredient(s.text, s.confidence)); draw(); } }, icon("up"))))),
        h("button", { class: "btn ghost", onclick: () => { d.steps.push({ text: "", confidence: 1 }); draw(); } }, "+ Add step"),
        h("h2", {}, "Tags & notes"),
        field("Cuisine (comma separated)", "cuisine"), field("Meal: breakfast, dinner, dessert…", "meal"),
        field("Diet: vegetarian, vegan…", "diet"), field("Method: oven, stovetop…", "method"),
        field("Notes", "notes", { multi: 1 }),
      );
    }
    draw();

    const actions = [];
    if (r.photos?.length && r.status !== STATUS.PROCESSING)
      actions.push(h("button", { class: "iconbtn", "aria-label": "Read again", title: "Read again with the stronger model",
        onclick: async () => { await Reader.again(r.id); toast("Reading again with the stronger model…"); render(); } }, icon("again")));
    actions.push(h("button", { class: "iconbtn", "aria-label": "Delete", onclick: async () => {
      if (await choose("Delete this recipe?", "The recipe and its photos will be removed from this phone.", [["Delete", true]])) { await Store.remove(r.id); go("#/"); }
    } }, icon("trash")));

    fill(main, 
      topbar(r.status === STATUS.SAVED ? "Edit recipe" : "Check recipe", { back: true, actions }),
      photoStrip(r.photos || [], "big"),
      body,
      r.status !== STATUS.PROCESSING ? h("div", { class: "savebar" }, h("button", { class: "btn wide", onclick: async () => {
        const fresh = await Store.get(r.id);
        if (!fresh) return go("#/");
        await Store.put(RB.applyDraft(fresh, d, STATUS.SAVED, null));
        history.replaceState(null, "", "#/r/" + r.id); render();
      } }, "Save recipe")) : null);
  }

  // ------------------------------------------------------------------ what can I cook?

  const cookState = { maxMissing: 2 };
  async function cook() {
    const saved = (await Store.all()).filter((r) => r.status === STATUS.SAVED);
    const byId = new Map(saved.map((r) => [r.id, r]));
    const items = saved.flatMap((r) => r.ingredients.map((i) => ({ recipeId: r.id, item: i.item, optional: i.optional })));
    let have = Settings.pantry;
    const results = h("div", { class: "list" });
    const chipsEl = h("div", { class: "chips wrap pad" });
    const sugg = h("div", { class: "chips wrap pad" });
    const filters = h("div", { class: "chips wrap pad" });

    function setHave(v) { have = v; Settings.pantry = v; draw(); }
    function add(text) {
      const fresh = text.split(",").map(RB.canonical).filter((x) => x && !have.includes(x));
      if (fresh.length) setHave([...have, ...fresh]);
    }
    function draw() {
      fill(chipsEl, have.map((x) => h("button", { class: "chip on", onclick: () => setHave(have.filter((y) => y !== x)) }, x, " ✕")));
      const counts = {};
      for (const it of items) { const c = RB.canonical(it.item); if (c && !RB.isStaple(c) && !have.includes(c)) counts[c] = (counts[c] || 0) + 1; }
      fill(sugg, h("span", { class: "muted small" }, "Common in your recipes:"),
        Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([c]) => h("button", { class: "chip", onclick: () => add(c) }, "+ " + c)));
      fill(filters, [[0, "Have everything"], [1, "Missing ≤ 1"], [2, "Missing ≤ 2"], [null, "Any"]].map(([v, label]) =>
        h("button", { class: "chip" + (cookState.maxMissing === v ? " on" : ""), onclick: () => { cookState.maxMissing = v; draw(); } }, label)));
      const ranked = RB.rank(items, have, cookState.maxMissing);
      fill(results, 
        !have.length ? h("p", { class: "muted pad" }, "Add what's in your kitchen. Salt, oil, sugar, pepper and water are assumed.")
          : !ranked.length ? h("p", { class: "muted pad" }, "No recipes match yet. Try allowing more missing ingredients.") : null,
        ranked.slice(0, 200).map((m) => h("button", { class: "row match", onclick: () => go("#/r/" + m.recipeId) },
          h("div", { class: "rowtext" },
            h("div", { class: "rowtitle" }, byId.get(m.recipeId).title, h("span", { class: "score" }, ` ${m.have}/${m.needed}`)),
            h("div", { class: "meter" }, h("div", { style: `width:${Math.round(m.fraction * 100)}%` })),
            h("div", { class: "rowsub" }, m.missing.length ? "Missing: " + m.missing.join(", ") : "You have everything")))));
    }
    const input = h("input", { type: "text", placeholder: "e.g. rice, urad dal, coconut", enterkeyhint: "done",
      onkeydown: (e) => { if (e.key === "Enter") { add(input.value); input.value = ""; } } });
    draw();
    fill(main, 
      topbar("What can I cook?", { back: true, actions: [h("button", { class: "linkbtn", onclick: () => setHave([]) }, "Clear")] }),
      h("div", { class: "pad addline" }, input, h("button", { class: "btn", onclick: () => { add(input.value); input.value = ""; } }, "Add")),
      chipsEl, sugg, filters, results);
  }

  // ------------------------------------------------------------------ text

  function textScreen() {
    const ta = h("textarea", { class: "big", rows: 14, placeholder: "Title\nIngredients…\nMethod…" });
    const make = h("button", { class: "btn wide", onclick: async () => {
      if (!ta.value.trim()) return;
      make.disabled = true;
      const id = await Reader.fromText(ta.value);
      history.replaceState(null, "", "#/edit/" + id); render();
    } }, "Make recipe");
    fill(main, 
      topbar("Recipe from text", { back: true }),
      h("div", { class: "pad" },
        h("p", { class: "muted small" }, "On iPhone: open the photo in Photos, press and hold the text (Live Text), tap Select All → Copy, then paste here. Or tap the microphone on the keyboard and read the recipe aloud."),
        h("button", { class: "btn ghost", onclick: async () => {
          try { const t = await navigator.clipboard.readText(); if (t) ta.value = (ta.value ? ta.value + "\n" : "") + t; else toast("Nothing to paste."); }
          catch { toast("Press and hold in the box below and choose Paste."); }
        } }, "Paste"),
        ta,
        !Gemini.configured ? h("p", { class: "muted small" }, "Without a Gemini key, put the title on the first line and each ingredient and step on its own line.") : null),
      h("div", { class: "savebar" }, make));
  }

  // ------------------------------------------------------------------ settings

  async function settings() {
    const key = h("input", { type: "password", value: Settings.key, placeholder: "Paste your Gemini API key", autocomplete: "off" });
    const status = h("p", { class: "small" });
    const models = Settings.models;
    if (Settings.key && models) status.textContent = `Working ✓ Quick reading: ${models.lite}. Read again: ${models.flash}.`;
    const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false;

    fill(main, 
      topbar("Settings", { back: true }),
      h("section", { class: "pad" },
        h("h2", {}, "Read handwriting with Gemini (free)"),
        h("p", {}, "The built-in reader works offline but can't really read handwriting. Google's Gemini can, and its free tier is plenty for a recipe collection. No credit card is needed."),
        h("ol", { class: "small" }, h("li", {}, "Open Google AI Studio and sign in with a Google account."), h("li", {}, "Tap “Create API key” and copy it."), h("li", {}, "Paste it below and tap Test key.")),
        h("a", { class: "btn ghost", href: "https://aistudio.google.com/apikey", target: "_blank", rel: "noopener" }, "Open Google AI Studio"),
        key,
        h("div", { class: "row-btns" },
          h("button", { class: "btn", onclick: async () => {
            Settings.key = key.value;
            if (!key.value.trim()) { status.textContent = "Key removed. The basic reader will be used."; return; }
            status.textContent = "Checking…";
            try { const m = await Gemini.detectModels(); status.textContent = `Working ✓ Quick reading: ${m.lite}. Read again: ${m.flash}.`; }
            catch (e) { status.textContent = "Didn't work: " + e.message; }
          } }, "Test key"),
          h("button", { class: "btn ghost", onclick: () => { Settings.key = ""; key.value = ""; status.textContent = "Key removed."; } }, "Remove")),
        status,
        h("p", { class: "muted small" }, "With a key set, photos and imported text are sent to Google to be read. On the free tier Google may use them to improve its products, so don't scan anything private. The key is stored only on this phone.")),
      h("section", { class: "pad" },
        h("h2", {}, "Family recipes"),
        h("p", {}, "Load or update the shared family collection. Only recipes you don't have yet are added."),
        h("button", { class: "btn", onclick: familyDialog }, "Load family recipes")),
      h("section", { class: "pad" },
        h("h2", {}, "Backup"),
        h("p", {}, "Your recipes live only on this phone. Save a backup now and then (to Files, iCloud Drive or Google Drive), and use Import a file to restore it. Photos are not included."),
        h("div", { class: "row-btns" },
          h("button", { class: "btn", onclick: async () => {
            const data = await Collection.export();
            const file = new File([JSON.stringify(data)], `recipe-box-backup-${new Date().toISOString().slice(0, 10)}.json`, { type: "application/json" });
            if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: "Recipe Box backup" }); return; } catch (e) { if (e.name === "AbortError") return; } }
            const a = h("a", { href: URL.createObjectURL(file), download: file.name }); document.body.append(a); a.click(); a.remove();
          } }, "Save backup"),
          h("button", { class: "btn ghost", onclick: importFile }, "Restore / import")),
        h("p", { class: "muted small" }, persisted ? "This phone keeps the recipes permanently ✓"
          : "Tip: add Recipe Box to your Home Screen (Share → Add to Home Screen) so iPhone keeps your recipes permanently.")));
  }

  // ------------------------------------------------------------------ router

  let rendering = 0;
  async function render() {
    const ticket = ++rendering;
    urls.forEach(URL.revokeObjectURL); urls = [];
    const [, route, id] = (location.hash || "#/").match(/^#\/([a-z]*)\/?(\d*)/) || [];
    if (ticket !== rendering) return;
    window.scrollTo(0, 0);
    if (route === "r") return detail(id);
    if (route === "edit") return edit(id);
    if (route === "cook") return cook();
    if (route === "text") return textScreen();
    if (route === "settings") return settings();
    return home();
  }
  window.addEventListener("hashchange", render);
  // Live updates while recipes are being read: refresh the home list, and the review screen when reading ends.
  Store.onChange(async () => {
    const route = (location.hash.match(/^#\/([a-z]*)/) || [])[1] || "";
    if (route === "") home();
    if (route === "edit") {
      const id = location.hash.split("/")[2];
      const r = await Store.get(id);
      const shownProcessing = !!main.querySelector(".card .spinner");
      if (r && shownProcessing !== (r.status === STATUS.PROCESSING)) render();
    }
  });

  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  render();
  Store.tidyTitles?.().catch(() => {}); // older recipes get the same Title Case; the list refreshes itself
})();
