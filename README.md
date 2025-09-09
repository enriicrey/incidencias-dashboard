# 🎯 Sistema de Incidencias - Dashboard

Sistema de respuesta técnica y control supervisorial integrado con Make.com y Notion.

## 📋 Características

### 🔧 Dashboard Técnico
- Respuesta a incidencias asignadas (Acepto/Rechazo/Ayuda)
- Motivos específicos para cada tipo de respuesta
- Timer visual del SLA
- Acceso directo desde correos de asignación
- Interface móvil optimizada

### 🛡️ Panel Supervisor
- Control total de incidencias activas
- Visualización de respuestas de técnicos con motivos
- Asignación manual de técnicos
- Gestión de solicitudes de ayuda
- Control de escalados (pausar/reactivar)
- Autenticación por PIN

## 🚀 Tecnologías

- **Frontend**: HTML5, CSS3, JavaScript (Vanilla)
- **Backend**: Vercel Serverless Functions (Node.js)
- **Integración**: Make.com webhooks
- **Base de datos**: Notion
- **Deploy**: Vercel

## 📁 Estructura del Proyecto

```
incidencias-dashboard/
├── public/
│   ├── index.html          # Página principal
│   ├── tecnico.html        # Dashboard técnico
│   └── supervisor.html     # Panel supervisor
├── api/
│   ├── webhook-respuesta.js   # API respuestas técnicos
│   └── webhook-supervisor.js  # API acciones supervisor
├── vercel.json             # Configuración Vercel
├── package.json           # Dependencias
└── README.md              # Documentación
```

## 🔗 URLs del Sistema

- **Página principal**: `https://tu-dominio.vercel.app/`
- **Dashboard técnico**: `https://tu-dominio.vercel.app/tecnico`
- **Panel supervisor**: `https://tu-dominio.vercel.app/supervisor`

### URLs con parámetros (desde correos):
```
/tecnico?id=INC-123&tecnico=jorge@empresa.com&nivel=inicial
```

## 🛠️ Instalación y Deploy

### 1. Clonar y configurar
```bash
git clone https://github.com/tu-usuario/incidencias-dashboard.git
cd incidencias-dashboard
npm install
```

### 2. Variables de entorno (Vercel)
```bash
MAKE_WEBHOOK_RESPUESTA=https://hook.eu2.make.com/webhook-respuesta
MAKE_WEBHOOK_SUPERVISOR=https://hook.eu2.make.com/webhook-supervisor
ALLOW_DEMO_INCIDENTS=1                  # opcional, devuelve incidencias de ejemplo
```
> 💡 Define `ALLOW_DEMO_INCIDENTS=1` en entornos de prueba para que la acción `get_assigned_incidents` responda con datos de demostración (`demoIncidents`), permitiendo usar el dashboard sin depender del webhook real de Make.com.

### 3. Deploy en Vercel
```bash
# Conectar con GitHub
vercel --prod

# O deploy directo
npm run deploy
```

## 🔧 Configuración Make.com
Para asegurar que los campos de log (`Solicitudes (log)`, `Respuestas (log)` y `Notas (log)`) se envíen siempre como texto y sigan el formato esperado, configura los módulos de Make para:

- Construir cada línea con el Text Aggregator siguiendo el patrón:
  - Solicitudes: `[{{formatDate(now;"YYYY-MM-DDTHH:mm:ssZ")}}] MATERIAL#MAT-001|REQUEST|pieza X`
  - Respuestas: `[{{formatDate(now;"YYYY-MM-DDTHH:mm:ssZ")}}] RESP#L1#tecnico@example.com|ASSIGNED|`
  - Notas: `[{{formatDate(now;"YYYY-MM-DDTHH:mm:ssZ")}}] NOTE#tecnico@example.com|TECH|mensaje`

- Para `solicitudes_log` y `respuestas_log`, acumula todos los eventos desde L0 hasta el nivel actual y luego únelos con `join(array; "\n")`.
- Usar `{{emptystring}}` cuando no haya registros y también en los campos de niveles que no se utilicen (`l1_*`, `l2_*`, `l3_*`).

Ejemplo de salida final esperada para cada incidente:

```json
"solicitudes_log": "2024-05-10T09:00:00Z Solicitud de reinicio",
"respuestas_log": "2024-05-10T09:30:00Z L0 reporta éxito"
```

Asegúrate de que estos campos no lleguen como arreglos ni como `null`.
Esto evita que lleguen como arrays o valores `null`.

### Webhook de Respuestas Técnicos
**URL**: `/api/webhook-respuesta`

**Payload esperado**:
```json
{
  "action": "acepto|rechazo|ayuda",
  "id": "INC-20/08-00045",
  "tecnico": "jorge@empresa.com",
  "nivel": "inicial|backup|equipo",
  "reason": "motivo_especifico"
}
```

### Webhook Supervisor
**URL**: `/api/webhook-supervisor`

**Payload esperado**:
```json
{
  "action": "validate_pin|get_incidents|assign_manual",
  "supervisor": "elena@empresa.com",
  "pin": "1234",
  "incident_id": "INC-123",
  "technician": "jorge@empresa.com"
}
```

## 📊 Motivos de Respuesta

### ❌ Motivos de Rechazo
- `ocupado_otra`: Ocupado con otra incidencia
- `fuera_especialidad`: Fuera de mi especialidad
- `no_disponible`: No disponible ahora
- `falta_herramientas`: Faltan herramientas/repuestos
- `ubicacion_lejos`: Muy lejos de mi ubicación
- `sobrecarga_trabajo`: Sobrecarga de trabajo

### 🆘 Motivos de Ayuda
- `apoyo_tecnico`: Necesito apoyo técnico
- `consulta_supervisor`: Consulta con supervisor
- `herramientas_especiales`: Herramientas especiales
- `procedimiento_dudas`: Dudas sobre procedimiento
- `seguridad_riesgo`: Problema de seguridad
- `repuestos_urgentes`: Repuestos urgentes

## 🔐 Seguridad

- Validación de PIN para acceso supervisor
- Registro de IP y User-Agent en todas las acciones
- CORS configurado para dominios específicos
- Rate limiting en producción
- Logs de auditoría completos

## 🧪 Testing

### Datos de prueba
- **PIN Supervisor**: `1234`
- **Email técnico**: `jorge@empresa.com`
- **Incidencia ejemplo**: `INC-20/08-00045-CRÍTICA-ZNA-MT12`

### Desarrollo local
```bash
npm run dev
# Servidor en http://localhost:3000
```

## 📈 Monitoreo

- Logs en Vercel Function Logs
- Métricas de respuesta en Make.com
- Dashboard de errores en Vercel Analytics
- Tracking de SLA en Notion

## 🤝 Contribución

1. Fork del proyecto
2. Crear rama feature (`git checkout -b feature/nueva-funcionalidad`)
3. Commit cambios (`git commit -am 'Añadir funcionalidad'`)
4. Push a la rama (`git push origin feature/nueva-funcionalidad`)
5. Crear Pull Request

## 📞 Soporte

- **Issues**: GitHub Issues
- **Documentación**: [Wiki del proyecto]
- **Email**: soporte@empresa.com

## 📄 Licencia

MIT License - ver archivo `LICENSE` para detalles.

---

**🎯 Sistema desarrollado para optimizar la respuesta técnica y control supervisorial en tiempo real.**
