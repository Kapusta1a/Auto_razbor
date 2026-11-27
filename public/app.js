const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

const $ = (id) => document.getElementById(id);
const API_BASE_URL = (() => {
  let value = String(window.AUTO_RAZBOR_API_BASE || "").trim();
  while (value.endsWith("/")) value = value.slice(0, -1);
  return value;
})();
const apiUrl = (path) => API_BASE_URL ? `${API_BASE_URL}${path}` : path;
let catalog = { brands: [] };
let activeBrand = null;
let activeModel = null;
let favorites = new Set(JSON.parse(localStorage.getItem("ar-favorites") || "[]"));
const brandLogoCache = new Map();

function setTelegramProfile(user) {
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(" ") || user?.username || "Гость";
  $("profileName").textContent = name;
  $("profileTitle").textContent = user?.first_name ? "Профиль" : "Профиль гостя";
  const initials = name === "Гость" ? "?" : name.trim().split(/\\s+/).slice(0,2).map(part => part[0]).join("").toUpperCase();
  ["profileAvatar","profileAvatarLarge"].forEach(id => {
    const host = $(id);
    if (!host) return;
    host.textContent = initials;
    if (user?.photo_url) {
      const img = document.createElement("img");
      img.src = user.photo_url;
      img.alt = "Фото профиля Telegram";
      img.referrerPolicy = "no-referrer";
      host.replaceChildren(img);
    }
  });
}
function openProfile() { $("profileOverlay").hidden = false; document.body.classList.add("profile-open"); }
function closeProfile() { $("profileOverlay").hidden = true; document.body.classList.remove("profile-open"); }

