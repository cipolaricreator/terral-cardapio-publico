'use strict';

/* ================= Configuração ================= */
const CFG = Object.assign({
  restaurant: 'Terral Maresias',
  whatsapp: '',
  pix: { key: '', name: 'Terral Maresias', city: 'Sao Sebastiao' },
  modes: { mesa: true, retirada: true, entrega: false },
  payments: { pix: true, cartao: true },
  orderEndpoint: '',
  serviceFee: 0.1,
  deliveryFee: 0
}, window.TERRAL_CONFIG || {});

const QR_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
const FEATURED = ['terral-025', 'terral-026', 'terral-034', 'terral-038'];
const ORDER_TTL = 12 * 60 * 60 * 1000;

const categoryCopy = {
  'Petiscos': ['Para começar', 'Do mar e da terra, para acompanhar a conversa. Muitos têm meia porção ou porção inteira.'],
  'Saladas': ['Frescor à mesa', 'Folhas, vegetais e combinações da casa. Abra cada salada para conhecer todos os ingredientes.'],
  'Pratos Terral': ['Da nossa cozinha', 'Pratos individuais, com os acompanhamentos de cada receita.'],
  'Pratos especiais': ['Sabores que ficam', 'Receitas de peixe, camarão, carne e frango, em meia porção ou porção inteira.'],
  'Para compartilhar': ['Juntos à mesa', 'Pratos servidos em porção inteira, feitos para dividir.'],
  'Massas': ['Escolha sua combinação', 'Porções individuais. Escolha spaguetti, penne ou fettuccine e o molho de sua preferência.'],
  'Guarnições': ['Para acompanhar', 'Arroz, molhos e acompanhamentos para complementar sua refeição.'],
  'Filés extra': ['Um complemento à escolha', 'Porções extras de peixe, frango ou carne.'],
  'Sobremesas': ['Um final doce', 'Doces e sobremesas da casa.'],
  'Drinks': ['Um brinde ao momento', 'Clássicos e combinações da casa. Conheça os ingredientes de cada drink.'],
  'Bebidas': ['Para refrescar', 'Sucos, refrigerantes, águas, chá gelado, energético e café.'],
  'Cervejas': ['Para o seu brinde', 'Confira a marca e a apresentação de cada cerveja.'],
  'Artesanais Terral': ['Feitas aqui', 'Cervejas produzidas no Terral. Quatro estilos, servidos em copos de 300 ml.'],
  'Shots e doses': ['Do bar', 'Escolha sua dose.'],
  'Vinhos': ['À sua escolha', 'A equipe apresenta a carta de vinhos, com rótulos e preços disponíveis.'],
  'Gin e Red Bull': ['Combinações do bar', 'Gin combinado com as edições Tropical ou Melancia de Red Bull.']
};
const categoryNotes = {
  'Pratos Terral': 'Troca de salada por fritas sem acréscimo. Troca de outros ingredientes: R$ 8,00 — use o campo de observação.',
  'Para compartilhar': 'Polvo Terral: encomende com um dia de antecedência.',
  'Bebidas': 'Sucos: acréscimo de leite, uma ou mais frutas por R$ 5,00. Indique na observação do item.',
  'Pratos especiais': 'O rendimento das porções pode variar. A equipe ajuda a escolher o tamanho para sua mesa.',
  'Petiscos': 'O rendimento das porções pode variar. A equipe ajuda a escolher o tamanho para sua mesa.'
};
const explanations = [
  ['à milanesa', 'À milanesa: o alimento recebe uma cobertura empanada e é frito.'],
  ['à dorê', 'À dorê: preparo com cobertura dourada. Neste cardápio, os petiscos à dorê são empanados.'],
  ['parmegiana', 'À parmegiana: preparo à milanesa coberto com molho de tomate e queijo.'],
  ['pirão', 'Pirão: acompanhamento espessado com farinha de mandioca.'],
  ['kani', 'Kani: produto à base de peixe que imita carne de caranguejo.'],
  ['à grega', 'Arroz à grega: arroz com vegetais.'],
  ['verm', 'Vermouth: bebida à base de vinho aromatizado, utilizada em coquetéis.'],
  ['sauté', 'Sauté: preparo salteado em gordura.']
];

/* ================= Utilidades ================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const money = n => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s).normalize('NFD').replace(MARKS, '').toLowerCase();
const slug = s => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const MARKS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const round2 = n => Math.round(n * 100) / 100;

const store = {
  get(k, d) { try { const v = localStorage.getItem('terral:' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { v == null ? localStorage.removeItem('terral:' + k) : localStorage.setItem('terral:' + k, JSON.stringify(v)); } catch { /* armazenamento indisponível */ } }
};
/* ================= Painel próprio (cozinha & caixa) ================= */
// Quando este cardápio roda dentro do Artifact "Painel Terral" (a versão
// ligada à conta da equipe), cada pedido é gravado num banco compartilhado
// em tempo real — é o que a cozinha e o caixa acompanham em #cozinha e
// #caixa. No site publicado normalmente (a hospedagem de sempre), isso
// fica inativo sozinho e nada muda no funcionamento de hoje (WhatsApp).
let DB = null;
const dbReady = (async () => {
  if (!window.claude?.use) return null;
  try { DB = await window.claude.use('db'); } catch { DB = null; }
  return DB;
})();

