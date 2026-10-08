/* Толгойн цэсний «Нэвтрэх» — нэвтэрсэн бол «Миний хуудас» болгоно.

   Нүүр, Татах, Лиценз хуудас Supabase-ийн санг ачаалдаггүй (хурд, CDN-гүй) тул
   цэс нь үргэлж «Нэвтрэх» гэж харуулдаг байв (эзэн, 2026-10-08). Энэ скрипт сүлжээнд
   гарахгүй: supabase-js-ийн хадгалсан сессийг (localStorage) л уншина. Сесс хүчинтэй
   эсэхийг шийддэг нь энэ биш — account.html нээгдэхэд сан өөрөө шалгана; энэ нь зөвхөн
   цэсний бичиг. account/admin хуудсанд portal.js-ийн wireNav() дараа нь дарж бичнэ. */
(() => {
  const KEY = 'sb-yfusttksvhdssjizxebc-auth-token';
  const slot = document.getElementById('nav-account');
  if (!slot) { return; }
  let session = null;
  try {
    session = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    session = null;
  }
  if (!session || !session.refresh_token || !session.user) { return; }
  const link = slot.querySelector('a') || document.createElement('a');
  link.href = 'account.html';
  link.textContent = 'Миний хуудас';
  if (session.user.email) { link.title = session.user.email; }
  if (!link.parentNode) { slot.append(link); }
})();
