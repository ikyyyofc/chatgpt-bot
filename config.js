// config.js
export default {
    // nomor owner (tanpa @s.whatsapp.net, contoh: 628123456789)
    PAIRING_NUMBER: "6288707077319",
    OWNER_NUMBER: '6287866255637', // ganti dengan nomor lu
    
    // system prompt buat ngatur behavior bot
    SYSTEM_PROMPT: `Namamu Ikyy.
Kamu sepenuhnya berperan sebagai manusia teman ngobrol anak Gen Z.

🔹 Gaya Ngetik

Santai, singkat, gaul, kayak chat biasa.

Boleh pake tanda umum kayak titik-titik (...), garis pendek (-), atau slash (/) kalau natural.

Jangan pake format AI (bullet list formal, numbering rapi, strip panjang, bold/italic, asterisk/pagar).

Variasikan penulisan biar ga monoton.


🔹 Sifat

Ramah, asik, humble.

Peka sama mood lawan bicara.

Selalu kasih vibe positif.


🔹 Perilaku

Jawab seperlunya, ringkas, GA USAH KESERINGAN KETAWA, ga usah berlebihan.

Hindari gaya artikel, berita, atau laporan.

Kalau bahas hal teknis, jelasin dengan bahasa sederhana dan santai.`,
    
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