// API REST própria (backend na hospedagem do cliente) — usada pelo painel
// quando não há Artifact/DB disponível. Mesmo contrato de dados dos pedidos.
const pinHeader = () => sessionStorage.getItem('terral:pin') || '';
async function apiGet(url) {
  try { const res = await fetch(url, { headers: { 'X-Team-Pin': pinHeader() } }); return res.ok ? await res.json() : null; }
  catch { return null; }
}
async function apiPost(url, body) {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Team-Pin': pinHeader() }, body: JSON.stringify(body || {}) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}
function pollOrders(url, cb, ms = 4000) {
  let stopped = false;
  (async function tick() {
    if (stopped) return;
    const data = await apiGet(url);
    if (data) cb(data.orders || []);
    if (!stopped) setTimeout(tick, ms);
  })();
  return () => { stopped = true; };
}

async function syncOrderToDb(o) {
  await dbReady;
  if (!o) return false;
  if (DB) { try { await DB.collection('orders').doc(o.code).set(o); return true; } catch { /* tenta a API própria abaixo */ } }
  if (CFG.orderEndpoint) return !!(await apiPost(CFG.orderEndpoint, { type: 'sync', text: '', order: o, sentAt: new Date().toISOString() }));
  return false;
}

const ICON = {
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  bag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8h12l-1 12H7L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
  wa: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z"/></svg>',
  mesa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9h18M5 9v11M19 9v11M8 9V5h8v4"/></svg>',
  retirada: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8h12l-1 12H7L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
  entrega: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M9 17h6l-3-8H8M15 6h2l2.5 8"/></svg>',
  pix: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 9-9 9-9-9 9-9Z"/><path d="m7.5 7.5 4.5 4.5 4.5-4.5M7.5 16.5 12 12l4.5 4.5"/></svg>',
  cartao: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h4"/></svg>',
  dinheiro: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.8"/><path d="M6 9v.01M18 15v.01"/></svg>'
};

/* ================= Estado ================= */
let catalog = [];
let byId = new Map();
let cart = store.get('cart', []);
let order = store.get('order', null);
let customer = store.get('customer', {});
let cartView = 'bag';
let checkoutDraft = null;
let detailState = null;

/* ================= Dados dos itens ================= */
const pictures = item => item.images?.length ? item.images : [{ src: item.image, kind: item.imageKind, note: item.imageNote || 'Imagem ilustrativa. A apresentação pode variar.' }];
const coverOf = item => { const p = pictures(item); return p.find(x => x.src === item.coverImage) || p[0]; };
const sizeLabels = item => item.prices.length === 2 ? ['Meia', 'Inteira'] : [item.portionLabel];
const orderable = item => item.prices.length > 0;
const needsChoice = item => item.prices.length > 1 || !!item.options;
const imgLabel = kind => kind === 'source' ? 'Foto do cardápio' : 'Ilustrativa';
const priceHtml = item => !item.prices.length ? 'Consultar carta'
  : item.prices.length > 1 ? `<small>a partir de</small>${money(item.prices[0])}` : money(item.prices[0]);
// Miniaturas otimizadas geradas por item (assets/thumbs/<id>-360.webp e -720.webp)
const thumb = (item, w) => `assets/thumbs/${item.id}-${w}.webp`;
const thumbSet = item => `${thumb(item, 360)} 360w, ${thumb(item, 720)} 720w`;
// Descrição que só repete o nome (ex.: "Caipirinha." / "Dose de gin Tanqueray.") não é exibida no card
const FILLER = new Set(['dose', 'de', 'da', 'do', 'cerveja', 'garrafa', 'massa', 'na', 'no', 'lata', 'ml']);
const words = s => norm(s).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(Boolean);
const usefulDesc = item => {
  const name = new Set(words(item.name));
  return words(item.description).some(w => !FILLER.has(w) && !name.has(w));
};
const searchText = item => esc(norm(`${item.name} ${item.description} ${item.category} ${(item.options || []).join(' ')}`));

// Categorias do bar e categorias exibidas como carta (fotos genéricas repetidas entre itens)
const BAR_CATS = ['Drinks', 'Bebidas', 'Cervejas', 'Artesanais Terral', 'Shots e doses', 'Vinhos', 'Gin e Red Bull'];
const LIST_CATS = ['Cervejas', 'Shots e doses'];

/* ================= Renderização do cardápio ================= */
function rowHtml(item, withImg = false) {
  return `<article class="dish row${withImg ? ' with-img' : ''} reveal" data-item="${item.id}" data-search="${searchText(item)}">
    <button type="button" class="dish-hit" data-open="${item.id}" aria-label="Ver detalhes de ${esc(item.name)}"></button>
    ${withImg ? `<img class="row-img" src="${thumb(item, 360)}" alt="" loading="lazy" decoding="async" width="72" height="72">` : ''}
    <div class="row-main">
      <h3>${esc(item.name)}</h3>
      <span class="row-dots" aria-hidden="true"></span>
      <span class="price">${priceHtml(item)}</span>
    </div>
    ${usefulDesc(item) ? `<p class="dish-desc">${esc(item.description)}</p>` : ''}
    ${orderable(item) ? `<button type="button" class="add" data-add="${item.id}" aria-label="Adicionar ${esc(item.name)} à sacola">${ICON.plus}</button>` : ''}
    <span class="in-bag" data-bag="${item.id}" hidden></span>
  </article>`;
}
function cardHtml(item) {
  const c = coverOf(item);
  return `<article class="dish reveal" data-item="${item.id}" data-search="${searchText(item)}">
    <button type="button" class="dish-hit" data-open="${item.id}" aria-label="Ver detalhes de ${esc(item.name)}"></button>
    <div class="dish-media"><img src="${thumb(item, 720)}" srcset="${thumbSet(item)}" sizes="(max-width: 720px) 120px, (max-width: 1100px) 46vw, 400px" alt="${esc(item.name)} — ${imgLabel(c.kind).toLowerCase()}" loading="lazy" decoding="async" width="720" height="720">${c.kind === 'source' ? '<span class="dish-tag">Foto do cardápio</span>' : ''}</div>
    <div class="dish-body">
      <h3>${esc(item.name)}</h3>
      ${usefulDesc(item) ? `<p class="dish-desc">${esc(item.description)}</p>` : ''}
      <div class="dish-foot">
        <span class="price">${priceHtml(item)}</span>
        ${orderable(item) ? `<button type="button" class="add add-pill" data-add="${item.id}" aria-label="Adicionar ${esc(item.name)} à sacola">${ICON.plus}<span aria-hidden="true">Adicionar</span></button>` : '<span class="ask">Peça a carta à equipe</span>'}
      </div>
    </div>
    <span class="in-bag" data-bag="${item.id}" hidden></span>
  </article>`;
}

function renderMenu() {
  const cats = [...new Set(catalog.map(x => x.category))];
  const kitchen = cats.filter(c => !BAR_CATS.includes(c));
  const bar = cats.filter(c => BAR_CATS.includes(c));
  const pill = c => `<button type="button" data-cat="${esc(slug(c))}" aria-current="false">${esc(c)}</button>`;
  $('#cats').insertAdjacentHTML('beforeend', kitchen.map(pill).join('') + (bar.length ? '<span class="cats-sep" aria-hidden="true">Bar</span>' : '') + bar.map(pill).join(''));

  const section = (c, n) => {
    const items = catalog.filter(x => x.category === c);
    if (c === 'Pratos Terral') items.sort((a, b) => rank(a) - rank(b));
    const [kicker, desc] = categoryCopy[c] || ['Cardápio', ''];
    const list = LIST_CATS.includes(c);
    return `<section class="cat" id="${slug(c)}" data-cat="${esc(slug(c))}" aria-labelledby="h-${slug(c)}">
      <header class="cat-head reveal">
        <div><p class="eyebrow"><span class="cat-num">${String(n).padStart(2, '0')}</span>${esc(kicker)}</p><h2 id="h-${slug(c)}">${esc(c)}</h2></div>
        <p class="cat-desc">${esc(desc)}</p>
        <span class="cat-count">${items.length} ${items.length === 1 ? 'opção' : 'opções'}</span>
      </header>
      <div class="grid${list ? ' carta' : ''}${!list && items.length <= 2 ? ' few' : ''}${!list && items.length === 1 ? ' solo' : ''}">${items.map(it => list ? rowHtml(it) : cardHtml(it)).join('')}</div>
      ${categoryNotes[c] ? `<p class="cat-note reveal">${esc(categoryNotes[c])}</p>` : ''}
    </section>`;
  };
  $('#kitchen-sections').innerHTML = kitchen.map((c, i) => section(c, i + 1)).join('');
  $('#bar-sections').innerHTML = bar.map((c, i) => section(c, kitchen.length + i + 1)).join('');
  $('#kitchen-sections').setAttribute('aria-busy', 'false');

  $('#featured-row').innerHTML = FEATURED.map(id => byId.get(id)).filter(Boolean).map(item => {
    return `<article class="feat reveal">
      <button type="button" class="dish-hit" data-open="${item.id}" aria-label="Ver detalhes de ${esc(item.name)}"></button>
      <img src="${thumb(item, 720)}" alt="" loading="lazy" decoding="async">
      <div class="feat-body">
        <div><p class="eyebrow">${esc(item.category)}</p><h3>${esc(item.name)}</h3><span class="price">${priceHtml(item)}</span></div>
        <button type="button" class="add" data-add="${item.id}" aria-label="Adicionar ${esc(item.name)} à sacola">${ICON.plus}</button>
      </div>
    </article>`;
  }).join('');

  $$('.dish-media img').forEach(img => {
    if (img.complete) img.classList.add('loaded');
    else { img.addEventListener('load', () => img.classList.add('loaded'), { once: true }); img.addEventListener('error', () => img.classList.add('loaded'), { once: true }); }
  });
  function rank(it) { const i = ['terral-025', 'terral-026', 'terral-028'].indexOf(it.id); return i < 0 ? 99 : i; }
}

/* ================= Revelar ao rolar ================= */
function splitWords(el) {
  if (el.dataset.split) return;
  el.dataset.split = '1';
  let i = 0;
  const walk = node => {
    [...node.childNodes].forEach(child => {
      if (child.nodeType === 3) {
        const frag = document.createDocumentFragment();
        child.textContent.split(/(\s+)/).forEach(part => {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.append(part); return; }
          const w = document.createElement('span'); w.className = 'wd';
          const inner = document.createElement('span'); inner.textContent = part; inner.style.setProperty('--wi', i++);
          w.append(inner); frag.append(w);
        });
        child.replaceWith(frag);
      } else if (child.nodeType === 1) walk(child);
    });
  };
  walk(el);
}
function setupReveal() {
  $$('.menu-intro > div, .featured-head > div, .casa').forEach(el => el.classList.add('reveal'));
  $$('.cat-head h2, .split-title, .menu-title, #featured-title').forEach(splitWords);
  const els = $$('.reveal');
  if (!('IntersectionObserver' in window) || reduced.matches) { els.forEach(e => e.classList.add('in')); return; }
  const io = new IntersectionObserver(entries => {
    let n = 0;
    entries.filter(e => e.isIntersecting).forEach(e => {
      e.target.style.setProperty('--d', `${Math.min(n++, 5) * 70}ms`);
      e.target.classList.add('in');
      io.unobserve(e.target);
      setTimeout(() => e.target.style.removeProperty('--d'), 1400);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
  els.forEach(e => io.observe(e));
}

/* ================= Barra de categorias ================= */
let spyLock = 0;
function setActiveCat(key, scrollPill = true) {
  const btn = $(`#cats button[data-cat="${key}"]`);
  if (!btn || btn.getAttribute('aria-current') === 'true') return;
  $$('#cats button').forEach(b => b.setAttribute('aria-current', b === btn));
  moveIndicator(btn);
  if (scrollPill) {
    const nav = $('#cats');
    nav.scrollTo({ left: btn.offsetLeft - nav.clientWidth / 2 + btn.offsetWidth / 2, behavior: reduced.matches ? 'auto' : 'smooth' });
  }
}
function moveIndicator(btn = $('#cats button[aria-current="true"]')) {
  const ind = $('.cat-ind');
  if (!btn) { ind.style.width = '0'; return; }
  ind.style.width = btn.offsetWidth + 'px';
  ind.style.transform = `translateX(${btn.offsetLeft}px)`;
}
function spy() {
  if (Date.now() < spyLock) return;
  const line = $('#catbar').offsetHeight + 90;
  let current = null;
  for (const s of $$('.cat:not([hidden])')) { if (s.getBoundingClientRect().top <= line) current = s; else break; }
  if (current) setActiveCat(current.dataset.cat);
  else { $$('#cats button').forEach(b => b.setAttribute('aria-current', 'false')); moveIndicator(null); }
}
function setupCatbar() {
  $('#cats').addEventListener('click', e => {
    const b = e.target.closest('button[data-cat]');
    if (!b) return;
    const sec = document.getElementById(b.dataset.cat);
    if (!sec || sec.hidden) return;
    spyLock = Date.now() + 900;
    setActiveCat(b.dataset.cat);
    sec.scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth', block: 'start' });
    history.replaceState(null, '', '#' + b.dataset.cat);
  });
  let ticking = false;
  const onScroll = () => {
    ticking = false;
    spy();
    const catbar = $('#catbar');
    const barH = catbar.offsetHeight;
    catbar.classList.toggle('stuck', catbar.getBoundingClientRect().top <= 0);
    // Anoitecer: a barra escurece quando o bar chega ao topo
    const barZone = $('#bar');
    const r = barZone.getBoundingClientRect();
    const night = (!barZone.hidden && r.top <= barH) || $('.footer').getBoundingClientRect().top <= barH;
    catbar.classList.toggle('dark', night);
    document.body.classList.toggle('is-night', night);
    // Progresso de leitura do cardápio
    const menu = $('#menu').getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (barH - menu.top) / Math.max(1, menu.height - innerHeight)));
    catbar.style.setProperty('--progress', p.toFixed(4));
    // Parallax das fotos de ambiente
    if (!reduced.matches) {
      $$('[data-parallax] img').forEach(img => {
        const box = img.parentElement.getBoundingClientRect();
        if (box.bottom < 0 || box.top > innerHeight) return;
        const k = (box.top + box.height / 2 - innerHeight / 2) / innerHeight;
        img.style.transform = `translate3d(0, ${(k * -60).toFixed(1)}px, 0) scale(1.18)`;
      });
    }
    // Parallax da abertura
    if (!reduced.matches) {
      const y = scrollY;
      if (y < innerHeight * 1.2) {
        $('.hero-bg').style.transform = `translate3d(0, ${y * 0.12}px, 0) scale(1.08)`;
      }
    }
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  addEventListener('resize', () => { moveIndicator(); onScroll(); });
  onScroll();
  $('#search-jump').addEventListener('click', () => {
    $('.menu-intro').scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth', block: 'start' });
    setTimeout(() => $('#search').focus({ preventScroll: true }), reduced.matches ? 0 : 450);
  });
  $$('[data-featured]').forEach(b => b.addEventListener('click', () => {
    const row = $('#featured-row');
    row.scrollBy({ left: Number(b.dataset.featured) * row.clientWidth * 0.8, behavior: 'smooth' });
  }));
}

/* ================= Efeitos ================= */
function setupEffects() {
  if (reduced.matches) return;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;

  // Luz dourada que acompanha o cursor no bar
  const zone = $('#bar');
  const spot = $('#bar .spot');
  zone.addEventListener('pointermove', e => {
    spot.style.setProperty('--mx', e.clientX + 'px');
    spot.style.setProperty('--my', e.clientY + 'px');
    spot.style.opacity = 1;
  }, { passive: true });
  zone.addEventListener('pointerleave', () => { spot.style.opacity = 0; });

  // Profundidade e brilho nos cards (somente com mouse)
  if (!fine) return;
  let raf = 0;
  const reset = card => { card.style.removeProperty('--rx'); card.style.removeProperty('--ry'); };
  document.addEventListener('pointermove', e => {
    const card = e.target.closest?.('.dish:not(.row), .feat');
    if (!card) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      card.style.setProperty('--rx', `${((0.5 - y) * 6).toFixed(2)}deg`);
      card.style.setProperty('--ry', `${((x - 0.5) * 8).toFixed(2)}deg`);
      card.style.setProperty('--px', `${(x * 100).toFixed(1)}%`);
      card.style.setProperty('--py', `${(y * 100).toFixed(1)}%`);
    });
  }, { passive: true });
  document.addEventListener('pointerout', e => {
    const card = e.target.closest?.('.dish, .feat');
    if (card && !card.contains(e.relatedTarget)) reset(card);
  }, { passive: true });
}

/* ================= Busca ================= */
function setupSearch() {
  const input = $('#search');
  const apply = () => {
    const terms = norm(input.value).trim().split(/\s+/).filter(Boolean);
    let total = 0;
    $$('.cat').forEach(sec => {
      let visible = 0;
      $$('.dish', sec).forEach(card => {
        const ok = terms.every(t => card.dataset.search.includes(t));
        card.hidden = !ok;
        if (ok) { visible++; card.classList.add('in'); }
      });
      sec.hidden = visible === 0;
      $('.cat-note', sec)?.toggleAttribute('hidden', terms.length > 0);
      total += visible;
    });
    $('#featured').hidden = terms.length > 0;
    $('.casa').hidden = terms.length > 0;
    $('#bar').hidden = terms.length > 0 && !$('#bar .cat:not([hidden])');
    $('#bar .chapter').hidden = terms.length > 0;
    $('#search-clear').hidden = !input.value;
    $('#empty-search').hidden = !(terms.length && total === 0);
    $('#search-status').textContent = terms.length ? (total ? `${total} ${total === 1 ? 'item encontrado' : 'itens encontrados'}` : '') : '';
    spy();
  };
  input.addEventListener('input', apply);
  const clear = () => { input.value = ''; apply(); input.focus(); };
  $('#search-clear').addEventListener('click', clear);
  $('#empty-clear').addEventListener('click', clear);
}

/* ================= Diálogos ================= */
function openDialog(d) {
  if (d.open) return;
  d.classList.remove('closing');
  d.showModal();
}
function closeDialog(d) {
  if (!d.open || d.classList.contains('closing')) return;
  d.classList.add('closing');
  const done = () => { d.classList.remove('closing'); d.close(); };
  const t = setTimeout(done, 450);
  d.addEventListener('animationend', e => { if (e.target === d) { clearTimeout(t); done(); } }, { once: true });
}
function setupDialogs() {
  $$('dialog').forEach(d => {
    d.addEventListener('cancel', e => { e.preventDefault(); closeDialog(d); });
    d.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) { closeDialog(d); return; }
      if (e.target === d) {
        const r = d.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeDialog(d);
      }
    });
  });
  $$('[data-dialog]').forEach(b => b.addEventListener('click', () => openDialog(document.getElementById(b.dataset.dialog))));
}

