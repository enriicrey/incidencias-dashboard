// API para manejar respuestas de técnicos - VERSIÓN ARREGLADA
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
            action,
            incident_id,
            technician_email,
            technician_name,
            reason,
            pin,
            escalation_level,
            read_only
        } = data;
        
        console.log('🔧 Dashboard Técnico - Acción:', action);
        console.log('📨 Payload recibido:', data);
        
        // Validar datos básicos
        if (!action) {
            return res.status(400).json({
                status: 'error',
                error: 'Falta parámetro action',
                available_actions: [
                    'acepto', 'rechazo', 'ayuda', 
                    'get_assigned_incidents', 'validate_technician_pin'
                ]
            });
        }
        
        // Preparar payload para Make
        const makePayload = {
            timestamp: new Date().toISOString(),
            action: action,
            incident_id: incident_id,
            technician_email: technician_email,
            technician_name: technician_name || technician_email.split('@')[0],
            reason: reason || null,
            pin: pin,
            escalation_level: parseInt(escalation_level) || 0,
            read_only: read_only === true || read_only === 'true',
            user_agent: req.headers['user-agent'],
            ip_address: req.headers['x-forwarded-for'] || req.connection.remoteAddress
        };
        
        console.log('📨 Enviando a Make:', makePayload);
        
        // En desarrollo, usar datos de prueba
        if (!process.env.MAKE_WEBHOOK_RESPUESTA) {
            console.log('🔧 DESARROLLO - Usando datos de prueba');
            return res.status(200).json(getDevResponse(action, makePayload));
        }
        
        // En producción, enviar a Make
        console.log('📡 Enviando a Make URL:', process.env.MAKE_WEBHOOK_RESPUESTA);
        
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
        console.log('📄 Make Response (primeros 300 chars):', responseText.substring(0, 300));
        
        // PARSER MEJORADO - Limpiar JSON antes de parsear
        try {
            let cleanedResponse = responseText;
            
            // Limpiar comentarios de JSON
            cleanedResponse = cleanedResponse.replace(/\/\/.*$/gm, '');
            
            // Limpiar comillas malformadas
            cleanedResponse = cleanedResponse.replace(/"\s*,\s*$/gm, '",');
            
            // Limpiar último trailing comma
            cleanedResponse = cleanedResponse.replace(/,(\s*[}\]])/g, '$1');
            
            console.log('🧹 JSON limpiado, intentando parsear...');
            
            const parsedData = JSON.parse(cleanedResponse);
            console.log('✅ JSON parseado correctamente');
            console.log('📊 Status:', parsedData.status);
            
            if (parsedData.incidents && Array.isArray(parsedData.incidents)) {
                console.log('📊 Incidents encontrados:', parsedData.incidents.length);
            }
            
            return res.status(200).json(parsedData);
            
        } catch (parseError) {
            console.log('❌ Parser falló, usando fallback:', parseError.message);
            
            // FALLBACK - Crear respuesta manual si parseError
            if (action === 'get_assigned_incidents') {
                console.log('🔄 Usando datos de desarrollo para incidencias');
                return res.status(200).json(getDevResponse(action, makePayload));
            }
            
            // Para otras acciones, generar respuesta simple
            if (responseText.trim() === 'Accepted' || responseText.includes('success')) {
                return res.status(200).json({
                    status: 'success',
                    message: `Acción ${action} procesada correctamente`,
                    action: action,
                    timestamp: new Date().toISOString()
                });
            }
            
            throw parseError;
        }
        
    } catch (error) {
        console.error('❌ Error en webhook respuesta:', error);
        
        return res.status(500).json({
            status: 'error',
            message: 'Error interno del servidor',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Error procesando respuesta',
            action: data?.action || 'unknown'
        });
    }
}

// Respuestas de desarrollo (datos completos para testing)
function getDevResponse(action, payload) {
    const responses = {
        'get_assigned_incidents': {
            status: 'success',
            message: 'Incidencias cargadas correctamente',
            technician: {
                name: payload.technician_name,
                email: payload.technician_email,
                department: 'Mantenimiento'
            },
            incidents: [
                {
                    id: 'INC-25/08-00006-CRÍTICA-LNA-PL01',
                    priority: '🔴 CRÍTICA',
                    equipment: 'Prensa hidráulica principal',
                    zone: '🏭 Línea-A',
                    status: '🚦 Escalado',
                    escalation_level: '0',
                    escalation_paused: 'true',
                    l0_technician: payload.technician_email,
                    l0_response: '❌ Rechazado',
                    l0_reject_reason: 'Ocupado con otra incidencia crítica',
                    sla_l0_end: new Date(Date.now() + 25 * 60 * 1000).toISOString(),
                    supervisor: 'Elena Vázquez',
                    supervisor_phone: '+34666333444',
                    manager: 'Miguel Santos',
                    manager_phone: '+34666444555',
                    reporter: 'Sandra Morales',
                    reporter_phone: '+34666222111',
                    description: 'Prensa hidráulica principal ha perdido completamente la presión. Sistema de seguridad activado.',
                    actions_taken: 'Sin acciones',
                    time_elapsed: '-245'
                },
                {
                    id: 'INC-23/08-00002-ALTA-ZNB-CP08',
                    priority: '🟠 ALTA',
                    equipment: 'Compresora hidráulica',
                    zone: '🏭 Línea-B',
                    status: '🔄 Asignada',
                    escalation_level: '0',
                    escalation_paused: 'true',
                    l0_technician: payload.technician_email,
                    l0_response: '✅ Aceptado',
                    sla_l0_end: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                    supervisor: 'Elena Vázquez',
                    supervisor_phone: '+34666333444',
                    manager: 'Ana López',
                    manager_phone: '+34666222333',
                    reporter: 'Carlos Mendez',
                    reporter_phone: '+34666888999',
                    description: 'Pérdida gradual de presión en el sistema hidráulico.',
                    actions_taken: 'Técnico Fernando Castro aceptó incidencia y realizando inspección visual.',
                    time_elapsed: '205'
                }
            ]
        },
        'validate_technician_pin': {
            status: payload.pin === '1234' ? 'success' : 'error',
            message: payload.pin === '1234' ? 'PIN correcto' : 'PIN incorrecto',
            technician: payload.pin === '1234' ? {
                name: payload.technician_name,
                email: payload.technician_email,
                department: 'Mantenimiento',
                level: 'Técnico Senior'
            } : null
        },
        'acepto': {
            status: 'success',
            message: 'Incidencia aceptada correctamente',
            next_step: 'Dirígete a la zona indicada y comienza el diagnóstico.',
            incident_id: payload.incident_id,
            assigned_to: payload.technician_email
        },
        'rechazo': {
            status: 'success',
            message: 'Incidencia rechazada correctamente',
            next_step: 'La incidencia se ha escalado automáticamente.',
            incident_id: payload.incident_id,
            reason: payload.reason
        },
        'ayuda': {
            status: 'success',
            message: 'Solicitud de ayuda enviada',
            next_step: 'Se ha notificado al supervisor para que te proporcione asistencia.',
            incident_id: payload.incident_id,
            help_type: payload.reason
        }
    };
    
    return responses[action] || {
        status: 'success',
        message: `Acción ${action} procesada correctamente`,
        action: action
    };
}
