// ============================================================
//  PlantasdeHuerto Instagram Bot — v3.0
//  DMs + Comentarios con Vision + RAG real
// ============================================================

require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const OpenAI  = require('openai').default;
const { Pinecone } = require('@pinecone-database/pinecone');

// ─── Config ─────────────────────────────────────────────────
const {
  VERIFY_TOKEN,
  ACCESS_TOKEN,
  OPENAI_API_KEY,
  PINECONE_API_KEY,
  PINECONE_INDEX_WEB    = 'huertoia-instagram',
  PINECONE_INDEX_TIENDA = 'huertoia-tiendafisica',
  PORT = 3000,
  REPLY_DELAY_MS = 8000,
  CONVERSATION_TTL_MS = 7200000,
} = process.env;

const MAX_MSG_LENGTH = 980;
const TOP_K_WEB      = 10;
const TOP_K_TIENDA   = 8;
const EMBED_DIMS     = 512;
const EMBED_MODEL    = 'text-embedding-3-small';
const CHAT_MODEL     = 'gpt-4o-mini';
const VISION_MODEL   = 'gpt-4o';              // Vision para leer imágenes de posts
const IG_GRAPH       = 'https://graph.instagram.com/v21.0';

// ─── Clientes ────────────────────────────────────────────────
const app    = express();
app.use(express.json());

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

let idxWeb    = null;
let idxTienda = null;

if (PINECONE_API_KEY) {
  const pc  = new Pinecone({ apiKey: PINECONE_API_KEY });
  idxWeb    = pc.Index(PINECONE_INDEX_WEB).namespace('articulos');
  idxTienda = pc.Index(PINECONE_INDEX_TIENDA).namespace('tiendafisica');
  console.log(`✅ Pinecone: web="${PINECONE_INDEX_WEB}" tienda="${PINECONE_INDEX_TIENDA}"`);
} else {
  console.warn('⚠️  PINECONE_API_KEY no definida');
}

// ─── System Prompts ──────────────────────────────────────────

// Para DMs — conversación larga y detallada
const DM_PROMPT_TEMPLATE = `Eres un asesor de ventas experto de PlantasdeHuerto.com, el vivero online del Huerto Deitana (Totana, Murcia).
Hablas con clientes por Instagram de forma natural, cercana y humana — NUNCA como un bot o un catálogo.

DATOS DE CONTACTO: 968 422 335 | info@plantasdehuerto.com | Totana, Murcia

════════════════════════════════════════
CATÁLOGO DISPONIBLE EN WEB (compra online ya disponible)
════════════════════════════════════════
{{CATALOGO_WEB}}

════════════════════════════════════════
CATÁLOGO TIENDA FÍSICA (solo presencial, Totana)
════════════════════════════════════════
{{CATALOGO_TIENDA}}

════════════════════════════════════════
CÓMO ACTUAR
════════════════════════════════════════

1. USA EL CATÁLOGO QUE TIENES ARRIBA
   - Responde SOLO con productos que aparecen en el catálogo inyectado.
   - Si un producto está en WEB → el cliente lo puede comprar online ahora mismo.
   - Si está en TIENDA → indícalo y menciona que puede acercarse a Totana.
   - Si no tienes resultados → díselo con honestidad y ofrece alternativas o contacto.

2. SÉ HUMANO, NO UN ROBOT
   - Escribe como una persona real: frases cortas, tono cálido, a veces informales.
   - No uses listas interminables. Máximo 2-3 productos por mensaje.
   - No repitas la misma estructura de respuesta siempre.
   - Si el cliente está frustrado, empatiza ANTES de dar información.

3. VENTA CONSULTIVA (ESCUCHA Y SUGIERE)
   - Haz preguntas para entender: ¿maceta o tierra? ¿interior o exterior? ¿cuánto espacio?
   - Cuando el cliente elija algo, sugiere UN complementario relevante (sustrato, abono, maceta, riego...).
   - No bombardees con productos. Una sugerencia bien colocada vale más que diez.

4. MEMORIA DE CONVERSACIÓN
   - Conecta lo que el cliente dijo antes con lo nuevo.
   - Si antes mencionó "planto en terraza", úsalo al recomendar.

5. ENVÍOS Y LOGÍSTICA
   - España peninsular e Islas Baleares: envíos disponibles.
   - Solo enviamos a Portugal en Europa.
   - Envío gratuito a partir de 70€. Coste estándar: 9,90€.
   - Plazo: 1 día preparación + 24/48h entrega.
   - No se aceptan devoluciones. Reclamaciones en 1 semana.

6. CIERRE NATURAL
   - Cuando el cliente esté decidido: "¿Lo pedimos ya por la web o prefieres pasarte por Totana?"

NUNCA:
- Inventes productos o precios que no están en el catálogo inyectado.
- Uses el mismo formato de respuesta siempre.
- Olvides mencionar la tienda física cuando tengas stock allí.
- Seas frío, genérico o robótico.`;

