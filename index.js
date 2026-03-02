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
if (process.env.PINECONE_API_KEY) {
  try {
    const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    const indexWeb = (process.env.PINECONE_INDEX_WEB || process.env.PINECONE_INDEX || '').trim();
    const indexTienda = (process.env.PINECONE_INDEX_TIENDA || '').trim();
    if (indexWeb) pineconeIndexWeb = pinecone.Index(indexWeb);
    if (indexTienda) pineconeIndexTienda = pinecone.Index(indexTienda);
  } catch (e) {
    console.warn('Pinecone no inicializado:', e.message);
  }
}

const SYSTEM_PROMPT = `Eres el asistente comercial de PlantasdeHuerto.com, el vivero El Huerto Deitana en Totana (Murcia). Teléfono 968 422 335, info@plantasdehuerto.com.

Tienes acceso a buscar productos con la herramienta buscar_productos. Los resultados te llegan ya filtrados: primero aparecen los de la web (con enlace, denominación, descripciones y precio) y después los de tienda física (denominación, referencia, precio, stock). Da prioridad a lo que esté en web y usa el enlace y la descripción para explicar bien; si hay opciones en tienda, coméntalo con naturalidad. Cuando el cliente se decida por algo, sugiere complementos (maceta o tierra, sustrato, abono) sin que tenga que pedirlo. Habla como una persona: cercano, sin abusar de listas ni de un mismo esquema en cada mensaje, y aprovecha lo que el cliente haya dicho antes para personalizar.`;

async function searchProducts(query, webOnly = false) {
  if ((!pineconeIndexWeb && !pineconeIndexTienda) || !openai) return [];
  try {
    console.log(`  🔍 "${query}"${webOnly ? ' (solo web)' : ''}`);
    const embedding = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
      dimensions: 512
    });
    const vector = embedding.data[0].embedding;
    const topK = 10;
    const queryOpts = { vector, topK, includeMetadata: true };

    const [webResults, tiendaResults] = await Promise.all([
      pineconeIndexWeb
        ? pineconeIndexWeb.query(queryOpts).catch(() => ({ matches: [] }))
        : Promise.resolve({ matches: [] }),
      pineconeIndexTienda && !webOnly
        ? pineconeIndexTienda.query(queryOpts).catch(() => ({ matches: [] }))
        : Promise.resolve({ matches: [] })
    ]);

    const fromWeb = (webResults.matches || [])
      .map(m => m.metadata && { ...m.metadata, _source: 'web' })
      .filter(Boolean);
    const fromTienda = (tiendaResults.matches || [])
      .map(m => m.metadata && { ...m.metadata, _source: 'tienda' })
      .filter(Boolean);

    const products = [...fromWeb, ...fromTienda];
    console.log(`     → ${fromWeb.length} web, ${fromTienda.length} tienda`);
    return products;
  } catch (e) {
    console.error('❌ searchProducts', e.message);
    return [];
  }
}

function formatProduct(p) {
  const source = p._source || 'web';
  if (source === 'web') {
    const nombre = p.denominacion || 'N/A';
    const precio = p.precio_final || '—';
    const ref = p.referencia || '—';
    const stock = p.stock != null ? p.stock : '—';
    const enlace = p.enlace || '';
    const desc = (p.descripciones && String(p.descripciones).trim()) ? String(p.descripciones).substring(0, 200) : '';
    let info = `[WEB] ${nombre} | ${precio} | Ref: ${ref} | Stock: ${stock}`;
    if (enlace) info += ` | Enlace: ${enlace}`;
    if (desc) info += ` | Descripción: ${desc}`;
    return info;
  }
  const nombre = p.denominacion || 'N/A';
  const precio = p.precio != null ? `${Number(p.precio).toFixed(2)} €` : '—';
  const ref = p.codigo_referencia || '—';
  const stock = p.stock != null ? p.stock : '—';
  return `[TIENDA FÍSICA] ${nombre} | ${precio} | Ref: ${ref} | Stock: ${stock}`;
}

const tools = [
  {
    type: 'function',
    function: {
      name: 'buscar_productos',
      description: 'Busca artículos en el catálogo. Puedes usarla varias veces con distintos términos si lo necesitas.',
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

  let response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...recent],
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
        { role: 'system', content: SYSTEM_PROMPT },
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
  console.log('Pinecone web:', pineconeIndexWeb ? 'ok' : 'no');
  console.log('Pinecone tienda:', pineconeIndexTienda ? 'ok' : 'no');
  console.log('Retraso respuesta:', DELAY_MS / 1000, 's');
});