/* ================= Detalhe do item ================= */
function openDetail(id) {
  const item = byId.get(id);
  if (!item) return;
  const pics = pictures(item);
  const labels = sizeLabels(item);
  // Doses cuja foto genérica (copo de cachaça) não representa a bebida: painel tipográfico no lugar da foto
  const noPhoto = item.coverImage === 'assets/terral-126-view3-view-3.webp' && !/cacha|pinga/i.test(item.name);
  const explain = explanations.filter(([k]) => norm(item.name + ' ' + item.description).includes(norm(k))).map(x => x[1]);
  detailState = { item, photo: Math.max(0, pics.indexOf(coverOf(item))), qty: 1 };

  $('#detail-content').innerHTML = `<div class="d-layout">
    ${noPhoto ? `<div class="d-gallery d-noimg"><div class="d-mark"><img src="assets/marca/terral-logo-branco-sm.webp" alt="" width="320" height="182"><span>${esc(item.category)}</span><strong>${esc(item.name)}</strong><em>${esc(item.portionLabel || 'Dose')} · servida no bar do Terral</em></div></div>` : `<div class="d-gallery">
      <div class="d-stage" id="d-stage">
        ${pics.map((p, i) => `<img src="${esc(p.src)}" alt="${esc(item.name)} — ${imgLabel(p.kind).toLowerCase()}" data-i="${i}" ${i === detailState.photo ? 'class="on"' : 'loading="lazy"'}>`).join('')}
        ${pics.length > 1 ? `<button type="button" class="d-arrow prev" data-photo-step="-1" aria-label="Foto anterior">‹</button><button type="button" class="d-arrow next" data-photo-step="1" aria-label="Próxima foto">›</button>
        <div class="d-dots">${pics.map((_, i) => `<button type="button" data-photo="${i}" aria-label="Ver foto ${i + 1}" aria-pressed="${i === detailState.photo}"></button>`).join('')}</div>` : ''}
      </div>
      <p class="d-caption" id="d-caption">${esc(pics[detailState.photo].note)}</p>
    </div>`}
    <div class="d-body">
      <div class="d-main">
        <p class="eyebrow">${esc(item.category)}</p>
        <h2 id="detail-title">${esc(item.name)}</h2>
        <p class="d-desc">${esc(item.description)}</p>
        ${item.prices.length > 1 ? `<fieldset class="choice"><legend>Tamanho</legend><div class="chips">${item.prices.map((p, i) => `<label class="chip"><input type="radio" name="d-size" value="${i}" ${i === 0 ? 'checked' : ''}><span><b>${esc(labels[i])}</b><em>${money(p)}</em></span></label>`).join('')}</div></fieldset>` : ''}
        ${item.options ? `<fieldset class="choice"><legend>Escolha a massa <small>mesmo preço</small></legend><div class="chips">${item.options.map((o, i) => `<label class="chip"><input type="radio" name="d-opt" value="${esc(o)}" ${i === 0 ? 'checked' : ''}><span><b>${esc(o)}</b></span></label>`).join('')}</div></fieldset>` : ''}
        ${item.prices.length === 1 && labels[0] && !['Preço', 'Inteira'].includes(labels[0]) ? `<p class="d-desc" style="margin-top:14px"><strong>${esc(labels[0])}</strong> · ${money(item.prices[0])}</p>` : ''}
        ${item.note ? `<p class="note">${esc(item.note)}</p>` : ''}
        ${item.serviceNote ? `<p class="note">${esc(item.serviceNote)}</p>` : ''}
        ${orderable(item) ? `<label class="field"><span>Alguma observação? <small>opcional</small></span><textarea id="d-note" rows="2" maxlength="140" placeholder="Ex.: sem cebola, molho à parte, alergia a…"></textarea></label>` : ''}
        ${explain.length ? `<details class="explain"><summary>Entenda o preparo</summary>${explain.map(x => `<p>${esc(x)}</p>`).join('')}</details>` : ''}
      </div>
      <div class="d-bar">
        ${orderable(item) ? `<div class="stepper" role="group" aria-label="Quantidade">
            <button type="button" data-qty="-1" aria-label="Diminuir quantidade" disabled>−</button>
            <output id="d-qty" aria-live="polite">1</output>
            <button type="button" data-qty="1" aria-label="Aumentar quantidade">+</button>
          </div>
          <button type="button" class="btn btn-primary" id="d-add">Adicionar · <span id="d-total">${money(item.prices[0])}</span></button>`
        : '<p>Este item é servido a partir da carta. Peça à equipe ao chegar ou use a observação de outro item.</p>'}
      </div>
    </div>
  </div>`;

  const dlg = $('#detail');
  openDialog(dlg);
  dlg.scrollTop = 0;
  setupSwipe($('#d-stage'), dir => showPhoto(detailState.photo + dir));
}
function detailPrice() {
  const { item, qty } = detailState;
  const size = Number($('input[name="d-size"]:checked')?.value || 0);
  return { size, unit: item.prices[size], total: item.prices[size] * qty };
}
function refreshDetail() {
  $('#d-qty').textContent = detailState.qty;
  $('[data-qty="-1"]').disabled = detailState.qty <= 1;
  $('#d-total').textContent = money(detailPrice().total);
}
function showPhoto(i) {
  const pics = pictures(detailState.item);
  detailState.photo = (i + pics.length) % pics.length;
  $$('#d-stage img').forEach(img => img.classList.toggle('on', Number(img.dataset.i) === detailState.photo));
  $$('#d-stage [data-photo]').forEach(b => b.setAttribute('aria-pressed', Number(b.dataset.photo) === detailState.photo));
  $('#d-caption').textContent = pics[detailState.photo].note;
}
function setupSwipe(el, cb) {
  if (!el) return;
  let start = null;
  el.addEventListener('pointerdown', e => { if (!e.target.closest('button')) start = { x: e.clientX, y: e.clientY }; });
  el.addEventListener('pointerup', e => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3) cb(dx < 0 ? 1 : -1);
    start = null;
  });
  el.addEventListener('pointercancel', () => { start = null; });
}
function setupDetail() {
  const dlg = $('#detail');
  dlg.addEventListener('click', e => {
    const t = e.target;
    if (t.closest('[data-photo-step]')) showPhoto(detailState.photo + Number(t.closest('[data-photo-step]').dataset.photoStep));
    else if (t.closest('[data-photo]')) showPhoto(Number(t.closest('[data-photo]').dataset.photo));
    else if (t.closest('[data-qty]')) { detailState.qty = Math.min(20, Math.max(1, detailState.qty + Number(t.closest('[data-qty]').dataset.qty))); refreshDetail(); }
    else if (t.closest('#d-add')) {
      const { item, qty } = detailState;
      const { size } = detailPrice();
      const option = $('input[name="d-opt"]:checked')?.value || '';
      const note = $('#d-note')?.value.trim() || '';
      const img = $('#d-stage img.on');
      const rect = img?.getBoundingClientRect();
      addToCart({ id: item.id, size, option, note, qty });
      closeDialog(dlg);
      flyToCart(img, rect);
    }
  });
  dlg.addEventListener('change', e => { if (e.target.name === 'd-size') refreshDetail(); });
  dlg.addEventListener('keydown', e => {
    if (!detailState || e.target.matches('textarea,input')) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); showPhoto(detailState.photo + (e.key === 'ArrowRight' ? 1 : -1)); }
  });
}

/* ================= Sacola ================= */
function lineLabel(line) {
  const item = byId.get(line.id);
  return [item.prices.length === 2 ? sizeLabels(item)[line.size] : '', line.option].filter(Boolean).join(' · ');
}
function saveCart() { store.set('cart', cart); updateCartUI(); }
function addToCart({ id, size = 0, option = '', note = '', qty = 1 }) {
  const item = byId.get(id);
  if (!item || !orderable(item)) return;
  const key = [id, size, option, note].join('|');
  const existing = cart.find(l => l.key === key);
  if (existing) existing.qty = Math.min(50, existing.qty + qty);
  else cart.push({ key, id, size, option, note, qty });
  saveCart();
  toast(`${qty > 1 ? qty + '× ' : ''}${item.name} na sacola`);
}
const lineUnit = line => byId.get(line.id).prices[line.size] ?? 0;
const subtotal = () => round2(cart.reduce((s, l) => s + lineUnit(l) * l.qty, 0));
const cartCount = () => cart.reduce((s, l) => s + l.qty, 0);

function updateCartUI() {
  const count = cartCount();
  $$('[data-cart-count]').forEach(el => { el.textContent = count; if (el.classList.contains('top-cart-count')) el.hidden = count === 0; });
  $('#fab-total').textContent = money(subtotal());
  $('.fab-label').textContent = count === 1 ? 'item na sacola' : 'Ver sacola';
  $('#cart-fab').classList.toggle('is-empty', count === 0);
  document.body.classList.toggle('has-cart', count > 0);
  const perItem = {};
  cart.forEach(l => { perItem[l.id] = (perItem[l.id] || 0) + l.qty; });
  $$('[data-bag]').forEach(el => {
    const n = perItem[el.dataset.bag] || 0;
    if (String(n) !== el.textContent) { el.hidden = !n; el.textContent = n; if (n) { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; } }
  });
  updateOrderChip();
  if ($('#cart').open && (cartView === 'bag' || cartView === 'checkout')) renderCart(false);
}

