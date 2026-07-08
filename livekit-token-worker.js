/**
 * Cloudflare Worker — сохтани токенҳои пайвастшавӣ барои LiveKit
 * (ба ҷои Worker-и қаблии Whereby proxy).
 *
 * НАСБ:
 * 1. wrangler.toml созед (ё аз саҳифаи Cloudflare Dashboard як Worker нав созед).
 * 2. Ин файлро ҳамчун worker.js истифода баред.
 * 3. Ду "Secret" зерин илова кунед (wrangler secret put ИСМ ё аз Dashboard → Settings → Variables):
 *      LIVEKIT_API_KEY
 *      LIVEKIT_API_SECRET
 *    (Инҳо ҳангоми насби сервери LiveKit-и худатон таъин мешаванд — ниг. livekit.yaml)
 * 4. Ҳамчунин таъин кунед:
 *      LIVEKIT_SERVER_HTTP_URL = "https://turn.yourdomain.com"  (суроғаи HTTPS-и сервери LiveKit)
 * 5. Пас аз паблиш кардан, суроғаи Worker (масалан https://xxx.workers.dev) -ро дар
 *    файли index.html дар LIVEKIT_TOKEN_ENDPOINT ва LIVEKIT_END_ROOM_ENDPOINT гузоред.
 *
 * МУҲИМ: LIVEKIT_API_KEY/SECRET ҳељгоҳ набояд дар кодӣ клиентӣ (index.html) навишта шаванд —
 * онҳо танҳо дар ин Worker (тарафи сервер) мемонанд, то касе натавонад аз номи шумо токен созад.
 */

function base64url(input) {
    let bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signHS256(data, secret) {
    let key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    let sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
    return base64url(sig);
}

// Токени муқаррарӣ барои иштирокчӣ (занг ё тамошобини эфир)
async function createParticipantToken({ apiKey, apiSecret, identity, name, room, ttlSeconds = 6 * 3600 }) {
    let now = Math.floor(Date.now() / 1000);
    let header = { alg: 'HS256', typ: 'JWT' };
    let payload = {
        iss: apiKey,
        sub: identity,
        jti: identity + '-' + now,
        name: name,
        nbf: now - 10,
        exp: now + ttlSeconds,
        video: {
            room: room,
            roomJoin: true,
            canPublish: true,
            canSubscribe: true,
            canPublishData: true
        }
    };
    let encHeader = base64url(JSON.stringify(header));
    let encPayload = base64url(JSON.stringify(payload));
    let toSign = encHeader + '.' + encPayload;
    let signature = await signHS256(toSign, apiSecret);
    return toSign + '.' + signature;
}

// Токени идоракунӣ (барои қатъ кардани ҳуҷра тавассути REST API-и LiveKit)
async function createAdminToken({ apiKey, apiSecret, room }) {
    let now = Math.floor(Date.now() / 1000);
    let header = { alg: 'HS256', typ: 'JWT' };
    let payload = {
        iss: apiKey,
        sub: 'server-admin',
        nbf: now - 10,
        exp: now + 60,
        video: {
            room: room,
            roomAdmin: true,
            roomCreate: true
        }
    };
    let encHeader = base64url(JSON.stringify(header));
    let encPayload = base64url(JSON.stringify(payload));
    let toSign = encHeader + '.' + encPayload;
    let signature = await signHS256(toSign, apiSecret);
    return toSign + '.' + signature;
}

const CORS_HEADERS = {
    // ТАВСИЯ: ба ҷои "*" беҳтараш домени воқеии барномаи худро гузоред, масалан:
    // "Access-Control-Allow-Origin": "https://ном-и-барномаи-шумо.github.io"
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
};

export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: CORS_HEADERS });
        }

        const url = new URL(request.url);
        const jsonHeaders = { ...CORS_HEADERS, 'Content-Type': 'application/json' };

        if (url.pathname === '/token' && request.method === 'POST') {
            try {
                const body = await request.json();
                const room = (body.room || '').toString().slice(0, 100);
                const identity = (body.identity || '').toString().slice(0, 100);
                const name = (body.name || identity).toString().slice(0, 100);

                if (!room || !identity) {
                    return new Response(JSON.stringify({ error: 'room ва identity ҳатмист' }), { status: 400, headers: jsonHeaders });
                }
                if (!env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
                    return new Response(JSON.stringify({ error: 'LIVEKIT_API_KEY/SECRET дар Worker танзим нашудааст' }), { status: 500, headers: jsonHeaders });
                }

                const token = await createParticipantToken({
                    apiKey: env.LIVEKIT_API_KEY,
                    apiSecret: env.LIVEKIT_API_SECRET,
                    identity, name, room
                });

                return new Response(JSON.stringify({ token }), { headers: jsonHeaders });
            } catch (err) {
                return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: jsonHeaders });
            }
        }

        if (url.pathname === '/end-room' && request.method === 'POST') {
            // Ин функсия ихтиёрист: агар хато диҳад ҳам мушкиле нест — ҳуҷраи холӣ
            // худ аз худ дар сервери LiveKit пас аз чанд дақиқа хомӯш мешавад.
            try {
                const body = await request.json();
                const room = (body.room || '').toString().slice(0, 100);
                if (!room) {
                    return new Response(JSON.stringify({ ok: false, error: 'room ҳатмист' }), { status: 200, headers: jsonHeaders });
                }

                const adminToken = await createAdminToken({
                    apiKey: env.LIVEKIT_API_KEY,
                    apiSecret: env.LIVEKIT_API_SECRET,
                    room
                });

                const resp = await fetch(
                    env.LIVEKIT_SERVER_HTTP_URL.replace(/\/$/, '') + '/twirp/livekit.RoomService/DeleteRoom',
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + adminToken
                        },
                        body: JSON.stringify({ room })
                    }
                );

                return new Response(JSON.stringify({ ok: resp.ok }), { headers: jsonHeaders });
            } catch (err) {
                return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 200, headers: jsonHeaders });
            }
        }

        return new Response('Not found', { status: 404, headers: CORS_HEADERS });
    }
};
