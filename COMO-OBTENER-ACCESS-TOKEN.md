# Cómo obtener el ACCESS_TOKEN para Instagram Messaging

Hay **dos tipos** de token que puedes usar; el prefijo indica el origen:

| Prefijo | Tipo | Origen |
|--------|------|--------|
| **EAA** | Token de **Facebook / Página** | Graph API Explorer, Facebook Login, `GET /me/accounts` → Page token |
| **IGAA** | Token de **Instagram** (Instagram User Access Token) | OAuth con **Instagram** (Business Login for Instagram o api.instagram.com) |

---

## Si te sale EAA (Graph API Explorer / Facebook)

Ese es el flujo que usa **Facebook** como login:

1. **Meta for Developers** → tu App → **Graph API Explorer**.
2. Permisos: `instagram_basic`, `instagram_manage_messages`, `pages_manage_metadata`.
3. **Generar token de acceso** → autorizas con la cuenta de la **Página** vinculada a Instagram.
4. Ese token es **User** (EAA). Para el token de la **Página**:
   - `GET /me/accounts` → anota el **id** de la Página conectada a Instagram.
   - `GET /{page-id}?fields=access_token` → el **access_token** de esa respuesta es un token **EAA** (Page token).

**Ese token EAA sirve** para la API de mensajes de Instagram (Messenger Platform for Instagram) cuando la cuenta está vinculada a una Página. Puedes ponerlo en `.env` como `ACCESS_TOKEN=EAA...`.

---

## Cómo se obtiene el IGAA (token que empieza por IGAA)

El **IGAA** no sale del Graph API Explorer. Sale del flujo en el que el usuario inicia sesión con **Instagram** (Instagram OAuth / Business Login for Instagram).

### Opción A: App Dashboard (sin programar flujo OAuth)

1. **Meta for Developers** → tu App.
2. Menú **Instagram** → **API setup with Instagram business login** (o equivalente en tu app).
3. Inicia sesión con la **cuenta de Instagram** profesional.
4. Pulsa **Generate token** junto a la cuenta que quieras usar.
5. El token que genera el dashboard suele ser de **larga duración** y puede tener prefijo **IGAA** (según configuración de Meta).

### Opción B: Flujo OAuth con Instagram (para obtener IGAA por código)

1. **Rediriges** al usuario a:
   ```
   https://api.instagram.com/oauth/authorize
     ?client_id=TU_APP_ID
     &redirect_uri=TU_REDIRECT_URI
     &scope=instagram_basic,instagram_manage_messages
     &response_type=code
   ```
2. El usuario autoriza; Instagram redirige a tu `redirect_uri` con un **code**.
3. **Intercambias** el code por un token (short-lived):
   ```
   POST https://api.instagram.com/oauth/access_token
   Body (form): client_id, client_secret, grant_type=authorization_code, redirect_uri, code
   ```
   O bien usas el endpoint de Graph:
   ```
   GET https://graph.instagram.com/access_token
     ?grant_type=ig_exchange_token
     &client_secret=TU_APP_SECRET
     &access_token=TU_TOKEN_CORTO_DE_INSTAGRAM
   ```
4. El token que devuelve **graph.instagram.com** (o el que obtienes del paso 3) es el que tiene prefijo **IGAA** y es un **Instagram User Access Token**.

### Refrescar un token IGAA (60 días)

Cuando ya tienes un IGAA de larga duración y quieres renovarlo (al menos 24 h antes de que caduque):

```
GET https://graph.instagram.com/refresh_access_token
  ?grant_type=ig_refresh_token
  &access_token=TU_TOKEN_IGAA_ACTUAL
```

---

## Resumen

- **EAA** → Graph API Explorer, Facebook Login, token de Página. **No** es IGAA.
- **IGAA** → Flujo con login por **Instagram** (Dashboard “Generate token” o OAuth api.instagram.com / Business Login for Instagram) y, si hace falta, intercambio/refresco en **graph.instagram.com**.

Para tu `.env`: tanto `ACCESS_TOKEN=EAA...` como `ACCESS_TOKEN=IGAA...` pueden funcionar según cómo tengas configurada la app y la cuenta. Si tu bot ya usaba un token IGAA, ese se obtuvo por el flujo de **Instagram** (Dashboard o OAuth), no por el Explorer.