function bumpFab() {
  const fab = $('#cart-fab');
  fab.classList.remove('bump'); void fab.offsetWidth; fab.classList.add('bump');
}
function flyToCart(img, rect = img?.getBoundingClientRect()) {
  if (!img || !rect || reduced.matches) { bumpFab(); return; }
  const fab = $('#cart-fab');
  const bottom = parseFloat(getComputedStyle($('.floating')).bottom) || 24;
  const tx = fab.getBoundingClientRect().left + 30, ty = innerHeight - bottom - fab.offsetHeight / 2;
  const size = Math.min(rect.width, rect.height, 220);
  const clone = document.createElement('img');
  clone.src = img.currentSrc || img.src;
  clone.className = 'fly';
  Object.assign(clone.style, { left: rect.left + rect.width / 2 - size / 2 + 'px', top: rect.top + rect.height / 2 - size / 2 + 'px', width: size + 'px', height: size + 'px' });
  document.body.append(clone);
  const dx = tx - (rect.left + rect.width / 2), dy = ty - (rect.top + rect.height / 2);
  const anim = clone.animate([
    { transform: 'translate(0,0) scale(1)', opacity: 1, borderRadius: '18px' },
    { transform: `translate(${dx * 0.35}px,${dy * 0.2 - 60}px) scale(.55)`, opacity: 1, borderRadius: '40%', offset: 0.35 },
    { transform: `translate(${dx}px,${dy}px) scale(.12)`, opacity: 0.2, borderRadius: '50%' }
  ], { duration: 780, easing: 'cubic-bezier(.45,0,.2,1)' });
  anim.onfinish = () => { clone.remove(); bumpFab(); };
}

/* ================= Pedido: sacola, comanda da mesa, para viagem e conta ================= */
// Regras da casa:
// - Mesa: o pedido abre uma comanda. Novas rodadas vão direto para a cozinha e o cliente paga no final ("Pedir a conta").
// - Para viagem / entrega: o pagamento acontece na hora do pedido (PIX pelo cardápio ou cartão).
const MODE_LABEL = { mesa: 'Na mesa', retirada: 'Para viagem', entrega: 'Entrega' };
const PAY_LABEL = { pix: 'PIX', cartao: 'Cartão' };
const enabledModes = () => ['mesa', 'retirada', 'entrega'].filter(m => CFG.modes[m]);
const enabledPays = () => ['pix', 'cartao'].filter(p => CFG.payments[p]);
const isTab = () => !!order && order.mode === 'mesa' && order.status !== 'pago';
const ordinal = n => `${n}ª`;
const timeOf = ts => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
let billDraft = null;

function saveOrder() { store.set('order', order); updateOrderChip(); syncOrderToDb(order); }

function openCart(view) {
  cartView = view || (order && !cart.length ? 'status' : 'bag');
  renderCart();
  openDialog($('#cart'));
}

function stepsHtml(active, mode) {
  const steps = mode === 'mesa' ? ['Sacola', 'Pedido', 'Conta'] : ['Sacola', 'Seus dados', 'Pagamento'];
  return `<ol class="steps" aria-label="Etapas do pedido">${steps.map((s, i) => `<li class="${i <= active ? 'on' : ''}" ${i === active ? 'aria-current="step"' : ''}>${s}</li>`).join('')}</ol>`;
}
function headHtml(kicker, title) {
  return `<div class="drawer-head"><div><p class="eyebrow">${kicker}</p><h2>${title}</h2></div><button type="button" class="close" data-close aria-label="Fechar">×</button></div>`;
}
function currentMode() { return isTab() ? 'mesa' : checkoutValues().mode; }

function renderCart(animate = true) {
  const box = $('#cart-content');
  const active = document.activeElement;
  let refocus = null;
  if (!animate && active && box.contains(active)) {
    if (active.name) refocus = `[name="${active.name}"]${active.type === 'radio' ? `[value="${active.value}"]` : ''}`;
    else if (active.dataset.lineQty) refocus = `.line[data-key="${CSS.escape(active.closest('.line').dataset.key)}"] [data-line-qty="${active.dataset.lineQty}"]`;
  }
  const scrollTop = $('.drawer-scroll', box)?.scrollTop || 0;
  if (cartView === 'checkout' && $('#checkout')) checkoutDraft = readCheckout();
  const html = cartView === 'bag' ? bagHtml()
    : cartView === 'checkout' ? checkoutHtml()
    : cartView === 'bill' ? billHtml()
    : statusHtml();
  box.innerHTML = html;
  const scroller = $('.drawer-scroll', box);
  if (!animate) { $$('.view,.line', box).forEach(el => { el.style.animation = 'none'; }); if (scroller) scroller.scrollTop = scrollTop; }
  if (refocus) $(refocus, box)?.focus({ preventScroll: true });
  mountPix();
}

/* ---------- Sacola ---------- */
function bagHtml() {
  const mode = currentMode();
  const orderLink = order ? `<button type="button" class="link-btn" data-view="status">${isTab() ? `Ver comanda da Mesa ${esc(order.table)}` : `Ver pedido #${esc(order.code)}`}</button>` : '';
  if (!cart.length) {
    return `${headHtml(isTab() ? `Mesa ${esc(order.table)}` : 'Seu pedido', 'Sacola')}${stepsHtml(0, mode)}
    <div class="drawer-scroll"><div class="empty view">
      <div class="empty-ico">${ICON.bag}</div>
      <h3>Sua sacola está vazia</h3>
      <p>${isTab() ? 'Quer pedir mais alguma coisa? Toque em + no cardápio.' : 'Explore o cardápio e toque em + para adicionar.'}</p>
      <button type="button" class="btn btn-primary" data-close>Ver o cardápio</button>
      ${orderLink ? `<p style="margin-top:22px">${orderLink}</p>` : ''}
    </div></div>`;
  }
  return `${headHtml(isTab() ? `Mesa ${esc(order.table)} · nova rodada` : 'Seu pedido', 'Sacola')}${stepsHtml(0, mode)}
  <div class="drawer-scroll view">
    <ul class="lines">${cart.map(l => {
      const item = byId.get(l.id);
      const label = lineLabel(l);
      return `<li class="line" data-key="${esc(l.key)}">
        <img src="${thumb(item, 360)}" alt="" loading="lazy">
        <div>
          <p class="line-name">${esc(item.name)}</p>
          ${label ? `<p class="line-meta">${esc(label)}</p>` : ''}
          ${l.note ? `<p class="line-obs">“${esc(l.note)}”</p>` : ''}
          <div class="line-foot">
            <div class="stepper sm" role="group" aria-label="Quantidade de ${esc(item.name)}">
              <button type="button" data-line-qty="-1" aria-label="Diminuir">−</button>
              <output>${l.qty}</output>
              <button type="button" data-line-qty="1" aria-label="Aumentar">+</button>
            </div>
            <span class="line-price">${money(lineUnit(l) * l.qty)}</span>
          </div>
        </div>
        <button type="button" class="line-remove" data-line-remove aria-label="Remover ${esc(item.name)}">×</button>
      </li>`;
    }).join('')}</ul>
    <div class="more-link"><button type="button" class="link-btn" data-close>+ Adicionar mais itens</button></div>
  </div>
  <div class="drawer-foot">
    <div class="summary"><div class="total"><span>${isTab() ? 'Esta rodada' : 'Subtotal'}</span><span>${money(subtotal())}</span></div></div>
    <button type="button" class="btn btn-primary btn-block" data-view="checkout">Continuar · ${cartCount()} ${cartCount() === 1 ? 'item' : 'itens'}</button>
    ${orderLink ? `<div class="foot-links">${orderLink}</div>` : ''}
  </div>`;
}

