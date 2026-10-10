const githubApi = 'https://api.github.com';

function jsonResponse(origin, allowedOrigin, status, payload) {
    const headers = new Headers({
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin'
    });
    if (origin === allowedOrigin) {
        headers.set('Access-Control-Allow-Origin', origin);
    }
    return new Response(payload === null ? null : JSON.stringify(payload), { status, headers });
}

function decodeBase64(value) {
    const binary = atob(value.replace(/\s/g, ''));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}

function encodeBase64(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
}

function fileUrl(env, branch) {
    const path = env.GITHUB_FILE.split('/').map(encodeURIComponent).join('/');
    return `${githubApi}/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/contents/${path}?ref=${encodeURIComponent(branch)}`;
}

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin');
        if (origin !== env.ALLOWED_ORIGIN) {
            return jsonResponse(origin, env.ALLOWED_ORIGIN, 403, { error: 'Origin not allowed.' });
        }
        if (request.method === 'OPTIONS') {
            return jsonResponse(origin, env.ALLOWED_ORIGIN, 204, null);
        }
        if (request.method !== 'POST') {
            return jsonResponse(origin, env.ALLOWED_ORIGIN, 405, { error: 'Method not allowed.' });
        }
        if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') {
            return jsonResponse(origin, env.ALLOWED_ORIGIN, 415, { error: 'Expected JSON.' });
        }
        if (!env.GITHUB_TOKEN || !env.GITHUB_OWNER || !env.GITHUB_REPO || !env.GITHUB_BRANCH || !env.GITHUB_FILE) {
            return jsonResponse(origin, env.ALLOWED_ORIGIN, 500, { error: 'Guestbook is not configured.' });
        }

        if (env.WISH_RATE_LIMITER) {
            const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
            const { success } = await env.WISH_RATE_LIMITER.limit({ key: ip });
            if (!success) {
                return jsonResponse(origin, env.ALLOWED_ORIGIN, 429, { error: 'Too many wishes. Please try again later.' });
            }
        }

        let submission;
        try {
            const body = await request.text();
            if (new TextEncoder().encode(body).length > 4096) {
                return jsonResponse(origin, env.ALLOWED_ORIGIN, 413, { error: 'Wish is too long.' });
            }
            submission = JSON.parse(body);
        } catch {
            return jsonResponse(origin, env.ALLOWED_ORIGIN, 400, { error: 'Invalid submission.' });
        }

        if (typeof submission.website === 'string' && submission.website.trim()) {
            return jsonResponse(origin, env.ALLOWED_ORIGIN, 200, { ok: true });
        }
        if (typeof submission.wish !== 'string' || !submission.wish.trim() || submission.wish.length > 1200) {
            return jsonResponse(origin, env.ALLOWED_ORIGIN, 400, { error: 'Enter a wish of 1,200 characters or fewer.' });
        }

        const branch = env.GITHUB_BRANCH;
        const url = fileUrl(env, branch);
        const githubHeaders = {
            'Accept': 'application/vnd.github+json',
            'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
            'User-Agent': 'rayyan-birthday-guestbook',
            'X-GitHub-Api-Version': '2022-11-28'
        };

        let wishes = [];
        let sha;
        const existingResponse = await fetch(url, { headers: githubHeaders });
        if (existingResponse.ok) {
            const existingFile = await existingResponse.json();
            sha = existingFile.sha;
            try {
                wishes = JSON.parse(decodeBase64(existingFile.content));
                if (!Array.isArray(wishes)) throw new Error('Guestbook is not a list.');
            } catch {
                return jsonResponse(origin, env.ALLOWED_ORIGIN, 500, { error: 'Guestbook file is invalid.' });
            }
        } else if (existingResponse.status !== 404) {
            return jsonResponse(origin, env.ALLOWED_ORIGIN, 502, { error: 'Could not read the guestbook.' });
        }

        wishes.push({ wish: submission.wish.trim(), submittedAt: new Date().toISOString() });
        const contents = `${JSON.stringify(wishes, null, 2)}\n`;
        const updateResponse = await fetch(url, {
            method: 'PUT',
            headers: { ...githubHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: 'Add birthday guestbook wish',
                content: encodeBase64(contents),
                branch,
                ...(sha ? { sha } : {})
            })
        });

        if (!updateResponse.ok) {
            const status = updateResponse.status === 409 || updateResponse.status === 422 ? 409 : 502;
            return jsonResponse(origin, env.ALLOWED_ORIGIN, status, { error: 'Could not save the wish. Please try again.' });
        }
        return jsonResponse(origin, env.ALLOWED_ORIGIN, 201, { ok: true });
    }
};