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
            action,          // 'get_incidents', 'assign_manual', etc.
            supervisor,     // Email del supervisor
            department,
            escalation_paused, //Escalado parado si o no (para paused_incidend action)
            supervisor_name,
            incident_id,    // ID de incidencia (para acciones)
            technician,     // Email técnico (para asignaciones)
            solution,       // Solución (para resolver directamente)
            help_action,    // Tipo de ayuda (provide_tools, provide_consultation)
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
            department: department,
            supervisor_name: supervisor_name,
            incident_id: incident_id,
            escalation_paused: escalation_paused,
            technician_email: technician,
            solution: solution,
            help_action: help_action,
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
        console.log('📤 First 500 chars:', responseText.substring(0, 500));
        console.log('📤 Last 200 chars:', responseText.substring(responseText.length - 200));
        
        // ⚠️ VERIFICACIÓN CRÍTICA: ¿Es "Accepted" únicamente?
        if (responseText.trim() === 'Accepted' || responseText.trim() === 'OK') {
            console.log('⚠️ Make devolvió solo texto plano, no JSON válido');
            return res.status(500).json({
                status: 'error',
                message: 'Make webhook mal configurado - devuelve texto plano',
                make_response: responseText,
                solution: 'Verificar que el webhook response en Make devuelva JSON válido'
            });
        }
        
        // Intentar parsear JSON
        try {
            const makeData = JSON.parse(responseText);
            console.log('✅ JSON parsed successfully');
            
            // Validar que tenga la estructura esperada
            if (makeData.incidents && Array.isArray(makeData.incidents)) {
                console.log(`📊 Received ${makeData.incidents.length} incidents`);
            } else {
                console.log('⚠️ JSON válido pero sin estructura esperada');
                console.log('📋 Estructura recibida:', Object.keys(makeData));
            }
            
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
                response_length: responseText.length,
                response_starts_with: responseText.substring(0, 50),
                response_ends_with: responseText.substring(responseText.length - 50),
                is_only_accepted: responseText.trim() === 'Accepted'
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
      case 'get_incidents':
            return {
                status: 'success',
                timestamp: new Date().toISOString(),
                incidents: [
                    {
                        id: 'INC-20/08-00045',
                        priority: '🔴 CRÍTICA',
                        equipment: 'Compresor Principal #3',
                        zone: 'Línea Norte A',
                        status: '🔄 Asignada',
                        escalation_level: 2,
                        escalation_paused: true,
                        time_elapsed: 45,
                        assigned_technician: 'jorge@empresa.com',
                        closed_by: 'No cerrada',
                        l0_technician: 'jorge@empresa.com',
                        l0_response: '❌ Rechazado',
                        l0_reject_reason: 'Fuera de especialidad',
                        l0_help_type: 'Sin ayuda',
                        l1_technician: 'ana@empresa.com',
                        l1_response: '🟡 Ayuda',
                        l1_reject_reason: 'Sin motivo',
                        l1_help_type: 'Herramientas especiales',
                        l2_technicians: 'carlos@empresa.com, maria@empresa.com',
                        l2_responses: '❌ Rechazado, ✅ Aceptado',
                        l2_reject_reasons: 'Falta herramientas, Sin motivos',
                        l2_technicians_notified: 'carlos@empresa.com, maria@empresa.com, pedro@empresa.com',
                        l3_response: '⭕ Sin Respuesta',
                        supervisor_phone: '+34666777888',
                        url: 'https://notion.so/test-incident',
                        description: 'Fallo en compresor principal con ruidos anómalos'
                    },
                    {
                        id: 'INC-20/08-00046',
                        priority: '🟠 ALTA',
                        equipment: 'Motor Banda #7',
                        zone: 'Línea Sur B',
                        status: '🆕 Nueva',
                        escalation_level: 1,
                        escalation_paused: false,
                        time_elapsed: 15,
                        assigned_technician: 'Sin asignar',
                        closed_by: 'No cerrada',
                        l0_technician: 'carlos@empresa.com',
                        l0_response: '⭕ Sin Respuesta',
                        l0_reject_reason: 'Sin motivo',
                        l0_help_type: 'Sin ayuda',
                        l1_technician: 'Sin asignar',
                        l1_response: '⭕ Sin Respuesta',
                        l1_reject_reason: 'Sin motivo',
                        l1_help_type: 'Sin ayuda',
                        l2_response: '⭕ Sin Respuesta',
                        l2_reject_reasons: 'Sin motivos',
                        l2_technicians_notified: 'Ninguno',
                        l3_response: '⭕ Sin Respuesta',
                        supervisor_phone: '+34666777888',
                        url: 'https://notion.so/test-incident-2',
                        description: 'Sobrecalentamiento en motor de banda transportadora'
                    },
                    {
                        id: 'INC-20/08-00047',
                        priority: '🔴 CRÍTICA',
                        equipment: 'Sistema Hidráulico Central',
                        zone: 'Zona Este',
                        status: '🚦 Escalado',
                        escalation_level: 3,
                        escalation_paused: false,
                        time_elapsed: 120,
                        assigned_technician: 'supervisor@empresa.com',
                        closed_by: 'No cerrada',
                        l0_technician: 'carlos@empresa.com',
                        l0_response: '❌ Rechazado',
                        l0_reject_reason: 'Sobrecarga trabajo',
                        l0_help_type: 'Sin ayuda',
                        l1_technician: 'maria@empresa.com',
                        l1_response: '❌ Rechazado',
                        l1_reject_reason: 'No disponible',
                        l1_help_type: 'Sin ayuda',
                        l2_technicians: 'pedro@empresa.com, luis@empresa.com, antonio@empresa.com',
                        l2_responses: '❌ Rechazado, ❌ Rechazado, ❌ Rechazado',
                        l2_reject_reasons: 'Falta herramientas, No disponible, Fuera especialidad',
                        l2_technicians_notified: 'pedro@empresa.com, luis@empresa.com, antonio@empresa.com, manuel@empresa.com',
                        l3_response: '⭕ Sin Respuesta',
                        supervisor_phone: '+34666777888',
                        url: 'https://notion.so/test-incident-3',
                        description: 'Pérdida de presión crítica en sistema hidráulico principal'
                    },
                    {
                        id: 'INC-19/08-00044',
                        priority: '🟡 MEDIA',
                        equipment: 'Sensor Temperatura #12',
                        zone: 'Área Central',
                        status: '✅ Resuelta',
                        escalation_level: 1,
                        escalation_paused: false,
                        time_elapsed: 180,
                        assigned_technician: 'luis@empresa.com',
                        closed_by: 'luis@empresa.com',
                        l0_technician: 'luis@empresa.com',
                        l0_response: '✅ Aceptado',
                        l0_reject_reason: 'Sin motivo',
                        l0_help_type: 'Sin ayuda',
                        l1_technician: 'Sin asignar',
                        l1_response: '⭕ Sin Respuesta',
                        l1_reject_reason: 'Sin motivo',
                        l1_help_type: 'Sin ayuda',
                        l2_technicians: 'Sin asignar',
                        l2_responses: '⭕ Sin Respuesta',
                        l2_reject_reasons: 'Sin motivos',
                        l2_technicians_notified: 'Ninguno',
                        l3_response: '⭕ Sin Respuesta',
                        supervisor_phone: '+34666777888',
                        url: 'https://notion.so/test-incident-4',
                        description: 'Calibración de sensor de temperatura completada'
                    }
                ]
            };
            
        case 'assign_manual':
            return {
                status: 'success',
                message: `Incidencia ${payload.incident_id} asignada manualmente a ${payload.technician_email}`,
                action_taken: 'manual_assignment',
                incident_id: payload.incident_id,
                technician: payload.technician_email,
                timestamp: new Date().toISOString()
            };
            
        case 'resolve_help':
            return {
                status: 'success',
                message: 'Ayuda resuelta - Escalado reactivado',
                action_taken: 'help_resolved',
                incident_id: payload.incident_id,
                help_action: payload.help_action,
                escalation_resumed: true,
                timestamp: new Date().toISOString()
            };
            
        case 'pause_escalation':
            console.log(response)
            return {
                status: 'success',
                message: `Escalado pausado para ${payload.incident_id}`,
                action_taken: 'pause_escalation',
                incident_id: payload.incident_id,
                escalation_paused: payload.escalation_paused,
                timestamp: new Date().toISOString()
            };
            
        case 'resolve_directly':
            return {
                status: 'success',
                message: `Incidencia ${payload.incident_id} resuelta directamente por supervisor`,
                action_taken: 'direct_resolution',
                incident_id: payload.incident_id,
                solution: payload.solution,
                resolved_by: payload.supervisor_email,
                timestamp: new Date().toISOString()
            };
            
        default:
            return {
                status: 'error',
                message: `Acción "${action}" no reconocida`,
                available_actions: [
                    'get_incidents', 
                    'assign_manual',
                    'resolve_help',
                    'pause_escalation',
                    'resolve_directly'
                ]
            };
    }
}
