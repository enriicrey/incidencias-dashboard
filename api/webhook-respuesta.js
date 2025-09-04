// /api/webhook-respuesta.js - VERSIÓN RECOMENDADA
module.exports = async function handler(req, res) {
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

    // Normalización de campos desde el front (es -> en)
    const norm = { ...data };
    
    // materiales: [{ nombre, cantidad, tipo, urgencia, justificacion }] -> materials_requested
    if (Array.isArray(norm.materiales) && !norm.materials_requested) {
      norm.materials_requested = norm.materiales.map(m => ({
        name: m.nombre,
        quantity: Number(m.cantidad) || 1,
        type: m.tipo,
        urgency: m.urgencia || 'normal',
        justification: m.justificacion || ''
      }));
    }
    
    // para resolver: materials_used puede venir como string -> array
    if (typeof norm.materials_used === 'string') {
      norm.materials_used = norm.materials_used
        .split(',').map(s => s.trim()).filter(Boolean)
        .map(x => ({ materialName: x, quantity: 1 }));
    }
    
    // descripción libre en varias acciones
    if (norm.description && !norm.help_description) norm.help_description = norm.description;
    if (norm.description && !norm.information_content) norm.information_content = norm.description;
    
    // alias de urgencia
    if (!norm.urgency && norm.matUrgencia) norm.urgency = norm.matUrgencia;
    
    // asegurar booleans
    if (typeof norm.read_only === 'string') norm.read_only = norm.read_only === 'true';
    if (typeof norm.work_can_continue === 'string') norm.work_can_continue = norm.work_can_continue === 'true';
    
    // mover norm al objeto data que usa el switch
    Object.assign(data, norm);


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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makePayload),
    });
    
    // ---- NUEVO: utilidades de parseo tolerantes ----
    const textRaw = await makeResp.text();
    const stripBOM = (s='') => s.replace(/^\uFEFF/, '').trim();
    const tryJSON = (s) => { try { return JSON.parse(s); } catch { return null; } };
    
    // Intenta “desdoblar” si vino doble-encodeado (string que adentro es JSON)
    function unwrapIfQuotedJSON(s) {
      if (s.startsWith('"') && s.endsWith('"')) {
        const once = tryJSON(s);
        if (typeof once === 'string') return once.trim();
      }
      return s;
    }
    
    // Intenta extraer el primer bloque JSON válido de un body textual (HTML/logs)
    function extractFirstJSON(s) {
      s = stripBOM(s);
      // 1) ¿es JSON directo?
      let parsed = tryJSON(s);
      if (parsed) return parsed;
    
      // 2) ¿está doble-encodeado?
      s = unwrapIfQuotedJSON(s);
      parsed = tryJSON(s);
      if (parsed) return parsed;
    
      // 3) Buscar el primer bloque {...} o [...]
      //    Nota: no es un parser perfecto, pero suele rescatar JSON en respuestas HTML/log.
      const startIdx = s.search(/[{[]/);
      if (startIdx >= 0) {
        const candidate = s.slice(startIdx);
        // Intenta truncar en el último cierre razonable
        const lastCurly = candidate.lastIndexOf('}');
        const lastBracket = candidate.lastIndexOf(']');
        const endIdx = Math.max(lastCurly, lastBracket);
        if (endIdx > 0) {
          const slice = candidate.slice(0, endIdx + 1);
          const p2 = tryJSON(slice);
          if (p2) return p2;
        }
      }
      return null;
    }
    
    console.log('📥 Make Status:', makeResp.status, makeResp.statusText);
    console.log('📄 Make Body (log truncado):', textRaw.slice(0, 500) + (textRaw.length > 500 ? '…' : ''));
    
    // ---------- LÓGICA DE RESPUESTA ----------
    const parsed = extractFirstJSON(textRaw);
    
    // Si logramos JSON:
    if (parsed) {
      if (action === 'get_assigned_incidents') {
        // 1) Caso esperado: { incidents: [...] }
        if (Array.isArray(parsed.incidents)) {
          return res.status(200).json({ status: 'success', incidents: parsed.incidents });
        }
        // 2) Alternativas comunes
        if (parsed.data && Array.isArray(parsed.data.incidents)) {
          return res.status(200).json({ status: 'success', incidents: parsed.data.incidents });
        }
        // 3) Make devolvió directamente un array -> lo tratamos como incidents
        if (Array.isArray(parsed) && parsed.every(x => x && typeof x === 'object')) {
          return res.status(200).json({ status: 'success', incidents: parsed });
        }
        // 4) No hay incidents[] en un JSON válido
        return res.status(502).json({
          status: 'error',
          message: 'Respuesta de Make es JSON pero no contiene incidents[]',
          sampleKeys: Object.keys(parsed),
        });
      }
    
      // Acciones de mutación: devolver tal cual lo que haya (normalizado a success si aplica)
      return res.status(200).json(parsed);
    }
    
    // Si NO hay JSON parseable:
    if (action === 'get_assigned_incidents') {
      // ¿Demo habilitado por ENV o query? (no se usa en producción si no lo activas)
      const demoEnabled =
        process.env.ALLOW_DEMO_INCIDENTS === '1' ||
        String(req.query.demo || req.body?.demo || '') === '1';
    
      if (demoEnabled) {
        return res.status(200).json({
          status: 'success',
          incidents: [], // Devuelve array vacío para no “hardcodear” datos. Puedes probar con tu payload de ejemplo si quieres.
        });
      }
    
      return res.status(502).json({
        status: 'error',
        message: 'Respuesta de Make no es JSON (se esperaba incidents[])',
        http_status: makeResp.status,
      });
    }
    
    // Para mutaciones sin JSON (Make devolvió “OK” o texto):
    const okText = stripBOM(textRaw);
    if (/^(ok|accepted)$/i.test(okText)) {
      return res.status(200).json({
        status: 'success',
        message: 'Operación aceptada por Make',
        action,
        incident_id,
        timestamp: new Date().toISOString(),
      });
    }
    
    // Último recurso: éxito genérico con raw limitado
    return res.status(200).json({
      status: 'success',
      message: `Acción ${action} procesada (sin JSON)`,
      action,
      incident_id,
      raw: okText.slice(0, 500),
    });
