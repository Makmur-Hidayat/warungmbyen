let currentUser = null;
const appContainer = document.getElementById('app-container');
let contentDiv;
let currentPage = 'home';
let globalValidPemain = []; 
let globalValidOfficial = []; 

// --- CORE UT  ILITIES ---

function showLoading() {
    document.getElementById('loading-overlay').style.display = 'flex';
}

function hideLoading() {
    document.getElementById('loading-overlay').style.display = 'none';
}

function showToast(message, isSuccess = true) {
    const toast = document.getElementById('liveToast');
    const toastBody = document.getElementById('toast-body');
    
    toast.className = `toast align-items-center text-white border-0 ${isSuccess ? 'bg-success' : 'bg-danger'}`;
    toastBody.textContent = message;
    
    const bsToast = new bootstrap.Toast(toast);
    bsToast.show();
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        // Hapus header data URI ("data:image/jpeg;base64,")
        reader.onload = () => resolve(reader.result.split(',')[1]); 
        reader.onerror = error => reject(error);
        reader.readAsDataURL(file);
    });
}

function previewImage(event, previewId) {
    const reader = new FileReader();
    reader.onload = function(){
        const output = document.getElementById(previewId);
        output.src = reader.result;
    }
    reader.readAsDataURL(event.target.files[0]);
}

function calculateAge(dateOfBirth) {
    const dob = new Date(dateOfBirth);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
        age--;
    }
    return age;
}

function isEditable(timestamp, userType) {
    if (userType === 'ADMIN_PUSAT') return true;
    const timeDiff = new Date().getTime() - new Date(timestamp).getTime();
    return timeDiff < 60 * 60 * 1000;
}

function showModalForm(title, formHtml, onSubmitFunction, customFooterHtml = '') {
    const modalId = 'genericModal';
    const existingModal = document.getElementById(modalId);
    if (existingModal) existingModal.remove();
    
    const defaultFooter = `
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Batal</button>
        <button type="submit" class="btn btn-primary" id="modalSubmitButton">Simpan</button>
    `;
    
    const footerContent = customFooterHtml || defaultFooter;

    const modalHtml = `
        <div class="modal fade" id="${modalId}" tabindex="-1" aria-labelledby="${modalId}Label" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="${modalId}Label">${title}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <form id="generic-form">
                        <div class="modal-body row g-3">
                            ${formHtml}
                        </div>
                        <div class="modal-footer justify-content-between">
                            ${footerContent}
                        </div>
                    </form>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const modalElement = document.getElementById(modalId);
    const modal = new bootstrap.Modal(modalElement);
    modal.show();

    modalElement.addEventListener('hidden.bs.modal', () => modalElement.remove());

    if (onSubmitFunction) {
        const formElement = document.getElementById('generic-form');
        if (formElement) formElement.addEventListener('submit', onSubmitFunction);
    }
    
    return { modal, modalElement };
}

function showConfirmationModal(message, onConfirm) {
    const modalHtml = `
        <div class="modal fade" id="confirmModal" tabindex="-1" aria-labelledby="confirmModalLabel" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="confirmModalLabel">Konfirmasi Aksi</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        ${message}
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Batal</button>
                        <button type="button" class="btn btn-danger" id="confirmButton">Ya, Lanjutkan</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const modalElement = document.getElementById('confirmModal');
    const modal = new bootstrap.Modal(modalElement);
    modal.show();

    document.getElementById('confirmButton').onclick = () => {
        modal.hide();
        onConfirm();
    };

    modalElement.addEventListener('hidden.bs.modal', () => modalElement.remove());
}

// --- CORE LOGIC (SAG COMMUNICATION) ---

async function callAppsScript(action, params = {}) {
    const finalParams = new URLSearchParams({
        action: action,
        user: JSON.stringify(currentUser),
        ...params
    });

    showLoading();
    
    try {
        const response = await fetch(GAS_API_URL, {
            method: 'POST',
            body: finalParams,
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }
        
        const result = await response.json();
        hideLoading();
        
        if (result && !result.success) {
            showToast(result.message || 'Terjadi kesalahan pada server.', false);
        }
        
        return result;

    } catch (error) {
        hideLoading();
        showToast(`Komunikasi Gagal: ${error.message}. Pastikan URL API sudah benar.`, false);
        return { success: false, message: error.message };
    }
}

async function handleGenericFormSubmit(e, crudAction, fileFields, callback) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    const modalElement = form.closest('.modal');
    const modal = modalElement ? bootstrap.Modal.getInstance(modalElement) : null;
    const isUpdate = data.action === 'UPDATE';
    
    if (crudAction === 'CRUD_USERLIST' && isUpdate && !data.password) {
        delete data.password;
    }

    showLoading();

    // --- 1. PROSES UPLOAD GAMBAR SAG ---
    let uploadSuccess = true;
    for (const fieldName of fileFields) {
        const fileInput = document.getElementById(fieldName);
        
        // Nama kolom di Sheet: Ambil bagian sebelum '_file'
        const sheetFieldName = fieldName.replace('_file', ''); 

        if (fileInput && fileInput.files.length > 0) {
            const base64Data = await fileToBase64(fileInput.files[0]);
            
            // Panggil Apps Script untuk meneruskan Base64 ke ImgBB
            const uploadResult = await callAppsScript('UPLOAD_IMAGE', { base64Data });

            if (!uploadResult || !uploadResult.success) {
                hideLoading();
                showToast(uploadResult.message || `Gagal mengupload file untuk ${fieldName}.`, false);
                uploadSuccess = false;
                break;
            }
            
            let uploadedUrl = uploadResult.url;
            
            // ✅ PERBAIKAN DOMAIN IMGBB: Ganti domain pendek menjadi domain panjang yang berfungsi
            if (uploadedUrl && uploadedUrl.includes('https://i.ibb.co/')) {
                uploadedUrl = uploadedUrl.replace('https://i.ibb.co/', 'https://i.ibb.co.com/');
            }

            // Simpan URL yang sudah diperbaiki ke data yang akan dikirim ke Apps Script
            data[sheetFieldName] = uploadedUrl; 
        } else if (isUpdate) {
            // Jika update dan tidak ada file baru, pertahankan URL lama yang ada di input hidden
            data[sheetFieldName] = data[sheetFieldName] || ''; 
        }
    }

    if (!uploadSuccess) return;

    // --- 2. HAPUS FIELD ID INPUT TAMBAHAN (untuk CREATE) ---
    if (data.id_pemain_input) {
        data.id_pemain = data.id_pemain_input;
        delete data.id_pemain_input;
    }
    if (data.id_official_input) {
        data.id_official = data.id_official_input;
        delete data.id_official_input;
    }
    
    // --- 3. PANGGIL CRUD APPS SCRIPT ---
    const result = await callAppsScript(crudAction, { data: JSON.stringify(data) });
    hideLoading();

    if (result && result.success) {
        if (modal) modal.hide();
        showToast(result.message);
        callback(); 
    } else if (result) {
        showToast(result.message, false);
    }
}


// --- APP FLOW & AUTHENTICATION ---

function renderApp() {
    currentUser = JSON.parse(sessionStorage.getItem('currentUser'));
    if (currentUser) {
        renderMainLayout();
        renderPage('home');
    } else {
        renderLoginPage();
    }
}

function renderLoginPage() {
    appContainer.innerHTML = `
        <div id="login-page">
            <div id="login-form">
                <h4 class="text-center mb-4 text-primary"><i class="fas fa-futbol me-2"></i>Sistem Informasi PSSI Kepulauan Mentawai (SIPAKEM)</h4>
                <form id="auth-form">
                    <div class="mb-3">
                        <label for="username" class="form-label">Username</label>
                        <input type="text" class="form-control" id="username" name="username" required>
                    </div>
                    <div class="mb-3">
                        <label for="password" class="form-label">Password</label>
                        <input type="password" class="form-control" id="password" name="password" required>
                    </div>
                    <button type="submit" class="btn btn-primary w-100">Login</button>
                </form>
            </div>
        </div>
    `;
    document.getElementById('auth-form').addEventListener('submit', handleLogin);
}

async function handleLogin(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    const result = await callAppsScript('CHECK_AUTH', data);
    
    if (result && result.success) {
        sessionStorage.setItem('currentUser', JSON.stringify(result.user));
        currentUser = result.user;
        renderApp();
    } else if (result) {
        showToast(result.message, false);
    }
}

function handleLogout() {
    sessionStorage.removeItem('currentUser');
    currentUser = null;
    renderApp();
}

function renderMainLayout() {
    appContainer.innerHTML = `
        <nav class="navbar navbar-expand-lg navbar-dark bg-dark fixed-top">
            <div class="container-fluid">
                <a class="navbar-brand" href="#"><i class="fas fa-futbol me-2"></i>Sistem Informasi PSSI Kepulauan Mentawai (SIPAKEM)</a>
                <div class="d-flex align-items-center">
                    <span class="navbar-user-info me-3">
                        Selamat Datang, ${currentUser.nama_admin || currentUser.username} (${currentUser.type_users})
                    </span>
                    <button class="btn btn-outline-light" onclick="handleLogout()">Logout</button>
                </div>
            </div>
        </nav>
        <div id="sidebar" class="sidebar bg-dark"></div>
        <div id="main-content" class="content"></div>
    `;
    contentDiv = document.getElementById('main-content');
    renderSidebar();
}