// Para comentarios públicos
const COMMENT_PROMPT_TEMPLATE = `Eres el asesor de ventas de PlantasdeHuerto.com (vivero Huerto Deitana, Totana, Murcia).
Estás respondiendo un comentario PÚBLICO en Instagram. Usas toda la información disponible para dar la mejor respuesta posible.

════════════════════════════════════════
CONTEXTO DEL POST
════════════════════════════════════════
{{CONTEXTO_POST}}

════════════════════════════════════════
CATÁLOGO RELACIONADO AL POST
════════════════════════════════════════
{{CATALOGO_WEB}}

════════════════════════════════════════
HISTORIAL DE ESTE USUARIO EN ESTE POST
════════════════════════════════════════
{{HISTORIAL_USUARIO}}

════════════════════════════════════════
CÓMO ACTUAR
════════════════════════════════════════

Eres inteligente — lee el comentario, el contexto del post y el historial, y decide la mejor respuesta.

TIPOS DE COMENTARIOS que puedes encontrar y cómo manejarlos:

1. PREGUNTA DE PRODUCTO O COMPRA
   → Responde con info breve del catálogo (nombre, precio si lo tienes).
   → Termina invitando a escribir por privado: "Escríbenos por privado para ayudarte 🌿"
   → Nunca prometas enviar nada TÚ — es el cliente quien debe escribir.

2. MENCIÓN DE AMIGOS (@usuario)
   → El post puede ser un sorteo o simplemente etiquetar a alguien.
   → Lee el contexto del post para entender si es sorteo o no.
   → Si es sorteo: responde con calidez agradeciendo la participación (ej: "¡Gracias por participar! 🍀").
   → Si no es sorteo y solo etiquetan: responde brevemente al contexto (ej: "¡Que lo disfruten juntos! 🌱").
   → Si este usuario ya comentó antes en este post: NO respondas de nuevo, devuelve exactamente la cadena vacía "".

3. HALAGO O COMENTARIO POSITIVO
   → Agradece con calidez y naturalidad. Breve.

4. PREGUNTA GENERAL SOBRE EL VIVERO
   → Responde con la info que tengas del post y catálogo.
   → Invita a escribir por privado para más detalle.

5. COMENTARIO IRRELEVANTE O SPAM
   → Devuelve exactamente la cadena vacía "". No respondas.

REGLAS INAMOVIBLES:
- MÁXIMO 2 líneas. Es un comentario público.
- NUNCA pongas links ni URLs — no funcionan en comentarios de Instagram.
- NUNCA inventes precios ni productos que no estén en el catálogo.
- NUNCA digas "te mando" o "te envío" — tú no mandas nada.
- Si decides no responder → devuelve exactamente "".
- Tono: humano, cercano, natural. Nunca robótico.`;

// ─── Helpers ─────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function embed(text) {
  const res = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: text,
    dimensions: EMBED_DIMS,
  });
  return res.data[0].embedding;
}

function metaToText(meta) {
  if (!meta || typeof meta !== 'object') return '';
  return Object.entries(meta)
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([k, v]) => `${k}: ${String(v).trim()}`)
    .join(' | ');
}

async function retrieveCatalog(query) {
  const result = { web: '', tienda: '' };
  if (!idxWeb && !idxTienda) return result;

  let vector;
  try {
    vector = await embed(query);
  } catch (e) {
    console.error('❌ embed error:', e.message);
    return result;
  }

  const queryOpts = (topK) => ({ vector, topK, includeMetadata: true });

  if (idxWeb) {
    try {
      const r      = await idxWeb.query(queryOpts(TOP_K_WEB));
      const scores = (r.matches || []).map(m => m.score?.toFixed(3)).join(', ');
      const items  = (r.matches || []).filter(m => m.score > 0.0).map(m => metaToText(m.metadata));
      result.web   = items.join('\n');
      console.log(`  🌐 Web: ${items.length} resultados | scores: [${scores}] | query: "${query}"`);
    } catch (e) { console.error('❌ Pinecone web:', e.message); }
  }

  if (idxTienda) {
    try {
      const r       = await idxTienda.query(queryOpts(TOP_K_TIENDA));
      const items   = (r.matches || []).filter(m => m.score > 0.0).map(m => metaToText(m.metadata));
      result.tienda = items.join('\n');
      console.log(`  🏪 Tienda: ${items.length} resultados`);
    } catch (e) { console.error('❌ Pinecone tienda:', e.message); }
  }

  return result;
}

