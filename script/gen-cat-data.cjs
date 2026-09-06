#!/usr/bin/env node
// Generates contracts/CatData.sol from the canonical art tables + traits.config.json.
// Re-run after any art or schema change: node script/gen-cat-data.js

const fs = require("fs");
const path = require("path");
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "traits.config.json"), "utf8"));

// ── base cat grid (Style A "Punk Bust": solid fur, pointed ears, classic whiskers, round eyes) ──
const GRID = [
"........................",
"......o.........o.......",
".....ofo.......ofo......",
".....ofio.....oifo......",
".....ofiio...oiifo......",
".....offfooooofffo......",
"....offffffffffffffo....",
"....offffffffffffffo....",
"....offffffffffffffo....",
"....offffffffffffffo....",
"....ofpeffffffpefffo....",
"....offffffffffffffo....",
"..wwoffffffffffffffoww..",
"....offfffnnfffffffo....",
"..wwofffffmffffffffoww..",
".....offffffffffffo.....",
"......offffffffffo......",
".........offffo.........",
".........offffo.........",
".......offffffffo.......",
".....offffffffffffo.....",
"....offffffffffffffo....",
"....offffffffffffffo....",
"....offffffffffffffo....",
];

// ── the unopened box (superposition state) ──
const BOX = [
"........................",
"........................",
"........................",
"....oooooooooooooooo....",
"...oBBBBBBBBTTBBBBBBo...",
"...oBBBBBBBBTTBBBBBBo...",
"...oooooooooooooooooo...",
"...oFFFFFFFFTTFFFFFFo...",
"...oFFFFFFFFTTFFFFFFo...",
"...oFFFFQQQQQQFFFFFFo...",
"...oFFFQQFFFFQQFFFFFo...",
"...oFFFFFFFFFQQFFFFFo...",
"...oFFFFFFFFQQFFFFFFo...",
"...oFFFFFFFQQFFFFFFFo...",
"...oFFFFFFFFFFFFFFFFo...",
"...oFFFFFFFQQFFFFFFFo...",
"...oFFFFFFFQQFFFFFFFo...",
"...oFFFFFFFFFFFFFFFFo...",
"...oooooooooooooooooo...",
"........................",
"........................",
"........................",
"........................",
"........................",
];

const M = c => 22 - c;
function mirror(list) {
  const out = [];
  for (const [y, x, ch] of list) out.push([y, x, ch], [y, M(x), ch]);
  return out;
}
const run = (row, c0, c1, ch) => { const p = []; for (let c = c0; c <= c1; c++) p.push([row, c, ch]); return p; };

