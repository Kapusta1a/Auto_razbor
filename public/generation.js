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
  const specGroups = [
    {id:"engines",label:"Двигатели",fields:[["Двигатель", "engine"],["Объём", "displacement"],["Топливо", "fuel"],["Мощность", "power"],["Крутящий момент", "torque"],["КПП", "transmission"],["Привод", "drivetrain"]]},
    {id:"dynamics",label:"Расход и динамика",fields:[["Разгон 0–100 км/ч", "acceleration"],["Максимальная скорость", "topSpeed"],["Расход в городе", "fuelConsumptionCity"],["Расход на трассе", "fuelConsumptionHighway"],["Смешанный расход", "fuelConsumptionCombined"]]},
    {id:"dimensions",label:"Габариты",fields:[["Длина", "length"],["Ширина", "width"],["Высота", "height"],["Колёсная база", "wheelbase"],["Дорожный просвет", "groundClearance"]]},
    {id:"practical",label:"Багажник и практичность",fields:[["Объём багажника", "bootVolume"],["Объём бака", "fuelTank"],["Снаряжённая масса", "curbWeight"],["Количество мест", "seats"],["Количество дверей", "doors"]]}
  ];
  const specifications=gen.specifications||[];
  const specs=specifications.length
    ? '<div class="spec-tabs" role="tablist" aria-label="Разделы характеристик">'+specGroups.map((g,i)=>'<button class="spec-tab'+(i===0?' is-active':'')+'" type="button" role="tab" aria-selected="'+(i===0?'true':'false')+'" data-spec-tab="'+g.id+'">'+g.label+'</button>').join('')+'</div>'
      + specGroups.map((g,i)=>{
        const cards=specifications.map(spec=>{
          const rows=g.fields.filter(([label,key])=>spec[key]).map(([label,key])=>'<div><dt>'+label+'</dt><dd>'+esc(spec[key])+'</dd></div>').join('');
          if(!rows)return '';
          return '<article class="spec-card"><b>'+esc(spec.variant||'Версия двигателя')+'</b><small>'+esc(spec.market||'Рынок не указан')+'</small><dl>'+rows+'</dl>'+(spec.source?'<a class="spec-source" href="'+safe(spec.source)+'" target="_blank" rel="noopener">'+esc(spec.sourceLabel||'Источник данных')+'</a>':'')+'</article>';
        }).join('');
        return '<section class="spec-panel'+(i===0?' is-active':'')+'" data-spec-panel="'+g.id+'" '+(i===0?'':'hidden')+'>'+(cards||'<p class="pending-data">Подтверждённые данные для этого раздела пока не добавлены.</p>')+'</section>';
      }).join('')
    : '<p class="pending-data">Подтверждённые характеристики для этого поколения пока не добавлены. <a href="'+safe(gen.researchUrl)+'" target="_blank" rel="noopener">Открыть источники для проверки ↗</a></p>';
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
  root.querySelectorAll("[data-spec-tab]").forEach(button=>button.addEventListener("click",()=>{
    const target=button.dataset.specTab;
    root.querySelectorAll("[data-spec-tab]").forEach(tab=>{
      const active=tab===button;
      tab.classList.toggle("is-active",active);
      tab.setAttribute("aria-selected",String(active));
    });
    root.querySelectorAll("[data-spec-panel]").forEach(panel=>{
      const active=panel.dataset.specPanel===target;
      panel.hidden=!active;
      panel.classList.toggle("is-active",active);
    });
  }));
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
  url.search=new URLSearchParams({action:"query",generator:"search",gsrsearch:q,gsrnamespace:"6",gsrlimit:"20",prop:"imageinfo",iiprop:"url|extmetadata",iiurlwidth:"1200",format:"json",origin:"*"}).toString();
  try {
    const r=await fetch(url); if(!r.ok)throw new Error();
    const pages=Object.values((await r.json()).query?.pages||{});
    const seen=new Set();
    const items=pages.map(p=>p.imageinfo?.[0]).filter(info=>{
      const m=info?.extmetadata||{};
      const imageUrl=info?.thumburl||info?.url;
      if(!imageUrl||!info.descriptionurl||!m.LicenseShortName?.value||!m.Artist?.value||seen.has(info.descriptionurl))return false;
      seen.add(info.descriptionurl);
      return true;
    }).slice(0,4);
    if(!items.length){host.innerHTML='<p class="pending-data">Фото с подтверждённой лицензией пока не найдено. <a href="'+safe(gen.photoSearchUrl)+'" target="_blank" rel="noopener">Посмотреть варианты ↗</a></p>';return;}
    const clean=(m,k)=>String(m[k]?.value||"").replace(/<[^>]*>/g,"").trim();
    host.innerHTML=items.map(info=>{
      const m=info.extmetadata||{};
      return photoMarkup({url:info.thumburl||info.url,sourceUrl:info.descriptionurl,author:clean(m,"Artist")||clean(m,"Credit"),license:clean(m,"LicenseShortName")||clean(m,"UsageTerms"),licenseUrl:clean(m,"LicenseUrl")}, {name:model},gen);
    }).join("");
    host.querySelectorAll("figcaption").forEach((caption,index)=>{
      const info=items[index],licenseUrl=clean(info.extmetadata||{},"LicenseUrl");
      if(licenseUrl){caption.append(" · ");const a=document.createElement("a");a.href=safe(licenseUrl);a.target="_blank";a.rel="noopener";a.textContent="условия лицензии";caption.append(a);}
    });
  } catch {host.innerHTML='<p class="pending-data">Не удалось загрузить фото сейчас. <a href="'+safe(gen.photoSearchUrl)+'" target="_blank" rel="noopener">Открыть поиск фотографий ↗</a></p>';}
}
start();
