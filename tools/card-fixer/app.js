const TYPE_RU = {
  creature: "существо",
  building: "строение",
  spell: "заклинание",
  companion: "партнерство",
};
const LAND_RU = {
  corn: "кукуруза",
  blue: "синий",
  good: "добрый",
  ice: "лёд",
  sand: "песок",
  swamp: "болото",
  rainbow: "радужная",
  ghost: "призрачная",
};

const state = {
  packs: [],
  pack: localStorage.getItem("cardfix.pack") || "all",
  cards: [],
  selected: [],
  search: "",
  onlyUnchecked: false,
  checked: new Set(JSON.parse(localStorage.getItem("cardfix.checked") || "[]")),
  rotations: JSON.parse(localStorage.getItem("cardfix.rotations") || "{}"),
  swaps: 0,
  busy: false,
  lightboxFile: null,
};

const grid = document.getElementById("grid");
const empty = document.getElementById("empty");
const packSelect = document.getElementById("pack");
const searchInput = document.getElementById("search");
const onlyUnchecked = document.getElementById("only-unchecked");
const progressText = document.getElementById("progress-text");
const progressBar = document.getElementById("progress-bar");
const undoButton = document.getElementById("undo");
const swapPanel = document.getElementById("swap-panel");
const swapA = document.getElementById("swap-a");
const swapB = document.getElementById("swap-b");
const swapButton = document.getElementById("swap-btn");
const clearSel = document.getElementById("clear-sel");
const lightbox = document.getElementById("lightbox");
const lightboxArt = document.getElementById("lightbox-art");
const lightboxMeta = document.getElementById("lightbox-meta");
const toastEl = document.getElementById("toast");

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

const cardByFile = (file) => state.cards.find((card) => card.file === file);
const imageUrl = (file) => `/scans/${encodeURIComponent(file.replace(/\.json$/, ".png"))}`;

function typeLabel(json) {
  return TYPE_RU[json.typeCategory] || json.type || "";
}

function statsLabel(json) {
  if (json.attack == null && json.defense == null) return "";
  return `${json.attack ?? "—"}/${json.defense ?? "—"}`;
}

function jsonLine(json) {
  return [typeLabel(json), `${json.cost}д`, LAND_RU[json.landType] || json.landType, statsLabel(json)]
    .filter(Boolean)
    .join(" · ");
}

function rotClass(rotation) {
  return rotation === 90 || rotation === 270 ? "rot90" : "";
}

function artHtml(card, extraClass = "") {
  const rotation = state.rotations[card.file] || 0;
  return `<div class="art-wrap ${rotClass(rotation)} ${extraClass}">
    <img class="art" src="${imageUrl(card.file)}" alt="" loading="lazy" decoding="async" style="--rot:${rotation}deg">
  </div>`;
}

function cardHtml(card) {
  const rotation = state.rotations[card.file] || 0;
  const index = state.selected.indexOf(card.file);
  const checked = state.checked.has(card.file);
  return `<article class="card ${index >= 0 ? "selected" : ""} ${checked ? "checked" : ""}" data-file="${esc(card.file)}">
    <div class="sel-badge">${index >= 0 ? index + 1 : ""}</div>
    ${artHtml(card)}
    <div class="tile-actions">
      <button type="button" data-action="rotate" title="Повернуть картинку">↻</button>
      <button type="button" data-action="check" class="${checked ? "is-checked" : ""}" title="Проверено">${checked ? "✓" : "○"}</button>
      <button type="button" data-action="companion" title="Пометить как партнёрскую">П</button>
      <button type="button" data-action="zoom" title="Открыть крупно">⤢</button>
    </div>
    <div class="meta" data-rot="${rotation}">
      <div class="file">${esc(card.file)}</div>
      <div class="jname">${esc(card.json.name)}</div>
      <div class="jline">${esc(jsonLine(card.json))}</div>
      <div class="jdesc">${esc(card.json.description || "")}</div>
    </div>
  </article>`;
}

function filteredCards() {
  const query = state.search.trim().toLowerCase();
  return state.cards.filter((card) => {
    if (state.onlyUnchecked && state.checked.has(card.file)) return false;
    if (!query) return true;
    return card.file.toLowerCase().includes(query) || (card.json.name || "").toLowerCase().includes(query);
  });
}

