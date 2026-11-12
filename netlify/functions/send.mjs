// Gira ogni 15 minuti: manda la notifica a chi ha scelto l'orario corrente,
// con quello che va esposto per la raccolta del giorno dopo.
import webpush from 'web-push';
import { getStore } from '@netlify/blobs';
import { DATA, itemsFor, message, addDays } from '../../public/shared.mjs';
import { vapid } from '../lib/push.mjs';

export function romeSlot(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(x => [x.type, x.value]));
  const min = Math.round((+p.hour * 60 + +p.minute) / 15) * 15;
  if (min >= 1440) return null;
  const pad = n => String(n).padStart(2, '0');
  return { today: `${p.year}-${p.month}-${p.day}`, slot: pad(min / 60 | 0) + ':' + pad(min % 60) };
}

export default async () => {
  const r = romeSlot();
  if (!r) return;
  const tomorrow = addDays(r.today, 1);
  const codes = DATA[tomorrow];
  if (!codes) { console.log(r.slot, tomorrow, 'nessuna raccolta'); return; }

  const store = getStore({ name: 'subs', consistency: 'strong' });
  const { blobs } = await store.list({ prefix: 't/' + r.slot + '/' });
  if (!blobs.length) return;
  const k = await vapid();
  webpush.setVapidDetails(k.subject, k.publicKey, k.privateKey);

  let sent = 0, gone = 0;
  await Promise.all(blobs.map(async ({ key }) => {
    const s = await store.get(key, { type: 'json' });
    if (!s) return;
    const items = itemsFor(codes, s.zone, s.xtra);
    if (!items.length) return;
    try {
      await webpush.sendNotification(s.subscription, JSON.stringify({ ...message(tomorrow, items), tag: 'rifiuti-' + tomorrow }), { TTL: 6 * 3600 });
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {   // iscrizione scaduta o revocata
        const id = key.split('/').pop();
        await store.delete(key); await store.delete('i/' + id); gone++;
      } else console.error('push', e.statusCode, e.body);
    }
  }));
  console.log(r.slot, tomorrow, 'inviate', sent, 'rimosse', gone);
};

export const config = { schedule: '*/15 * * * *' };
