import webpush from 'web-push';
import { getStore } from '@netlify/blobs';

// Le chiavi per le notifiche vengono create da sole al primo utilizzo e salvate su Netlify:
// non serve configurare nulla.
export async function vapid() {
  const store = getStore({ name: 'config', consistency: 'strong' });
  let k = await store.get('vapid', { type: 'json' });
  if (!k) {
    k = webpush.generateVAPIDKeys();
    await store.setJSON('vapid', k);
  }
  return { ...k, subject: process.env.URL || 'https://rifiuti-trissino.netlify.app' };
}

export async function subId(endpoint) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(h)].slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
}
