const express = require('express');
const axios = require('axios');
const OpenAI = require('openai').default;
const { Pinecone } = require('@pinecone-database/pinecone');
require('dotenv').config();

const app = express();
app.use(express.json());

const VERIFY_TOKEN = (process.env.VERIFY_TOKEN || '').trim();
const ACCESS_TOKEN = (process.env.ACCESS_TOKEN || '').trim();
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();
const PORT = process.env.PORT || 3000;

const INSTAGRAM_GRAPH = 'https://graph.instagram.com/v21.0';
const DELAY_MS = 10000; // 10 segundos antes de responder
const MAX_MESSAGE_LENGTH = 1000; // límite Instagram

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
let pineconeIndexWeb = null;
let pineconeIndexTienda = null;
let pineconeIndex = null;
if (process.env.PINECONE_API_KEY) {
  try {
    const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    const idxWeb = (process.env.PINECONE_INDEX_WEB || process.env.PINECONE_INDEX || '').trim();
    const idxTienda = (process.env.PINECONE_INDEX_TIENDA || '').trim();
    if (idxWeb) pineconeIndexWeb = pinecone.Index(idxWeb);
    if (idxTienda) pineconeIndexTienda = pinecone.Index(idxTienda);
    if (!pineconeIndexWeb && (process.env.PINECONE_INDEX || '').trim()) pineconeIndex = pinecone.Index((process.env.PINECONE_INDEX || '').trim());
  } catch (e) {
    console.warn('Pinecone no inicializado:', e.message);
  }
}

const SYSTEM_PROMPT = `Eres vendedor experto de PlantasdeHuerto.com (vivero El Huerto Deitana, Totana, Murcia).
Contacto: 968 422 335 | info@plantasdehuerto.com

BÚSQUEDA: Usa "buscar_productos" para encontrar artículos. Puedes buscar varias veces con distintos términos.

═══════════════════════════════════════════════
TU OBJETIVO: VENDER Y AYUDAR AL CLIENTE
═══════════════════════════════════════════════

1. PRIORIZA WEB, PERO MENCIONA TIENDA FÍSICA
   - Primero muestra lo disponible en WEB (puede comprar ya)
   - SIEMPRE menciona también la tienda física si hay más opciones ahí
   - Ejemplo: "En web tenemos 2 perales. En tienda física hay más variedad si puedes acercarte."

2. VENTA COMPLEMENTARIA (MUY IMPORTANTE)
   Cuando el cliente elige algo, SIEMPRE pregunta y sugiere:
   - "¿Lo plantas en maceta o en tierra?" → ofrece macetas, sustratos
   - "¿Tienes abono para [tipo de planta]?" → busca abonos
   - "Para evitar plagas te vendría bien..." → busca insecticidas
   - "¿Necesitas tutores/riego/herramientas?"
   
   NO esperes a que pregunte. TÚ guías la venta.

3. ADAPTA EL FORMATO AL CONTEXTO
   - Frustración/problema → empatiza, pregunta, NO listes productos aún
   - Pregunta abierta → haz 1-2 preguntas, luego recomienda poco
   - Modo compra → ahí SÍ lista productos con precios
   - Conversación normal → párrafos naturales, sin viñetas

4. MANTÉN EL CONTEXTO
   - Recuerda lo que el cliente dijo antes
   - Si habló de plantar en invierno y luego pregunta por perales, conecta: 
     "Para plantar ahora en invierno, te recomiendo el Peral Conferencia que aguanta bien el frío..."
   - Usa lo que sabes del cliente para personalizar

5. CIERRA LA VENTA
   - Resume lo que podría llevar
   - Pregunta si quiere añadir algo más
   - Ofrece ayuda para completar el pedido

═══════════════════════════════════════════════
EJEMPLOS DE BUENAS RESPUESTAS
═══════════════════════════════════════════════

EJEMPLO 1 - Cliente elige producto:
Usuario: "me llevo el peral conferencia"
Tú: "¡Buena elección! El Peral Conferencia es muy productivo y resistente. 
¿Lo vas a plantar en tierra o en maceta? Si es maceta, necesitarás una de al menos 40-50L para que desarrolle bien las raíces.
También te recomiendo un sustrato para frutales y, si quieres asegurar una buena cosecha, un abono específico para perales. ¿Te busco opciones?"

EJEMPLO 2 - Mencionar tienda física:
Usuario: "tienes manzanos?"
Tú: "En la web ahora mismo tenemos el Manzano Golden a €15.90 (3 unidades).
En nuestra tienda física en Totana hay más variedades: Fuji, Reineta, Granny Smith... Si puedes acercarte, tienes más donde elegir.
¿Cuál te interesa más?"

EJEMPLO 3 - Mantener contexto:
Usuario: "quiero algo resistente al frío"
Tú: [busca plantas resistentes al frío]
Usuario: "vale, ¿y frutales?"
Tú: "Para frutales resistentes al frío te van perfecto los perales, manzanos y cerezos. Son de los que mejor aguantan temperaturas bajas. ¿Tienes preferencia por alguno?"

═══════════════════════════════════════════════

NUNCA:
- Respondas siempre con el mismo formato de lista
- Ignores lo que el cliente dijo antes
- Olvides mencionar la tienda física
- Dejes ir al cliente sin ofrecer complementarios
- Seas robótico o repetitivo

RECUERDA: Eres un vendedor que quiere ayudar al cliente a tener éxito en sus plantas, no un catálogo.

Información del catálogo (base vectorial, usa solo esto para productos):
{{ CATALOGO }}`;

