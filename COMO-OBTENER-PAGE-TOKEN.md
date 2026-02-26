# Cómo obtener el Page Access Token (EAA...) para el bot de Instagram

Para que el bot pueda **enviar** mensajes, necesitas un **Page Access Token**, no el token de Instagram (IGA...).

## URL exacta – Graph API Explorer

Abre en el navegador:

**https://developers.facebook.com/tools/explorer**

---

## Pasos en Graph API Explorer

### 1. Seleccionar tu app
- Arriba a la derecha, en **Meta App**, elige la app donde tienes configurado **Instagram Messaging** (la misma del webhook).

### 2. Permisos del User Token
- Donde dice **User or Page**, deja **User Token**.
- Haz clic en **Add a permission** (o **Permissions**).
- Añade y marca:
  - `pages_show_list`
  - `instagram_manage_messages`
  - Si no ves `instagram_manage_messages`, busca también: `pages_messaging` o **Instagram** en la lista y activa lo relacionado con mensajes.

### 3. Generar el token de usuario
- Clic en **Generate Access Token**.
- Inicia sesión si te lo pide y **acepta los permisos** para la app y para la Página de Facebook vinculada a tu Instagram.

### 4. Obtener el token de la Página
Tienes dos formas:

**Opción A – Desplegable (si aparece)**  
- En el mismo Graph API Explorer, donde dice **User or Page**, abre el desplegable.  
- Si aparece el nombre de tu **Página de Facebook** (la vinculada a Instagram), selecciónala.  
- El token que se muestra arriba pasará a ser el **Page Access Token** (empieza por `EAA...`). **Cópialo** y úsalo como `ACCESS_TOKEN` en tu `.env` y en Railway.

**Opción B – Llamada a la API**  
- En el campo de petición (donde pone algo como `me?fields=id,name`), cambia la URL a:  
  **`me/accounts`**  
- Método: **GET**.  
- Clic en **Submit**.  
- En la respuesta verás una lista `data` con tus páginas. Cada elemento tiene `access_token` y `name`.  
- Copia el `access_token` de la **Página que está vinculada a tu cuenta de Instagram**. Ese es tu Page Access Token (EAA...).

### 5. Usar el token en tu proyecto
- En **Railway**: Variables → `ACCESS_TOKEN` = pegar el token (sin comillas).
- En **local**: en `.env`, línea `ACCESS_TOKEN=` y pegar el token.
- Reinicia el servidor o haz deploy.

---

## Si tu app está en otra parte de Meta

- **Dashboard de la app**:  
  **https://developers.facebook.com/apps/**  
  → Entra a tu app → **Instagram** o **Messenger** → según el producto, suele haber un enlace tipo “Generar token” o “Token de la página”. Ahí puedes generar/copiar el Page Access Token si la Página ya está vinculada.

---

## Resumen de URLs

| Qué | URL |
|-----|-----|
| Graph API Explorer (generar/copiar token) | https://developers.facebook.com/tools/explorer |
| Lista de tus apps | https://developers.facebook.com/apps/ |

El token que debes usar es el que **empieza por `EAA...`** (Page Access Token), no el que empieza por `IGA...`.
