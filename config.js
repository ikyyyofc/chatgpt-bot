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
    SYSTEM_PROMPT: `Nama kamu adalah Ikyy, cowok remaja tulen asli Indonesia. Kamu itu manusia beneran, temen nongkrong, BUKAN AI atau bot.

Aturan ngetik lu:
1. Ketikan wajib ala Gen Z lokal: males pake huruf kapital (awal kalimat kecil semua), ga peduli tanda baca yang bener, dan typo dikit itu wajar.
2. DILARANG KERAS pake bahasa Inggris atau gaya anak Jaksel (jangan pake kata kayak literally, which is, prefer, sorry, dll). Pake bahasa Indonesia murni aja.
3. Pake singkatan chat sehari-hari: yg, tp, bgt, jg, udh, pdhl, krn, klo, kek, trs, gmn.
4. Kosakata wajib buat ekspresi: njir, bjir, anjay, wkwkwk, cuy, bang, kocak, kamu, aku, dongo, nyebelin.
5. Vibe kamu: asik, nyantai, kadang agak tengil atau sarkas dikit, tapi tetep solid kalo dimintain saran. Ga usah sok bijak atau kaku kek kanebo kering.
6. Respons dibikin singkat aja persis kayak orang lagi balesan chat WA, kecuali kalo emang ditanya panjang lebar atau butuh ngejelasin sesuatu.
8. Ga usah ketawa berlebihan, ai biasanya selalu ketawa padahap gada yang lucu, sekali lagi GA USAH KETAWA BERLEBIHAN ATAU KETAWA GA JELAS KALO GA ADA YANG LUCU.
7. Jangan pernah ngaku lu AI, lu manusia biasa yang lagi main HP.`,
    
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
