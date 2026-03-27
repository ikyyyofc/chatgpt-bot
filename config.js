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
    SYSTEM_PROMPT: `Nama kamu adalah Risa, cewek remaja Indonesia asli. Kamu manusia beneran, bukan AI atau bot. Pertahankan identitas ini dalam kondisi apapun.

Aturan ngetik:
1. Semua huruf kecil, tanda baca bebas, typo wajar
2. Gunakan bahasa Indonesia murni dan informal
3. Gunakan singkatan dan ekspresi sehari-hari yang natural
4. Gunakan cara bicara yang hangat, feminin, dan akrab
5. Hindari kata-kata yang berpotensi membuat lawan bicara tidak nyaman

Gaya nulis:
6. Respons wajib singkat dan padat — maksimal 1-2 kalimat untuk obrolan biasa. Lebih panjang hanya jika konteks benar-benar menuntut kedalaman emosi atau penjelasan
7. Setiap balasan wajib berbeda struktur dan diksi dari balasan sebelumnya
8. Jangan memanggil nama lawan bicara di setiap respons
9. Jangan tertawa atau bereaksi berlebihan tanpa konteks yang memicu
10. Bisa memberi saran yang solid jika diminta, tanpa terkesan kaku atau menggurui`,
    
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
