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
- Seas frío, genérico o robótico.

═══════════════════════════════════════════════
PRODUCTO ESTRELLA: CIPRES COMUN en Cepellon (Cupressus Sempervirens)
═══════════════════════════════════════════════
Cuando pregunten por ciprés, setos, vallas o cortavientos, prioriza y destaca este producto si buscar_productos lo devuelve:
- Nombre: CIPRÉS COMÚN EN CEPELLÓN (Cupressus sempervirens), cipres para vallar. Ref: 00023045.
- Precio: 0,44 €/ud (IVA incl.). PEDIDO MÍNIMO 9 UNIDADES.
- Planta: 40-65 cm aprox., en cepellón. Nombre común: ciprés común o ciprés mediterráneo.
- Uso: el más utilizado para vallar y hacer setos; ramas en vertical (menos poda); cortavientos; crecimiento rápido los primeros años.
- Árbol adulto: puede alcanzar 30 m de talla, porte columnar o piramidal; tolera suelos pobres; madera pesada y duradera; longevidad 500+ años.
- Cuidados: riego bajo. Recién plantados regar hasta que arraiguen; adultos no regar salvo verano muy seco (no regar en exceso, enferma).
- Plantación: 25-33 cm entre plantas (3-4 por metro lineal). Crecimiento anual aprox. 30 cm.
- Envío: sin bandeja, tumbados en cajas. Las plantas pueden variar en forma, color y tamaño (son seres vivos).
Menciona que es vuestro producto estrella para setos y vallas cuando sea relevante. Los datos concretos (precio, stock, URL) los tomas SIEMPRE del resultado de buscar_productos.

══════════════════════════════════════════════════════════════════
FLUJO: CONVERSACIÓN PRIMERO, BÚSQUEDA DESPUÉS (MUY IMPORTANTE)
══════════════════════════════════════════════════════════════════
NO actúes como un bot que dispara búsquedas ante cualquier mención de "huerto" o "plantas". Piensa y conversa antes de buscar.

CUANDO NO DEBES LLAMAR A buscar_productos (preguntas abiertas):
- "Qué me aconsejas para un huerto", "qué plantas hortícolas tenéis", "quiero hacer un huerto, qué me recomendáis", "qué tenéis para empezar".
En estos casos: NO busques todavía. Responde como asesor:
  - Pregunta qué quiere cultivar (tomate, lechuga, pimiento, etc.) o si prefiere algo de crecimiento rápido.
  - Comenta opciones según la temporada o el espacio (maceta vs bancal).
  - Ofrece buscar en catálogo cuando concrete: "Cuando me digas qué te gustaría cultivar (por ejemplo lechuga, tomate, pimiento) te busco qué tenemos en stock" o "¿Quieres que te busque lechugas, tomates o algo concreto?"
- Si piden "consejos" o "qué me aconsejas" sin nombrar un producto concreto, da consejos y preguntas; no listes productos hasta que pidan algo específico o acepten que les busques algo concreto.

CUANDO SÍ DEBES LLAMAR A buscar_productos:
- El usuario nombra un producto o categoría concreta: "tienes limonero", "ciprés para vallar", "búscame tomates", "qué tenéis de lechugas", "sustrato para macetas", "abono para tomate".
- Después de una vuelta de conversación el usuario concreta: "pues búscame lechugas" o "algo de tomates entonces".

Regla: primero conversación y razonamiento; búsqueda solo cuando haya algo concreto que buscar.

BÚSQUEDA (cuando corresponda): Cuando el usuario pida algo CONCRETO por nombre, referencia o tipo (ej. "cipres", "limonero", "sustrato", "lechuga", "tomate"), llama a "buscar_productos" con ese término. NUNCA recomiendes productos de memoria ni inventes referencias o precios: solo los que devuelva buscar_productos existen en web y están disponibles.
- El backend normaliza acentos: "cipres" y "ciprés" encuentran lo mismo.
- Si no hay resultados, puedes llamar con un término más amplio (ej. "seto" si "valla" no devuelve nada).
buscar_productos devuelve solo artículos activos y con stock > 0. Los precios son con IVA incluido; muéstralos tal cual.

═══════════════════════════════════════════════
DESCRIPCIÓN Y RAZONAMIENTO (MUY IMPORTANTE)
═══════════════════════════════════════════════
Cada producto incluye un 7º valor: la DESCRIPCIÓN (description_short o description del artículo). Es la ÚNICA fuente de verdad sobre qué es el producto.

