const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }
const root = document.getElementById("generationContent");
const params = new URLSearchParams(location.search);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const safe = value => { try { const u=new URL(String(value||""),location.href); return ["https:","http:"].includes(u.protocol)?u.href:"#"; } catch { return "#"; } };

async function start() {
  try {
    let response = await fetch("/api/catalog");
    if (!response.ok) response = await fetch("./catalog.json");
    if (!response.ok) throw new Error("catalog");
    const catalog = await response.json();
    const brand = catalog.brands.find(x=>x.id===params.get("brand"));
    const model = brand?.models.find(x=>x.id===params.get("model"));
    const gen = model?.generations.find(x=>x.id===params.get("generation"));
    if (!brand || !model || !gen) throw new Error("generation");
    document.title = brand.name+" "+model.name+" "+gen.code+" — AUTO_RAZBOR";
    render(brand,model,gen);
    if (!gen.images?.length) loadCommonsPhoto(brand.name,model.name,gen);
  } catch {
    root.innerHTML = '<a class="back" href="./index.html">← Вернуться в каталог</a><p class="pending-data">Не удалось найти это поколение. Вернитесь в каталог и откройте карточку ещё раз.</p>';
  }
}

function render(brand,model,gen) {
  const photos=(gen.images||[]).map(p=>photoMarkup(p,model,gen)).join("");
  const specs=(gen.specifications||[]).map(s=>`
    <section class="spec-card"><b>${esc(s.variant)}</b><small>${esc(s.market)}</small><dl>
      ${[["Двигатель",s.engine],["Объём",s.displacement],["Топливо",s.fuel],["Мощность",s.power],["Крутящий момент",s.torque],["КПП",s.transmission],["Привод",s.drivetrain],["Максимальная скорость",s.topSpeed],["Разгон 0–100 км/ч",s.acceleration],["Расход топлива",s.fuelConsumption]].filter(x=>x[1]).map(x=>`<div><dt>${x[0]}</dt><dd>${esc(x[1])}</dd></div>`).join("")}
    </dl><a class="spec-source" href="${safe(s.source)}" target="_blank" rel="noopener">${esc(s.sourceLabel||"Источник данных")}</a></section>`).join("");
  const premium=gen.premiumContent||{};
  const hasPremium=["weaknesses","bestEngines","worstEngines","pros","cons","buyingTips"].some(k=>Array.isArray(premium[k])&&premium[k].length);
  const premiumHtml=hasPremium?`
    <div class="premium-content">
      ${section("Типичные болячки",premium.weaknesses)}
      ${section("Лучшие моторы",premium.bestEngines)}
      ${section("Моторы, к которым стоит присмотреться с осторожностью",premium.worstEngines)}
      ${section("Плюсы поколения",premium.pros)}
      ${section("Минусы поколения",premium.cons)}
      ${section("Что проверить перед покупкой",premium.buyingTips)}
      <small>Материалы следует сверять с конкретным рынком, мотором и годом выпуска.</small>
    </div>`:`
    <div class="premium-lock"><div class="lock-icon">✦</div><h3>Полный разбор поколения — в подписке</h3>
      <p>Типичные неисправности и слабые места, лучшие и проблемные двигатели, плюсы и минусы, ресурс узлов, чек-лист осмотра и советы перед покупкой.</p>
      <a class="subscribe-cta" href="./index.html#subscriptions" style="display:inline-block;text-decoration:none">Посмотреть подписки</a>
      <small>Подробные материалы добавляются после проверки источников. Непроверенные советы не выдаём за факты.</small>
    </div>`;
  root.innerHTML=`
    <a class="back" href="./index.html">← Назад в каталог</a>
    <p class="detail-kicker">КАРТОЧКА ПОКОЛЕНИЯ</p>
    <h1 style="font-size:clamp(25px,5vw,38px);margin:7px 0">${esc(brand.name)} ${esc(model.name)} · ${esc(gen.code)}</h1>
    <p class="generation-years">${esc(gen.years)} · ${esc((gen.markets||[]).join(", ")||"Рынки не указаны")}</p>
    <h4>Фотографии</h4>
    <div class="generation-gallery" id="generationGallery">${photos||'<p class="pending-data">Проверяем наличие фотографии с подходящей лицензией…</p>'}</div>
    <h4>Технические характеристики</h4>
    ${specs||'<p class="pending-data">Подтверждённые характеристики для этого поколения пока не добавлены. <a href="'+safe(gen.researchUrl)+'" target="_blank" rel="noopener">Открыть источники для проверки ↗</a></p>'}
    <p class="data-note">Параметры зависят от рынка, года выпуска и комплектации. Для точного подбора запчастей сверяйте VIN и код двигателя.</p>
    <h4>Подробный экспертный разбор</h4>
    ${premiumHtml}`;
}

function photoMarkup(p,model,gen) {
  return `<figure class="generation-photo"><img src="${safe(p.url)}" alt="${esc(p.caption||model.name+" "+gen.code)}" loading="lazy"><figcaption>Фото: <a href="${safe(p.sourceUrl)}" target="_blank" rel="noopener">источник</a> · ${esc(p.author||"Автор не указан")} · ${esc(p.license||"Лицензия не указана")}</figcaption></figure>`;
}
function section(title,items) {
  if(!Array.isArray(items)||!items.length)return "";
  return `<section class="premium-section"><h4>${title}</h4><ul>${items.map(x=>"<li>"+esc(x)+"</li>").join("")}</ul></section>`;
}
async function loadCommonsPhoto(brand,model,gen) {
  const host=document.getElementById("generationGallery");
  const year=(String(gen.years||"").match(/(?:19|20)\d{2}/)||[])[0]||"";
  const q=[brand,model,gen.code,year].filter(Boolean).join(" ");
  const url=new URL("https://commons.wikimedia.org/w/api.php");
  url.search=new URLSearchParams({action:"query",generator:"search",gsrsearch:q,gsrnamespace:"6",gsrlimit:"8",prop:"imageinfo",iiprop:"url|extmetadata",iiurlwidth:"1200",format:"json",origin:"*"}).toString();
  try {
    const r=await fetch(url); if(!r.ok)throw new Error();
    const pages=Object.values((await r.json()).query?.pages||{});
    const item=pages.find(p=>{const m=p.imageinfo?.[0]?.extmetadata||{};return (p.imageinfo?.[0]?.thumburl||p.imageinfo?.[0]?.url)&&m.LicenseShortName?.value&&m.Artist?.value;});
    if(!item){host.innerHTML='<p class="pending-data">Фото с подтверждённой лицензией пока не найдено. <a href="'+safe(gen.photoSearchUrl)+'" target="_blank" rel="noopener">Посмотреть варианты ↗</a></p>';return;}
    const info=item.imageinfo[0],m=info.extmetadata||{};
    const clean=k=>String(m[k]?.value||"").replace(/<[^>]*>/g,"").trim();
    host.innerHTML=photoMarkup({url:info.thumburl||info.url,sourceUrl:info.descriptionurl,author:clean("Artist")||clean("Credit"),license:clean("LicenseShortName")||clean("UsageTerms")}, {name:model},gen);
    const caption=host.querySelector("figcaption");
    if(clean("LicenseUrl")){caption.append(" · ");const a=document.createElement("a");a.href=clean("LicenseUrl");a.target="_blank";a.rel="noopener";a.textContent="условия лицензии";caption.append(a);}
  } catch {host.innerHTML='<p class="pending-data">Не удалось загрузить фото сейчас. <a href="'+safe(gen.photoSearchUrl)+'" target="_blank" rel="noopener">Открыть поиск фотографий ↗</a></p>';}
}
start();