async function renderSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.innerHTML = '';
    let menuHtml = `<ul class="nav flex-column mt-3">`;

    const clubInfo = await callAppsScript('GET_PROFIL_KLUB');
    const isProfilExist = clubInfo && clubInfo.success && clubInfo.data && !Array.isArray(clubInfo.data) && clubInfo.data.id_klub;

    // Semua user mendapat Home & Kompetisi
    menuHtml += `<li class="nav-item"><a class="nav-link active" href="#" onclick="renderPage('home')"><i class="fas fa-home me-2"></i> Home</a></li>`;

    if (currentUser.type_users.startsWith('ADMIN_KLUB')) {
        menuHtml += `<li class="nav-item"><a class="nav-link" href="#" onclick="renderPage('profil')"><i class="fas fa-building me-2"></i> Profil Klub</a></li>`;
        
        if (isProfilExist) {
             menuHtml += `
                 <li class="nav-item"><a class="nav-link" href="#" onclick="renderPage('pemain')"><i class="fas fa-running me-2"></i> Pemain</a></li>
                 <li class="nav-item"><a class="nav-link" href="#" onclick="renderPage('official')"><i class="fas fa-chalkboard-teacher me-2"></i> Official</a></li>
             `;
        } else {
             menuHtml += `
                <li class="nav-item">
                    <a class="nav-link disabled text-danger" title="Daftar Profil Klub terlebih dahulu">
                        <i class="fas fa-running me-2"></i> Pemain <i class="fas fa-lock ms-1"></i>
                    </a>
                </li>
                <li class="nav-item">
                    <a class="nav-link disabled text-danger" title="Daftar Profil Klub terlebih dahulu">
                        <i class="fas fa-chalkboard-teacher me-2"></i> Official <i class="fas fa-lock ms-1"></i>
                    </a>
                </li>
             `;
        }
        menuHtml += `<li class="nav-item"><a class="nav-link" href="#" onclick="renderPage('kompetisi')"><i class="fas fa-trophy me-2"></i> Kompetisi</a></li>`;
        
    } else if (currentUser.type_users === 'ADMIN_PUSAT') {
        menuHtml += `
            <li class="nav-item"><a class="nav-link" href="#" onclick="renderPage('profil')"><i class="fas fa-building me-2"></i> Semua Klub</a></li>
            <li class="nav-item"><a class="nav-link" href="#" onclick="renderPage('pemain')"><i class="fas fa-running me-2"></i> Semua Pemain</a></li>
            <li class="nav-item"><a class="nav-link" href="#" onclick="renderPage('official')"><i class="fas fa-chalkboard-teacher me-2"></i> Semua Official</a></li>
            <li class="nav-item"><a class="nav-link" href="#" onclick="renderPage('kompetisi')"><i class="fas fa-trophy me-2"></i> Kompetisi (CRUD)</a></li>
            <li class="nav-item"><a class="nav-link" href="#" onclick="renderPage('setting')"><i class="fas fa-cog me-2"></i> Setting</a></li>
        `;
    }

    menuHtml += `</ul>`;
    sidebar.innerHTML = menuHtml;

    // Set active class
    document.querySelectorAll('.sidebar .nav-link').forEach(link => {
        link.classList.remove('active');
    });
    const activeLink = document.querySelector(`.sidebar .nav-link[onclick="renderPage('${currentPage}')"]`);
    if (activeLink) activeLink.classList.add('active');
}

function renderPage(page) {
    currentPage = page;
    document.querySelectorAll('.sidebar .nav-link').forEach(link => link.classList.remove('active'));
    const activeLink = document.querySelector(`.sidebar .nav-link[onclick="renderPage('${page}')"]`);
    if (activeLink) activeLink.classList.add('active');

    if (page === 'home') renderHome();
    else if (page === 'profil') renderProfil();
    else if (page === 'pemain') renderPemain();
    else if (page === 'official') renderOfficial();
    else if (page === 'kompetisi') renderKompetisi();
    else if (page === 'setting') renderSetting();
    else contentDiv.innerHTML = `<h2>Halaman Tidak Ditemukan</h2>`;
}
const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbzMrK1bhOoUg5YLRBQPBck0piYJj-2WRseJsV5ehYcCsrsf-tXhdDY6bCtCKfeL0EfNVg/exec'; 
async function loadBanners() {
    const result = await callAppsScript('GET_BANNERS');
    const inner = document.getElementById('banner-inner');
    inner.innerHTML = '';

    if (!result || !result.success || Object.keys(result.data).length === 0) {
        inner.innerHTML = `<div class="carousel-item active"><div class="alert alert-warning text-center">Tidak ada banner terdaftar.</div></div>`;
        return;
    }

    let first = true;
    let hasContent = false;
    for (let i = 1; i <= 3; i++) {
        const url = result.data[`url_banner${i}`];
        if (url) {
            inner.innerHTML += `
                <div class="carousel-item ${first ? 'active' : ''}">
                    <img src="${url}" class="d-block w-100 rounded" style="height: 250px; object-fit: cover;" alt="Banner ${i}">
                </div>
            `;
            first = false;
            hasContent = true;
        }
    }
     if (!hasContent) {
        inner.innerHTML = `<div class="carousel-item active"><div class="alert alert-info text-center">Tidak ada gambar banner.</div></div>`;
    }
}

async function renderHome() {
    const clubInfo = await callAppsScript('GET_PROFIL_KLUB');
    const profilKlub = clubInfo && clubInfo.success && !Array.isArray(clubInfo.data) ? clubInfo.data : null;

    contentDiv.innerHTML = `
        <h2><i class="fas fa-home me-2"></i>Dashboard Klub</h2>
        <div id="home-alerts"></div>
        <div class="row g-4 mt-3">
            <div class="col-lg-6">
                <div class="card shadow-sm h-100">
                    <div class="card-header bg-primary text-white"><i class="fas fa-shield-alt me-2"></i>Status Profil Klub</div>
                    <div class="card-body" id="club-status-card">
                        ${profilKlub ? `
                            <h5 class="card-title">${profilKlub.nama_klub}</h5>
                            <p class="card-text">
                                ID Klub: ${profilKlub.id_klub}<br>
                                Alamat: ${profilKlub.alamat_klub || '-'}<br>
                                Nama Manajer: ${profilKlub.nama_manajer || '-'}
                            </p>
                            <span class="badge bg-success"><i class="fas fa-check-circle me-1"></i> Profil Lengkap</span>
                            <button class="btn btn-sm btn-outline-primary float-end" onclick="renderPage('profil')">Lihat Detail</button>
                        ` : currentUser.type_users.startsWith('ADMIN_KLUB') ? `
                            <div class="alert alert-danger">
                                <i class="fas fa-exclamation-triangle me-2"></i> Peringatan: Profil Klub Anda belum terdaftar!
                            </div>
                            <button class="btn btn-danger w-100" onclick="renderPage('profil')">Daftarkan Profil Klub Sekarang</button>
                        ` : `
                            <div class="alert alert-info">
                                <i class="fas fa-info-circle me-2"></i> Admin Pusat memiliki akses penuh ke semua data klub.
                            </div>
                            <button class="btn btn-primary w-100" onclick="renderPage('profil')">Lihat Semua Klub</button>
                        `}
                    </div>
                </div>
            </div>
            <div class="col-lg-6">
                <div class="card shadow-sm h-100">
                    <div class="card-header bg-info text-dark"><i class="fas fa-bell me-2"></i>Pembaruan & Notifikasi</div>
                    <div class="card-body" id="notification-card">
                        <ul class="list-group list-group-flush" id="notification-list">
                            <li class="list-group-item text-muted">Memuat notifikasi...</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
        <div class="mt-4">
            <h4><i class="fas fa-images me-2"></i>Info Terbaru</h4>
            <div id="banner-carousel" class="carousel slide" data-bs-ride="carousel">
                <div class="carousel-inner" id="banner-inner">
                    <p class="text-center p-5"><i class="fas fa-spinner fa-spin me-2"></i>Memuat banner...</p>
                </div>
                <button class="carousel-control-prev" type="button" data-bs-target="#banner-carousel" data-bs-slide="prev">
                    <span class="carousel-control-prev-icon" aria-hidden="true"></span>
                    <span class="visually-hidden">Previous</span>
                </button>
                <button class="carousel-control-next" type="button" data-bs-target="#banner-carousel" data-bs-slide="next">
                    <span class="carousel-control-next-icon" aria-hidden="true"></span>
                    <span class="visually-hidden">Next</span>
                </button>
            </div>
        </div>
    `;
    
    loadBanners();
    if (currentUser.type_users.startsWith('ADMIN_KLUB')) {
        loadClubNotifications();
    } else if (currentUser.type_users === 'ADMIN_PUSAT') {
        loadAdminPusatNotifications();
    }
}

