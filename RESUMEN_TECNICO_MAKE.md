# Resumen técnico y guía Make.com – Sistema de Incidencias

Documento para alinear objetivos de la app, funciones y pasos para que la integración con Make.com sea funcional.

---

## 1. Objetivos de la aplicación

| Objetivo | Descripción |
|----------|-------------|
| **Gestión de incidencias en tiempo real** | Los técnicos ven sus incidencias asignadas y responden (aceptar / rechazar / pedir ayuda) con motivos y respeto al SLA. |
| **Control supervisorial** | Los supervisores ven todas las incidencias activas, respuestas de técnicos, asignan manualmente, gestionan ayudas y controlan escalados (pausar/reactivar). |
| **Integración Make.com + Notion** | Make.com orquesta la lógica (validación PIN, listados, asignaciones, respuestas); Notion actúa como base de datos. El dashboard solo habla con los webhooks de Make. |
| **Trazabilidad y auditoría** | Registro de IP, User-Agent y timestamp en todas las acciones; logs de solicitudes/respuestas en formato estándar. |

---

## 2. Objetivos por pantalla y flujo

### 2.1 Landing (`index.html`)
- Punto de entrada con enlaces a **Técnico** y **Supervisor**.
- Mensaje de integración con Make.com + Notion.

### 2.2 Dashboard Técnico (`/tecnico`, `tecnico.html`)
- **Acceso**: URL con parámetros opcionales `?id=...&tecnico=email&nivel=...` (p. ej. desde correos).
- **Login**: email + PIN; validación vía `validate_pin` (webhook técnico o Make).
- **Carga de incidencias**: `get_assigned_incidents` → el backend reenvía a Make y espera `{ incidents: [...] }` o equivalente.
- **Acciones por incidencia**: Acepto / Rechazo / Ayuda (y otras: resolver, materiales, derivar, notas, etc.) enviando `action`, `incident_id`, `technician_email`, `pin`, `level`, y campos extra según acción.
- **Objetivo**: Que el técnico pueda ver solo sus incidencias, responder con motivos y que todo quede registrado en Make/Notion.

### 2.3 Panel Supervisor (`/supervisor`, `supervisor.html`)
- **Login**: email + PIN; validación con `/api/validate-pin` (puede usar `MAKE_WEBHOOK_VALIDATE_PIN` o modo desarrollo PIN `1234`).
- **Listado**: `get_incidents` → backend reenvía a Make y espera `{ status: 'success', incidents: [...] }`.
- **Acciones**: asignación manual (`assign_manual`), resolver ayuda (`resolve_help`), pausar/reactivar escalado (`pause_escalation`), resolver directamente (`resolve_directly`).
- **Objetivo**: Visión global de incidencias y control de asignaciones y escalados.

---

## 3. Resumen técnico por función (backend)

### 3.1 `api/webhook-respuesta.js` (acciones técnico)

| Aspecto | Detalle |
|---------|--------|
| **Objetivo** | Recibir todas las acciones del técnico (validate_pin, get_assigned_incidents, acepto, rechazo, ayuda, resolver, materiales, etc.) y reenviarlas a Make; devolver al front la respuesta de Make. |
| **Variable de entorno** | `MAKE_WEBHOOK_RESPUESTA` (obligatoria; si no es URL válida `https://hook.eu*.make.com/...` devuelve 500). |
| **Body** | Lee JSON con helper `readJSONBody` (compatible con body ya parseado o raw). |
| **Payload a Make** | Siempre: `timestamp`, `action`, `incident_id`, `technician_email`, `technician_name`, `level`, `user_agent`, `ip_address`. Según acción: `pin`, `reason`, `help_type`, `help_description`, `solution_description`, `materiales_resultado`, etc. |
| **Respuesta esperada de Make** | Para `get_assigned_incidents`: JSON con `incidents` (array) en raíz, en `data.incidents` o array directo. Para otras acciones: JSON con `status`/datos o texto "Accepted"/"OK". |
| **Modo demo** | Con `ALLOW_DEMO_INCIDENTS=1`, si la acción es `get_assigned_incidents` puede devolver incidencias de ejemplo sin llamar a Make (o tras fallo). |

### 3.2 `api/webhook-supervisor.js` (acciones supervisor)