// ─── Anti-bucle: IDs de comentarios ya procesados ──────────────
const processedComments = new Set();
// Limpiar cada hora para no crecer indefinidamente
setInterval(() => processedComments.clear(), 3600000);

// ─── Obtener contexto del post (caption + Vision) ────────────
async function getPostContext(mediaId) {
  try {
    const r = await axios.get(`${IG_GRAPH}/${mediaId}`, {
      params: {
        fields: 'caption,media_url,thumbnail_url,media_type',
        access_token: ACCESS_TOKEN,
      },
    });

    const { caption = '', media_url, thumbnail_url, media_type } = r.data;

    // Para video usamos thumbnail, para imagen usamos media_url
    const imageUrl = media_type === 'VIDEO' ? thumbnail_url : media_url;

    let visualDescription = '';

    // Mandar imagen a GPT-4o Vision — descargar como base64 primero
    // (las URLs de Instagram expiran y no son accesibles directamente)
    if (imageUrl) {
      try {
        const imgRes = await axios.get(imageUrl, { responseType: 'arraybuffer' });
        const base64 = Buffer.from(imgRes.data).toString('base64');
        const mimeType = imgRes.headers['content-type'] || 'image/jpeg';

        const visionRes = await openai.chat.completions.create({
          model: VISION_MODEL,
          max_tokens: 200,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Eres un experto en plantas y viveros. Describe brevemente qué producto o planta aparece en esta imagen de Instagram de un vivero. Sé específico: nombre de la planta si la reconoces, características visuales, presentación (maceta, cepellón, bandeja...). Máximo 3 líneas.',
              },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
            ],
          }],
        });
        visualDescription = visionRes.choices[0].message.content?.trim() || '';
        console.log(`  👁️  Vision: "${visualDescription.slice(0, 80)}"`);
      } catch (e) {
        console.warn('⚠️  Vision falló (usando solo caption):', e.message);
      }
    }

    const context = [
      caption           ? `Caption del post: ${caption}` : '',
      visualDescription ? `Descripción visual: ${visualDescription}` : '',
    ].filter(Boolean).join('\n');

    return context || 'Sin contexto disponible del post.';

  } catch (e) {
    console.error('❌ getPostContext:', e.message);
    return 'No se pudo obtener el contexto del post.';
  }
}

// ─── Responder comentario públicamente ───────────────────────
async function replyToComment(commentId, text) {
  try {
    await axios.post(
      `${IG_GRAPH}/${commentId}/replies`,
      { message: text },
      { params: { access_token: ACCESS_TOKEN } }
    );
    console.log(`  💬 Comentario respondido: "${text.slice(0, 60)}"`);
  } catch (e) {
    console.error('❌ replyToComment:', e.response?.data || e.message);
  }
}

// Historial de comentarios respondidos por post y usuario
// Map<mediaId, Map<senderId, count>> — la IA decide qué hacer con este contexto
const commentHistory = new Map();
setInterval(() => commentHistory.clear(), 3600000);

// ─── Procesar comentario ──────────────────────────────────────
async function processComment(commentId, mediaId, senderId, commentText) {
  console.log(`💬 Comentario [${senderId}] en post [${mediaId}]: "${commentText}"`);

  // Registrar historial: cuántas veces ha comentado este usuario en este post
  if (!commentHistory.has(mediaId)) commentHistory.set(mediaId, new Map());
  const postHistory = commentHistory.get(mediaId);
  const prevCount = postHistory.get(senderId) || 0;
  postHistory.set(senderId, prevCount + 1);
  const isReturningCommenter = prevCount > 0;

  // 1. Obtener contexto del post (caption + visión)
  const postContext = await getPostContext(mediaId);

  // 2. Buscar en Pinecone con el comentario + contexto del post
  const searchQuery = `${commentText} ${postContext}`.slice(0, 200);
  const { web: catalogWeb } = await retrieveCatalog(searchQuery);

  // 3. Construir historial del usuario en este post
  const historialTexto = isReturningCommenter
    ? `Este usuario ya ha comentado ${prevCount} vez/veces antes en este post.`
    : 'Primera vez que este usuario comenta en este post.';

  // 4. Construir system prompt con todo el contexto
  const systemPrompt = COMMENT_PROMPT_TEMPLATE
    .replace('{{CONTEXTO_POST}}',     postContext)
    .replace('{{CATALOGO_WEB}}',      catalogWeb || '(Sin resultados en catálogo.)')
    .replace('{{HISTORIAL_USUARIO}}', historialTexto);

  // 5. Generar respuesta — la IA decide qué responder (o nada)
  let publicReply;
  try {
    const res = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: commentText },
      ],
      max_tokens: 150,
      temperature: 0.8,
    });
    publicReply = res.choices[0].message.content?.trim() || '';
  } catch (e) {
    console.error('❌ OpenAI comment:', e.message);
    publicReply = '¡Gracias por tu comentario! 🌱 Escríbenos por privado para ayudarte';
  }

  // 6. Si la IA decidió no responder → no hacer nada
  if (!publicReply) {
    console.log(`  ⏭️  IA decidió no responder a este comentario`);
    return;
  }

  // 7. Responder comentario públicamente
  await replyToComment(commentId, publicReply);

}