async function loadClubNotifications() {
    const list = document.getElementById('notification-list');
    list.innerHTML = '';
    
    const pemainResult = await callAppsScript('GET_PEMAIN');
    const officialResult = await callAppsScript('GET_OFFICIAL');
    const kompetisiResult = await callAppsScript('GET_LIST_KOMPETISI');
    const now = new Date().getTime();
    const oneHour = 60 * 60 * 1000;
    
    let recentChanges = 0;
    
    if (pemainResult && pemainResult.success) {
        pemainResult.data.filter(p => p.id_klub === currentUser.id_klub && (now - new Date(p.time_stamp).getTime() < oneHour)).forEach(p => {
            list.innerHTML += `<li class="list-group-item list-group-item-warning"><i class="fas fa-edit me-2"></i> Pemain ${p.nama_pemain} hanya bisa di Edit/Hapus dalam 1 jam.</li>`;
            recentChanges++;
        });
    }

    if (officialResult && officialResult.success) {
        officialResult.data.filter(o => o.id_klub === currentUser.id_klub && (now - new Date(o.time_stamp).getTime() < oneHour)).forEach(o => {
            list.innerHTML += `<li class="list-group-item list-group-item-warning"><i class="fas fa-edit me-2"></i> Official ${o.nama_official}  hanya bisa di Edit/Hapus dalam 1 jam.</li>`;
            recentChanges++;
        });
    }

    if (kompetisiResult && kompetisiResult.success) {
        kompetisiResult.data.forEach(k => {
            const startDate = new Date(k.tanggal_awal_pendaftaran).getTime();
            const endDate = new Date(k.tanggal_akhir_pendaftaran).getTime();
            if (now >= startDate && now <= endDate) {
                list.innerHTML += `<li class="list-group-item list-group-item-success"><i class="fas fa-trophy me-2"></i> Pendaftaran ${k.nama_kompetisi} telah dibuka!</li>`;
                recentChanges++;
            }
        });
    }

    if (recentChanges === 0) {
        list.innerHTML = `<li class="list-group-item text-success"><i class="fas fa-check me-2"></i> Semua data Anda stabil. Tidak ada pembaruan mendesak.</li>`;
    }
}

function loadAdminPusatNotifications() {
    const list = document.getElementById('notification-list');
    list.innerHTML = `
        <li class="list-group-item text-primary"><i class="fas fa-star me-2"></i> Selamat datang kembali, Admin Pusat.</li>
        <li class="list-group-item"><i class="fas fa-cog me-2"></i> Akses penuh ke Setting (Banner & Userlist) dan CRUD Kompetisi.</li>
        <li class="list-group-item text-muted"><i class="fas fa-search me-2"></i> Lihat data klub dan pemain di menu terkait.</li>
    `;
}

// --- NAVIGASI PROFIL KLUB ---
async function renderProfil() {
    if (currentUser.type_users === 'ADMIN_PUSAT') {
        renderAllKlubList();
    } else {
        renderKlubForm();
    }
}

async function renderKlubForm() {
    const result = await callAppsScript('GET_PROFIL_KLUB');
    const data = result && result.success && !Array.isArray(result.data) ? result.data : {};
    const isNew = !data.id_klub;
    
    // Perubahan 1: Menggunakan logo_klub
    contentDiv.innerHTML = `
        <h2><i class="fas fa-building me-2"></i>${isNew ? 'Daftar' : 'Edit'} Profil Klub</h2>
        <div class="card p-3 shadow-sm">
            <form id="profil-klub-form" class="row g-3">
                <input type="hidden" name="action" value="${isNew ? 'CREATE' : 'UPDATE'}">
                <input type="hidden" name="id_klub" value="${data.id_klub || currentUser.id_klub}">
                
                <div class="col-12 text-center">
                    <img id="logo-preview" src="${data.logo_klub || 'https://via.placeholder.com/150?text=Logo+Klub'}" class="rounded shadow mb-2" style="width: 150px; height: 150px; object-fit: cover;">
                    <input type="file" class="form-control" id="logo_klub_file" accept="image/*" onchange="previewImage(event, 'logo-preview')" ${isNew ? '' : ''}>
                    <input type="hidden" name="logo_klub" value="${data.logo_klub || ''}">
                </div>

                <div class="col-md-6">
                    <label for="id_klub_display" class="form-label">ID Klub</label>
                    <input type="text" class="form-control" id="id_klub_display" value="${currentUser.id_klub}" readonly>
                </div>
                <div class="col-md-6">
                    <label for="nama_klub" class="form-label">Nama Klub</label>
                    <input type="text" class="form-control" id="nama_klub" name="nama_klub" value="${data.nama_klub || ''}" required>
                </div>
                <div class="col-md-6">
                    <label for="nama_manajer" class="form-label">Nama Manajer</label>
                    <input type="text" class="form-control" id="nama_manajer" name="nama_manajer" value="${data.nama_manajer || ''}" required>
                </div>
                <div class="col-md-6">
                    <label for="no_telp_klub" class="form-label">No. Telepon Klub</label>
                    <input type="text" class="form-control" id="no_telp_klub" name="no_telp_klub" value="${data.no_telp_klub || ''}">
                </div>
                <div class="col-12">
                    <label for="alamat_klub" class="form-label">Alamat Klub</label>
                    <textarea class="form-control" id="alamat_klub" name="alamat_klub">${data.alamat_klub || ''}</textarea>
                </div>
                <div class="col-12 d-grid">
                    <button type="submit" class="btn btn-primary">${isNew ? 'Daftar Klub' : 'Simpan Perubahan'}</button>
                </div>
            </form>
        </div>
    `;
    document.getElementById('profil-klub-form').addEventListener('submit', handleProfilKlubFormSubmit);
}

async function handleProfilKlubFormSubmit(e) {
    // Perubahan 1: Menggunakan logo_klub_file
    await handleGenericFormSubmit(e, 'CRUD_PROFIL_KLUB', ['logo_klub_file'], () => {
        renderSidebar(); 
        renderKlubForm();
    });
}

// ADMIN PUSAT: Melihat Semua Klub
async function renderAllKlubList() {
    contentDiv.innerHTML = `
        <h2><i class="fas fa-building me-2"></i>Daftar Semua Profil Klub</h2>
        <div id="klub-list" class="row g-3">
            <p class="text-center"><i class="fas fa-spinner fa-spin me-2"></i>Memuat data klub...</p>
        </div>
    `;
    
    const result = await callAppsScript('GET_PROFIL_KLUB');
    const listDiv = document.getElementById('klub-list');
    listDiv.innerHTML = '';
    
    if (!result || !result.success || result.data.length === 0) {
        listDiv.innerHTML = `<div class="col-12"><div class="alert alert-info text-center">Tidak ada profil klub yang terdaftar.</div></div>`;
        return;
    }
    
    result.data.forEach(klub => {
        listDiv.innerHTML += `
            <div class="col-12 col-md-6 col-lg-4 d-flex">
                <div class="card w-100 shadow-sm">
                    <div class="card-body">
                        <h5 class="card-title">${klub.nama_klub}</h5>
                        <p class="card-text mb-1">ID: ${klub.id_klub}</p>
                        <p class="card-text mb-1">Manajer: ${klub.nama_manajer || '-'}</p>
                        <small class="text-muted">Terdaftar: ${new Date(klub.time_stamp).toLocaleDateString()}</small>
                        
                        <button class="btn btn-sm btn-outline-info float-end mt-2" onclick="showKlubDetailAdmin('${klub.id_klub}', ${JSON.stringify(klub).replace(/"/g, '&quot;')})">Lihat Detail</button>
                    </div>
                </div>
            </div>
        `;
    });
}

function showKlubDetailAdmin(id_klub, klub) {
    // Perubahan 1: Menggunakan logo_klub
    const formHtml = `
        <div class="col-12 text-center mb-3">
            <img src="${klub.logo_klub || 'https://via.placeholder.com/100x100?text=Logo'}" class="rounded shadow" style="width: 100px; height: 100px; object-fit: cover;">
        </div>
        <div class="col-12">
            <ul class="list-group list-group-flush">
                <li class="list-group-item"><strong>Nama Klub:</strong> ${klub.nama_klub}</li>
                <li class="list-group-item"><strong>ID Klub:</strong> ${klub.id_klub}</li>
                <li class="list-group-item"><strong>Nama Manajer:</strong> ${klub.nama_manajer}</li>
                <li class="list-group-item"><strong>Nomor Telepon:</strong> ${klub.no_telp_klub || '-'}</li>
                <li class="list-group-item"><strong>Alamat:</strong> ${klub.alamat_klub || '-'}</li>
                <li class="list-group-item"><small class="text-muted">Dibuat: ${new Date(klub.time_stamp).toLocaleString()}</small></li>
            </ul>
        </div>
    `;

    showModalForm(`Detail Klub: ${klub.nama_klub}`, formHtml, (e) => e.preventDefault(), '<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Tutup</button>');
}

// --- NAVIGASI PEMAIN ---
async function renderPemain() {
    contentDiv.innerHTML = `<h2><i class="fas fa-running me-2"></i>Data Pemain</h2>
        <div class="input-group mb-3">
            <input type="text" class="form-control" placeholder="Cari Pemain..." id="search-pemain" onkeyup="filterPemainList()">
            <button class="btn btn-primary" type="button" onclick="filterPemainList()"><i class="fas fa-search"></i></button>
        </div>
        ${(currentUser.type_users.startsWith('ADMIN_KLUB') || currentUser.type_users === 'ADMIN_PUSAT') ? 
            `<button class="btn btn-success mb-3" onclick="openPemainForm('NEW')"><i class="fas fa-plus me-1"></i> Tambah Pemain</button>` : ''}
        <div id="pemain-list" class="row g-3">
            <p class="text-center"><i class="fas fa-spinner fa-spin me-2"></i>Memuat data pemain...</p>
        </div>`;
    loadPemainList();
}

