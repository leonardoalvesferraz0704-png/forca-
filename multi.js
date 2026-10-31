"use strict";
/* =====================================================================
   FORCA NEON — Cliente multiplayer
   Reaproveita as funções globais do jogo solo (tentar, desenhar, SOM...)
   e troca o "cérebro" local pelo servidor, via WebSocket.
   ===================================================================== */
(() => {
  const ALFA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let ws = null, sala = null, souHost = false;
  let antShown = "", antErr = 0, antAcc = 0, antStatus = "lobby";
  const original = { tentar, novaPartida };
  const enviar = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

  /* --- Estilos e elementos extras (injetados para manter o HTML enxuto) --- */
  const css = document.createElement("style");
  css.textContent = `
  .players{display:flex;flex-wrap:wrap;gap:8px}.players[hidden]{display:none}
  .pl{padding:6px 12px;border-radius:99px;border:1px solid var(--border);background:var(--glass2);font-size:.85rem}
  .pl.me{border-color:var(--cyan);box-shadow:0 0 12px color-mix(in srgb,var(--cyan) 35%,transparent)}
  .pl b{color:var(--cyan);margin-left:8px;font-family:var(--font-display)}
  .in{width:100%;min-height:44px;padding:0 12px;border-radius:12px;border:1px solid var(--border);background:var(--glass2);color:var(--text);font:inherit;text-transform:uppercase}
  .in.nome{text-transform:none}.mrow{display:grid;gap:10px;margin-bottom:12px}`;
  document.head.appendChild(css);

  const barra = document.createElement("div");
  barra.className = "players"; barra.hidden = true;
  $("word").before(barra);

  const btn = document.createElement("button");
  btn.className = "icon-btn"; btn.id = "multiBtn"; btn.title = "Multiplayer"; btn.textContent = "👥";
  btn.setAttribute("aria-label", "Abrir multiplayer");
  $("statsBtn").before(btn);

  const dlg = document.createElement("dialog");
  dlg.id = "dlgMulti";
  dlg.innerHTML = `<h2>Multiplayer</h2>
  <div id="mOff"><div class="mrow">
    <label class="field">Seu nome<input class="in nome" id="mNome" maxlength="16" autocomplete="off"></label>
    <label class="field">Código da sala<input class="in" id="mCod" maxlength="4" placeholder="ABCD" autocomplete="off"></label></div>
    <div class="modal-actions"><button class="btn" id="mEntrar">Entrar na sala</button><button class="btn primary" id="mCriar">Criar sala</button></div></div>
  <div id="mOn" hidden><p>Sala <b id="mSala"></b> · compartilhe o link com seus amigos.</p><p class="shortcuts" id="mLink"></p>
    <div class="modal-actions" style="margin-top:10px"><button class="btn" id="mCopiar">Copiar link</button><button class="btn" id="mSair">Sair da sala</button></div></div>
  <p class="shortcuts" id="mErro" role="alert" style="margin:10px 0"></p>
  <div class="modal-actions"><button class="btn" id="mFechar">Fechar</button></div>`;
  document.body.appendChild(dlg);
  const nomeSalvo = (() => { try { return localStorage.getItem("forcaNeon.nome") || ""; } catch { return ""; } })();
  $("mNome").value = nomeSalvo;

  /* --- Conexão --- */
  function conectar(cod) {
    cod = cod.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (cod.length !== 4) { $("mErro").textContent = "O código precisa ter 4 letras ou números."; return; }
    const nome = $("mNome").value.trim().slice(0, 16) || "Jogador";
    try { localStorage.setItem("forcaNeon.nome", nome); } catch { /* ignora */ }
    $("mErro").textContent = "Conectando…";
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const este = (ws = new WebSocket(proto + "://" + location.host + "/ws/" + cod + "?nome=" + encodeURIComponent(nome)));
    este.onopen = () => entrar(cod);
    este.onmessage = (e) => { try { render(JSON.parse(e.data)); } catch { /* mensagem inválida */ } };
    este.onclose = () => {
      if (ws !== este) return;
      if (sala) { sair(); $("mErro").textContent = "Conexão encerrada."; }
      else { ws = null; $("mErro").textContent = "Não foi possível entrar (sala cheia ou sem conexão)."; }
    };
  }

  function entrar(cod) {
    sala = cod; pararRelogio(); cancelAnimationFrame(animRaf);
    jogo = { fim: "multi", erradas: new Set(), certas: new Set(), max: 6 }; // "fim" truthy bloqueia o modo solo
    barra.hidden = false;
    $("selDiff").disabled = true; $("btnPause").disabled = true; $("timeBar").style.display = "none";
    $("timeLabel").textContent = "Jogadores"; $("streakNow").previousElementSibling.textContent = "Seus pontos";
    $("chipTime").classList.remove("low"); $("pause").classList.remove("on");
    $("word").innerHTML = ""; montarTeclado();
    antShown = ""; antErr = 0; antAcc = 0; antStatus = "lobby";
    history.replaceState(null, "", "?sala=" + cod);
    $("mErro").textContent = ""; atualizarDialogo(); dlg.close();
  }

  function sair() {
    const w = ws; ws = null; sala = null; souHost = false;
    if (w) w.close();
    barra.hidden = true;
    $("selDiff").disabled = false; $("btnPause").disabled = false; $("btnNew").disabled = false;
    $("btnNew").textContent = "Nova partida";
    $("streakNow").previousElementSibling.textContent = "Sequência";
    history.replaceState(null, "", location.pathname);
    jogo = null; atualizarDialogo(); original.novaPartida();
  }

  function atualizarDialogo() {
    $("mOff").hidden = !!sala; $("mOn").hidden = !sala;
    $("mSala").textContent = sala || "";
    $("mLink").textContent = sala ? location.origin + "/?sala=" + sala : "";
  }

  /* --- Renderização do estado vindo do servidor --- */
  function render(s) {
    const eu = s.players.find((p) => p.id === s.me);
    souHost = !!(eu && eu.host);
    jogo = { fim: s.status === "won" ? "vitoria" : s.status === "lost" ? "derrota" : "multi",
             erradas: new Set(s.erradas), certas: new Set(s.certas), max: s.max };
    $("catTag").textContent = s.cat + " · Sala " + sala;
    barra.innerHTML = s.players.map((p) => '<span class="pl' + (p.id === s.me ? " me" : "") + '">' +
      (p.host ? "👑 " : "") + esc(p.nome) + "<b>" + p.score + "</b></span>").join("");

    /* Palavra: "_" = letra oculta */
    const w = $("word"); w.innerHTML = "";
    [...s.shown].forEach((ch, i) => {
      const el = document.createElement("span");
      if (ch === " ") el.className = "gap";
      else if (ch === "_") el.className = "slot";
      else if (!/\p{L}/u.test(ch)) { el.className = "sep"; el.textContent = ch; }
      else {
        el.className = "slot"; el.textContent = ch.toUpperCase();
        if (antShown[i] === "_") el.classList.add(s.status === "lost" ? "fail" : "rev");
      }
      w.appendChild(el);
    });

    /* Teclado compartilhado */
    document.querySelectorAll(".key").forEach((k) => {
      const l = k.dataset.k, ok = s.certas.includes(l), no = s.erradas.includes(l);
      k.classList.toggle("hit", ok); k.classList.toggle("miss", no);
      k.disabled = ok || no || s.status !== "playing";
    });

    $("lives").textContent = s.max - s.erradas.length;
    $("time").textContent = s.players.length + " 👥";
    $("streakNow").textContent = eu ? eu.score : 0;
    const hb = $("hintBox");
    hb.textContent = s.hint ? "💡 " + s.hint : ""; hb.classList.toggle("on", !!s.hint);
    $("btnHint").disabled = !!s.hint || s.status !== "playing";
    $("btnNew").disabled = !souHost;
    $("btnNew").textContent = souHost ? (s.status === "lobby" ? "Iniciar rodada" : "Nova rodada") : "Aguardando anfitrião";
    msg(s.msg);

    /* Desenho e sons: só reage ao que mudou */
    const est = estagioDe(s.erradas.length, s.max);
    if (s.erradas.length > antErr) { SOM.erro(); animarEstagio(est); cv.classList.remove("shake"); void cv.offsetWidth; cv.classList.add("shake"); }
    else desenhar(est);
    if (s.certas.length > antAcc) SOM.acerto();
    if (s.status !== antStatus) {
      if (s.status === "won") { SOM.vitoria(); confete(); }
      if (s.status === "lost") SOM.derrota();
    }
    antErr = s.erradas.length; antAcc = s.certas.length; antStatus = s.status; antShown = s.shown;
  }

  /* --- Ponte com o jogo solo: troca as ações locais por mensagens ao servidor --- */
  window.tentar = (l) => { if (sala) enviar({ t: "guess", l }); else original.tentar(l); };
  window.novaPartida = () => {
    if (!sala) return original.novaPartida();
    if (souHost) enviar({ t: "start", cat: cfg.cat });
    else msg("Só o anfitrião pode iniciar a rodada.");
  };
  $("btnHint").addEventListener("click", () => { if (sala) enviar({ t: "hint" }); }); // o handler solo sai cedo porque jogo.fim é truthy

  /* --- Eventos do diálogo --- */
  btn.addEventListener("click", () => { SOM.clique(); atualizarDialogo(); dlg.showModal(); });
  $("mFechar").addEventListener("click", () => dlg.close());
  $("mCriar").addEventListener("click", () => {
    const b = crypto.getRandomValues(new Uint8Array(4));
    conectar([...b].map((n) => ALFA[n % ALFA.length]).join(""));
  });
  $("mEntrar").addEventListener("click", () => conectar($("mCod").value));
  $("mCod").addEventListener("keydown", (e) => { if (e.key === "Enter") conectar($("mCod").value); });
  $("mSair").addEventListener("click", () => { dlg.close(); sair(); });
  $("mCopiar").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(location.origin + "/?sala=" + sala); $("mErro").textContent = "Link copiado!"; }
    catch { $("mErro").textContent = "Copie o link manualmente."; }
  });

  /* Link de convite: abre o diálogo já com o código preenchido */
  const convite = (new URLSearchParams(location.search).get("sala") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  if (convite.length === 4) { $("mCod").value = convite; atualizarDialogo(); dlg.showModal(); }
})();
