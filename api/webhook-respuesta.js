// API para manejar respuestas de técnicos - CON VALIDACIÓN PIN
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
            action,                    // Acción a realizar
            incident_id,               // ID de la incidencia
            technician_email,          // Email del técnico
            technician_name,
            reason,                    // Motivo específico
            pin,                       // PIN del técnico
            escalation_level,          // Nivel de escalado (0, 1, 2)
            read_only                  // Solo consulta (sin PIN)
        } = data;
        
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
        
        console.log('📥 Make Response Status:', makeResponse.status);
        
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
            error: process.env.NODE_ENV === 'development' ? error.message : 'Error procesando respuesta',
            action: req.body?.action || 'unknown'
        });
    }
}

// Respuestas de desarrollo
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
                    incident_id: 'INC-20/08-00045',
                    equipment: 'Transportadora MT-12',
                    zone: 'Zona A - Planta Principal',
                    description: 'Falla en motor principal, vibración excesiva y ruido anormal durante operación',
                    priority: 'CRÍTICA',
                    l0_technician: payload.technician_email,
                    sla_l0_end: new Date(Date.now() + 25 * 60 * 1000).toISOString(), // 25 min desde ahora
                    assigned_technician: null,
                    telefono_encargado: '+34666111222',
                    telefono_supervisor: '+34666333444'
                },
                {
                    incident_id: 'INC-20/08-00046',
                    equipment: 'Compresora CP-08',
                    zone: 'Zona B - Mantenimiento',
                    description: 'Pérdida de presión en sistema neumático',
                    priority: 'ALTA',
                    l1_technician: payload.technician_email,
                    sla_l1_backup_end: new Date(Date.now() + 45 * 60 * 1000).toISOString(), // 45 min desde ahora
                    assigned_technician: null,
                    telefono_encargado: '+34666555666',
                    telefono_supervisor: '+34666777888'
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
            next_step: 'Dirígete a la zona indicada y comienza el diagnóstico. Recuerda reportar el progreso.',
            incident_id: payload.incident_id,
            assigned_to: payload.technician_email,
            timestamp: payload.timestamp
        },
        'rechazo': {
            status: 'success',
            message: 'Incidencia rechazada correctamente',
            next_step: 'La incidencia se ha escalado automáticamente al siguiente nivel disponible.',
            incident_id: payload.incident_id,
            reason: payload.reason,
            escalated: true,
            timestamp: payload.timestamp
        },
        'ayuda': {
            status: 'success',
            message: 'Solicitud de ayuda enviada',
            next_step: 'Un supervisor o técnico especializado se pondrá en contacto contigo pronto.',
            incident_id: payload.incident_id,
            help_type: payload.reason,
            supervisor_notified: true,
            timestamp: payload.timestamp
        }
    };
    
    return responses[action] || {
        status: 'success',
        message: `Acción ${action} procesada en modo desarrollo`,
        action: action,
        timestamp: payload.timestamp
    };
}

// Respuestas de éxito generales
function getSuccessResponse(action, payload) {
    const messages = {
        'acepto': 'Incidencia aceptada correctamente',
        'rechazo': 'Incidencia rechazada y escalada',
        'ayuda': 'Solicitud de ayuda enviada al supervisor',
        'get_assigned_incidents': 'Incidencias obtenidas correctamente',
        'validate_technician_pin': 'PIN validado correctamente'
    };
    
    return {
        status: 'success',
        message: messages[action] || `Acción ${action} procesada correctamente`,
        action: action,
        incident_id: payload.incident_id,
        technician: payload.technician_email,
        timestamp: payload.timestamp
    };
}
