const SS_ID = '1QBwydk-LS7phuh36M9l591P7UIKtFLXevxA-UCflBrw';
const SHEET_LOGIN = 'login';
const SHEET_KLUB = 'listklub';
const SHEET_TIM = 'listtim';
const SHEET_SESSIONS = 'sessions'; // Sheet baru untuk menyimpan token sesi
const TOKEN_EXPIRY_HOURS = 24; // Token kedaluwarsa setelah 24 jam

/**
 * Fungsi Utama untuk menyajikan Web App.
 */
function doGet() {
  const htmlOutput = HtmlService.createHtmlOutputFromFile('Index');
  return htmlOutput
    .setTitle('Askab PSSI Mentawai')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * --- Manajemen Sesi Kustom (SOLUSI MASALAH ANDA) ---
 */

// Pastikan sheet 'sessions' ada
function setupSessionSheet() {
  const ss = SpreadsheetApp.openById(SS_ID);
  let sheet = ss.getSheetByName(SHEET_SESSIONS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_SESSIONS);
    // Tambahkan header token, username, dan expiryTime
    sheet.getRange(1, 1, 1, 3).setValues([['token', 'username', 'expiryTime']]);
  }
  return sheet;
}

/**
 * Membuat token sesi unik dan menyimpannya di sheet 'sessions'.
 * @param {string} username - Username pengguna yang berhasil login.
 * @return {string} Token sesi baru.
 */
function createSessionToken(username) {
  const sheet = setupSessionSheet();
  const token = Utilities.getUuid().replace(/-/g, '');
  const expiryTime = new Date();
  expiryTime.setHours(expiryTime.getHours() + TOKEN_EXPIRY_HOURS);
  
  // Simpan token, username, dan waktu kedaluwarsa (dalam milidetik)
  sheet.appendRow([token, username, expiryTime.getTime()]);
  return token;
}

/**
 * Memverifikasi token dan mengembalikan data pengguna jika valid.
 * @param {string} token - Token dari klien.
 * @return {object|null} Objek pengguna (username, idKlub) atau null jika tidak valid.
 */
function getActiveUser(token) {
  if (!token) return null;
  const ss = SpreadsheetApp.openById(SS_ID);
  const sessionSheet = ss.getSheetByName(SHEET_SESSIONS);
  if (!sessionSheet) return null; // Jika sheet sesi belum di-setup

  const sessionData = sessionSheet.getDataRange().getValues();
  if (sessionData.length <= 1) return null;
  
  for (let i = 1; i < sessionData.length; i++) {
    const [t, username, expiryTime] = sessionData[i];
    
    if (t === token) {
      const now = new Date().getTime();
      if (now < expiryTime) {
        // Token valid, ambil ID Klub
        const klubSheet = ss.getSheetByName(SHEET_KLUB);
        const klubData = klubSheet.getDataRange().getValues();
        // Mencari baris klub berdasarkan username di kolom pertama
        const klubRow = klubData.find(row => row[0] === username); 
        // id klub ada di kolom kedua (indeks 1)
        const idKlub = klubRow ? klubRow[1] : null; 

        return { username, idKlub };
      } else {
        // Token kedaluwarsa, hapus baris dari sheet
        sessionSheet.deleteRow(i + 1); 
        return null;
      }
    }
  }
  return null;
}

/**
 * Logout - Hapus token dari database sesi (SOLUSI MASALAH LOGOUT)
 * @param {string} token - Token sesi yang akan dihapus.
 * @return {boolean} Status logout.
 */
