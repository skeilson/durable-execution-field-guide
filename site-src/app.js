/* Durable Execution Field Guide: course app.
   Lessons are pre-rendered into .stash at build time; this script builds the
   navigation, switches views, tracks progress, and runs the interactive widgets. */
(function () {
  "use strict";
  const data = JSON.parse(document.getElementById("course-data").textContent);
  const app = document.getElementById("app");
  const stash = document.getElementById("lesson-stash");

  // ---------- small helpers ----------
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
    return el;
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem("defg:" + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem("defg:" + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
  const done = new Set(store.get("done", []));
  const quizScores = store.get("quiz", {});
  const reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const lessons = [];
  data.modules.forEach((m) => m.lessons.forEach((l) => lessons.push(Object.assign({ module: m }, l))));
  const findLesson = (id) => lessons.find((l) => l.id === id);
  const findModule = (id) => data.modules.find((m) => m.id === id);
  const readyLessonCount = lessons.length;
  const moduleDone = (m) => m.lessons.filter((l) => done.has(l.id)).length;

  // ---------- shell ----------
  const progressFill = h("span");
  const progressText = h("span");
  const rail = h("nav", { class: "rail", "aria-label": "Course outline" });
  const main = h("main", { id: "main" });
  const menuBtn = h("button", { class: "icon-btn menu-btn", "aria-label": "Open course outline", onclick: () => rail.classList.toggle("open") }, "☰ Lessons");

  app.append(
    h("header", { class: "topbar" },
      menuBtn,
      h("a", { class: "brand", href: "#home" }, h("span", { class: "brand-mark" }, "j#"), h("span", { class: "brand-text" }, data.title)),
      h("span", { class: "spacer" }),
      h("span", { class: "progress-chip" }, h("span", { class: "progress-bar" }, progressFill), progressText),
    ),
    h("div", { class: "shell" }, rail, main),
  );

  function updateProgress() {
    const n = lessons.filter((l) => done.has(l.id)).length;
    progressFill.style.width = (readyLessonCount ? (n / readyLessonCount) * 100 : 0) + "%";
    progressText.textContent = `${n}/${readyLessonCount} lessons`;
  }

  function buildRail() {
    rail.innerHTML = "";
    rail.append(h("a", { class: "rail-link", href: "#home", "data-route": "home" }, h("span", { class: "num" }, "⌂"), "Course home"));
    data.modules.forEach((m) => {
      const wrap = h("div", { class: "rail-module" + (m.status === "ready" ? "" : " planned") });
      wrap.append(h("a", { class: "rail-link", href: "#m-" + m.id, "data-route": "m-" + m.id },
        h("span", { class: "num" }, m.id), m.title, m.status === "ready" ? null : h("span", { class: "rail-tag" }, "soon")));
      if (m.lessons.length) {
        const ul = h("ul");
        m.lessons.forEach((l) => ul.append(h("li", {}, h("a", { class: "rail-link", href: "#l-" + l.id, "data-route": "l-" + l.id },
          h("span", { class: "num" }, l.id), l.title, done.has(l.id) ? h("span", { class: "done-dot", "aria-label": "done" }, "●") : null))));
        if (m.quiz) ul.append(h("li", {}, h("a", { class: "rail-link", href: "#q-" + m.id, "data-route": "q-" + m.id },
          h("span", { class: "num" }, "?"), "Check your understanding", quizScores[m.id] != null ? h("span", { class: "done-dot" }, quizScores[m.id] + "/" + m.quiz.questions.length) : null)));
        wrap.append(ul);
      }
      rail.append(wrap);
    });
    rail.append(h("div", { class: "rail-foot" },
      h("a", { class: "rail-link", href: "#glossary", "data-route": "glossary" }, h("span", { class: "num" }, "Aa"), "Glossary"),
      h("a", { class: "rail-link", href: data.repoUrl, target: "_blank", rel: "noopener" }, h("span", { class: "num" }, "↗"), "Code on GitHub")));
  }

  function markRail(route) {
    rail.querySelectorAll("[data-route]").forEach((a) => a.toggleAttribute("aria-current", false));
    const cur = rail.querySelector(`[data-route="${CSS.escape(route)}"]`);
    if (cur) { cur.setAttribute("aria-current", "page"); cur.scrollIntoView({ block: "nearest" }); }
  }

  // ---------- views ----------
  function viewHome() {
    const next = lessons.find((l) => !done.has(l.id)) || lessons[0];
    const col = h("div", { class: "wide" });
    col.append(
      h("section", { class: "hero" },
        h("div", {},
          h("div", { class: "eyebrow" }, "A hands-on course · Restate & Temporal"),
          h("h1", {}, "Learn how programs survive their own crashes."),
          h("p", { class: "lede" }, data.subtitle),
          h("div", { class: "hero-actions" },
            h("a", { class: "btn primary", href: "#l-" + next.id }, done.size ? `Continue: ${next.id} ${next.title}` : "Start with lesson 0.1"),
            h("a", { class: "btn ghost", href: "#l-2.1" }, "Jump to the big idea"))),
        recorder()),
      h("h2", { class: "section-title" }, "By the end you'll be able to"),
      h("ul", { class: "outcomes" },
        h("li", {}, "Explain durable execution in plain language to a customer or teammate"),
        h("li", {}, "Build and run small programs on Restate and on Temporal"),
        h("li", {}, "Read journals, event histories and CLI output to find out what really happened"),
        h("li", {}, "Diagnose stuck workflows, duplicate charges and breaking deploys"),
        h("li", {}, "Write ticket replies and runbooks that customers trust"),
        h("li", {}, "Talk through the trade-offs between Restate and Temporal")),
      h("h2", { class: "section-title" }, "Modules"),
      h("div", { class: "module-grid" }, data.modules.map(moduleCard)),
    );
    return col;
  }

  function moduleCard(m) {
    const ready = m.status === "ready";
    const total = m.lessons.length || m.planned.length;
    const pct = m.lessons.length ? (moduleDone(m) / m.lessons.length) * 100 : 0;
    return h("a", { class: "module-card" + (ready ? "" : " planned"), href: "#m-" + m.id },
      h("div", { class: "mc-top" }, h("span", { class: "mc-num" }, "MODULE " + m.id), h("span", { class: "mc-num", style: "color:var(--muted)" }, "~" + m.hours + "h")),
      h("h3", {}, m.title),
      h("p", {}, m.tagline),
      h("div", { class: "mc-foot" }, ready ? [h("span", { class: "meter" }, h("span", { style: `width:${pct}%` })), `${moduleDone(m)}/${total}`] : `${total} lessons · in progress`));
  }

  /** The home page's "flight recorder": a journal being replayed after a crash. */
  function recorder() {
    const lines = [
      ["#0", "reserve inventory → res_1001"],
      ["#1", "charge card       → pay_1001"],
      ["💥", "process killed"],
      ["#0", "reserve inventory ↺ replayed"],
      ["#1", "charge card       ↺ replayed"],
      ["#2", "ship order        ▶ runs now"],
    ];
    const box = h("div", { class: "recorder", "aria-label": "Example journal replay" },
      h("div", { class: "rec-head" }, h("span", {}, "journal · order-1001"), h("span", {}, "run 2")));
    const els = lines.map(([k, t], i) => {
      const cls = i === 2 ? " crash" : i === 3 || i === 4 ? " replayed" : i === 5 ? " fresh" : "";
      const el = h("div", { class: "rec-line" + cls }, h("span", { class: "k" }, k), h("span", {}, t));
      box.append(el);
      return el;
    });
    box.append(h("div", { class: "rec-caption" }, "Highlighted steps come from the journal: the bank is not charged again."));
    if (!reduceMotion) {
      // Gently re-play the highlight so the idea reads as motion, from a complete resting state.
      let tick = 0;
      const timer = setInterval(() => {
        if (!box.isConnected) return clearInterval(timer);
        tick = (tick + 1) % 4;
        els[3].classList.toggle("replayed", tick >= 1);
        els[4].classList.toggle("replayed", tick >= 2);
        els[5].classList.toggle("fresh", tick >= 3);
      }, 900);
    }
    return box;
  }

  function viewModule(m) {
    const col = h("div", { class: "col" });
    col.append(h("div", { class: "lesson-head" },
      h("div", { class: "eyebrow" }, "Module " + m.id),
      h("h1", {}, m.title),
      h("p", { class: "lesson-meta" }, `${m.tagline} About ${m.hours} hour${m.hours === "1" ? "" : "s"}.`)));
    if (m.status !== "ready") col.append(h("p", { class: "notice" }, "This module is being written. Here's what it will cover."));
    if (m.run) col.append(h("div", { class: "prose" }, h("blockquote", { class: "callout run" }, h("p", {}, h("strong", {}, "▶ Hands-on for this module"), h("code", {}, m.run)))));
    const ul = h("ul", { class: "lesson-list" });
    if (m.lessons.length) {
      m.lessons.forEach((l) => ul.append(h("li", {}, h("a", { href: "#l-" + l.id },
        h("span", { class: "num" }, l.id), h("span", {}, l.title, done.has(l.id) ? "  ✓" : ""), h("span", { class: "time" }, l.time)))));
      if (m.quiz) ul.append(h("li", {}, h("a", { href: "#q-" + m.id }, h("span", { class: "num" }, "?"), h("span", {}, "Check your understanding"), h("span", { class: "time" }, m.quiz.questions.length + " questions"))));
    } else {
      m.planned.forEach((p) => {
        const [num, ...rest] = p.split(" ");
        ul.append(h("li", {}, h("div", { class: "planned-row" }, h("span", { class: "num" }, num), h("span", {}, rest.join(" ")), h("span", { class: "time" }, "soon"))));
      });
    }
    col.append(ul);
    return col;
  }

  function viewLesson(l) {
    const idx = lessons.indexOf(l);
    const prev = lessons[idx - 1];
    const next = lessons[idx + 1];
    const article = stash.querySelector(`[data-lesson="${CSS.escape(l.id)}"]`);
    const col = h("div", { class: "col" });
    col.append(h("div", { class: "lesson-head" },
      h("div", { class: "eyebrow" }, `Module ${l.module.id} · ${l.module.title}`),
      h("h1", {}, `${l.id} ${l.title}`),
      l.meta ? h("p", { class: "lesson-meta", html: l.meta }) : null));
    if (article) {
      col.append(article);
      mountWidgets(article);
    }
    const doneBtn = h("button", { class: "btn " + (done.has(l.id) ? "is-done" : "ghost"), onclick: () => {
      if (done.has(l.id)) done.delete(l.id); else done.add(l.id);
      store.set("done", [...done]);
      doneBtn.className = "btn " + (done.has(l.id) ? "is-done" : "ghost");
      doneBtn.textContent = done.has(l.id) ? "✓ Completed" : "Mark as complete";
      buildRail(); markRail("l-" + l.id); updateProgress();
    } }, done.has(l.id) ? "✓ Completed" : "Mark as complete");
    const nextHref = next ? (next.module !== l.module && l.module.quiz ? "#q-" + l.module.id : "#l-" + next.id) : (l.module.quiz ? "#q-" + l.module.id : "#home");
    const nextLabel = next ? (next.module !== l.module && l.module.quiz ? "Module check →" : `Next: ${next.id} ${next.title} →`) : (l.module.quiz ? "Module check →" : "Back to course home");
    col.append(h("div", { class: "lesson-foot" },
      prev ? h("a", { class: "btn ghost small", href: "#l-" + prev.id }, "← " + prev.id) : h("span"),
      doneBtn,
      h("a", { class: "btn primary", href: nextHref, onclick: () => { if (!done.has(l.id)) { done.add(l.id); store.set("done", [...done]); updateProgress(); } } }, nextLabel)));
    return col;
  }

  function viewQuiz(m) {
    const col = h("div", { class: "col" });
    const q = m.quiz;
    let answered = 0, right = 0;
    const score = h("p", { class: "quiz-score", "aria-live": "polite" });
    col.append(h("div", { class: "lesson-head" },
      h("div", { class: "eyebrow" }, "Module " + m.id + " · check your understanding"),
      h("h1", {}, q.title.replace(/^Module \d+ check: /, "")),
      h("p", { class: "lesson-meta" }, "Pick an answer to see whether it's right and why. Wrong answers are useful: each one points at a lesson to revisit.")));
    q.questions.forEach((item, qi) => {
      const box = h("div", { class: "quiz-q" }, h("h3", {}, h("span", { class: "qn" }, qi + 1 + "."), item.q));
      const why = h("p", { class: "quiz-why", hidden: true });
      const buttons = item.options.map((opt, oi) => h("button", { class: "quiz-opt", type: "button", onclick: () => {
        buttons.forEach((b, bi) => { b.disabled = true; if (bi === item.answer) b.classList.add("right"); });
        const ok = oi === item.answer;
        if (!ok) buttons[oi].classList.add("wrong");
        why.innerHTML = "";
        why.append(h("strong", {}, ok ? "Right. " : "Not quite. "), item.why);
        why.hidden = false;
        answered++; if (ok) right++;
        if (answered === q.questions.length) {
          score.textContent = `You got ${right} of ${q.questions.length}.` + (right === q.questions.length ? " Ready for the next module." : " Revisit the lessons behind the ones you missed.");
          quizScores[m.id] = right; store.set("quiz", quizScores); buildRail(); markRail("q-" + m.id);
        }
      } }, h("span", { class: "letter" }, String.fromCharCode(97 + oi) + ")"), h("span", {}, opt)));
      buttons.forEach((b) => box.append(b));
      box.append(why);
      col.append(box);
    });
    col.append(score);
    const nextModule = data.modules[data.modules.indexOf(m) + 1];
    if (nextModule) col.append(h("div", { class: "lesson-foot" }, h("span"), h("a", { class: "btn primary", href: nextModule.lessons.length ? "#l-" + nextModule.lessons[0].id : "#m-" + nextModule.id }, `Module ${nextModule.id}: ${nextModule.title} →`)));
    return col;
  }

  function viewGlossary() {
    const col = h("div", { class: "col" });
    const dl = h("dl", { class: "gloss" });
    const render = (filter) => {
      dl.innerHTML = "";
      data.glossary.filter((g) => !filter || (g.term + g.def).toLowerCase().includes(filter)).forEach((g) => {
        const see = findLesson(g.see) ? h("a", { class: "see", href: "#l-" + g.see }, "→ " + g.see) : h("span", { class: "see", style: "color:var(--muted)" }, g.see);
        dl.append(h("dt", {}, g.term), h("dd", {}, g.def, " ", see));
      });
    };
    render("");
    col.append(h("div", { class: "lesson-head" }, h("div", { class: "eyebrow" }, "Reference"), h("h1", {}, "Glossary"),
      h("p", { class: "lesson-meta" }, "Every term in the course, with the lesson that introduces it.")),
      h("label", { for: "gloss-q", class: "lesson-meta" }, "Filter terms"),
      h("div", {}, h("input", { id: "gloss-q", class: "gloss-search", type: "search", placeholder: "e.g. replay", oninput: (e) => render(e.target.value.trim().toLowerCase()) })),
      dl);
    return col;
  }

  // ---------- router ----------
  function route() {
    // Return any lesson article currently on screen to the stash before switching.
    main.querySelectorAll("article[data-lesson]").forEach((a) => stash.append(a));
    const hash = decodeURIComponent(location.hash.slice(1)) || "home";
    let view, key = hash;
    if (hash.startsWith("l-") && findLesson(hash.slice(2))) view = viewLesson(findLesson(hash.slice(2)));
    else if (hash.startsWith("m-") && findModule(hash.slice(2))) view = viewModule(findModule(hash.slice(2)));
    else if (hash.startsWith("q-") && findModule(hash.slice(2))?.quiz) view = viewQuiz(findModule(hash.slice(2)));
    else if (hash === "glossary") view = viewGlossary();
    else { view = viewHome(); key = "home"; }
    main.replaceChildren(view);
    markRail(key);
    rail.classList.remove("open");
    window.scrollTo(0, 0);
    const title = view.querySelector("h1");
    document.title = key === "home" ? data.title : `${title ? title.textContent : ""} · ${data.title}`;
  }
  window.addEventListener("hashchange", route);

  // ---------- widgets ----------
  function mountWidgets(scope) {
    scope.querySelectorAll(".widget:not([data-mounted])").forEach((el) => {
      el.setAttribute("data-mounted", "");
      let cfg = {};
      try { cfg = JSON.parse(el.getAttribute("data-config") || "{}"); } catch { /* ignore */ }
      const fn = { sim: simWidget, "retry-timeline": retryWidget, determinism: determinismWidget }[el.dataset.widget];
      if (fn) fn(el, cfg);
    });
  }

  /* The journal simulator: step a 3-step order through an engine, crash it anywhere, restart. */
  function simWidget(root, cfg) {
    const mode = cfg.mode || "replay"; // plain | journal | replay | idempotent
    const STEPS = [
      { name: "reserve inventory", code: 'await ctx.step("reserve inventory", …)', effect: "reserve", result: "res_1001" },
      { name: "charge card", code: 'await ctx.step("charge card", …)', effect: "charge", result: "pay_1001" },
      { name: "ship order", code: 'await ctx.step("ship order", …)', effect: "ship", result: "trk_1001" },
    ];
    if (mode === "plain") STEPS.forEach((s) => (s.code = `await ${s.effect === "reserve" ? "inventory.reserve" : s.effect === "charge" ? "bank.charge" : "shipping.ship"}(…)`));
    const MODE_LABEL = { plain: "plain code, no engine", journal: "engine v1 · journal only", replay: "engine v2 · journal + replay", idempotent: "engine v3 · + idempotency keys" };
    const SCRIPTS = {
      "crash-after-charge": ["next", "next", "next", "next", "crash", "restart", "next", "next", "next", "next", "next", "next"],
      "crash-during-charge": ["next", "next", "next", "crash", "restart", "next", "next", "next", "next", "next", "next"],
    };
    const hasScript = !!SCRIPTS[cfg.scenario];
    const startMsg = hasScript
      ? "Press <b>▶ Play the scenario</b> to watch it, or drive it yourself with <b>Next step</b>."
      : "Press <b>Next step</b> to start the order.";
    let s;
    const reset = () => {
      s = { run: 1, pos: 0, phase: "idle", crashed: false, finished: false, journal: [], replayed: new Set(), keys: new Set(),
        ledger: { reserve: 0, charge: 0, ship: 0, dedup: 0 }, msg: startMsg, flash: -1 };
    };
    reset();

    const codeEl = h("div"), journalEl = h("div"), ledgerEl = h("div"), logEl = h("div", { class: "sim-log", "aria-live": "polite" });
    const status = h("span", { class: "sim-status" });
    const nextBtn = h("button", { class: "btn primary small", type: "button", onclick: () => act("next") }, "Next step");
    const crashBtn = h("button", { class: "btn ghost small crash", type: "button", onclick: () => act("crash") }, "💥 Crash now");
    const restartBtn = h("button", { class: "btn ghost small", type: "button", onclick: () => act("restart") }, "↻ Restart process");
    const playBtn = SCRIPTS[cfg.scenario] ? h("button", { class: "btn ghost small", type: "button", onclick: play }, "▶ Play the scenario") : null;
    const resetBtn = h("button", { class: "btn ghost small", type: "button", onclick: () => { stopPlay(); reset(); draw(); } }, "Reset");

    root.append(h("div", { class: "sim" },
      h("div", { class: "sim-head" }, h("span", { class: "sim-title" }, "Order simulator"), h("span", { class: "sim-mode" }, MODE_LABEL[mode])),
      cfg.hint ? h("p", { class: "sim-hint" }, cfg.hint) : null,
      h("div", { class: "sim-cols" },
        h("div", { class: "sim-panel" }, h("h4", {}, "Workflow code"), codeEl),
        h("div", { class: "sim-panel" }, h("h4", {}, mode === "plain" ? "Journal (none)" : "Journal"), journalEl),
        h("div", { class: "sim-panel" }, h("h4", {}, "Outside world"), ledgerEl)),
      h("div", { class: "sim-controls" }, nextBtn, crashBtn, restartBtn, playBtn, resetBtn, status),
      logEl));

    function act(kind) {
      if (kind === "next") {
        if (s.crashed || s.finished) return;
        const step = STEPS[s.pos];
        const rec = s.journal[s.pos];
        if (s.phase === "idle") {
          if (rec && (mode === "replay" || mode === "idempotent")) {
            s.replayed.add(s.pos); s.pos++;
            s.msg = `↺ <b>${step.name}</b> is already in the journal (#${s.pos - 1}). The engine hands back <code>${rec.result}</code> without calling anyone.`;
          } else {
            const key = `order-1001/${step.name}`;
            if (mode === "idempotent" && s.keys.has(key)) {
              s.ledger.dedup++;
              s.msg = `▶ <b>${step.name}</b> runs again, with idempotency key <code>${key}</code>. The ${step.effect === "charge" ? "bank" : "system"} has seen that key, so it returns the original result and does nothing new.`;
            } else {
              s.ledger[step.effect]++; s.keys.add(key);
              s.msg = `▶ <b>${step.name}</b> runs: the ${step.effect === "reserve" ? "warehouse reserves the item" : step.effect === "charge" ? "bank charges $49.99" : "carrier ships the box"}. ` +
                (mode === "plain" ? "" : "<b>It's not in the journal yet.</b> A crash right now lands in the gap.");
            }
            s.phase = "executed";
          }
        } else {
          if (mode === "plain") s.msg = `Moving on. Nothing is written down anywhere.`;
          else { s.journal.push({ step: step.name, result: step.result }); s.flash = s.journal.length - 1; s.msg = `📝 Recorded <b>${step.name}</b> → <code>${step.result}</code> in the journal (#${s.journal.length - 1}).`; }
          s.pos++; s.phase = "idle";
        }
        if (s.pos >= STEPS.length && s.phase === "idle") {
          s.finished = true;
          s.msg += " <b>Order complete.</b>";
        }
      } else if (kind === "crash") {
        if (s.crashed || s.finished) return;
        const step = STEPS[s.pos];
        s.crashed = true;
        if (s.phase === "executed" && mode !== "plain") s.msg = `💥 Crashed <b>inside</b> "${step.name}": its side effect happened, but the journal doesn't know. Restart to see what that costs.`;
        else if (mode === "plain") s.msg = `💥 Crashed. Plain code keeps its progress in memory, so all of it is gone.`;
        else s.msg = `💥 Crashed between steps. Everything finished so far is in the journal.`;
      } else if (kind === "restart") {
        if (!s.crashed && !s.finished) { s.msg = "The process is still running. Crash it first, or let it finish."; draw(); return; }
        if (s.finished && !s.crashed) {
          s.msg = mode === "plain" || mode === "journal" ? "Restarting a finished order with this engine would run it all again. Use Reset to start over." : "The journal says this order is complete, so a restart does nothing. That's the point.";
          draw(); return;
        }
        s.run++; s.pos = 0; s.phase = "idle"; s.crashed = false; s.finished = false; s.replayed = new Set();
        if (mode === "journal") s.journal = [];
        s.msg = mode === "plain" ? `↻ Run ${s.run} starts from the top. It has no idea what run ${s.run - 1} did.`
          : mode === "journal" ? `↻ Run ${s.run} starts. Engine v1 never reads the journal, so it starts a fresh one and begins at the top.`
          : `↻ Run ${s.run} starts from the top of the code, but this engine reads the journal first.`;
      }
      draw();
    }

    let playing = null;
    function stopPlay() { if (playing) { clearTimeout(playing); playing = null; } if (playBtn) playBtn.textContent = "▶ Play the scenario"; }
    function play() {
      if (playing) return stopPlay();
      reset(); draw();
      const steps = SCRIPTS[cfg.scenario].slice();
      playBtn.textContent = "■ Stop";
      const tick = () => {
        const a = steps.shift();
        if (!a) return stopPlay();
        act(a);
        playing = setTimeout(tick, reduceMotion ? 300 : 1500);
      };
      playing = setTimeout(tick, 300);
    }

    function draw() {
      codeEl.replaceChildren(...STEPS.map((st, i) => {
        const here = !s.crashed && !s.finished && i === s.pos;
        return h("div", { class: "sim-line" + (here ? (s.phase === "executed" ? " mid" : " current") : "") },
          h("span", { class: "ptr" }, here ? "▸" : s.crashed && i === s.pos ? "✕" : ""), h("span", {}, st.code));
      }));
      if (mode === "plain") journalEl.replaceChildren(h("div", { class: "sim-empty" }, "Plain code keeps progress in memory only."));
      else journalEl.replaceChildren(...(s.journal.length ? s.journal.map((e, i) =>
        h("div", { class: "jentry" + (s.replayed.has(i) ? " replayed" : "") + (i === s.flash ? " flash" : "") }, h("span", { class: "k" }, "#" + i), h("span", {}, e.step)))
        : [h("div", { class: "sim-empty" }, "(empty)")]));
      s.flash = -1;
      const row = (label, n, extraCls) => h("div", { class: "ledger-row" + (n > 1 ? " dup" : "") + (extraCls || "") }, h("span", {}, label), h("b", {}, n + "×"));
      const rows = [row("reserved", s.ledger.reserve), row("charged", s.ledger.charge), row("shipped", s.ledger.ship)];
      if (s.ledger.dedup) rows.push(h("div", { class: "ledger-row dedup" }, h("span", {}, "duplicates ignored"), h("b", {}, s.ledger.dedup + "×")));
      ledgerEl.replaceChildren(...rows);
      logEl.innerHTML = `<span class="run-tag">run ${s.run}</span>` + s.msg;
      status.textContent = s.crashed ? "process: dead" : s.finished ? "process: finished" : "process: running";
      nextBtn.disabled = s.crashed || s.finished;
      crashBtn.disabled = s.crashed || s.finished;
    }
    draw();
  }

  /* Retry timeline: three experiments from lesson 2.6, drawn to scale. */
  function retryWidget(root) {
    const CASES = {
      A: { label: "A · bank down twice", attempts: [{ t: 0, r: "fail", note: "503" }, { t: 200, r: "fail", note: "503" }, { t: 600, r: "ok", note: "charged" }],
        text: "Two transient failures, then success. Each wait doubles: 200ms, then 400ms. One charge." },
      B: { label: "B · reply lost", attempts: [{ t: 0, r: "fail", note: "timeout*" }, { t: 200, r: "ok", note: "dup ignored" }],
        text: "Attempt 1 actually charged the card; only the reply was lost (*). Attempt 2 carries the same idempotency key, so the bank returns the original result. One charge." },
      C: { label: "C · card declined", attempts: [{ t: 0, r: "stop", note: "declined" }],
        text: "A permanent error. Retrying can't help, so the engine stops at once and marks the workflow failed." },
    };
    const MAX = 800;
    let current = "A";
    const tl = h("div", { class: "timeline", role: "img" });
    const text = h("p", { class: "sim-log" });
    const segs = Object.entries(CASES).map(([k, c]) => h("button", { class: "seg", type: "button", "aria-pressed": String(k === current), onclick: () => { current = k; draw(); } }, c.label));
    root.append(h("div", { class: "sim" }, h("div", { class: "sim-head" }, h("span", { class: "sim-title" }, "Retries, to scale"), h("span", { class: "sim-mode" }, "engine v4")),
      h("div", { class: "toggle-group" }, segs), tl, h("div", { style: "height:18px" }), text));
    function draw() {
      segs.forEach((b, i) => b.setAttribute("aria-pressed", String(Object.keys(CASES)[i] === current)));
      const c = CASES[current];
      tl.replaceChildren();
      tl.setAttribute("aria-label", c.text);
      const x = (t) => `${6 + (t / MAX) * 88}%`;
      [0, 200, 400, 600, 800].forEach((t) => tl.append(h("span", { class: "tick", style: `left:${x(t)}` }, t + "ms")));
      c.attempts.forEach((a, i) => {
        tl.append(h("span", { class: "attempt " + a.r, style: `left:${x(a.t)}`, title: a.note }, String(i + 1)));
        tl.append(h("span", { class: "gap-label", style: `left:${x(a.t)}` }, a.note));
      });
      text.textContent = c.text;
    }
    draw();
  }

  /* Determinism explorer: where the coin flip happens decides whether replay survives. */
  function determinismWidget(root) {
    const st = { where: "outside", first: "wrap", second: "nowrap" };
    const out = h("div");
    const group = (label, key, opts) => h("div", { class: "toggle-group" }, h("span", { class: "label" }, label),
      opts.map(([v, t]) => h("button", { class: "seg", type: "button", "data-k": key, "data-v": v, onclick: () => { st[key] = v; draw(); } }, t)));
    const controls = [
      group("Coin flip happens", "where", [["outside", "outside a step (Math.random)"], ["inside", "inside a step (ctx.random)"]]),
      group("Run 1 coin", "first", [["wrap", "gift wrap"], ["nowrap", "no wrap"]]),
      group("Run 2 coin", "second", [["wrap", "gift wrap"], ["nowrap", "no wrap"]]),
    ];
    root.append(h("div", { class: "sim" }, h("div", { class: "sim-head" }, h("span", { class: "sim-title" }, "Determinism explorer"), h("span", { class: "sim-mode" }, "engine v5")),
      h("div", { style: "display:grid;gap:8px" }, controls), out));
    function seq(wrap, inside) {
      const s = ["reserve inventory", "charge card"];
      if (inside) s.push("gift wrap roll");
      if (wrap) s.push("gift wrap");
      return s;
    }
    function draw() {
      root.querySelectorAll(".seg").forEach((b) => b.setAttribute("aria-pressed", String(st[b.dataset.k] === b.dataset.v)));
      const inside = st.where === "inside";
      const journal = seq(st.first === "wrap", inside);            // run 1 crashes after its last step
      const wrap2 = inside ? st.first === "wrap" : st.second === "wrap"; // inside: replay reuses the recorded coin
      const asks = seq(wrap2, inside).concat("ship order");
      let broken = -1;
      const rows = asks.map((name, i) => {
        if (broken >= 0) return null;
        const rec = journal[i];
        if (rec === undefined) return h("div", { class: "jentry" }, h("span", { class: "k" }, "#" + i), h("span", {}, "▶ " + name + " (new: runs for real)"));
        if (rec === name) return h("div", { class: "jentry replayed" }, h("span", { class: "k" }, "#" + i), h("span", {}, "↺ " + name));
        broken = i;
        return h("div", { class: "jentry mismatch" }, h("span", { class: "k" }, "#" + i), h("span", {}, `✕ code asks "${name}", journal has "${rec}"`));
      }).filter(Boolean);
      const verdict = broken >= 0
        ? h("div", { class: "verdict bad" }, "Non-determinism error. The replay took a different path than run 1, so the engine stops before trusting any more of the journal.")
        : h("div", { class: "verdict ok" }, inside && st.first !== st.second
          ? "Replay succeeds. The run-2 coin never mattered: replay reused the coin flip recorded in run 1."
          : "Replay succeeds. Both runs took the same path" + (inside ? "." : ", this time. With Math.random it's luck."));
      out.replaceChildren(h("div", { class: "det-grid" },
        h("div", { class: "sim-panel" }, h("h4", {}, "Journal from run 1 (then 💥)"), journal.map((n, i) => h("div", { class: "jentry" }, h("span", { class: "k" }, "#" + i), h("span", {}, n)))),
        h("div", { class: "sim-panel" }, h("h4", {}, "Run 2 replay"), rows)), verdict);
    }
    draw();
  }

  // ---------- diagram zoom ----------
  /* Click (or Enter/Space on) any diagram to see it full-screen. Works with
     diagrams drawn by mermaid in the page or rendered by the host. */
  let zoomReturnFocus = null;
  const zoomBody = h("div", { class: "zoom-body" });
  const zoomClose = h("button", { class: "icon-btn zoom-close", type: "button", "aria-label": "Close enlarged diagram" }, "✕ Close");
  const zoom = h("div", { class: "zoom", role: "dialog", "aria-modal": "true", "aria-label": "Enlarged diagram", hidden: true }, zoomClose, zoomBody);
  document.body.append(zoom);

  function openZoom(diagram) {
    const svg = diagram.querySelector("svg");
    if (!svg) return; // not drawn yet (or the diagram library couldn't load)
    const copy = svg.cloneNode(true);
    const vb = svg.viewBox && svg.viewBox.baseVal;
    const naturalW = vb && vb.width ? vb.width : svg.getBoundingClientRect().width;
    copy.removeAttribute("height");
    copy.style.maxWidth = "none";
    copy.style.height = "auto";
    // Large screens: fill the width, up to 3× the drawing's natural size.
    // Small screens: show it at its natural size (wider than the screen)
    // so text is readable, and let the reader pan. Tall diagrams scroll either way.
    const vw = window.innerWidth;
    const width = vw < 700 ? Math.max(vw * 0.94, naturalW) : Math.min(vw * 0.94, naturalW * 3);
    copy.style.width = width + "px";
    copy.setAttribute("width", copy.style.width);
    zoomBody.replaceChildren(copy);
    zoomReturnFocus = document.activeElement;
    zoom.hidden = false;
    document.documentElement.classList.add("zoom-open");
    zoomClose.focus();
  }
  function closeZoom() {
    if (zoom.hidden) return;
    zoom.hidden = true;
    zoomBody.replaceChildren();
    document.documentElement.classList.remove("zoom-open");
    if (zoomReturnFocus && zoomReturnFocus.focus) zoomReturnFocus.focus();
  }
  zoomClose.addEventListener("click", closeZoom);
  zoom.addEventListener("click", (e) => { if (e.target === zoom || e.target === zoomBody) closeZoom(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeZoom(); });
  document.addEventListener("click", (e) => {
    const d = e.target.closest && e.target.closest(".diagram");
    if (d && !zoom.contains(d)) openZoom(d);
  });
  document.addEventListener("keydown", (e) => {
    const d = e.target.closest && e.target.closest(".diagram");
    if (d && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openZoom(d); }
  });
  stash.querySelectorAll(".diagram").forEach((d) => {
    d.tabIndex = 0;
    d.setAttribute("role", "button");
    d.setAttribute("aria-label", "Diagram. Press to enlarge.");
  });

  // ---------- go ----------
  if (window.hljs) stash.querySelectorAll("pre.code code[class*=language-]").forEach((el) => window.hljs.highlightElement(el));
  buildRail();
  updateProgress();
  route();
  if (window.mermaid) {
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    window.mermaid.initialize({ startOnLoad: false, theme: dark ? "dark" : "neutral", fontFamily: "JetBrains Mono, monospace" });
    window.mermaid.run({ querySelector: "pre.mermaid" });
  }
})();
