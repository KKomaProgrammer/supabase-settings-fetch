import {
  onRequest as handleSettingsRequest,
  onRequestOptions as handleSettingsOptions,
  onRequestPost as handleSettingsPost,
} from './settings.js';

function isSettingsJs(context) {
  return String(context?.params?.file || '') === 'settings.js';
}

function notFound() {
  return new Response('Not Found', {
    status: 404,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

export async function onRequestOptions(context) {
  if (!isSettingsJs(context)) return notFound();
  return handleSettingsOptions(context);
}

export async function onRequestPost(context) {
  if (!isSettingsJs(context)) return notFound();
  return handleSettingsPost(context);
}

export async function onRequest(context) {
  if (!isSettingsJs(context)) return notFound();
  return handleSettingsRequest(context);
}
