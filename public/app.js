const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

const $ = (id) => document.getElementById(id);
let catalog = { brands: [] };
let activeBrand = null;
let activeModel = null;
let favorites = new Set(JSON.parse(localStorage.getItem("ar-favorites") || "[]"));
const brandLogoCache = new Map();

async function init() {
  try {
    let response = await fetch("/api/catalog");
    if (!response.ok) response = await fetch("./catalog.json");
    if (!response.ok) throw new Error("catalog");
    catalog = await response.json();
    const stats = catalog.brands.reduce((a, b) => {
      a.models += b.models.length;
      a.generations += b.models.reduce((n, m) => n + m.generations.length, 0);
      return a;
    }, { models: 0, generations: 0 });
    $("count").textContent = `${catalog.brands.length} марок · ${stats.models} моделей · ${stats.generations} поколений`;
    renderBrands();
    const initData = tg?.initData;
    if (initData) {
      try {
        const auth = await fetch("/api/telegram/auth", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ initData })
        });
        if (auth.ok) {
          const result = await auth.json();
          $("account").textContent = result.user.first_name || "ПОЛЬЗОВАТЕЛЬ";
        } else $("account").textContent = "ГОСТЬ";
      } catch { $("account").textContent = "ГОСТЬ"; }
    }
  } catch {
    $("catalog").innerHTML = '<p class="loading">Не удалось загрузить каталог. Попробуйте обновить приложение.</p>';
  }
}

function allModels() {
  return catalog.brands.flatMap(brand => brand.models.map(model => ({ brand, model })));
}

function renderBrands(filter = $("search").value) {
  const q = filter.trim().toLocaleLowerCase("ru");
  const matches = catalog.brands.filter(brand => {
    const haystack = [brand.name, brand.country, ...brand.models.flatMap(model =>
      [model.name, ...model.generations.flatMap(gen => [gen.code, gen.years, ...(gen.markets || [])])]
    )].join(" ").toLocaleLowerCase("ru");
    return haystack.includes(q);
  });
  $("catalog").innerHTML = matches.map(brand => `
    <button class="brand-card" data-brand="${escapeHtml(brand.id)}">
      <span class="brand-monogram">${escapeHtml(monogram(brand.name))}</span>
      <span class="card-copy"><b>${escapeHtml(brand.name)}</b><small>${brand.models.length} моделей · ${escapeHtml(brand.country)}</small></span>
      <span class="card-arrow">↗</span>
    </button>`).join("") || '<p class="loading">Ничего не найдено. Попробуйте другую марку, модель или код поколения.</p>';
    $("catalog").querySelectorAll("[data-brand]").forEach(btn => {
    btn.addEventListener("click", () => showBrand(btn.dataset.brand));
    const brand = catalog.brands.find(item => item.id === btn.dataset.brand);
    if (brand) loadBrandLogo(brand).then(logo => {
      if (!logo || !btn.isConnected) return;
      const mark = btn.querySelector(".brand-monogram");
      if (mark) mark.innerHTML = '<img class="brand-logo-img" src="' + safeUrl(logo.url) + '" alt="' + escapeHtml(brand.name) + ' логотип" loading="lazy">';
      btn.title = "Логотип: " + logo.license + " · " + logo.artist + " · Источник: Wikimedia Commons";
      const small = btn.querySelector(".card-copy small");
      if (small) small.textContent = brand.models.length + " моделей · " + brand.country + " · логотип: " + logo.license;
    });
  });
  $("count").textContent = q ? `${matches.length} марок найдено` : `${catalog.brands.length} марок`;
}

