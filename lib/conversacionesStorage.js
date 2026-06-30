/**
 * Dani escribe en Firestore; el Director lee la colección conversations-instagram.
 *
 * .env:
 *   FIREBASE_SERVICE_ACCOUNT='{...json cuenta de servicio...}'
 */

const { initializeApp, cert, getApps } = require('firebase-admin');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const COLLECTION = 'conversations-instagram';

let db = null;

function parseServiceAccount(raw) {
  if (!raw?.trim()) {
    throw new Error('Configura FIREBASE_SERVICE_ACCOUNT en .env');
  }
  try {
    return JSON.parse(raw);
  } catch {
    return JSON.parse(raw.replace(/\\"/g, '"'));
  }
}

function getDb() {
  if (db) return db;
  const serviceAccount = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);
  if (!getApps().length) {
    initializeApp({ credential: cert(serviceAccount) });
  }
  db = getFirestore();
  return db;
}

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

async function logMensaje({
  canal = 'instagram_dm',
  cliente,
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
      await ref.update({
        mensajes: [...(conv.mensajes || []), entry],
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { id: conversacionId, ...conv, mensajes: [...(conv.mensajes || []), entry] };
    }
  }

  const id = newId();
  const doc = {
    id,
    canal,
    cliente,
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
async function registrarTurnoDM({ senderId, username, userMessage, botReply, conversacionId }) {
  const cliente = username ? `@${username}` : `ig:${senderId}`;
  const telefono = String(senderId);

  const conv = await logMensaje({
    canal: 'instagram_dm',
    cliente,
    telefono,
    mensaje: userMessage,
    rol: 'cliente',
    conversacionId,
  });

  const convId = conv.id;

  if (botReply) {
    await logMensaje({
      canal: 'instagram_dm',
      cliente,
      telefono,
      mensaje: botReply,
      rol: 'dani',
      conversacionId: convId,
    });
  }

  return { conversacionId: convId };
}

module.exports = { registrarTurnoDM, logMensaje };