async function getEmbedding(query) {
  if (!openai) return null;
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query,
    dimensions: 512
  });
  return res.data[0].embedding;
}

async function retrieveFromVector(query) {
  const hasWeb = !!pineconeIndexWeb;
  const hasTienda = !!pineconeIndexTienda;
  const hasSingle = !!pineconeIndex;
  if ((!hasWeb && !hasTienda && !hasSingle) || !openai) return '';
  try {
    const vector = await getEmbedding(query);
    if (!vector) return '';
    const opts = { vector, topK: 12, includeMetadata: true };
    let fromWeb = [];
    let fromTienda = [];
    let fromSingle = [];
    if (hasWeb) {
      const r = await pineconeIndexWeb.query(opts).catch(() => ({ matches: [] }));
      fromWeb = (r.matches || []).map(m => m.metadata && { ...m.metadata, _source: 'web' }).filter(Boolean);
    }
    if (hasTienda) {
      const r = await pineconeIndexTienda.query(opts).catch(() => ({ matches: [] }));
      fromTienda = (r.matches || []).map(m => m.metadata && { ...m.metadata, _source: 'tienda' }).filter(Boolean);
    }
    if (hasSingle) {
      const r = await pineconeIndex.query(opts).catch(() => ({ matches: [] }));
      fromSingle = (r.matches || []).map(m => m.metadata).filter(Boolean);
    }
    const products = fromWeb.length || fromTienda.length ? [...fromWeb, ...fromTienda] : fromSingle;
    const lines = products.slice(0, 10).map(formatProduct);
    console.log(`  📎 Vector: ${products.length} artículos`);
    return lines.length ? lines.join('\n') : '';
  } catch (e) {
    console.error('❌ retrieveFromVector', e.message);
    return '';
  }
}

function formatProduct(p) {
  if (p._source === 'web' || (p.enlace != null && p.denominacion != null)) {
    const nombre = p.denominacion || 'N/A';
    const precio = p.precio_final != null ? String(p.precio_final) : '—';
    const ref = p.referencia || '—';
    const stock = p.stock != null ? String(p.stock) : '—';
    const enlace = p.enlace || '';
    const desc = (p.descripciones && String(p.descripciones).trim()) ? String(p.descripciones).substring(0, 180) : '';
    let info = `${nombre} | ${precio} | Ref: ${ref} | Stock: ${stock}`;
    if (enlace) info += ` | Enlace: ${enlace}`;
    if (desc) info += ` | ${desc}`;
    return info;
  }
  if (p._source === 'tienda' || (p.codigo_referencia != null && p.denominacion != null && p.enlace == null)) {
    const nombre = p.denominacion || 'N/A';
    const precio = p.precio != null ? `${Number(p.precio).toFixed(2)} €` : '—';
    const ref = p.codigo_referencia || '—';
    const stock = p.stock != null ? String(p.stock) : '—';
    return `[Tienda] ${nombre} | ${precio} | Ref: ${ref} | Stock: ${stock}`;
  }
  const nombre = p.descripcion_bandeja || p.denominacion_web || p.denominacion_familia || 'N/A';
  const precio = p.precio_de_venta_bandeja ?? p.precio_web ?? p.precio_fisico ?? 0;
  const stockWeb = p.stock_web ?? 0;
  const stockFisico = p.stock_fisico ?? 0;
  const dispo = stockWeb > 0 ? `${stockWeb} en WEB` : `${stockFisico} en TIENDA FÍSICA`;
  let info = `${nombre} | Cód: ${p.codigo_referencia || 'N/A'} | €${Number(precio).toFixed(2)} | ${dispo}`;
  if (p.descripcion_de_cada_articulo && String(p.descripcion_de_cada_articulo) !== 'N/A') {
    info += ` | ${String(p.descripcion_de_cada_articulo).substring(0, 120)}`;
  }
  return info;
}

