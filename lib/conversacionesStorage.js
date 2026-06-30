/**
 * Dani escribe en Firestore; el Director lee la colección conversations-instagram.
 *
 * .env (local):
 *   FIREBASE_SERVICE_ACCOUNT='{...json...}'
 *
 * Railway (recomendado — evita problemas con comillas):
 *   FIREBASE_SERVICE_ACCOUNT_BASE64=<json en base64>
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

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
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

async function logMensaje({
  canal = 'instagram_dm',
  cliente,
  nombre = '',
  username = '',
  telefono = '',
  mensaje,
  rol = 'cliente',
  conversacionId = null,
}) {
  const firestore = getDb();
  const ts = new Date().toISOString();
  const entry = { rol, contenido: mensaje, timestamp: ts };

  if (conversacionId) {
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
  }

  const id = newId();
  const doc = {
    id,
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
  await firestore.collection(COLLECTION).doc(id).set({
    ...doc,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return doc;
}

/** Tras cada DM: guarda mensaje del cliente + respuesta de Dani */
async function registrarTurnoDM({ senderId, username, name, userMessage, botReply, conversacionId }) {
  const telefono = String(senderId);
  const profile = profileFields({ username, name, senderId });

  const conv = await logMensaje({
    canal: 'instagram_dm',
    ...profile,
    telefono,
    mensaje: userMessage,
    rol: 'cliente',
    conversacionId,
  });

  const convId = conv.id;

  if (botReply) {
    await logMensaje({
      canal: 'instagram_dm',
      ...profile,
      telefono,
      mensaje: botReply,
      rol: 'dani',
      conversacionId: convId,
    });
  }

  return { conversacionId: convId };
}

module.exports = {
  COLLECTION,
  hasFirebaseConfig,
  pingFirestore,
  registrarTurnoDM,
  logMensaje,
};
