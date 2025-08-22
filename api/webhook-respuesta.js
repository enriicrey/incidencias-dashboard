// API para manejar respuestas de técnicos
export default async function handler(req, res) {
    // Configurar CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    if (req.method !== 'POST' && req.method !== 'GET') {
        return res.status(405).json({ error: 'Solo se permite POST y GET' });
    }
    
    try {
        // Obtener datos del request (POST o GET para compatibilidad con correos)
        const data = req.method === 'POST' ? req.body : req.query;
        
        const {
            action,           // 'acepto', 'rechazo', 'ayuda', 'validate_pin', 'get_incident_details', 'get_assigned_incidents'
            id,              // ID de la incidencia
            incident_id,     // Alias para id
            tecnico,         // Email del técnico
            technician_email, // Alias para tecnico
            reason,          // Motivo específico (opcional)
            pin,             // PIN del técnico
            read_only        // Solo lectura (sin autenticación)
        } = data;
        
        // Normalizar variables
        const finalAction = action;
        const finalIncidentId = id || incident_id;
        const finalTechnicianEmail = tecnico || technician_email;
        
        // Validar datos básicos según acción
        if (!finalAction) {
            return res.status(400).json({
                status: 'error',
                error: 'Falta parámetro action',
                available_actions: [
                    'acepto', 'rechazo', 'ayuda', 
                    'validate_pin', 'get_incident_details', 'get_assigned_incidents'
                ]
            });
        }
        
        // Preparar payload para Make
        const makePayload = {
            timestamp: new Date().toISOString(),
            action: finalAction,
            incident_id: finalIncidentId,
            technician_email: finalTechnicianEmail,
            reason: reason || null,
            pin: pin,
            read_only: read_only === true || read_only === 'true',
            user_agent: req.headers['user-agent'],
            ip_address: req.headers['x-forwarded-for'] || req.connection.remoteAddress
        };
        
        console.log('🔧 Dashboard Técnico - Acción:', finalAction);
        console.log('📨 Payload a Make:', makePayload);
        
        // En desarrollo, simular respuestas según la acción
        if (!process.env.MAKE_WEBHOOK_RESPUESTA) {
            console.log('🔧 DESARROLLO - Simulando respuesta...');
            return res.status(200).json(
                getDevResponse(finalAction, makePayload)
            );
        }
        
        // En producción, enviar a Make
        console.log('📡 Enviando a Make:', process.env.MAKE_WEBHOOK_RESPUESTA);
        
        const makeResponse = await fetch(process.env.MAKE_WEBHOOK_RESPUESTA, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(makePayload)
        });
        
        console.log('📥 Make Response Status:', makeResponse.status);
        
        if (!makeResponse.ok) {
            throw new Error(`Error en Make: ${makeResponse.status}`);
        }
        
        // Leer respuesta de Make
        const responseText = await makeResponse.text();
        console.log('📄 Make Response:', responseText.substring(0, 200) + '...');
        
        // Si Make devuelve solo "Accepted", generar respuesta propia
        if (responseText.trim() === 'Accepted' || responseText.trim() === 'OK') {
            return res.status(200).json({
                status: 'success',
                message: `Acción ${finalAction} procesada correctamente por Make`,
                action: finalAction,
                timestamp: new Date().toISOString()
            });
        }
        
        // Si Make devuelve JSON, parsearlo
        try {
            const makeData = JSON.parse(responseText);
            console.log('✅ JSON parsed successfully');
            return res.status(200).json(makeData);
        } catch (parseError) {
            console.log('⚠️ Make response no es JSON válido, asumiendo éxito');
            return res.status(200).json({
                status: 'success',
                message: `Acción ${finalAction} procesada por Make`,
                action: finalAction,
                make_response: responseText.substring(0, 100),
                timestamp: new Date().toISOString()
            });
        }
        
    } catch (error) {
        console.error('❌ Error en webhook respuesta:', error);
        
        return res.status(500).json({
            status: 'error',
            message: 'Error interno del servidor',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Error procesando respuesta',
            action: req.body?.action || req.query?.action || 'unknown'
        });
    }
}