function renderGrid() {
  const cards = filteredCards();
  grid.innerHTML = cards.map(cardHtml).join("");
  empty.classList.toggle("hidden", cards.length > 0);
  renderProgress();
  renderSwapPanel();
}

function renderProgress() {
  const total = state.cards.length;
  const done = state.cards.filter((card) => state.checked.has(card.file)).length;
  progressText.textContent = `${done} / ${total}`;
  progressBar.style.width = total ? `${Math.round((done / total) * 100)}%` : "0%";
}

function swapColHtml(card, label) {
  return `<div class="swap-art">${artHtml(card)}</div>
    <div class="swap-json">
      <div class="file"><span class="side-label">${label}</span> ${esc(card.file)}</div>
      <b>${esc(card.json.name)}</b>
      <div class="jline">${esc(jsonLine(card.json))}</div>
      <div class="jdesc">${esc(card.json.description || "")}</div>
    </div>`;
}

function renderSwapPanel() {
  if (state.selected.length !== 2) {
    swapPanel.classList.add("hidden");
    return;
  }
  const first = cardByFile(state.selected[0]);
  const second = cardByFile(state.selected[1]);
  if (!first || !second) {
    state.selected = [];
    swapPanel.classList.add("hidden");
    return;
  }
  swapA.innerHTML = swapColHtml(first, "A");
  swapB.innerHTML = swapColHtml(second, "B");
  swapPanel.classList.remove("hidden");
}

function applySelection() {
  grid.querySelectorAll(".card").forEach((element) => {
    const index = state.selected.indexOf(element.dataset.file);
    element.classList.toggle("selected", index >= 0);
    const badge = element.querySelector(".sel-badge");
    if (badge) badge.textContent = index >= 0 ? String(index + 1) : "";
  });
  renderSwapPanel();
}

function selectCard(file) {
  const index = state.selected.indexOf(file);
  if (index >= 0) state.selected.splice(index, 1);
  else {
    if (state.selected.length >= 2) state.selected.shift();
    state.selected.push(file);
  }
  applySelection();
}

function toggleCheck(file) {
  if (state.checked.has(file)) state.checked.delete(file);
  else state.checked.add(file);
  localStorage.setItem("cardfix.checked", JSON.stringify([...state.checked]));
  const tile = grid.querySelector(`[data-file="${CSS.escape(file)}"]`);
  if (tile) {
    tile.classList.toggle("checked", state.checked.has(file));
    const button = tile.querySelector('[data-action="check"]');
    if (button) {
      button.classList.toggle("is-checked", state.checked.has(file));
      button.textContent = state.checked.has(file) ? "✓" : "○";
    }
  }
  renderProgress();
}

function rotateCard(file) {
  const current = state.rotations[file] || 0;
  state.rotations[file] = (current + 90) % 360;
  localStorage.setItem("cardfix.rotations", JSON.stringify(state.rotations));
  const tile = grid.querySelector(`[data-file="${CSS.escape(file)}"]`);
  if (tile) {
    const rotation = state.rotations[file];
    const wrap = tile.querySelector(".art-wrap");
    const image = tile.querySelector(".art");
    wrap.classList.toggle("rot90", rotClass(rotation) !== "");
    image.style.setProperty("--rot", `${rotation}deg`);
  }
  if (state.selected.includes(file)) renderSwapPanel();
  if (state.lightboxFile === file) openLightbox(file);
}

function openLightbox(file) {
  const card = cardByFile(file);
  if (!card) return;
  state.lightboxFile = file;
  lightboxArt.innerHTML = artHtml(card);
  lightboxMeta.innerHTML = `<div class="file">${esc(card.file)}</div>
    <h2>${esc(card.json.name)}</h2>
    <div class="jline">${esc(jsonLine(card.json))}</div>
    <div class="jdesc">${esc(card.json.description || "")}</div>`;
  lightbox.classList.remove("hidden");
}

function closeLightbox() {
  state.lightboxFile = null;
  lightbox.classList.add("hidden");
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toastEl.classList.add("hidden"), 2600);
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

async function loadStatus() {
  try {
    const status = await requestJson("/api/status");
    state.swaps = status.swaps;
    undoButton.textContent = `Отменить действие${status.swaps ? ` (${status.swaps})` : ""}`;
    undoButton.disabled = status.swaps === 0;
  } catch (error) {
    showToast(error.message);
  }
}

