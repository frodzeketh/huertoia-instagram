/**
 * Dani escribe en Firestore; el Director lee la colección conversations-instagram.
 * ID de documento = username de IG (ej: facuprds) o ig_{senderId} si no hay username.
 */

const { initializeApp, cert, getApps } = require('firebase-admin');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const COLLECTION = 'conversations-instagram';

let db = null;

function hasFirebaseConfig() {
  return !!(
    process.env.FIREBASE_SERVICE_ACCOUNT?.trim()
    || process.env.FIREBASE_SERVICE_ACCOUNT_BASE64?.trim()
  );
}

function parseServiceAccount() {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64?.trim();
  if (b64) {
    try {
      return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    } catch (e) {
      throw new Error(`FIREBASE_SERVICE_ACCOUNT_BASE64 inválido: ${e.message}`);
    }
  }

  let raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (!raw) {
    throw new Error('Configura FIREBASE_SERVICE_ACCOUNT o FIREBASE_SERVICE_ACCOUNT_BASE64');
  }

  if (
    (raw.startsWith("'") && raw.endsWith("'"))
    || (raw.startsWith('"') && raw.endsWith('"'))
  ) {
    raw = raw.slice(1, -1);
  }

  try {
    return JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(raw.replace(/\\"/g, '"'));
    } catch (e) {
      throw new Error(`FIREBASE_SERVICE_ACCOUNT JSON inválido: ${e.message}`);
    }
  }
}

function getDb() {
  if (db) return db;
  const serviceAccount = parseServiceAccount();
  if (!getApps().length) {
    initializeApp({ credential: cert(serviceAccount) });
  }
  db = getFirestore();
  return db;
}

async function pingFirestore() {
  const firestore = getDb();
  await firestore.collection(COLLECTION).limit(1).get();
  return { ok: true, project: parseServiceAccount().project_id, collection: COLLECTION };
}

/** ID estable del documento: username o ig_{senderId} */
function docIdForUser({ username, senderId }) {
  const user = username?.replace(/^@/, '').trim().toLowerCase();
  if (user && /^[a-z0-9._]{1,128}$/.test(user)) return user;
  return `ig_${senderId}`;
}

function buildCliente({ username, name, senderId }) {
  const user = username?.replace(/^@/, '').trim();
  if (user) return `@${user}`;
  if (name?.trim()) return name.trim();
  return `ig:${senderId}`;
}

function profileFields({ username, name, senderId }) {
  const user = username?.replace(/^@/, '').trim() || '';
  const nombre = name?.trim() || '';
  return {
    username: user,
    nombre,
    cliente: buildCliente({ username: user, name: nombre, senderId }),
  };
}

/** Un solo documento por usuario — busca por telefono si el id cambió tras un deploy */
async function resolveConversacionId({ senderId, username }) {
  const firestore = getDb();
  const telefono = String(senderId);
  const canonicalId = docIdForUser({ username, senderId });

  const canonicalRef = firestore.collection(COLLECTION).doc(canonicalId);
  if ((await canonicalRef.get()).exists) return canonicalId;

  const existing = await firestore.collection(COLLECTION)
    .where('telefono', '==', telefono)
    .limit(5)
    .get();

  if (existing.empty) return canonicalId;

  const oldDoc = existing.docs[0];
  if (oldDoc.id === canonicalId) return canonicalId;

  const data = oldDoc.data();
  const profile = profileFields({ username: username || data.username, name: data.nombre, senderId });
  await canonicalRef.set({
    ...data,
    ...profile,
    id: canonicalId,
    telefono,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await oldDoc.ref.delete();
  console.log(`[conversations-instagram] Migrado ${oldDoc.id} → ${canonicalId}`);
  return canonicalId;
}

async function logMensaje({
  canal = 'instagram_dm',
  cliente,
  nombre = '',
  username = '',
  telefono = '',
  mensaje,
  rol = 'cliente',
  conversacionId,
}) {
  const firestore = getDb();
  const ts = new Date().toISOString();
  const entry = { rol, contenido: mensaje, timestamp: ts };
  const ref = firestore.collection(COLLECTION).doc(conversacionId);
  const snap = await ref.get();

  if (snap.exists) {
    const conv = snap.data();
    const update = {
      mensajes: [...(conv.mensajes || []), entry],
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (nombre) update.nombre = nombre;
    if (username) {
      update.username = username;
      update.cliente = `@${username}`;
    } else if (nombre && conv.cliente?.startsWith('ig:')) {
      update.cliente = nombre;
    }
    await ref.update(update);
    return { id: conversacionId, ...conv, ...update, mensajes: update.mensajes };
  }

  const doc = {
    id: conversacionId,
    canal,
    cliente,
    nombre,
    username,
    telefono,
    mensajes: [entry],
    resumen: '',
    oportunidadesDetectadas: [],
    estado: 'activa',
    createdAt: ts,
  };
  await ref.set({
    ...doc,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return doc;
}

/** Tras cada DM: guarda mensaje del cliente + respuesta de Dani */
async function registrarTurnoDM({ senderId, username, name, userMessage, botReply }) {
  const telefono = String(senderId);
  const profile = profileFields({ username, name, senderId });
  const conversacionId = await resolveConversacionId({ senderId, username: profile.username });

  const conv = await logMensaje({
    canal: 'instagram_dm',
    ...profile,
    telefono,
    mensaje: userMessage,
    rol: 'cliente',
    conversacionId,
  });

  if (botReply) {
    await logMensaje({
      canal: 'instagram_dm',
      ...profile,
      telefono,
      mensaje: botReply,
      rol: 'dani',
      conversacionId: conv.id,
    });
  }

  return { conversacionId: conv.id };
}

module.exports = {
  COLLECTION,
  docIdForUser,
  hasFirebaseConfig,
  pingFirestore,
  registrarTurnoDM,
  logMensaje,
};
