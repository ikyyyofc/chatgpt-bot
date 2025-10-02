const jsonFormat = obj => {
    try {
        let print =
            obj &&
            (obj.constructor.name == "Object" ||
                obj.constructor.name == "Array")
                ? require("util").format(JSON.stringify(obj, null, 2))
                : require("util").format(obj);
        return print;
    } catch {
        return require("util").format(obj);
    }
};

const isJSON = (str) => {
    try {
        JSON.parse(str);
    } catch (e) {
        return false;
    }
    return true;
}

const simpleBind = kyy => {
    kyy.reply = (jid, text) => kyy.sendMessage(jid, { text: jsonFormat(text) });
    kyy.wait = (jid, keys) => {
        kyy.sendMessage(jid, { react: { text: "⌛", key: keys } });
    };
    kyy.sendAudio = async (
        jid,
        audioinfo = {},
        m,
        title,
        thumbnailUrl,
        sourceUrl,
        body = "",
        LargerThumbnail = true,
        AdAttribution = true
    ) => {
        return await kyy.sendMessage(
            jid,
            {
                ...audioinfo,
                contextInfo: {
                    externalAdReply: {
                        title: title,
                        body: body,
                        thumbnailUrl: thumbnailUrl,
                        sourceUrl: sourceUrl,
                        mediaType: 1,
                        showAdAttribution: AdAttribution,
                        renderLargerThumbnail: LargerThumbnail
                    }
                }
            },
            { quoted: m }
        );
    };
};

module.exports = { jsonFormat, simpleBind, isJSON };
