// /api/webhook-respuesta.js - VERSIÓN COMPLETA
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
            level,
            // Campos específicos por acción
            reason,
            pin,
            escalation_level,
            read_only,
            // Resolver
            solution_description,
            time_invested,
            preventive_actions,
            materials_used,
            // Solicitar materiales
            materials_requested,
            work_can_continue,
            impact_if_delayed,
            // Derivar departamento
            current_department,
            target_department,
            derivation_reason,
            technical_notes,
            // Ayuda
            help_type,
            help_description,
            urgency,
            // Solicitar asignación
            request_reason,
            request_justification,
            // Aportar información
            information_type,
            information_content,
            attachments
        } = data;
        
        console.log('🔧 Dashboard Técnico - Acción:', action);
        console.log('📨 Payload recibido:', JSON.stringify(data, null, 2));
        
        // Validar datos básicos
        if (!action) {
            return res.status(400).json({
                status: 'error',
                error: 'Falta parámetro action'
            });
        }
        
        // Preparar payload base para Make
        let makePayload = {
            timestamp: new Date().toISOString(),
            action: action,
            incident_id: incident_id,
            technician_email: technician_email,
            technician_name: technician_name || technician_email?.split('@')[0],
            level: level || 'L0',
            user_agent: req.headers['user-agent'],
            ip_address: req.headers['x-forwarded-for'] || req.connection.remoteAddress
        };
        
        // ========================================
        // PROCESAR SEGÚN TIPO DE ACCIÓN
        // ========================================
        
        switch (action) {
            case 'acepto':
            case 'rechazo':
                makePayload.reason = reason;
                makePayload.escalation_level = parseInt(escalation_level) || 0;
                break;
                
            case 'resolver':
                // Validar campos obligatorios
                if (!solution_description || !time_invested) {
                    return res.status(400).json({
                        status: 'error',
                        error: 'solution_description y time_invested son obligatorios'
                    });
                }
                
                makePayload.solution_description = solution_description;
                makePayload.time_invested = time_invested;
                makePayload.preventive_actions = preventive_actions || '';
                makePayload.materials_used = materials_used || [];
                
                // Procesar materiales si existen
                if (materials_used && Array.isArray(materials_used)) {
                    makePayload.materials_count = materials_used.length;
                    makePayload.materials_summary = materials_used.map(m => 
                        `${m.materialName} (${m.quantity})`
                    ).join(', ');
                }
                break;
                
            case 'solicitar_materiales':
                // Validar materiales solicitados
                if (!materials_requested || !Array.isArray(materials_requested) || materials_requested.length === 0) {
                    return res.status(400).json({
                        status: 'error',
                        error: 'materials_requested debe ser un array con al menos un material'
                    });
                }
                
                makePayload.materials_requested = materials_requested;
                makePayload.work_can_continue = work_can_continue || false;
                makePayload.impact_if_delayed = impact_if_delayed || 'Sin impacto especificado';
                makePayload.materials_count = materials_requested.length;
                makePayload.urgency_levels = materials_requested.map(m => m.urgency).join(',');
                break;
                
            case 'derivar_departamento':
                if (!target_department || !derivation_reason) {
                    return res.status(400).json({
                        status: 'error',
                        error: 'target_department y derivation_reason son obligatorios'
                    });
                }
                
                makePayload.current_department = current_department;
                makePayload.target_department = target_department;
                makePayload.derivation_reason = derivation_reason;
                makePayload.technical_notes = technical_notes || '';
                break;
                
            case 'ayuda':
                if (!help_type || !help_description) {
                    return res.status(400).json({
                        status: 'error',
                        error: 'help_type y help_description son obligatorios'
                    });
                }
                
                makePayload.help_type = help_type;
                makePayload.help_description = help_description;
                makePayload.urgency = urgency || 'media';
                break;
                
            case 'solicitar_asignacion':
                makePayload.request_reason = request_reason;
                makePayload.request_justification = request_justification;
                break;
                
            case 'aportar_informacion':
                makePayload.information_type = information_type;
                makePayload.information_content = information_content;
                makePayload.attachments = attachments || [];
                break;
                
            case 'validate_pin':
                makePayload.pin = pin;
                break;
                
            case 'get_assigned_incidents':
                makePayload.read_only = read_only === true || read_only === 'true';
                break;
                
            default:
                console.warn(`⚠️ Acción no reconocida: ${action}`);
                // Enviar payload genérico
                makePayload = { ...makePayload, ...data };
        }
        
        console.log('📡 Enviando a Make:', JSON.stringify(makePayload, null, 2));
        
        // Verificar configuración de webhook
        if (!process.env.MAKE_WEBHOOK_RESPUESTA) {
            console.error('❌ MAKE_WEBHOOK_RESPUESTA no configurado');
            return res.status(500).json({
                status: 'error',
                message: 'Webhook no configurado en el servidor'
            });
        }
        
        // Enviar a Make.com
        const makeResponse = await fetch(process.env.MAKE_WEBHOOK_RESPUESTA, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(makePayload)
        });
        
        console.log('📥 Make Response Status:', makeResponse.status);
        
        if (!makeResponse.ok) {
            throw new Error(`Error en Make: ${makeResponse.status} ${makeResponse.statusText}`);
        }
        
        // Leer respuesta de Make
        const responseText = await makeResponse.text();
        console.log('📄 Make Response:', responseText.substring(0, 300) + '...');
        
        // Si Make devuelve "Accepted" o similar, generar respuesta propia
        if (responseText.trim() === 'Accepted' || responseText.trim() === 'OK') {
            const actionMessages = {
                'acepto': 'Incidencia aceptada correctamente',
                'rechazo': 'Incidencia rechazada. Se escalará automáticamente',
                'resolver': 'Incidencia resuelta exitosamente',
                'solicitar_materiales': 'Solicitud de materiales enviada al almacén',
                'derivar_departamento': 'Derivación solicitada al supervisor',
                'ayuda': 'Solicitud de ayuda enviada al supervisor',
                'solicitar_asignacion': 'Solicitud de asignación enviada',
                'aportar_informacion': 'Información aportada correctamente'
            };
            
            return res.status(200).json({
                status: 'success',
                message: actionMessages[action] || `Acción ${action} procesada correctamente`,
                action: action,
                incident_id: incident_id,
                timestamp: new Date().toISOString()
            });
        }
        
        // Si Make devuelve JSON, parsearlo
        try {
            const makeData = JSON.parse(responseText);
            console.log('✅ JSON parseado exitosamente');
            return res.status(200).json(makeData);
        } catch (parseError) {
            console.log('⚠️ Respuesta de Make no es JSON válido, asumiendo éxito');
            return res.status(200).json({
                status: 'success',
                message: `Acción ${action} procesada correctamente`,
                action: action,
                incident_id: incident_id,
                make_response: responseText.substring(0, 100),
                timestamp: new Date().toISOString()
            });
        }
        
    } catch (error) {
        console.error('💥 Error en webhook-respuesta:', error);
        
        return res.status(500).json({
            status: 'error',
            message: 'Error interno del servidor',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Error procesando acción',
            action: req.body?.action || req.query?.action || 'unknown',
            timestamp: new Date().toISOString()
        });
    }
}