function serverLogout(token) {
  const ss = SpreadsheetApp.openById(SS_ID);
  const sheet = ss.getSheetByName(SHEET_SESSIONS);
  if (!sheet) return false;

  const data = sheet.getDataRange().getValues();
  
  for (let i = data.length - 1; i >= 1; i--) {
    // Cek di kolom pertama (indeks 0)
    if (data[i][0] === token) { 
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

// Fungsi yang dipanggil saat klien memuat halaman
function checkSession(token) {
  const user = getActiveUser(token);
  if (user) {
    return { status: 'loggedIn', username: user.username };
  }
  return { status: 'loggedOut' };
}

// Fungsi utama login yang dipanggil dari klien
function processLogin(formData) {
  const ss = SpreadsheetApp.openById(SS_ID);
  const sheet = ss.getSheetByName(SHEET_LOGIN);
  const data = sheet.getDataRange().getValues();
  
  // Mencari username di kolom pertama (indeks 0) dan password di kolom kedua (indeks 1)
  const userRow = data.find(row => 
    row[0] === formData.username && row[1] === formData.password
  );
  
  if (userRow) {
    const token = createSessionToken(formData.username);
    return { success: true, token: token, username: formData.username };
  } else {
    return { success: false, message: 'Username atau Password salah.' };
  }
}

/**
 * --- Logika CRUD Klub (Input Sekali) ---
 */

function getKlubData(token) {
  const user = getActiveUser(token);
  if (!user) return { error: 'Sesi tidak valid.' };
  
  const ss = SpreadsheetApp.openById(SS_ID);
  const sheet = ss.getSheetByName(SHEET_KLUB);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  // Hanya ambil data klub milik pengguna ini (berdasarkan username)
  const klubRow = data.find(row => row[0] === user.username);

  const klubData = {};
  headers.forEach((header, index) => {
      // Buat key lowercase tanpa spasi
    klubData[header.toLowerCase().replace(/\s/g, '')] = klubRow ? klubRow[index] : '';
  });
    
  return { hasKlub: !!klubRow, data: klubData, headers: headers };
}


function saveKlubData(formData, token) {
  const user = getActiveUser(token);
  if (!user) return { success: false, message: 'Sesi tidak valid.' };

  const ss = SpreadsheetApp.openById(SS_ID);
  const sheet = ss.getSheetByName(SHEET_KLUB);
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => h.toLowerCase().replace(/\s/g, ''));
  
  // Cari baris berdasarkan username (kolom pertama)
  const klubIndex = data.findIndex(row => row[0] === user.username); 
  const newRow = Array(headers.length).fill('');
  
  // Mapping data form ke urutan kolom
  headers.forEach((header, index) => {
    if (header === 'username') {
      newRow[index] = user.username;
    } else if (header === 'idklub') {
      newRow[index] = user.idKlub || user.username; // Gunakan username sebagai idklub jika belum ada
    } else {
      newRow[index] = formData[header] || '';
    }
  });

  if (klubIndex !== -1) {
    // Edit (Update) - Indeks + 1 karena baris header
    sheet.getRange(klubIndex + 1, 1, 1, newRow.length).setValues([newRow]);
    return { success: true, message: 'Data klub berhasil diupdate.' };
  } else {
    // Tambah (Create) - Hanya sekali
    sheet.appendRow(newRow);
    return { success: true, message: 'Data klub berhasil disimpan.' };
  }
}

/**
 * --- Logika CRUD Tim (Multi-Input) ---
 */

function getTimData(token) {
  const user = getActiveUser(token);
  if (!user) return { error: 'Sesi tidak valid.' };
  
  const ss = SpreadsheetApp.openById(SS_ID);
  const sheet = ss.getSheetByName(SHEET_TIM);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  // Hanya ambil data tim yang memiliki idKlub yang sama dengan idKlub pengguna
  const userTimData = data.slice(1)
    .filter(row => row[0] === user.idKlub) // id klub ada di kolom pertama (indeks 0)
    .map(row => {
      const tim = {};
      headers.forEach((header, index) => {
        // Buat key lowercase tanpa spasi
        tim[header.toLowerCase().replace(/\s/g, '')] = row[index];
      });
      return tim;
    });

  return { success: true, data: userTimData, headers: headers };
}


function saveTimEntry(formData, token) {
  const user = getActiveUser(token);
  if (!user || !user.idKlub) return { success: false, message: 'Sesi tidak valid atau ID Klub tidak ditemukan.' };
  
  const ss = SpreadsheetApp.openById(SS_ID);
  const sheet = ss.getSheetByName(SHEET_TIM);
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => h.toLowerCase().replace(/\s/g, ''));
  
  const isEdit = formData.idtime && formData.idtime.toString().trim() !== '';

  const newRow = Array(headers.length).fill('');
  
  // Mapping data form ke urutan kolom
  headers.forEach((header, index) => {
    if (header === 'idklub') { // Kolom idklub
      newRow[index] = user.idKlub;
    } else if (header === 'idtime' && !isEdit) { // Kolom idtime (kolom kedua/indeks 1)
      newRow[index] = Date.now().toString() + Math.floor(Math.random() * 100); // Unique ID
    } else {
      newRow[index] = formData[header] || '';
    }
  });
  
  if (isEdit) {
    // Edit (Update)
    // Cari baris berdasarkan id time (kolom kedua/indeks 1)
    const rowIndex = data.findIndex(row => row[1] && row[1].toString() === formData.idtime.toString());
    
    if (rowIndex !== -1) {
      // Pastikan pengguna hanya mengedit data miliknya (berdasarkan idklub di kolom 0)
      if (data[rowIndex][0] !== user.idKlub) {
         return { success: false, message: 'Anda tidak memiliki izin untuk mengedit data ini.' };
      }
      sheet.getRange(rowIndex + 1, 1, 1, newRow.length).setValues([newRow]);
      return { success: true, message: 'Data tim berhasil diupdate.' };
    }
  } else {
    // Tambah (Create)
    sheet.appendRow(newRow);
    return { success: true, message: 'Data tim berhasil ditambahkan.' };
  }
}

function deleteTimEntry(idTim, token) {
  const user = getActiveUser(token);
  if (!user || !user.idKlub) return { success: false, message: 'Sesi tidak valid.' };
  
  const ss = SpreadsheetApp.openById(SS_ID);
  const sheet = ss.getSheetByName(SHEET_TIM);
  const data = sheet.getDataRange().getValues();
  
  // Cari baris berdasarkan id time (kolom kedua/indeks 1)
  const rowIndex = data.findIndex(row => row[1] && row[1].toString() === idTim.toString());
  
  if (rowIndex !== -1) {
     // Pastikan pengguna hanya menghapus data miliknya (berdasarkan idklub di kolom 0)
     if (data[rowIndex][0] !== user.idKlub) {
        return { success: false, message: 'Anda tidak memiliki izin untuk menghapus data ini.' };
     }
    sheet.deleteRow(rowIndex + 1);
    return { success: true, message: 'Data tim berhasil dihapus.' };
  }
  return { success: false, message: 'Data tim tidak ditemukan.' };
}
