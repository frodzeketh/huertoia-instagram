const express = require('express');
const axios = require('axios');
require('dotenv').config();
const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const ACCESS_TOKEN = "IGAANQX1DjWRlBZAFppVUQybUlOSW9sVEYwMW5NQ09qTm14WTR1UWltN0luS3A2YXFiX2JMbkR1eURrSGcyV1dPMlBlekFkdlZAOYWcxWmJzc3k2Njk3RUlnd3NoM3paSndONERwYW80NTZAwdDhPUWoxakg4ZAW5yZAVhBUk9yRS0tZAwZDZD";
const PORT = process.env.PORT || 3000;

async function enviarMensaje(recipientId, texto) {
  try {
    await axios.post(
      `https://graph.facebook.com/v25.0/me/messages`,
      {
        recipient: { id: recipientId },
        message: { text: texto }
      },
      {
        params: { access_token: ACCESS_TOKEN }
      }
    );
    console.log('Mensaje enviado a:', recipientId);
  } catch (error) {
    console.error('Error enviando mensaje:', error.response?.data);
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