| Aspecto | Detalle |
|---------|--------|
| **Objetivo** | Recibir acciones del supervisor (get_incidents, assign_manual, resolve_help, pause_escalation, resolve_directly) y reenviarlas a Make. |
| **Variable de entorno** | `MAKE_WEBHOOK_SUPERVISOR`. Si no está definida, responde éxito simulado sin llamar a Make. |
| **Body** | Lee `req.body` directamente (riesgo: en algunos entornos el body puede no llegar parseado). |
| **Payload a Make** | `timestamp`, `action`, `supervisor_email`, `department`, `supervisor_name`, `incident_id`, `escalation_paused`, `technician_email`, `solution`, `help_action`, `additional_data`, `user_agent`, `ip_address`. |
| **Respuesta esperada de Make** | Para `get_incidents`: `{ status: 'success', incidents: [...] }`. Para otras: JSON o texto "Accepted"/"OK". |

### 3.3 `api/validate-pin.js` (PIN supervisor)

| Aspecto | Detalle |
|---------|--------|
| **Objetivo** | Validar PIN del supervisor; si hay webhook de Make, delegar en Make; si no, simular (PIN `1234` válido). |
| **Variable de entorno** | `MAKE_WEBHOOK_VALIDATE_PIN`. Opcional. |
| **Body** | Lee `req.body` directamente (mismo riesgo que webhook-supervisor). |
| **Payload a Make** | `timestamp`, `action`, `supervisor_email`, `pin`, `user_agent`, `ip_address`. |
| **Respuesta esperada de Make** | JSON: `{ status: 'success', supervisor: { name, email, department } }` o `{ status: 'error', message: '...' }`. |

---

## 4. Contratos que Make.com debe cumplir

### 4.1 Webhook de respuestas (técnico)

- **URL en Make**: la misma que configuras en `MAKE_WEBHOOK_RESPUESTA`.
- **Método**: POST, body JSON.
- **Campos entrantes** (los que envía el dashboard): `action`, `timestamp`, `incident_id`, `technician_email`, `technician_name`, `level`, `user_agent`, `ip_address`, y según acción: `pin`, `reason`, `help_type`, `help_description`, etc.
- **Para `action === 'get_assigned_incidents'`**:
  - Make debe devolver **JSON** con lista de incidencias en uno de estos formatos:
    - `{ "incidents": [ ... ] }`
    - `{ "data": { "incidents": [ ... ] } }`
    - `[ { ... }, { ... } ]` (array directo)
  - Cada incidencia puede llevar: `id`, `status`, `priority`, `equipment`, `zone`, `description`, `report_date`, `escalation_level`, `l0_technician`, `l1_technician`, `l2_technicians`, `sla_*`, `solicitudes_log`, `respuestas_log`, `materials`, `notes`, etc.
- **Para el resto de acciones**: Make puede devolver JSON con `status: 'success'` o texto `Accepted`/`OK`.

### 4.2 Webhook supervisor

- **URL en Make**: la de `MAKE_WEBHOOK_SUPERVISOR`.
- **Campos entrantes**: `action`, `timestamp`, `supervisor_email`, `department`, `supervisor_name`, `incident_id`, `technician_email`, `solution`, `help_action`, `escalation_paused`, etc.
- **Para `action === 'get_incidents'`**: Make debe devolver `{ "status": "success", "incidents": [ ... ] }` con el mismo tipo de objetos incidencia que use el panel supervisor (id, status, assigned_technician, escalation_level, l0_*, l1_*, l2_*, etc.).
- **Para otras acciones**: JSON o "Accepted"/"OK".

### 4.3 Webhook validación PIN (opcional)

- **URL en Make**: `MAKE_WEBHOOK_VALIDATE_PIN`.
- **Campos entrantes**: `action`, `timestamp`, `supervisor_email`, `pin`, `user_agent`, `ip_address`.
- **Respuesta**: `{ "status": "success", "supervisor": { "name", "email", "department" } }` o `{ "status": "error", "message": "..." }`. Debe ser **JSON válido**; si Make devuelve texto plano, el backend devuelve 500.

---

## 5. Pasos para que Make.com funcione correctamente

### 5.1 Variables de entorno (Vercel)

