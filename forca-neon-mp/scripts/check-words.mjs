// Conta as palavras por categoria e aponta duplicadas ou mal formatadas.
import { BANCO } from "../src/words.js";
const norm = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const vistas = new Set(); let total = 0, erros = 0;
for (const [cat, { nome, itens }] of Object.entries(BANCO)) {
  console.log(nome.padEnd(24), itens.length);
  for (const it of itens) {
    const [p, d] = it.split("|"); total++;
    if (!p || !d) { console.log("  formato inválido:", it); erros++; continue; }
    if (vistas.has(norm(p))) { console.log("  duplicada:", p); erros++; }
    vistas.add(norm(p));
  }
}
console.log("\nTotal:", total, "| meta: 1000 | problemas:", erros);
