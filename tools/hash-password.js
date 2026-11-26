// Genera el SQL para crear TU primera cuenta de moderador (las demás se crean desde el launcher).
// Uso:  node tools/hash-password.js TuNombreDeMinecraft "TuContraseñaInicial"
const crypto = require("crypto");
const [, , user, pass] = process.argv;
if (!user || !pass) { console.log('Uso: node tools/hash-password.js NombreMinecraft "ContraseñaInicial"'); process.exit(1); }
if (!/^[A-Za-z0-9_]{3,16}$/.test(user)) { console.log("El usuario debe tener 3 a 16 caracteres: letras, números o _"); process.exit(1); }
if (pass.length < 8 || pass.length > 72) { console.log("La contraseña debe tener entre 8 y 72 caracteres"); process.exit(1); }
const ITER = 600000;
const salt = crypto.randomBytes(16);
const hash = crypto.pbkdf2Sync(pass, salt, ITER, 32, "sha256");
console.log(`\ninsert into users (username, password_hash, role) values ('${user}', 'pbkdf2$${ITER}$${salt.toString("base64")}$${hash.toString("base64")}', 'moderator');\n`);