// overlays (identical to the approved mockups)
const OVER = {
  EAR_ROUNDED: mirror([[2,5,"o"],[2,6,"f"],[2,7,"f"],[2,8,"o"],[3,5,"o"],[3,6,"f"],[3,7,"i"],[3,8,"o"],
                       [4,5,"o"],[4,6,"f"],[4,7,"i"],[4,8,"i"],[4,9,"o"]]),
  EAR_FOLDED:  mirror([[3,5,"o"],[3,6,"o"],[3,7,"o"],[3,8,"o"],
                       [4,5,"o"],[4,6,"f"],[4,7,"i"],[4,8,"o"],[4,9,"o"]]),
  WHISK_CLASSIC: [[12,2,"w"],[12,3,"w"],[12,20,"w"],[12,21,"w"],[14,2,"w"],[14,3,"w"],[14,20,"w"],[14,21,"w"]],
  WHISK_LONG: [[12,0,"w"],[12,1,"w"],[12,2,"w"],[12,3,"w"],[12,20,"w"],[12,21,"w"],[12,22,"w"],[12,23,"w"],
               [14,0,"w"],[14,1,"w"],[14,2,"w"],[14,3,"w"],[14,20,"w"],[14,21,"w"],[14,22,"w"],[14,23,"w"]],
  EYE_ROUND: [[10,6,"p"],[10,7,"e"],[10,14,"p"],[10,15,"e"]],
  EYE_WIDE:  [[10,6,"p"],[10,7,"e"],[11,6,"e"],[11,7,"e"],[10,14,"p"],[10,15,"e"],[11,14,"e"],[11,15,"e"]],
  EYE_SLIT:  [[10,6,"e"],[10,7,"p"],[11,6,"e"],[11,7,"p"],[10,14,"p"],[10,15,"e"],[11,14,"p"],[11,15,"e"]],
  // hetero: recolour the right iris pixels of each shape
  EYEH_ROUND: [[10,15,"E"]],
  EYEH_WIDE:  [[10,15,"E"],[11,14,"E"],[11,15,"E"]],
  EYEH_SLIT:  [[10,15,"E"],[11,15,"E"]],
  PAT_TUXEDO: [[13,8,"l"],[13,9,"l"],[13,12,"l"],[13,13,"l"],
               [14,8,"l"],[14,9,"l"],[14,11,"l"],[14,12,"l"],[14,13,"l"],
               ...run(15,8,13,"l"), ...run(19,10,13,"l"),
               ...[20,21,22,23].flatMap(y => run(y,9,14,"l"))],
  PAT_PATCH: [[9,13,"d"],[9,14,"d"],[9,15,"d"],[9,16,"d"],[10,13,"d"],[10,16,"d"],
              [11,13,"d"],[11,14,"d"],[11,15,"d"],[11,16,"d"],
              [20,6,"d"],[20,7,"d"],[21,6,"d"],[21,7,"d"],[21,8,"d"],[22,7,"d"]],
  PAT_TIGER: [...[7,8,9].flatMap(y => [[y,9,"d"],[y,11,"d"],[y,13,"d"]]),
              [11,5,"d"],[11,6,"d"],[12,5,"d"],[11,17,"d"],[11,16,"d"],[12,17,"d"],
              ...[6,17].flatMap(c => [[21,c,"d"],[22,c,"d"],[23,c,"d"]]),
              ...[9,14].flatMap(c => [[19,c,"d"],[20,c,"d"],[21,c,"d"],[22,c,"d"],[23,c,"d"]]),
              ...[11,12].flatMap(c => [[20,c,"d"],[21,c,"d"],[22,c,"d"],[23,c,"d"]])],
  PAT_CALICO: [...[6,7,8].flatMap(y => run(y,7,10,"D")),
               [11,14,"d"],[11,15,"d"],[11,16,"d"],[12,14,"d"],[12,15,"d"],[12,16,"d"],[13,15,"d"],[13,16,"d"],
               [20,6,"D"],[20,7,"D"],[21,6,"D"],[21,7,"D"],[21,8,"D"],[22,6,"D"],[22,7,"D"]],
  ACC_HAT: [...run(3,9,13,"h"), ...run(4,7,16,"h"), ...run(5,6,17,"H")],
  ACC_CIG: [...run(15,13,18,"c"), [15,19,"g"], [13,20,"s"], [12,21,"s"], [10,21,"s"]],
  ACC_CROSS: [...run(19,8,15,"C"), [20,11,"C"], [21,10,"C"], [21,11,"C"], [21,12,"C"], [22,11,"C"]],
  ACC_SCARF: [...run(17,8,15,"r"), ...run(18,8,15,"R"),
              [19,12,"r"],[19,13,"r"],[20,12,"r"],[20,13,"r"],[21,12,"R"],[21,13,"R"]],
};

// ── option enum orders (index = value stored in Solidity) ──
const ENUMS = {
  earShape: ["pointed","rounded","folded"],
  earInner: ["pink","lavender","charcoal"],
  whiskerStyle: ["classic","none","long"],
  whiskerColor: ["dark","white"],
  eyeShape: ["round","wide","slit"],
  eyeColor: ["green","blue","amber","copper","violet","hetero"],
  fur: ["gray","orange","black","cream","chocolate","sphynx"],
  pattern: ["solid","tuxedo","patch","tiger","calico"],
  accessory: ["none","beanieBlue","beanieRed","beaniePurple","cig","cross","scarf"],
  bg: ["sky","purple","sand","green","rose","dusk"],
};
const DISPLAY = {
  pointed:"Pointed", rounded:"Rounded", folded:"Folded",
  pink:"Pink", lavender:"Lavender", charcoal:"Charcoal",
  classic:"Classic", none:"None", long:"Long",
  dark:"Dark", white:"White",
  round:"Round", wide:"Wide", slit:"Slit",
  green:"Green", blue:"Blue", amber:"Amber", copper:"Copper", violet:"Violet", hetero:"Heterochromia",
  gray:"Gray", orange:"Orange", black:"Black", cream:"Cream", chocolate:"Chocolate", sphynx:"Sphynx",
  solid:"Solid", tuxedo:"Tuxedo", patch:"Patch", tiger:"Tiger", calico:"Calico",
  beanieBlue:"Beanie Blue", beanieRed:"Beanie Red", beaniePurple:"Beanie Purple",
  cig:"Cigarette", cross:"Cross Necklace", scarf:"Scarf",
  sky:"Sky", purple:"Purple", sand:"Sand", rose:"Rose", dusk:"Dusk",
};