async function loadPemainList() {
    const result = await callAppsScript('GET_PEMAIN');
    const listDiv = document.getElementById('pemain-list');
    listDiv.innerHTML = '';

    if (!result || !result.success || result.data.length === 0) {
        listDiv.innerHTML = `<div class="col-12"><div class="alert alert-info text-center">Tidak ada data pemain.</div></div>`;
        return;
    }
    
    const dataPemain = currentUser.type_users.startsWith('ADMIN_KLUB') ? result.data.filter(p => p.id_klub === currentUser.id_klub) : result.data;

    if (dataPemain.length === 0) {
        listDiv.innerHTML = `<div class="col-12"><div class="alert alert-info text-center">Tidak ada data pemain terdaftar untuk klub Anda.</div></div>`;
        return;
    }

    dataPemain.forEach(pemain => {
        const isOwner = pemain.id_klub === currentUser.id_klub || currentUser.type_users === 'ADMIN_PUSAT';
        const editable = isEditable(pemain.time_stamp, currentUser.type_users);
        
        // Perubahan 2: Menggunakan pas_photo_pemain
        listDiv.innerHTML += `
            <div class="col-6 col-md-4 col-lg-3 d-flex" data-nama="${pemain.nama_pemain.toLowerCase()}" data-id="${pemain.id_pemain}">
                <div class="card w-100 shadow-sm" onclick="showPemainDetail('${pemain.id_pemain}', ${JSON.stringify(pemain).replace(/"/g, '&quot;')}, ${isOwner}, ${editable})" style="cursor:pointer;">
                    <img src="${pemain.pas_photo_pemain || 'https://via.placeholder.com/150x200?text=Pemain'}" class="card-img-top" style="height: 150px; object-fit: cover;">
                    <div class="card-body p-2">
                        <h6 class="card-title mb-0 text-truncate">${pemain.nama_pemain}</h6>
                        <small class="text-muted d-block">${pemain.posisi} | No. ${pemain.no_punggung}</small>
                        <small class="text-muted d-block">Usia: ${calculateAge(pemain.tanggal_lahir)} th</small>
                    </div>
                </div>
            </div>
        `;
    });
}

function openPemainForm(id_pemain, data = {}) {
    const isNew = id_pemain === 'NEW';
    const posisiOptions = ["Kiper", "Bek Kanan", "Bek Tengah", "Bek Kiri", "Gelandang Kanan", "Gelandang Tengah", "Gelandang Kiri", "Penyerang"];
    
    // Perubahan 2: Menggunakan pas_photo_pemain
    const formHtml = `
        <input type="hidden" name="action" value="${isNew ? 'CREATE' : 'UPDATE'}">
        <input type="hidden" name="id_pemain" value="${data.id_pemain || ''}">
        
        <div class="col-12 text-center">
            <img id="photo-preview" src="${data.pas_photo_pemain || 'https://via.placeholder.com/150x200?text=Foto'}" class="rounded shadow mb-2" style="width: 150px; height: 200px; object-fit: cover;">
            <input type="file" class="form-control" id="pas_photo_pemain_file" accept="image/*" onchange="previewImage(event, 'photo-preview')" ${isNew ? '' : ''}>
            <input type="hidden" name="pas_photo_pemain" value="${data.pas_photo_pemain || ''}">
        </div>
        
        ${isNew ? `
            <div class="col-md-6">
                <label for="id_pemain" class="form-label">ID Pemain (Hanya 16 Angka)</label>
                <input type="number" class="form-control" id="id_pemain_input" name="id_pemain_input" value="" required minlength="16" maxlength="16">
            </div>` : ''}
        
        <div class="col-md-6">
            <label for="nama_pemain" class="form-label">Nama Pemain (Huruf Besar)</label>
            <input type="text" class="form-control" id="nama_pemain" name="nama_pemain" value="${data.nama_pemain || ''}" required>
        </div>
        <div class="col-md-6">
            <label for="tanggal_lahir" class="form-label">Tanggal Lahir (yyyy-mm-dd)</label>
            <input type="date" class="form-control" id="tanggal_lahir" name="tanggal_lahir" value="${data.tanggal_lahir ? new Date(data.tanggal_lahir).toISOString().split('T')[0] : ''}" required>
        </div>
        <div class="col-md-6">
            <label for="nama_punggung" class="form-label">Nama Punggung (Huruf Besar)</label>
            <input type="text" class="form-control" id="nama_punggung" name="nama_punggung" value="${data.nama_punggung || ''}">
        </div>
        <div class="col-md-4">
            <label for="no_punggung" class="form-label">Nomor Punggung</label>
            <input type="number" class="form-control" id="no_punggung" name="no_punggung" value="${data.no_punggung || ''}" required>
        </div>
        <div class="col-md-4">
            <label for="posisi" class="form-label">Posisi</label>
            <select class="form-select" id="posisi" name="posisi" required>
                ${posisiOptions.map(p => `<option value="${p}" ${data.posisi === p ? 'selected' : ''}>${p}</option>`).join('')}
            </select>
        </div>
    `;

    showModalForm(`${isNew ? 'Tambah' : 'Edit'} Pemain`, formHtml, handlePemainFormSubmit);
}

async function handlePemainFormSubmit(e) {
    // Perubahan 2: Menggunakan pas_photo_pemain_file
    await handleGenericFormSubmit(e, 'CRUD_PEMAIN', ['pas_photo_pemain_file'], loadPemainList);
}

function showPemainDetail(id, pemain, isOwner, editable) {
    // Perubahan 2: Menggunakan pas_photo_pemain
    const formHtml = `
        <div class="col-12 text-center">
            <img src="${pemain.pas_photo_pemain || 'https://via.placeholder.com/150x200?text=Pemain'}" class="rounded shadow mb-3" style="width: 150px; height: 200px; object-fit: cover;">
            <h4>${pemain.nama_pemain}</h4>
            <span class="badge bg-primary">${pemain.posisi} - No. ${pemain.no_punggung}</span>
        </div>
        <div class="col-12">
            <ul class="list-group list-group-flush">
                <li class="list-group-item"><strong>ID Pemain:</strong> ${pemain.id_pemain}</li>
                <li class="list-group-item"><strong>ID Klub:</strong> ${pemain.id_klub}</li>
                <li class="list-group-item"><strong>Tanggal Lahir:</strong> ${new Date(pemain.tanggal_lahir).toISOString().split('T')[0]}</li>
                <li class="list-group-item"><strong>Usia:</strong> ${calculateAge(pemain.tanggal_lahir)} tahun</li>
                <li class="list-group-item"><small class="text-muted">Dibuat: ${new Date(pemain.time_stamp).toLocaleString()}</small></li>
            </ul>
        </div>
    `;
    
    let customFooter = '';
    if (isOwner && editable) {
        customFooter = `
            <div>
                <button class="btn btn-danger me-2" onclick="confirmDeletePemain('${id}', '${pemain.nama_pemain}')" data-bs-dismiss="modal">Hapus</button>
                <button class="btn btn-success" onclick="openPemainForm('${id}', ${JSON.stringify(pemain).replace(/"/g, '&quot;')})" data-bs-dismiss="modal">Edit</button>
            </div>
        `;
    } else if (isOwner && !editable) {
        customFooter = `<div class="alert alert-warning text-center m-0">ADMIN_KLUB: Batas waktu edit/hapus 1 jam telah berakhir.</div>`;
    } else {
         customFooter = `<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Tutup</button>`;
    }

    showModalForm('Detail Pemain', formHtml, (e) => e.preventDefault(), customFooter);
}

function confirmDeletePemain(id_pemain, nama_pemain) {
    showConfirmationModal(`Apakah Anda yakin ingin menghapus data pemain ${nama_pemain}?`, async () => {
        const data = { action: 'DELETE', id_pemain: id_pemain };
        const result = await callAppsScript('CRUD_PEMAIN', { data: JSON.stringify(data) });
        
        if (result && result.success) {
            showToast(result.message);
            loadPemainList();
        } else if (result) {
            showToast(result.message, false);
        }
    });
}

function filterPemainList() {
    const searchText = document.getElementById('search-pemain').value.toLowerCase();
    document.querySelectorAll('#pemain-list > div').forEach(card => {
        const nama = card.dataset.nama;
        card.style.display = nama.includes(searchText) ? 'flex' : 'none';
    });
}

// --- NAVIGASI OFFICIAL ---
async function renderOfficial() {
     contentDiv.innerHTML = `
        <h2><i class="fas fa-chalkboard-teacher me-2"></i>Data Official</h2>
        <div class="input-group mb-3">
            <input type="text" class="form-control" placeholder="Cari Official..." id="search-official" onkeyup="filterOfficialList()">
            <button class="btn btn-primary" type="button" onclick="filterOfficialList()"><i class="fas fa-search"></i></button>
        </div>
        ${(currentUser.type_users.startsWith('ADMIN_KLUB') || currentUser.type_users === 'ADMIN_PUSAT') ?
            `<button class="btn btn-success mb-3" onclick="openOfficialForm('NEW')"><i class="fas fa-plus me-1"></i> Tambah Official</button>` : ''}
        <div id="official-list" class="row g-3">
            <p class="text-center"><i class="fas fa-spinner fa-spin me-2"></i>Memuat data official...</p>
        </div>
    `;
    loadOfficialList();
}

