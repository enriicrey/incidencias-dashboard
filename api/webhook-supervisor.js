// API para manejar acciones del supervisor
export default async function handler(req, res) {
    // Configurar CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Solo se permite POST' });
    }
    
    try {
        const {
            action,          // 'validate_pin', 'get_incidents', 'assign_manual', etc.
            supervisor,      // Email del supervisor
            pin,            // PIN de acceso (para validación)
            incident_id,    // ID de incidencia (para acciones)
            technician,     // Email técnico (para asignaciones)
            data            // Datos adicionales según la acción
        } = req.body;
        
        // Validar datos básicos
        if (!action || !supervisor) {
            return res.status(400).json({
                error: 'Faltan parámetros requeridos',
                required: ['action', 'supervisor']
            });
        }
        
        // Preparar payload para Make
        const makePayload = {
            timestamp: new Date().toISOString(),
            action: action,
            supervisor_email: supervisor,
            pin: pin,
            incident_id: incident_id,
            technician_email: technician,
            additional_data: data,
            user_agent: req.headers['user-agent'],
            ip_address: req.headers['x-forwarded-for'] || req.connection.remoteAddress
        };
        
        // En desarrollo, simular respuestas según la acción
        if (!process.env.MAKE_WEBHOOK_SUPERVISOR) {
            console.log('🛡️ DESARROLLO - Acción supervisor:', makePayload);
            
            return res.status(200).json(
                getDevResponse(action, makePayload)
            );
        }
        
        // En producción, enviar a Make
        console.log('📡 Enviando a Make:', process.env.MAKE_WEBHOOK_SUPERVISOR);
        console.log('📨 Payload:', makePayload);
        
        const makeResponse = await fetch(process.env.MAKE_WEBHOOK_SUPERVISOR, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(makePayload)
        });
        
        console.log('📥 Make Response Status:', makeResponse.status);
        console.log('📥 Make Response Headers:', Object.fromEntries(makeResponse.headers));
        
        if (!makeResponse.ok) {
            throw new Error(`Error en Make: ${makeResponse.status}`);
        }
        
        // 🔧 DEBUGGING CRÍTICO - Ver qué devuelve Make como texto
        const responseText = await makeResponse.text();
        console.log('📄 Make Response Text (raw):', responseText);
        console.log('📏 Response length:', responseText.length);
        console.log('🔤 First 200 chars:', responseText.substring(0, 200));
        console.log('🔤 Last 200 chars:', responseText.substring(responseText.length - 200));
        
        // Intentar parsear JSON
        try {
            const makeData = JSON.parse(responseText);
            console.log('✅ JSON parsed successfully');
            return res.status(200).json(makeData);
        } catch (parseError) {
            console.error('❌ JSON Parse Error:', parseError.message);
            console.error('❌ Error at position:', parseError.message.match(/position (\d+)/)?.[1]);
            
            // Devolver información útil para debugging
            return res.status(500).json({
                status: 'error',
                message: 'Invalid JSON from Make',
                parse_error: parseError.message,
                raw_response_preview: responseText.substring(0, 500),
                response_length: responseText.length
            });
        }
        
    } catch (error) {
        console.error('❌ Error en webhook-supervisor:', error);
        
        return res.status(500).json({
            status: 'error',
            message: 'Error interno del servidor',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Error procesando acción'
        });
    }
}

// Función para simular respuestas en desarrollo
function getDevResponse(action, payload) {
    switch (action) {
        case 'validate_pin':
            const isValidPin = payload.pin === '1234';
            return {
                status: isValidPin ? 'success' : 'error',
                message: isValidPin ? 'PIN válido' : 'PIN incorrecto',
                supervisor: isValidPin ? {
                    name: 'Elena Vázquez',
                    email: payload.supervisor_email,
                    department: 'Supervisor'
                } : null
            };
            
        case 'get_incidents':
            return {
                status: 'success',
                incidents: [
                    {
                        id: 'INC-20/08-00045-CRÍTICA-ZNA-MT12',
                        priority: 'CRÍTICA',
                        status: 'help_requested',
                        equipment: 'Compresor Principal #3',
                        zone: 'Línea Norte A',
                        time_elapsed: 8,
                        technician_responses: [
                            {
                                level: 'L0',
                                technician: 'Jorge',
                                response: 'rechazo',
                                reason: 'fuera_especialidad'
                            },
                            {
                                level: 'L1',
                                technician: 'Ana',
                                response: 'ayuda',
                                reason: 'herramientas_especiales'
                            }
                        ],
                        escalation_paused: true
                    }
                ],
                last_update: new Date().toISOString()
            };
            
        case 'assign_manual':
            return {
                status: 'success',
                message: `Incidencia ${payload.incident_id} asignada a ${payload.technician_email}`,
                action_taken: 'manual_assignment'
            };
            
        case 'resolve_help':
            return {
                status: 'success',
                message: 'Ayuda resuelta - Escalado reactivado',
                action_taken: 'help_resolved'
            };
            
        default:
            return {
                status: 'error',
                message: `Acción "${action}" no reconocida`
            };
    }
}