async function searchProducts(query, webOnly = false) {
  const hasWeb = !!pineconeIndexWeb;
  const hasTienda = !!pineconeIndexTienda;
  const hasSingle = !!pineconeIndex;
  if ((!hasWeb && !hasTienda && !hasSingle) || !openai) return [];
  try {
    console.log(`  🔍 "${query}"${webOnly ? ' (web)' : ''}`);
    const vector = await getEmbedding(query);
    if (!vector) return [];
    const opts = { vector, topK: 15, includeMetadata: true };
    let fromWeb = [], fromTienda = [], fromSingle = [];
    if (hasWeb) {
      const r = await pineconeIndexWeb.query(opts).catch(() => ({ matches: [] }));
      fromWeb = (r.matches || []).map(m => m.metadata && { ...m.metadata, _source: 'web' }).filter(Boolean);
    }
    if (hasTienda && !webOnly) {
      const r = await pineconeIndexTienda.query(opts).catch(() => ({ matches: [] }));
      fromTienda = (r.matches || []).map(m => m.metadata && { ...m.metadata, _source: 'tienda' }).filter(Boolean);
    }
    if (hasSingle) {
      const r = await pineconeIndex.query(opts).catch(() => ({ matches: [] }));
      fromSingle = (r.matches || []).map(m => m.metadata).filter(Boolean);
    }
    const products = fromWeb.length || fromTienda.length ? [...fromWeb, ...fromTienda] : fromSingle;
    console.log(`     → ${fromWeb.length} web, ${fromTienda.length} tienda`);
    return products;
  } catch (e) {
    console.error('❌ searchProducts', e.message);
    return [];
  }
}

const tools = [
  {
    type: 'function',
    function: {
      name: 'buscar_productos',
      description: 'Busca productos en el catálogo. PUEDES llamar varias veces con distintos términos. Busca la planta principal y también complementarios (macetas, sustratos, abonos, insecticidas).',
      parameters: {
        type: 'object',
        properties: {
          termino: { type: 'string', description: 'Término de búsqueda: nombre de planta, categoría, o producto complementario' },
          solo_web: { type: 'boolean', description: 'True = solo productos disponibles en web', default: false }
        },
        required: ['termino']
      }
    }
  }
];

const conversations = new Map();

function getConversation(senderId) {
  if (!conversations.has(senderId)) {
    conversations.set(senderId, { messages: [], createdAt: Date.now() });
  }
  return conversations.get(senderId);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, conv] of conversations.entries()) {
    if (now - conv.createdAt > 3600000) conversations.delete(id);
  }
}, 300000);

async function enviarMensaje(recipientId, texto) {
  const chunks = [];
  for (let i = 0; i < texto.length; i += MAX_MESSAGE_LENGTH) {
    chunks.push(texto.slice(i, i + MAX_MESSAGE_LENGTH));
  }
  if (chunks.length === 0) chunks.push('¿En qué más puedo ayudarte?');
  for (const chunk of chunks) {
    try {
      const url = `${INSTAGRAM_GRAPH}/me/messages`;
      const payload = { recipient: { id: recipientId }, message: { text: chunk } };
      await axios.post(url, payload, {
        params: { access_token: ACCESS_TOKEN },
        headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' }
      });
      if (chunks.length > 1) await new Promise(r => setTimeout(r, 500));
    } catch (error) {
      console.error('Error enviarMensaje:', error.response?.data || error.message);
    }
  }
}

