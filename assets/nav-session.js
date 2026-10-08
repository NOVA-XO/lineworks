/* Толгойн данс холбоос — бүтэц ба хэв маяг Astra (2026-10-08), эзний жишээ зургаар. */
/*
 * Нийтийн хуудсанд хадгалсан session-оос цэсний нэрийг шинэчилнэ.
 * Энэ нь эрхийн шалгалт биш; portal хуудсанд wireNav() баталгаажуулна.
 * SVG болон холбоосыг дахин үүсгэхгүй.
 */
(() => {
  const KEY = 'sb-yfusttksvhdssjizxebc-auth-token';

  const slot = document.getElementById('nav-account');
  const link = slot?.querySelector('.nav-user');
  const label = link?.querySelector('.nav-user-label');

  if (!slot || !link || !label) return;

  function update() {
    // Portal session-оо уншсан бол түүний төлөвийг давж бичихгүй.
    if (slot.dataset.sessionOwner === 'portal') return;

    let session = null;

    try {
      session = JSON.parse(localStorage.getItem(KEY) || 'null');
    } catch {
      // Storage хаалттай эсвэл JSON эвдэрсэн бол Нэвтрэх гэж үзүүлнэ.
    }

    const signedIn = Boolean(session?.refresh_token && session?.user);
    const text = signedIn ? 'Миний хуудас' : 'Нэвтрэх';
    const email = signedIn && typeof session.user.email === 'string'
      ? session.user.email
      : '';

    label.textContent = text;
    link.setAttribute('aria-label', text);
    link.setAttribute('title', email ? `${text} — ${email}` : text);
  }

  update();

  window.addEventListener('storage', (event) => {
    if (event.key === KEY || event.key === null) update();
  });

  // Back/Forward cache-аас буцаж ирэхэд шинэчилнэ.
  window.addEventListener('pageshow', update);
})();
