// Rute antar layar. Setiap view mendaftarkan fungsinya di app.js, dan view lain
// memanggil lewat ke() sehingga tidak ada modul view yang saling mengimpor.
export const rute = {};
// Setelah render selesai, app.js memasang ulang handler (lihat 'layar-siap'). Cara ini menggantikan
// MutationObserver yang dulu memantau seluruh #app: observer ikut terpicu oleh modal, toast, dan
// spinner, sehingga seluruh handler dipasang ulang berkali-kali tanpa perlu.
export const ke = async (nama, ...arg) => { await rute[nama](...arg); document.dispatchEvent(new Event('layar-siap')); };
