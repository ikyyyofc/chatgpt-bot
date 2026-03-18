import yts from 'yt-search';

const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36';

async function getToken(url) {
    const r = await fetch(`https://v2.ytmp3.wtf/button/?url=${encodeURIComponent(url)}`, {
        headers: {
            'user-agent': UA,
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'referer': 'https://v2.ytmp3.wtf/'
        }
    });

    const html = await r.text();
    const cookie = r.headers.get('set-cookie') || '';
    const phpsessid = cookie.match(/PHPSESSID=([^;]+)/)?.[1];
    const tokenId = html.match(/'token_id':\s*'([^']+)'/)?.[1];
    const validTo = html.match(/'token_validto':\s*'([^']+)'/)?.[1];

    if (!phpsessid || !tokenId || !validTo) throw new Error('Gagal mengambil session token');
    return { phpsessid, tokenId, validTo };
}

async function startConvert(url, token) {
    const body = new URLSearchParams({
        url,
        convert: 'gogogo',
        token_id: token.tokenId,
        token_validto: token.validTo
    });

    const r = await fetch('https://v2.ytmp3.wtf/convert/', {
        method: 'POST',
        headers: {
            'user-agent': UA,
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'referer': `https://v2.ytmp3.wtf/button/?url=${encodeURIComponent(url)}`,
            'cookie': `PHPSESSID=${token.phpsessid}`
        },
        body
    });

    const j = await r.json();
    if (!j.jobid) throw new Error(j.error || 'Job ID tidak ditemukan');
    return j.jobid;
}

async function poll(jobid, token) {
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const r = await fetch(`https://v2.ytmp3.wtf/convert/?jobid=${jobid}&time=${Date.now()}`, {
            headers: {
                'user-agent': UA,
                'referer': 'https://v2.ytmp3.wtf/',
                'cookie': `PHPSESSID=${token.phpsessid}`
            }
        });
        
        const t = await r.text();
        if (!t.trim().startsWith('{')) continue;
        
        const j = JSON.parse(t);
        if (j.error) throw new Error(j.error);
        if (j.ready && j.dlurl) return j.dlurl;
    }
    throw new Error('Request timeout');
}

export default {
    name: 'play',
    description: 'Mencari dan memutar lagu dari YouTube',
    execute: async ({ sock, from, input, message }) => {
        if (!input) {
            await sock.sendMessage(from, { text: 'Judul lagu tidak boleh kosong.' }, { quoted: message });
            return;
        }

        try {
            const search = await yts(input);
            if (!search.all || search.all.length === 0) {
                await sock.sendMessage(from, { text: 'Lagu tidak ditemukan.' }, { quoted: message });
                return;
            }
            
            const video = search.all.find(v => v.type === 'video');
            if (!video) {
                await sock.sendMessage(from, { text: 'Video tidak ditemukan.' }, { quoted: message });
                return;
            }

            const token = await getToken(video.url);
            const jobid = await startConvert(video.url, token);
            const dlUrl = await poll(jobid, token);

            const res = await fetch(dlUrl, { headers: { 'user-agent': UA } });
            if (!res.ok) throw new Error('Gagal mengunduh audio');
            
            const arrayBuffer = await res.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            await sock.sendMessage(from, {
                audio: buffer,
                mimetype: 'audio/mpeg',
                contextInfo: {
                    externalAdReply: {
                        title: video.title,
                        body: `Duration: ${video.timestamp} | Views: ${video.views}`,
                        thumbnailUrl: video.thumbnail,
                        sourceUrl: video.url,
                        mediaType: 1,
                        renderLargerThumbnail: true
                    }
                }
            }, { quoted: message });

        } catch (error) {
            await sock.sendMessage(from, { text: `Error: ${error.message}` }, { quoted: message });
        }
    }
};