// ─── Gestión de conversaciones (DMs) ────────────────────────
const conversations = new Map();

function getConv(senderId) {
  if (!conversations.has(senderId)) {
    conversations.set(senderId, { messages: [], lastActivity: Date.now() });
  }
  const conv = conversations.get(senderId);
  conv.lastActivity = Date.now();
  return conv;
}

setInterval(() => {
  const cutoff = Date.now() - CONVERSATION_TTL_MS;
  for (const [id, conv] of conversations.entries()) {
    if (conv.lastActivity < cutoff) {
      conversations.delete(id);
      console.log(`🗑️  Conversación expirada: ${id}`);
    }
  }
}, 300_000);

function buildSearchQuery(messages, newMessage) {
  const prevUserMsgs = messages
    .filter(m => m.role === 'user')
    .slice(-2)
    .map(m => m.content);
  return [...prevUserMsgs, newMessage].join(' ').slice(0, 150);
}

// ─── Procesar DM ─────────────────────────────────────────────
async function processMessage(senderId, userText) {
  const conv        = getConv(senderId);
  const searchQuery = buildSearchQuery(conv.messages, userText);

  const { web: catalogWeb, tienda: catalogTienda } = await retrieveCatalog(searchQuery);

  const systemPrompt = DM_PROMPT_TEMPLATE
    .replace('{{CATALOGO_WEB}}',    catalogWeb    || '(Sin resultados para esta consulta en web.)')
    .replace('{{CATALOGO_TIENDA}}', catalogTienda || '(Sin resultados para esta consulta en tienda física.)');

  conv.messages.push({ role: 'user', content: userText });
  const contextWindow = conv.messages.slice(-20);

  let reply;
  try {
    const response = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        ...contextWindow,
      ],
      max_tokens: 600,
      temperature: 0.8,
    });
    reply = response.choices[0].message.content?.trim()
      || 'Perdona, no pude procesar bien tu consulta. ¿Me lo explicas de otra forma?';
  } catch (e) {
    console.error('❌ OpenAI error:', e.message);
    reply = 'Ups, algo falló en mi parte. ¿Me mandas el mensaje de nuevo?';
  }

  conv.messages.push({ role: 'assistant', content: reply });
  console.log(`💬 DM [${senderId}] → "${userText.slice(0, 60)}"`);
  console.log(`   ← "${reply.slice(0, 80)}"`);

  await sendMessage(senderId, reply);
}

// ─── Envío de DMs (chunking) ─────────────────────────────────
async function sendMessage(recipientId, text) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_MSG_LENGTH) { chunks.push(remaining); break; }
    let cutAt = remaining.lastIndexOf(' ', MAX_MSG_LENGTH);
    if (cutAt < 0) cutAt = MAX_MSG_LENGTH;
    chunks.push(remaining.slice(0, cutAt));
    remaining = remaining.slice(cutAt).trimStart();
  }

  for (let i = 0; i < chunks.length; i++) {
    try {
      await axios.post(
        `${IG_GRAPH}/me/messages`,
        { recipient: { id: recipientId }, message: { text: chunks[i] } },
        {
          params: { access_token: ACCESS_TOKEN },
          headers: { 'Content-Type': 'application/json' },
        }
      );
      if (i < chunks.length - 1) await sleep(600);
    } catch (err) {
      console.error('❌ sendMessage:', err.response?.data || err.message);
    }
  }
}

// ─── Rutas Express ───────────────────────────────────────────
app.get('/', (_req, res) => res.send('🌱 PlantasdeHuerto Bot v3 — DMs + Comentarios'));

