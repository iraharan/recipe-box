// Same cases as the Android unit tests. Run: node --test web/test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const RB = require("../parser.js");

test("canonical names", () => {
  assert.equal(RB.canonical("Tomatoes"), "tomato");
  assert.equal(RB.canonical("Brinjals"), "eggplant");
  assert.equal(RB.canonical("coriander leaves"), "coriander leaf");
  assert.equal(RB.canonical("Cilantro"), "coriander leaf");
  assert.equal(RB.canonical("curd"), "yogurt");
  assert.equal(RB.canonical("garbanzo beans"), "chickpea");
  assert.equal(RB.canonical("green chillies"), "green chili");
});

test("ranking ignores staples and optional", () => {
  const items = [
    { recipeId: 1, item: "chicken" }, { recipeId: 1, item: "rice" }, { recipeId: 1, item: "salt" }, { recipeId: 1, item: "cream" },
    { recipeId: 2, item: "chicken" }, { recipeId: 2, item: "yogurt" }, { recipeId: 2, item: "mint", optional: true },
    { recipeId: 3, item: "flour" }, { recipeId: 3, item: "butter" },
  ];
  const r = RB.rank(items, ["chicken", "rice", "curd"]);
  assert.deepEqual(r.map((x) => x.recipeId), [2, 1]);
  assert.deepEqual(r[1].missing, ["cream"]);
  assert.deepEqual(RB.rank(items, ["chicken", "rice", "curd"], 0).map((x) => x.recipeId), [2]);
});

test("ingredient lines", () => {
  let i = RB.parseIngredient("1 1/2 cups plain flour, sifted");
  assert.equal(i.qty, 1.5); assert.equal(i.unit, "cup"); assert.equal(i.item, "all-purpose flour"); assert.equal(i.prep, "sifted");
  i = RB.parseIngredient("200g sugar"); assert.equal(i.qty, 200); assert.equal(i.unit, "g"); assert.equal(i.item, "sugar");
  assert.equal(RB.parseIngredient("2 T butter").unit, "tbsp");
  assert.equal(RB.parseIngredient("2 t salt").unit, "tsp");
  i = RB.parseIngredient("a pinch of salt"); assert.equal(i.qty, 1); assert.equal(i.unit, "pinch"); assert.equal(i.item, "salt");
  i = RB.parseIngredient("2-3 green chillies (optional)"); assert.equal(i.qty, 2); assert.ok(i.optional); assert.equal(i.item, "green chili");
  assert.equal(RB.parseIngredient("1/2 tea spn fenugreek seeds").item, "fenugreek seed");
});

test("recipe card with headers", () => {
  const lines = [{ text: "Amma's Chicken Curry", height: 60 }, ...[
    "Serves 4", "Prep time: 20 min", "Cooking time 1 hr 15 mins", "Ingredients",
    "1 kg chicken, cut into pieces", "2 large onions, sliced", "4 cloves garlic", "1 1/2 tsp chilli powder",
    "Salt to taste", "Curry leaves", "Method", "1. Heat oil in a pan and fry the onions", "until golden.",
    "2. Add garlic and curry leaves.", "3. Add chicken and simmer for 40 minutes.",
  ].map((text) => ({ text, height: 30 }))];
  const d = RB.parseRecipe(lines);
  assert.equal(d.title, "Amma's Chicken Curry");
  assert.equal(d.author, "Amma");
  assert.equal(d.servings, "4"); assert.equal(d.prepMinutes, "20"); assert.equal(d.cookMinutes, "75");
  assert.deepEqual(d.ingredients.map((i) => i.item), ["chicken", "onion", "garlic", "chili powder", "salt", "curry leaf"]);
  assert.equal(d.steps.length, 3);
  assert.equal(d.steps[0].text, "Heat oil in a pan and fry the onions until golden.");
});

test("your collections parse", () => {
  for (const f of ["recipes.json", "recipes2.json"]) {
    const p = path.join(__dirname, "../../import", f);
    if (!fs.existsSync(p)) continue;
    const drafts = RB.parseCollection(JSON.parse(fs.readFileSync(p, "utf8")));
    assert.ok(drafts.length > 200, f);
    assert.ok(drafts.every((d) => d.title && (d.ingredients.length || d.steps.length)));
  }
});

test("title case", () => {
  assert.equal(RB.titleCase("CHICKEN DRY DISH"), "Chicken Dry Dish");
  assert.equal(RB.titleCase("rogan josh"), "Rogan Josh");
  assert.equal(RB.titleCase("Urad-moong dal dosa"), "Urad-Moong Dal Dosa");
  assert.equal(RB.titleCase("RICE WITH PEAS AND  CARROT"), "Rice with Peas and Carrot");
  assert.equal(RB.titleCase("Aayi's  sweet (2)"), "Aayi's Sweet (2)");
});