// value -> enum index tables from config
const field = n => cfg.fields.find(f => f.name === n);
const mapTable = n => field(n).map.map(o => ENUMS[n].indexOf(o));

// ── palettes (RGB triplets) ──
const rgb = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
const FURS = { // f, d, l, i, n
  gray:      ["#8a8a92","#5c5c64","#c9c9cf","#f2a7b8","#e88aa0"],
  orange:    ["#d98a3d","#a05a24","#f2d3a7","#f2b8c6","#d97086"],
  black:     ["#33333c","#41414a","#4d4d58","#c96f86","#c96f86"],
  cream:     ["#efe6d8","#cbbfa9","#fbf7ef","#f2a7b8","#e88aa0"],
  chocolate: ["#6b4a33","#4f3524","#8a6a4f","#e8a0a8","#c98a8a"],
  sphynx:    ["#d9a79a","#b57f70","#edc9bf","#c96f86","#a85560"],
};
const EYES = { green:"#7fd069", blue:"#5fb0ff", amber:"#ffd23f", copper:"#ff8c3b", violet:"#b98aff", hetero:"#7fd069" };
// [base, fringe] — fringe = base lightened 16% (interference band shade)
const BGS = { sky:["#7ba3c2","#90b1cb"], purple:["#7a6a8f","#8f81a0"], sand:["#bfa87e","#c9b592"],
              green:["#5f8f7a","#78a08f"], rose:["#96637a","#a67b8f"], dusk:["#3f3550","#5d556c"] };
const HATS = { beanieBlue:["#3b6ea5","#274b73"], beanieRed:["#a53b3b","#732727"], beaniePurple:["#7a5aa5","#54407a"] };
const INNER = { lavender:"#b8a7f2", charcoal:"#3a3a44" };
const FIXED = { o:"#14141a", p:"#14141a", m:"#14141a", x:"#101218", W:"#e8f6ff", k:"#e9e5da", K:"#b3ac9c",
                c:"#e8e8e8", g:"#ff8c3b", s:"#9aa3ad", D:"#d98a3d", C:"#d9b23d", r:"#a53b3b", R:"#7e2c2c" };
const WHISK = { dark:"#14141a", white:"#e8e8e8" };
const BOXPAL = { o:"#14141a", B:"#c9a06a", F:"#b58a52", T:"#d9c9a3", Q:"#5c3f28" };
const BOXBG = ["#262233","#2d2940"];

// ── emit ──
const hexBytes = arr => arr.map(b => b.toString(16).padStart(2,"0")).join("");
const pxHex = list => hexBytes(list.flatMap(([y,x,ch]) => [y, x, ch.charCodeAt(0)]));
const palHex = hexes => hexBytes(hexes.flatMap(h => rgb(h)));

// sanity
const total = cfg.fields.reduce((s,f) => s + f.bits, 0) + cfg.schrodinger.qubits + cfg.interference.qubits;
if (total !== cfg.totalBits) throw new Error("bit budget mismatch: " + total);
if (GRID.length !== 24 || GRID.some(r => r.length !== 24)) throw new Error("GRID must be 24x24");
if (BOX.length !== 24 || BOX.some(r => r.length !== 24)) throw new Error("BOX must be 24x24");

function nameFn(fname, opts) {
  const lines = opts.map((o, i) =>
    `        if (v == ${i}) return "${DISPLAY[o]}";`).join("\n");
  return `    function ${fname}(uint256 v) internal pure returns (string memory) {\n${lines}\n        return "?";\n    }`;
}