function showBrand(id) {
  activeBrand = catalog.brands.find(brand => brand.id === id);
  activeModel = null;
  if (!activeBrand) return;
  $("details").classList.remove("hidden");
  $("details").innerHTML = `
    <button class="back" id="backBrands">← Все марки</button>
    <div class="detail-kicker">МАРКА · ${escapeHtml(activeBrand.country)}</div>
    <div class="detail-heading"><div><h2>${escapeHtml(activeBrand.name)}</h2><p>${activeBrand.models.length} моделей в каталоге</p><p id="brandLogoCredit" class="brand-logo-credit">Поиск логотипа с указанием лицензии…</p></div><span class="detail-monogram" id="brandDetailLogo">${escapeHtml(monogram(activeBrand.name))}</span></div>
    <div class="model-list">${activeBrand.models.map(model => `
      <button class="model-card" data-model="${escapeHtml(model.id)}">
        <b>${escapeHtml(model.name)}</b>
        <small>${model.generations.length} поколений</small>
        <span class="model-years">${escapeHtml(yearRange(model.generations))}</span>
      </button>`).join("")}</div>
    <div id="modelDetails"></div>`;
  $("backBrands").addEventListener("click", closeDetails);
  loadBrandLogo(activeBrand).then(logo => {
    const mark = $("brandDetailLogo"), credit = $("brandLogoCredit");
    if (!logo || !mark || !credit) return;
    mark.innerHTML = '<img class="brand-logo-img detail-brand-logo" src="' + safeUrl(logo.url) + '" alt="' + escapeHtml(activeBrand.name) + ' логотип">';
    credit.innerHTML = 'Логотип: <a href="' + safeUrl(logo.sourceUrl) + '" target="_blank" rel="noopener">источник</a> · ' + escapeHtml(logo.license) + ' · ' + escapeHtml(logo.artist) + (logo.licenseUrl ? ' · <a href="' + safeUrl(logo.licenseUrl) + '" target="_blank" rel="noopener">условия лицензии</a>' : "");
  });
  $("details").querySelectorAll("[data-model]").forEach(btn =>
    btn.addEventListener("click", () => showModel(btn.dataset.model))
  );
  $("details").scrollIntoView({ behavior: "smooth", block: "start" });
}

function showModel(id) {
  activeModel = activeBrand?.models.find(model => model.id === id);
  if (!activeModel) return;
  const isFavorite = favorites.has(activeModel.id);
  $("modelDetails").innerHTML = `
    <section class="model-detail">
      <div class="model-detail-top">
        <div><p class="detail-kicker">КАРТОЧКА МОДЕЛИ</p><h3>${escapeHtml(activeBrand.name)} ${escapeHtml(activeModel.name)}</h3></div>
        <button class="favorite-btn ${isFavorite ? "is-favorite" : ""}" id="favoriteBtn" aria-label="Добавить в избранное">${isFavorite ? "★ В избранном" : "☆ В избранное"}</button>
      </div>
      <p class="model-summary">Поколения и обозначения кузова, представленные в каталоге AUTO_RAZBOR.</p>
      <div class="generation-list">${activeModel.generations.map((gen, index) => `
        <article class="generation-card generation-card-rich">
          <div class="generation-number">${String(index + 1).padStart(2, "0")}</div>
          <div class="generation-info">
            <b>${escapeHtml(gen.code)}</b>
            <span class="generation-years">${escapeHtml(gen.years)}</span>
            <small>Рынки: ${escapeHtml((gen.markets || []).join(", ") || "не указаны")}</small>
            ${gen.images?.length ? gen.images.map(photo => `
              <figure class="generation-photo">
                <img src="${safeUrl(photo.url)}" alt="${escapeHtml(photo.caption || (activeModel.name + " " + gen.code))}" loading="lazy">
                <figcaption>Фото: <a href="${safeUrl(photo.sourceUrl)}" target="_blank" rel="noopener">источник</a> · ${escapeHtml(photo.author)} · <a href="${safeUrl(photo.licenseUrl)}" target="_blank" rel="noopener">${escapeHtml(photo.license)}</a></figcaption>
              </figure>`).join("") : ""}
            ${gen.specifications?.length ? `
              <div class="spec-list"><b class="spec-heading">Характеристики по рынкам и версиям</b>
                ${gen.specifications.map(spec => `
                  <section class="spec-card">
                    <b>${escapeHtml(spec.variant)}</b><small>${escapeHtml(spec.market)}</small>
                    <dl>
                      ${[["Двигатель",spec.engine],["Объём",spec.displacement],["Топливо",spec.fuel],["Мощность",spec.power],["Крутящий момент",spec.torque],["КПП",spec.transmission],["Привод",spec.drivetrain]].filter(pair=>pair[1]).map(pair=>`<div><dt>${pair[0]}</dt><dd>${escapeHtml(pair[1])}</dd></div>`).join("")}
                    </dl>
                    <a class="spec-source" href="${safeUrl(spec.source)}" target="_blank" rel="noopener">${escapeHtml(spec.sourceLabel || "Источник данных")}</a>
                  </section>`).join("")}
              </div>` : ""}
            ${!gen.images?.length && gen.photoSearchUrl ? `<a class="photo-search" href="${safeUrl(gen.photoSearchUrl)}" target="_blank" rel="noopener">Открыть фотографии поколения ↗</a>` : ""}
            ${!gen.specifications?.length ? `<small class="pending-data">Характеристики ещё не подтверждены. <a href="${safeUrl(gen.researchUrl)}" target="_blank" rel="noopener">Найти технические данные ↗</a></small>` : ""}
          </div>
          <span class="generation-tag">ПОКОЛЕНИЕ</span>
        </article>`).join("")}</div>
      <p class="data-note">Характеристики зависят от рынка, года выпуска и комплектации. В карточку включаются только варианты с указанным источником; для точного подбора запчастей сверяйте VIN и код двигателя.</p>
    </section>`;
  $("favoriteBtn").addEventListener("click", toggleFavorite);
  $("details").querySelectorAll(".generation-card-rich").forEach((card, index) => {
    const gen = activeModel.generations[index];
    if (gen && !gen.images?.length) loadCommonsPhoto(card, activeBrand.name, activeModel.name, gen);
  });
}