async function loadPacks() {
  try {
    const payload = await requestJson("/api/packs");
    state.packs = payload.packs;
    const total = payload.packs.reduce((sum, pack) => sum + pack.count, 0);
    packSelect.innerHTML = `<option value="all">все карты (${total})</option>` +
      payload.packs.map((pack) => `<option value="${esc(pack.id)}">${esc(pack.id)} (${pack.count})</option>`).join("");
    if (state.pack !== "all" && !payload.packs.some((pack) => pack.id === state.pack)) state.pack = "all";
    packSelect.value = state.pack;
    await loadCards();
  } catch (error) {
    showToast(error.message);
  }
}

async function loadCards() {
  state.cards = [];
  state.selected = [];
  renderGrid();
  try {
    const payload = await requestJson(`/api/cards?pack=${encodeURIComponent(state.pack)}`);
    state.cards = payload.cards;
    renderGrid();
  } catch (error) {
    showToast(error.message);
  }
}

async function doSwap() {
  if (state.busy || state.selected.length !== 2) return;
  const [a, b] = state.selected;
  state.busy = true;
  swapButton.disabled = true;
  swapButton.textContent = "Меняю…";
  try {
    const payload = await requestJson("/api/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a, b }),
    });
    for (const updated of [payload.a, payload.b]) {
      const index = state.cards.findIndex((card) => card.file === updated.file);
      if (index >= 0) state.cards[index] = updated;
    }
    state.selected = [];
    renderGrid();
    await loadStatus();
    showToast(`Обменяно: ${a.replace(/\.json$/, "")} ↔ ${b.replace(/\.json$/, "")}`);
  } catch (error) {
    showToast(error.message);
  } finally {
    state.busy = false;
    swapButton.disabled = false;
    swapButton.textContent = "Поменять местами";
  }
}

async function markCompanion(file) {
  if (state.busy) return;
  state.busy = true;
  try {
    const payload = await requestJson("/api/mark-companion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: [file] }),
    });
    for (const updated of payload.cards) {
      const index = state.cards.findIndex((card) => card.file === updated.file);
      if (index >= 0) state.cards[index] = updated;
    }
    renderGrid();
    await loadStatus();
    showToast(`Помечено как партнёрское: ${file.replace(/\.json$/, "")}`);
  } catch (error) {
    showToast(error.message);
  } finally {
    state.busy = false;
  }
}

async function undoSwap() {
  if (state.busy) return;
  state.busy = true;
  undoButton.disabled = true;
  try {
    const payload = await requestJson("/api/undo", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    await loadCards();
    await loadStatus();
    showToast(`Отменено: ${payload.undone.files.join(" ↔ ").replace(/\.json$/g, "")}`);
  } catch (error) {
    showToast(error.message);
  } finally {
    state.busy = false;
    undoButton.disabled = state.swaps === 0;
  }
}

grid.addEventListener("click", (event) => {
  const tile = event.target.closest(".card");
  if (!tile) return;
  const file = tile.dataset.file;
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "rotate") rotateCard(file);
  else if (action === "check") toggleCheck(file);
  else if (action === "companion") markCompanion(file);
  else if (action === "zoom") openLightbox(file);
  else selectCard(file);
});

packSelect.addEventListener("change", () => {
  state.pack = packSelect.value;
  localStorage.setItem("cardfix.pack", state.pack);
  loadCards();
});

searchInput.addEventListener("input", () => {
  state.search = searchInput.value;
  renderGrid();
});

onlyUnchecked.addEventListener("change", () => {
  state.onlyUnchecked = onlyUnchecked.checked;
  renderGrid();
});

swapButton.addEventListener("click", doSwap);
clearSel.addEventListener("click", () => {
  state.selected = [];
  applySelection();
});
undoButton.addEventListener("click", undoSwap);
document.getElementById("lightbox-close").addEventListener("click", closeLightbox);
lightbox.addEventListener("click", (event) => {
  if (event.target === lightbox) closeLightbox();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (state.lightboxFile) closeLightbox();
    else {
      state.selected = [];
      applySelection();
    }
  }
});

loadStatus();
loadPacks();