const sol = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Generated by script/gen-cat-data.js — DO NOT EDIT BY HAND.
/// Art tables, value->trait maps, palettes and names for the Quantum Cats renderer.
/// DNA layout (MSB-first, 38 bits):
///   earShape[2] earInner[2] whiskerStyle[2] whiskerColor[1] eyeShape[2]
///   eyeColor[3] fur[4] pattern[3] accessory[3] bg[3] schrodinger[5] interference[8]
library CatData {
    // 24x24 base cat, row-major chars
    bytes internal constant GRID =
        "${GRID.join("")}";

    // 24x24 superposition box
    bytes internal constant BOX =
        "${BOX.join("")}";

    // pixel overlays: packed (y, x, charCode) triplets
${Object.entries(OVER).map(([k, v]) => `    bytes internal constant ${k} = hex"${pxHex(v)}";`).join("\n")}

    // raw field value -> option index
    bytes internal constant MAP_EARSHAPE = hex"${hexBytes(mapTable("earShape"))}";
    bytes internal constant MAP_EARINNER = hex"${hexBytes(mapTable("earInner"))}";
    bytes internal constant MAP_WHISKSTYLE = hex"${hexBytes(mapTable("whiskerStyle"))}";
    bytes internal constant MAP_EYESHAPE = hex"${hexBytes(mapTable("eyeShape"))}";
    bytes internal constant MAP_EYECOLOR = hex"${hexBytes(mapTable("eyeColor"))}";
    bytes internal constant MAP_FUR = hex"${hexBytes(mapTable("fur"))}";
    bytes internal constant MAP_PATTERN = hex"${hexBytes(mapTable("pattern"))}";
    bytes internal constant MAP_ACC = hex"${hexBytes(mapTable("accessory"))}";
    bytes internal constant MAP_BG = hex"${hexBytes(mapTable("bg"))}";

    // palettes: packed RGB triplets
    // fur: 6 furs x roles [f,d,l,i,n]
    bytes internal constant FUR_PAL = hex"${palHex(ENUMS.fur.flatMap(f => FURS[f]))}";
    bytes internal constant EYE_PAL = hex"${palHex(ENUMS.eyeColor.map(e => EYES[e]))}";
    // bg: 6 hues x [base, fringe]
    bytes internal constant BG_PAL = hex"${palHex(ENUMS.bg.flatMap(b => BGS[b]))}";
    // beanies: 3 x [main, band]
    bytes internal constant HAT_PAL = hex"${palHex(["beanieBlue","beanieRed","beaniePurple"].flatMap(h => HATS[h]))}";
    bytes internal constant INNER_PAL = hex"${palHex([INNER.lavender, INNER.charcoal])}";
    bytes internal constant WHISK_PAL = hex"${palHex([WHISK.dark, WHISK.white])}";
    // fixed chars in order: o p m x W k K c g s D C r R
    bytes internal constant FIXED_CHARS = "opmxWkKcgsDCrR";
    bytes internal constant FIXED_PAL = hex"${palHex(["o","p","m","x","W","k","K","c","g","s","D","C","r","R"].map(ch => FIXED[ch]))}";
    // box chars in order: o B F T Q, then bg pair
    bytes internal constant BOX_CHARS = "oBFTQ";
    bytes internal constant BOX_PAL = hex"${palHex(["o","B","F","T","Q"].map(ch => BOXPAL[ch]))}";
    bytes internal constant BOX_BG = hex"${palHex(BOXBG)}";

${nameFn("earShapeName", ENUMS.earShape)}

${nameFn("earInnerName", ENUMS.earInner)}

${nameFn("whiskerStyleName", ENUMS.whiskerStyle)}

${nameFn("whiskerColorName", ENUMS.whiskerColor)}

${nameFn("eyeShapeName", ENUMS.eyeShape)}

${nameFn("eyeColorName", ENUMS.eyeColor)}

${nameFn("furName", ENUMS.fur)}

${nameFn("patternName", ENUMS.pattern)}

${nameFn("accessoryName", ENUMS.accessory)}

${nameFn("bgName", ENUMS.bg)}
}
`;

const out = path.join(__dirname, "..", "contracts", "CatData.sol");
fs.writeFileSync(out, sol);
console.log("wrote", out, `(${sol.length} bytes)`);
