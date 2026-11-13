(function () {
  let allCards = [];
  let filteredCards = [];
  let userVerified = {};
  let currentCategory = "all";
  let searchQuery = "";
  let onlyUnverified = false;
  let currentPage = 1;
  const pageSize = 48;

  let activeCardIndex = -1;
  let zoomLevel = 1.0;
  let rotation = 0;

  // DOM Elements
  const statsBadge = document.getElementById("stats-badge");
  const catNav = document.getElementById("cat-nav");
  const searchInput = document.getElementById("search");
  const clearSearchBtn = document.getElementById("clear-search");
  const filterUnverifiedCheckbox = document.getElementById("filter-unverified");
  const cardsGrid = document.getElementById("cards-grid");
  const paginationBar = document.getElementById("pagination-bar");

  // Modal Elements
  const modal = document.getElementById("modal");
  const modalBackdrop = document.getElementById("modal-backdrop");
  const closeModalBtn = document.getElementById("close-modal");
  const prevCardBtn = document.getElementById("prev-card");
  const nextCardBtn = document.getElementById("next-card");
  const navCounter = document.getElementById("nav-counter");
  const modalTitle = document.getElementById("modal-title");
  const modalSubtitle = document.getElementById("modal-subtitle");
  const modalImg = document.getElementById("modal-img");
  const metaFile = document.getElementById("meta-file");
  const metaSha = document.getElementById("meta-sha");
  const modalVerified = document.getElementById("modal-verified");

  // Form Elements
  const cardForm = document.getElementById("card-form");
  const fName = document.getElementById("f-name");
  const fNameEn = document.getElementById("f-name-en");
  const fCost = document.getElementById("f-cost");
  const fAttack = document.getElementById("f-attack");
  const fDefense = document.getElementById("f-defense");
  const fLand = document.getElementById("f-land");
  const fType = document.getElementById("f-type");
  const fCategory = document.getElementById("f-category");
  const fSet = document.getElementById("f-set");
  const fDescription = document.getElementById("f-description");
  const fFlavor = document.getElementById("f-flavor");
  const rawJson = document.getElementById("raw-json");
  const saveStatus = document.getElementById("save-status");
  const toast = document.getElementById("toast");

  // Zoom controls
  const zoomInBtn = document.getElementById("zoom-in");
  const zoomOutBtn = document.getElementById("zoom-out");
  const zoomResetBtn = document.getElementById("zoom-reset");
  const rotateBtn = document.getElementById("rotate-btn");

  // Fetch initial data
  async function init() {
    try {
      const resp = await fetch("/api/cards");
      const json = await resp.json();
      allCards = json.cards || [];
      userVerified = json.verified || {};

      buildCategories();
      applyFilters();
      updateStats();
    } catch (err) {
      showToast("Ошибка загрузки данных: " + err.message);
    }
  }

  function updateStats() {
    const verifiedCount = Object.values(userVerified).filter(Boolean).length;
    statsBadge.textContent = `Всего: ${allCards.length} | Проверено вами: ${verifiedCount} / ${allCards.length}`;
  }

  function buildCategories() {
    const counts = { all: allCards.length };
    counts["teamwork"] = allCards.filter(
      (c) => c.data && (c.data.typeCategory === "teamwork" || c.data.orientation === "landscape")
    ).length;
    allCards.forEach((c) => {
      const key = c.subcategory || c.category;
      counts[key] = (counts[key] || 0) + 1;
    });

    catNav.innerHTML = "";
    const tabs = [
      { id: "all", label: "Все" },
      { id: "teamwork", label: "🤝 Командные (2v2)" },
      { id: "герои", label: "Герои" },
      { id: "земли", label: "Земли" },
      { id: "болотные", label: "Болотные" },
      { id: "добрые", label: "Добрые" },
      { id: "кукурузные", label: "Кукурузные" },
      { id: "лавовые", label: "Лавовые" },
      { id: "ледяные", label: "Ледяные" },
      { id: "песчаные", label: "Песчаные" },
      { id: "радужные", label: "Радужные" },
      { id: "синие равнины", label: "Синие равнины" },
      { id: "хеллоуинские", label: "Хеллоуинские" },
      { id: "прочее", label: "Прочее" },
    ];

    tabs.forEach((t) => {
      const count = counts[t.id] || 0;
      if (count === 0 && t.id !== "all") return;

      const btn = document.createElement("button");
      btn.className = `cat-tab ${t.id === currentCategory ? "active" : ""}`;
      btn.innerHTML = `<span>${t.label}</span><span class="cat-count">${count}</span>`;
      btn.addEventListener("click", () => {
        document.querySelectorAll(".cat-tab").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        currentCategory = t.id;
        currentPage = 1;
        applyFilters();
      });
      catNav.appendChild(btn);
    });
  }

  function applyFilters() {
    filteredCards = allCards.filter((c) => {
      const catMatch =
        currentCategory === "all" ||
        (currentCategory === "teamwork" &&
          c.data &&
          (c.data.typeCategory === "teamwork" || c.data.orientation === "landscape")) ||
        c.category === currentCategory ||
        c.subcategory === currentCategory;

      if (!catMatch) return false;

      if (onlyUnverified && userVerified[c.id]) {
        return false;
      }

      if (searchQuery) {
        const d = c.data || {};
        const q = searchQuery.toLowerCase();
        const nRu = (d.name || "").toLowerCase();
        const nEn = (d.name_en || "").toLowerCase();
        const desc = (d.description || "").toLowerCase();
        const type = (d.type || "").toLowerCase();
        const file = (c.filename || "").toLowerCase();
        return nRu.includes(q) || nEn.includes(q) || desc.includes(q) || type.includes(q) || file.includes(q);
      }

      return true;
    });

    renderGrid();
  }

  function renderGrid() {
    cardsGrid.innerHTML = "";
    const start = (currentPage - 1) * pageSize;
    const pageItems = filteredCards.slice(start, start + pageSize);

    if (pageItems.length === 0) {
      cardsGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 40px;">Карты не найдены</div>`;
      paginationBar.innerHTML = "";
      return;
    }

    pageItems.forEach((c, idx) => {
      const d = c.data || {};
      const isVer = !!userVerified[c.id];
      const item = document.createElement("div");
      item.className = "card-item";

      const costBadge = d.cost != null ? `<span class="stat-badge badge-cost">${d.cost}</span>` : "";
      const atkBadge = d.attack != null ? `<span class="stat-badge badge-atk">⚔ ${d.attack}</span>` : "";
      const defBadge = d.defense != null ? `<span class="stat-badge badge-def">🛡 ${d.defense}</span>` : "";
      const imgHash = d.sha256 ? `?h=${d.sha256.substring(0, 10)}` : "";

      item.innerHTML = `
        <div class="card-thumb-wrap">
          <img class="card-thumb" src="/img/${encodeURI(c.rel_img)}${imgHash}" loading="lazy" alt="${d.name || c.id}">
          ${isVer ? `<span class="verified-indicator">✓</span>` : ""}
          <div class="card-stats-badges">${costBadge}${atkBadge}${defBadge}</div>
        </div>
        <div class="card-info">
          <div class="card-name" title="${d.name || c.id}">${d.name || c.id}</div>
          <div class="card-en">${d.name_en || ""}</div>
          <div class="card-type">${d.type || d.typeCategory || ""}</div>
        </div>
      `;

      item.addEventListener("click", () => {
        openModal(start + idx);
      });

      cardsGrid.appendChild(item);
    });

    renderPagination();
  }

  function renderPagination() {
    paginationBar.innerHTML = "";
    const totalPages = Math.ceil(filteredCards.length / pageSize);
    if (totalPages <= 1) return;

    const prev = document.createElement("button");
    prev.className = "page-btn";
    prev.textContent = "«";
    prev.disabled = currentPage === 1;
    prev.addEventListener("click", () => {
      if (currentPage > 1) {
        currentPage--;
        renderGrid();
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
    paginationBar.appendChild(prev);

    for (let p = 1; p <= totalPages; p++) {
      if (p === 1 || p === totalPages || (p >= currentPage - 2 && p <= currentPage + 2)) {
        const b = document.createElement("button");
        b.className = `page-btn ${p === currentPage ? "active" : ""}`;
        b.textContent = p;
        b.addEventListener("click", () => {
          currentPage = p;
          renderGrid();
          window.scrollTo({ top: 0, behavior: "smooth" });
        });
        paginationBar.appendChild(b);
      } else if (p === currentPage - 3 || p === currentPage + 3) {
        const dot = document.createElement("span");
        dot.textContent = "...";
        dot.style.color = "var(--text-muted)";
        paginationBar.appendChild(dot);
      }
    }

    const next = document.createElement("button");
    next.className = "page-btn";
    next.textContent = "»";
    next.disabled = currentPage === totalPages;
    next.addEventListener("click", () => {
      if (currentPage < totalPages) {
        currentPage++;
        renderGrid();
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
    paginationBar.appendChild(next);
  }

  function openModal(index) {
    if (index < 0 || index >= filteredCards.length) return;
    activeCardIndex = index;
    const card = filteredCards[activeCardIndex];
    const d = card.data || {};

    modalTitle.textContent = d.name || card.id;
    modalSubtitle.textContent = d.name_en ? `${d.name_en} · [${card.category}${card.subcategory ? "/" + card.subcategory : ""}]` : `[${card.category}]`;
    const imgHash = d.sha256 ? `?h=${d.sha256.substring(0, 10)}` : "";
    modalImg.src = `/img/${encodeURI(card.rel_img)}${imgHash}`;
    metaFile.textContent = card.filename;
    metaSha.textContent = `SHA256: ${d.sha256 ? d.sha256.substring(0, 16) + "..." : "none"}`;
    navCounter.textContent = `${activeCardIndex + 1} / ${filteredCards.length}`;

    modalVerified.checked = !!userVerified[card.id];

    // Populate Form
    fName.value = d.name || "";
    fNameEn.value = d.name_en || "";
    fCost.value = d.cost != null ? d.cost : "";
    fAttack.value = d.attack != null ? d.attack : "";
    fDefense.value = d.defense != null ? d.defense : "";
    fLand.value = d.landType || d.land_type || "";
    fType.value = d.type || "";
    fCategory.value = d.typeCategory || "creature";
    fSet.value = d.set_code || "";
    fDescription.value = d.description || "";
    fFlavor.value = d.flavor || "";

    rawJson.textContent = JSON.stringify(d, null, 2);
    saveStatus.textContent = "";

    resetScanTransform();
    modal.classList.remove("hidden");
  }

  function closeModal() {
    modal.classList.add("hidden");
  }

  function resetScanTransform() {
    zoomLevel = 1.0;
    rotation = 0;
    updateScanTransform();
  }

  function updateScanTransform() {
    modalImg.style.transform = `scale(${zoomLevel}) rotate(${rotation}deg)`;
  }

  // Zoom / Rotate listeners
  zoomInBtn.addEventListener("click", () => { zoomLevel = Math.min(3.0, zoomLevel + 0.25); updateScanTransform(); });
  zoomOutBtn.addEventListener("click", () => { zoomLevel = Math.max(0.5, zoomLevel - 0.25); updateScanTransform(); });
  zoomResetBtn.addEventListener("click", resetScanTransform);
  rotateBtn.addEventListener("click", () => { rotation = (rotation + 90) % 360; updateScanTransform(); });

  // Navigation
  prevCardBtn.addEventListener("click", () => {
    if (activeCardIndex > 0) openModal(activeCardIndex - 1);
  });
  nextCardBtn.addEventListener("click", () => {
    if (activeCardIndex < filteredCards.length - 1) openModal(activeCardIndex + 1);
  });
  closeModalBtn.addEventListener("click", closeModal);
  modalBackdrop.addEventListener("click", closeModal);

  // Toggle Verified
  modalVerified.addEventListener("change", async () => {
    if (activeCardIndex < 0) return;
    const card = filteredCards[activeCardIndex];
    const isChecked = modalVerified.checked;
    userVerified[card.id] = isChecked;

    try {
      await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: card.id, verified: isChecked }),
      });
      updateStats();
      renderGrid();
    } catch (e) {
      showToast("Ошибка сохранения статуса проверки");
    }
  });

  // Save Form
  cardForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (activeCardIndex < 0) return;
    const card = filteredCards[activeCardIndex];

    const updatedData = {
      ...card.data,
      name: fName.value.trim(),
      name_en: fNameEn.value.trim(),
      cost: fCost.value !== "" ? parseInt(fCost.value, 10) : null,
      attack: fAttack.value !== "" ? parseInt(fAttack.value, 10) : null,
      defense: fDefense.value !== "" ? parseInt(fDefense.value, 10) : null,
      landType: fLand.value.trim(),
      type: fType.value.trim(),
      typeCategory: fCategory.value,
      set_code: fSet.value.trim() || null,
      description: fDescription.value,
      flavor: fFlavor.value,
    };

    saveStatus.textContent = "Сохранение...";
    try {
      const resp = await fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rel_json: card.rel_json, data: updatedData }),
      });
      const res = await resp.json();
      if (res.status === "saved") {
        card.data = updatedData;
        rawJson.textContent = JSON.stringify(updatedData, null, 2);
        saveStatus.textContent = "✓ Сохранено!";
        showToast("Изменения записаны на диск!");
        renderGrid();
      } else {
        saveStatus.textContent = "Ошибка: " + res.error;
      }
    } catch (err) {
      saveStatus.textContent = "Ошибка: " + err.message;
    }
  });

  // Tab switching inside modal
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      if (tab === "form") {
        cardForm.classList.remove("hidden");
        document.getElementById("json-tab").classList.add("hidden");
      } else {
        cardForm.classList.add("hidden");
        document.getElementById("json-tab").classList.remove("hidden");
      }
    });
  });

  // Search
  searchInput.addEventListener("input", () => {
    searchQuery = searchInput.value.trim();
    clearSearchBtn.classList.toggle("hidden", !searchQuery);
    currentPage = 1;
    applyFilters();
  });
  clearSearchBtn.addEventListener("click", () => {
    searchInput.value = "";
    searchQuery = "";
    clearSearchBtn.classList.add("hidden");
    currentPage = 1;
    applyFilters();
  });

  filterUnverifiedCheckbox.addEventListener("change", () => {
    onlyUnverified = filterUnverifiedCheckbox.checked;
    currentPage = 1;
    applyFilters();
  });

  // Keyboard Shortcuts
  window.addEventListener("keydown", (e) => {
    if (modal.classList.contains("hidden")) return;
    if (["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) return;

    if (e.key === "ArrowLeft") {
      if (activeCardIndex > 0) openModal(activeCardIndex - 1);
    } else if (e.key === "ArrowRight") {
      if (activeCardIndex < filteredCards.length - 1) openModal(activeCardIndex + 1);
    } else if (e.key === "Escape") {
      closeModal();
    } else if (e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      modalVerified.checked = !modalVerified.checked;
      modalVerified.dispatchEvent(new Event("change"));
    } else if (e.key === "r" || e.key === "R" || e.key === "к" || e.key === "К") {
      rotation = (rotation + 90) % 360;
      updateScanTransform();
    }
  });

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.remove("hidden");
    setTimeout(() => toast.classList.add("hidden"), 3000);
  }

  init();
})();
