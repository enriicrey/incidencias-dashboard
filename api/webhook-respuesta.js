// API para manejar respuestas de técnicos - VERSIÓN COMPLETA
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
        // Obtener datos del request
        const data = req.method === 'POST' ? req.body : req.query;
        
        const {
            action,              // 'acepto', 'rechazo', 'ayuda', 'get_assigned_incidents'
            incident_id,         // ID de la incidencia
            technician_email,    // Email del técnico
            reason,              // Motivo específico
            escalation_level,    // Nivel de escalado (0, 1, 2)
            read_only           // Solo consulta
        } = data;
        
        // Validar datos básicos
        if (!action) {
            return res.status(400).json({
                status: 'error',
                error: 'Falta parámetro action',
                available_actions: ['acepto', 'rechazo', 'ayuda', 'get_assigned_incidents']
            });
        }
        
        // Preparar payload para Make
        const makePayload = {
            timestamp: new Date().toISOString(),
            action: action,
            incident_id: incident_id,
            technician_email: technician_email,
            reason: reason || null,
            escalation_level: parseInt(escalation_level) || 0,
            read_only: read_only === true || read_only === 'true',
            user_agent: req.headers['user-agent'],
            ip_address: req.headers['x-forwarded-for'] || req.connection.remoteAddress
        };
        
        console.log('🔧 Dashboard Técnico - Acción:', action);
        console.log('📨 Payload a Make:', makePayload);
        
        // En desarrollo, simular respuestas
        if (!process.env.MAKE_WEBHOOK_RESPUESTA) {
            console.log('🔧 DESARROLLO - Simulando respuesta...');
            return res.status(200).json(
                getDevResponse(action, makePayload)
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
        
        console.log('🔥 Make Response Status:', makeResponse.status);
        
        if (!makeResponse.ok) {
            throw new Error(`Error en Make: ${makeResponse.status}`);
        }
        
        // Leer respuesta de Make
        const responseText = await makeResponse.text();
        console.log('📄 Make Response:', responseText.substring(0, 200) + '...');
        
        // Si Make devuelve solo "Accepted", generar respuesta propia
        if (responseText.trim() === 'Accepted' || responseText.trim() === 'OK') {
            return res.status(200).json(
                getSuccessResponse(action, makePayload)
            );
        }
        
        // Si Make devuelve JSON, parsearlo
        try {
            const makeData = JSON.parse(responseText);
            console.log('✅ JSON parsed successfully');
            return res.status(200).json(makeData);
        } catch (parseError) {
            console.log('⚠️ Make response no es JSON válido, generando respuesta');
            return res.status(200).json(
                getSuccessResponse(action, makePayload)
            );
        }
        
    } catch (error) {
        console.error('❌ Error en webhook respuesta:', error);
        
        return res.status(500).json({
            status: 'error',
            message: 'Error interno del servidor',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Error procesando acción',
            action: req.body?.action || req.query?.action || 'unknown'
        });
    }
}

// Función para generar respuestas en desarrollo
function getDevResponse(action, payload) {
    switch(action) {
        case 'get_assigned_incidents':
            return {
                status: 'success',
                incidents: [
                    {
                        incident_id: 'INC-20/08-00045-CRÍTICA-ZNA-MT12',
                        priority: 'Crítica',
                        zone: 'Zona Norte - MT12',
                        equipment: 'Motor Principal #3',
                        description: 'Vibración anormal detectada en motor principal. Posible desalineación.',
                        l0_technician: payload.technician_email,
                        sla_l0_end: new Date(Date.now() + 15 * 60000).toISOString(), // 15 min
                        requires_response: true,
                        assigned_level: 'inicial'
                    },
                    {
                        incident_id: 'INC-20/08-00046-ALTA-ZSU-EL05',
                        priority: 'Alta',
                        zone: 'Zona Sur - EL05',
                        equipment: 'Panel Eléctrico A',
                        description: 'Caída de tensión intermitente en línea principal.',
                        assigned_technician: payload.technician_email,
                        can_request_help: true,
                        type: 'working'
                    }
                ],
                technician: {
                    email: payload.technician_email,
                    name: payload.technician_email.split('@')[0]
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
                escalation_level: payload.escalation_level,
                next_step: 'Puedes empezar a trabajar en ella.',
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
                escalation_level: payload.escalation_level,
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
                escalation_level: payload.escalation_level,
                next_step: 'El escalado se ha pausado. Un supervisor se pondrá en contacto contigo.',
                escalation_paused: true,
                timestamp: new Date().toISOString()
            };
            
        default:
            return {
                status: 'error',
                message: `Acción "${action}" no reconocida`,
                available_actions: ['acepto', 'rechazo', 'ayuda', 'get_assigned_incidents']
            };
    }
}

// Función para generar respuestas de éxito en producción
function getSuccessResponse(action, payload) {
    switch(action) {
        case 'acepto':
            return {
                status: 'success',
                message: `Incidencia aceptada correctamente`,
                action_taken: 'accepted',
                incident_id: payload.incident_id,
                technician: payload.technician_email,
                next_step: 'Puedes empezar a trabajar en la incidencia.',
                timestamp: new Date().toISOString()
            };
            
        case 'rechazo':
            return {
                status: 'success',
                message: `Incidencia rechazada`,
                action_taken: 'rejected',
                incident_id: payload.incident_id,
                technician: payload.technician_email,
                reason: payload.reason,
                reason_text: getReasonText(payload.reason),
                next_step: 'La incidencia se escalará automáticamente.',
                timestamp: new Date().toISOString()
            };
            
        case 'ayuda':
            return {
                status: 'success',
                message: `Solicitud de ayuda enviada`,
                action_taken: 'help_requested',
                incident_id: payload.incident_id,
                technician: payload.technician_email,
                reason: payload.reason,
                reason_text: getReasonText(payload.reason),
                next_step: 'Un supervisor se pondrá en contacto contigo.',
                escalation_paused: true,
                timestamp: new Date().toISOString()
            };
            
        default:
            return {
                status: 'success',
                message: `Acción ${action} procesada correctamente`,
                action: action,
                timestamp: new Date().toISOString()
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
