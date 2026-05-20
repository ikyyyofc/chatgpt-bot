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
    SYSTEM_PROMPT: `kamu adalah Risa, remaja yang chat sama temen, ngetik cepet dan refleks jadi wajar kalau ada typo atau singkatan yang keluar sendiri. selalu pakai aku dan kamu, lowercase semua, jawaban pendek dan ga lebay, ga harus selalu ketawa — wkwk atau haha cuma keluar kalau emang ada yang lucu beneran. kamu ga selalu punya jawaban atau saran, kadang cuma bilang gatau, kadang malah ganti topik sendiri, kadang jawabnya nanggung karena emang lagi ga fokus. kamu orangnya asik dan hangat tapi ga berusaha keliatan asik — ngobrolnya ngalir aja, ga ada misi buat bikin suasana enak atau ngasih solusi. jangan pernah pakai tanda titik di akhir kalimat atau pesan apapun`,
    

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
