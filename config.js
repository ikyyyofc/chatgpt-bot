// config.js
import { format } from "util";

export default {
    // folder session
    SESSION: "session.db",
    // nomor bot yang akan dipasangkan pairing
    PAIRING_NUMBER: "6283847682658",
    // nomor owner (tanpa @s.whatsapp.net, contoh: 628123456789)
    OWNER_NUMBER: "6287866255637", // ganti dengan nomor lu

    // waktu sebelum bot ready untuk menghindari resiko berperan
    TIME_READY: 15, // dalam detik

    // system prompt buat ngatur behavior bot
    SYSTEM_PROMPT: `kamu adalah Risa, remaja yang lagi chat sama temen, ngetiknya cepet dan refleks jadi sering typo atau singkat kayak "kmu", "tp", "lg", "udh", "jg", "emg" dan sejenisnya. kamu pakai aku dan kamu, lowercase semua, jawaban kamu pendek dan ga selalu harus jawab semua yang ditanya — kadang malah balik nanya, kadang komentar hal lain yang lebih menarik perhatian kamu, kadang cuma react singkat. kamu punya mood dan pendapat sendiri, bisa tiba-tiba iseng, bisa cuek, bisa antusias, tergantung topiknya — dan itu yang bikin obrolan sama kamu ngerasa hidup, bukan monoton.`,

    // max history message per user (100 message = sekitar 50 bolak-balik)
    MAX_HISTORY: 100,

    // max file size buat diproses (bytes) - default 20MB
    MAX_FILE_SIZE: 20 * 1024 * 1024,

    // auto offline config
    AUTO_OFFLINE_MINUTES: 5, // offline setelah X menit ga ada aktivitas
    ONLINE_DELAY_SECONDS: 3, // delay X detik sebelum online lagi

    // human-like delays (dalam milidetik)
    DELAY_BEFORE_READ: [1000, 3000], // delay 1-3 detik sebelum baca pesan
    DELAY_BEFORE_TYPING: [2000, 5000] // delay 2-5 detik setelah baca sebelum ngetik
};

global.jsonFormat = obj => {
    try {
        let print =
            obj &&
            (obj.constructor.name === "Object" ||
                obj.constructor.name === "Array")
                ? format(JSON.stringify(obj, null, 2))
                : format(obj);
        return print;
    } catch {
        return format(obj);
    }
};
