// API para validar PIN del supervisor
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
            action,
            supervisor,
            pin
        } = req.body;
        
        // Validar datos básicos
        if (!action || !supervisor || !pin) {
            return res.status(400).json({
                error: 'Faltan parámetros requeridos',
                required: ['action', 'supervisor', 'pin']
            });
        }
        
        // Preparar payload para Make
        const makePayload = {
            timestamp: new Date().toISOString(),
            action: action,
            supervisor_email: supervisor,
            pin: pin,
            user_agent: req.headers['user-agent'],
            ip_address: req.headers['x-forwarded-for'] || req.connection.remoteAddress
        };
        
        // En desarrollo, simular validación
        if (!process.env.MAKE_WEBHOOK_VALIDATE_PIN) {
            console.log('🔐 DESARROLLO - Validación PIN:', makePayload);
            
            // Simular validación de PIN
            const isValidPin = pin === '1234';
            
            return res.status(200).json({
                status: isValidPin ? 'success' : 'error',
                message: isValidPin ? 'PIN válido' : 'PIN incorrecto',
                supervisor: isValidPin ? {
                    name: 'Elena Vázquez',
                    email: supervisor,
                    department: 'Jefe Mecánico'
                } : null
            });
        }
        
        // En producción, enviar a Make
        console.log('🔐 Enviando validación a Make:', process.env.MAKE_WEBHOOK_VALIDATE_PIN);
        console.log('📨 Payload:', makePayload);
        
        const makeResponse = await fetch(process.env.MAKE_WEBHOOK_VALIDATE_PIN, {
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
        
        // Leer y parsear respuesta
        const responseText = await makeResponse.text();
        console.log('📄 Make Response:', responseText);
        
        try {
            const makeData = JSON.parse(responseText);
            console.log('✅ PIN validation response parsed');
            return res.status(200).json(makeData);
        } catch (parseError) {
            console.error('❌ JSON Parse Error:', parseError.message);
            
            return res.status(500).json({
                status: 'error',
                message: 'Invalid JSON from Make',
                parse_error: parseError.message,
                raw_response: responseText.substring(0, 200)
            });
        }
        
    } catch (error) {
        console.error('❌ Error en validate-pin:', error);
        
        return res.status(500).json({
            status: 'error',
            message: 'Error interno del servidor',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Error procesando validación'
        });
    }
}
