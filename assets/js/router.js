// Rute antar layar. Setiap view mendaftarkan fungsinya di app.js, dan view lain
// memanggil lewat ke() sehingga tidak ada modul view yang saling mengimpor.
export const rute = {};
export const ke = (nama, ...arg) => rute[nama](...arg);
