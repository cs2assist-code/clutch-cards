// Карточка результата: картинка 1080×1080 (кадр карты, исход, агент, рейтинг) и отправка в Telegram/соцсети.
// В Telegram и на телефонах — системное «Поделиться» с файлом; если его нет — картинка открывается
// поверх игры (долгое нажатие — сохранить), а текст со ссылкой уходит через t.me/share.
import { shareLink } from './online/client';

export interface ShareInfo {
  win: boolean; title: string; subtitle: string; map: string; mapImg?: string;
  agentName: string; agentImg?: string; side: 'T' | 'CT'; rating?: { before: number; after: number; league: string }; mode: string;
}

const load = (src?: string) => new Promise<HTMLImageElement | null>((res) => {
  if (!src) return res(null);
  const i = new Image(); i.crossOrigin = 'anonymous';
  i.onload = () => res(i); i.onerror = () => res(null); i.src = src;
});

export async function renderCard(s: ShareInfo): Promise<Blob | null> {
  const W = 1080, c = document.createElement('canvas'); c.width = W; c.height = W;
  const g = c.getContext('2d'); if (!g) return null;
  const [bg, ag] = await Promise.all([load(s.mapImg), load(s.agentImg)]);
  g.fillStyle = '#101318'; g.fillRect(0, 0, W, W);
  if (bg) { const k = Math.max(W / bg.width, W / bg.height); g.globalAlpha = 0.55; g.drawImage(bg, (W - bg.width * k) / 2, (W - bg.height * k) / 2, bg.width * k, bg.height * k); g.globalAlpha = 1; }
  const grd = g.createLinearGradient(0, 0, 0, W); grd.addColorStop(0, 'rgba(10,12,16,.35)'); grd.addColorStop(0.55, 'rgba(10,12,16,.75)'); grd.addColorStop(1, 'rgba(10,12,16,.95)');
  g.fillStyle = grd; g.fillRect(0, 0, W, W);
  const accent = s.win ? '#7ed957' : '#e0343a', sideC = s.side === 'T' ? '#e8b04a' : '#5aa8e8';
  g.fillStyle = accent; g.fillRect(0, 0, W, 14);
  g.textAlign = 'center';
  g.fillStyle = '#f2c14e'; g.font = '700 54px "Russo One", Impact, sans-serif'; g.fillText('КЛАТЧ', W / 2, 110);
  g.fillStyle = '#c9ced6'; g.font = '600 30px Onest, Arial, sans-serif'; g.fillText(s.mode, W / 2, 158);
  if (ag) {
    g.save(); g.beginPath(); g.arc(W / 2, 400, 170, 0, Math.PI * 2); g.closePath(); g.fillStyle = '#1b1f27'; g.fill(); g.clip();
    const k = Math.max(340 / ag.width, 340 / ag.height); g.drawImage(ag, W / 2 - (ag.width * k) / 2, 400 - (ag.height * k) / 2, ag.width * k, ag.height * k); g.restore();
    g.lineWidth = 10; g.strokeStyle = sideC; g.beginPath(); g.arc(W / 2, 400, 172, 0, Math.PI * 2); g.stroke();
  }
  g.fillStyle = accent; g.font = '700 120px "Russo One", Impact, sans-serif'; g.fillText(s.title, W / 2, 720);
  g.fillStyle = '#e9ecf1'; g.font = '600 40px Onest, Arial, sans-serif'; g.fillText(s.subtitle, W / 2, 785);
  g.fillStyle = '#aab1bc'; g.font = '500 34px Onest, Arial, sans-serif'; g.fillText(`${s.agentName} · ${s.side} · ${s.map}`, W / 2, 845);
  if (s.rating) {
    const d = s.rating.after - s.rating.before;
    g.fillStyle = d >= 0 ? '#7ed957' : '#e0343a'; g.font = '700 46px Onest, Arial, sans-serif';
    g.fillText(`${s.rating.after} (${d >= 0 ? '+' : ''}${d}) · ${s.rating.league}`, W / 2, 925);
  }
  g.fillStyle = '#6b7380'; g.font = '500 26px Onest, Arial, sans-serif'; g.fillText('Карточная тактика по CS2 в Telegram', W / 2, 1035);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
}

/** Поделиться карточкой. Возвращает, как удалось: системным меню с файлом или показом картинки. */
export async function shareResult(s: ShareInfo, text: string): Promise<'file' | 'shown' | 'fail'> {
  const blob = await renderCard(s);
  if (!blob) return 'fail';
  const file = new File([blob], 'clutch.png', { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?(d: ShareData): boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], text }); return 'file'; } catch { /* отменили — покажем картинку */ }
  }
  showImage(URL.createObjectURL(blob), text);
  return 'shown';
}

function showImage(url: string, text: string) {
  const ov = document.createElement('div');
  ov.className = 'share-ov';
  ov.innerHTML = `<div class="share-box"><img src="${url}" alt="Карточка результата"><p>Долгое нажатие на картинку — сохранить</p>
    <button class="primary" data-x="send">Отправить текст в Telegram</button><button class="ghost" data-x="close">Закрыть</button></div>`;
  ov.addEventListener('click', (e) => {
    const x = (e.target as HTMLElement).dataset.x;
    if (x === 'send') void shareLink(location.href.split('#')[0].split('?')[0], text);
    if (x === 'close' || e.target === ov) { ov.remove(); URL.revokeObjectURL(url); }
  });
  document.body.appendChild(ov);
}