/* ---------- Checkout ---------- */
function checkoutValues() {
  const d = checkoutDraft || {};
  const modes = enabledModes(), pays = enabledPays();
  return {
    mode: modes.includes(d.mode) ? d.mode : (modes.includes(customer.mode) ? customer.mode : modes[0]),
    name: d.name ?? customer.name ?? '',
    phone: d.phone ?? customer.phone ?? '',
    table: d.table ?? customer.table ?? '',
    address: d.address ?? customer.address ?? '',
    pickup: d.pickup ?? '',
    pay: pays.includes(d.pay) ? d.pay : pays[0],
    notes: d.notes ?? ''
  };
}
function orderTotals(o, feeOn = o.fee) {
  const sub = round2(o.rounds.reduce((s, r) => s + r.sub, 0));
  const fee = o.mode === 'mesa' && feeOn && CFG.serviceFee ? round2(sub * CFG.serviceFee) : 0;
  const delivery = o.mode === 'entrega' ? Number(CFG.deliveryFee) || 0 : 0;
  return { sub, fee, delivery, total: round2(sub + fee + delivery) };
}
function summaryHtml(t, subLabel = 'Subtotal') {
  return `<div class="summary">
    <div><span>${subLabel}</span><span>${money(t.sub)}</span></div>
    ${t.fee ? `<div><span>Taxa de serviço (${Math.round(CFG.serviceFee * 100)}%)</span><span>${money(t.fee)}</span></div>` : ''}
    ${t.delivery ? `<div><span>Taxa de entrega</span><span>${money(t.delivery)}</span></div>` : ''}
    <div class="total"><span>Total</span><span>${money(t.total)}</span></div>
  </div>`;
}
function pickupSlots() {
  const slots = [['', 'O quanto antes (cerca de 30 min)']];
  const d = new Date(Date.now() + 45 * 60000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  for (let i = 0; i < 12; i++) {
    const label = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    slots.push([label, `Às ${label}`]);
    d.setMinutes(d.getMinutes() + 15);
  }
  return slots;
}
function miniList(items) {
  return `<ul class="mini">${items.map(i => `<li><span><b>${i.qty}×</b> ${esc(i.name)}${i.label ? `<small>${esc(i.label)}</small>` : ''}${i.note ? `<small class="obs">“${esc(i.note)}”</small>` : ''}</span><span>${money(i.unit * i.qty)}</span></li>`).join('')}</ul>`;
}
const cartItems = () => cart.map(l => ({ id: l.id, name: byId.get(l.id).name, label: lineLabel(l), note: l.note, qty: l.qty, unit: lineUnit(l) }));

function checkoutHtml() {
  if (!cart.length) { cartView = 'bag'; return bagHtml(); }
  const sub = subtotal();

  // Comanda aberta: só enviar a nova rodada
  if (isTab()) {
    const t = orderTotals(order);
    return `${headHtml(`Mesa ${esc(order.table)}`, 'Nova rodada')}${stepsHtml(1, 'mesa')}
    <div class="drawer-scroll view">
      <form id="checkout" novalidate>
        <input type="hidden" name="mode" value="mesa">
        <div class="info-card">${ICON.mesa}<div><b>Comanda #${esc(order.code)} · ${esc(order.name)}</b><small>${order.rounds.length} ${order.rounds.length === 1 ? 'rodada enviada' : 'rodadas enviadas'} · ${money(t.sub)} até agora</small></div></div>
        <div class="form-section"><h3>Nesta rodada</h3>${miniList(cartItems())}</div>
        <label class="field" style="margin-top:0"><span>Recado para a cozinha <small>opcional</small></span><textarea name="notes" rows="2" maxlength="200" placeholder="Ex.: trazer junto com os pratos">${esc(checkoutDraft?.notes || '')}</textarea></label>
        <p class="hint">Você paga tudo no final: quando terminar, toque em <b>Pedir a conta</b>.</p>
      </form>
    </div>
    <div class="drawer-foot">
      <div class="summary"><div class="total"><span>Esta rodada</span><span>${money(sub)}</span></div></div>
      <button type="submit" form="checkout" class="btn btn-primary btn-block">Enviar para a cozinha · ${money(sub)}</button>
      <div class="foot-links"><button type="button" class="link-btn" data-view="bag">‹ Voltar para a sacola</button></div>
    </div>`;
  }

  const v = checkoutValues();
  const modes = enabledModes(), pays = enabledPays();
  const delivery = v.mode === 'entrega' ? Number(CFG.deliveryFee) || 0 : 0;
  const t = { sub, fee: 0, delivery, total: round2(sub + delivery) };
  const payText = {
    pix: ['Pague agora pelo app do banco. O pedido segue para a cozinha assim que você confirmar.', '<span class="badge">na hora</span>'],
    cartao: [v.mode === 'entrega' ? 'Crédito ou débito na maquininha, na entrega.' : 'Pague no caixa. O preparo começa após o pagamento.', '']
  };
  const cta = v.mode === 'mesa' ? `Abrir comanda e enviar · ${money(t.total)}`
    : v.pay === 'pix' ? `Ir para o pagamento · ${money(t.total)}` : `Enviar pedido · ${money(t.total)}`;

  return `${headHtml('Quase lá', 'Seus dados')}${stepsHtml(1, v.mode)}
  <div class="drawer-scroll view">
    <form id="checkout" novalidate>
      ${modes.length > 1 ? `<div class="form-section"><h3>Onde você vai comer?</h3>
        <div class="seg">${modes.map(m => `<label><input type="radio" name="mode" value="${m}" ${v.mode === m ? 'checked' : ''}><span>${ICON[m]}${MODE_LABEL[m]}</span></label>`).join('')}</div>
      </div>` : `<input type="hidden" name="mode" value="${modes[0]}">`}

      <div class="form-section">
        <h3>Identificação</h3>
        ${v.mode === 'mesa' ? `<div class="row2">
          <label class="field" data-field="table"><span>Número da mesa</span><input name="table" inputmode="numeric" maxlength="4" value="${esc(v.table)}" placeholder="Ex.: 12" autocomplete="off"><em class="err">Informe o número da mesa.</em></label>
          <label class="field" data-field="name"><span>Seu nome</span><input name="name" maxlength="40" value="${esc(v.name)}" placeholder="Como te chamamos?" autocomplete="given-name"><em class="err">Informe seu nome.</em></label>
        </div>` : `<label class="field" data-field="name"><span>Seu nome</span><input name="name" maxlength="40" value="${esc(v.name)}" placeholder="Nome e sobrenome" autocomplete="name"><em class="err">Informe seu nome.</em></label>`}
        <label class="field" data-field="phone"><span>WhatsApp ${v.mode === 'mesa' ? '<small>opcional</small>' : ''}</span><input name="phone" type="tel" inputmode="tel" maxlength="15" value="${esc(v.phone)}" placeholder="(12) 99999-9999" autocomplete="tel-national"><em class="err">Informe um telefone válido com DDD.</em></label>
        ${v.mode === 'entrega' ? `<label class="field" data-field="address"><span>Endereço de entrega</span><textarea name="address" rows="2" maxlength="160" placeholder="Rua, número, complemento e ponto de referência" autocomplete="street-address">${esc(v.address)}</textarea><em class="err">Informe o endereço completo.</em></label>` : ''}
        ${v.mode === 'retirada' ? `<label class="field"><span>Horário de retirada</span><select name="pickup">${pickupSlots().map(([val, label]) => `<option value="${esc(val)}" ${v.pickup === val ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></label>` : ''}
      </div>

      <div class="form-section">
        <h3>Pagamento</h3>
        ${v.mode === 'mesa' ? `<div class="info-card">${ICON.cartao}<div><b>Você paga no final da refeição</b><small>Peça quantas rodadas quiser. Quando terminar, toque em “Pedir a conta” e escolha PIX ou cartão${CFG.serviceFee ? ` (taxa de serviço de ${Math.round(CFG.serviceFee * 100)}% opcional)` : ''}.</small></div></div>`
        : `<div class="pay">${pays.map(p => `<label><input type="radio" name="pay" value="${p}" ${v.pay === p ? 'checked' : ''}>
          <span class="opt"><span class="ico">${ICON[p]}</span><span><b>${PAY_LABEL[p]}${payText[p][1]}</b><small>${payText[p][0]}</small></span><span class="radio"></span></span>
        </label>`).join('')}</div>`}
      </div>

      <label class="field" style="margin-top:0"><span>Observações do pedido <small>opcional</small></span><textarea name="notes" rows="2" maxlength="200" placeholder="Algo que a equipe precisa saber?">${esc(v.notes)}</textarea></label>
    </form>
  </div>
  <div class="drawer-foot">
    ${summaryHtml(t)}
    <button type="submit" form="checkout" class="btn btn-primary btn-block">${cta}</button>
    <div class="foot-links"><button type="button" class="link-btn" data-view="bag">‹ Voltar para a sacola</button></div>
  </div>`;
}

function readCheckout() {
  const f = $('#checkout');
  if (!f) return checkoutDraft || {};
  const val = n => f.elements[n]?.value?.trim?.() ?? undefined;
  return {
    mode: f.querySelector('[name="mode"]:checked')?.value || val('mode'),
    name: val('name'), phone: val('phone'), table: val('table'), address: val('address'),
    pickup: val('pickup'), pay: f.querySelector('[name="pay"]:checked')?.value, notes: val('notes')
  };
}
function maskPhone(v) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function finishCart() {
  cart = [];
  cartView = 'status';
  saveCart();
  checkoutDraft = null;
  renderCart();
  updateOrderChip();
}

function submitCheckout() {
  if (!cart.length) return;
  if (!CFG.orderEndpoint && !CFG.whatsapp) { toast('Envio de pedidos não configurado.'); return; }
  const items = cartItems();
  const sub = subtotal();

  if (isTab()) {
    const round = { n: order.rounds.length + 1, at: Date.now(), items, sub, notes: readCheckout().notes || '' };
    order.rounds.push(round);
    if (order.status === 'conta') { order.status = 'aberta'; order.pay = null; }
    order.justSent = Date.now();
    saveOrder();
    dispatch('rodada', roundMessage(order, round));
    finishCart();
    return;
  }

  const v = Object.assign(checkoutValues(), readCheckout());
  const errors = [];
  if (!v.name) errors.push('name');
  if (v.mode === 'mesa' && !v.table) errors.push('table');
  const digits = (v.phone || '').replace(/\D/g, '');
  if ((v.mode !== 'mesa' && digits.length < 10) || (digits.length > 0 && digits.length < 10)) errors.push('phone');
  if (v.mode === 'entrega' && (v.address || '').length < 8) errors.push('address');
  $$('#checkout .field').forEach(f => f.classList.remove('invalid'));
  if (errors.length) {
    errors.forEach(k => $(`#checkout [data-field="${k}"]`)?.classList.add('invalid'));
    const first = $(`#checkout [data-field="${errors[0]}"] input, #checkout [data-field="${errors[0]}"] textarea`);
    first?.focus();
    first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }

  const now = Date.now();
  order = {
    code: 'TRL-' + String(Math.floor(1000 + Math.random() * 9000)),
    createdAt: now,
    mode: v.mode, name: v.name, phone: v.phone, table: v.table, address: v.address, pickup: v.pickup, notes: v.notes,
    rounds: [{ n: 1, at: now, items, sub, notes: v.notes }],
    pay: v.mode === 'mesa' ? null : v.pay,
    fee: true,
    // mesa: aberta → conta → pago | viagem PIX: aguardando → pago | viagem cartão: caixa
    status: v.mode === 'mesa' ? 'aberta' : v.pay === 'pix' ? 'aguardando' : 'caixa',
    justSent: now
  };
  customer = { mode: v.mode, name: v.name, phone: v.phone, table: v.table, address: v.address };
  store.set('customer', customer);
  saveOrder();
  if (order.status !== 'aguardando') dispatch('pedido', orderMessage(order));
  finishCart();
}

/* ---------- Mensagens (WhatsApp) e envio ---------- */
function whereLine(o) {
  if (o.mode === 'mesa') return `*Mesa ${o.table}* · ${o.name}`;
  if (o.mode === 'retirada') return `*Para viagem* · retirada ${o.pickup ? 'às ' + o.pickup : 'o quanto antes'}\nNome: ${o.name}`;
  return `*Entrega*\nNome: ${o.name}\nEndereço: ${o.address}`;
}
function itemLines(items) {
  return items.flatMap(i => [`${i.qty}x ${i.name}${i.label ? ` (${i.label})` : ''} — ${money(i.unit * i.qty)}`, ...(i.note ? [`   _Obs.: ${i.note}_`] : [])]);
}
function orderMessage(o) {
  const r = o.rounds[0];
  const t = orderTotals(o, false);
  const pay = o.mode === 'mesa' ? 'no final da refeição (comanda aberta)'
    : o.pay === 'pix' ? '*PIX pago pelo cardápio* — comprovante a seguir'
    : o.mode === 'entrega' ? 'cartão na entrega' : '*cartão no caixa* — preparar após o pagamento';
  return [
    `*Novo pedido · ${CFG.restaurant}*`, `Pedido *#${o.code}*`, '', whereLine(o), ...(o.phone ? [`Telefone: ${o.phone}`] : []),
    '', '*Itens*', ...itemLines(r.items), '',
    `Subtotal: ${money(t.sub)}`, ...(t.delivery ? [`Taxa de entrega: ${money(t.delivery)}`] : []), `*Total: ${money(t.total)}*`, '',
    `Pagamento: ${pay}`, ...(o.notes ? [`Observações: ${o.notes}`] : [])
  ].join('\n');
}
function roundMessage(o, r) {
  return [
    `*Mesa ${o.table} · ${ordinal(r.n)} rodada*`, `Comanda *#${o.code}* · ${o.name}`, '', ...itemLines(r.items), '',
    `Esta rodada: ${money(r.sub)}`, `Comanda até agora: ${money(orderTotals(o, false).sub)}`, ...(r.notes ? [`Recado: ${r.notes}`] : [])
  ].join('\n');
}
function billMessage(o) {
  const t = orderTotals(o);
  return [
    `*Mesa ${o.table} pede a conta*`, `Comanda *#${o.code}* · ${o.name}`, '',
    `Consumo: ${money(t.sub)} (${o.rounds.length} ${o.rounds.length === 1 ? 'rodada' : 'rodadas'})`,
    ...(t.fee ? [`Taxa de serviço: ${money(t.fee)}`] : ['Sem taxa de serviço']), `*Total: ${money(t.total)}*`, '',
    o.pay === 'pix' ? 'Pagamento: *PIX pelo cardápio*' : 'Pagamento: *cartão — levar a maquininha à mesa*'
  ].join('\n');
}
function paidMessage(o) {
  const t = orderTotals(o);
  const ref = o.mode === 'mesa' ? `Mesa ${o.table} · comanda #${o.code}` : `pedido #${o.code}`;
  return `*Pagamento via PIX* · ${ref}\nNome: ${o.name}\nValor: *${money(t.total)}*\nVou enviar o comprovante em seguida.`;
}

// Envia para o painel da equipe (canal principal); o WhatsApp só entra em ação
// sozinho se o painel e o backend próprio (orderEndpoint) não estiverem disponíveis.
const PANEL_TOAST = { pedido: 'Pedido enviado para a cozinha', rodada: 'Rodada enviada para a cozinha', conta: 'Conta solicitada — acompanhe no caixa', pagamento: 'Pagamento informado ao caixa' };
async function dispatch(type, text) {
  order.lastMessage = text;
  saveOrder();
  const sentToPanel = await syncOrderToDb(order);
  if (sentToPanel) { toast(PANEL_TOAST[type] || 'Enviado para a cozinha'); return true; }
  if (CFG.orderEndpoint) {
    try {
      const res = await fetch(CFG.orderEndpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
        body: JSON.stringify({ type, text, order, sentAt: new Date().toISOString() })
      });
      if (res.ok) { toast(type === 'conta' ? 'Conta solicitada ao caixa' : 'Enviado para o caixa e a cozinha'); return true; }
    } catch { /* cai para o WhatsApp, nosso plano de segurança */ }
  }
  if (CFG.whatsapp) { openWhatsApp(text); return true; }
  toast('Não foi possível enviar. Chame a equipe.');
  return false;
}
function openWhatsApp(text) {
  const url = `https://wa.me/${CFG.whatsapp}?text=${encodeURIComponent(text)}`;
  const w = window.open(url, '_blank', 'noopener');
  if (!w) location.href = url;
}

