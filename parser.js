/*
 * Recipe Box — recipe parsing and ingredient matching (port of the Android app's
 * Ingredients.kt, RecipeParser.kt, CollectionFormat.kt). Pure functions: runs in the browser and in Node tests.
 *
 * Draft shape: {isRecipe, title, author, servings, prepMinutes, cookMinutes, notes,
 *   cuisine, meal, diet, method (comma-separated strings), illegible: [string],
 *   ingredients: [{raw, item, qty, unit, prep, optional, confidence}], steps: [{text, confidence}]}
 */
(function (root) {
  "use strict";

  // ------------------------------------------------------------------ ingredient names

  const wordSynonyms = {
    chilli: "chili", chilly: "chili", chile: "chili",
    leave: "leaf", // "leaves" singularises to "leave"
    yoghurt: "yogurt", aubergine: "eggplant", brinjal: "eggplant",
    courgette: "zucchini", prawn: "shrimp",
  };
  const synonyms = {
    cilantro: "coriander leaf", "fresh coriander": "coriander leaf", curd: "yogurt",
    capsicum: "bell pepper", maida: "all-purpose flour", "plain flour": "all-purpose flour",
    scallion: "spring onion", "green onion": "spring onion", garbanzo: "chickpea",
    "garbanzo bean": "chickpea", channa: "chickpea", "lady finger": "okra", bhindi: "okra",
    "double cream": "heavy cream", "whipping cream": "heavy cream", "caster sugar": "sugar",
    "granulated sugar": "sugar", "white sugar": "sugar", "corn flour": "cornstarch", cornflour: "cornstarch",
  };
  const staples = new Set(["salt", "water", "oil", "vegetable oil", "cooking oil", "sunflower oil",
    "sugar", "pepper", "black pepper", "ice"]);
  const singularExceptions = new Set(["molasses", "hummus", "couscous", "asparagus", "swiss",
    "lemongrass", "grass", "watercress", "cress"]);

  function singular(w) {
    if (singularExceptions.has(w)) return w;
    if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
    if (w.length > 4 && (w.endsWith("oes") || w.endsWith("ches") || w.endsWith("shes"))) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) return w.slice(0, -1);
    return w;
  }

  function canonical(name) {
    const cleaned = String(name || "").toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, " ").trim()
      .split(/\s+/).filter(Boolean)
      .map((w) => { const s = singular(w); return wordSynonyms[s] || s; })
      .join(" ");
    return synonyms[cleaned] || cleaned;
  }

  const isStaple = (item) => staples.has(canonical(item));

  /** "rice" matches "basmati rice"; word-level, not substring. */
  function haveMatches(have, item) {
    const h = canonical(have), i = canonical(item);
    if (!h || !i) return false;
    if (h === i) return true;
    const words = new Set(i.split(" "));
    return h.split(" ").every((w) => words.has(w));
  }

  /**
   * items: [{recipeId, item, optional}]. Returns [{recipeId, have, needed, missing, fraction}],
   * fewest missing first. Staples and optional ingredients are ignored.
   */
  function rank(items, have, maxMissing) {
    if (!have.length) return [];
    const byRecipe = new Map();
    for (const it of items) {
      if (!byRecipe.has(it.recipeId)) byRecipe.set(it.recipeId, []);
      byRecipe.get(it.recipeId).push(it);
    }
    const out = [];
    for (const [id, rows] of byRecipe) {
      const needed = [...new Set(rows.filter((r) => !r.optional && !isStaple(r.item)).map((r) => canonical(r.item)))]
        .filter(Boolean);
      if (!needed.length) continue;
      const got = needed.filter((n) => have.some((h) => haveMatches(h, n)));
      const missing = needed.filter((n) => !got.includes(n));
      if (!got.length) continue;
      if (maxMissing != null && missing.length > maxMissing) continue;
      out.push({ recipeId: id, have: got.length, needed: needed.length, missing, fraction: got.length / needed.length });
    }
    return out.sort((a, b) => a.missing.length - b.missing.length || b.fraction - a.fraction);
  }

  // ------------------------------------------------------------------ ingredient lines

  const fractions = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };
  const wordNumbers = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, half: 0.5, quarter: 0.25, dozen: 12 };
  const units = [
    ["cup", ["cups", "cup", "c", "cs"]],
    ["tbsp", ["tablespoons", "tablespoon", "tbsps", "tbsp", "tbs", "tbl", "tb", "T"]],
    ["tsp", ["teaspoons", "teaspoon", "tsps", "tsp", "ts", "t"]],
    ["kg", ["kilograms", "kilogram", "kilos", "kilo", "kgs", "kg"]],
    ["g", ["grams", "gram", "grammes", "gms", "gm", "gr", "g"]],
    ["ml", ["millilitres", "milliliters", "ml"]],
    ["l", ["litres", "liters", "litre", "liter", "ltr", "l"]],
    ["oz", ["ounces", "ounce", "oz"]],
    ["lb", ["pounds", "pound", "lbs", "lb"]],
    ["clove", ["cloves", "clove"]],
    ["pinch", ["pinches", "pinch"]],
    ["handful", ["handfuls", "handful"]],
    ["can", ["cans", "can", "tins", "tin"]],
    ["packet", ["packets", "packet", "pkt", "pack"]],
    ["piece", ["pieces", "piece", "pcs", "pc"]],
    ["stick", ["sticks", "stick"]],
    ["bunch", ["bunches", "bunch"]],
    ["slice", ["slices", "slice"]],
    ["sprig", ["sprigs", "sprig"]],
    ["drop", ["drops", "drop"]],
    ["dash", ["dashes", "dash"]],
    ["inch", ["inches", "inch", "in"]],
    ["bottle", ["bottles", "bottle"]],
  ];
  const prepWords = new Set(["chopped", "finely", "roughly", "minced", "diced", "sliced", "thinly", "grated",
    "crushed", "peeled", "fresh", "freshly", "beaten", "melted", "softened", "cubed", "shredded", "halved",
    "washed", "soaked", "boiled", "cooked", "large", "small", "medium", "big", "heaped", "level", "rounded",
    "about", "approx"]);
  const qtyRe = /^\s*(\d+\s+\d+\/\d+|\d+\/\d+|\d+\s*[½¼¾⅓⅔⅛]|[½¼¾⅓⅔⅛]|\d+(?:[.,]\d+)?(?:\s*(?:-|to)\s*\d+(?:[.,]\d+)?)?)\s*/i;
  const numberedStep = /^\s*\d{1,2}\s*[.)]\s/;
  const ambiguousUnits = new Set(["in", "can", "tin", "tins", "cans", "pack", "drop", "drops", "dash", "stick",
    "pc", "ts", "tb", "cs", "gr", "gm", "tbl"]);
  const unitWords = new Set(units.flatMap(([, s]) => s).filter((s) => s.length > 1 && !ambiguousUnits.has(s)).map((s) => s.toLowerCase()));
  const spoonSpellings = [
    [/\b(tea\s*sp(?:oo)?ns?|t\.?\s*spn|tsp\.)/gi, "tsp"],
    [/\b(table\s*sp(?:oo)?ns?|tbl\.?\s*sp(?:oo)?ns?|tbsp\.)/gi, "tbsp"],
  ];

  function hasUnit(t) {
    const words = t.toLowerCase().split(/[\s,]+/).map((w) => w.replace(/\.+$/, ""));
    return words.some((w) => unitWords.has(w)) || /\d\s*(g|kg|ml|l|oz|lb|c|t|tsp|tbsp)\b/i.test(t);
  }

  function startsWithQuantity(text) {
    const t = text.trim();
    if (numberedStep.test(t)) return false;
    if (qtyRe.test(t)) return true;
    if (!t.includes(" ")) return false;
    const first = t.split(" ")[0].toLowerCase();
    if (first === "a" || first === "an") return hasUnit(t.slice(t.indexOf(" ") + 1));
    return first in wordNumbers;
  }

  function parseQty(s) {
    const t = s.trim().replace(",", ".");
    let m;
    if ((m = t.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return +m[1] + m[2] / m[3];
    if ((m = t.match(/^(\d+)\/(\d+)$/))) return m[1] / m[2];
    if ((m = t.match(/^(\d+)\s*([½¼¾⅓⅔⅛])$/))) return +m[1] + fractions[m[2]];
    if (t.length === 1 && fractions[t] != null) return fractions[t];
    m = t.match(/^(\d+(?:\.\d+)?)/);
    return m ? +m[1] : null;
  }

  function parseIngredient(raw, confidence = 1) {
    let rest = String(raw).trim().replace(/^[-•*·]+/, "").trim();
    for (const [re, u] of spoonSpellings) rest = rest.replace(re, u);
    let qty = null, unit = null;
    const qm = numberedStep.test(rest) ? null : rest.match(qtyRe);
    if (qm) {
      qty = parseQty(qm[1]);
      rest = rest.slice(qm[0].length);
    } else {
      const first = rest.split(" ")[0].toLowerCase();
      if (first in wordNumbers && rest.includes(" ")) { qty = wordNumbers[first]; rest = rest.slice(rest.indexOf(" ") + 1); }
    }
    rest = rest.trim();
    const nextWord = rest.split(" ")[0].replace(/[.,]+$/, "");
    const hit = units.find(([, syns]) => syns.some((s) => {
      if (s === "T" || s === "t") return qty != null && nextWord === s;
      if (s.length <= 2) return qty != null && s.toLowerCase() === nextWord.toLowerCase();
      return s.toLowerCase() === nextWord.toLowerCase();
    }));
    if (hit) { unit = hit[0]; rest = rest.includes(" ") ? rest.slice(rest.indexOf(" ") + 1).trim() : ""; }
    rest = rest.trim().replace(/^of\s+/i, "").trim();
    const optional = /\(?\boptional\b\)?/i.test(rest);
    rest = rest.replace(/\(?\boptional\b\)?/gi, "")
      .replace(/\bto taste\b|\bas needed\b|\bas required\b/gi, "")
      .replace(/\([^)]*\)/g, "");
    const prepParts = [];
    if (rest.includes(",")) { prepParts.push(rest.slice(rest.indexOf(",") + 1).trim()); rest = rest.slice(0, rest.indexOf(",")); }
    const words = rest.trim().split(/\s+/).filter(Boolean);
    const prepW = words.filter((w) => prepWords.has(w.toLowerCase().replace(/\.+$/, "")));
    const itemW = words.filter((w) => !prepWords.has(w.toLowerCase().replace(/\.+$/, "")));
    prepParts.unshift(...prepW);
    const itemText = itemW.join(" ") || words.join(" ");
    return {
      raw: String(raw).trim(), item: canonical(itemText), qty, unit,
      prep: prepParts.join(", ").trim() || null, optional, confidence,
    };
  }

  // ------------------------------------------------------------------ whole recipes from lines

  const ingredientsHeader = /^(ingredients?|ingred\.?|you( will|'ll)? need|what you need|for the [a-z ]+|shopping list)\s*:?$/i;
  const methodHeader = /^(method|directions?|instructions?|preparation|prep|steps?|procedure|to make|how to make( it)?|cooking|making|mode|recipe)\s*:?$/i;
  const notesHeader = /^(notes?|tips?|variations?|serving suggestions?|to serve)\s*:?$/i;
  const servesRe = /^(?:(?:serves|servings?|makes|yield)\s*:?\s*|for\s+(?=\d+\s*(?:-\s*\d+\s*)?(?:people|persons|pax|servings)))(\d+(?:[.,]\d+)?)/i;
  const prepRe = /^prep(?:aration)?(?:\s+time\s*:?|\s*:)\s*(.+)/i;
  const cookRe = /^(?:cook(?:ing)?|bak(?:e|ing)|total)\s+time\s*:?\s*(.+)/i;
  const authorRe = /^(?:from|by|recipe from|courtesy of)\s+(.{2,40})$/i;
  const possessiveTitleRe = /^([A-Z][\p{L} ]{1,25})['’]s\s+.+/u;
  const stepMarker = /^\s*(?:step\s*)?(\d{1,2})\s*[.):-]\s+|^\s*[•\-*·]\s*/i;

  function minutes(s) {
    const t = String(s).toLowerCase();
    let total = 0, found = false, m;
    const h = /(\d+(?:[.,]\d+)?)\s*(h|hr|hrs|hour|hours)\b/g;
    while ((m = h.exec(t))) { total += parseFloat(m[1].replace(",", ".")) * 60; found = true; }
    const mi = /(\d+)\s*(m|min|mins|minute|minutes)\b/g;
    while ((m = mi.exec(t))) { total += +m[1]; found = true; }
    if (!found && (m = t.match(/^\s*(\d{1,3})\s*$/))) { total = +m[1]; found = true; }
    return found && total > 0 ? Math.round(total) : null;
  }

  const isHeader = (t) => ingredientsHeader.test(t) || methodHeader.test(t) || notesHeader.test(t);

  function looksLikeIngredient(t) {
    const words = t.split(" ");
    if (startsWithQuantity(t) && words.length <= 9) return true;
    if (words.length <= 6 && hasUnit(t)) return true;
    if (/to taste/i.test(t) && words.length <= 6) return true;
    return words.length <= 3 && !t.trimEnd().endsWith(".") && !stepMarker.test(t);
  }

  const looksLikeStep = (t) =>
    (/^\s*(?:step\s*)?\d{1,2}\s*[.)]\s+\p{L}/iu.test(t) && t.split(" ").length > 4) || t.split(" ").length >= 8;

  function addStepLine(steps, t, confidence) {
    const m = t.match(stepMarker);
    const text = m ? t.slice(m[0].length).trim() : t;
    if (!text) return;
    const last = steps[steps.length - 1];
    const continues = !m && last &&
      ((!/[.!]$/.test(last.text.trimEnd())) || text[0] === text[0].toLowerCase() && text[0] !== text[0].toUpperCase());
    if (continues) { last.text += " " + text; last.confidence = Math.min(last.confidence, confidence); }
    else steps.push({ text, confidence });
  }

  const meatWords = new Set(["chicken", "beef", "pork", "lamb", "mutton", "goat", "bacon", "ham", "sausage", "turkey",
    "duck", "fish", "tuna", "salmon", "shrimp", "crab", "lobster", "squid", "cuttlefish", "anchovy", "sardine",
    "mince", "gelatin", "prawn", "mackerel", "cod", "beef stock", "chicken stock", "fish sauce", "maldive fish"]);
  const animalWords = new Set(["egg", "milk", "butter", "cream", "cheese", "yogurt", "ghee", "honey", "paneer",
    "curd", "condensed milk", "heavy cream"]);

  function guessDiet(items) {
    if (!items.length) return [];
    const words = new Set(items.flatMap((it) => [...it.split(" "), it]));
    if ([...words].some((w) => meatWords.has(w))) return [];
    return [...words].some((w) => animalWords.has(w)) ? ["vegetarian"] : ["vegetarian", "vegan"];
  }

  function guessMethod(text) {
    const out = [];
    if (/\b(bake|baking|oven|preheat|roast)\b/.test(text)) out.push("oven");
    if (/\b(pressure cooker|whistles?)\b/.test(text)) out.push("pressure cooker");
    if (/\b(fry|fried|saut[eé]|simmer|boil|pan|wok|stir)\b/.test(text)) out.push("stovetop");
    if (/\b(grill|grilled|barbecue|bbq)\b/.test(text)) out.push("grilled");
    return out;
  }

  function guessMeal(title) {
    if (/\b(cake|cookies?|biscuits?|pudding|dessert|pie|tart|brownies?|halwa|payasam|kheer|fudge|toffee|ice cream|muffins?)\b/.test(title)) return ["dessert"];
    if (/\b(juice|smoothie|tea|coffee|lassi|punch|cordial|drink)\b/.test(title)) return ["drink"];
    if (/\b(pancakes?|porridge|omelett?e|granola|hoppers?)\b/.test(title)) return ["breakfast"];
    if (/\b(chutney|sambol|sambal|pickle|sauce|dip|salad|raita)\b/.test(title)) return ["side"];
    if (/\b(curry|stew|biryani|roast|casserole|pasta|fried rice)\b/.test(title)) return ["dinner"];
    return [];
  }

  /** lines: [{text, confidence, height}] in reading order (OCR or pasted text). */
  function parseRecipe(lines) {
    const clean = lines
      .map((l) => ({ text: String(l.text).trim().replace(/\s+/g, " "), confidence: l.confidence ?? 1, height: l.height || 0 }))
      .filter((l) => l.text && /[\p{L}\p{N}]/u.test(l.text));
    const empty = { isRecipe: false, title: "Untitled recipe", author: "", servings: "", prepMinutes: "", cookMinutes: "",
      notes: "", cuisine: "", meal: "", diet: "", method: "", illegible: [], ingredients: [], steps: [] };
    if (!clean.length) return empty;

    let servings = "", prep = "", cook = "", author = "";
    const body = [];
    clean.forEach((l, i) => {
      const t = l.text;
      let m;
      if ((m = t.match(servesRe)) && t.split(" ").length <= 6) servings = m[1].replace(",", ".");
      else if ((m = t.match(prepRe)) && minutes(m[1]) != null) prep = String(minutes(m[1]));
      else if ((m = t.match(cookRe)) && minutes(m[1]) != null) cook = String(minutes(m[1]));
      else if (i < 5 && (m = t.match(authorRe))) author = m[1].trim();
      else body.push(l);
    });

    let headIdx = body.findIndex((l) => isHeader(l.text) || startsWithQuantity(l.text) || hasUnit(l.text));
    headIdx = headIdx < 0 ? Math.min(body.length, 3) : Math.min(headIdx, 3);
    let titleLine = null;
    for (const l of body.slice(0, headIdx)) if (!titleLine || l.height > titleLine.height) titleLine = l;
    if (!titleLine && body[0] && !isHeader(body[0].text)) titleLine = body[0];
    const title = titleLine ? titleLine.text.replace(/[:.]+$/, "") : "";
    if (!author) { const pm = title.match(possessiveTitleRe); if (pm) author = pm[1].trim(); }

    const ingredients = [], steps = [], notes = [];
    let section = "none";
    for (const l of body) {
      if (l === titleLine) continue;
      const t = l.text;
      if (ingredientsHeader.test(t)) { section = "ing"; continue; }
      if (methodHeader.test(t)) { section = "method"; continue; }
      if (notesHeader.test(t)) { section = "notes"; continue; }
      let kind = section;
      if (section === "ing") kind = looksLikeStep(t) && !looksLikeIngredient(t) ? "method" : "ing";
      if (section === "none") kind = looksLikeIngredient(t) ? "ing" : "method";
      if (kind === "ing") ingredients.push(parseIngredient(t, l.confidence));
      else if (kind === "notes") notes.push(t);
      else addStepLine(steps, t, l.confidence);
    }

    const allText = clean.map((l) => l.text).join(" ").toLowerCase();
    const avg = clean.reduce((a, l) => a + l.confidence, 0) / clean.length;
    const illegible = [];
    if (avg < 0.6) illegible.push("Much of this page was hard to read. Compare every line with the photo.");
    if (!ingredients.length) illegible.push("No ingredient list was found. Add the ingredients by hand.");
    if (!steps.length) illegible.push("No method was found. Add the steps by hand.");
    return {
      isRecipe: ingredients.length > 0 || steps.length > 0,
      title: title || "Untitled recipe", author, servings, prepMinutes: prep, cookMinutes: cook,
      notes: notes.join("\n"), cuisine: "",
      meal: guessMeal(title.toLowerCase()).join(", "),
      diet: guessDiet(ingredients.map((i) => i.item)).join(", "),
      method: guessMethod(allText).join(", "),
      illegible, ingredients, steps,
    };
  }

  // ------------------------------------------------------------------ collection files (.json)

  function isCollection(obj) { return obj && obj.format === "recipebox-collection" && Array.isArray(obj.recipes); }

  /** Collection (as made on the PC or exported by either app) -> drafts with their source as author. */
  function parseCollection(obj) {
    if (!isCollection(obj)) throw new Error("This isn't a Recipe Box collection file");
    return obj.recipes.filter((r) => r && String(r.title || "").trim()).map((r) => {
      const ingredients = (r.ingredients || []).map((x) =>
        typeof x === "string" ? parseIngredient(x) : { ...parseIngredient(x.raw || x.item || ""), ...x });
      const steps = (r.steps || []).map((x) => (typeof x === "string" ? { text: x, confidence: 1 } : x));
      const list = (v) => (Array.isArray(v) ? v.join(", ") : v || "");
      const allText = [r.title, ...steps.map((s) => s.text)].join(" ").toLowerCase();
      const num = (v) => (v == null || v === "" ? "" : String(+v % 1 === 0 ? Math.round(+v) : +v));
      return {
        isRecipe: true, title: String(r.title).trim(),
        author: r.author || r.source || "",
        servings: num(r.servings), prepMinutes: num(r.prep_minutes ?? r.prepMinutes),
        cookMinutes: num(r.cook_minutes ?? r.cookMinutes), notes: r.notes || "",
        cuisine: list(r.cuisine), meal: list(r.meal),
        diet: r.diet ? list(r.diet) : guessDiet(ingredients.map((i) => i.item)).join(", "),
        method: r.method ? list(r.method) : guessMethod(allText).join(", "),
        illegible: [], ingredients, steps,
      };
    });
  }

  /** Best-effort text from an old binary Word .doc (bytes: Uint8Array). */
  function docText(bytes) {
    function runs(chars) {
      const out = []; let cur = "";
      const flush = () => { const s = cur.trim(); if (s.length >= 4 && [...s].filter((c) => /\p{L}/u.test(c)).length >= s.length / 3) out.push(s); cur = ""; };
      for (const c of chars) {
        if (c === "\r" || c === "\u000b" || c === "\n") flush();
        else if (c === "\t" || (c >= " " && c !== "\u007f" && !/[\u0000-\u001f\u0080-\u009f]/.test(c) && c.charCodeAt(0) < 0xfff0)) cur += c;
        else flush();
      }
      flush();
      return out;
    }
    const u16 = [], l1 = [];
    for (let i = 0; i + 1 < bytes.length; i += 2) u16.push(String.fromCharCode(bytes[i] | (bytes[i + 1] << 8)));
    for (const b of bytes) l1.push(b >= 0x80 && b <= 0x9f ? " " : String.fromCharCode(b));
    const a = runs(u16), b = runs(l1);
    const len = (x) => x.reduce((n, s) => n + s.length, 0);
    return (len(a) >= len(b) ? a : b)
      .filter((s) => !s.startsWith("Microsoft") && !s.includes("Normal.dot") && !/^[A-Z_\d ]+$/.test(s)).join("\n");
  }

  // Consistent Title Case for recipe titles: "CHICKEN DRY DISH" / "rogan josh" -> "Chicken Dry Dish" / "Rogan Josh".
  // Small joining words stay lowercase except at the start ("Rice with Peas").
  const SMALL_WORDS = new Set(["a", "an", "and", "or", "of", "the", "in", "on", "with", "for", "to", "n", "at", "by"]);
  function titleCase(t) {
    return String(t || "").trim().replace(/\s+/g, " ").split(" ").map((w, i) =>
      w.split(/([-\/])/).map((p, j) => {
        const lower = p.toLowerCase();
        if ((i > 0 || j > 0) && SMALL_WORDS.has(lower)) return lower;
        return lower.replace(/\p{L}/u, (c) => c.toUpperCase());
      }).join("")).join(" ");
  }

  const api = {
    canonical, isStaple, haveMatches, rank, parseIngredient, startsWithQuantity, hasUnit,
    parseRecipe, minutes, looksLikeIngredient, guessDiet, guessMethod, isCollection, parseCollection, docText, titleCase,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.RB = Object.assign(root.RB || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this);
