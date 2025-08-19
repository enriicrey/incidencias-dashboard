// API para manejar respuestas de técnicos
export default async function handler(req, res) {
    // Configurar CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    if (req.method !== 'POST' && req.method !== 'GET') {
        return res.status(405).json({ error: 'Método no permitido' });
    }
    
    try {
        // Extraer datos del query string (para URLs de correo) o body
        const data = req.method === 'GET' ? req.query : req.body;
        
        const {
            action,           // 'acepto', 'rechazo', 'ayuda'
            id,              // ID de la incidencia
            tecnico,         // Email del técnico
            nivel,           // 'inicial', 'backup', 'equipo'
            reason           // Motivo específico (opcional)
        } = data;
        
        // Validar datos requeridos
        if (!action || !id || !tecnico || !nivel) {
            return res.status(400).json({
                error: 'Faltan parámetros requeridos',
                required: ['action', 'id', 'tecnico', 'nivel']
            });
        }
        
        // Preparar payload para Make
        const makePayload = {
            timestamp: new Date().toISOString(),
            incident_id: id,
            technician_email: tecnico,
            level: nivel,
            action: action,
            reason: reason || null,
            user_agent: req.headers['user-agent'],
            ip_address: req.headers['x-forwarded-for'] || req.connection.remoteAddress
        };
        
        // En desarrollo, simular respuesta
        if (!process.env.MAKE_WEBHOOK_RESPUESTA) {
            console.log('🔧 DESARROLLO - Respuesta técnico:', makePayload);
            
            return res.status(200).json({
                status: 'success',
                message: `Respuesta "${action}" registrada correctamente`,
                data: {
                    incident_id: id,
                    technician: tecnico,
                    action: action,
                    reason: reason,
                    next_step: getNextStep(action, reason)
                }
            });
        }
        
        // En producción, enviar a Make
        const makeResponse = await fetch(process.env.MAKE_WEBHOOK_RESPUESTA, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(makePayload)
        });
        
        if (!makeResponse.ok) {
            throw new Error(`Error en Make: ${makeResponse.status}`);
        }
        
        const makeData = await makeResponse.json();
        
        return res.status(200).json({
            status: 'success',
            message: 'Respuesta procesada correctamente',
            data: makeData
        });
        
    } catch (error) {
        console.error('❌ Error en webhook-respuesta:', error);
        
        return res.status(500).json({
            status: 'error',
            message: 'Error interno del servidor',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Error procesando respuesta'
        });
    }
}

// Función auxiliar para determinar próximo paso
function getNextStep(action, reason) {
    switch (action) {
        case 'acepto':
            return 'Técnico asignado - Trabajando en incidencia';
        case 'rechazo':
            return 'Escalando automáticamente al siguiente nivel';
        case 'ayuda':
            switch (reason) {
                case 'fuera_especialidad':
                    return 'Supervisor evaluará cambio de departamento';
                case 'herramientas_especiales':
                    return 'Supervisor gestionará herramientas necesarias';
                case 'consulta_supervisor':
                    return 'Supervisor contactará para consulta';
                default:
                    return 'Escalado pausado - Supervisor intervendrá';
            }
        default:
            return 'Procesando respuesta';
    }
}