async function procesarConIA(senderId, texto) {
  if (!openai) {
    await enviarMensaje(senderId, 'Lo siento, el asistente no está configurado (falta OPENAI_API_KEY).');
    return;
  }
  const conv = getConversation(senderId);
  conv.messages.push({ role: 'user', content: texto });
  const recent = conv.messages.slice(-15);

  const catalogContent = await retrieveFromVector(texto);
  const systemContent = SYSTEM_PROMPT.replace('{{ CATALOGO }}', catalogContent || '(Sin resultados en catálogo para esta consulta.)');

  let response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'system', content: systemContent }, ...recent],
    tools,
    tool_choice: 'auto',
    max_tokens: 800,
    temperature: 0.75
  });

  let assistantMessage = response.choices[0].message;
  let searchCount = 0;

  while (assistantMessage.tool_calls && searchCount < 6) {
    const toolResults = [];
    for (const call of assistantMessage.tool_calls) {
      if (call.function.name === 'buscar_productos') {
        const args = JSON.parse(call.function.arguments || '{}');
        const products = await searchProducts(args.termino || '', args.solo_web || false);
        const formatted = products.length > 0
          ? products.slice(0, 8).map(formatProduct).join('\n')
          : 'No encontrado. Intenta con otro término.';
        toolResults.push({ tool_call_id: call.id, role: 'tool', content: formatted });
        searchCount++;
      }
    }
    response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemContent },
        ...conv.messages.slice(-12),
        assistantMessage,
        ...toolResults
      ],
      tools,
      tool_choice: 'auto',
      max_tokens: 800,
      temperature: 0.75
    });
    assistantMessage = response.choices[0].message;
  }

  const reply = assistantMessage.content || 'No pude procesar tu consulta. ¿Puedes reformularla?';
  conv.messages.push({ role: 'assistant', content: reply });
  console.log(`💬 Respuesta lista (${searchCount} búsquedas)`);
  await enviarMensaje(senderId, reply);
}

// --- Rutas ---

app.get('/', (req, res) => res.send('Bot funcionando!'));

app.get('/privacy', (req, res) => {
  res.send(`
    <html><body>
      <h1>Política de Privacidad</h1>
      <p>Esta aplicación no recopila ni almacena datos personales de los usuarios.</p>
      <p>Los mensajes se procesan para responder automáticamente y no se guardan en base de datos.</p>
      <p>Contacto: facuthekidd@gmail.com</p>
    </body></html>
  `);
});

app.get('/test-token', async (req, res) => {
  try {
    const response = await axios.get(`${INSTAGRAM_GRAPH}/me`, {
      params: { access_token: ACCESS_TOKEN },
      headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
    });
    res.json({ ok: true, data: response.data });
  } catch (error) {
    res.json({ error: error.response?.data });
  }
});

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verificado!');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', (req, res) => {
  res.sendStatus(200);
  const body = req.body;
  if (body.object !== 'instagram') return;

  for (const entry of body.entry || []) {
    const messaging = entry.messaging || [];
    for (const event of messaging) {
      if (event.message && !event.message.is_echo) {
        const senderId = event.sender.id;
        const texto = (event.message.text || '').trim();
        if (!texto) continue;
        console.log('Mensaje de:', senderId, ':', texto);
        (async () => {
          await new Promise(r => setTimeout(r, DELAY_MS));
          await procesarConIA(senderId, texto);
        })();
      }
    }
    for (const change of entry.changes || []) {
      if (change.field === 'messages') {
        const senderId = change.value?.sender?.id;
        const texto = (change.value?.message?.text || '').trim();
        if (senderId && texto) {
          console.log('Mensaje de:', senderId, ':', texto);
          (async () => {
            await new Promise(r => setTimeout(r, DELAY_MS));
            await procesarConIA(senderId, texto);
          })();
        }
      }
    }
  }
});

app.listen(PORT, () => {
  console.log('Servidor en puerto', PORT);
  console.log('OpenAI:', openai ? 'ok' : 'no (OPENAI_API_KEY)');
  console.log('Pinecone web:', pineconeIndexWeb ? 'ok' : (pineconeIndex ? 'ok (INDEX)' : 'no'));
  console.log('Pinecone tienda:', pineconeIndexTienda ? 'ok' : 'no');
  console.log('Retraso respuesta:', DELAY_MS / 1000, 's');
});