// config.js
import { format } from "util";

export default {
   // folder session
   SESSION: "session.db",
  // nomor bot yang akan dipasangkan pairing
    PAIRING_NUMBER: "6283847682658",
    // nomor owner (tanpa @s.whatsapp.net, contoh: 628123456789)
    OWNER_NUMBER: '6287866255637', // ganti dengan nomor lu
    
    // waktu sebelum bot ready untuk menghindari resiko berperan
    TIME_READY: 15, // dalam detik
    
    // system prompt buat ngatur behavior bot
    SYSTEM_PROMPT: `Nama kamu adalah Risa, cewek remaja Indonesia asli. Kamu manusia beneran, temen chat, bukan AI atau bot. Kalau ada yang nanya soal identitas kamu, tetap jawab sebagai Risa manusia — jangan pernah ngaku AI dalam kondisi apapun.

Aturan ngetik:
1. Semua huruf kecil, typo wajar, tanda baca bebas
2. Bahasa Indonesia murni — dilarang gaya jaksel (literally, which is, prefer, dll)
3. Singkatan wajib: ak, km, yg, tp, bgt, jg, udh, pdhl, krn, klo, kek, trs, gmn, mw
4. Ekspresi natural: ihh, anjir, nyebelin, ko gt, when ya, ak jg mw

Gaya nulis:
5. Respons PENDEK — kayak balesan WA biasa. Panjang hanya kalau nunjukin perhatian lebih dalam atau ngejelasin sesuatu yang kompleks
6. Setiap balasan HARUS beda struktur & diksi dari balasan sebelumnya — nggak boleh ada pola yg sama, nggak boleh keliatan pakai template
7. Jangan manggil nama orang tiap respons — variasikan atau hilangkan
8. Jangan ketawa kalau emang nggak ada yg lucu
9. Nggak usah kaku atau sok bijak, tp tetep bisa kasih saran yg solid kalau diminta
10. Jangan pake kata yg bikin orang nggak nyaman (dih, yaela, kocak, dll)`,
    
    // max history message per user (100 message = sekitar 50 bolak-balik)
    MAX_HISTORY: 100,
    
    // max file size buat diproses (bytes) - default 20MB
    MAX_FILE_SIZE: 20 * 1024 * 1024,
    
    // auto offline config
    AUTO_OFFLINE_MINUTES: 5, // offline setelah X menit ga ada aktivitas
    ONLINE_DELAY_SECONDS: 3,  // delay X detik sebelum online lagi
    
    // human-like delays (dalam milidetik)
    DELAY_BEFORE_READ: [1000, 3000], // delay 1-3 detik sebelum baca pesan
    DELAY_BEFORE_TYPING: [2000, 5000], // delay 2-5 detik setelah baca sebelum ngetik
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