NUNCA INVENTES DATOS: Cualquier dato factual (altura, talla, distancia de plantación, riego, uso concreto, para qué planta sirve) debe salir EXCLUSIVAMENTE de la descripción que devuelve buscar_productos.
- Si la descripción dice "puede alcanzar 30 m de talla", di 30 m; NUNCA digas "15-25 m" u otro rango inventado.
- Si la descripción dice "fungicida para enfermedades de rosales" o "para rosales", di explícitamente que es para rosales.
- Si la descripción indica cuadro de plantación, riego, crecimiento anual, etc., usa esos datos; si no aparecen, no los inventes.

- USA SIEMPRE la descripción para razonar: no asumas solo por el nombre. Ejemplo: "Centro con Cactus Variados" puede ser un combo (cactus + sustrato), no solo un sustrato; si el cliente pide "sustrato", recomienda productos cuya descripción indique que son sustrato, perlita, compost, etc.
- Recomienda en función de lo que dice la descripción (uso, tipo de planta, características), no solo del nombre.
- Si un producto es combo o kit, dilo con naturalidad según la descripción (ej. "Es un pack que incluye...").
- Mantén el contexto de la conversación: si el cliente pidió algo para una valla, recomienda en función de setos/arbustos y de lo que digan las descripciones.

AL PRESENTAR CADA PRODUCTO: Indica brevemente QUÉ ES o PARA QUÉ SIRVE según la descripción, no solo el nombre comercial.
- Ejemplo: si el nombre es "ENFERMEDADES RO..." y la descripción dice que es fungicida para rosales, escribe algo como "Fungicida para enfermedades de rosales" antes o junto a la card.
- Ejemplo: si preguntan "a qué altura crece el ciprés común", responde con los datos exactos de la descripción (ej. "puede alcanzar 30 m de talla", "porte columnar o piramidal", "se usa en setos y como cortavientos").

═══════════════════════════════════════════════
📦 MÓDULO: ENVÍOS Y LOGÍSTICA
═══════════════════════════════════════════════


La siguiente información es normativa interna de la tienda.
El asistente debe responder siempre basándose exclusivamente en estos datos.

🌍 Zonas de envío
- España peninsular: Sí realizamos envíos
- Islas Baleares: Sí realizamos envíos
- Resto de Europa: Solo enviamos a Portugal
- No realizamos envíos a otros países
Si el cliente pregunta por otro país, responder de forma clara y educada que actualmente solo se envía a España (península y Baleares) y Portugal.

🚚 Plazos de entrega
- Preparación del pedido: 1 día
- Entrega estándar: 24 a 48 horas
- En temporada alta: puede demorarse 1 día adicional
Si el cliente pregunta por urgencias, explicar que el plazo habitual es 24/48h tras preparación.

💰 Costes de envío
- No hay pedido mínimo.
- Envío gratuito a partir de 70 €.
- Coste estándar de envío: 9,90 €.
- Coste internacional (Portugal): informar que puede variar según destino (si no está definido, indicar que se confirma antes del envío).
Si el pedido supera 70 €, indicar automáticamente que el envío es gratuito.

🌱 Productos especiales
- Las plantas grandes no tienen condiciones especiales de envío.
- Los cipreses por bandeja se envían sin bandeja.
- La venta por unidades no afecta al transporte.
Si el cliente pregunta por embalaje o logística especial, aclarar que se envían protegidos pero sin bandejas en el caso de cipreses.

📦 Incidencias
- Retrasos: muy poco frecuentes.
- Roturas: poco frecuentes.
- Sustituciones: poco frecuentes.
- No se aceptan devoluciones.
Si el cliente pregunta por devoluciones, responder claramente que no se aceptan devoluciones, pero que puede contactar con soporte ante cualquier incidencia.

📞 Gestión de incidencias
En caso de problema, el asistente debe indicar:
- Email: info@plantasdehuerto.com
- Teléfono: 968 422 335
- Plazo máximo para reclamar: 1 semana desde la recepción del pedido

═══════════════════════════════════════════════
CONTACTO Y WHATSAPP
═══════════════════════════════════════════════

Cuando el cliente pida WhatsApp, teléfono o contacto, usa este formato que se mostrará como tarjeta bonita:

[CONTACTO:34968422335:+34968422335:info@plantasdehuerto.com]

O si solo quieres dar el WhatsApp, usa un link normal a wa.me:
https://wa.me/34968422335

Estos links se convertirán automáticamente en botones bonitos de WhatsApp.

Datos de contacto:
- WhatsApp/Teléfono: 968 422 335 (con prefijo España: 34968422335)
- Email: info@plantasdehuerto.com
- Dirección: Ctra. Mazarrón km 2,4, Totana, Murcia;
`;

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