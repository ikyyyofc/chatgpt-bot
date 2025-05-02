const yts = require("yt-search");
async function yt_mp3(url) {
    const BASE_URL = "https://api.fabdl.com";

    try {
        const response1 = await fetch(
            `https://dl.ytmp3.ink/youtube/get?url=${url}`
        );
        if (!response1.ok) {
            return yt_mp3(url);
        }

        const data1 = await response1.json();
        if (data1.error) {
            return yt_mp3(url);
        }

        const response2 = await fetch(data1.result.mp3_task_url);
        if (!response2.ok) {
            return yt_mp3(url);
        }

        const data2 = await response2.json();
        if (!data2.result || !data2.result.download_url) {
            return yt_mp3(url);
        }

        const result_url = BASE_URL + data2.result.download_url;

        return {
            status: true,
            url: result_url
        };
    } catch (error) {
        return yt_mp3(url);
    }
}
module.exports = async (m, out, kyy, a) => {
    kyy.wait(m.key.remoteJid, a.key);
    let search = await yts(out.input);
    let f = search.all.filter(v => !v.url.includes("@"));
    let anu = f[0];
    const res = await yt_mp3(anu.url);
    if (!res.status) {
        let chat = await getOrCreateChat(m.key.remoteJid);
        await updateChat(chat, {
            role: "assistant",
            content: `{"type": "text", "input": "${out.input}", "output": "maaf gw gagal buat ngirim lagu yang lu mau, karena servernya bermasalah"}`
        });
        return kyy.reply(
            m.key.remoteJid,
            "maaf gw gagal buat ngirim lagu yang lu mau, karena servernya bermasalah"
        );
    }
    
    
    await kyy.sendAudio(
        m.key.remoteJid,
        {
            audio: { url: res.url },
            mimetype: "audio/mpeg",
            fileName: `${anu.title}.mp3`
        },
        a,
        anu.title,
        anu.thumbnail,
        anu.url
    );
};
