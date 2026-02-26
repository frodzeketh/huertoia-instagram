const express = require('express');
const axios = require('axios');
require('dotenv').config();
const app = express();
app.use(express.json());

const VERIFY_TOKEN = (process.env.VERIFY_TOKEN || '').trim();
const ACCESS_TOKEN = (process.env.ACCESS_TOKEN || '').trim();
const PORT = process.env.PORT || 3000;

// IMPORTANTE: Para enviar mensajes por Instagram Messaging hace falta el PAGE ACCESS TOKEN
// (empieza con EAA...), NO el token de Instagram (IGA...). Obtenerlo en Graph API Explorer
// seleccionando la Página vinculada a Instagram, o en la app de Meta con permiso instagram_manage_messages.
const ES_PAGE_TOKEN = ACCESS_TOKEN.startsWith('EAA');

console.log('TOKEN LENGTH:', ACCESS_TOKEN ? ACCESS_TOKEN.length : 'undefined');
console.log('TOKEN COMPLETO:', ACCESS_TOKEN);
console.log('Tipo token:', ES_PAGE_TOKEN ? 'Page (EAA) - OK para enviar mensajes' : 'No es Page token (IGA/u otro) - puede fallar al enviar');

// ID de la cuenta de Instagram (igual que en el webhook entry[].id)
const INSTAGRAM_ACCOUNT_ID = '17841447765537828';

async function enviarMensaje(recipientId, texto) {
  try {
    // Instagram Messaging exige siempre este ID en la URL (no sirve "me").
    const url = `https://graph.facebook.com/v25.0/${INSTAGRAM_ACCOUNT_ID}/messages`;
    const payload = {
      recipient: { id: recipientId },
      message: { text: texto }
    };
    console.log('Token usado:', ACCESS_TOKEN.substring(0, 30) + '...');
    console.log('Payload:', JSON.stringify(payload));
    
    const response = await axios.post(url, payload, {
      params: { access_token: ACCESS_TOKEN },
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('Respuesta exitosa:', response.data);
  } catch (error) {
    console.error('Error completo:', JSON.stringify(error.response?.data));
  }
}

app.get('/', (req, res) => {
  res.send('Bot funcionando!');
});

app.get('/privacy', (req, res) => {
  res.send(`
    <html>
      <body>
        <h1>Política de Privacidad</h1>
        <p>Esta aplicación no recopila ni almacena datos personales de los usuarios.</p>
        <p>Los mensajes procesados son utilizados únicamente para responder automáticamente y no son guardados en ninguna base de datos.</p>
        <p>Para consultas contactar a: facuthekidd@gmail.com</p>
      </body>
    </html>
  `);
});

app.get('/test-token', async (req, res) => {
  try {
    const response = await axios.get(
      `https://graph.facebook.com/v25.0/17841447765537828`,
      {
        params: { access_token: ACCESS_TOKEN },
        headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
      }
    );
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

app.post('/webhook', async (req, res) => {
  const body = req.body;
  console.log('POST recibido:', JSON.stringify(body, null, 2));

  if (body.object === 'instagram') {
    for (const entry of body.entry) {
      const messaging = entry.messaging || [];
      for (const event of messaging) {
        if (event.message && !event.message.is_echo) {
          const senderId = event.sender.id;
          const texto = event.message.text;
          console.log('Mensaje de:', senderId, ':', texto);
          await enviarMensaje(senderId, `Hola! Recibí tu mensaje: "${texto}"`);
        }
      }

      const changes = entry.changes || [];
      for (const change of changes) {
        if (change.field === 'messages') {
          const senderId = change.value?.sender?.id;
          const texto = change.value?.message?.text;
          if (senderId && texto) {
            console.log('Mensaje de:', senderId, ':', texto);
            await enviarMensaje(senderId, `Hola! Recibí tu mensaje: "${texto}"`);
          }
        }
      }
    }
  }

  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});