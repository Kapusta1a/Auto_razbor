const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }
const $ = (id) => document.getElementById(id);
let catalog = { brands: [] };
let currentBrand = null;

async function init() {
  try {
    let response = await fetch("/api/catalog");
    if (!response.ok) response = await fetch("./catalog.json");
    if (!response.ok) throw new Error("catalog");
    catalog = await response.json();
    $("count").textContent = catalog.brands.length + " марок";
    renderBrands();
    const initData = tg?.initData;
    if (initData) {
      const auth = await fetch("/api/telegram/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData }) });
      if (auth.ok) {
        const result = await auth.json();
        $("account").textContent = result.user.first_name || "ПОЛЬЗОВАТЕЛЬ";
      } else $("account").textContent = "НЕ АВТОРИЗОВАН";
    }
  } catch {
    $("catalog").innerHTML = '<p class="loading">Не удалось загрузить каталог. Попробуйте обновить приложение.</p>';
  }
}
function renderBrands(filter = "") {
  const q = filter.trim().toLowerCase();
  const brands = catalog.brands.filter(b => (b.name + " " + b.country).toLowerCase().includes(q) || b.models.some(m => m.name.toLowerCase().includes(q)));
  $("catalog").innerHTML = brands.map(b => `<button class="brand-card" data-brand="${escapeHtml(b.id)}"><b>${escapeHtml(b.name)}</b><small>${b.models.length} моделей · ${escapeHtml(b.country)}</small></button>`).join("") || '<p class="loading">Ничего не найдено.</p>';
  $("count").textContent = brands.length + " из " + catalog.brands.length + " марок";
  $("catalog").querySelectorAll("[data-brand]").forEach(btn => btn.addEventListener("click", () => showBrand(btn.dataset.brand)));
}
function showBrand(id) {
  currentBrand = catalog.brands.find(b => b.id === id);
  if (!currentBrand) return;
  $("details").classList.remove("hidden");
  $("details").innerHTML = `<button class="back" id="back">← Все марки</button><p class="eyebrow">МАРКА · ${escapeHtml(currentBrand.country)}</p><h2>${escapeHtml(currentBrand.name)}</h2><div class="model-list">${currentBrand.models.map(m => `<button class="model-card" data-model="${escapeHtml(m.id)}"><b>${escapeHtml(m.name)}</b><small>${m.generations.length} поколений</small></button>`).join("")}</div><div id="modelDetails"></div>`;
  $("back").addEventListener("click", () => { $("details").classList.add("hidden"); currentBrand = null; });
  $("details").querySelectorAll("[data-model]").forEach(btn => btn.addEventListener("click", () => showModel(btn.dataset.model)));
  $("details").scrollIntoView({ behavior: "smooth", block: "start" });
}
function showModel(id) {
  const model = currentBrand.models.find(m => m.id === id);
  if (!model) return;
  $("modelDetails").innerHTML = `<h3>${escapeHtml(model.name)} — поколения</h3>${model.generations.map(g => `<div class="generation"><b>${escapeHtml(g.code)}</b><small>${escapeHtml(g.years)} · ${escapeHtml((g.markets || []).join(", "))}</small></div>`).join("")}`;
}
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c])); }
$("search").addEventListener("input", e => renderBrands(e.target.value));
init();
