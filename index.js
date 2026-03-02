// ============================================================
//  PlantasdeHuerto Instagram Bot — v2.0
//  Arquitectura limpia | RAG real | Comportamiento humano
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
  REPLY_DELAY_MS = 8000,   // pausa natural antes de responder
  CONVERSATION_TTL_MS = 7200000, // 2h inactividad limpia la conv
} = process.env;

const MAX_MSG_LENGTH   = 980;   // Instagram DM hard limit ~1000
const TOP_K_WEB        = 10;
const TOP_K_TIENDA     = 8;
const EMBED_DIMS       = 512;
const EMBED_MODEL      = 'text-embedding-3-small';
const CHAT_MODEL       = 'gpt-4o-mini';

// ─── Clientes ────────────────────────────────────────────────
const app    = express();
app.use(express.json());

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

let idxWeb    = null;
let idxTienda = null;

if (PINECONE_API_KEY) {
  const pc = new Pinecone({ apiKey: PINECONE_API_KEY });
  idxWeb    = pc.Index(PINECONE_INDEX_WEB).namespace('articulos');
  idxTienda = pc.Index(PINECONE_INDEX_TIENDA).namespace('tiendafisica');
  console.log(`✅ Pinecone: web="${PINECONE_INDEX_WEB}" tienda="${PINECONE_INDEX_TIENDA}"`);
} else {
  console.warn('⚠️  PINECONE_API_KEY no definida');
}

// ─── System Prompt con placeholder ───────────────────────────
// {{CATALOGO_WEB}} y {{CATALOGO_TIENDA}} se reemplazan en runtime
const SYSTEM_PROMPT_TEMPLATE = `Eres un asesor de ventas experto de PlantasdeHuerto.com, el vivero online del Huerto Deitana (Totana, Murcia).
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

5. CIERRE NATURAL
   - Cuando el cliente esté decidido, ayúdale a completar: "¿Lo pedimos ya por la web o prefieres pasarte por Totana?"
   - No dejes ninguna conversación sin una llamada a la acción clara.

NUNCA:
- Inventes productos o precios que no están en el catálogo inyectado.
- Uses el mismo formato de respuesta siempre.
- Olvides mencionar la tienda física cuando tengas stock allí.
- Seas frío, genérico o robótico.`;

// ─── Helpers ─────────────────────────────────────────────────
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

// Recupera artículos relevantes de ambos índices dado un query
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
      const r = await idxWeb.query(queryOpts(TOP_K_WEB));
      const scores = (r.matches || []).map(m => m.score?.toFixed(3)).join(', ');
      const items = (r.matches || []).filter(m => m.score > 0.0).map(m => metaToText(m.metadata));
      result.web = items.join('\n');
      console.log(`  🌐 Web: ${items.length} resultados | scores: [${scores}] | query: "${query}"`);
    } catch (e) {
      console.error('❌ Pinecone web:', e.message);
    }
  }

  if (idxTienda) {
    try {
      const r = await idxTienda.query(queryOpts(TOP_K_TIENDA));
      const items = (r.matches || []).filter(m => m.score > 0.0).map(m => metaToText(m.metadata));
      result.tienda = items.join('\n');
      console.log(`  🏪 Tienda: ${items.length} resultados`);
    } catch (e) {
      console.error('❌ Pinecone tienda:', e.message);
    }
  }

  return result;
}

function buildSystemPrompt(catalogWeb, catalogTienda) {
  return SYSTEM_PROMPT_TEMPLATE
    .replace('{{CATALOGO_WEB}}',    catalogWeb    || '(Sin resultados para esta consulta en web.)')
    .replace('{{CATALOGO_TIENDA}}', catalogTienda || '(Sin resultados para esta consulta en tienda física.)');
}

// ─── Gestión de conversaciones ───────────────────────────────
// Estructura: Map<senderId, { messages: [], lastActivity: timestamp }>
const conversations = new Map();

function getConv(senderId) {
  if (!conversations.has(senderId)) {
    conversations.set(senderId, { messages: [], lastActivity: Date.now() });
  }
  const conv = conversations.get(senderId);
  conv.lastActivity = Date.now();
  return conv;
}

// Limpieza periódica de conversaciones inactivas
setInterval(() => {
  const cutoff = Date.now() - CONVERSATION_TTL_MS;
  for (const [id, conv] of conversations.entries()) {
    if (conv.lastActivity < cutoff) {
      conversations.delete(id);
      console.log(`🗑️  Conversación expirada: ${id}`);
    }
  }
}, 300_000);

// ─── Núcleo IA ───────────────────────────────────────────────
// Query limpio: SOLO mensajes del usuario (nunca respuestas del bot)
// Los últimos 2 del historial + el nuevo mensaje actual
function buildSearchQuery(messages, newMessage) {
  const prevUserMsgs = messages
    .filter(m => m.role === 'user')
    .slice(-2)
    .map(m => m.content);

  return [...prevUserMsgs, newMessage].join(' ').slice(0, 150);
}

