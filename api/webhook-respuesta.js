// API que SOLO procesa datos reales de Make - SIN DATOS INVENTADOS
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
        
        // En desarrollo local, mostrar error
        if (!process.env.MAKE_WEBHOOK_RESPUESTA) {
            console.log('❌ DESARROLLO - Make webhook no configurado');
            return res.status(500).json({
                status: 'error',
                message: 'Webhook de Make no configurado en desarrollo'
            });
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
        console.log('📄 Make Response COMPLETA:', responseText);
        
        // VERIFICAR QUÉ ESTÁ DEVOLVIENDO MAKE
        if (responseText.trim() === 'Accepted') {
            console.log('❌ PROBLEMA: Make está devolviendo solo "Accepted"');
            console.log('❌ SOLUCIÓN: Verificar que el escenario use WebhookRespond, no HTTP Response');
            
            return res.status(500).json({
                status: 'error',
                message: 'Make está devolviendo "Accepted" en lugar del JSON configurado',
                make_response: responseText,
                solution: 'Verificar que el último módulo en Make sea WebhookRespond con el JSON completo',
                debug_info: {
                    action: action,
                    webhook_url: process.env.MAKE_WEBHOOK_RESPUESTA,
                    timestamp: new Date().toISOString()
                }
            });
        }
        
        // Intentar parsear JSON de Make
        try {
            const parsedData = JSON.parse(responseText);
            console.log('✅ JSON parseado correctamente desde Make');
            console.log('📊 Status:', parsedData.status);
            console.log('📊 Incidents encontrados:', parsedData.incidents?.length || 0);
            
            // VALIDAR que tiene la estructura esperada
            if (!parsedData.status) {
                console.log('⚠️ Advertencia: respuesta sin campo status');
            }
            
            if (action === 'get_assigned_incidents' && !parsedData.incidents) {
                console.log('⚠️ Advertencia: get_assigned_incidents sin campo incidents');
            }
            
            // DEVOLVER LOS DATOS REALES DE MAKE
            return res.status(200).json(parsedData);
            
        } catch (parseError) {
            console.log('❌ Error parseando JSON de Make:', parseError.message);
            console.log('📄 Contenido que causó el error:', responseText.substring(0, 500));
            
            // Si no es JSON válido, es un problema de Make
            return res.status(500).json({
                status: 'error',
                message: 'Make devolvió JSON inválido',
                parse_error: parseError.message,
                make_response_preview: responseText.substring(0, 200),
                solution: 'Verificar la sintaxis JSON en el WebhookRespond de Make'
            });
        }
        
    } catch (error) {
        console.error('❌ Error en webhook respuesta:', error);
        
        return res.status(500).json({
            status: 'error',
            message: 'Error interno del servidor',
            error: error.message,
           action: req.body?.action || req.query?.action || 'unknown' 
        });
    }
}
