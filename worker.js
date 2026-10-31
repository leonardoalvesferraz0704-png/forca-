/* =====================================================================
   FORCA NEON — Servidor multiplayer (Cloudflare Workers + Durable Objects)
   Cada sala é um Durable Object: guarda a palavra, as letras e os
   jogadores. A palavra secreta nunca é enviada aos clientes até o fim.
   Modo: cooperativo/competitivo — todos chutam no mesmo tabuleiro,
   erros são compartilhados e quem pontua mais vence a rodada.
   ===================================================================== */
import { BANCO } from "./words.js";

const MAX_JOGADORES = 8;
const MAX_ERROS = 6;
const normalizar = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();

/* Entrada: só aceita WebSocket em /ws/CODIGO (4 letras ou números) */
export default {
  async fetch(req, env) {
    const m = new URL(req.url).pathname.match(/^\/ws\/([A-Z0-9]{4})$/);
    if (!m) return new Response("Não encontrado", { status: 404 });
    if (req.headers.get("Upgrade") !== "websocket") return new Response("Esperado WebSocket", { status: 426 });
    /* O mesmo código sempre leva ao mesmo Durable Object */
    return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
  }
};

export class Room {
  constructor() {
    this.jogadores = new Map(); // WebSocket -> { id, nome, score, host }
    this.proximoId = 1;
    this.status = "lobby";      // lobby | playing | won | lost
    this.cat = "tecnologia";
    this.ronda = null;
    this.usadas = new Set();
    this.msg = "Aguardando o anfitrião iniciar a rodada.";
  }

  async fetch(req) {
    if (this.jogadores.size >= MAX_JOGADORES) return new Response("Sala cheia", { status: 403 });
    const nome = (new URL(req.url).searchParams.get("nome") || "Jogador")
      .replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 16) || "Jogador";
    const [cliente, servidor] = Object.values(new WebSocketPair());
    servidor.accept();
    const p = { id: this.proximoId++, nome, score: 0, host: this.jogadores.size === 0 };
    this.jogadores.set(servidor, p);
    this.msg = nome + " entrou na sala.";

    servidor.addEventListener("message", (ev) => {
      let d; try { d = JSON.parse(ev.data); } catch { return; }
      if (d.t === "start" && p.host) this.iniciar(d.cat);
      else if (d.t === "guess") this.chutar(p, String(d.l || "").toUpperCase());
      else if (d.t === "hint") this.dica(p);
      this.transmitir();
    });
    const sair = () => this.sair(servidor);
    servidor.addEventListener("close", sair);
    servidor.addEventListener("error", sair);
    this.transmitir();
    return new Response(null, { status: 101, webSocket: cliente });
  }

  sair(ws) {
    const p = this.jogadores.get(ws); if (!p) return;
    this.jogadores.delete(ws);
    /* Se o anfitrião saiu, o jogador mais antigo assume */
    if (p.host && this.jogadores.size) [...this.jogadores.values()][0].host = true;
    this.msg = p.nome + " saiu da sala.";
    this.transmitir();
  }

  /* Sorteia uma palavra ainda não usada na sala */
  iniciar(cat) {
    this.cat = BANCO[cat] ? cat : this.cat;
    const itens = BANCO[this.cat].itens;
    let livres = itens.map((_, i) => i).filter((i) => !this.usadas.has(this.cat + i));
    if (!livres.length) { itens.forEach((_, i) => this.usadas.delete(this.cat + i)); livres = itens.map((_, i) => i); }
    const i = livres[Math.floor(Math.random() * livres.length)];
    this.usadas.add(this.cat + i);
    const [palavra, dica] = itens[i].split("|");
    this.ronda = { palavra, dica, norm: normalizar(palavra), certas: new Set(), erradas: new Set(), dicaUsada: false };
    this.status = "playing";
    this.msg = "Rodada iniciada! Todos podem chutar letras.";
  }

  chutar(p, l) {
    const r = this.ronda;
    if (this.status !== "playing" || !/^[A-Z]$/.test(l) || r.certas.has(l) || r.erradas.has(l)) return;
    if (r.norm.includes(l)) {
      r.certas.add(l);
      const n = [...r.norm].filter((c) => c === l).length;
      p.score += 10 * n;
      this.msg = p.nome + " acertou " + l + " (+" + 10 * n + ").";
      if ([...r.norm].every((c) => !/[A-Z]/.test(c) || r.certas.has(c))) {
        p.score += 50; this.status = "won";
        this.msg = p.nome + " completou a palavra e ganhou +50!";
      }
    } else {
      r.erradas.add(l);
      p.score = Math.max(0, p.score - 5);
      this.msg = p.nome + " errou " + l + " (-5).";
      if (r.erradas.size >= MAX_ERROS) { this.status = "lost"; this.msg = "A forca foi completada. Ninguém ganha o bônus."; }
    }
  }

  dica(p) {
    const r = this.ronda;
    if (this.status !== "playing" || r.dicaUsada) return;
    r.dicaUsada = true; p.score = Math.max(0, p.score - 20);
    this.msg = p.nome + " pediu a dica (-20).";
  }

  /* Envia o estado a cada jogador. A palavra só aparece completa no fim */
  transmitir() {
    const r = this.ronda, fim = this.status === "won" || this.status === "lost";
    const mostrada = r ? [...r.palavra].map((ch, i) =>
      fim || !/[A-Z]/.test(r.norm[i]) || r.certas.has(r.norm[i]) ? ch : "_").join("") : "";
    const jogadores = [...this.jogadores.values()].map(({ id, nome, score, host }) => ({ id, nome, score, host }));
    for (const [ws, p] of this.jogadores) {
      try {
        ws.send(JSON.stringify({
          t: "state", status: this.status, cat: BANCO[this.cat].nome, shown: mostrada, max: MAX_ERROS,
          certas: r ? [...r.certas] : [], erradas: r ? [...r.erradas] : [],
          hint: r && r.dicaUsada ? r.dica : null, players: jogadores, me: p.id, msg: this.msg
        }));
      } catch { /* conexão já fechada */ }
    }
  }
}