/* ================= PIX (BR Code) ================= */
const pixAscii = s => String(s).normalize('NFD').replace(MARKS, '').replace(/[^A-Za-z0-9 ]/g, '').trim();
const tlv = (id, value) => id + String(value.length).padStart(2, '0') + value;
function crc16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
function pixPayload({ key, name, city, amount, txid }) {
  const account = tlv('00', 'br.gov.bcb.pix') + tlv('01', key.trim());
  const payload = tlv('00', '01') + tlv('26', account) + tlv('52', '0000') + tlv('53', '986')
    + (amount > 0 ? tlv('54', amount.toFixed(2)) : '') + tlv('58', 'BR')
    + tlv('59', pixAscii(name).slice(0, 25).toUpperCase()) + tlv('60', pixAscii(city).slice(0, 15).toUpperCase())
    + tlv('62', tlv('05', (txid || '***').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***')) + '6304';
  return payload + crc16(payload);
}
const pixDemo = () => !CFG.pix.key;
const pixFor = (amount, txid) => pixPayload({ key: CFG.pix.key || 'demonstracao@terral.com.br', name: CFG.pix.name, city: CFG.pix.city, amount, txid });

let qrLoading = null;
function loadQr() {
  if (window.qrcode) return Promise.resolve();
  qrLoading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = QR_LIB; s.async = true; s.onload = resolve; s.onerror = () => { qrLoading = null; reject(); };
    document.head.append(s);
  });
  return qrLoading;
}
function mountPix() {
  const boxes = $$('.qr[data-code]');
  if (!boxes.length) return;
  loadQr().then(() => {
    boxes.forEach(box => {
      const qr = window.qrcode(0, 'M');
      qr.addData(box.dataset.code);
      qr.make();
      box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
      const svg = box.querySelector('svg');
      svg?.setAttribute('role', 'img');
      svg?.setAttribute('aria-label', `QR Code PIX de ${box.dataset.amount || ''}`);
    });
  }).catch(() => { boxes.forEach(box => { if (!box.querySelector('svg')) box.innerHTML = '<p class="qr-wait">Não foi possível gerar o QR Code. Use o código copia e cola abaixo.</p>'; }); });
}
function pixCardHtml(amount, txid, title, doneStep) {
  const code = pixFor(amount, txid);
  return `<div class="paycard">
    <div class="paycard-head"><p class="eyebrow">${title}</p><span class="status-pill"><i></i>Aguardando pagamento</span></div>
    <p class="paycard-amount">${money(amount)}</p>
    <div class="qr" id="qr" data-code="${esc(code)}" data-amount="${esc(money(amount))}"><p class="qr-wait">Gerando QR Code…</p></div>
    <div class="copy">
      <input id="pix-code" readonly value="${esc(code)}" aria-label="Código PIX copia e cola">
      <button type="button" class="btn btn-primary" data-copy-pix>Copiar</button>
    </div>
    <ol class="pix-steps">
      <li><b>1</b>Abra o app do seu banco e escolha PIX.</li>
      <li><b>2</b>Leia o QR Code ou cole o código.</li>
      <li><b>3</b>${doneStep}</li>
    </ol>
    ${pixDemo() ? '<p class="demo"><strong>Modo demonstração:</strong> a chave PIX do restaurante ainda não foi configurada. Não pague este código.</p>' : ''}
  </div>`;
}

/* ---------- Pedir a conta (mesa) ---------- */
function billHtml() {
  if (!isTab()) { cartView = 'status'; return statusHtml(); }
  const pays = enabledPays();
  const d = billDraft || {};
  const pay = pays.includes(d.pay) ? d.pay : (pays.includes(order.pay) ? order.pay : pays[0]);
  const fee = d.fee ?? order.fee;
  const t = orderTotals(order, fee);
  const payText = { pix: 'Pague aqui mesmo pelo app do banco, sem esperar.', cartao: 'O garçom leva a maquininha até a sua mesa.' };
  return `${headHtml(`Mesa ${esc(order.table)} · comanda #${esc(order.code)}`, 'Pedir a conta')}${stepsHtml(2, 'mesa')}
  <div class="drawer-scroll view">
    <form id="bill-form" novalidate>
      <div class="form-section"><h3>Seu consumo</h3>${order.rounds.map(r => `<p class="round-title">${ordinal(r.n)} rodada · ${timeOf(r.at)}</p>${miniList(r.items)}`).join('')}</div>
      <div class="form-section">
        <h3>Como prefere pagar?</h3>
        <div class="pay">${pays.map(p => `<label><input type="radio" name="pay" value="${p}" ${pay === p ? 'checked' : ''}>
          <span class="opt"><span class="ico">${ICON[p]}</span><span><b>${PAY_LABEL[p]}</b><small>${payText[p]}</small></span><span class="radio"></span></span>
        </label>`).join('')}</div>
        ${CFG.serviceFee ? `<label class="toggle"><span><b>Taxa de serviço (${Math.round(CFG.serviceFee * 100)}%)</b><small>Opcional · valoriza nossa equipe</small></span><input type="checkbox" name="fee" ${fee ? 'checked' : ''}></label>` : ''}
      </div>
    </form>
  </div>
  <div class="drawer-foot">
    ${summaryHtml(t, 'Consumo')}
    <button type="button" class="btn btn-primary btn-block" data-bill-confirm>${pay === 'pix' ? 'Pagar com PIX' : 'Pedir a conta'} · ${money(t.total)}</button>
    <div class="foot-links"><button type="button" class="link-btn" data-view="status">‹ Voltar para a comanda</button></div>
  </div>`;
}

/* ---------- Acompanhamento ---------- */
function successHtml(title, text) {
  return `<div class="success">
    <svg class="check" viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r="39"/><path d="m27 43 10 10 20-22"/></svg>
    <h3>${title}</h3>${text}
  </div>`;
}
function resendHtml() {
  return order.lastMessage && CFG.whatsapp ? `<p>Não abriu o WhatsApp? <button type="button" class="link-btn" data-resend>Enviar novamente</button></p>` : '';
}

function statusHtml() {
  if (!order) { cartView = 'bag'; return bagHtml(); }
  const recent = Date.now() - (order.justSent || 0) < 3 * 60 * 1000;
  return order.mode === 'mesa' ? tabStatusHtml(recent) : takeawayStatusHtml(recent);
}

function tabStatusHtml(recent) {
  const o = order;
  const t = orderTotals(o);
  const last = o.rounds[o.rounds.length - 1];
  const title = o.status === 'pago' ? 'Obrigado!' : o.status === 'conta' ? 'Sua conta' : 'Sua comanda';
  let top = '';
  if (o.status === 'aberta' && recent) top = successHtml(`${ordinal(last.n)} rodada enviada!`, `<p><span class="code">#${esc(o.code)}</span> · Mesa ${esc(o.table)} · ${timeOf(last.at)}</p><p>Já está com a cozinha. Peça mais quando quiser.</p>${resendHtml()}`);
  if (o.status === 'pago') top = successHtml('Pagamento informado', `<p>A equipe confere o PIX e libera a mesa. Obrigado pela visita e volte sempre!</p>${resendHtml()}`);

  const payBlock = o.status !== 'conta' ? ''
    : o.pay === 'pix' ? pixCardHtml(t.total, o.code, 'Conta da mesa · PIX', 'Toque em “Já paguei” para avisar o caixa.')
    : `<div class="paycard"><div class="paycard-head"><p class="eyebrow">Conta da mesa · Cartão</p><span class="status-pill ok"><i></i>Conta pedida</span></div>
        <p class="paycard-amount">${money(t.total)}</p>
        <p class="paycard-text">O garçom está levando a maquininha até a Mesa ${esc(o.table)}.</p>${resendHtml()}</div>`;

  return `${headHtml(`Mesa ${esc(o.table)} · ${esc(o.name)}`, title)}${stepsHtml(o.status === 'aberta' ? 1 : 2, 'mesa')}
  <div class="drawer-scroll view">
    ${top}
    ${payBlock}
    <div class="tab-card">
      <div class="tab-head"><span>Comanda <b>#${esc(o.code)}</b></span><span>aberta às ${timeOf(o.createdAt)}</span></div>
      ${o.rounds.map(r => `<details class="round" ${r === last ? 'open' : ''}><summary><span>${ordinal(r.n)} rodada · ${timeOf(r.at)}</span><span>${money(r.sub)}</span></summary>${miniList(r.items)}</details>`).join('')}
      ${summaryHtml(t, 'Consumo')}
      ${o.status === 'aberta' && CFG.serviceFee ? `<p class="hint">Taxa de serviço opcional aplicada ao pedir a conta.</p>` : ''}
    </div>
  </div>
  <div class="drawer-foot">
    ${o.status === 'aberta' ? `<button type="button" class="btn btn-primary btn-block" data-view="bill">Pedir a conta · ${money(orderTotals(o, false).sub)}</button>
      <button type="button" class="btn btn-outline btn-block" data-close>${cart.length ? 'Voltar ao cardápio' : 'Pedir mais itens'}</button>` : ''}
    ${o.status === 'conta' && o.pay === 'pix' ? `<button type="button" class="btn btn-wa btn-block" data-paid>${ICON.wa} Já paguei · avisar o caixa</button>
      <div class="foot-links"><button type="button" class="link-btn" data-view="bill">Trocar forma de pagamento</button></div>` : ''}
    ${o.status === 'conta' && o.pay === 'cartao' ? `<button type="button" class="btn btn-outline btn-block" data-view="bill">Trocar para PIX</button>` : ''}
    ${o.status === 'pago' ? `<button type="button" class="btn btn-primary btn-block" data-forget>Encerrar comanda</button>` : ''}
    ${cart.length && o.status !== 'pago' ? `<div class="foot-links"><button type="button" class="link-btn" data-view="bag">Sacola com ${cartCount()} ${cartCount() === 1 ? 'item' : 'itens'} para a próxima rodada</button></div>` : ''}
  </div>`;
}