async function loadOfficialList() {
    const result = await callAppsScript('GET_OFFICIAL');
    const listDiv = document.getElementById('official-list');
    listDiv.innerHTML = '';

    if (!result || !result.success || result.data.length === 0) {
        listDiv.innerHTML = `<div class="col-12"><div class="alert alert-info text-center">Tidak ada data official.</div></div>`;
        return;
    }

    const dataOfficial = currentUser.type_users.startsWith('ADMIN_KLUB') ? result.data.filter(o => o.id_klub === currentUser.id_klub) : result.data;

    if (dataOfficial.length === 0) {
        listDiv.innerHTML = `<div class="col-12"><div class="alert alert-info text-center">Tidak ada data official terdaftar untuk klub Anda.</div></div>`;
        return;
    }

    dataOfficial.forEach(official => {
        const isOwner = official.id_klub === currentUser.id_klub || currentUser.type_users === 'ADMIN_PUSAT';
        const editable = isEditable(official.time_stamp, currentUser.type_users);
        
        // Perubahan 3: Menggunakan pas_photo_official
        listDiv.innerHTML += `
            <div class="col-6 col-md-4 col-lg-3 d-flex" data-nama="${official.nama_official.toLowerCase()}" data-id="${official.id_official}">
                <div class="card w-100 shadow-sm" onclick="showOfficialDetail('${official.id_official}', ${JSON.stringify(official).replace(/"/g, '&quot;')}, ${isOwner}, ${editable})" style="cursor:pointer;">
                    <img src="${official.pas_photo_official || 'https://via.placeholder.com/150x200?text=Official'}" class="card-img-top" style="height: 150px; object-fit: cover;">
                    <div class="card-body p-2">
                        <h6 class="card-title mb-0 text-truncate">${official.nama_official}</h6>
                        <small class="text-muted d-block">${official.jabatan}</small>
                        <small class="text-muted d-block">Usia: ${calculateAge(official.tanggal_lahir)} th</small>
                    </div>
                </div>
            </div>
        `;
    });
}

function openOfficialForm(id_official, data = {}) {
    const isNew = id_official === 'NEW';
    const jabatanOptions = ["Manejer", "Asisten Manejer", "Pelatih", "Asisten Pelatih", "Pelatih Kiper", "Pelatih Fisik", "Medis", "Staff Lainnya"];
    
    // Perubahan 3: Menggunakan pas_photo_official
    const formHtml = `
        <input type="hidden" name="action" value="${isNew ? 'CREATE' : 'UPDATE'}">
        <input type="hidden" name="id_official" value="${data.id_official || ''}">
        
        <div class="col-12 text-center">
            <img id="photo-preview" src="${data.pas_photo_official || 'https://via.placeholder.com/150x200?text=Foto'}" class="rounded shadow mb-2" style="width: 150px; height: 200px; object-fit: cover;">
            <input type="file" class="form-control" id="pas_photo_official_file" accept="image/*" onchange="previewImage(event, 'photo-preview')" ${isNew ? '' : ''}>
            <input type="hidden" name="pas_photo_official" value="${data.pas_photo_official || ''}">
        </div>
        
        ${isNew ? `
            <div class="col-md-6">
                <label for="id_official" class="form-label">ID Official (16 Angka Unik)</label>
                <input type="number" class="form-control" id="id_official_input" name="id_official_input" value="" required minlength="16" maxlength="16">
            </div>` : ''}
        
        <div class="col-md-6">
            <label for="nama_official" class="form-label">Nama Official</label>
            <input type="text" class="form-control" id="nama_official" name="nama_official" value="${data.nama_official || ''}" required>
        </div>
        <div class="col-md-6">
            <label for="tanggal_lahir" class="form-label">Tanggal Lahir (yyyy-mm-dd)</label>
            <input type="date" class="form-control" id="tanggal_lahir" name="tanggal_lahir" value="${data.tanggal_lahir ? new Date(data.tanggal_lahir).toISOString().split('T')[0] : ''}" required>
        </div>
        <div class="col-md-6">
            <label for="jabatan" class="form-label">Jabatan</label>
            <select class="form-select" id="jabatan" name="jabatan" required>
                ${jabatanOptions.map(p => `<option value="${p}" ${data.jabatan === p ? 'selected' : ''}>${p}</option>`).join('')}
            </select>
        </div>
    `;

    showModalForm(`${isNew ? 'Tambah' : 'Edit'} Official`, formHtml, handleOfficialFormSubmit);
}

async function handleOfficialFormSubmit(e) {
    // Perubahan 3: Menggunakan pas_photo_official_file
    await handleGenericFormSubmit(e, 'CRUD_OFFICIAL', ['pas_photo_official_file'], loadOfficialList);
}

function showOfficialDetail(id, official, isOwner, editable) {
    // Perubahan 3: Menggunakan pas_photo_official
    const formHtml = `
        <div class="col-12 text-center">
            <img src="${official.pas_photo_official || 'https://via.placeholder.com/150x200?text=Official'}" class="rounded shadow mb-3" style="width: 150px; height: 200px; object-fit: cover;">
            <h4>${official.nama_official}</h4>
            <span class="badge bg-primary">${official.jabatan}</span>
        </div>
        <div class="col-12">
            <ul class="list-group list-group-flush">
                <li class="list-group-item"><strong>ID Official:</strong> ${official.id_official}</li>
                <li class="list-group-item"><strong>ID Klub:</strong> ${official.id_klub}</li>
                <li class="list-group-item"><strong>Tanggal Lahir:</strong> ${new Date(official.tanggal_lahir).toISOString().split('T')[0]}</li>
                <li class="list-group-item"><strong>Usia:</strong> ${calculateAge(official.tanggal_lahir)} tahun</li>
                <li class="list-group-item"><small class="text-muted">Dibuat: ${new Date(official.time_stamp).toLocaleString()}</small></li>
            </ul>
        </div>
    `;

    let customFooter = '';
    if (isOwner && editable) {
        customFooter = `
            <div>
                <button class="btn btn-danger me-2" onclick="confirmDeleteOfficial('${id}', '${official.nama_official}')" data-bs-dismiss="modal">Hapus</button>
                <button class="btn btn-success" onclick="openOfficialForm('${id}', ${JSON.stringify(official).replace(/"/g, '&quot;')})" data-bs-dismiss="modal">Edit</button>
            </div>
        `;
    } else if (isOwner && !editable) {
        customFooter = `<div class="alert alert-warning text-center m-0">ADMIN_KLUB: Batas waktu edit/hapus 1 jam telah berakhir.</div>`;
    } else {
         customFooter = `<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Tutup</button>`;
    }

    showModalForm('Detail Official', formHtml, (e) => e.preventDefault(), customFooter);
}

function confirmDeleteOfficial(id_official, nama_official) {
    showConfirmationModal(`Apakah Anda yakin ingin menghapus data official ${nama_official}?`, async () => {
        const data = { action: 'DELETE', id_official: id_official };
        const result = await callAppsScript('CRUD_OFFICIAL', { data: JSON.stringify(data) });
        
        if (result && result.success) {
            showToast(result.message);
            loadOfficialList();
        } else if (result) {
            showToast(result.message, false);
        }
    });
}

function filterOfficialList() {
    const searchText = document.getElementById('search-official').value.toLowerCase();
    document.querySelectorAll('#official-list > div').forEach(card => {
        const nama = card.dataset.nama;
        card.style.display = nama.includes(searchText) ? 'flex' : 'none';
    });
}

// --- NAVIGASI KOMPETISI ---
function getPemainDetail(id_pemain) {
    return globalValidPemain.find(p => p.id_pemain === id_pemain);
}

function getOfficialDetail(id_official) {
    return globalValidOfficial.find(o => o.id_official === id_official);
}

async function renderKompetisi() {
    contentDiv.innerHTML = `
        <h2><i class="fas fa-trophy me-2"></i>Daftar Kompetisi</h2>
        ${currentUser.type_users === 'ADMIN_PUSAT' ? `<button class="btn btn-primary mb-3" onclick="openKompetisiForm('NEW')"><i class="fas fa-plus me-1"></i> Buat Kompetisi</button>` : ''}
        <div id="kompetisi-list" class="row g-3">
            <p class="text-center"><i class="fas fa-spinner fa-spin me-2"></i>Memuat daftar kompetisi...</p>
        </div>
    `;
    loadKompetisiList();
}

