// Talks to server.py and draws each run as a timeline of the checks the message
// went through. Every piece of server text goes in through textContent, never
// innerHTML, so a message cannot inject markup into the page.

const form = document.getElementById("form");
const input = document.getElementById("message");
const send = document.getElementById("send");
const results = document.getElementById("results");
const notice = document.getElementById("notice");
const badge = document.getElementById("mode-badge");
const examples = document.getElementById("examples");
const runTemplate = document.getElementById("run-template");

const STEP_DELAY = 260;

const LABELS = {
  normaliser: () => "Normaliser",
  translator: () => "Translator · English version also checked",
  model: () => "Model",
  error: () => "Error",
  passed: (s) => (s.stage === "response" ? "Guard · reply passed" : "Guard · message passed"),
  blocked: (s) => (s.stage === "response" ? "Blocked at the response stage" : "Blocked at the prompt stage"),
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function emit(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function showNotice(parts) {
  notice.replaceChildren(...parts.map((p) => (p.code ? el("code", "", p.code) : document.createTextNode(p))));
  notice.hidden = false;
}

async function loadStatus() {
  try {
    const res = await fetch("/api/status");
    const status = await res.json();
    badge.hidden = false;
    if (status.demo) {
      badge.textContent = "demo mode";
      showNotice([
        "Demo mode: the Guard and the model are simulated, so this uses no token or quota. Start ",
        { code: "py server.py" },
        " without ",
        { code: "--demo" },
        " for the real thing.",
      ]);
    } else if (status.missing.length) {
      badge.textContent = "not configured";
      showNotice([
        "Missing settings: " + status.missing.join(", ") + ". Create ",
        { code: ".env" },
        " (see the README), or run ",
        { code: "py server.py --demo" },
        " to try it without keys.",
      ]);
    } else {
      badge.textContent = "live";
      badge.classList.add("live");
    }
    renderExamples(status.examples || []);
  } catch {
    showNotice(["Could not reach the server. Start it with ", { code: "py server.py" }, " and reload."]);
  }
}

function renderExamples(list) {
  examples.replaceChildren(
    ...list.map((ex) => {
      const chip = el("button", "chip", ex.label);
      chip.type = "button";
      chip.title = ex.text;
      chip.addEventListener("click", () => {
        input.value = ex.text;
        input.focus();
      });
      return chip;
    })
  );
}

function setBusy(on) {
  send.disabled = on;
  send.classList.toggle("busy", on);
  send.querySelector(".send-label").textContent = on ? "Checking" : "Send";
  emit("zuri:busy", on);
}

function thinking() {
  const box = el("div", "thinking glass");
  const dots = el("span", "pulse");
  dots.append(el("i"), el("i"), el("i"));
  box.append(dots, el("span", "", "Cleaning, translating and checking your message..."));
  return box;
}

function verdictNode(run) {
  const box = el("div", "verdict " + (run.leaked ? "leaked" : run.outcome));
  const title = el("div", "v-title");
  if (run.outcome === "allowed") {
    // A reply that leaked the canary got through, but that is a failure, not a success.
    title.textContent = run.leaked ? "⚠ Allowed · but the model was tricked" : "✓ Allowed · the reply passed every check";
    box.append(title, el("div", "v-body", run.reply));
    if (run.leaked) {
      box.append(el("div", "warn", "⚠ This reply leaked the planted secret, and nothing stopped it."));
    }
  } else if (run.outcome === "blocked") {
    const last = run.steps[run.steps.length - 1];
    // The step above already shows the raw reason, so the verdict explains it in plain words.
    const atResponse = last.stage === "response";
    title.textContent = "⛔ Blocked at the " + (atResponse ? "response" : "prompt") + " stage";
    const why = atResponse
      ? "The model replied, but the reply was stopped before you saw it."
      : "The message was stopped before it reached the model.";
    box.append(title, el("div", "v-body", why));
  } else {
    title.textContent = "No reply to show";
    box.append(title, el("div", "v-body", "The model could not be reached."));
  }
  return box;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function renderRun(run) {
  const card = runTemplate.content.firstElementChild.cloneNode(true);
  const mode = card.querySelector(".run-mode");
  mode.textContent = run.mode === "full" ? "Full protection" : "Guard only";
  mode.classList.add(run.mode);
  card.querySelector(".run-time").textContent = "took " + run.took.toFixed(1) + "s";
  results.append(card);

  const list = card.querySelector(".steps");
  for (const step of run.steps) {
    const item = el("li", "step " + step.kind);
    const label = (LABELS[step.kind] || (() => step.kind))(step);
    item.append(el("span", "label", label), el("span", "text", step.text));
    list.append(item);
    await wait(STEP_DELAY);
  }
  card.querySelector(".verdict").replaceWith(verdictNode(run));
  emit("zuri:verdict", run.outcome === "allowed" && !run.leaked ? "allowed" : "blocked");
}

async function submit(event) {
  event.preventDefault();
  const message = input.value.trim();
  if (!message) {
    input.focus();
    return;
  }
  const mode = form.querySelector('input[name="mode"]:checked').value;

  setBusy(true);
  results.className = "results";
  results.replaceChildren(thinking());

  try {
    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, mode }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "request failed");

    results.classList.toggle("two", data.runs.length > 1);
    const asked = el("div", "asked", "You asked: ");
    asked.append(el("b", "", data.message));
    results.replaceChildren(asked);
    // Compare runs side by side, revealed together so the difference is easy to see.
    await Promise.all(data.runs.map(renderRun));
  } catch (err) {
    const box = el("div", "verdict error");
    box.append(el("div", "v-title", "Something went wrong"), el("div", "v-body", err.message));
    results.replaceChildren(box);
  } finally {
    setBusy(false);
  }
}

form.addEventListener("submit", submit);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) form.requestSubmit();
});

loadStatus();
