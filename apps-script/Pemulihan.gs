/**
 * Pemulihan akses — untuk owner yang lupa password.
 *
 * Fungsi ini TIDAK bisa dipanggil dari web; hanya bisa dijalankan dari editor Apps Script
 * oleh pemilik project, jadi aman.
 *
 * Cara pakai:
 *   1. Pilih fungsi `resetPasswordOwner` di toolbar editor → klik Jalankan.
 *   2. Buka "Log eksekusi": catat USERNAME dan PASSWORD SEMENTARA.
 *   3. Login di web, lalu segera ganti password di menu Profil (klik inisial di kanan atas).
 *
 * Bila ada lebih dari satu owner, isi USERNAME_PEMULIHAN di bawah dengan username yang mau direset.
 */

const USERNAME_PEMULIHAN = ''; // kosongkan = owner pertama yang aktif

function resetPasswordOwner() {
  const users = readTable_('SYS_User');
  const owners = users.filter(function (u) { return u.role_id === 'owner'; });
  Logger.log('Owner terdaftar: ' + (owners.map(function (u) { return u.username + (bool_(u.aktif) ? '' : ' (nonaktif)'); }).join(', ') || '-'));

  var target;
  if (USERNAME_PEMULIHAN) {
    target = users.filter(function (u) { return u.username === String(USERNAME_PEMULIHAN).trim().toLowerCase(); })[0];
    if (!target) { Logger.log('Username "' + USERNAME_PEMULIHAN + '" tidak ditemukan. Periksa tab SYS_User.'); return; }
  } else {
    const aktif = owners.filter(function (u) { return bool_(u.aktif); });
    if (!owners.length) { Logger.log('Belum ada owner. Jalankan upgradeSchema untuk mendapat kode setup owner.'); return; }
    if (aktif.length > 1) { Logger.log('Ada ' + aktif.length + ' owner aktif. Isi USERNAME_PEMULIHAN di baris atas file ini, simpan, lalu jalankan lagi.'); return; }
    target = aktif[0] || owners[0];
  }

  // password sementara 10 karakter tanpa huruf/angka yang mirip (0/O, 1/l/I)
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seed = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Date.now());
  var temp = '';
  for (var i = 0; i < 10; i++) temp += chars.charAt(((seed[i] % 256) + 256) % 256 % chars.length);

  withLock_(function () {
    const salt = Utilities.getUuid();
    updateWhere_('SYS_User', 'id', target.id, {
      salt: salt, hash_password: hashPassword_(temp, salt), gagal_login: 0, terkunci_sampai: '', aktif: true,
    });
    revokeUserSessions_(target.id, '');
    audit_({ session: { username: 'pemulihan-editor' } }, 'RESET_PASSWORD', 'SYS_User', target.username, null, null, 'Reset dari editor Apps Script');
  });

  Logger.log('======================================');
  Logger.log('USERNAME          : ' + target.username);
  Logger.log('PASSWORD SEMENTARA: ' + temp);
  Logger.log('======================================');
  Logger.log('Login di web, lalu segera ganti password di menu Profil.');
}
