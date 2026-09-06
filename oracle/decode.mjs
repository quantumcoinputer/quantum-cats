// Trait decoding from a 38-bit DNA bitstring — mirrors CatRenderer.decode.
// Layout: 25 trait bits + 5 schrodinger bits + 8 interference bits, MSB-first.
// Used only for logging and the verifier; the chain decodes independently.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const here = path.dirname(fileURLToPath(import.meta.url));
export const CONFIG = JSON.parse(readFileSync(path.join(here, "..", "traits.config.json"), "utf8"));

export function bitstringToDna(bits) {
  if (!/^[01]+$/.test(bits) || bits.length !== CONFIG.totalBits) {
    throw new Error(`bad bitstring: ${bits}`);
  }
  return BigInt("0b" + bits);
}

export function decode(bits) {
  const out = {};
  let off = 0;
  for (const f of CONFIG.fields) {
    const v = parseInt(bits.slice(off, off + f.bits), 2);
    out[f.name] = f.map[v];
    off += f.bits;
  }
  const nSchrod = CONFIG.schrodinger.qubits;
  out.schrodinger = bits.slice(off, off + nSchrod) === "1".repeat(nSchrod);
  off += nSchrod;
  out.interference = bits.slice(off); // 8-bit fringe pattern
  return out;
}
