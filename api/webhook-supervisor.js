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
            supervisor,      // Email del supervisor
            department,
            escalation_paused, // Escalado parado si o no (para pause_escalation action)
            supervisor_name,
            incident_id,     // ID de incidencia (para acciones)
            technician,      // Email técnico (para asignaciones)
            solution,        // Solución (para resolver directamente)
            help_action,     // Tipo de ayuda (provide_tools, provide_consultation)
            data             // Datos adicionales según la acción
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
        
        console.log('🛡️ Dashboard Supervisor - Acción:', action);
        console.log('📨 Payload a Make:', makePayload);
        
        // En desarrollo, simular solo respuestas básicas
        if (!process.env.MAKE_WEBHOOK_SUPERVISOR) {
            console.log('🔧 DESARROLLO - Simulando respuesta...');
            return res.status(200).json({
                status: 'success',
                message: `Acción ${action} procesada en desarrollo`,
                action: action,
                timestamp: new Date().toISOString()
            });
        }
        
        // En producción, enviar a Make
        console.log('📡 Enviando a Make:', process.env.MAKE_WEBHOOK_SUPERVISOR);
        
        const makeResponse = await fetch(process.env.MAKE_WEBHOOK_SUPERVISOR, {
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
                message: `Acción ${action} procesada correctamente por Make`,
                action: action,
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
                message: `Acción ${action} procesada por Make`,
                action: action,
                make_response: responseText.substring(0, 100),
                timestamp: new Date().toISOString()
            });
        }
        
    } catch (error) {
        console.error('❌ Error en webhook supervisor:', error);
        
        return res.status(500).json({
            status: 'error',
            message: 'Error interno del servidor',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Error procesando acción',
            action: req.body?.action || 'unknown'
        });
    }
}