function toggleFavorite() {
  if (!activeModel) return;
  if (favorites.has(activeModel.id)) favorites.delete(activeModel.id);
  else favorites.add(activeModel.id);
  localStorage.setItem("ar-favorites", JSON.stringify([...favorites]));
  showModel(activeModel.id);
}

function closeDetails() {
  $("details").classList.add("hidden");
  $("details").innerHTML = "";
  activeBrand = null;
  activeModel = null;
}

function yearRange(generations) {
  if (!generations.length) return "Годы не указаны";
  const years = generations.map(g => g.years).filter(Boolean);
  return years.length ? years[0].split(/[–-]/)[0] + " — " + years[years.length - 1].split(/[–-]/).pop() : "Годы не указаны";
}
async function loadBrandLogo(brand) {
  if (brandLogoCache.has(brand.id)) return brandLogoCache.get(brand.id);
  const task = (async () => {
    const endpoint = new URL("https://commons.wikimedia.org/w/api.php");
    endpoint.search = new URLSearchParams({action:"query",generator:"search",gsrsearch:brand.name+" logo",gsrnamespace:"6",gsrlimit:"12",prop:"imageinfo",iiprop:"url|extmetadata",iiurlwidth:"240",format:"json",origin:"*"}).toString();
    try {
      const response = await fetch(endpoint.toString()); if (!response.ok) return null;
      const payload = await response.json(), brandToken = brand.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      const pages = Object.values(payload.query?.pages || {});
      const candidate = pages.find(page => {
        const title = String(page.title || "").toLowerCase().replace(/[^a-z0-9]/g, ""), info = page.imageinfo?.[0], meta = info?.extmetadata || {};
        const license = meta.LicenseShortName?.value || meta.UsageTerms?.value || "", artist = meta.Artist?.value || meta.Credit?.value || "";
        return title.includes("logo") && title.includes(brandToken) && (info?.thumburl || info?.url) && license && artist && !/unknown|no license|без лицензии/i.test(license);
      });
      if (!candidate) return null;
      const info = candidate.imageinfo[0], meta = info.extmetadata || {}, clean = key => String(meta[key]?.value || "").replace(/<[^>]*>/g, "").trim();
      return {url:info.thumburl || info.url,sourceUrl:info.descriptionurl,license:clean("LicenseShortName") || clean("UsageTerms"),licenseUrl:clean("LicenseUrl"),artist:clean("Artist") || clean("Credit") || "Автор указан на странице файла"};
    } catch { return null; }
  })();
  brandLogoCache.set(brand.id, task); return task;
}
function monogram(name) { return String(name).replace(/[^A-Za-zА-Яа-я0-9]/g, "").slice(0, 2).toUpperCase(); }
async function loadCommonsPhoto(card, brandName, modelName, gen) {
  const host = card.querySelector(".generation-info");
  if (!host || card.dataset.photoLookup === "done") return;
  card.dataset.photoLookup = "done";
  const yearMatch = String(gen.years || "").match(/(?:19|20)\\d{2}/);
  const year = yearMatch ? yearMatch[0] : "";
  const terms = [brandName, modelName, gen.code, year].filter(Boolean).join(" ");
  const endpoint = new URL("https://commons.wikimedia.org/w/api.php");
  endpoint.search = new URLSearchParams({
    action: "query", generator: "search", gsrsearch: terms, gsrnamespace: "6",
    gsrlimit: "8", prop: "imageinfo", iiprop: "url|extmetadata",
    iiurlwidth: "1000", format: "json", origin: "*"
  }).toString();
  try {
    const response = await fetch(endpoint.toString());
    if (!response.ok) throw new Error("Commons API unavailable");
    const payload = await response.json();
    const pages = Object.values(payload.query?.pages || {});
    const candidate = pages.find(page => {
      const meta = page.imageinfo?.[0]?.extmetadata || {};
      const license = meta.LicenseShortName?.value || meta.UsageTerms?.value || "";
      const artist = meta.Artist?.value || meta.Credit?.value || "";
      const url = page.imageinfo?.[0]?.thumburl || page.imageinfo?.[0]?.url;
      return url && license && artist && !/unknown|no license|без лицензии/i.test(license);
    });
    if (!candidate) {
      const note = document.createElement("small");
      note.className = "pending-data";
      note.textContent = "Подходящее фото с подтверждённой лицензией пока не найдено.";
      host.append(note);
      return;
    }
    const info = candidate.imageinfo[0], meta = info.extmetadata || {};
    const value = key => String(meta[key]?.value || "").replace(/<[^>]*>/g, "").trim();
    const license = value("LicenseShortName") || value("UsageTerms");
    const licenseUrl = value("LicenseUrl");
    const artist = value("Artist") || value("Credit") || "Автор указан на странице файла";
    const figure = document.createElement("figure");
    figure.className = "generation-photo";
    const img = document.createElement("img");
    img.src = info.thumburl || info.url;
    img.alt = brandName + " " + modelName + " " + gen.code;
    img.loading = "lazy";
    const caption = document.createElement("figcaption");
    const source = document.createElement("a");
    source.href = info.descriptionurl; source.target = "_blank"; source.rel = "noopener";
    source.textContent = "Страница фотографии";
    caption.append("Источник: ", source, " · Автор: " + artist + " · Лицензия: ");
    if (licenseUrl) {
      const link = document.createElement("a");
      link.href = licenseUrl; link.target = "_blank"; link.rel = "noopener"; link.textContent = license;
      caption.append(link);
    } else caption.append(license);
    figure.append(img, caption);
    const existing = host.querySelector(".generation-photo");
    if (!existing) host.insertBefore(figure, host.querySelector(".spec-list") || host.firstChild.nextSibling);
  } catch (error) {
    const note = document.createElement("small");
    note.className = "pending-data";
    note.textContent = "Не удалось проверить фотографии сейчас. Попробуйте открыть карточку позже.";
    host.append(note);
  }
}

function safeUrl(value) {
  try { const url = new URL(String(value || ""), window.location.href); return ["https:", "http:"].includes(url.protocol) ? url.href : "#"; }
  catch { return "#"; }
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

$("search").addEventListener("input", () => {
  closeDetails();
  renderBrands();
});
init();
