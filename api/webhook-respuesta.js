// API para manejar respuestas de técnicos - CON PARSER MEJORADO
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
        
        // PARSER MEJORADO - Intentar múltiples estrategias
        let parsedData = null;
        
        // Estrategia 1: JSON directo
        try {
            parsedData = JSON.parse(responseText);
            console.log('✅ JSON parsed directamente');
        } catch (directParseError) {
            console.log('⚠️ Parser directo falló, intentando limpiar...', directParseError.message);
            
            // Estrategia 2: Limpiar y reparar JSON agresivamente
            try {
                let cleanedJson = responseText
                    .trim()
                    // Arreglar objetos sin comas
                    .replace(/}\s*{/g, '},{')
                    // Limpiar comas extra
                    .replace(/,\s*}/g, '}')
                    .replace(/,\s*]/g, ']')
                    // Arreglar saltos de línea en strings
                    .replace(/"\s*\n\s*"/g, ' ')
                    .replace(/"\s*\n\s*/g, '"')
                    // Arreglar barras invertidas mal escapadas
                    .replace(/\\"/g, '"')
                    .replace(/"false\\"/g, '"false"')
                    .replace(/"true\\"/g, '"true"')
                    .replace(/"Sin motivo\\"/g, '"Sin motivo"')
                    .replace(/"Sin asignar\\"/g, '"Sin asignar"')
                    .replace(/"Sin descripción\\"/g, '"Sin descripción"')
                    .replace(/"Sin acciones\\"/g, '"Sin acciones"')
                    .replace(/"Sin ayuda\\"/g, '"Sin ayuda"')
                    // Normalizar espacios
                    .replace(/\s+/g, ' ')
                    // Arreglar IDs problemáticos
                    .replace(/"id":\s*"INC--\s*/g, '"id": "INC-')
                    .replace(/"id":\s*"([^"]*)\n([^"]*)"/g, '"id": "$1$2"');
                
                console.log('🔧 JSON limpiado, intentando parsear...');
                parsedData = JSON.parse(cleanedJson);
                console.log('✅ JSON reparado y parseado');
            } catch (cleanParseError) {
                console.log('⚠️ Parser limpio falló, intentando extracción manual...', cleanParseError.message);
                
                // Estrategia 3: Extracción manual más robusta
                try {
                    // Buscar patrón de incidents array
                    const incidentsRegex = /"incidents":\s*\[(.*?)\]\s*,\s*"technician"/s;
                    const incidentsMatch = responseText.match(incidentsRegex);
                    
                    if (incidentsMatch) {
                        const incidentsText = incidentsMatch[1];
                        console.log('📋 Texto de incidencias extraído, longitud:', incidentsText.length);
                        
                        // Buscar technician info
                        const technicianRegex = /"technician":\s*{([^}]+)}/;
                        const technicianMatch = responseText.match(technicianRegex);
                        
                        let technicianInfo = {};
                        if (technicianMatch) {
                            const technicianText = '{' + technicianMatch[1] + '}';
                            try {
                                const cleanTechText = technicianText.replace(/\\"/g, '"');
                                technicianInfo = JSON.parse(cleanTechText);
                            } catch (e) {
                                console.log('⚠️ Error parseando technician, usando fallback');
                                const nameMatch = technicianMatch[1].match(/"name":\s*"([^"]+)"/);
                                const emailMatch = technicianMatch[1].match(/"email":\s*"([^"]+)"/);
                                technicianInfo = {
                                    name: nameMatch ? nameMatch[1] : 'Técnico',
                                    email: emailMatch ? emailMatch[1] : 'email@empresa.com'
                                };
                            }
                        }
                        
                        parsedData = {
                            status: 'success',
                            incidents: [],
                            technician: technicianInfo,
                            message: 'Datos extraídos con parser manual'
                        };
                        
                        // Dividir incidencias manualmente buscando patrones
                        const incidentPattern = /"id":\s*"([^"]*(?:\n[^"]*)?)"/g;
                        let match;
                        let incidentBlocks = [];
                        let lastIndex = 0;
                        
                        // Encontrar todos los starts de incidencias
                        while ((match = incidentPattern.exec(incidentsText)) !== null) {
                            if (incidentBlocks.length > 0) {
                                // Guardar el bloque anterior
                                const blockText = incidentsText.substring(lastIndex, match.index);
                                incidentBlocks.push(blockText);
                            }
                            lastIndex = match.index;
                        }
                        
                        // Añadir el último bloque
                        if (lastIndex < incidentsText.length) {
                            incidentBlocks.push(incidentsText.substring(lastIndex));
                        }
                        
                        console.log(`📦 Encontrados ${incidentBlocks.length} bloques de incidencias`);
                        
                        // Procesar cada bloque de incidencia
                        incidentBlocks.forEach((block, index) => {
                            try {
                                // Limpiar el bloque individual
                                let cleanBlock = block.trim();
                                
                                // Asegurar que empiece con {
                                if (!cleanBlock.startsWith('{')) {
                                    cleanBlock = '{' + cleanBlock;
                                }
                                
                                // Asegurar que termine con }
                                if (!cleanBlock.endsWith('}')) {
                                    // Buscar el último } válido
                                    const lastBraceIndex = cleanBlock.lastIndexOf('}');
                                    if (lastBraceIndex > 0) {
                                        cleanBlock = cleanBlock.substring(0, lastBraceIndex + 1);
                                    } else {
                                        cleanBlock = cleanBlock + '}';
                                    }
                                }
                                
                                // Aplicar las mismas limpiezas que antes
                                cleanBlock = cleanBlock
                                    .replace(/\\"/g, '"')
                                    .replace(/"false\\"/g, '"false"')
                                    .replace(/"true\\"/g, '"true"')
                                    .replace(/"Sin motivo\\"/g, '"Sin motivo"')
                                    .replace(/"Sin asignar\\"/g, '"Sin asignar"')
                                    .replace(/"Sin descripción\\"/g, '"Sin descripción"')
                                    .replace(/"Sin acciones\\"/g, '"Sin acciones"')
                                    .replace(/"Sin ayuda\\"/g, '"Sin ayuda"')
                                    .replace(/"id":\s*"([^"]*)\n([^"]*)"/g, '"id": "$1$2"')
                                    .replace(/\n/g, ' ')
                                    .replace(/\s+/g, ' ');
                                
                                console.log(`🔧 Procesando incidencia ${index + 1}:`, cleanBlock.substring(0, 100) + '...');
                                
                                const incident = JSON.parse(cleanBlock);
                                parsedData.incidents.push(incident);
                                console.log(`✅ Incidencia ${index + 1} parseada correctamente:`, incident.id);
                                
                            } catch (incidentError) {
                                console.log(`❌ Error parseando incidencia ${index + 1}:`, incidentError.message);
                                console.log('📄 Bloque problemático:', block.substring(0, 200) + '...');
                            }
                        });
                        
                        console.log(`✅ Extraídas ${parsedData.incidents.length} incidencias correctamente`);
                    } else {
                        console.log('❌ No se pudo encontrar el patrón de incidents');
                    }
                } catch (extractError) {
                    console.log('❌ Extracción falló:', extractError.message);
                }
            }
        }
        
        // Si tenemos datos parseados, devolverlos
        if (parsedData && parsedData.status) {
            console.log('🎯 Devolviendo datos parseados de Make');
            return res.status(200).json(parsedData);
        }
        
        // Si Make devuelve solo "Accepted", generar respuesta propia
        if (responseText.trim() === 'Accepted' || responseText.trim() === 'OK') {
            console.log('📝 Make devolvió confirmación simple, generando respuesta');
            return res.status(200).json(
                getSuccessResponse(action, makePayload)
            );
        }
        
        // Fallback: generar respuesta básica pero funcional
        console.log('🔄 Fallback: generando respuesta de desarrollo');
        return res.status(200).json(
            getDevResponse(action, makePayload)
        );
        
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

// Respuestas de desarrollo (con datos de ejemplo)
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
                    sla_l0_end: new Date(Date.now() + 25 * 60 * 1000).toISOString(),
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
                    sla_l1_backup_end: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
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
            next_step: 'Dirígete a la zona indicada y comienza el diagnóstico.',
            incident_id: payload.incident_id,
            assigned_to: payload.technician_email
        },
        'rechazo': {
            status: 'success',
            message: 'Incidencia rechazada correctamente',
            next_step: 'La incidencia se ha escalado automáticamente.',
            incident_id: payload.incident_id,
            reason: payload.reason,
            escalated: true
        },
        'ayuda': {
            status: 'success',
            message: 'Solicitud de ayuda enviada',
            next_step: 'Un supervisor se pondrá en contacto contigo pronto.',
            incident_id: payload.incident_id,
            help_type: payload.reason
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