```bash
MAKE_WEBHOOK_RESPUESTA=https://hook.eu2.make.com/xxxxxxxxxx
MAKE_WEBHOOK_SUPERVISOR=https://hook.eu2.make.com/yyyyyyyyyy
MAKE_WEBHOOK_VALIDATE_PIN=https://hook.eu2.make.com/zzzzzzzzzz   # opcional
ALLOW_DEMO_INCIDENTS=1   # opcional; para pruebas sin Make en get_assigned_incidents
```

- Sin `MAKE_WEBHOOK_RESPUESTA` válida, el dashboard técnico falla en todas las acciones.
- Sin `MAKE_WEBHOOK_SUPERVISOR`, el panel supervisor simula éxito pero no llama a Make.
- Sin `MAKE_WEBHOOK_VALIDATE_PIN`, se usa PIN de desarrollo `1234`.

### 5.2 En Make.com: escenarios y respuestas

1. **Módulo Webhook (Custom webhook)**  
   - Método POST.  
   - Sin autenticación (o la que uses después).  
   - La URL que te da Make es la que debes poner en Vercel.

2. **Para “Respuestas técnico”**  
   - Router por `action`.  
   - Rama `get_assigned_incidents`: leer Notion (o tu BD), filtrar por `technician_email` / nivel, y **Responder al webhook** con JSON: `{ "incidents": [ ... ] }`.  
   - Otras ramas: actualizar Notion y **Responder al webhook** con `{ "status": "success" }` o "Accepted".

3. **Para “Supervisor”**  
   - Router por `action`.  
   - Rama `get_incidents`: leer incidencias activas y **Responder al webhook** con `{ "status": "success", "incidents": [ ... ] }`.  
   - Ramas `assign_manual`, `resolve_help`, `pause_escalation`, `resolve_directly`: actualizar datos y responder con JSON o "Accepted".

4. **Para “Validate PIN”**  
   - Comprobar PIN (Notion/BD o lista fija) y **Responder al webhook** con JSON de éxito o error. No devolver texto plano.

### 5.3 Errores frecuentes y comprobaciones

| Síntoma | Comprobación |
|--------|----------------|
| “MAKE_WEBHOOK_RESPUESTA inválida” | URL en Vercel con formato `https://hook.euX.make.com/...` y sin espacios. |
| Técnico no ve incidencias | Make debe devolver JSON con `incidents` (array); revisar “Responder al webhook” en la rama `get_assigned_incidents`. |
| Supervisor no ve incidencias | Make debe devolver `{ status: 'success', incidents: [...] }` en `get_incidents`. |
| “Invalid JSON from Make” en validate-pin | Make debe devolver siempre JSON en el webhook de validación PIN. |
| Body vacío (action/supervisor faltan) | En Vercel, si `req.body` llega vacío, el backend debe leer el body en bruto (ver siguiente sección). |

---

## 6. Lectura robusta del body (ya aplicada)

En ambos endpoints el body se lee de forma robusta (en Vercel a veces no llega parseado). Se ha aplicado un helper `readJSONBody` (como en `webhook-respuesta.js`): si `req.body` es un objeto, usarlo; si no, leer el stream y hacer `JSON.parse`. Así se evitan fallos silenciosos cuando “no funciona tal como deseo” por body vacío.

---

## 7. Resumen de objetivos compartidos (punto de partida)

- **App**: Gestión de incidencias en tiempo real con rol técnico (respuestas) y rol supervisor (visión global y control), integrada con Make.com y Notion.
- **Técnico**: Login por PIN → ver incidencias asignadas → Acepto/Rechazo/Ayuda (y otras acciones) con motivos; todo reenviado a Make y persistido en Notion.
- **Supervisor**: Login por PIN → ver todas las incidencias activas → asignar manual, resolver ayuda, pausar/reactivar escalado, resolver directamente; todo vía Make.
- **Make.com**: Recibir webhooks del dashboard, ejecutar lógica y lectura/escritura en Notion, y **responder al webhook** con el JSON esperado (sobre todo `incidents` para listados y `status`/`supervisor` para PIN).

Con este resumen y los pasos anteriores, puedes revisar en Make.com las URLs, los módulos “Responder al webhook” y los formatos de respuesta, La lectura robusta del body ya está aplicada en supervisor y validate-pin.