async function loadKompetisiList() {
    const result = await callAppsScript('GET_LIST_KOMPETISI');
    const listDiv = document.getElementById('kompetisi-list');
    listDiv.innerHTML = '';

    if (!result || !result.success || result.data.length === 0) {
        listDiv.innerHTML = `<div class="col-12"><div class="alert alert-info text-center">Tidak ada kompetisi yang terdaftar.</div></div>`;
        return;
    }

    result.data.forEach(kompetisi => {
        const startDate = new Date(kompetisi.tanggal_awal_pendaftaran);
        const endDate = new Date(kompetisi.tanggal_akhir_pendaftaran);
        const now = new Date();
        const isRegistrationOpen = now >= startDate && now <= endDate;
        const registrationStatus = now < startDate ? 'Belum Dibuka' : now > endDate ? 'Ditutup' : 'Dibuka';
        const statusClass = now < startDate ? 'warning' : now > endDate ? 'danger' : 'success';


        listDiv.innerHTML += `
            <div class="col-12">
                <div class="card shadow-sm">
                    <div class="card-body">
                        <div class="d-flex align-items-center">
                            <img src="${kompetisi.url_logo_liga || 'https://via.placeholder.com/60'}" class="me-3 rounded" style="width: 60px; height: 60px; object-fit: cover;">
                            <div>
                                <h5 class="mb-0">${kompetisi.nama_kompetisi} (U-${kompetisi.umur_maksimal})</h5>
                                <small class="text-muted d-block">Pendaftaran: ${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}</small>
                                <span class="badge bg-${statusClass}">${registrationStatus}</span>
                            </div>
                        </div>
                        <div class="mt-3 d-grid gap-2 d-md-block">
                            ${currentUser.type_users === 'ADMIN_PUSAT' ? `
                                <button class="btn btn-sm btn-outline-info me-2" onclick="openKompetisiForm('${kompetisi.id_kompetisi}', ${JSON.stringify(kompetisi).replace(/"/g, '&quot;')})">Edit Kompetisi</button>
                            ` : ''}
                            ${currentUser.type_users.startsWith('ADMIN_KLUB') ? `
                                ${isRegistrationOpen ? `
                                    <button class="btn btn-sm btn-primary" onclick="openPrakompetisiSubforms('${kompetisi.id_kompetisi}')">Daftarkan Tim</button>
                                ` : `
                                    <button class="btn btn-sm btn-secondary" disabled>Pendaftaran ${registrationStatus}</button>
                                `}
                            ` : ''}
                        </div>
                    </div>
                </div>
            </div>
        `;
    });
}

function openKompetisiForm(id_kompetisi, data = {}) {
    if (currentUser.type_users !== 'ADMIN_PUSAT') {
        showToast("Akses ditolak.", false);
        return;
    }
    
    const isNew = id_kompetisi === 'NEW';
    
    const formHtml = `
        <input type="hidden" name="action" value="${isNew ? 'CREATE' : 'UPDATE'}">
        <input type="hidden" name="id_kompetisi" value="${data.id_kompetisi || (isNew ? 'COMP-' + Math.floor(Math.random() * 10000) : '')}" ${isNew ? 'readonly' : ''}>

        <div class="col-12">
            <label for="nama_kompetisi" class="form-label">Nama Kompetisi</label>
            <input type="text" class="form-control" id="nama_kompetisi" name="nama_kompetisi" value="${data.nama_kompetisi || ''}" required>
        </div>

        <div class="col-md-6">
            <label for="umur_maksimal" class="form-label">Umur Maksimal (U-)</label>
            <input type="number" class="form-control" id="umur_maksimal" name="umur_maksimal" value="${data.umur_maksimal || ''}" required min="10" max="99">
        </div>
        
        <div class="col-md-6">
            <label for="url_logo_liga" class="form-label">URL Logo Liga</label>
            <input type="text" class="form-control" id="url_logo_liga" name="url_logo_liga" value="${data.url_logo_liga || ''}" placeholder="URL Gambar Logo">
             <input type="file" class="form-control mt-2" id="url_logo_liga_file" accept="image/*" onchange="previewImage(event, 'logo-liga-preview')">
             <img id="logo-liga-preview" src="${data.url_logo_liga || 'https://via.placeholder.com/60'}" class="mt-2 rounded" style="width: 60px; height: 60px; object-fit: cover;">
        </div>

        <div class="col-md-6">
            <label for="tanggal_awal_pendaftaran" class="form-label">Awal Pendaftaran</label>
            <input type="date" class="form-control" id="tanggal_awal_pendaftaran" name="tanggal_awal_pendaftaran" value="${data.tanggal_awal_pendaftaran ? new Date(data.tanggal_awal_pendaftaran).toISOString().split('T')[0] : ''}" required>
        </div>
        <div class="col-md-6">
            <label for="tanggal_akhir_pendaftaran" class="form-label">Akhir Pendaftaran</label>
            <input type="date" class="form-control" id="tanggal_akhir_pendaftaran" name="tanggal_akhir_pendaftaran" value="${data.tanggal_akhir_pendaftaran ? new Date(data.tanggal_akhir_pendaftaran).toISOString().split('T')[0] : ''}" required>
        </div>
        
        <div class="col-12">
            <label for="deskripsi" class="form-label">Deskripsi</label>
            <textarea class="form-control" id="deskripsi" name="deskripsi" rows="2">${data.deskripsi || ''}</textarea>
        </div>
    `;

    const modalFooter = isNew ? '' : `
        <button type="button" class="btn btn-danger me-auto" onclick="confirmDeleteKompetisi('${data.id_kompetisi}', '${data.nama_kompetisi}')" data-bs-dismiss="modal">Hapus</button>
    `;

    showModalForm(`${isNew ? 'Buat' : 'Edit'} Kompetisi`, formHtml, handleKompetisiFormSubmit, modalFooter);
}

async function handleKompetisiFormSubmit(e) {
    // Tambahkan 'url_logo_liga_file' ke fileFields
    await handleGenericFormSubmit(e, 'CRUD_LIST_KOMPETISI', ['url_logo_liga_file'], loadKompetisiList);
}

function confirmDeleteKompetisi(id_kompetisi, nama_kompetisi) {
    showConfirmationModal(`Apakah Anda yakin ingin menghapus kompetisi ${nama_kompetisi}?`, async () => {
        const data = { action: 'DELETE', id_kompetisi: id_kompetisi };
        const result = await callAppsScript('CRUD_LIST_KOMPETISI', { data: JSON.stringify(data) });
        
        if (result && result.success) {
            showToast(result.message);
            loadKompetisiList();
        } else if (result) {
            showToast(result.message, false);
        }
    });
}


async function openPrakompetisiSubforms(id_kompetisi) {
    const allKompetisi = (await callAppsScript('GET_LIST_KOMPETISI')).data || [];
    const kompetisi = allKompetisi.find(k => k.id_kompetisi === id_kompetisi);
    const kompetisiName = kompetisi ? kompetisi.nama_kompetisi : `Kompetisi ${id_kompetisi}`;

    contentDiv.innerHTML = `
        <h2><i class="fas fa-list-alt me-2"></i>Pendaftaran Prakompetisi</h2>
        <h4 class="text-muted">${kompetisiName} (U-${kompetisi.umur_maksimal})</h4>
        <div class="alert alert-info mt-3">
            Pemain yang muncul di *select box* telah otomatis difilter sesuai batasan usia U-${kompetisi.umur_maksimal} untuk klub Anda.
        </div>
        
        <ul class="nav nav-tabs" id="prakompetisi-tabs" role="tablist">
            <li class="nav-item" role="presentation">
                <button class="nav-link active" id="pemain-tab" data-bs-toggle="tab" data-bs-target="#pemain-subform" type="button" role="tab">Pemain (<span id="pemain-count">0</span>/25)</button>
            </li>
            <li class="nav-item" role="presentation">
                <button class="nav-link" id="official-tab" data-bs-toggle="tab" data-bs-target="#official-subform" type="button" role="tab">Official (<span id="official-count">0</span>/10)</button>
            </li>
        </ul>

        <div class="tab-content border border-top-0 p-3 bg-white" id="prakompetisi-tab-content">
            <div class="tab-pane fade show active" id="pemain-subform" role="tabpanel">
                <input type="hidden" id="idKompetisi" value="${id_kompetisi}">
                <input type="hidden" id="idKlub" value="${currentUser.id_klub}">
                <div class="table-responsive">
                    <table class="table table-bordered table-sm align-middle">
                        <thead><tr><th>No</th><th>ID Pemain</th><th>Nama Pemain</th><th>Posisi</th><th>Aksi</th></tr></thead>
                        <tbody id="pemain-prakompetisi-body"></tbody>
                    </table>
                </div>
                <button class="btn btn-sm btn-primary mt-3" onclick="addRowPemainPrakompetisi('${id_kompetisi}')"><i class="fas fa-plus"></i> Tambah Pemain</button>
                <button class="btn btn-success mt-3 float-end" onclick="savePemainPrakompetisi('${id_kompetisi}')"><i class="fas fa-save"></i> Simpan Daftar Pemain</button>
            </div>
            
            <div class="tab-pane fade" id="official-subform" role="tabpanel">
                <div class="table-responsive">
                    <table class="table table-bordered table-sm align-middle">
                        <thead><tr><th>No</th><th>ID Official</th><th>Nama Official</th><th>Jabatan</th><th>Aksi</th></tr></thead>
                        <tbody id="official-prakompetisi-body"></tbody>
                    </table>
                </div>
                <button class="btn btn-sm btn-primary mt-3" onclick="addRowOfficialPrakompetisi('${id_kompetisi}')"><i class="fas fa-plus"></i> Tambah Official</button>
                <button class="btn btn-success mt-3 float-end" onclick="saveOfficialPrakompetisi('${id_kompetisi}')"><i class="fas fa-save"></i> Simpan Daftar Official</button>
            </div>
        </div>
        <button class="btn btn-secondary w-100 mt-3" onclick="renderPage('kompetisi')">Kembali ke Daftar Kompetisi</button>
    `;

    await Promise.all([
        loadPemainPrakompetisi(id_kompetisi),
        loadOfficialPrakompetisi(id_kompetisi)
    ]);
}