// 🔧 Respuestas simuladas para desarrollo
function getDevResponse(action, payload) {
    console.log(`🎭 Simulando acción: ${action}`);
    
    switch (action) {
        case 'get_incident_details':
            return {
                status: 'success',
                message: 'Detalles de incidencia obtenidos',
                incident: {
                    id: payload.incident_id || 'INC-20/08-00045',
                    priority: '🔴 CRÍTICA',
                    equipment: 'Sistema Hidráulico Central',
                    zone: 'Zona Este - Línea Producción A',
                    status: '🚦 Escalada L2',
                    escalation_level: 2,
                    escalation_paused: false,
                    created_date: '2024-08-20T10:30:00Z',
                    description: 'Se detecta presión irregular en el sistema hidráulico principal. La presión ha descendido de 150 PSI a 95 PSI en los últimos 15 minutos. Requiere revisión inmediata para evitar parada de línea de producción.',
                    sla_l0_end: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min
                    sla_l1_backup_end: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // 15 min
                    sla_l2_equipo_end: new Date(Date.now() + 45 * 60 * 1000).toISOString(), // 45 min
                    encargado_zona: 'María González',
                    telefono_encargado: '+34 600 123 456',
                    supervisor: 'Elena Vázquez',
                    telefono_supervisor: '+34 600 789 012',
                    url: 'https://notion.so/incidencia-ejemplo'
                },
                timestamp: new Date().toISOString()
            };
            
        case 'validate_pin':
            const isValidPin = payload.pin === '1234'; // PIN de prueba
            return {
                status: isValidPin ? 'success' : 'error',
                message: isValidPin ? 'PIN válido' : 'PIN incorrecto',
                technician: isValidPin ? {
                    name: 'Jorge Técnico',
                    email: payload.technician_email,
                    department: 'Mantenimiento Industrial',
                    level: 'Senior'
                } : null,
                timestamp: new Date().toISOString()
            };
            
        case 'get_assigned_incidents':
            return {
                status: 'success',
                message: 'Incidencias del técnico obtenidas',
                incidents: [
                    {
                        id: 'INC-20/08-00045',
                        priority: '🔴 CRÍTICA',
                        equipment: 'Sistema Hidráulico Central',
                        zone: 'Zona Este',
                        status: 'Escalada L0',
                        escalation_level: 0,
                        created_date: '2024-08-20T10:30:00Z',
                        assigned_technician: null, // No asignada aún
                        l0_technician: payload.technician_email, // Técnico L0 debe responder
                        l1_technician: 'maria@empresa.com',
                        l2_technicians_notified: 'carlos@empresa.com, pedro@empresa.com',
                        sla_l0_end: new Date(Date.now() + 45 * 60 * 1000).toISOString(), // 45 min
                        sla_l1_backup_end: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                        sla_l2_equipo_end: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
                        description: 'Presión irregular en sistema hidráulico'
                    },
                    {
                        id: 'INC-20/08-00046',
                        priority: '🟡 MEDIA',
                        equipment: 'Sensor Temperatura #7',
                        zone: 'Zona Norte',
                        status: 'En Proceso',
                        escalation_level: 0,
                        created_date: '2024-08-20T08:15:00Z',
                        assigned_technician: payload.technician_email, // YA asignada - trabajando
                        l0_technician: payload.technician_email,
                        l1_technician: null,
                        l2_technicians_notified: null,
                        assigned_date: '2024-08-20T09:00:00Z',
                        description: 'Calibración de sensor de temperatura'
                    },
                    {
                        id: 'INC-20/08-00047',
                        priority: '🟠 ALTA',
                        equipment: 'Motor Banda Transportadora',
                        zone: 'Zona Central',
                        status: 'Escalada L2',
                        escalation_level: 2,
                        created_date: '2024-08-20T11:00:00Z',
                        assigned_technician: null, // No asignada
                        l0_technician: 'otro@empresa.com',
                        l1_technician: 'otro2@empresa.com',
                        l2_technicians_notified: `${payload.technician_email}, carlos@empresa.com, pedro@empresa.com`, // Técnico en L2
                        sla_l0_end: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // Vencido
                        sla_l1_backup_end: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // Vencido
                        sla_l2_equipo_end: new Date(Date.now() + 20 * 60 * 1000).toISOString(), // 20 min
                        description: 'Sobrecalentamiento en motor principal'
                    }
                ],
                technician: {
                    name: 'Jorge Técnico',
                    email: payload.technician_email
                },
                timestamp: new Date().toISOString()
            };
            
        case 'acepto':
            return {
                status: 'success',
                message: `Incidencia ${payload.incident_id} aceptada correctamente`,
                action_taken: 'accepted',
                incident_id: payload.incident_id,
                technician: payload.technician_email,
                next_step: 'Te has asignado a esta incidencia. Puedes empezar a trabajar en ella.',
                timestamp: new Date().toISOString()
            };
            
        case 'rechazo':
            const reasonText = getReasonText(payload.reason);
            return {
                status: 'success',
                message: `Incidencia ${payload.incident_id} rechazada`,
                action_taken: 'rejected',
                incident_id: payload.incident_id,
                technician: payload.technician_email,
                reason: payload.reason,
                reason_text: reasonText,
                next_step: 'La incidencia se escalará automáticamente al siguiente nivel disponible.',
                timestamp: new Date().toISOString()
            };
            
        case 'ayuda':
            const helpReasonText = getReasonText(payload.reason);
            return {
                status: 'success',
                message: `Ayuda solicitada para ${payload.incident_id}`,
                action_taken: 'help_requested',
                incident_id: payload.incident_id,
                technician: payload.technician_email,
                reason: payload.reason,
                reason_text: helpReasonText,
                next_step: 'El escalado se ha pausado. Un supervisor se pondrá en contacto contigo.',
                escalation_paused: true,
                timestamp: new Date().toISOString()
            };
            
        default:
            return {
                status: 'error',
                message: `Acción "${action}" no reconocida`,
                available_actions: [
                    'acepto', 'rechazo', 'ayuda', 
                    'validate_pin', 'get_incident_details', 'get_assigned_incidents'
                ]
            };
    }
}

// Función auxiliar para obtener texto legible de motivos
function getReasonText(reason) {
    const reasons = {
        // Motivos de rechazo
        'ocupado_otra': 'Ocupado con otra incidencia',
        'fuera_especialidad': 'Fuera de mi especialidad',
        'no_disponible': 'No disponible ahora',
        'falta_herramientas': 'Faltan herramientas/repuestos',
        'ubicacion_lejos': 'Muy lejos de mi ubicación',
        'sobrecarga_trabajo': 'Sobrecarga de trabajo',
        
        // Motivos de ayuda
        'apoyo_tecnico': 'Necesito apoyo técnico',
        'consulta_supervisor': 'Consulta con supervisor',
        'herramientas_especiales': 'Herramientas especiales',
        'procedimiento_dudas': 'Dudas sobre procedimiento',
        'seguridad_riesgo': 'Problema de seguridad',
        'repuestos_urgentes': 'Repuestos urgentes'
    };
    
    return reasons[reason] || reason || 'Sin motivo especificado';
}