async function init() {
  try {
    let response = await fetch(apiUrl("/api/catalog"));
    if (!response.ok && !API_BASE_URL) response = await fetch("./catalog.json");
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
        const auth = await fetch(apiUrl("/api/telegram/auth"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ initData })
        });
        if (auth.ok) {
          const result = await auth.json();
          setTelegramProfile({ ...(tg?.initDataUnsafe?.user || {}), ...(result.user || {}) });
        } else setTelegramProfile(tg?.initDataUnsafe?.user);
      } catch { setTelegramProfile(tg?.initDataUnsafe?.user); }
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
      <button class="model-card model-card-rich" data-model="${escapeHtml(model.id)}">
        <span class="model-card-image">${model.generations.find(gen => gen.images?.length)?.images?.[0] ? `<img src="${safeUrl(model.generations.find(gen => gen.images?.length).images[0].url)}" alt="${escapeHtml(activeBrand.name + " " + model.name)}" loading="lazy">` : `<span class="model-image-placeholder"><b>${escapeHtml(monogram(model.name))}</b></span>`}</span>
        <span class="model-card-copy"><b>${escapeHtml(model.name)}</b><small>${model.generations.length} поколений</small><span class="model-years">${escapeHtml(yearRange(model.generations))}</span><span class="model-card-link">Смотреть модель <span aria-hidden="true">↗</span></span></span>
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
  $("details").querySelectorAll(".model-card-rich").forEach((card, index) => {
    const model = activeBrand.models[index];
    if (model && !model.generations.some(gen => gen.images?.length)) {
      loadCommonsPhoto(card, activeBrand.name, model.name, {code:"", years:yearRange(model.generations)});
    }
  });
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
      <p class="model-summary">Выбери поколение, чтобы посмотреть фотографии, характеристики и подробный разбор.</p>
      <div class="generation-list">${activeModel.generations.map((gen, index) => {
        const photo = gen.images?.[0];
        return `
        <button type="button" class="generation-card generation-card-rich generation-open" data-generation="${escapeHtml(gen.id)}">
          <span class="generation-card-image">${photo ? `<img src="${safeUrl(photo.url)}" alt="${escapeHtml(photo.caption || activeModel.name + " " + gen.code)}" loading="lazy">` : `<span class="generation-image-placeholder"><b>${escapeHtml(gen.code)}</b><small>AUTO_RAZBOR</small></span>`}</span>
          <span class="generation-info">
            <span class="generation-card-kicker">ПОКОЛЕНИЕ ${String(index + 1).padStart(2, "0")}</span>
            <b>${escapeHtml(activeModel.name)} · ${escapeHtml(gen.code)}</b>
            <span class="generation-years">${escapeHtml(gen.years)}</span>
            <small>${escapeHtml((gen.markets || []).join(" · ") || "Рынки уточняются")}</small>
            <span class="generation-card-link">Открыть карточку <span aria-hidden="true">↗</span></span>
          </span>
        </button>`;
      }).join("")}</div>
      <p class="data-note">Характеристики зависят от рынка, года выпуска и комплектации. Для точного подбора запчастей сверяйте VIN и код двигателя.</p>
    </section>`;
  $("favoriteBtn").addEventListener("click", toggleFavorite);
  $("details").querySelectorAll("[data-generation]").forEach(button =>
    button.addEventListener("click", event => { if (!event.target.closest("a")) { const params = new URLSearchParams({ brand: activeBrand.id, model: activeModel.id, generation: button.dataset.generation }); window.location.href = "./generation.html?" + params.toString(); } })
  );
  $("details").querySelectorAll(".generation-card-rich").forEach((card, index) => {
    const gen = activeModel.generations[index];
    if (gen && !gen.images?.length) loadCommonsPhoto(card, activeBrand.name, activeModel.name, gen);
  });
}

function showGeneration(generationId) {
  const gen = activeModel?.generations.find(item => item.id === generationId);
  if (!gen) return;
  const photos = (gen.images || []).map(photo => `
    <figure class="generation-photo"><img src="${safeUrl(photo.url)}" alt="${escapeHtml(photo.caption || activeModel.name + " " + gen.code)}"><figcaption>Фото: <a href="${safeUrl(photo.sourceUrl)}" target="_blank" rel="noopener">источник</a> · ${escapeHtml(photo.author || "")} · ${escapeHtml(photo.license || "")}</figcaption></figure>`).join("");
  const specs = (gen.specifications || []).map(spec => `
    <section class="spec-card"><b>${escapeHtml(spec.variant)}</b><small>${escapeHtml(spec.market)}</small><dl>${[["Двигатель",spec.engine],["Объём",spec.displacement],["Топливо",spec.fuel],["Мощность",spec.power],["Крутящий момент",spec.torque],["КПП",spec.transmission],["Привод",spec.drivetrain]].filter(pair=>pair[1]).map(pair=>`<div><dt>${pair[0]}</dt><dd>${escapeHtml(pair[1])}</dd></div>`).join("")}</dl><a class="spec-source" href="${safeUrl(spec.source)}" target="_blank" rel="noopener">${escapeHtml(spec.sourceLabel || "Источник данных")}</a></section>`).join("");
  const premium = gen.premiumContent || {};
  const hasPremium = ["weaknesses","bestEngines","worstEngines","pros","cons","buyingTips"].some(key => Array.isArray(premium[key]) && premium[key].length);
  const premiumBlock = hasPremium ? `
    <div class="premium-content">
      ${premiumSection("Типичные болячки", premium.weaknesses)}
      ${premiumSection("Лучшие моторы", premium.bestEngines)}
      ${premiumSection("Моторы, к которым стоит присмотреться с осторожностью", premium.worstEngines)}
      ${premiumSection("Плюсы поколения", premium.pros)}
      ${premiumSection("Минусы поколения", premium.cons)}
      ${premiumSection("Что проверить перед покупкой", premium.buyingTips)}
      <small>Материалы должны проверяться по конкретному рынку, мотору и году выпуска.</small>
    </div>` : `
    <div class="premium-lock">
      <div class="lock-icon">✦</div><h3>Полный разбор поколения — в подписке</h3>
      <p>Типичные неисправности, ресурс узлов, лучшие и проблемные моторы, плюсы и минусы, чек-лист осмотра и советы перед покупкой.</p>
      <button type="button" class="subscribe-cta" data-subscriptions>Посмотреть подписки</button>
      <small>Экспертные материалы для этого поколения ещё готовятся. Не будем выдавать непроверенные советы за факты.</small>
    </div>`;
  $("modelDetails").innerHTML = `
    <section class="generation-page">
      <button type="button" class="back" id="backToModel">← Назад к поколениям</button>
      <p class="detail-kicker">КАРТОЧКА ПОКОЛЕНИЯ</p>
      <h3>${escapeHtml(activeBrand.name)} ${escapeHtml(activeModel.name)} · ${escapeHtml(gen.code)}</h3>
      <p class="generation-years">${escapeHtml(gen.years)} · ${escapeHtml((gen.markets || []).join(", "))}</p>
      <div class="generation-gallery">${photos}<div id="generationPhotoLookup"></div></div>
      <h4>Характеристики</h4>
      ${specs || '<p class="pending-data">Подтверждённые характеристики для этого поколения пока добавляются. <a href="' + safeUrl(gen.researchUrl) + '" target="_blank" rel="noopener">Открыть источники для проверки ↗</a></p>'}
      <p class="data-note">Параметры зависят от рынка и комплектации. Проверяйте VIN и код двигателя.</p>
      <h4>Подробный разбор</h4>
      ${premiumBlock}
    </section>`;
  $("backToModel").addEventListener("click", () => showModel(activeModel.id));
  $("modelDetails").querySelector("[data-subscriptions]")?.addEventListener("click", () => {
    openProfile();
  });
  if (!gen.images?.length) loadCommonsPhoto($("generationPhotoLookup"), activeBrand.name, activeModel.name, gen);
  $("modelDetails").scrollIntoView({behavior:"smooth",block:"start"});
}

function premiumSection(title, items) {
  if (!Array.isArray(items) || !items.length) return "";
  return `<section class="premium-section"><h4>${title}</h4><ul>${items.map(item=>`<li>${escapeHtml(item)}</li>`).join("")}</ul></section>`;
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
    try {
      // Use Wikidata logo property (P154), never a general image search.
      const search = new URL("https://www.wikidata.org/w/api.php");
      search.search = new URLSearchParams({action:"wbsearchentities",search:brand.name,language:"en",format:"json",origin:"*"}).toString();
      const sr = await fetch(search.toString()); if (!sr.ok) return null;
      const hits = (await sr.json()).search || [];
      let filename = "";
      for (const hit of hits.slice(0, 5)) {
        const entityUrl = new URL("https://www.wikidata.org/w/api.php");
        entityUrl.search = new URLSearchParams({action:"wbgetentities",ids:hit.id,props:"claims",format:"json",origin:"*"}).toString();
        const er = await fetch(entityUrl.toString()); if (!er.ok) continue;
        const entity = (await er.json()).entities?.[hit.id];
        const claim = entity?.claims?.P154?.[0]?.mainsnak?.datavalue?.value;
        if (claim && typeof claim === "string") { filename = claim; break; }
      }
      if (!filename) return null;
      const commons = new URL("https://commons.wikimedia.org/w/api.php");
      commons.search = new URLSearchParams({action:"query",titles:"File:"+filename,prop:"imageinfo",iiprop:"url|extmetadata",iiurlwidth:"240",format:"json",origin:"*"}).toString();
      const cr = await fetch(commons.toString()); if (!cr.ok) return null;
      const pages = Object.values((await cr.json()).query?.pages || {});
      const page = pages.find(item => item.imageinfo?.[0]); if (!page) return null;
      const info = page.imageinfo[0], meta = info.extmetadata || {};
      const clean = key => String(meta[key]?.value || "").replace(/<[^>]*>/g, "").trim();
      const license = clean("LicenseShortName") || clean("UsageTerms") || "";
      const licenseKey = license.toLowerCase();
      const acceptable = /public domain|pd-textlogo|pd-ineligible|cc by|cc-by|cc by-sa|cc-by-sa|creative commons/i.test(licenseKey);
      if (!acceptable || !(info.thumburl || info.url)) return null;
      return {url:info.thumburl || info.url,sourceUrl:info.descriptionurl,license:license,licenseUrl:clean("LicenseUrl"),artist:clean("Artist") || clean("Credit") || "Сведения об авторе — на странице файла"};
    } catch { return null; }
  })();
  brandLogoCache.set(brand.id, task); return task;
}

function monogram(name) { return String(name).replace(/[^A-Za-zА-Яа-я0-9]/g, "").slice(0, 2).toUpperCase(); }
async function loadCommonsPhoto(card, brandName, modelName, gen) {
  const host = card.querySelector(".generation-card-image, .model-card-image");
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
    if (!candidate || !card.isConnected) return;
    const info = candidate.imageinfo[0], meta = info.extmetadata || {};
    const value = key => String(meta[key]?.value || "").replace(/<[^>]*>/g, "").trim();
    const license = value("LicenseShortName") || value("UsageTerms");
    const artist = value("Artist") || value("Credit") || "Автор указан на странице файла";
    const img = document.createElement("img");
    img.src = info.thumburl || info.url;
    img.alt = [brandName, modelName, gen.code].filter(Boolean).join(" ");
    img.loading = "lazy";
    img.title = "Фото: " + artist + " · Лицензия: " + license + " · Источник: Wikimedia Commons";
    host.replaceChildren(img);
  } catch {
    // Keep the neutral placeholder if a licensed photo cannot be verified.
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

$("profileButton").addEventListener("click", openProfile);
$("closeProfile").addEventListener("click", closeProfile);
$("profileOverlay").addEventListener("click", event => { if (event.target === $("profileOverlay")) closeProfile(); });
document.addEventListener("keydown", event => { if (event.key === "Escape") closeProfile(); });

$("search").addEventListener("input", () => {
  closeDetails();
  renderBrands();
});
document.querySelectorAll("[data-buy-plan]").forEach(button => {
  button.addEventListener("click", () => {
    const note = $("paymentNote");
    if (note) note.textContent = "Тариф выбран: " + button.dataset.buyPlan + ". Приём оплаты ещё не подключён — деньги не списываются. Следующим шагом настроим оплату Telegram Stars и автоматическую выдачу доступа.";
    $("paymentNote").scrollIntoView({behavior:"smooth",block:"nearest"});
  });
});
setTelegramProfile(tg?.initDataUnsafe?.user);
init();


const upcomingTabs = {
  news: {title:"Автомобильные новости",description:"Новинки автопрома, премьеры, рестайлинги, новые двигатели и новости автомобильного рынка — готовим для тебя."},
  photos: {title:"Фотогалерея",description:"Красивые автомобильные фотографии, подборки, обои и снимки машин пользователей появятся здесь."},
  video: {title:"Видео",description:"Обзоры, тест-драйвы, проекты владельцев и автомобильные видео появятся в этом разделе."},
  events: {title:"Автособытия",description:"Выставки, встречи, концерты, дрифт и соревнования — скоро здесь появится календарь мероприятий."}
};
function activateMainTab(tab) {
  document.querySelectorAll("[data-main-tab]").forEach(button => button.classList.toggle("is-active", button.dataset.mainTab === tab));
  const isCatalog = tab === "catalog" || tab === "profile";
  $("heroSection").hidden = !isCatalog;
  $("catalogView").hidden = !isCatalog;
  $("comingSoonView").hidden = isCatalog;
  if (tab === "profile") {
    document.querySelector('[data-main-tab="catalog"]').classList.remove("is-active");
    document.querySelector('[data-main-tab="profile"]').classList.add("is-active");
    openProfile();
    return;
  }
  if (tab === "catalog") {
    window.scrollTo({top:0,behavior:"smooth"});
    return;
  }
  const section = upcomingTabs[tab];
  if (section) {
    $("comingSoonTitle").textContent = section.title;
    $("comingSoonDescription").textContent = section.description;
    window.scrollTo({top:0,behavior:"smooth"});
  }
}
document.querySelectorAll("[data-main-tab]").forEach(button => {
  button.addEventListener("click", () => activateMainTab(button.dataset.mainTab));
});