async function processMessage(senderId, userText) {
  const conv = getConv(senderId);

  // 1. Construir query de búsqueda con contexto acumulado
  const searchQuery = buildSearchQuery(conv.messages, userText);

  // 2. Recuperar catálogo relevante de Pinecone
  const { web: catalogWeb, tienda: catalogTienda } = await retrieveCatalog(searchQuery);

  // 3. Inyectar catálogo en system prompt
  const systemPrompt = buildSystemPrompt(catalogWeb, catalogTienda);

  // 4. Añadir mensaje del usuario al historial
  conv.messages.push({ role: 'user', content: userText });

  // 5. Mantener ventana de contexto razonable (últimos 20 turnos)
  const contextWindow = conv.messages.slice(-20);

  // 6. Llamar a la IA
  let reply;
  try {
    const response = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        ...contextWindow,
      ],
      max_tokens: 600,
      temperature: 0.8,   // más natural/humano
    });
    reply = response.choices[0].message.content?.trim()
      || 'Perdona, no pude procesar bien tu consulta. ¿Me lo explicas de otra forma?';
  } catch (e) {
    console.error('❌ OpenAI error:', e.message);
    reply = 'Ups, algo falló en mi parte. ¿Me mandas el mensaje de nuevo?';
  }

  // 7. Guardar respuesta en historial
  conv.messages.push({ role: 'assistant', content: reply });

  console.log(`💬 [${senderId}] → "${userText.slice(0, 60)}..."`);
  console.log(`   ← "${reply.slice(0, 80)}..."`);

  // 8. Enviar respuesta
  await sendMessage(senderId, reply);
}

// ─── Envío de mensajes (chunking) ────────────────────────────
async function sendMessage(recipientId, text) {
  // Divide en chunks respetando palabras completas
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_MSG_LENGTH) {
      chunks.push(remaining);
      break;
    }
    let cutAt = remaining.lastIndexOf(' ', MAX_MSG_LENGTH);
    if (cutAt < 0) cutAt = MAX_MSG_LENGTH;
    chunks.push(remaining.slice(0, cutAt));
    remaining = remaining.slice(cutAt).trimStart();
  }

  for (let i = 0; i < chunks.length; i++) {
    try {
      await axios.post(
        `https://graph.instagram.com/v21.0/me/messages`,
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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Rutas Express ───────────────────────────────────────────
app.get('/', (_req, res) => res.send('🌱 PlantasdeHuerto Bot v2 — Online'));

app.get('/privacy', (_req, res) => {
  res.send(`<html><body>
    <h1>Política de Privacidad</h1>
    <p>Los mensajes se procesan en tiempo real para responder automáticamente y no se almacenan en base de datos permanente.</p>
    <p>Contacto: info@plantasdehuerto.com</p>
  </body></html>`);
});

// Verificación del webhook Instagram
app.get('/webhook', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verificado');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Recepción de mensajes
app.post('/webhook', (req, res) => {
  // Responder 200 inmediatamente (Instagram requiere <5s)
  res.sendStatus(200);

  const { object, entry = [] } = req.body;
  if (object !== 'instagram') return;

  for (const e of entry) {
    // Formato messaging (DMs estándar)
    for (const event of (e.messaging || [])) {
      if (event.message && !event.message.is_echo) {
        const senderId = event.sender?.id;
        const text     = event.message?.text?.trim();
        if (senderId && text) {
          console.log(`📥 [${senderId}]: "${text}"`);
          (async () => {
            await sleep(REPLY_DELAY_MS); // pausa humana
            await processMessage(senderId, text);
          })();
        }
      }
    }
    // Formato changes (webhook v2)
    for (const change of (e.changes || [])) {
      if (change.field === 'messages') {
        const senderId = change.value?.sender?.id;
        const text     = change.value?.message?.text?.trim();
        if (senderId && text) {
          console.log(`📥 [${senderId}] (change): "${text}"`);
          (async () => {
            await sleep(REPLY_DELAY_MS);
            await processMessage(senderId, text);
          })();
        }
      }
    }
  }
});

// Debug: test RAG completo — muestra scores reales y metadata cruda
// Uso: GET /test-rag?q=limonero
app.get('/test-rag', async (req, res) => {
  const query = req.query.q || 'limonero';
  try {
    const vector = await embed(query);

    const webRaw    = idxWeb    ? await idxWeb.query({ vector, topK: 5, includeMetadata: true })    : { matches: [] };
    const tiendaRaw = idxTienda ? await idxTienda.query({ vector, topK: 5, includeMetadata: true }) : { matches: [] };

    const fmt = (matches) => (matches || []).map(m => ({
      score: m.score?.toFixed(4),
      metadata: m.metadata,
    }));

    res.json({
      query,
      embed_dims:   vector.length,
      web_count:    webRaw.matches?.length || 0,
      tienda_count: tiendaRaw.matches?.length || 0,
      web:    fmt(webRaw.matches),
      tienda: fmt(tiendaRaw.matches),
    });
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack?.split('\n').slice(0, 5) });
  }
});

app.get('/test-token', async (_req, res) => {
  try {
    const r = await axios.get('https://graph.instagram.com/v21.0/me', {
      params: { access_token: ACCESS_TOKEN },
    });
    res.json({ ok: true, data: r.data });
  } catch (e) {
    res.json({ error: e.response?.data || e.message });
  }
});


// ─── Start ───────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🌱 PlantasdeHuerto Bot v2.0`);
  console.log(`   Puerto:       ${PORT}`);
  console.log(`   OpenAI:       ${OPENAI_API_KEY  ? '✅' : '❌ falta OPENAI_API_KEY'}`);
  console.log(`   Pinecone web: ${idxWeb    ? `✅ ${PINECONE_INDEX_WEB}`    : '❌'}`);
  console.log(`   Pinecone tda: ${idxTienda ? `✅ ${PINECONE_INDEX_TIENDA}` : '❌'}`);
  console.log(`   Delay:        ${REPLY_DELAY_MS / 1000}s\n`);
});