// Subform Players Logic
async function loadPemainPrakompetisi(id_kompetisi) {
    const [allValidResult, registeredResult] = await Promise.all([
        callAppsScript('GET_FILTERED_PEMAIN', { id_kompetisi }),
        callAppsScript('GET_REGISTERED_PEMAIN', { id_kompetisi })
    ]);

    const tbody = document.getElementById('pemain-prakompetisi-body');
    const countSpan = document.getElementById('pemain-count');
    tbody.innerHTML = '';

    globalValidPemain = allValidResult.success ? allValidResult.data.filter(p => p.id_klub === currentUser.id_klub) : [];
    const registeredPemain = registeredResult.data || [];

    if (globalValidPemain.length === 0 && registeredPemain.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger">Tidak ada Pemain yang memenuhi batasan usia di klub Anda.</td></tr>`;
        countSpan.textContent = '0';
        return;
    }
    
    // Render data yang sudah terdaftar
    registeredPemain.forEach((reg, index) => {
        addRowPemainPrakompetisi(id_kompetisi, reg);
    });

    // Tambahkan baris kosong untuk entri baru (jika tidak ada data terdaftar)
    if (tbody.querySelectorAll('tr').length === 0 && globalValidPemain.length > 0) {
        addRowPemainPrakompetisi(id_kompetisi);
    }
    
    // Update count
    const currentRowCount = tbody.querySelectorAll('tr').length;
    countSpan.textContent = currentRowCount;
}

function addRowPemainPrakompetisi(id_kompetisi, data = {}) {
    const tbody = document.getElementById('pemain-prakompetisi-body');
    const countSpan = document.getElementById('pemain-count');
    const index = tbody.querySelectorAll('tr').length + 1;

    if (index > 25) {
        showToast("Maksimal 25 Pemain!", false);
        return;
    }

    const selectOptions = globalValidPemain.map(p => `
        <option value="${p.id_pemain}" 
                data-posisi="${p.posisi}" 
                data-nopunggung="${p.no_punggung}"
                data-nama="${p.nama_pemain}"
                ${p.id_pemain === data.id_pemain ? 'selected' : ''}>
            ${p.nama_pemain} (No.${p.no_punggung})
        </option>
    `).join('');

    const newRow = document.createElement('tr');
    newRow.dataset.id_kompetisi = id_kompetisi;
    newRow.innerHTML = `
        <td>${index}</td>
        <td><input type="text" class="form-control form-control-sm id-pemain-display" value="${data.id_pemain || ''}" readonly></td>
        <td>
            <select class="form-select form-select-sm pemain-select" onchange="updatePemainInfo(this)" required>
                <option value="">Pilih Pemain</option>
                ${selectOptions}
            </select>
            <input type="hidden" class="pemain-id" name="id_pemain" value="${data.id_pemain || ''}">
            <input type="hidden" class="pemain-nama" name="nama_pemain" value="${data.nama_pemain || ''}">
        </td>
        <td>
            <input type="text" class="form-control form-control-sm pemain-posisi" value="${data.posisi || ''}" readonly>
            <input type="hidden" class="pemain-nopunggung" name="no_punggung" value="${data.no_punggung || ''}">
        </td>
        <td><button type="button" class="btn btn-danger btn-sm" onclick="removeRow(this, 'pemain-count')"><i class="fas fa-trash"></i></button></td>
    `;
    
    tbody.appendChild(newRow);
    updateRowNumbers(tbody);
    countSpan.textContent = tbody.querySelectorAll('tr').length;
    
    // Panggil update info jika data sudah ada (untuk row yang dimuat dari database)
    if(data.id_pemain) {
        const select = newRow.querySelector('.pemain-select');
        // Karena kita tidak bisa memicu event change saat load, kita panggil fungsi update-nya
        updatePemainInfo(select);
    }
}

function updatePemainInfo(selectElement) {
    const selectedOption = selectElement.options[selectElement.selectedIndex];
    const row = selectElement.closest('tr');
    
    const id = selectedOption.value;
    const nama = selectedOption.dataset.nama || '';
    const posisi = selectedOption.dataset.posisi || '';
    const noPunggung = selectedOption.dataset.nopunggung || '';

    row.querySelector('.id-pemain-display').value = id;
    row.querySelector('.pemain-id').value = id;
    row.querySelector('.pemain-nama').value = nama;
    row.querySelector('.pemain-posisi').value = posisi;
    row.querySelector('.pemain-nopunggung').value = noPunggung;
}

async function savePemainPrakompetisi(id_kompetisi) {
    const tbody = document.getElementById('pemain-prakompetisi-body');
    const rows = tbody.querySelectorAll('tr');
    const idKlub = document.getElementById('idKlub').value;
    const entries = [];
    let isValid = true;
    let selectedIds = new Set();

    rows.forEach(row => {
        // Ambil nilai dari input hidden (yang diisi oleh updatePemainInfo)
        const id = row.querySelector('.pemain-id').value;
        const nama = row.querySelector('.pemain-nama').value;
        const posisi = row.querySelector('.pemain-posisi').value;
        const no_punggung = row.querySelector('.pemain-nopunggung').value;

        // Hanya proses baris yang memiliki ID dan Nama (telah dipilih dari select box)
        if (id && nama) { 
            if (selectedIds.has(id)) {
                showToast(`Duplikasi Pemain ID: ${id}. Harap hapus duplikasi.`, false);
                isValid = false;
                return;
            }
            
            entries.push({ 
                id_kompetisi, 
                id_klub: idKlub, 
                id_pemain: id, 
                nama_pemain: nama, 
                posisi, 
                no_punggung // Data No. Punggung ikut terkirim
            });
            selectedIds.add(id);
        }
    });

    if (!isValid) return;

    if (entries.length > 25) {
        showToast("Maksimal 25 Pemain!", false);
        return;
    }
    
    if (entries.length === 0 && rows.length > 0) {
        showToast("Pilih minimal 1 pemain untuk disimpan, atau hapus semua baris untuk mengosongkan daftar.", false);
        return;
    }
    
    // Panggil Apps Script
    const result = await callAppsScript('SAVE_PEMAIN_PRAKOMPETISI', { 
        id_kompetisi, 
        entries: JSON.stringify(entries) 
    });

    if (result.success) {
        showToast(result.message);
        loadPemainPrakompetisi(id_kompetisi);
    } else {
        showToast(result.message, false);
    }
}

// Subform Officials Logic
async function loadOfficialPrakompetisi(id_kompetisi) {
    const [allOfficialResult, registeredResult] = await Promise.all([
        callAppsScript('GET_OFFICIAL'),
        callAppsScript('GET_REGISTERED_OFFICIAL', { id_kompetisi })
    ]);

    const tbody = document.getElementById('official-prakompetisi-body');
    const countSpan = document.getElementById('official-count');
    tbody.innerHTML = '';

    globalValidOfficial = allOfficialResult.data.filter(o => o.id_klub === currentUser.id_klub);
    const registeredOfficial = registeredResult.data || [];

    if (globalValidOfficial.length === 0 && registeredOfficial.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger">Tidak ada Official terdaftar di klub Anda.</td></tr>`;
        countSpan.textContent = '0';
        return;
    }
    
    registeredOfficial.forEach((reg, index) => {
        addRowOfficialPrakompetisi(id_kompetisi, reg);
    });

    if (tbody.querySelectorAll('tr').length === 0 && globalValidOfficial.length > 0) {
        addRowOfficialPrakompetisi(id_kompetisi);
    }
    
    const currentRowCount = tbody.querySelectorAll('tr').length;
    countSpan.textContent = currentRowCount;
}

function addRowOfficialPrakompetisi(id_kompetisi, data = {}) {
    const tbody = document.getElementById('official-prakompetisi-body');
    const countSpan = document.getElementById('official-count');
    const index = tbody.querySelectorAll('tr').length + 1;

    if (index > 10) {
        showToast("Maksimal 10 Official!", false);
        return;
    }

    const selectOptions = globalValidOfficial.map(o => `
        <option value="${o.id_official}" 
                data-jabatan="${o.jabatan}" 
                data-nama="${o.nama_official}"
                ${o.id_official === data.id_official ? 'selected' : ''}>
            ${o.nama_official}
        </option>
    `).join('');

    const newRow = document.createElement('tr');
    newRow.dataset.id_kompetisi = id_kompetisi;
    newRow.innerHTML = `
        <td>${index}</td>
        <td><input type="text" class="form-control form-control-sm id-official-display" value="${data.id_official || ''}" readonly></td>
        <td>
            <select class="form-select form-select-sm official-select" onchange="updateOfficialInfo(this)" required>
                <option value="">Pilih Official</option>
                ${selectOptions}
            </select>
            <input type="hidden" class="official-id" name="id_official" value="${data.id_official || ''}">
            <input type="hidden" class="official-nama" name="nama_official" value="${data.nama_official || ''}">
        </td>
        <td>
            <input type="text" class="form-control form-control-sm official-jabatan" value="${data.jabatan || ''}" readonly>
        </td>
        <td><button type="button" class="btn btn-danger btn-sm" onclick="removeRow(this, 'official-count')"><i class="fas fa-trash"></i></button></td>
    `;
    
    tbody.appendChild(newRow);
    updateRowNumbers(tbody);
    countSpan.textContent = tbody.querySelectorAll('tr').length;

    if(data.id_official) {
        const select = newRow.querySelector('.official-select');
        updateOfficialInfo(select);
    }
}

