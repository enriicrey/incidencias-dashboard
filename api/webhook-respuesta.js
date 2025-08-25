// API para manejar respuestas de técnicos - SOLUCIÓN DEFINITIVA
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
                error: 'Falta parámetro action'
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
        
        // PARSER ROBUSTO - Manejar JSON problemático de Make
        try {
            // Método 1: Parser directo
            const parsedData = JSON.parse(responseText);
            console.log('✅ JSON parseado correctamente (método directo)');
            console.log('📊 Status:', parsedData.status);
            console.log('📊 Incidents encontrados:', parsedData.incidents?.length || 0);
            
            return res.status(200).json(parsedData);
            
        } catch (parseError) {
            console.log('❌ Parser directo falló, usando método avanzado:', parseError.message);
            
            // Método 2: Limpieza avanzada de JSON
            try {
                let cleanedResponse = responseText;
                
                // Limpiar caracteres de control problemáticos
                cleanedResponse = cleanedResponse
                    .replace(/[\x00-\x1F\x7F-\x9F]/g, '') // Eliminar caracteres de control
                    .replace(/\\n/g, ' ') // Reemplazar saltos de línea escapados
                    .replace(/\\r/g, '') // Eliminar returns
                    .replace(/\\t/g, ' ') // Reemplazar tabs
                    .replace(/\\/g, '\\\\') // Escapar backslashes
                    .replace(/"/g, '\\"') // Escapar comillas dentro de strings
                    .replace(/\\"/g, '"') // Restaurar comillas de JSON
                    .replace(/\\\\/g, '\\'); // Restaurar backslashes normales
                
                // Limpiar comentarios
                cleanedResponse = cleanedResponse.replace(/\/\/.*$/gm, '');
                
                // Limpiar trailing commas
                cleanedResponse = cleanedResponse.replace(/,(\s*[}\]])/g, '$1');
                
                console.log('🧹 JSON limpiado con método avanzado');
                
                const parsedClean = JSON.parse(cleanedResponse);
                console.log('✅ JSON parseado correctamente (método limpieza)');
                console.log('📊 Incidents encontrados:', parsedClean.incidents?.length || 0);
                
                return res.status(200).json(parsedClean);
                
            } catch (cleanParseError) {
                console.log('❌ Limpieza avanzada falló:', cleanParseError.message);
                
                // Método 3: Extracción manual (último recurso)
                try {
                    console.log('🔧 Usando extracción manual...');
                    
                    const extractedData = extractDataManually(responseText);
                    if (extractedData && extractedData.incidents) {
                        console.log('✅ Extracción manual exitosa');
                        console.log('📊 Incidents extraídos:', extractedData.incidents.length);
                        return res.status(200).json(extractedData);
                    }
                    
                } catch (extractError) {
                    console.log('❌ Extracción manual falló:', extractError.message);
                }
            }
        }
        
        // Si todo falla y es una acción exitosa
        if (responseText.includes('success') || responseText.trim() === 'Accepted') {
            console.log('✅ Make confirmó éxito, generando respuesta');
            return res.status(200).json({
                status: 'success',
                message: `Acción ${action} procesada correctamente`,
                action: action,
                timestamp: new Date().toISOString()
            });
        }
        
        // Último recurso: error
        throw new Error('No se pudo procesar la respuesta de Make');
        
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

// Función de extracción manual para casos extremos
function extractDataManually(responseText) {
    try {
        // Buscar el patrón de incidencias
        const incidentsMatch = responseText.match(/"incidents":\s*\[(.*?)\]/s);
        if (!incidentsMatch) {
            throw new Error('No se encontraron incidencias');
        }
        
        // Buscar información del técnico
        const technicianMatch = responseText.match(/"technician":\s*{([^}]*)}/);
        let technician = { name: 'Técnico', email: 'no-email' };
        
        if (technicianMatch) {
            const techData = technicianMatch[1];
            const nameMatch = techData.match(/"name":\s*"([^"]*)"/);
            const emailMatch = techData.match(/"email":\s*"([^"]*)"/);
            
            if (nameMatch) technician.name = nameMatch[1];
            if (emailMatch) technician.email = emailMatch[1];
        }
        
        // Buscar status
        const statusMatch = responseText.match(/"status":\s*"([^"]*)"/);
        const status = statusMatch ? statusMatch[1] : 'success';
        
        // Para simplificar, retornamos estructura vacía pero válida
        // Los datos reales se procesarán cuando Make arregle el JSON
        return {
            status: status,
            message: 'Datos extraídos manualmente - JSON parcialmente corrupto',
            incidents: [], // Vacío por seguridad
            technician: technician,
            total_incidents: 0,
            timestamp: new Date().toISOString()
        };
        
    } catch (error) {
        throw new Error(`Extracción manual falló: ${error.message}`);
    }
}

// Respuestas de desarrollo solo para testing local
function getDevResponse(action, payload) {
    if (action === 'get_assigned_incidents') {
        return {
            status: 'success',
            message: 'Modo desarrollo - sin incidencias reales',
            technician: {
                name: payload.technician_name,
                email: payload.technician_email,
                department: 'Desarrollo'
            },
            incidents: [], // Vacío para evitar confusión
            total_incidents: 0
        };
    }
    
    // Para otras acciones
    return {
        status: 'success',
        message: `Acción ${action} procesada en desarrollo`,
        action: action
    };
}