app.get('/privacy', (_req, res) => {
  res.send(`<html><body>
    <h1>Política de Privacidad</h1>
    <p>Los mensajes se procesan en tiempo real y no se almacenan permanentemente.</p>
    <p>Contacto: info@plantasdehuerto.com</p>
  </body></html>`);
});

// Verificación webhook
app.get('/webhook', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verificado');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Recepción de eventos — DMs y Comentarios
app.post('/webhook', (req, res) => {
  res.sendStatus(200);

  const { object, entry = [] } = req.body;
  if (object !== 'instagram') return;

  for (const e of entry) {

    // ── DMs ──────────────────────────────────────────────────
    for (const event of (e.messaging || [])) {
      if (event.message && !event.message.is_echo) {
        const senderId = event.sender?.id;
        const text     = event.message?.text?.trim();
        if (senderId && text) {
          console.log(`📥 DM [${senderId}]: "${text}"`);
          (async () => {
            await sleep(REPLY_DELAY_MS);
            await processMessage(senderId, text);
          })();
        }
      }
    }

    // ── Changes (DMs v2 + Comentarios) ───────────────────────
    for (const change of (e.changes || [])) {

      // DMs formato changes
      if (change.field === 'messages') {
        const senderId = change.value?.sender?.id;
        const text     = change.value?.message?.text?.trim();
        if (senderId && text) {
          console.log(`📥 DM(change) [${senderId}]: "${text}"`);
          (async () => {
            await sleep(REPLY_DELAY_MS);
            await processMessage(senderId, text);
          })();
        }
      }

      // Comentarios en posts
      if (change.field === 'comments') {
        const val         = change.value;
        const commentId   = val?.id;
        const mediaId     = val?.media?.id;
        const senderId    = val?.from?.id;
        const commentText = val?.text?.trim();

        if (!commentId || !mediaId || !commentText) continue;

        // Anti-bucle: ignorar si ya procesamos este comentario
        if (processedComments.has(commentId)) {
          console.log(`  🔄 Comentario duplicado ignorado: ${commentId}`);
          continue;
        }
        processedComments.add(commentId);

        // Ignorar comentarios propios — comparar por ID de la cuenta
        // El ID de la cuenta propia viene en entry[0].id
        if (senderId === e.id) continue;

        console.log(`💬 Comentario recibido en post [${mediaId}]: "${commentText}"`);
        (async () => {
          await sleep(REPLY_DELAY_MS);
          await processComment(commentId, mediaId, senderId, commentText);
        })();
      }
    }
  }
});

// Test RAG
app.get('/test-rag', async (req, res) => {
  const query = req.query.q || 'limonero';
  try {
    const vector    = await embed(query);
    const webRaw    = idxWeb    ? await idxWeb.query({ vector, topK: 5, includeMetadata: true })    : { matches: [] };
    const tiendaRaw = idxTienda ? await idxTienda.query({ vector, topK: 5, includeMetadata: true }) : { matches: [] };
    const fmt = (m) => (m || []).map(x => ({ score: x.score?.toFixed(4), metadata: x.metadata }));
    res.json({
      query, embed_dims: vector.length,
      web_count: webRaw.matches?.length || 0,
      tienda_count: tiendaRaw.matches?.length || 0,
      web: fmt(webRaw.matches), tienda: fmt(tiendaRaw.matches),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/test-token', async (_req, res) => {
  try {
    const r = await axios.get(`${IG_GRAPH}/me`, {
      params: { access_token: ACCESS_TOKEN, fields: 'id,name,username' },
    });
    const perms = await axios.get(`${IG_GRAPH}/me/permissions`, {
      params: { access_token: ACCESS_TOKEN },
    });
    res.json({ ok: true, data: r.data, permissions: perms.data });
  } catch (e) {
    res.json({ error: e.response?.data || e.message });
  }
});

// ─── Start ───────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🌱 PlantasdeHuerto Bot v3.0 — DMs + Comentarios`);
  console.log(`   Puerto:       ${PORT}`);
  console.log(`   OpenAI:       ${OPENAI_API_KEY  ? '✅' : '❌ falta OPENAI_API_KEY'}`);
  console.log(`   Pinecone web: ${idxWeb    ? `✅ ${PINECONE_INDEX_WEB}`    : '❌'}`);
  console.log(`   Pinecone tda: ${idxTienda ? `✅ ${PINECONE_INDEX_TIENDA}` : '❌'}`);
  console.log(`   Delay:        ${REPLY_DELAY_MS / 1000}s\n`);
});