function updateOfficialInfo(selectElement) {
    const selectedOption = selectElement.options[selectElement.selectedIndex];
    const row = selectElement.closest('tr');
    
    const id = selectedOption.value;
    const nama = selectedOption.dataset.nama || '';
    const jabatan = selectedOption.dataset.jabatan || '';

    row.querySelector('.id-official-display').value = id;
    row.querySelector('.official-id').value = id;
    row.querySelector('.official-nama').value = nama;
    row.querySelector('.official-jabatan').value = jabatan;
}

async function saveOfficialPrakompetisi(id_kompetisi) {
    const tbody = document.getElementById('official-prakompetisi-body');
    const rows = tbody.querySelectorAll('tr');
    const idKlub = document.getElementById('idKlub').value;
    const entries = [];
    let isValid = true;
    let selectedIds = new Set();

    rows.forEach(row => {
        const id = row.querySelector('.official-id').value;
        const nama = row.querySelector('.official-nama').value;
        const jabatan = row.querySelector('.official-jabatan').value;

        if (id && nama) {
            if (selectedIds.has(id)) {
                showToast(`Duplikasi Official ID: ${id}. Harap hapus duplikasi.`, false);
                isValid = false;
                return;
            }
            entries.push({ 
                id_kompetisi, 
                id_klub: idKlub, 
                id_official: id, 
                nama_official: nama, 
                jabatan 
            });
            selectedIds.add(id);
        }
    });

    if (!isValid) return;

    if (entries.length > 10) {
        showToast("Maksimal 10 Official!", false);
        return;
    }

    if (entries.length === 0 && rows.length > 0) {
        showToast("Pilih minimal 1 official untuk disimpan, atau hapus semua baris untuk mengosongkan daftar.", false);
        return;
    }

    const result = await callAppsScript('SAVE_OFFICIAL_PRAKOMPETISI', { 
        id_kompetisi, 
        entries: JSON.stringify(entries) 
    });

    if (result.success) {
        showToast(result.message);
        loadOfficialPrakompetisi(id_kompetisi);
    } else {
        showToast(result.message, false);
    }
}

function removeRow(button, countId) {
    const tbody = button.closest('tbody');
    button.closest('tr').remove();
    updateRowNumbers(tbody);
    
    const currentCount = tbody.querySelectorAll('tr').length;
    document.getElementById(countId).textContent = currentCount;

    // Jika semua baris dihapus, tambahkan satu baris kosong lagi (kecuali jika listnya memang kosong total)
    if (currentCount === 0) {
        const idKompetisi = document.getElementById('idKompetisi').value;
        if (countId === 'pemain-count' && globalValidPemain.length > 0) {
            addRowPemainPrakompetisi(idKompetisi);
        } else if (countId === 'official-count' && globalValidOfficial.length > 0) {
            addRowOfficialPrakompetisi(idKompetisi);
        }
    }
}

function updateRowNumbers(tbody) {
    tbody.querySelectorAll('tr').forEach((row, index) => {
        row.querySelector('td:first-child').textContent = index + 1;
    });
}


// --- NAVIGASI SETTING ---
async function renderSetting() {
    if (currentUser.type_users !== 'ADMIN_PUSAT') {
         renderHome();
         return;
    }
    contentDiv.innerHTML = `
        <h2><i class="fas fa-cog me-2"></i>Pengaturan Aplikasi</h2>
        <div class="card shadow-sm mb-4">
            <div class="card-header bg-info text-white">Pengaturan Banner Slide</div>
            <div class="card-body" id="setting-banner-content">
                <p class="text-center"><i class="fas fa-spinner fa-spin me-2"></i>Memuat data banner...</p>
            </div>
        </div>
        <div class="card shadow-sm">
            <div class="card-header bg-info text-white">Pengaturan Pengguna (Userlist)</div>
            <div class="card-body" id="setting-userlist-content">
                <button class="btn btn-success mb-3" onclick="openUserlistForm('NEW')"><i class="fas fa-user-plus me-1"></i> Tambah Pengguna</button>
                <div id="userlist-table">
                    <p class="text-center"><i class="fas fa-spinner fa-spin me-2"></i>Memuat data pengguna...</p>
                </div>
            </div>
        </div>
    `;
    loadBannerSetting();
    loadUserlistSetting();
}

async function loadBannerSetting() {
    const result = await callAppsScript('GET_BANNERS');
    const content = document.getElementById('setting-banner-content');
    const data = result && result.success ? result.data : {};

    content.innerHTML = `
        <form id="banner-form" class="row g-3">
            ${[1, 2, 3].map(i => `
                <div class="col-12 col-md-4">
                    <label class="form-label">Banner ${i} URL</label>
                    <img id="banner${i}-preview" src="${data[`url_banner${i}`] || 'https://via.placeholder.com/200x100?text=Banner'}" class="img-fluid rounded mb-2" style="height: 100px; object-fit: cover; width: 100%;">
                    <input type="file" class="form-control" id="url_banner${i}_file" accept="image/*" onchange="previewImage(event, 'banner${i}-preview')">
                    <input type="hidden" name="url_banner${i}" value="${data[`url_banner${i}`] || ''}">
                </div>
            `).join('')}
            <div class="col-12 d-grid">
                <button type="submit" class="btn btn-primary">Simpan Pengaturan Banner</button>
            </div>
        </form>
    `;

    document.getElementById('banner-form').addEventListener('submit', handleBannerFormSubmit);
}

async function handleBannerFormSubmit(e) {
    const fileFields = ['url_banner1_file', 'url_banner2_file', 'url_banner3_file'];
    
    await handleGenericFormSubmit(e, 'CRUD_BANNER', fileFields, () => {
        loadBannerSetting();
        loadBanners();
    });
}

async function loadUserlistSetting() {
    const result = await callAppsScript('GET_USERLIST');
    const tableDiv = document.getElementById('userlist-table');
    tableDiv.innerHTML = '';

    if (!result || !result.success || result.data.length === 0) {
        tableDiv.innerHTML = `<div class="alert alert-info text-center">Tidak ada data pengguna.</div>`;
        return;
    }

    let tableHtml = `
        <div class="table-responsive">
            <table class="table table-striped table-sm align-middle">
                <thead>
                    <tr>
                        <th>Username</th>
                        <th>Tipe</th>
                        <th>ID Klub</th>
                        <th>Aksi</th>
                    </tr>
                </thead>
                <tbody>
    `;

    result.data.forEach(user => {
        tableHtml += `
            <tr>
                <td>${user.username}</td>
                <td><span class="badge bg-secondary">${user.type_users}</span></td>
                <td>${user.id_klub || '-'}</td>
                <td>
                    <button class="btn btn-warning btn-sm me-1" onclick="openUserlistForm('${user.username}', ${JSON.stringify(user).replace(/"/g, '&quot;')})"><i class="fas fa-edit"></i></button>
                    ${user.username !== currentUser.username ? `
                        <button class="btn btn-danger btn-sm" onclick="confirmDeleteUserlist('${user.username}')"><i class="fas fa-trash"></i></button>
                    ` : ''}
                </td>
            </tr>
        `;
    });

    tableHtml += `
                </tbody>
            </table>
        </div>
    `;
    tableDiv.innerHTML = tableHtml;
}

function openUserlistForm(username, data = {}) {
    const isNew = username === 'NEW';
    const typeOptions = ["ADMIN_PUSAT", "ADMIN_KLUB"];

    const formHtml = `
        <input type="hidden" name="action" value="${isNew ? 'CREATE' : 'UPDATE'}">
        <div class="col-md-6">
            <label for="username" class="form-label">Username</label>
            <input type="text" class="form-control" id="username" name="username" value="${data.username || ''}" ${isNew ? 'required' : 'readonly'}>
        </div>
        <div class="col-md-6">
            <label for="password" class="form-label">${isNew ? 'Password (Wajib)' : 'Password (Kosongkan jika tidak diubah)'}</label>
            <input type="password" class="form-control" id="password" name="password" ${isNew ? 'required' : ''}>
        </div>
        <div class="col-md-6">
            <label for="type_users" class="form-label">Tipe Pengguna</label>
            <select class="form-select" id="type_users" name="type_users" required>
                ${typeOptions.map(t => `<option value="${t}" ${data.type_users === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
        </div>
        <div class="col-md-6">
            <label for="id_klub" class="form-label">ID Klub (Wajib untuk ADMIN_KLUB)</label>
            <input type="text" class="form-control" id="id_klub" name="id_klub" value="${data.id_klub || ''}">
        </div>
    `;

    showModalForm(`${isNew ? 'Tambah' : 'Edit'} Pengguna`, formHtml, handleUserlistFormSubmit);
}

async function handleUserlistFormSubmit(e) {
    await handleGenericFormSubmit(e, 'CRUD_USERLIST', [], loadUserlistSetting);
}

function confirmDeleteUserlist(username) {
    showConfirmationModal(`Apakah Anda yakin ingin menghapus pengguna ${username}?`, async () => {
        const data = { action: 'DELETE', username: username };
        const result = await callAppsScript('CRUD_USERLIST', { data: JSON.stringify(data) });
        
        if (result && result.success) {
            showToast(result.message);
            loadUserlistSetting();
        } else if (result) {
            showToast(result.message, false);
        }
    });
}


// --- INIT ---
document.addEventListener('DOMContentLoaded', renderApp);