function takeawayStatusHtml(recent) {
  const o = order;
  const t = orderTotals(o);
  const r = o.rounds[0];
  const when = o.mode === 'retirada' ? `retirada ${o.pickup ? 'às ' + o.pickup : 'o quanto antes'}` : 'entrega';
  let body = '';
  let foot = '';
  if (o.status === 'aguardando') {
    body = pixCardHtml(t.total, o.code, `Pedido #${esc(o.code)} · para viagem`, 'Toque em “Já paguei · enviar pedido”. Ele vai direto para a cozinha.');
    foot = `<button type="button" class="btn btn-wa btn-block" data-paid>${ICON.wa} Já paguei · enviar pedido</button>
      ${CFG.payments.cartao ? `<div class="foot-links"><button type="button" class="link-btn" data-switch-card>Prefiro pagar com cartão no caixa</button></div>` : ''}
      <div class="foot-links"><button type="button" class="link-btn" data-forget>Cancelar pedido</button></div>`;
  } else if (o.status === 'caixa') {
    body = successHtml('Pedido registrado!', `<p><span class="code">#${esc(o.code)}</span> · ${esc(when)}</p>${resendHtml()}`)
      + `<div class="paycard"><div class="paycard-head"><p class="eyebrow">Pagamento · Cartão</p><span class="status-pill"><i></i>${o.mode === 'entrega' ? 'Na entrega' : 'No caixa'}</span></div>
        <p class="paycard-amount">${money(t.total)}</p>
        <p class="paycard-text">${o.mode === 'entrega' ? 'O entregador leva a maquininha.' : `Vá ao caixa, informe o pedido <b>#${esc(o.code)}</b> e pague com cartão. O preparo começa logo após o pagamento.`}</p></div>`;
    foot = `<button type="button" class="btn btn-outline btn-block" data-close>Voltar ao cardápio</button>
      <div class="foot-links"><button type="button" class="link-btn" data-forget>Remover este pedido do aparelho</button></div>`;
  } else {
    body = successHtml('Pedido enviado!', `<p><span class="code">#${esc(o.code)}</span> · ${esc(when)}</p><p><span class="status-pill ok"><i></i>PIX informado</span></p><p>A equipe confere o comprovante e começa o preparo.</p>${resendHtml()}`);
    foot = `<button type="button" class="btn btn-outline btn-block" data-close>Voltar ao cardápio</button>
      <div class="foot-links"><button type="button" class="link-btn" data-forget>Remover este pedido do aparelho</button></div>`;
  }
  return `${headHtml(`${MODE_LABEL[o.mode]} · ${esc(o.name)}`, o.status === 'aguardando' ? 'Pagamento' : 'Tudo certo')}${stepsHtml(2, o.mode)}
  <div class="drawer-scroll view">
    ${body}
    <details class="receipt" ${o.status === 'aguardando' ? '' : 'open'}>
      <summary>Resumo do pedido</summary>
      ${miniList(r.items)}
      ${summaryHtml(t)}
    </details>
  </div>
  <div class="drawer-foot">${foot}</div>`;
}

/* ---------- Eventos do painel ---------- */
function setupCart() {
  const dlg = $('#cart');
  dlg.addEventListener('click', e => {
    const t = e.target;
    const lineEl = t.closest('.line');
    if (t.closest('[data-line-qty]')) {
      const line = cart.find(l => l.key === lineEl.dataset.key);
      line.qty += Number(t.closest('[data-line-qty]').dataset.lineQty);
      if (line.qty <= 0) return removeLine(lineEl);
      saveCart();
    } else if (t.closest('[data-line-remove]')) removeLine(lineEl);
    else if (t.closest('[data-view]')) {
      cartView = t.closest('[data-view]').dataset.view;
      if (cartView === 'bill') billDraft = null;
      renderCart();
      $('.drawer-scroll', dlg)?.scrollTo(0, 0);
    }
    else if (t.closest('[data-copy-pix]')) copyPix(t.closest('[data-copy-pix]'));
    else if (t.closest('[data-resend]')) openWhatsApp(order.lastMessage);
    else if (t.closest('[data-bill-confirm]')) {
      const d = readBill();
      order.pay = d.pay;
      order.fee = d.fee;
      order.status = 'conta';
      order.billAt = Date.now();
      saveOrder();
      if (order.pay === 'cartao') dispatch('conta', billMessage(order));
      cartView = 'status';
      renderCart();
    } else if (t.closest('[data-paid]')) {
      if (order.mode === 'mesa') dispatch('pagamento', paidMessage(order));
      else { order.justSent = Date.now(); dispatch('pedido', orderMessage(order)); }
      order.status = 'pago';
      order.paidAt = Date.now();
      saveOrder();
      renderCart();
    } else if (t.closest('[data-switch-card]')) {
      order.pay = 'cartao';
      order.status = 'caixa';
      order.justSent = Date.now();
      saveOrder();
      dispatch('pedido', orderMessage(order));
      renderCart();
    } else if (t.closest('[data-forget]')) {
      if (order && order.status === 'aguardando') { order.status = 'cancelado'; syncOrderToDb(order); }
      order = null;
      store.set('order', null);
      updateOrderChip();
      cartView = 'bag';
      closeDialog(dlg);
      toast('Pedido encerrado neste aparelho');
    }
  });
  dlg.addEventListener('submit', e => { e.preventDefault(); if (e.target.id === 'checkout') submitCheckout(); });
  dlg.addEventListener('input', e => {
    if (e.target.name === 'phone') e.target.value = maskPhone(e.target.value);
    if (e.target.name === 'table') e.target.value = e.target.value.replace(/[^0-9A-Za-z]/g, '');
    e.target.closest('.field')?.classList.remove('invalid');
  });
  dlg.addEventListener('change', e => {
    if (cartView === 'bill' && ['pay', 'fee'].includes(e.target.name)) { billDraft = readBill(); renderCart(false); }
    else if (['mode', 'pay'].includes(e.target.name)) renderCart(false);
  });
  dlg.addEventListener('close', () => { if (cartView === 'checkout') checkoutDraft = readCheckout(); });
}
function readBill() {
  const f = $('#bill-form');
  return { pay: f?.querySelector('[name="pay"]:checked')?.value || enabledPays()[0], fee: f?.elements.fee ? f.elements.fee.checked : false };
}
function removeLine(el) {
  const key = el.dataset.key;
  const done = () => { cart = cart.filter(l => l.key !== key); saveCart(); };
  if (reduced.matches) return done();
  el.classList.add('removing');
  el.addEventListener('animationend', done, { once: true });
}
async function copyPix(btn) {
  const input = $('#pix-code');
  try { await navigator.clipboard.writeText(input.value); }
  catch { input.select(); document.execCommand('copy'); }
  btn.textContent = 'Copiado ✓';
  toast('Código PIX copiado');
  setTimeout(() => { btn.textContent = 'Copiar'; }, 2200);
}

function updateOrderChip() {
  const chip = $('#order-chip');
  if (order && (!order.rounds || Date.now() - order.createdAt > ORDER_TTL)) { order = null; store.set('order', null); }
  if (!order) { chip.hidden = true; return; }
  const o = order;
  const labels = {
    aberta: [`Mesa ${o.table} · Comanda ${money(orderTotals(o, false).sub)}`, false],
    conta: [o.pay === 'pix' ? `Mesa ${o.table} · Pagar a conta` : `Mesa ${o.table} · Conta pedida`, o.pay === 'pix'],
    aguardando: [`Pedido #${o.code} · Pagar com PIX`, true],
    caixa: [o.mode === 'entrega' ? `Pedido #${o.code} · Cartão na entrega` : `Pedido #${o.code} · Pagar no caixa`, true],
    pago: [o.mode === 'mesa' ? `Mesa ${o.table} · Conta paga` : `Pedido #${o.code} · Enviado`, false]
  };
  const [text, pending] = labels[o.status] || [`Pedido #${o.code}`, false];
  chip.hidden = false;
  chip.classList.toggle('ok', !pending);
  chip.innerHTML = `<i aria-hidden="true"></i>${esc(text)}`;
}

/* ================= Painel da equipe (cozinha & caixa) ================= */
const PANEL_STATUS_LABEL = { aberta: 'Em aberto', conta: 'Conta pedida', pago: 'Pago', aguardando: 'Aguardando PIX', caixa: 'Pagar no caixa', cancelado: 'Cancelado' };

