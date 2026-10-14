// Тонкая обёртка над Telegram WebApp SDK. Вне Telegram всё молча работает как no-op.
type Haptic = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
interface TgWebApp {
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  setHeaderColor?(c: string): void;
  setBackgroundColor?(c: string): void;
  initDataUnsafe?: { user?: { first_name?: string; username?: string } };
  HapticFeedback?: {
    impactOccurred(s: Haptic): void;
    notificationOccurred(t: 'error' | 'success' | 'warning'): void;
    selectionChanged(): void;
  };
  BackButton?: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  isVersionAtLeast?(v: string): boolean;
}

declare global {
  interface Window { Telegram?: { WebApp?: TgWebApp } }
}

const tg = (): TgWebApp | undefined => (typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined);
const safe = (fn: () => void) => { try { fn(); } catch { /* старые клиенты Telegram */ } };

export function initTelegram(bg: string) {
  const w = tg();
  if (!w) return;
  safe(() => w.ready());
  safe(() => w.expand());
  safe(() => w.disableVerticalSwipes?.());
  safe(() => w.setHeaderColor?.(bg));
  safe(() => w.setBackgroundColor?.(bg));
}

export const userName = () => tg()?.initDataUnsafe?.user?.first_name ?? 'Игрок';

export const haptic = {
  tap: () => safe(() => tg()?.HapticFeedback?.selectionChanged()),
  hit: (s: Haptic = 'medium') => safe(() => tg()?.HapticFeedback?.impactOccurred(s)),
  win: () => safe(() => tg()?.HapticFeedback?.notificationOccurred('success')),
  lose: () => safe(() => tg()?.HapticFeedback?.notificationOccurred('error')),
  deny: () => safe(() => tg()?.HapticFeedback?.notificationOccurred('warning')),
};

let backCb: (() => void) | null = null;
export function setBackButton(cb: (() => void) | null) {
  const b = tg()?.BackButton;
  if (!b) return;
  safe(() => {
    if (backCb) b.offClick(backCb);
    backCb = cb;
    if (cb) { b.onClick(cb); b.show(); } else b.hide();
  });
}
