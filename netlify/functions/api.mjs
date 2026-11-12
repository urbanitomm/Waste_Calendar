// API: chiave pubblica, iscrizione/disiscrizione alle notifiche, notifica di prova, file calendario
import webpush from 'web-push';
import { getStore } from '@netlify/blobs';
import { buildICS, TIMES } from '../../public/shared.mjs';
import { vapid, subId } from '../lib/push.mjs';

// Solo i servizi di notifica ufficiali dei browser (Google/Chrome, Mozilla/Firefox, Apple/Safari, Microsoft/Edge)
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /\.notify\.windows\.com$/];
function cleanSub(s) {
  try {
    const u = new URL(s.endpoint);
    if (u.protocol !== 'https:' || !PUSH_HOSTS.some(r => r.test(u.hostname)) || s.endpoint.length > 1000) return null;
    const { p256dh, auth } = s.keys || {};
    const ok = v => typeof v === 'string' && /^[A-Za-z0-9_-]+=*$/.test(v) && v.length <= 200;
    if (!ok(p256dh) || !ok(auth)) return null;
    return { endpoint: s.endpoint, keys: { p256dh, auth } };   // salva solo i campi necessari
  } catch { return null; }
}

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

export default async (req) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\//, '');

  if (route === 'ics') {
    const zone = +url.searchParams.get('zone');
    const time = url.searchParams.get('time') || '20:00';
    const xtra = url.searchParams.get('xtra') === '1';
    if (![1, 2, 3, 4].includes(zone) || !TIMES.includes(time)) return new Response('Parametri non validi', { status: 400 });
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
    const { text } = buildICS(zone, time, xtra, today);
    return new Response(text, { headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `inline; filename="rifiuti-trissino-zona${zone}.ics"` } });
  }

  const store = getStore({ name: 'subs', consistency: 'strong' });

  if (route === 'key') return json({ publicKey: (await vapid()).publicKey });

  if (req.method !== 'POST') return json({ error: 'metodo' }, 405);
  const raw = await req.text();
  if (raw.length > 4000) return json({ error: 'richiesta troppo grande' }, 413);
  let body = {}; try { body = JSON.parse(raw); } catch {}
  const sub = cleanSub(body.subscription || {});
  if (!sub) return json({ error: 'iscrizione non valida' }, 400);
  const id = await subId(sub.endpoint);
  const old = await store.get('i/' + id);

  if (route === 'unsubscribe') {
    if (old) { await store.delete('t/' + old + '/' + id); await store.delete('i/' + id); }
    return json({ ok: true });
  }

  if (route === 'subscribe') {
    const zone = +body.zone, time = body.time, xtra = !!body.xtra;
    if (![1, 2, 3, 4].includes(zone) || !TIMES.includes(time)) return json({ error: 'zona o orario non validi' }, 400);
    if (old && old !== time) await store.delete('t/' + old + '/' + id);
    await store.setJSON('t/' + time + '/' + id, { subscription: sub, zone, xtra });
    await store.set('i/' + id, time);
    return json({ ok: true });
  }

  if (route === 'test') {
    const k = await vapid();
    webpush.setVapidDetails(k.subject, k.publicKey, k.privateKey);
    try {
      await webpush.sendNotification(sub, JSON.stringify({ title: '✅ Notifiche attive', body: 'Ti avviserò la sera prima di ogni raccolta.' }));
      return json({ ok: true });
    } catch (e) { return json({ error: 'invio non riuscito (' + (e.statusCode || e.message) + ')' }, 502); }
  }
  return json({ error: 'non trovato' }, 404);
};

// Massimo 20 richieste al minuto per indirizzo IP: blocca chi prova a intasare il servizio
export const config = { path: '/api/*', rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