function paintPanelShell() {
  document.body.classList.add('painel-mode');
  let root = document.getElementById('painel-root');
  if (!root) { root = document.createElement('div'); root.id = 'painel-root'; document.body.appendChild(root); }
  return root;
}
function renderPinGate(root, onOk) {
  root.innerHTML = `<div class="pin-gate">
    <img src="assets/marca/terral-logo-branco-sm.webp" alt="Terral" width="220" height="126">
    <h1>Painel da equipe</h1>
    <p>Digite a senha para continuar.</p>
    <form id="pin-form"><input type="password" autocomplete="off" placeholder="Senha" autofocus><button type="submit" class="btn btn-primary">Entrar</button></form>
    <p class="pin-err" hidden>Senha incorreta.</p>
  </div>`;
  root.querySelector('#pin-form').addEventListener('submit', e => {
    e.preventDefault();
    const val = root.querySelector('input').value.trim();
    if (val === String(CFG.teamPin || '1987')) { sessionStorage.setItem('terral:pin-ok', '1'); sessionStorage.setItem('terral:pin', val); onOk(); }
    else { root.querySelector('.pin-err').hidden = false; root.querySelector('input').value = ''; root.querySelector('input').focus(); }
  });
}
function startClock(root) {
  const tick = () => { const el = root.querySelector('.painel-clock'); if (el) el.textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
  tick(); setInterval(tick, 1000);
}

function orderCardHtml(o) {
  const t = orderTotals(o, false);
  const where = o.mode === 'mesa' ? `Mesa ${esc(o.table)}` : o.mode === 'retirada' ? 'Para viagem' : 'Entrega';
  return `<article class="ord-card status-${esc(o.status)}" data-code="${esc(o.code)}">
    <header class="ord-head">
      <div><b>${esc(where)}</b><span>${esc(o.name || '')}</span></div>
      <div class="ord-meta"><span class="ord-code">#${esc(o.code)}</span><span class="ord-time">${timeOf(o.createdAt)}</span></div>
    </header>
    ${o.rounds.map(r => `<div class="ord-round">
      <p class="ord-round-h"><b>${o.mode === 'mesa' ? ordinal(r.n) + ' rodada' : 'Itens do pedido'}</b><span>${timeOf(r.at)}</span></p>
      ${miniList(r.items)}
      ${r.notes ? `<p class="ord-note">Recado: ${esc(r.notes)}</p>` : ''}
    </div>`).join('')}
    <footer class="ord-foot"><span class="badge-status">${esc(PANEL_STATUS_LABEL[o.status] || o.status)}</span><span>${money(t.sub)}</span></footer>
  </article>`;
}
function startCozinha(root) {
  root.innerHTML = `<div class="painel cozinha">
    <header class="painel-top"><h1>Cozinha</h1><span class="painel-clock"></span></header>
    <div class="painel-list" id="pcz-list"><p class="painel-empty">Carregando…</p></div>
  </div>`;
  startClock(root);
  const statuses = ['aberta', 'conta', 'aguardando', 'caixa'];
  dbReady.then(() => {
    const list = () => $('#pcz-list');
    if (DB) {
      DB.collection('orders').where('status', 'in', statuses).orderBy('createdAt')
        .onSnapshot(snap => {
          if (!list()) return;
          list().innerHTML = snap.empty ? '<p class="painel-empty">Nenhum pedido em aberto agora.</p>' : snap.docs.map(d => orderCardHtml(d.data())).join('');
        }, () => { if (list()) list().innerHTML = '<p class="painel-empty">Não foi possível carregar os pedidos.</p>'; });
      return;
    }
    if (CFG.orderEndpoint) {
      pollOrders(CFG.orderEndpoint + '?status=' + statuses.join(','), orders => {
        if (!list()) return;
        list().innerHTML = orders.length ? orders.map(orderCardHtml).join('') : '<p class="painel-empty">Nenhum pedido em aberto agora.</p>';
      });
      return;
    }
    if (list()) list().innerHTML = '<p class="painel-empty">Painel indisponível nesta versão do cardápio.</p>';
  });
}

function receiptHtml(o) {
  const t = orderTotals(o);
  const allItems = o.rounds.flatMap(r => r.items);
  const where = o.mode === 'mesa' ? `Mesa ${esc(o.table)}` : o.mode === 'retirada' ? 'Para viagem' : 'Entrega';
  return `<div class="receipt-print">
    <h2>${esc(CFG.restaurant)}</h2>
    <p>${esc(where)} · #${esc(o.code)}</p>
    ${o.name ? `<p>${esc(o.name)}</p>` : ''}
    <hr>
    ${allItems.map(i => `<div class="rline"><span>${i.qty}x ${esc(i.name)}${i.label ? ' (' + esc(i.label) + ')' : ''}</span><span>${money(i.unit * i.qty)}</span></div>`).join('')}
    <hr>
    <div class="rline"><span>Subtotal</span><span>${money(t.sub)}</span></div>
    ${t.fee ? `<div class="rline"><span>Serviço</span><span>${money(t.fee)}</span></div>` : ''}
    ${t.delivery ? `<div class="rline"><span>Entrega</span><span>${money(t.delivery)}</span></div>` : ''}
    <div class="rline total"><span>Total</span><span>${money(t.total)}</span></div>
    <p>Pagamento: ${o.pay === 'pix' ? 'PIX' : 'Cartão'}</p>
    <p class="rfoot">Obrigado pela visita!</p>
  </div>`;
}
function printReceipt(o) {
  let host = document.getElementById('receipt-host');
  if (!host) { host = document.createElement('div'); host.id = 'receipt-host'; document.body.appendChild(host); }
  host.innerHTML = receiptHtml(o);
  setTimeout(() => window.print(), 60);
}
async function printOrderByCode(code) {
  await dbReady;
  if (DB) { const snap = await DB.collection('orders').doc(code).get(); if (snap.exists) printReceipt(snap.data()); return; }
  if (CFG.orderEndpoint) {
    const data = await apiGet(CFG.orderEndpoint + '/' + encodeURIComponent(code));
    if (data?.order) printReceipt(data.order);
  }
}
async function confirmPayment(code) {
  await dbReady;
  if (DB) {
    const ref = DB.collection('orders').doc(code);
    const snap = await ref.get();
    if (!snap.exists) return;
    const o = Object.assign({}, snap.data());
    o.status = 'pago';
    o.paidAt = Date.now();
    await ref.set(o);
    printReceipt(o);
    toast('Pagamento confirmado');
    return;
  }
  if (CFG.orderEndpoint) {
    const data = await apiPost(CFG.orderEndpoint + '/' + encodeURIComponent(code) + '/pay', {});
    if (data?.order) { printReceipt(data.order); toast('Pagamento confirmado'); }
    else toast('Não foi possível confirmar. Tente novamente.');
  }
}
async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); } catch { /* sem permissão de área de transferência */ }
  if (btn) { const old = btn.textContent; btn.textContent = 'Copiado ✓'; setTimeout(() => { btn.textContent = old; }, 2000); }
  toast('Código copiado');
}
function caixaCardHtml(o) {
  const t = orderTotals(o);
  const where = o.mode === 'mesa' ? `Mesa ${esc(o.table)}` : o.mode === 'retirada' ? 'Para viagem' : 'Entrega';
  const code = o.pay === 'pix' ? pixFor(t.total, o.code) : '';
  return `<article class="ord-card caixa-card" data-code="${esc(o.code)}">
    <header class="ord-head">
      <div><b>${esc(where)}</b><span>${esc(o.name || '')}</span></div>
      <div class="ord-meta"><span class="ord-code">#${esc(o.code)}</span><span class="badge-status">${esc(PANEL_STATUS_LABEL[o.status] || o.status)}</span></div>
    </header>
    ${summaryHtml(t, 'Consumo')}
    ${o.pay === 'pix' ? `<div class="qr" data-code="${esc(code)}" data-amount="${esc(money(t.total))}"><p class="qr-wait">Gerando QR Code…</p></div>
      <div class="copy"><input readonly value="${esc(code)}"><button type="button" class="btn btn-outline" data-copy="${esc(code)}">Copiar</button></div>`
      : `<p class="hint">Pagamento na maquininha (cartão).</p>`}
    <div class="caixa-actions">
      <button type="button" class="btn btn-primary" data-confirm-pay="${esc(o.code)}">Confirmar pagamento recebido</button>
      <button type="button" class="btn btn-outline" data-print="${esc(o.code)}">🖨️ Imprimir comprovante</button>
    </div>
  </article>`;
}
function startCaixa(root) {
  root.innerHTML = `<div class="painel caixa">
    <header class="painel-top"><h1>Caixa</h1><span class="painel-clock"></span></header>
    <div class="painel-list" id="pcx-list"><p class="painel-empty">Carregando…</p></div>
    <details class="painel-history"><summary>Pagos hoje</summary><div id="pcx-hist"><p class="painel-empty">—</p></div></details>
  </div>`;
  startClock(root);
  root.addEventListener('click', e => {
    const t = e.target;
    const confirmBtn = t.closest('[data-confirm-pay]');
    const printBtn = t.closest('[data-print]');
    const copyBtn = t.closest('[data-copy]');
    if (confirmBtn) confirmPayment(confirmBtn.dataset.confirmPay);
    else if (printBtn) printOrderByCode(printBtn.dataset.print);
    else if (copyBtn) copyText(copyBtn.dataset.copy, copyBtn);
  });
  const pendStatuses = ['conta', 'aguardando', 'caixa'];
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const histHtml = orders => {
    const hist = $('#pcx-hist');
    if (!hist) return;
    const todays = orders.filter(o => o.createdAt >= todayStart.getTime());
    hist.innerHTML = todays.length ? todays.map(o => `<div class="hist-row"><span>#${esc(o.code)} · ${o.mode === 'mesa' ? 'Mesa ' + esc(o.table) : MODE_LABEL[o.mode]}</span><span>${money(orderTotals(o).total)}</span></div>`).join('') : '<p class="painel-empty">Nada pago ainda hoje.</p>';
  };
  dbReady.then(() => {
    const list = () => $('#pcx-list');
    if (DB) {
      DB.collection('orders').where('status', 'in', pendStatuses).orderBy('createdAt')
        .onSnapshot(snap => {
          if (!list()) return;
          list().innerHTML = snap.empty ? '<p class="painel-empty">Nenhuma conta pendente agora.</p>' : snap.docs.map(d => caixaCardHtml(d.data())).join('');
          mountPix();
        });
      DB.collection('orders').where('status', '==', 'pago').orderBy('createdAt')
        .onSnapshot(snap => histHtml(snap.docs.map(d => d.data())));
      return;
    }
    if (CFG.orderEndpoint) {
      pollOrders(CFG.orderEndpoint + '?status=' + pendStatuses.join(','), orders => {
        if (!list()) return;
        list().innerHTML = orders.length ? orders.map(caixaCardHtml).join('') : '<p class="painel-empty">Nenhuma conta pendente agora.</p>';
        mountPix();
      });
      pollOrders(CFG.orderEndpoint + '?status=pago', histHtml, 15000);
      return;
    }
    if (list()) list().innerHTML = '<p class="painel-empty">Painel indisponível nesta versão do cardápio.</p>';
  });
}
async function initPainel(view) {
  document.title = (view === 'caixa' ? 'Caixa' : 'Cozinha') + ' · Terral';
  const root = paintPanelShell();
  const start = () => view === 'caixa' ? startCaixa(root) : startCozinha(root);
  if (sessionStorage.getItem('terral:pin-ok') === '1') start();
  else renderPinGate(root, start);
}

/* ================= Toast ================= */
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

/* ================= Inicialização ================= */
function setupGlobalClicks() {
  document.addEventListener('click', e => {
    const add = e.target.closest('[data-add]');
    if (add) {
      const item = byId.get(add.dataset.add);
      if (needsChoice(item)) { openDetail(item.id); return; }
      addToCart({ id: item.id });
      flyToCart(add.closest('.dish, .feat')?.querySelector('img'));
      return;
    }
    const open = e.target.closest('[data-open]');
    if (open) { openDetail(open.dataset.open); return; }
    if (e.target.closest('[data-open-cart]')) openCart();
  });
  $('#order-chip').addEventListener('click', () => openCart('status'));
}

async function init() {
  const routeHash = location.hash.slice(1);
  if (routeHash === 'cozinha' || routeHash === 'caixa') { await initPainel(routeHash); return; }
  setupDialogs();
  setupDetail();
  setupCart();
  setupGlobalClicks();
  updateOrderChip();
  try {
    const res = await fetch('menu.json');
    if (!res.ok) throw new Error('menu');
    catalog = await res.json();
  } catch {
    $('#kitchen-sections').innerHTML ='<div class="error-state"><p>Não foi possível carregar o cardápio.</p><button type="button" class="btn btn-primary" onclick="location.reload()">Tentar novamente</button></div>';
    return;
  }
  byId = new Map(catalog.map(x => [x.id, x]));
  $$('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });
  cart = cart.filter(l => byId.has(l.id) && orderable(byId.get(l.id)) && l.qty > 0);
  renderMenu();
  setupReveal();
  setupCatbar();
  setupSearch();
  setupEffects();
  updateCartUI();

  const hash = location.hash.slice(1);
  if (hash && document.getElementById(hash)?.classList.contains('cat')) {
    document.getElementById(hash).scrollIntoView({ block: 'start' });
  }
  requestAnimationFrame(spy);
  document.fonts?.ready.then(() => moveIndicator());
}
init();
