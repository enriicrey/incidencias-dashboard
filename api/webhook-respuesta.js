// /api/webhook-respuesta.js - VERSIÓN RECOMENDADA
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ status: 'error', message: 'Solo se permite POST y GET' });
  }

  try {
    const data = req.method === 'POST' ? req.body : req.query;
    const {
      action,
      incident_id,
      technician_email,
      technician_name,
      level,
      // comunes
      pin,
      escalation_level,
      read_only,
      // rechazo / aceptación
      reason,
      // resolver
      solution_description,
      time_invested,
      preventive_actions,
      materials_used,
      // materiales
      materials_requested,
      work_can_continue,
      impact_if_delayed,
      // derivación
      current_department,
      target_department,
      derivation_reason,
      technical_notes,
      // ayuda
      help_type,
      help_description,
      urgency,
      // asignación
      request_reason,
      request_justification,
      // aportar info
      information_type,
      information_content,
      attachments
    } = data || {};

    console.log('🔧 Acción:', action);
    console.log('📨 Payload recibido:', JSON.stringify(data, null, 2));

    if (!action) {
      return res.status(400).json({ status: 'error', message: 'Falta parámetro action' });
    }

    const ip =
      (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() ||
      req.socket?.remoteAddress ||
      req.connection?.remoteAddress ||
      '';

    const formatNameFromEmail = (email) =>
      (email || '').split('@')[0]?.split('.').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || '';

    let makePayload = {
      timestamp: new Date().toISOString(),
      action,
      incident_id,
      technician_email,
      technician_name: technician_name || formatNameFromEmail(technician_email),
      level: level || 'L0',
      user_agent: req.headers['user-agent'],
      ip_address: ip,
    };

    // =========================
    // Switch de acciones
    // =========================
    switch (action) {
      case 'acepto':
      case 'rechazo':
        makePayload.reason = reason;
        makePayload.escalation_level = Number.isFinite(+escalation_level) ? +escalation_level : 0;
        break;

      case 'resolver': {
        if (!solution_description || !time_invested) {
          return res.status(400).json({
            status: 'error',
            message: 'solution_description y time_invested son obligatorios'
          });
        }
        makePayload.solution_description = solution_description;
        makePayload.time_invested = time_invested;
        makePayload.preventive_actions = preventive_actions || '';
        makePayload.materials_used = Array.isArray(materials_used) ? materials_used : (materials_used || []);
        if (Array.isArray(makePayload.materials_used)) {
          makePayload.materials_count = makePayload.materials_used.length;
          makePayload.materials_summary = makePayload.materials_used
            .map(m => `${m.materialName || m.nombre || 'Material'} (${m.quantity || m.cantidad || 1})`)
            .join(', ');
        }
        break;
      }

      case 'solicitar_materiales': {
        const list = Array.isArray(materials_requested) ? materials_requested : [];
        if (!list.length) {
          return res.status(400).json({
            status: 'error',
            message: 'materials_requested debe ser un array con al menos un material'
          });
        }
        makePayload.materials_requested = list;
        makePayload.work_can_continue = !!work_can_continue;
        makePayload.impact_if_delayed = impact_if_delayed || 'Sin impacto especificado';
        makePayload.materials_count = list.length;
        makePayload.urgency_levels = list.map(m => m.urgencia || m.urgency || 'normal').join(',');
        break;
      }

      case 'derivar_departamento':
        if (!target_department || !derivation_reason) {
          return res.status(400).json({
            status: 'error',
            message: 'target_department y derivation_reason son obligatorios'
          });
        }
        makePayload.current_department = current_department || '';
        makePayload.target_department = target_department;
        makePayload.derivation_reason = derivation_reason;
        makePayload.technical_notes = technical_notes || '';
        break;

      case 'ayuda':
        if (!help_type || !help_description) {
          return res.status(400).json({
            status: 'error',
            message: 'help_type y help_description son obligatorios'
          });
        }
        makePayload.help_type = help_type;
        makePayload.help_description = help_description;
        makePayload.urgency = urgency || 'media';
        break;

      case 'solicitar_asignacion':
        makePayload.request_reason = request_reason || '';
        makePayload.request_justification = request_justification || '';
        break;

      case 'aportar_informacion':
        makePayload.information_type = information_type || '';
        makePayload.information_content = information_content || '';
        makePayload.attachments = Array.isArray(attachments) ? attachments : [];
        break;

      case 'validate_pin':
        makePayload.pin = pin || '';
        break;

      case 'get_assigned_incidents':
        makePayload.read_only = (read_only === true || read_only === 'true');
        break;

      default:
        console.warn('⚠️ Acción no reconocida, se reenvían campos tal cual');
        makePayload = { ...makePayload, ...data };
    }

    if (!process.env.MAKE_WEBHOOK_RESPUESTA) {
      console.error('❌ MAKE_WEBHOOK_RESPUESTA no configurado');
      return res.status(500).json({ status: 'error', message: 'Webhook no configurado en el servidor' });
    }

    console.log('📡 Enviando a Make:', JSON.stringify(makePayload, null, 2));

    const makeResp = await fetch(process.env.MAKE_WEBHOOK_RESPUESTA, {
      method: 'POST',                      // Make suele esperar POST
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makePayload),
    });

    const raw = await makeResp.text();
    console.log('📥 Make Status:', makeResp.status, makeResp.statusText);
    console.log('📄 Make Body (log truncado):', raw.slice(0, 500) + (raw.length > 500 ? '…' : ''));

    // Si Make devuelve "OK/Accepted", devolvemos éxito genérico
    const trimmed = raw.trim();
    if (trimmed === 'OK' || trimmed === 'Accepted') {
      const msgs = {
        'acepto': 'Incidencia aceptada correctamente',
        'rechazo': 'Incidencia rechazada. Se escalará automáticamente',
        'resolver': 'Incidencia resuelta exitosamente',
        'solicitar_materiales': 'Solicitud de materiales enviada',
        'derivar_departamento': 'Derivación solicitada al supervisor',
        'ayuda': 'Solicitud de ayuda enviada',
        'solicitar_asignacion': 'Solicitud de asignación enviada',
        'aportar_informacion': 'Información aportada correctamente',
        'validate_pin': 'PIN validado',
        'get_assigned_incidents': 'Consulta ejecutada',
      };
      return res.status(200).json({
        status: 'success',
        message: msgs[action] || `Acción ${action} procesada correctamente`,
        action,
        incident_id,
        timestamp: new Date().toISOString(),
      });
    }

    // Si Content-Type indica JSON, parsea y reenvía tal cual
    const isJSON = (makeResp.headers.get('content-type') || '').includes('application/json');
    if (isJSON) {
      try {
        const payload = JSON.parse(raw);
        return res.status(200).json(payload);
      } catch (e) {
        // Content-Type decía JSON pero no lo es — trata como error para acciones de listado
        if (action === 'get_assigned_incidents') {
          return res.status(502).json({
            status: 'error',
            message: 'Respuesta de Make inválida (JSON malformado)',
            raw
          });
        }
        // Para el resto, éxito genérico con contexto
        return res.status(200).json({
          status: 'success',
          message: `Acción ${action} procesada (respuesta no JSON parseable)`,
          action,
          incident_id,
          raw
        });
      }
    }

    // No es JSON. Decide según acción:
    if (action === 'get_assigned_incidents') {
      // Para el dashboard es mejor fallar explícitamente:
      return res.status(502).json({
        status: 'error',
        message: 'Respuesta de Make no es JSON (se esperaba incidents[])',
        raw
      });
    }

    // Para otras acciones (mutaciones), éxito genérico con el raw completo
    return res.status(200).json({
      status: 'success',
      message: `Acción ${action} procesada`,
      action,
      incident_id,
      raw
    });

  } catch (error) {
    console.error('💥 Error en webhook-respuesta:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor',
      error: process.env.NODE_ENV === 'development' ? String(error?.stack || error) : String(error?.message || error),
      action: (req.body && req.body.action) || (req.query && req.query.action) || 'unknown',
      timestamp: new Date().toISOString()
    });
  }
}
